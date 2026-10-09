// Submits KYC / company identity details: private numbers to the owner-only document, comparable
// fingerprints and masked values to the public profile, with audit records and notifications.
import { doc, setDoc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { REQUIRED_FIELDS, scoreKyc, publicIdentity, findDuplicates, maskTail, clean } from '../risk/kyc';
import { loadAllSupplierIdentities } from './orgData';
import { logAudit } from './audit';
import { notify } from './notify';

/** Returns { kyc, publicFields } after saving. previousStatus: the KYC status before this submission. */
export async function submitKyc({ uid, form, isSupplier, previousStatus = null }) {
  const identity = await publicIdentity(form);
  const network = (await loadAllSupplierIdentities()).filter(n => n.uid !== uid && n.identity);
  const duplicates = findDuplicates(identity, network);
  const scored = scoreKyc(form, duplicates);
  const kyc = {
    status: isSupplier ? scored.status : null,
    score: isSupplier ? scored.score : null,
    checks: isSupplier ? scored.checks : null,
    duplicates: duplicates.map(d => ({ field: d.field, kind: d.kind, otherUid: d.otherUid, otherName: d.otherName })),
    identity,
    masked: { pan: maskTail(form.pan, 2), bankAccount: maskTail(form.bankAccount), ifsc: clean(form.ifsc).slice(0, 4) },
    submittedAt: new Date().toISOString()
  };

  // Sensitive numbers live in a private document only this account can read
  await setDoc(doc(db, 'users', uid, 'private', 'kyc'), {
    gstin: clean(form.gstin), pan: clean(form.pan), bankAccount: String(form.bankAccount || '').replace(/\s/g, ''), ifsc: clean(form.ifsc),
    phone: form.phone || '', email: form.email || '', updatedAt: serverTimestamp()
  });
  const publicFields = {
    companyName: String(form.companyName || '').trim(), address: String(form.address || '').trim(),
    directors: String(form.directors || '').trim(), keyPeople: String(form.directors || '').trim(),
    gstin: clean(form.gstin), contactEmail: String(form.email || '').trim(), phone: maskTail(form.phone, 4), kyc
  };
  // Older versions stored the bank account on the public profile; remove it
  await updateDoc(doc(db, 'users', uid), { ...publicFields, bankAccount: deleteField(), pan: deleteField() });

  await logAudit({ action: 'KYC_SUBMITTED', entityType: isSupplier ? 'supplier' : 'organisation', entityId: uid, entityLabel: publicFields.companyName,
    next: { fieldsProvided: REQUIRED_FIELDS.filter(([k]) => String(form[k] || '').trim()).length } });
  if (isSupplier) {
    await logAudit({ action: 'SUPPLIER_VERIFIED', entityType: 'supplier', entityId: uid, entityLabel: publicFields.companyName,
      previous: previousStatus ? { status: previousStatus } : null, next: { status: kyc.status, score: kyc.score, duplicates: kyc.duplicates.map(d => d.field) } });
    if (previousStatus && previousStatus !== kyc.status) {
      await logAudit({ action: 'SUPPLIER_STATUS_CHANGED', entityType: 'supplier', entityId: uid, entityLabel: publicFields.companyName,
        previous: { status: previousStatus }, next: { status: kyc.status } });
    }
    if (kyc.status !== 'VERIFIED') {
      await notify({ userIds: [uid] }, {
        kind: 'kyc_review', severity: kyc.status === 'HIGH_RISK' ? 'high' : 'medium', title: 'KYC review required',
        message: `Your verification score is ${kyc.score}/100. Fix the items marked on the verification page to improve it.`,
        entityType: 'supplier', entityId: uid, link: '/verification'
      });
    }
  }
  return { kyc, publicFields };
}
