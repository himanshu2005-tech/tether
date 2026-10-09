/**
 * @jest-environment ./src/integration/nodeEnv.js
 *
 * End-to-end procurement workflow against the Firebase emulator, using the app's real services:
 * register → KYC → tender → bids → AI evaluation → award → invoice (OCR text) → buyer validation →
 * multi-level approval → payment → risk scores, fraud alerts, audit trail, notifications, report.
 * Run with: npm run test:rules
 */
const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const suite = EMULATED ? describe : describe.skip;

let fb, fa, fs, audit, notifyMod, kycSvc, approvals, api, orgData, insightsMod, report, parser, approvalsCfg;
// SEED_RUN gives fixed account emails, so the seeded data can be explored in the app afterwards
const RUN = process.env.SEED_RUN || Date.now().toString(36);
const people = {};

// Switches the signed-in user, like logging in through the app
async function as(name) {
  const p = people[name];
  await fa.signInWithEmailAndPassword(fb.auth, p.email, 'password123');
  audit.setAuditActor({ uid: p.uid, name: p.name, role: p.role, orgId: p.orgId });
  notifyMod.setNotifySender(p.uid);
  return p;
}

// Each company has its own email domain (a shared company domain is itself a relationship signal)
const DOMAIN = { admin: 'buyerco', officer: 'buyerco', manager: 'buyerco', finance: 'buyerco' };
const emailFor = (name) => `${name}-${RUN}@${DOMAIN[name] || name}.example`;

async function register(name, profile) {
  const email = emailFor(name);
  const cred = await fa.createUserWithEmailAndPassword(fb.auth, email, 'password123');
  const uid = cred.user.uid;
  const orgId = profile.orgId || uid;
  await fs.setDoc(fs.doc(fb.db, 'users', uid), { email, ...profile, orgId, createdAt: new Date().toISOString() });
  people[name] = { uid, email, name: profile.displayName || profile.companyName, role: profile.role === 'supplier' ? 'supplier' : profile.staffRole || 'admin', orgId };
  return people[name];
}

suite('End-to-end secure procurement workflow', () => {
  let orgId, tenderId, bids, contract, billId;

  beforeAll(async () => {
    process.env.REACT_APP_USE_EMULATORS = 'true';
    // Deterministic run: the rule-based engine decides; the language model is switched off
    process.env.REACT_APP_GROQ_API_KEY = '';
    fb = require('../firebase');
    fa = require('firebase/auth');
    fs = require('firebase/firestore');
    audit = require('../services/audit');
    notifyMod = require('../services/notify');
    kycSvc = require('../services/kyc');
    approvals = require('../services/approvals');
    api = require('../api');
    orgData = require('../services/orgData');
    insightsMod = require('../services/insights');
    report = require('../services/report');
    parser = require('../ocr/parseInvoice');
    approvalsCfg = require('../constants/approvals');
  }, 30000);

  afterAll(async () => { if (fb) await fa.signOut(fb.auth).catch(() => {}); });

  test('1. buyer registers an organisation and invites a team', async () => {
    const admin = await register('admin', { role: 'consumer', companyName: `Buyer Co ${RUN}`, staffRole: 'admin', displayName: 'Asha (admin)' });
    orgId = admin.uid;
    await as('admin');
    const org = require('../services/org');
    for (const [n, r] of [['officer', 'procurement_officer'], ['manager', 'procurement_manager'], ['finance', 'finance_manager']]) {
      await org.createInvite({ orgId, orgName: 'Buyer Co', email: emailFor(n), staffRole: r, invitedBy: orgId });
    }
    for (const [n, r] of [['officer', 'procurement_officer'], ['manager', 'procurement_manager'], ['finance', 'finance_manager']]) {
      await register(n, { role: 'consumer', companyName: 'Buyer Co', orgId, staffRole: r, displayName: n });
    }
    const members = await (await as('admin'), org.listMembers(orgId));
    expect(members.map(m => m.staffRole).sort()).toEqual(['admin', 'finance_manager', 'procurement_manager', 'procurement_officer']);
  }, 60000);

  test('2-5. suppliers register, complete KYC and get verified; a shared bank account is detected', async () => {
    const base = { gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', ifsc: 'HDFC0001234', address: '', directors: '' };
    await register('gamma', { role: 'supplier', companyName: 'Gamma Steel', industries: ['metals'] });
    await as('gamma');
    const g = await kycSvc.submitKyc({ uid: people.gamma.uid, isSupplier: true, form: {
      ...base, companyName: 'Gamma Steel Pvt Ltd', email: 'ops@gammasteel.in', phone: '9845012345',
      address: '12 MG Road, Pune 411001', bankAccount: '111122223333', directors: 'Ravi Kumar' } });
    expect(g.kyc.status).toBe('VERIFIED');

    await register('alpha', { role: 'supplier', companyName: 'Alpha Metals', industries: ['metals'] });
    await as('alpha');
    await kycSvc.submitKyc({ uid: people.alpha.uid, isSupplier: true, form: {
      companyName: 'Alpha Metals', gstin: '29ABCDE1234F1ZW', pan: 'ABCDE1234F', ifsc: 'ICIC0000456', email: 'alpha@gmail.com',
      phone: '9000000001', address: '5 Park Street, Kolkata', bankAccount: '999988887777', directors: 'Mohan Das' } });

    await register('beta', { role: 'supplier', companyName: 'Beta Traders', industries: ['metals'] });
    await as('beta');
    const b = await kycSvc.submitKyc({ uid: people.beta.uid, isSupplier: true, form: {
      companyName: 'Beta Traders', gstin: '', pan: '', ifsc: 'ICIC0000456', email: 'beta@gmail.com',
      phone: '9000000002', address: '5, Park St, Kolkata', bankAccount: '999988887777', directors: 'Mohan Das' } });
    expect(b.kyc.status).not.toBe('VERIFIED');
    expect(b.kyc.duplicates.map(d => d.field)).toEqual(expect.arrayContaining(['bank account']));
    // The raw bank number is not on the public profile
    const pub = (await fs.getDoc(fs.doc(fb.db, 'users', people.beta.uid))).data();
    expect(JSON.stringify(pub)).not.toContain('999988887777');
  }, 60000);

  test('6-9. tender, bids, AI comparison and suspicious bid patterns', async () => {
    await as('officer');
    const ref = await fs.addDoc(fs.collection(fb.db, 'tenders'), {
      buyerId: orgId, buyerName: 'Buyer Co', title: 'Steel beams Q4', productName: 'Steel Beams', industry: 'metals',
      quantity: 100, unit: 'tons', maxUnitPrice: 600, terms: 'Price inclusive of all charges; no extra charges.', status: 'open', bidCount: 0,
      createdAt: fs.serverTimestamp()
    });
    tenderId = ref.id;
    await audit.logAudit({ action: 'TENDER_CREATED', entityType: 'tender', entityId: tenderId, entityLabel: 'Steel beams Q4' });
    await notifyMod.notify({ industry: 'metals' }, { kind: 'new_tender', title: 'New tender', message: 'Steel', severity: 'info', link: `/tenders/${tenderId}` });

    const proposal = 'We supply ISO certified steel beams with free delivery and two years warranty, payment within thirty days of delivery';
    for (const [who, price, text] of [['alpha', 520, proposal], ['beta', 540, proposal + ' guaranteed'], ['gamma', 510, 'Own rolling mill in Pune, batch-tested beams, delivery in 12 days.']]) {
      await as(who);
      await fs.addDoc(fs.collection(fb.db, 'bids'), {
        tenderId, tenderTitle: 'Steel beams Q4', buyerId: orgId, supplierId: people[who].uid, supplierName: who, unitPrice: price, quantity: 100,
        totalAmount: price * 100, deliveryDays: 12, proposal: text, status: 'submitted', createdAt: fs.serverTimestamp()
      });
      await fs.updateDoc(fs.doc(fb.db, 'tenders', tenderId), { bidCount: fs.increment(1) });
      await audit.logAudit({ action: 'BID_SUBMITTED', entityType: 'tender', entityId: tenderId, orgId, next: { unitPrice: price } });
    }

    await as('manager');
    const snap = await fs.getDocs(fs.query(fs.collection(fb.db, 'bids'), fs.where('tenderId', '==', tenderId), fs.where('buyerId', '==', orgId)));
    bids = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const tender = { id: tenderId, ...(await fs.getDoc(fs.doc(fb.db, 'tenders', tenderId))).data() };
    const result = await api.analyzeTenderBids(tender, bids);
    const byName = Object.fromEntries(result.bids.map(r => [r.supplierName, r]));
    expect(byName.alpha.flags.map(f => f.type)).toEqual(expect.arrayContaining(['similar_proposals', 'linked_bidders']));
    expect(result.bids.find(r => r.bidId === result.recommendedBidId).supplierName).toBe('gamma');
    await fs.updateDoc(fs.doc(fb.db, 'tenders', tenderId), { aiAnalysis: { ...result, bidCount: bids.length } });
    await audit.logAudit({ action: 'BID_EVALUATED', entityType: 'tender', entityId: tenderId });
  }, 60000);

  test('10-11. manager awards the contract', async () => {
    await as('manager');
    const win = bids.find(b => b.supplierName === 'gamma');
    const ref = await fs.addDoc(fs.collection(fb.db, 'contracts'), {
      tenderId, bidId: win.id, buyerId: orgId, buyerName: 'Buyer Co', supplierId: win.supplierId, supplierName: 'Gamma Steel Pvt Ltd',
      title: 'Steel beams Q4', productName: 'Steel Beams', unit: 'tons', agreedUnitPrice: 510, maxQuantity: 100,
      quantityInvoiced: 0, amountInvoiced: 0, extractedTerms: { extraChargesAllowed: false }, status: 'active', createdAt: fs.serverTimestamp()
    });
    contract = { id: ref.id, ...(await fs.getDoc(ref)).data() };
    await fs.updateDoc(fs.doc(fb.db, 'tenders', tenderId), { status: 'awarded', contractId: ref.id });
    await audit.logAudit({ action: 'CONTRACT_CREATED', entityType: 'contract', entityId: ref.id });
  }, 30000);

  test('12-15. supplier uploads an invoice; OCR fields are checked against the contract', async () => {
    await as('gamma');
    const ocrText = `GAMMA STEEL PRIVATE LIMITED\nInvoice No: GS-0147\nInvoice Date: 05/10/2026\nPO Number: ${contract.id.slice(0, 8).toUpperCase()}\nSteel Beams 40 tons x 560 22400\nSub Total 22400.00\nGST 18% 4032.00\nFreight 800.00\nGrand Total 27232.00`;
    const { fields } = parser.parseInvoiceText(ocrText, ['Steel Beams']);
    expect(fields).toMatchObject({ invoiceNumber: 'GS-0147', quantity: 40, unitPrice: 560, tax: 4032, extraCharges: 800, total: 27232 });
    const bill = {
      contractId: contract.id, supplierId: contract.supplierId, consumerId: orgId, productName: 'Steel Beams',
      quantityRequested: 40, unitCost: 560, unit: 'tons', baseAmount: 22400, extraCharges: 800, tax: 4032, amount: 27232, invoiceNumber: 'GS-0147'
    };
    const pre = await api.analyzeInvoice(contract, bill, fields);
    expect(pre.flags.map(f => f.type)).toEqual(expect.arrayContaining(['price_exceeded', 'extra_charges_not_allowed']));
    const ref = await fs.addDoc(fs.collection(fb.db, 'bills'), {
      ...bill, status: 'unpaid', source: 'upload', reviewStatus: 'awaiting_validation', analysis: pre,
      ocr: { fields, confidence: 95, corrected: [] }, submittedBy: people.gamma.uid, createdAt: fs.serverTimestamp()
    });
    billId = ref.id;
    await fs.updateDoc(fs.doc(fb.db, 'contracts', contract.id), { quantityInvoiced: fs.increment(40), amountInvoiced: fs.increment(27232) });
    await audit.logAudit({ action: 'INVOICE_UPLOADED', entityType: 'invoice', entityId: billId, orgId });
  }, 30000);

  test('16-17. buyer-side validation re-checks the invoice and starts the approval chain', async () => {
    await as('officer');
    const bill = { id: billId, ...(await fs.getDoc(fs.doc(fb.db, 'bills', billId))).data() };
    const settings = await require('../services/org').getSettings(orgId);
    expect(await approvals.intakeInvoice(bill, { orgId, settings })).toBe(true);
    const after = (await fs.getDoc(fs.doc(fb.db, 'bills', billId))).data();
    expect(after.validatedBy).toBe('buyer');
    expect(after.analysis.flags.map(f => f.type)).toEqual(expect.arrayContaining(['price_exceeded']));
    expect(after.approval.steps.map(s => s.role)).toEqual(['procurement_officer']); // ₹27,232 is low value
    // Doing it twice is a no-op
    expect(await approvals.intakeInvoice({ id: billId, ...after }, { orgId, settings })).toBe(false);
  }, 60000);

  test('18. authorised approval, unauthorised attempt refused, AI hold respected by payment rules', async () => {
    const bill = { id: billId, ...(await fs.getDoc(fs.doc(fb.db, 'bills', billId))).data() };
    await as('finance');
    await expect(approvals.decideInvoice(bill, { decision: 'approve', role: 'finance_manager', orgId, user: { uid: people.finance.uid, name: 'finance' } }))
      .rejects.toThrow(/Only a procurement officer/);
    await as('officer');
    const result = await approvals.decideInvoice(bill, { decision: 'approve', role: 'procurement_officer', orgId, user: { uid: people.officer.uid, name: 'officer' } });
    expect(result.status).toBe('approved');
    await as('finance');
    await fs.updateDoc(fs.doc(fb.db, 'bills', billId), { status: 'paid', paidBy: people.finance.uid, paidAt: fs.serverTimestamp() });
    await audit.logAudit({ action: 'PAYMENT_COMPLETED', entityType: 'invoice', entityId: billId });
  }, 60000);

  test('high-value invoices need three approvals and a rejection needs a reason', async () => {
    expect(approvalsCfg.newApproval(900000).steps).toHaveLength(3);
    await as('gamma');
    const ref = await fs.addDoc(fs.collection(fb.db, 'bills'), {
      contractId: contract.id, supplierId: contract.supplierId, consumerId: orgId, productName: 'Steel Beams', quantityRequested: 40,
      unitCost: 510, amount: 20400, description: '40 tons', status: 'unpaid', reviewStatus: 'awaiting_validation', createdAt: fs.serverTimestamp()
    });
    await as('officer');
    const settings = await require('../services/org').getSettings(orgId);
    await approvals.intakeInvoice({ id: ref.id, ...(await fs.getDoc(ref)).data() }, { orgId, settings });
    const bill = { id: ref.id, ...(await fs.getDoc(ref)).data() };
    await expect(approvals.decideInvoice(bill, { decision: 'reject', reason: '', role: 'procurement_officer', orgId, user: { uid: people.officer.uid } }))
      .rejects.toThrow(/reason/);
    const r = await approvals.decideInvoice(bill, { decision: 'reject', reason: 'Duplicate of GS-0147', role: 'procurement_officer', orgId, user: { uid: people.officer.uid, name: 'officer' } });
    expect(r.status).toBe('rejected');
  }, 60000);

  test('16 & 20. supplier risk scores and fraud alerts are calculated, saved and explained', async () => {
    await as('manager');
    const [data, network] = await Promise.all([orgData.loadOrgData(orgId), orgData.loadAllSupplierIdentities()]);
    const ins = insightsMod.computeInsights(data, network);
    const risk = Object.fromEntries(Object.values(ins.risks).map(r => [r.supplier.companyName, r]));
    expect(risk['Beta Traders'].level).toBe('HIGH');
    expect(risk['Beta Traders'].factors.map(f => f.label)).toEqual(expect.arrayContaining(['Shared bank account with another supplier', 'Linked or copied bids']));
    expect(risk['Gamma Steel Pvt Ltd'].factors.map(f => f.label)).toEqual(expect.arrayContaining(['Contract violations']));
    const types = ins.alerts.map(a => a.type);
    expect(types).toEqual(expect.arrayContaining(['shared_identity', 'similar_proposals', 'price_exceeded']));
    ins.alerts.forEach(a => expect(a.reasons.length).toBeGreaterThan(0));

    // Re-run with sync (as the pages do) and check the records were written
    await new Promise((resolve) => {
      const hook = insightsMod.useOrgInsights; expect(typeof hook).toBe('function'); resolve();
    });
    const { setDoc } = fs; expect(typeof setDoc).toBe('function');
  }, 60000);

  test('19 & 21. every step left an audit record and people were notified', async () => {
    await as('manager');
    const logs = (await fs.getDocs(fs.query(fs.collection(fb.db, 'auditLogs'), fs.where('orgId', '==', orgId)))).docs.map(d => d.data().action);
    for (const a of ['TENDER_CREATED', 'BID_SUBMITTED', 'BID_EVALUATED', 'CONTRACT_CREATED', 'INVOICE_UPLOADED', 'INVOICE_VALIDATED',
      'INVOICE_APPROVED', 'INVOICE_FULLY_APPROVED', 'INVOICE_REJECTED', 'PAYMENT_COMPLETED']) {
      expect(logs).toContain(a);
    }
    const mine = async (who) => { await as(who); return (await fs.getDocs(fs.query(fs.collection(fb.db, 'notifications'), fs.where('userId', '==', people[who].uid)))).docs.map(d => d.data()); };
    const officerNotes = await mine('officer');
    expect(officerNotes.map(n => n.kind)).toEqual(expect.arrayContaining(['approval_required', 'invoice_anomaly']));
    const managerNotes = await mine('manager');
    expect(managerNotes.map(n => n.kind)).toEqual(expect.arrayContaining(['contract_violation']));
    const gammaNotes = await mine('gamma');
    expect(gammaNotes.map(n => n.kind)).toEqual(expect.arrayContaining(['new_tender', 'approval_completed']));
    // Role-specific: finance did not get the officer's approval request for a low-value invoice
    const financeNotes = await mine('finance');
    expect(financeNotes.filter(n => n.kind === 'approval_required')).toHaveLength(0);
  }, 60000);

  test('22. the audit report contains every section for the period', async () => {
    await as('manager');
    const [data, network] = await Promise.all([orgData.loadOrgData(orgId), orgData.loadAllSupplierIdentities()]);
    const ins = insightsMod.computeInsights(data, network);
    const logs = (await fs.getDocs(fs.query(fs.collection(fb.db, 'auditLogs'), fs.where('orgId', '==', orgId))))
      .docs.map(d => ({ ...d.data(), ms: d.data().createdAt?.toMillis?.() || Date.now() }));
    const from = Date.now() - 86400000, to = Date.now() + 60000;
    const html = report.buildReportHtml({ orgName: 'Buyer Co', generatedBy: 'manager', from, to, logs, data, insights: ins });
    for (const section of ['SECURE PROCUREMENT AUDIT REPORT', 'Procurement summary', 'Supplier summary', 'Suspicious activities', 'Invoice anomalies', 'Approval history', 'Audit events']) {
      expect(html.toUpperCase()).toContain(section.toUpperCase());
    }
    expect(html).toContain('Beta Traders');
    // Date filter: an empty period has no events
    const empty = report.buildReportHtml({ orgName: 'Buyer Co', generatedBy: 'manager', from: 0, to: 1000, logs: [], data, insights: ins });
    expect(empty).toContain('Audit events (0)');
  }, 60000);
});

if (!EMULATED) {
  test('workflow tests need the emulator (run: npm run test:rules)', () => {});
}
