// Loads everything a buyer organisation can see, for the dashboard, analytics, supplier risk,
// fraud detection and the audit report. Queries use equality filters only, so no composite
// Firestore indexes are needed.
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { benchmark, historyFor } from '../risk/benchmark';

const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : ts ? Date.parse(ts) : 0);
const list = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
const safe = (p) => p.catch(err => { console.warn(err.message); return { docs: [] }; });

export async function loadOrgData(orgId) {
  const [tenders, bids, contracts, bills, alerts, scores] = await Promise.all([
    safe(getDocs(query(collection(db, 'tenders'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'bids'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'contracts'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'bills'), where('consumerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'fraudAlerts'), where('orgId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'riskScores'), where('orgId', '==', orgId))))
  ]).then(r => r.map(list));

  [tenders, bids, contracts, bills, alerts, scores].forEach(rows => rows.forEach(r => { r.createdAtMs = toMs(r.createdAt); }));

  // Suppliers this organisation has dealt with
  const supplierIds = [...new Set([...bids, ...contracts, ...bills].map(r => r.supplierId).filter(Boolean))];
  const profiles = await Promise.all(supplierIds.map(id => getDoc(doc(db, 'users', id)).catch(() => null)));
  const suppliers = Object.fromEntries(supplierIds.map((id, i) => [id, profiles[i]?.exists() ? { uid: id, ...profiles[i].data() } : { uid: id }]));

  // Price benchmarks per tender, from this organisation's own history
  const history = { contracts, tenders, bids, bills };
  const benchmarks = Object.fromEntries(tenders.map(t => [t.id, benchmark(historyFor(t.productName, history, t.id))]));

  return { orgId, tenders, bids, contracts, bills, alerts, scores, suppliers, benchmarks, loadedAt: Date.now() };
}

// Suppliers in the whole network, for duplicate checks (public profile fields only)
export async function loadAllSupplierIdentities() {
  const snap = await safe(getDocs(query(collection(db, 'users'), where('role', '==', 'supplier'))));
  return snap.docs.map(d => ({ uid: d.id, name: d.data().companyName || d.data().email, identity: d.data().kyc?.identity || null, profile: d.data() }));
}

// Past prices for one product from this organisation's own records (for benchmarking a tender)
export async function loadPriceHistory(orgId, productName, excludeTenderId) {
  const [tenders, bids, contracts, bills] = await Promise.all([
    safe(getDocs(query(collection(db, 'tenders'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'bids'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'contracts'), where('buyerId', '==', orgId)))),
    safe(getDocs(query(collection(db, 'bills'), where('consumerId', '==', orgId))))
  ]).then(r => r.map(list));
  return historyFor(productName, { tenders, bids, contracts, bills }, excludeTenderId);
}
