// Notifications. In-app notifications are stored in Firestore (one document per recipient so each
// person has their own read/unread state). Email is a pluggable channel: it stays off unless a
// server endpoint you control is configured, so no email provider key ever lives in this app.
import { collection, query, where, getDocs, getDoc, doc, writeBatch, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const SEVERITIES = ['info', 'low', 'medium', 'high'];

const EMAIL_WEBHOOK = process.env.REACT_APP_NOTIFY_WEBHOOK || null;

// Channels receive each notification after it is stored. Add SMS, Slack, etc. here.
const channels = [
  {
    name: 'email',
    enabled: () => Boolean(EMAIL_WEBHOOK),
    // Your server sends the email with its own provider credentials
    send: (recipients, n) => fetch(EMAIL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: recipients.map(r => r.email).filter(Boolean), title: n.title, message: n.message, severity: n.severity, link: n.link })
    })
  }
];

let sender = null;
export function setNotifySender(uid) { sender = uid; }

const safeDocs = (p) => p.then(s => s.docs).catch(() => []);

// Resolves the people a notification is for
async function recipients({ userIds = [], orgId, roles, industry }, includeSender) {
  const found = new Map();
  for (const id of userIds) found.set(id, { uid: id });

  if (orgId) {
    const members = await safeDocs(getDocs(query(collection(db, 'users'), where('orgId', '==', orgId))));
    members.forEach(d => {
      const u = d.data();
      const role = u.staffRole || 'admin';
      if (!roles || roles.includes(role) || role === 'admin') found.set(d.id, { uid: d.id, email: u.email });
    });
    // Accounts created before teams existed have no orgId field: the owner's uid is the org id
    if (!found.has(orgId)) {
      const owner = await getDoc(doc(db, 'users', orgId)).catch(() => null);
      if (owner?.exists() && owner.data().role !== 'supplier') found.set(orgId, { uid: orgId, email: owner.data().email });
    }
  }

  if (industry) {
    const suppliers = await safeDocs(getDocs(query(collection(db, 'users'), where('industries', 'array-contains', industry))));
    suppliers.forEach(d => found.set(d.id, { uid: d.id, email: d.data().email }));
  }
  // People don't need to be told about their own actions, except for automatic processes
  // (like invoice intake) that merely happen to run in their browser
  if (sender && !includeSender) found.delete(sender);
  return [...found.values()];
}

/**
 * to: { userIds?, orgId?, roles?, industry? }
 * n:  { title, message, severity, kind, entityType, entityId, link }
 * options.includeSender: also notify the signed-in user (for automatic, not personal, actions)
 */
export async function notify(to, n, { includeSender = false } = {}) {
  try {
    const people = await recipients(to, includeSender);
    if (!people.length) return;
    const batch = writeBatch(db);
    people.forEach(p => batch.set(doc(collection(db, 'notifications')), {
      userId: p.uid,
      orgId: to.orgId || null,
      title: n.title,
      message: n.message,
      severity: SEVERITIES.includes(n.severity) ? n.severity : 'info',
      kind: n.kind || null,
      entityType: n.entityType || null,
      entityId: n.entityId || null,
      link: n.link || null,
      read: false,
      createdBy: sender,
      createdAt: serverTimestamp()
    }));
    await batch.commit();
    channels.filter(c => c.enabled()).forEach(c => c.send(people, n).catch(err => console.warn(`${c.name} channel failed:`, err.message)));
  } catch (err) {
    console.warn('Notification failed:', err.message);
  }
}

export const markRead = (id) => updateDoc(doc(db, 'notifications', id), { read: true });

export async function markAllRead(items) {
  const batch = writeBatch(db);
  items.filter(n => !n.read).forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
  await batch.commit();
}
