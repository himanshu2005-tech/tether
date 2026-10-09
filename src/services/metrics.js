// Procurement metrics computed from live organisation data. Nothing here is estimated or sample
// data: every figure is a sum, count or average over records in Firestore, and an empty
// organisation produces zeros.
import { industryOf, industryName, tenderIndustry } from '../constants/products';
import { comparePrice } from '../risk/benchmark';

const DAY = 86400000;
const sum = (rows, f) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

export const contractValue = (c) => Number(c.agreedUnitPrice || 0) * Number(c.maxQuantity || 0);
const billLevel = (b) => (b.analysis ? b.analysis.level : 'unchecked');
const isDuplicateBill = (b) => (b.analysis?.flags || []).some(f => ['possible_duplicate', 'duplicate_invoice_number'].includes(f.type));
const billStatus = (b) => (b.status === 'paid' ? 'paid' : b.status === 'rejected' || b.approval?.status === 'rejected' ? 'rejected'
  : b.approval?.status === 'approved' ? 'approved' : 'pending');

/**
 * filters: { from, to (ms), supplierId, industry, riskLevel ('LOW'|'MEDIUM'|'HIGH'), status }
 */
export function filterData(data, insights, filters = {}) {
  const inRange = (r) => (!filters.from || r.createdAtMs >= filters.from) && (!filters.to || r.createdAtMs <= filters.to);
  const supplierOk = (sid) => (!filters.supplierId || sid === filters.supplierId)
    && (!filters.riskLevel || insights?.risks?.[sid]?.level === filters.riskLevel);
  const industryOk = (product, explicit) => !filters.industry || (explicit || industryOf(product)) === filters.industry;

  const tenders = data.tenders.filter(t => inRange(t) && industryOk(t.productName, t.industry)
    && (!filters.status || t.status === filters.status || !['open', 'closed', 'awarded'].includes(filters.status)));
  const tenderIds = new Set(data.tenders.filter(t => industryOk(t.productName, t.industry)).map(t => t.id));
  const contracts = data.contracts.filter(c => inRange(c) && supplierOk(c.supplierId) && industryOk(c.productName));
  const bids = data.bids.filter(b => inRange(b) && supplierOk(b.supplierId) && tenderIds.has(b.tenderId));
  const bills = data.bills.filter(b => inRange(b) && supplierOk(b.supplierId) && industryOk(b.productName)
    && (!filters.status || billStatus(b) === filters.status || ['open', 'closed', 'awarded'].includes(filters.status)));
  const alerts = (insights?.alerts || []).filter(a => a.status !== 'dismissed'
    && (!filters.supplierId || a.supplierIds?.includes(filters.supplierId)));
  return { tenders, contracts, bids, bills, alerts };
}

export function computeMetrics(data, insights, filters = {}) {
  const f = filterData(data, insights, filters);
  const risks = Object.values(insights?.risks || {}).filter(r => (!filters.supplierId || r.supplier.uid === filters.supplierId) && (!filters.riskLevel || r.level === filters.riskLevel));

  const flagged = f.bills.filter(b => b.analysis && b.analysis.level !== 'clear');
  const leakageDetected = sum(flagged, b => b.analysis.estimatedLeakage);
  // Prevented: flagged money that was rejected, or is still held and unpaid
  const leakagePrevented = sum(flagged.filter(b => billStatus(b) === 'rejected' || (b.status !== 'paid' && b.reviewStatus === 'pending_review')), b => b.analysis.estimatedLeakage);

  // Procurement cycle: tender posted → contract awarded
  const tenderTime = Object.fromEntries(data.tenders.map(t => [t.id, t.createdAtMs]));
  const cycles = f.contracts.map(c => (tenderTime[c.tenderId] && c.createdAtMs ? (c.createdAtMs - tenderTime[c.tenderId]) / DAY : null)).filter(v => v != null && v >= 0);

  const bidsPerTender = f.tenders.length ? f.bids.length / f.tenders.length : 0;

  // Price deviation of each bid from that tender's historical average (only where history exists)
  const deviations = f.bids.map(b => {
    const cmp = comparePrice(Number(b.unitPrice), data.benchmarks?.[b.tenderId]);
    return cmp.vsAverage == null ? null : { bid: b, pct: cmp.vsAverage };
  }).filter(Boolean);

  const supplierName = (id) => data.suppliers[id]?.companyName || data.suppliers[id]?.email || 'Unknown';
  const spendBy = (key) => {
    const m = {};
    f.bills.filter(b => b.status === 'paid').forEach(b => { const k = key(b); m[k] = (m[k] || 0) + Number(b.amount || 0); });
    return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  // Supplier performance: share of their invoices that passed AI checks without flags
  const performance = Object.entries(f.bills.reduce((m, b) => {
    const s = (m[b.supplierId] ||= { total: 0, clean: 0 });
    s.total += 1;
    if (b.analysis?.level === 'clear') s.clean += 1;
    return m;
  }, {})).map(([sid, s]) => ({ label: supplierName(sid), value: Math.round((s.clean / s.total) * 100), note: `${s.clean} of ${s.total} invoices clean` }))
    .sort((a, b) => b.value - a.value);

  const count = (rows, pred) => rows.filter(pred).length;

  return {
    filtered: f,
    kpis: {
      procurementValue: sum(f.contracts, contractValue),
      totalSpend: sum(f.bills.filter(b => b.status === 'paid'), b => b.amount),
      activeTenders: count(f.tenders, t => t.status === 'open'),
      totalTenders: f.tenders.length,
      completedTenders: count(f.tenders, t => t.status === 'awarded'),
      suppliers: risks.length,
      contracts: f.contracts.length,
      invoices: f.bills.length,
      pendingApprovals: count(f.bills, b => b.approval?.status === 'pending'),
      highRiskSuppliers: count(risks, r => r.level === 'HIGH'),
      averageSupplierRisk: risks.length ? Math.round(sum(risks, r => r.score) / risks.length) : 0,
      highRiskInvoices: count(f.bills, b => b.analysis?.level === 'hold'),
      leakageDetected,
      leakagePrevented,
      avgCycleDays: cycles.length ? Math.round((cycles.reduce((s, v) => s + v, 0) / cycles.length) * 10) / 10 : null,
      bidsPerTender: Math.round(bidsPerTender * 10) / 10,
      riskAlerts: f.alerts.length,
      invoicesApproved: count(f.bills, b => billStatus(b) === 'approved' || b.status === 'paid'),
      invoicesRejected: count(f.bills, b => billStatus(b) === 'rejected'),
      invoicesPending: count(f.bills, b => billStatus(b) === 'pending'),
      invoicesFlagged: flagged.length,
      duplicateInvoices: count(f.bills, isDuplicateBill)
    },
    supplierRisk: ['LOW', 'MEDIUM', 'HIGH'].map(l => ({ label: { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' }[l], value: count(risks, r => r.level === l), tone: { LOW: 'clear', MEDIUM: 'review', HIGH: 'hold' }[l] })),
    tenderStatus: [
      { label: 'Open', value: count(f.tenders, t => t.status === 'open'), tone: 'accent' },
      { label: 'Closed', value: count(f.tenders, t => t.status === 'closed'), tone: 'neutral' },
      { label: 'Awarded', value: count(f.tenders, t => t.status === 'awarded'), tone: 'clear' }
    ],
    invoiceRisk: [
      { label: 'Cleared', value: count(f.bills, b => billLevel(b) === 'clear'), tone: 'clear' },
      { label: 'Needs review', value: count(f.bills, b => billLevel(b) === 'review'), tone: 'review' },
      { label: 'On hold', value: count(f.bills, b => billLevel(b) === 'hold'), tone: 'hold' },
      { label: 'Not checked', value: count(f.bills, b => billLevel(b) === 'unchecked'), tone: 'neutral' }
    ],
    invoiceStatus: [
      { label: 'Approved / paid', value: count(f.bills, b => ['approved', 'paid'].includes(billStatus(b))), tone: 'clear' },
      { label: 'Pending', value: count(f.bills, b => billStatus(b) === 'pending'), tone: 'review' },
      { label: 'Rejected', value: count(f.bills, b => billStatus(b) === 'rejected'), tone: 'hold' }
    ],
    alertCategories: ['collusion', 'invoice', 'anomaly'].map(c => ({
      label: { collusion: 'Supplier collusion', invoice: 'Invoice fraud indicators', anomaly: 'Procurement anomalies' }[c],
      value: count(f.alerts, a => a.category === c)
    })),
    spendBySupplier: spendBy(b => supplierName(b.supplierId)),
    spendByCategory: spendBy(b => industryName(industryOf(b.productName))),
    performance,
    deviations,
    deviationByTender: Object.values(deviations.reduce((m, d) => {
      const t = data.tenders.find(x => x.id === d.bid.tenderId);
      const k = t?.title || 'Tender';
      (m[k] ||= { label: k, values: [] }).values.push(d.pct);
      return m;
    }, {})).map(x => ({ label: x.label, value: Math.round((x.values.reduce((s, v) => s + v, 0) / x.values.length) * 10) / 10 })),
    industryOfTender: tenderIndustry
  };
}
