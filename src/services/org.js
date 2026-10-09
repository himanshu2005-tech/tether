// Organisations, team members, invitations and settings.
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_APPROVAL_SETTINGS } from '../constants/approvals';
import { STAFF_ROLES } from '../security/roles';

// Invitations are keyed by email so a new account can be matched to its invite
export const inviteId = (email) => String(email || '').trim().toLowerCase();

export async function getSettings(orgId) {
  const snap = await getDoc(doc(db, 'settings', orgId)).catch(() => null);
  const saved = snap?.exists() ? snap.data() : {};
  return { approvals: saved.approvals?.tiers?.length ? saved.approvals : DEFAULT_APPROVAL_SETTINGS };
}

export async function saveApprovalSettings(orgId, approvals, uid) {
  await setDoc(doc(db, 'settings', orgId), { approvals, updatedAt: serverTimestamp(), updatedBy: uid }, { merge: true });
}

export async function listMembers(orgId) {
  const snap = await getDocs(query(collection(db, 'users'), where('orgId', '==', orgId)));
  const members = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  if (!members.some(m => m.uid === orgId)) {
    const owner = await getDoc(doc(db, 'users', orgId));
    if (owner.exists()) members.unshift({ uid: orgId, ...owner.data(), staffRole: owner.data().staffRole || 'admin' });
  }
  return members;
}

export async function listInvites(orgId) {
  const snap = await getDocs(query(collection(db, 'invites'), where('orgId', '==', orgId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => i.status === 'pending');
}

export async function createInvite({ orgId, orgName, email, staffRole, invitedBy }) {
  if (!STAFF_ROLES.includes(staffRole)) throw new Error('Choose a role.');
  const id = inviteId(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) throw new Error('Enter a valid email address.');
  await setDoc(doc(db, 'invites', id), { orgId, orgName, email: id, staffRole, invitedBy, status: 'pending', createdAt: serverTimestamp() });
}

export const cancelInvite = (email) => deleteDoc(doc(db, 'invites', inviteId(email)));

export async function findInvite(email) {
  const snap = await getDoc(doc(db, 'invites', inviteId(email))).catch(() => null);
  return snap?.exists() && snap.data().status === 'pending' ? snap.data() : null;
}

export const setMemberRole = (uid, staffRole) => updateDoc(doc(db, 'users', uid), { staffRole });

// Older buyer accounts become the admin of their own organisation
export async function ensureOrgFields(uid, userData) {
  if (!userData || userData.role === 'supplier' || userData.orgId) return null;
  const patch = { orgId: uid, staffRole: userData.staffRole || 'admin' };
  await updateDoc(doc(db, 'users', uid), patch).catch(() => null);
  return patch;
}
