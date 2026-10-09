// Append-only audit log. Every important action writes one record; the app never edits or deletes
// them, and the Firestore rules forbid updates and deletes.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export const AUDIT_ACTIONS = {
  USER_LOGIN: 'User signed in',
  USER_REGISTERED: 'Account registered',
  TEAM_MEMBER_INVITED: 'Team member invited',
  TEAM_MEMBER_JOINED: 'Team member joined',
  TEAM_ROLE_CHANGED: 'Team role changed',
  KYC_SUBMITTED: 'KYC submitted',
  SUPPLIER_VERIFIED: 'Supplier verification result',
  SUPPLIER_STATUS_CHANGED: 'Supplier status changed',
  RISK_SCORE_CHANGED: 'Supplier risk score changed',
  TENDER_CREATED: 'Tender created',
  TENDER_MODIFIED: 'Tender modified',
  BID_SUBMITTED: 'Bid submitted',
  BID_EVALUATED: 'Bids evaluated by AI',
  CONTRACT_CREATED: 'Contract created',
  CONTRACT_MODIFIED: 'Contract modified',
  INVOICE_UPLOADED: 'Invoice uploaded',
  OCR_EXTRACTED: 'Invoice read by OCR',
  INVOICE_VALIDATED: 'Invoice validated by AI',
  INVOICE_APPROVED: 'Invoice approval step signed',
  INVOICE_REJECTED: 'Invoice rejected',
  INVOICE_FULLY_APPROVED: 'Invoice fully approved',
  RISK_REVIEW_DECISION: 'AI flag reviewed',
  PAYMENT_COMPLETED: 'Payment completed',
  FRAUD_FLAG_RAISED: 'Suspicious pattern detected',
  FRAUD_FLAG_DISMISSED: 'Suspicious pattern dismissed',
  SETTINGS_CHANGED: 'Approval settings changed',
  REPORT_EXPORTED: 'Audit report exported'
};

// The signed-in user, set once by AuthContext so callers only describe the action
let actor = null;
export function setAuditActor(a) { actor = a; }

/**
 * orgId: the buyer organisation the record belongs to (suppliers acting on a buyer's tender log
 * into that buyer's trail). Defaults to the actor's own organisation.
 */
export async function logAudit({ action, entityType = null, entityId = null, entityLabel = null, orgId, previous = null, next = null, reason = null, meta = null }) {
  if (!actor?.uid) return;
  try {
    await addDoc(collection(db, 'auditLogs'), {
      orgId: orgId || actor.orgId,
      userId: actor.uid,
      userName: actor.name || null,
      userRole: actor.role || null,
      action,
      entityType, entityId, entityLabel,
      previous, next, reason, meta,
      createdAt: serverTimestamp(),
      clientTime: new Date().toISOString()
    });
  } catch (err) {
    // An audit failure must never block the business action, but it should be visible
    console.warn(`Audit log failed for ${action}:`, err.message);
  }
}
