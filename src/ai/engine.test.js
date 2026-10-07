import assert from 'assert';
import { analyzeBids, analyzeInvoice } from './engine';
import { IsolationForest } from './ml/isolationForest';

const contract = { title: 'Steel Q4', unit: 'tons', agreedUnitPrice: 500, maxQuantity: 100, quantityInvoiced: 0 };
const baseInvoice = { id: 'new', supplierId: 's1', consumerId: 'b1', productName: 'Steel Beams', unitCost: 500, quantityRequested: 20, extraCharges: 0, amount: 10000, description: '20 tons of Steel Beams', createdAtMs: Date.now() };

test('clean invoice is clear', () => {
  const r = analyzeInvoice({ contract, invoice: baseInvoice });
  assert.strictEqual(r.level, 'clear');
  assert.strictEqual(r.flags.length, 0);
});

test('price above contract is flagged with expected/actual', () => {
  const r = analyzeInvoice({ contract, invoice: { ...baseInvoice, unitCost: 650, amount: 13000 } });
  const f = r.flags.find(x => x.type === 'price_exceeded');
  assert.ok(f);
  assert.deepStrictEqual([f.evidence.expected, f.evidence.actual], [500, 650]);
  assert.strictEqual(r.estimatedLeakage, 3000);
});

test('quantity beyond contract is flagged', () => {
  const r = analyzeInvoice({ contract: { ...contract, quantityInvoiced: 90 }, invoice: baseInvoice });
  assert.ok(r.flags.some(x => x.type === 'quantity_exceeded'));
});

test('resubmitted invoice with a different ID is caught as duplicate', () => {
  const past = [{ ...baseInvoice, id: 'old-123', createdAtMs: Date.now() - 2 * 86400000, status: 'paid' }];
  const r = analyzeInvoice({ contract, invoice: { ...baseInvoice, description: '20 tons of steel beams (re-sent)' }, pastInvoices: past });
  const f = r.flags.find(x => x.type === 'possible_duplicate');
  assert.ok(f, 'duplicate should be flagged');
  assert.strictEqual(f.evidence.matchedInvoiceId, 'old-123');
});

test('extra charges forbidden by extracted terms', () => {
  const r = analyzeInvoice({ contract: { ...contract, extractedTerms: { extraChargesAllowed: false } }, invoice: { ...baseInvoice, extraCharges: 800, amount: 10800 } });
  assert.ok(r.flags.some(x => x.type === 'extra_charges_not_allowed'));
});

test('supplier sharing bank account with buyer is a conflict', () => {
  const r = analyzeInvoice({ contract, invoice: baseInvoice, supplierProfile: { bankAccount: 'HDFC 1234-5678' }, buyerProfile: { bankAccount: 'hdfc12345678' } });
  assert.ok(r.flags.some(x => x.type === 'buyer_conflict'));
});

test('isolation forest scores an outlier higher than normal points', () => {
  const rows = Array.from({ length: 60 }, (_, i) => [10 + (i % 5) * 0.1, 1, 0, 3]);
  const forest = new IsolationForest().fit(rows);
  assert.ok(forest.score([15, 1.4, 0.3, 5]) > forest.score([10.2, 1, 0, 3]));
});

test('bid analysis catches copied proposals and linked bidders', () => {
  const proposal = 'We supply ISO certified steel beams with free delivery warranty of two years and payment within thirty days';
  const r = analyzeBids({
    tender: { title: 'Steel', productName: 'Steel Beams', quantity: 100, unit: 'tons', maxUnitPrice: 600 },
    bids: [
      { id: 'a', supplierId: 'A', supplierName: 'Alpha', unitPrice: 520, quantity: 100, deliveryDays: 10, proposal },
      { id: 'b', supplierId: 'B', supplierName: 'Beta', unitPrice: 540, quantity: 100, deliveryDays: 10, proposal: proposal + ' guaranteed' },
      { id: 'c', supplierId: 'C', supplierName: 'Gamma', unitPrice: 510, quantity: 100, deliveryDays: 12, proposal: 'Local mill, own trucks, delivery in two weeks, quality tested per batch.' }
    ],
    profiles: { A: { address: '12 MG Road Chennai' }, B: { address: '12 MG Road, Chennai' }, C: {} }
  });
  const a = r.bids.find(b => b.bidId === 'a');
  assert.ok(a.flags.some(f => f.type === 'similar_proposals'));
  assert.ok(a.flags.some(f => f.type === 'linked_bidders'));
  assert.strictEqual(r.recommendedBidId, 'c');
});
