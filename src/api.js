// AI features for the app. The analysis engine runs in the browser (src/ai/engine.js) and the
// language model is called directly through the Groq API (src/ai/llm.js); no separate server is needed.
import { db } from './firebase';
import { getAuth } from 'firebase/auth';
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
  // Market prices and invoice history come from this organisation's own records
  // (the security rules don't let a buyer read other buyers' contracts or invoices)
  const [profilesList, buyerProfile, marketSnap, billSnap] = await Promise.all([
    Promise.all(supplierIds.map(getProfile)),
    getProfile(tender.buyerId),
    getDocs(query(collection(db, 'contracts'), where('buyerId', '==', tender.buyerId))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, 'bills'), where('consumerId', '==', tender.buyerId))).catch(() => ({ docs: [] }))
  ]);

  const profiles = Object.fromEntries(supplierIds.map((id, i) => [id, profilesList[i]]));
  const marketPrices = marketSnap.docs.map(d => d.data())
    .filter(c => c.tenderId !== tender.id && String(c.productName).toLowerCase() === String(tender.productName).toLowerCase())
    .map(c => Number(c.agreedUnitPrice));
  const allBills = billSnap.docs.map(d => d.data()).filter(b => b.analysis);
  const supplierHistory = Object.fromEntries(supplierIds.map(id => {
    const bills = allBills.filter(b => b.supplierId === id);
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
  input.proposalReviews = await llm.reviewProposals(tender, input.bids);
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
    invoiceNumber: b.invoiceNumber || b.ocr?.fields?.invoiceNumber || null,
    createdAtMs: toMs(b.createdAt)
  };
}

// invoice: the bill about to be created (or an existing one being re-scanned)
// extracted: fields read from an uploaded invoice document (OCR), when there is one
export async function analyzeInvoice(contract, invoice, extracted = null) {
  // The buyer sees all its invoices; a supplier (running its own pre-check) may only read its own,
  // so it falls back to those. The buyer re-validates with the full history when the invoice arrives.
  const pastSnap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', invoice.consumerId)))
    .catch(() => getDocs(query(collection(db, 'bills'), where('supplierId', '==', invoice.supplierId))).catch(() => ({ docs: [] })));
  const [supplierProfile, buyerProfile] = await Promise.all([getProfile(invoice.supplierId), getProfile(invoice.consumerId)]);
  const pastInvoices = pastSnap.docs.map(d => serializeBill({ id: d.id, ...d.data() })).filter(b => b.consumerId === invoice.consumerId);
  const result = engine.analyzeInvoice({
    contract,
    invoice: serializeBill(invoice),
    pastInvoices,
    supplierProfile,
    buyerProfile,
    extracted
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
  // Suppliers can only read their own contracts, so guidance uses the prices this supplier has
  // agreed before for the same product; with too few, it falls back to the buyer's budget
  const uid = getAuth().currentUser?.uid;
  const snap = uid ? await getDocs(query(collection(db, 'contracts'), where('supplierId', '==', uid))).catch(() => ({ docs: [] })) : { docs: [] };
  const marketPrices = snap.docs.map(d => d.data())
    .filter(c => String(c.productName).toLowerCase() === String(tender.productName).toLowerCase())
    .map(c => Number(c.agreedUnitPrice));
  return llm.bidGuidance({
    tender: { title: tender.title, productName: tender.productName, quantity: tender.quantity, unit: tender.unit, maxUnitPrice: tender.maxUnitPrice, deliveryBy: tender.deliveryBy, terms: tender.terms },
    marketPrices,
    companyDescription
  });
}

export const getBriefing = (role, name, facts) => llm.briefing({ role, name, facts });
