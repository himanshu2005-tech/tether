// Approval thresholds. These are the defaults; an organisation's admin can change them in
// Settings, which stores a copy in settings/{orgId}. Nothing else in the app hard-codes amounts.

export const APPROVAL_CHAIN = ['procurement_officer', 'procurement_manager', 'finance_manager'];

export const DEFAULT_APPROVAL_SETTINGS = {
  // Invoices up to `upTo` rupees need `levels` sign-offs, in APPROVAL_CHAIN order.
  // The last tier has upTo: null and covers everything above.
  tiers: [
    { upTo: 50000, levels: 1 },
    { upTo: 500000, levels: 2 },
    { upTo: null, levels: 3 }
  ]
};

export function levelsFor(amount, settings = DEFAULT_APPROVAL_SETTINGS) {
  const tiers = settings?.tiers?.length ? settings.tiers : DEFAULT_APPROVAL_SETTINGS.tiers;
  const tier = tiers.find(t => t.upTo == null || Number(amount) <= Number(t.upTo)) || tiers[tiers.length - 1];
  return Math.max(1, Math.min(APPROVAL_CHAIN.length, Number(tier.levels) || 1));
}

export function tierLabel(amount, settings) {
  const n = levelsFor(amount, settings);
  return n === 1 ? 'Low value' : n === 2 ? 'Medium value' : 'High value';
}

// Builds the approval record stored on an invoice
export function newApproval(amount, settings) {
  const levels = levelsFor(amount, settings);
  const steps = APPROVAL_CHAIN.slice(0, levels).map(role => ({ role, status: 'pending', by: null, byName: null, at: null, reason: null }));
  // nextRole lets the Firestore rules check who may sign without reading the steps list
  return { status: 'pending', tier: tierLabel(amount, settings), steps, nextRole: steps[0].role };
}

// The next step waiting for a decision, or null when the chain is finished
export const nextStep = (approval) => approval?.steps?.find(s => s.status === 'pending') || null;

// Applies a decision and returns the new approval record (does not mutate)
export function decide(approval, { role, decision, by, byName, reason, at = new Date().toISOString() }) {
  const step = nextStep(approval);
  if (!step) throw new Error('This invoice has no pending approval step.');
  if (role !== 'admin' && role !== step.role) throw new Error(`Only a ${step.role.replace(/_/g, ' ')} or an admin can sign this step.`);
  if (decision === 'reject' && !String(reason || '').trim()) throw new Error('A reason is required to reject.');
  const steps = approval.steps.map(s => s === step
    // Firestore rejects undefined values, so anything missing is stored as null
    ? { ...s, status: decision === 'approve' ? 'approved' : 'rejected', by: by ?? null, byName: byName ?? null, at, reason: reason || null, actingRole: role }
    : s);
  const status = decision === 'reject' ? 'rejected' : steps.every(s => s.status === 'approved') ? 'approved' : 'pending';
  const pending = steps.find(s => s.status === 'pending');
  return { ...approval, steps, status, nextRole: status === 'pending' && pending ? pending.role : null };
}
