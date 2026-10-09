// Suspicious-pattern detection across tenders, bids, invoices and suppliers.
//
// This reuses what the AI engine already produces (TF-IDF proposal similarity, price clustering,
// linked-bidder checks, duplicate and anomaly flags on invoices) and adds cross-record patterns
// such as repeated co-bidding or one supplier winning most contracts.
//
// A pattern is a reason to look closer, never proof: alerts say "Suspicious pattern detected".

import { findDuplicates } from './kyc';
import { comparePrice } from './benchmark';

export const LEVEL_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const shortId = (id) => String(id).substring(0, 8).toUpperCase();

/**
 * data: { tenders, bids, bills, contracts, suppliers: { [uid]: profile }, benchmarks: { [tenderId]: bm } }
 * Returns alerts: { key, category, type, level, title, reasons[], entities[], supplierIds[] }
 */
export function detectPatterns({ tenders = [], bids = [], bills = [], contracts = [], suppliers = {}, benchmarks = {} }) {
  const alerts = [];
  const nameOf = (uid) => suppliers[uid]?.companyName || suppliers[uid]?.email || 'Unknown supplier';
  const push = (a) => alerts.push(a);

  // ── Supplier collusion: shared identity between suppliers who deal with you ──
  const uids = Object.keys(suppliers);
  for (let i = 0; i < uids.length; i++) {
    for (let j = i + 1; j < uids.length; j++) {
      const a = suppliers[uids[i]], b = suppliers[uids[j]];
      if (!a?.kyc?.identity || !b?.kyc?.identity) continue;
      const shared = findDuplicates(a.kyc.identity, [{ uid: uids[j], name: nameOf(uids[j]), identity: b.kyc.identity }]);
      if (!shared.length) continue;
      const strong = shared.some(s => s.kind === 'bank' || s.kind === 'identity');
      push({
        key: `rel_${[uids[i], uids[j]].sort().join('_')}`,
        category: 'collusion', type: 'shared_identity',
        level: strong || shared.length >= 3 ? 'HIGH' : 'MEDIUM',
        title: 'Suspicious supplier relationship',
        reasons: [`${nameOf(uids[i])} and ${nameOf(uids[j])} share:`, ...shared.map(s => `• ${s.field[0].toUpperCase()}${s.field.slice(1)}`)],
        entities: [{ type: 'supplier', id: uids[i] }, { type: 'supplier', id: uids[j] }],
        supplierIds: [uids[i], uids[j]]
      });
    }
  }

  // ── Bid-level patterns the engine already found, per tender ──
  tenders.forEach(t => {
    const ai = t.aiAnalysis;
    if (!ai) return;
    const supplierOfBid = Object.fromEntries(bids.filter(b => b.tenderId === t.id).map(b => [b.id, b.supplierId]));
    (ai.tenderFlags || []).forEach(f => {
      if (f.type !== 'price_clustering') return;
      push({
        key: `cluster_${t.id}`, category: 'collusion', type: 'close_prices', level: 'MEDIUM',
        title: 'Unusually close bid prices',
        reasons: [`On "${t.title}": ${f.detail}`],
        entities: [{ type: 'tender', id: t.id }], supplierIds: Object.values(supplierOfBid)
      });
    });
    const seen = new Set();
    (ai.bids || []).forEach(r => (r.flags || []).forEach(f => {
      const sid = supplierOfBid[r.bidId];
      if (f.type === 'similar_proposals' || f.type === 'linked_bidders') {
        const pair = [r.supplierName, f.evidence?.otherSupplier].sort().join('|');
        if (seen.has(f.type + pair)) return;
        seen.add(f.type + pair);
        push({
          key: `${f.type}_${t.id}_${pair}`, category: f.type === 'similar_proposals' ? 'anomaly' : 'collusion',
          type: f.type, level: f.type === 'linked_bidders' || f.severity === 'high' ? 'HIGH' : 'MEDIUM',
          title: f.type === 'similar_proposals' ? 'Suspiciously similar proposal text' : 'Bidders linked to each other',
          reasons: [`On "${t.title}": ${f.detail}`],
          entities: [{ type: 'tender', id: t.id }], supplierIds: [sid].filter(Boolean)
        });
      }
      if (f.type === 'buyer_conflict') {
        push({
          key: `conflict_${t.id}_${r.bidId}`, category: 'collusion', type: 'buyer_conflict', level: 'HIGH',
          title: 'Bidder linked to your company',
          reasons: [`${r.supplierName} on "${t.title}": ${f.detail}`],
          entities: [{ type: 'tender', id: t.id }], supplierIds: [sid].filter(Boolean)
        });
      }
    }));
  });

  // ── Repeated co-bidding: the same pair of suppliers bidding together again and again ──
  const tendersBy = {};
  bids.forEach(b => { (tendersBy[b.tenderId] ||= new Set()).add(b.supplierId); });
  const pairCount = {};
  Object.values(tendersBy).forEach(set => {
    const list = [...set].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const k = `${list[i]}_${list[j]}`;
      pairCount[k] = (pairCount[k] || 0) + 1;
    }
  });
  Object.entries(pairCount).forEach(([k, n]) => {
    if (n < 3) return;
    const [a, b] = k.split('_');
    push({
      key: `cobid_${k}`, category: 'collusion', type: 'repeated_cobidding', level: 'LOW',
      title: 'Repeated bidding pattern',
      reasons: [`${nameOf(a)} and ${nameOf(b)} have bid against each other on ${n} tenders. Rotating "competitors" can be a sign of bid rigging.`],
      entities: [], supplierIds: [a, b]
    });
  });

  // ── Price anomalies against your own history ──
  bids.forEach(b => {
    const bm = benchmarks[b.tenderId];
    const cmp = comparePrice(Number(b.unitPrice), bm);
    if (cmp.vsAverage != null && cmp.vsAverage >= 25) {
      const t = tenders.find(x => x.id === b.tenderId);
      push({
        key: `highbid_${b.id}`, category: 'anomaly', type: 'high_bid', level: cmp.vsAverage >= 50 ? 'HIGH' : 'MEDIUM',
        title: 'Unusually high bid',
        reasons: [`${b.supplierName} bid ${money(b.unitPrice)} per unit on "${t?.title || 'a tender'}", ${cmp.vsAverage}% above your historical average of ${money(bm.average)}.`],
        entities: [{ type: 'tender', id: b.tenderId }], supplierIds: [b.supplierId]
      });
    }
  });

  // ── Repeated supplier selection ──
  if (contracts.length >= 4) {
    const wins = {};
    contracts.forEach(c => { wins[c.supplierId] = (wins[c.supplierId] || 0) + 1; });
    Object.entries(wins).forEach(([sid, n]) => {
      const share = n / contracts.length;
      if (n >= 3 && share >= 0.6) {
        push({
          key: `selection_${sid}`, category: 'anomaly', type: 'repeated_selection', level: 'LOW',
          title: 'Same supplier keeps winning',
          reasons: [`${nameOf(sid)} won ${n} of your ${contracts.length} contracts (${Math.round(share * 100)}%). Check that competition is genuine.`],
          entities: [], supplierIds: [sid]
        });
      }
    });
  }

  // ── Invoice patterns ──
  const INVOICE_TYPES = {
    possible_duplicate: ['Duplicate invoice', 'HIGH'],
    duplicate_invoice_number: ['Duplicate invoice number', 'HIGH'],
    price_exceeded: ['Invoice price above contract', 'HIGH'],
    quantity_exceeded: ['Invoice quantity above contract', 'HIGH'],
    extra_charges_not_allowed: ['Unexpected charges on invoice', 'MEDIUM'],
    extra_charges_exceeded: ['Unexpected charges on invoice', 'MEDIUM'],
    incorrect_tax: ['Incorrect GST on invoice', 'MEDIUM'],
    suspicious_invoice_number: ['Suspicious invoice number', 'LOW']
  };
  bills.forEach(b => (b.analysis?.flags || []).forEach(f => {
    const meta = INVOICE_TYPES[f.type];
    if (!meta) return;
    push({
      key: `inv_${f.type}_${b.id}`, category: 'invoice', type: f.type, level: meta[1],
      title: meta[0],
      reasons: [`Invoice #${b.invoiceNumber || shortId(b.id)} from ${nameOf(b.supplierId)} (${money(b.amount)}): ${f.detail}`],
      entities: [{ type: 'invoice', id: b.id }], supplierIds: [b.supplierId]
    });
  }));

  // Same supplier, same amount, within 30 days (not already caught as a duplicate)
  const bySupplier = {};
  bills.forEach(b => (bySupplier[b.supplierId] ||= []).push(b));
  Object.values(bySupplier).forEach(list => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (Number(a.amount) !== Number(b.amount)) continue;
      const days = Math.abs((a.createdAtMs || 0) - (b.createdAtMs || 0)) / 86400000;
      if (days > 30) continue;
      push({
        key: `sameamt_${[a.id, b.id].sort().join('_')}`, category: 'invoice', type: 'duplicate_amount', level: 'MEDIUM',
        title: 'Duplicate amount',
        reasons: [`${nameOf(a.supplierId)} sent two invoices for exactly ${money(a.amount)} ${Math.round(days)} day(s) apart.`],
        entities: [{ type: 'invoice', id: a.id }, { type: 'invoice', id: b.id }], supplierIds: [a.supplierId]
      });
    }
  });

  const unique = new Map();
  alerts.forEach(a => { if (!unique.has(a.key)) unique.set(a.key, a); });
  return [...unique.values()].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
