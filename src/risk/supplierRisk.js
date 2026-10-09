// Supplier risk score (0-100), rule-based and explainable.
//
// Every factor adds points and says why. Points are capped per factor so one repeated issue
// can't dominate, and the total is capped at 100.
//
//   Factor                          Points            Cap
//   KYC not submitted               15
//   KYC status Needs review         10
//   KYC status High risk            25
//   Shared identity (GSTIN/PAN)     20 each           25
//   Shared bank account             20                20
//   Shared contact / address /      6 each            12
//     directors / email domain
//   Abnormal bid pricing            8 per bid         16
//   Linked or copied bids           12 per bid        24
//   Questionable proposals          4 per bid         8
//   Contract violations on invoices 10 per invoice    25
//   Duplicate invoices              10 per invoice    20
//   Unusual invoices (ML anomaly)   6 per invoice     12
//   Rejected invoices               8 per invoice     16
//   Open suspicious-pattern alerts  10 per alert      20
//
//   0-29 LOW · 30-59 MEDIUM · 60-100 HIGH

export const RISK_LEVELS = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' };

export const riskLevel = (score) => (score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW');

const CONTRACT_FLAGS = ['price_exceeded', 'quantity_exceeded', 'extra_charges_not_allowed', 'extra_charges_exceeded',
  'incorrect_tax', 'contract_mismatch', 'supplier_mismatch'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * supplier: the supplier's public profile (with optional kyc {status, duplicates})
 * bidResults: per-bid AI results for this supplier, from tender.aiAnalysis.bids  ({ flags })
 * bills: this supplier's invoices seen by the buyer ({ analysis, reviewStatus, status })
 * alerts: open fraud alerts that involve this supplier
 */
// duplicates: relationships found by comparing this supplier with all others now (newer than the KYC
// submission, since another supplier may have registered the same details later)
export function scoreSupplier({ supplier = {}, bidResults = [], bills = [], alerts = [], duplicates = null }) {
  const factors = [];
  const add = (key, label, points, cap, detail) => {
    const p = Math.min(points, cap);
    if (p > 0) factors.push({ key, label, points: p, detail });
  };

  const kyc = supplier.kyc;
  if (!kyc) add('kyc', 'KYC not submitted', 15, 15, 'The supplier has not completed verification yet');
  else if (kyc.status === 'HIGH_RISK') add('kyc', 'KYC high risk', 25, 25, `KYC score ${kyc.score}/100`);
  else if (kyc.status === 'NEEDS_REVIEW') add('kyc', 'KYC needs review', 10, 10, `KYC score ${kyc.score}/100`);

  const dupes = duplicates || kyc?.duplicates || [];
  const ident = dupes.filter(d => d.kind === 'identity');
  const bank = dupes.filter(d => d.kind === 'bank');
  const rel = dupes.filter(d => d.kind === 'relationship');
  add('identity', 'Shared identity with another supplier', ident.length * 20, 25, ident.map(d => `${d.field} with ${d.otherName}`).join('; '));
  add('bank', 'Shared bank account with another supplier', bank.length ? 20 : 0, 20, bank.map(d => d.otherName).join(', '));
  add('relationship', 'Shared contact details', rel.length * 6, 12, rel.map(d => `${d.field} with ${d.otherName}`).join('; '));

  const bidFlags = (type) => bidResults.filter(r => (r.flags || []).some(f => (Array.isArray(type) ? type : [type]).includes(f.type)));
  const priced = bidFlags(['price_too_low', 'price_too_high']);
  add('pricing', 'Abnormal bid pricing', priced.length * 8, 16, `${plural(priced.length, 'bid')} far from the normal price`);
  const linked = bidFlags(['linked_bidders', 'similar_proposals']);
  add('collusion', 'Linked or copied bids', linked.length * 12, 24, `${plural(linked.length, 'bid')} linked to another bidder or with copied wording`);
  const weak = bidFlags('weak_proposal');
  add('proposal', 'Questionable proposals', weak.length * 4, 8, `${plural(weak.length, 'proposal')} raised questions in AI review`);

  const billFlags = (types) => bills.filter(b => (b.analysis?.flags || []).some(f => types.includes(f.type)));
  const violations = billFlags(CONTRACT_FLAGS);
  add('violations', 'Contract violations', violations.length * 10, 25, `${plural(violations.length, 'invoice')} broke the contract terms`);
  const dupBills = billFlags(['possible_duplicate', 'duplicate_invoice_number']);
  add('duplicates', 'Duplicate invoices', dupBills.length * 10, 20, `${plural(dupBills.length, 'invoice')} looked like repeats`);
  const anomalies = billFlags(['statistical_anomaly']);
  add('anomaly', 'Unusual invoices', anomalies.length * 6, 12, `${plural(anomalies.length, 'invoice')} flagged by the anomaly model`);
  const rejected = bills.filter(b => b.reviewStatus === 'rejected' || b.approval?.status === 'rejected');
  add('rejected', 'Rejected invoices', rejected.length * 8, 16, `${plural(rejected.length, 'invoice')} rejected by your team`);

  const open = alerts.filter(a => a.status !== 'dismissed');
  add('alerts', 'Suspicious patterns', open.length * 10, 20, open.map(a => a.title).slice(0, 3).join('; '));

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return { score, level: riskLevel(score), factors };
}
