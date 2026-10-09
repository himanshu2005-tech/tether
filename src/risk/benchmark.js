// Price benchmarking from your own history (past contracts, past bids and paid invoices).
// No outside price data is used, and nothing is estimated: with fewer than MIN_SAMPLES prices
// the benchmark says so instead of producing numbers.

import { median } from '../ai/ml/stats';

export const MIN_SAMPLES = 3;
export const INSUFFICIENT = 'Insufficient historical data for reliable benchmarking.';

const round2 = (n) => Math.round(n * 100) / 100;
const pct = (value, base) => (base ? round2(((value - base) / base) * 100) : null);

// history: [{ price, source: 'contract'|'bid'|'invoice', label }]
export function benchmark(history = []) {
  const prices = history.map(h => Number(h.price)).filter(p => p > 0);
  if (prices.length < MIN_SAMPLES) {
    return { sufficient: false, samples: prices.length, message: INSUFFICIENT };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const sources = history.reduce((acc, h) => ({ ...acc, [h.source]: (acc[h.source] || 0) + 1 }), {});
  return {
    sufficient: true,
    samples: prices.length,
    sources,
    average: round2(prices.reduce((s, p) => s + p, 0) / prices.length),
    median: round2(median(prices)),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

// Where a price sits against the benchmark
export function comparePrice(price, bm) {
  if (!bm?.sufficient) return { position: 'unknown', label: 'No benchmark', vsAverage: null, vsMedian: null };
  const vsAverage = pct(price, bm.average);
  const vsMedian = pct(price, bm.median);
  let position = 'normal';
  let label = 'Within historical range';
  if (price > bm.max) { position = 'above'; label = 'Above historical range'; }
  else if (price < bm.min) { position = 'below'; label = 'Below historical range'; }
  else if (vsAverage > 10) { position = 'high'; label = 'Higher than usual'; }
  else if (vsAverage < -10) { position = 'low'; label = 'Lower than usual'; }
  return { position, label, vsAverage, vsMedian };
}

// Collects history for one product from data the buyer can see, leaving out the current tender
export function historyFor(productName, { contracts = [], tenders = [], bids = [], bills = [] }, excludeTenderId) {
  const p = String(productName || '').toLowerCase();
  const same = (name) => String(name || '').toLowerCase() === p;
  const tenderProduct = Object.fromEntries(tenders.map(t => [t.id, t.productName]));
  return [
    ...contracts.filter(c => same(c.productName) && c.tenderId !== excludeTenderId)
      .map(c => ({ price: Number(c.agreedUnitPrice), source: 'contract', label: c.title })),
    ...bids.filter(b => b.tenderId !== excludeTenderId && same(tenderProduct[b.tenderId]))
      .map(b => ({ price: Number(b.unitPrice), source: 'bid', label: b.supplierName })),
    ...bills.filter(b => b.status === 'paid' && same(b.productName))
      .map(b => ({ price: Number(b.unitCost), source: 'invoice', label: b.productName }))
  ];
}
