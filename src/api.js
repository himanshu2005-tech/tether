// AI features for the app. The analysis engine runs in the browser (src/ai/engine.js) and the
// language model is called directly through the Groq API (src/ai/llm.js); no separate server is needed.
import { db } from './firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import * as engine from './ai/engine';
import * as llm from './ai/llm';

export const extractTerms = (text) => llm.extractTerms(text);

const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : Date.now());

async function getProfile(uid) {
  if (!uid) return {};
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : {};
}

// Gathers everything the engine needs for a set of bids, then asks the server to analyze them
export async function analyzeTenderBids(tender, bids) {
  const supplierIds = [...new Set(bids.map(b => b.supplierId))];
  const [profilesList, buyerProfile, marketSnap, ...billSnaps] = await Promise.all([
    Promise.all(supplierIds.map(getProfile)),
    getProfile(tender.buyerId),
    getDocs(query(collection(db, 'contracts'), where('productName', '==', tender.productName))).catch(() => ({ docs: [] })),
    ...supplierIds.map(id => getDocs(query(collection(db, 'bills'), where('supplierId', '==', id))))
  ]);

  const profiles = Object.fromEntries(supplierIds.map((id, i) => [id, profilesList[i]]));
  const marketPrices = marketSnap.docs.map(d => d.data()).filter(c => c.tenderId !== tender.id).map(c => Number(c.agreedUnitPrice));
  const supplierHistory = Object.fromEntries(supplierIds.map((id, i) => {
    const bills = billSnaps[i].docs.map(d => d.data()).filter(b => b.analysis);
    return [id, { invoices: bills.length, flagged: bills.filter(b => b.analysis.level !== 'clear').length }];
  }));

  const input = {
    tender,
    bids: bids.map(b => ({ id: b.id, supplierId: b.supplierId, supplierName: b.supplierName, unitPrice: b.unitPrice, quantity: b.quantity, deliveryDays: b.deliveryDays, proposal: b.proposal || '' })),
    marketPrices,
    profiles,
    buyerProfile,
    supplierHistory
  };
  const result = engine.analyzeBids(input);
  result.summary = await llm.explainBids(result, tender);
  return result;
}

function serializeBill(b) {
  return {
    id: b.id,
    supplierId: b.supplierId,
    consumerId: b.consumerId,
    productName: b.productName,
    unitCost: Number(b.unitCost),
    quantityRequested: Number(b.quantityRequested),
    extraCharges: Number(b.extraCharges || 0),
    amount: Number(b.amount),
    description: b.description || '',
    status: b.status,
    createdAtMs: toMs(b.createdAt)
  };
}

// invoice: the bill about to be created (or an existing one being re-scanned)
export async function analyzeInvoice(contract, invoice) {
  const [pastSnap, supplierProfile, buyerProfile] = await Promise.all([
    getDocs(query(collection(db, 'bills'), where('consumerId', '==', invoice.consumerId))),
    getProfile(invoice.supplierId),
    getProfile(invoice.consumerId)
  ]);
  const pastInvoices = pastSnap.docs.map(d => serializeBill({ id: d.id, ...d.data() }));
  const result = engine.analyzeInvoice({
    contract,
    invoice: serializeBill(invoice),
    pastInvoices,
    supplierProfile,
    buyerProfile
  });
  result.summary = await llm.explainInvoice(result, contract);
  return result;
}

export const LEVEL_LABEL = {
  clear: 'AI check passed',
  review: 'Needs review',
  hold: 'Payment on hold'
};

// ─── Assistive AI ──────────────────────────────────────────────────────────────

export const draftTender = (text, products) => llm.draftTender(text, products);

export async function getBidGuidance(tender, companyDescription) {
  // Past contracts may not be readable under strict security rules; guidance then falls back to the budget
  const snap = await getDocs(query(collection(db, 'contracts'), where('productName', '==', tender.productName))).catch(() => ({ docs: [] }));
  const marketPrices = snap.docs.map(d => Number(d.data().agreedUnitPrice));
  return llm.bidGuidance({
    tender: { title: tender.title, productName: tender.productName, quantity: tender.quantity, unit: tender.unit, maxUnitPrice: tender.maxUnitPrice, deliveryBy: tender.deliveryBy, terms: tender.terms },
    marketPrices,
    companyDescription
  });
}

export const getBriefing = (role, name, facts) => llm.briefing({ role, name, facts });
