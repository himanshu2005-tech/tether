// Invoice intake and multi-level approval.
//
// When an invoice reaches a buyer organisation, a buyer's browser (not the supplier's) runs the
// AI validation again and starts the approval chain, so a supplier can't submit a forged "clear"
// result. Both steps run inside transactions so two team members can't process the same invoice twice.
import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { analyzeInvoice } from '../api';
import { newApproval, decide, levelsFor } from '../constants/approvals';
import { ROLE_LABELS } from '../security/roles';
import { logAudit } from './audit';
import { notify } from './notify';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const label = (bill) => `#${bill.invoiceNumber || bill.id.substring(0, 8).toUpperCase()}`;

const CONTRACT_FLAGS = ['price_exceeded', 'quantity_exceeded', 'extra_charges_not_allowed', 'extra_charges_exceeded', 'contract_mismatch'];

/** Validates a newly arrived invoice and starts its approval chain. Returns true if it did the work. */
export async function intakeInvoice(bill, { orgId, settings }) {
  if (bill.approval || bill.status !== 'unpaid') return false;

  // AI validation from the buyer's side, against the contract the buyer holds
  let analysis = bill.analysis || null;
  if (bill.contractId) {
    const contractSnap = await getDoc(doc(db, 'contracts', bill.contractId)).catch(() => null);
    if (contractSnap?.exists()) {
      const c = contractSnap.data();
      // Quantity already invoiced before this bill
      const contract = { id: contractSnap.id, ...c, quantityInvoiced: Math.max(0, (c.quantityInvoiced || 0) - Number(bill.quantityRequested || 0)) };
      analysis = await analyzeInvoice(contract, bill, bill.ocr?.fields || null).catch(() => analysis);
      if (analysis) analysis.analyzedAt = new Date().toISOString();
    }
  }
  const approval = newApproval(bill.amount, settings?.approvals);
  const reviewStatus = !analysis ? 'unchecked' : analysis.level === 'clear' ? 'auto_cleared' : 'pending_review';

  const done = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'bills', bill.id);
    const fresh = await tx.get(ref);
    if (!fresh.exists() || fresh.data().approval) return false;
    tx.update(ref, { analysis, reviewStatus, approval, validatedAt: serverTimestamp(), validatedBy: 'buyer' });
    return true;
  });
  if (!done) return false;

  const flags = analysis?.flags || [];
  await logAudit({
    action: 'INVOICE_VALIDATED', entityType: 'invoice', entityId: bill.id, entityLabel: label(bill), orgId,
    next: { riskScore: analysis?.riskScore ?? null, level: analysis?.level ?? 'unchecked', flags: flags.map(f => f.type), approvalTier: approval.tier },
    meta: { amount: bill.amount, supplierId: bill.supplierId }
  });

  if (analysis && analysis.level !== 'clear') {
    await notify({ orgId, roles: ['procurement_officer', 'procurement_manager', 'admin'] }, {
      kind: 'invoice_anomaly', severity: analysis.level === 'hold' ? 'high' : 'medium',
      title: `Invoice ${label(bill)} flagged by AI`,
      message: `${money(bill.amount)} for ${bill.productName}: ${flags.slice(0, 2).map(f => f.title).join(', ')}.`,
      entityType: 'invoice', entityId: bill.id, link: '/risk'
    }, { includeSender: true });
  }
  if (flags.some(f => CONTRACT_FLAGS.includes(f.type))) {
    await notify({ orgId, roles: ['procurement_manager', 'admin'] }, {
      kind: 'contract_violation', severity: 'high',
      title: 'Possible contract violation',
      message: `Invoice ${label(bill)} does not match the contract: ${flags.filter(f => CONTRACT_FLAGS.includes(f.type)).map(f => f.title.toLowerCase()).join(', ')}.`,
      entityType: 'invoice', entityId: bill.id, link: '/approvals'
    }, { includeSender: true });
  }
  if (levelsFor(bill.amount, settings?.approvals) >= 3) {
    await notify({ orgId, roles: ['finance_manager', 'admin'] }, {
      kind: 'high_value', severity: 'medium', title: 'High-value invoice received',
      message: `Invoice ${label(bill)} for ${money(bill.amount)} needs three approvals.`,
      entityType: 'invoice', entityId: bill.id, link: '/approvals'
    }, { includeSender: true });
  }
  await notify({ orgId, roles: [approval.nextRole] }, {
    kind: 'approval_required', severity: 'medium', title: 'Invoice needs your approval',
    message: `${label(bill)} · ${money(bill.amount)} · ${approval.tier} (${approval.steps.length} approval${approval.steps.length > 1 ? 's' : ''}).`,
    entityType: 'invoice', entityId: bill.id, link: '/approvals'
  }, { includeSender: true });
  return true;
}

/** Signs or rejects the current approval step. Throws if the role may not sign it. */
export async function decideInvoice(bill, { decision, reason, user, role, orgId }) {
  const result = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'bills', bill.id);
    const fresh = await tx.get(ref);
    const approval = fresh.data()?.approval;
    if (!approval) throw new Error('This invoice has not been validated yet.');
    const updated = decide(approval, { role, decision, reason, by: user.uid, byName: user.name });
    const patch = { approval: updated };
    if (updated.status === 'rejected') { patch.status = 'rejected'; patch.reviewStatus = 'rejected'; }
    tx.update(ref, patch);
    return { before: approval, after: updated };
  });

  const step = result.before.steps.find(s => s.status === 'pending');
  await logAudit({
    action: decision === 'approve' ? 'INVOICE_APPROVED' : 'INVOICE_REJECTED',
    entityType: 'invoice', entityId: bill.id, entityLabel: label(bill), orgId,
    previous: { status: result.before.status, step: step.role },
    next: { status: result.after.status, signedAs: ROLE_LABELS[role] },
    reason: reason || null, meta: { amount: bill.amount }
  });

  if (result.after.status === 'approved') {
    await logAudit({ action: 'INVOICE_FULLY_APPROVED', entityType: 'invoice', entityId: bill.id, entityLabel: label(bill), orgId, meta: { amount: bill.amount } });
    await notify({ orgId, roles: ['finance_manager', 'admin'], userIds: [bill.supplierId] }, {
      kind: 'approval_completed', severity: 'info', title: `Invoice ${label(bill)} approved`,
      message: `All approvals are complete for ${money(bill.amount)}. It can now be paid.`,
      entityType: 'invoice', entityId: bill.id, link: '/my-orders'
    });
  } else if (result.after.status === 'rejected') {
    await notify({ orgId, roles: ['procurement_officer', 'procurement_manager', 'admin'], userIds: [bill.supplierId] }, {
      kind: 'approval_rejected', severity: 'high', title: `Invoice ${label(bill)} rejected`,
      message: `Reason: ${reason}`, entityType: 'invoice', entityId: bill.id, link: '/approvals'
    });
  } else {
    await notify({ orgId, roles: [result.after.nextRole] }, {
      kind: 'approval_required', severity: 'medium', title: 'Invoice needs your approval',
      message: `${label(bill)} · ${money(bill.amount)} was approved by ${ROLE_LABELS[role]} and now needs ${ROLE_LABELS[result.after.nextRole]}.`,
      entityType: 'invoice', entityId: bill.id, link: '/approvals'
    });
  }
  return result.after;
}
