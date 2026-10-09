/**
 * @jest-environment ./src/integration/nodeEnv.js
 *
 * Security rule tests, run against the local Firebase emulator with a "demo-" project
 * (it cannot reach production). Run with: npm run test:rules
 * Each test acts as a real signed-in user and checks what the rules allow and forbid.
 */
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection,
  getDocs, query, where, serverTimestamp, increment
} from 'firebase/firestore';
import { newApproval, decide } from '../constants/approvals';

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const suite = EMULATED ? describe : describe.skip;
const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const RUN = Date.now().toString(36);

const apps = [];
async function actor(name) {
  const app = initializeApp({ projectId: 'demo-tether', apiKey: 'demo-key', authDomain: 'demo-tether.firebaseapp.com' }, `${name}-${RUN}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, fsHost, Number(fsPort));
  const email = `${name}-${RUN}@test.local`;
  const cred = await createUserWithEmailAndPassword(auth, email, 'password123');
  return { db, uid: cred.user.uid, email };
}

const allowed = (p) => expect(p).resolves.not.toThrow();
const denied = (p) => expect(p).rejects.toMatchObject({ code: 'permission-denied' });

suite('Firestore security rules', () => {
  let admin, officer, manager, finance, supA, supB, outsider, orgId;
  let tenderId, contractId, billId;

  beforeAll(async () => {
    admin = await actor('admin');
    orgId = admin.uid;
    await setDoc(doc(admin.db, 'users', admin.uid), { email: admin.email, role: 'consumer', companyName: 'Buyer Co', orgId, staffRole: 'admin' });

    supA = await actor('supa');
    await setDoc(doc(supA.db, 'users', supA.uid), { email: supA.email, role: 'supplier', companyName: 'Alpha', orgId: supA.uid });
    supB = await actor('supb');
    await setDoc(doc(supB.db, 'users', supB.uid), { email: supB.email, role: 'supplier', companyName: 'Beta', orgId: supB.uid });
    outsider = await actor('outsider');
    await setDoc(doc(outsider.db, 'users', outsider.uid), { email: outsider.email, role: 'consumer', companyName: 'Other Buyer', orgId: outsider.uid, staffRole: 'admin' });

    // Team members join through invitations
    for (const [name, role] of [['officer', 'procurement_officer'], ['manager', 'procurement_manager'], ['finance', 'finance_manager']]) {
      const email = `${name}-${RUN}@test.local`;
      await setDoc(doc(admin.db, 'invites', email), { orgId, orgName: 'Buyer Co', email, staffRole: role, invitedBy: admin.uid, status: 'pending' });
    }
    officer = await actor('officer');
    await setDoc(doc(officer.db, 'users', officer.uid), { email: officer.email, role: 'consumer', orgId, staffRole: 'procurement_officer' });
    manager = await actor('manager');
    await setDoc(doc(manager.db, 'users', manager.uid), { email: manager.email, role: 'consumer', orgId, staffRole: 'procurement_manager' });
    finance = await actor('finance');
    await setDoc(doc(finance.db, 'users', finance.uid), { email: finance.email, role: 'consumer', orgId, staffRole: 'finance_manager' });
  }, 60000);

  afterAll(async () => { await Promise.all(apps.map(a => deleteApp(a))); });

  describe('accounts and roles', () => {
    test('nobody can join an organisation without an invitation', async () => {
      const intruder = await actor('intruder');
      await denied(setDoc(doc(intruder.db, 'users', intruder.uid), { email: intruder.email, role: 'consumer', orgId, staffRole: 'admin' }));
    });
    test('an invited member cannot pick a different role than the invite', async () => {
      const email = `sneaky-${RUN}@test.local`;
      await setDoc(doc(admin.db, 'invites', email), { orgId, orgName: 'Buyer Co', email, staffRole: 'procurement_officer', invitedBy: admin.uid, status: 'pending' });
      const sneaky = await actor('sneaky');
      await denied(setDoc(doc(sneaky.db, 'users', sneaky.uid), { email: sneaky.email, role: 'consumer', orgId, staffRole: 'finance_manager' }));
    });
    test('members cannot promote themselves', async () => {
      await denied(updateDoc(doc(officer.db, 'users', officer.uid), { staffRole: 'admin' }));
      await allowed(updateDoc(doc(officer.db, 'users', officer.uid), { displayName: 'Olivia' }));
    });
    test('only the admin can change a member role', async () => {
      await denied(updateDoc(doc(manager.db, 'users', officer.uid), { staffRole: 'finance_manager' }));
      await allowed(updateDoc(doc(admin.db, 'users', officer.uid), { staffRole: 'procurement_officer' }));
    });
    test('private KYC details are visible only to their owner', async () => {
      await allowed(setDoc(doc(supA.db, 'users', supA.uid, 'private', 'kyc'), { bankAccount: '123456789012', pan: 'AAPFU0939F' }));
      await allowed(getDoc(doc(supA.db, 'users', supA.uid, 'private', 'kyc')));
      await denied(getDoc(doc(supB.db, 'users', supA.uid, 'private', 'kyc')));
      await denied(getDoc(doc(admin.db, 'users', supA.uid, 'private', 'kyc')));
    });
    test('only the admin can read settings writes; staff can read them', async () => {
      await allowed(setDoc(doc(admin.db, 'settings', orgId), { approvals: { tiers: [{ upTo: 50000, levels: 1 }, { upTo: 500000, levels: 2 }, { upTo: null, levels: 3 }] } }));
      await denied(setDoc(doc(officer.db, 'settings', orgId), { approvals: { tiers: [{ upTo: null, levels: 1 }] } }));
      await allowed(getDoc(doc(finance.db, 'settings', orgId)));
      await denied(getDoc(doc(supA.db, 'settings', orgId)));
    });
  });

  describe('tenders, bids and contracts', () => {
    test('finance managers cannot create tenders; officers can', async () => {
      const t = { buyerId: orgId, title: 'Steel', productName: 'Steel Beams', quantity: 100, unit: 'tons', maxUnitPrice: 600, status: 'open', bidCount: 0 };
      await denied(addDoc(collection(finance.db, 'tenders'), t));
      const ref = await addDoc(collection(officer.db, 'tenders'), t);
      tenderId = ref.id;
      expect(tenderId).toBeTruthy();
    });
    test('a buyer cannot create a tender for another organisation', async () => {
      await denied(addDoc(collection(outsider.db, 'tenders'), { buyerId: orgId, title: 'x', status: 'open' }));
    });
    test('suppliers bid on open tenders, but cannot fake the buyer or edit their bid', async () => {
      const ref = await addDoc(collection(supA.db, 'bids'), { tenderId, buyerId: orgId, supplierId: supA.uid, unitPrice: 520, quantity: 100, status: 'submitted' });
      await denied(addDoc(collection(supA.db, 'bids'), { tenderId, buyerId: outsider.uid, supplierId: supA.uid, unitPrice: 1, status: 'submitted' }));
      await denied(updateDoc(doc(supA.db, 'bids', ref.id), { unitPrice: 400 }));
      await allowed(updateDoc(doc(supA.db, 'tenders', tenderId), { bidCount: increment(1) }));
      await denied(updateDoc(doc(supA.db, 'tenders', tenderId), { status: 'closed' }));
    });
    test('suppliers cannot read other suppliers bids; the buyer can', async () => {
      await denied(getDocs(query(collection(supB.db, 'bids'), where('tenderId', '==', tenderId))));
      const own = await getDocs(query(collection(admin.db, 'bids'), where('tenderId', '==', tenderId), where('buyerId', '==', orgId)));
      expect(own.size).toBe(1);
    });
    test('only managers or admins award contracts', async () => {
      await denied(updateDoc(doc(officer.db, 'tenders', tenderId), { status: 'awarded' }));
      await denied(addDoc(collection(officer.db, 'contracts'), { buyerId: orgId, supplierId: supA.uid }));
      const ref = await addDoc(collection(manager.db, 'contracts'), {
        tenderId, buyerId: orgId, supplierId: supA.uid, supplierName: 'Alpha', agreedUnitPrice: 520, maxQuantity: 100, quantityInvoiced: 0, status: 'active'
      });
      contractId = ref.id;
      await allowed(updateDoc(doc(manager.db, 'tenders', tenderId), { status: 'awarded', contractId }));
    });
    test('suppliers can only record invoiced quantities on their contract', async () => {
      await allowed(updateDoc(doc(supA.db, 'contracts', contractId), { quantityInvoiced: increment(20) }));
      await denied(updateDoc(doc(supA.db, 'contracts', contractId), { agreedUnitPrice: 900 }));
      await denied(getDoc(doc(supB.db, 'contracts', contractId)));
    });
  });

  describe('invoices and multi-level approval', () => {
    const amount = 200000; // medium value: officer then manager
    test('suppliers cannot send an invoice that is already approved', async () => {
      await denied(addDoc(collection(supA.db, 'bills'), {
        contractId, supplierId: supA.uid, consumerId: orgId, amount, status: 'unpaid', approval: { status: 'approved', steps: [] }
      }));
      const ref = await addDoc(collection(supA.db, 'bills'), {
        contractId, supplierId: supA.uid, consumerId: orgId, productName: 'Steel Beams', unitCost: 520, quantityRequested: 20,
        amount, status: 'unpaid', reviewStatus: 'awaiting_validation', createdAt: serverTimestamp()
      });
      billId = ref.id;
    });
    test('suppliers cannot change an invoice after sending; other buyers cannot see it', async () => {
      await denied(updateDoc(doc(supA.db, 'bills', billId), { reviewStatus: 'auto_cleared' }));
      await denied(getDoc(doc(outsider.db, 'bills', billId)));
      await denied(getDoc(doc(supB.db, 'bills', billId)));
    });
    test('buyer-side validation starts the approval chain', async () => {
      const approval = newApproval(amount);
      expect(approval.steps.map(s => s.role)).toEqual(['procurement_officer', 'procurement_manager']);
      await allowed(updateDoc(doc(officer.db, 'bills', billId), {
        analysis: { level: 'clear', riskScore: 0, flags: [] }, reviewStatus: 'auto_cleared', approval, validatedAt: serverTimestamp(), validatedBy: 'buyer'
      }));
    });
    test('payment is refused before all approvals', async () => {
      await denied(updateDoc(doc(finance.db, 'bills', billId), { status: 'paid', paidBy: finance.uid, paidAt: serverTimestamp() }));
    });
    test('only the role whose turn it is can sign', async () => {
      const current = (await getDoc(doc(officer.db, 'bills', billId))).data().approval;
      // The manager tries to sign the officer's step
      await denied(updateDoc(doc(manager.db, 'bills', billId), { approval: { ...current, status: 'pending', nextRole: 'procurement_manager' } }));
      await allowed(updateDoc(doc(officer.db, 'bills', billId), { approval: decide(current, { role: 'procurement_officer', decision: 'approve', by: officer.uid }) }));
      const after = (await getDoc(doc(officer.db, 'bills', billId))).data().approval;
      expect(after.nextRole).toBe('procurement_manager');
      await denied(updateDoc(doc(finance.db, 'bills', billId), { approval: decide(after, { role: 'admin', decision: 'approve', by: finance.uid }) }));
      await allowed(updateDoc(doc(manager.db, 'bills', billId), { approval: decide(after, { role: 'procurement_manager', decision: 'approve', by: manager.uid }) }));
    });
    test('after approval, only finance or admin can pay', async () => {
      await denied(updateDoc(doc(officer.db, 'bills', billId), { status: 'paid', paidBy: officer.uid, paidAt: serverTimestamp() }));
      await allowed(updateDoc(doc(finance.db, 'bills', billId), { status: 'paid', paidBy: finance.uid, paidAt: serverTimestamp() }));
    });
    test('rejection through the chain blocks the invoice', async () => {
      const ref = await addDoc(collection(supA.db, 'bills'), { contractId, supplierId: supA.uid, consumerId: orgId, amount: 1000, status: 'unpaid' });
      const approval = newApproval(1000);
      await updateDoc(doc(officer.db, 'bills', ref.id), { analysis: null, reviewStatus: 'unchecked', approval, validatedAt: serverTimestamp(), validatedBy: 'buyer' });
      const rejected = decide(approval, { role: 'procurement_officer', decision: 'reject', reason: 'Wrong price', by: officer.uid });
      await allowed(updateDoc(doc(officer.db, 'bills', ref.id), { approval: rejected, status: 'rejected', reviewStatus: 'rejected' }));
      await denied(updateDoc(doc(admin.db, 'bills', ref.id), { status: 'paid', paidBy: admin.uid, paidAt: serverTimestamp() }));
    });
  });

  describe('audit trail', () => {
    let logId;
    test('users write audit records only as themselves, with the server time', async () => {
      await denied(addDoc(collection(officer.db, 'auditLogs'), { orgId, userId: manager.uid, action: 'X', createdAt: serverTimestamp() }));
      await denied(addDoc(collection(officer.db, 'auditLogs'), { orgId, userId: officer.uid, action: 'X', createdAt: new Date(2020, 0, 1) }));
      const ref = await addDoc(collection(officer.db, 'auditLogs'), { orgId, userId: officer.uid, action: 'INVOICE_APPROVED', createdAt: serverTimestamp() });
      logId = ref.id;
      // Suppliers acting on the buyer's tenders log into the buyer's trail
      await allowed(addDoc(collection(supA.db, 'auditLogs'), { orgId, userId: supA.uid, action: 'BID_SUBMITTED', createdAt: serverTimestamp() }));
    });
    test('audit records cannot be changed or deleted, even by the admin', async () => {
      await denied(updateDoc(doc(admin.db, 'auditLogs', logId), { action: 'NOTHING' }));
      await denied(deleteDoc(doc(admin.db, 'auditLogs', logId)));
    });
    test('only managers of the organisation can read the audit trail', async () => {
      const q = (db) => getDocs(query(collection(db, 'auditLogs'), where('orgId', '==', orgId)));
      await denied(q(officer.db));
      await denied(q(supA.db));
      await denied(q(outsider.db));
      expect((await q(manager.db)).size).toBeGreaterThanOrEqual(2);
      expect((await q(finance.db)).size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('notifications and risk data', () => {
    test('people read and update only their own notifications', async () => {
      const ref = await addDoc(collection(officer.db, 'notifications'), { userId: manager.uid, title: 'Needs approval', severity: 'medium', read: false, createdBy: officer.uid });
      await allowed(getDoc(doc(manager.db, 'notifications', ref.id)));
      await denied(getDoc(doc(finance.db, 'notifications', ref.id)));
      await allowed(updateDoc(doc(manager.db, 'notifications', ref.id), { read: true }));
      await denied(updateDoc(doc(manager.db, 'notifications', ref.id), { title: 'changed' }));
    });
    test('fraud alerts and risk scores are private to the buyer organisation', async () => {
      await allowed(setDoc(doc(officer.db, 'fraudAlerts', `${orgId}__k1`), { orgId, key: 'k1', level: 'HIGH', status: 'open' }));
      await denied(getDoc(doc(supA.db, 'fraudAlerts', `${orgId}__k1`)));
      await denied(getDoc(doc(outsider.db, 'fraudAlerts', `${orgId}__k1`)));
      // Dismissing needs a manager
      await denied(updateDoc(doc(officer.db, 'fraudAlerts', `${orgId}__k1`), { status: 'dismissed' }));
      await allowed(updateDoc(doc(manager.db, 'fraudAlerts', `${orgId}__k1`), { status: 'dismissed', dismissReason: 'Checked' }));
      await allowed(setDoc(doc(officer.db, 'riskScores', `${orgId}__${supA.uid}`), { orgId, supplierId: supA.uid, score: 20, level: 'LOW' }));
      await denied(getDoc(doc(supA.db, 'riskScores', `${orgId}__${supA.uid}`)));
    });
  });
});

if (!EMULATED) {
  test('security rule tests need the emulator (run: npm run test:rules)', () => {});
}
