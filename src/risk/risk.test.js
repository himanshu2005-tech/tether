import {
  validateGstin, validatePan, validateIfsc, validateEmail, validatePhone, normalizeCompany,
  publicIdentity, findDuplicates, scoreKyc
} from './kyc';
import { scoreSupplier, riskLevel } from './supplierRisk';
import { benchmark, comparePrice, historyFor, INSUFFICIENT } from './benchmark';
import { detectPatterns } from './fraud';
import { levelsFor, newApproval, decide, nextStep } from '../constants/approvals';
import { parseInvoiceText, arithmeticIssues } from '../ocr/parseInvoice';
import { analyzeInvoice } from '../ai/engine';

const GOOD = {
  companyName: 'Gamma Steel Private Limited', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', email: 'accounts@gammasteel.in',
  phone: '+91 98450 12345', address: '12 MG Road, Pune 411001', bankAccount: '123456789012', ifsc: 'HDFC0001234', directors: 'Ravi Kumar, Anita Rao'
};

// ── KYC ──
describe('KYC format checks', () => {
  test('valid GSTIN passes format and check character', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toMatchObject({ ok: true, format: true, checksum: true });
  });
  test('GSTIN with a wrong check character is caught', () => {
    expect(validateGstin('27AAPFU0939F1ZA')).toMatchObject({ ok: false, format: true, checksum: false });
  });
  test('invalid GSTIN format and length', () => {
    expect(validateGstin('12345').ok).toBe(false);
    expect(validateGstin('99AAPFU0939F1ZV').format).toBe(false); // state code 99 does not exist
  });
  test('PAN format', () => {
    expect(validatePan('AAPFU0939F').ok).toBe(true);
    expect(validatePan('AAPXU0939F').ok).toBe(false); // 4th character must be an entity type
    expect(validatePan('1234567890').ok).toBe(false);
  });
  test('IFSC, email and phone', () => {
    expect(validateIfsc('HDFC0001234').ok).toBe(true);
    expect(validateIfsc('HDFC1001234').ok).toBe(false);
    expect(validateEmail('a@gmail.com')).toMatchObject({ ok: true, corporate: false });
    expect(validateEmail('a@gammasteel.in')).toMatchObject({ ok: true, corporate: true });
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validatePhone('+91 98450 12345').ok).toBe(true);
    expect(validatePhone('12345').ok).toBe(false);
  });
  test('company names are normalised', () => {
    expect(normalizeCompany('ABC Industries Pvt Ltd')).toBe(normalizeCompany('ABC Industries Private Limited'));
  });
});

describe('KYC scoring and duplicates', () => {
  test('a complete, unique supplier is VERIFIED with score 100', async () => {
    const result = scoreKyc(GOOD, []);
    expect(result.score).toBe(100);
    expect(result.status).toBe('VERIFIED');
  });

  test('incomplete supplier loses points and says what is missing', () => {
    const result = scoreKyc({ companyName: 'X Traders', email: 'x@gmail.com' }, []);
    expect(result.status).toBe('HIGH_RISK');
    expect(result.checks.find(c => c.key === 'complete').detail).toMatch(/Missing: GSTIN, PAN/);
  });

  test('duplicate bank account and GSTIN are detected via fingerprints', async () => {
    const mine = await publicIdentity(GOOD);
    const other = await publicIdentity({ ...GOOD, companyName: 'Delta Metals', email: 'x@delta.in', phone: '9000000000', address: 'Other place', directors: 'Someone Else' });
    const dupes = findDuplicates(mine, [{ uid: 'B', name: 'Delta Metals', identity: other }]);
    expect(dupes.map(d => d.field)).toEqual(expect.arrayContaining(['GSTIN', 'PAN', 'bank account']));
    const result = scoreKyc(GOOD, dupes);
    expect(result.checks.find(c => c.key === 'bank').passed).toBe(false);
    expect(result.checks.find(c => c.key === 'identity').passed).toBe(false);
    expect(result.score).toBeLessThan(85);
  });

  test('shared director and similar address are flagged as relationships', async () => {
    const mine = await publicIdentity(GOOD);
    const other = await publicIdentity({ companyName: 'Other Co', directors: 'Mr. Ravi Kumar', address: '12, M.G. Rd, Pune 411001' });
    const fields = findDuplicates(mine, [{ uid: 'C', name: 'Other Co', identity: other }]).map(d => d.field);
    expect(fields.some(f => f.startsWith('director'))).toBe(true);
    expect(fields).toContain('address');
  });

  test('fingerprints never contain the raw number', async () => {
    const id = await publicIdentity(GOOD);
    expect(JSON.stringify(id)).not.toContain('123456789012');
  });
});

// ── Supplier risk ──
describe('supplier risk score', () => {
  test('low-risk supplier', () => {
    const r = scoreSupplier({ supplier: { kyc: { status: 'VERIFIED', score: 95, duplicates: [] } } });
    expect(r.score).toBe(0);
    expect(r.level).toBe('LOW');
  });
  test('high-risk supplier lists every reason', () => {
    const r = scoreSupplier({
      supplier: { kyc: { status: 'NEEDS_REVIEW', score: 70, duplicates: [{ field: 'bank account', kind: 'bank', otherName: 'Beta' }] } },
      bidResults: [{ flags: [{ type: 'similar_proposals' }] }, { flags: [{ type: 'price_too_high' }] }],
      bills: [{ analysis: { flags: [{ type: 'price_exceeded' }] } }, { reviewStatus: 'rejected', analysis: { flags: [] } }]
    });
    expect(r.level).toBe('HIGH');
    expect(r.factors.map(f => f.label)).toEqual(expect.arrayContaining([
      'Shared bank account with another supplier', 'Linked or copied bids', 'Abnormal bid pricing', 'Contract violations', 'Rejected invoices'
    ]));
    expect(r.score).toBe(r.factors.reduce((s, f) => s + f.points, 0));
  });
  test('levels', () => {
    expect(riskLevel(24)).toBe('LOW');
    expect(riskLevel(45)).toBe('MEDIUM');
    expect(riskLevel(72)).toBe('HIGH');
  });
});

// ── Benchmarking ──
describe('price benchmarking', () => {
  test('insufficient history is reported, not invented', () => {
    const bm = benchmark([{ price: 500, source: 'contract' }]);
    expect(bm.sufficient).toBe(false);
    expect(bm.message).toBe(INSUFFICIENT);
    expect(comparePrice(600, bm).position).toBe('unknown');
  });
  test('statistics from history', () => {
    const bm = benchmark([680, 700, 690].map(price => ({ price, source: 'contract' })));
    expect(bm).toMatchObject({ sufficient: true, average: 690, median: 690, min: 680, max: 700 });
  });
  test('high deviation and normal price', () => {
    const bm = benchmark([680, 700, 690].map(price => ({ price, source: 'contract' })));
    const high = comparePrice(750, bm);
    expect(high.position).toBe('above');
    expect(high.vsAverage).toBeCloseTo(8.7, 1);
    expect(comparePrice(690, bm).position).toBe('normal');
  });
  test('history excludes the current tender and uses only the same product', () => {
    const h = historyFor('Steel Beams', {
      contracts: [{ productName: 'Steel Beams', agreedUnitPrice: 500, tenderId: 't1' }, { productName: 'Cement', agreedUnitPrice: 9, tenderId: 't2' }],
      tenders: [{ id: 't3', productName: 'Steel Beams' }],
      bids: [{ tenderId: 't3', unitPrice: 520 }, { tenderId: 'current', unitPrice: 999 }],
      bills: [{ status: 'paid', productName: 'Steel Beams', unitCost: 510 }]
    }, 'current');
    expect(h.map(x => x.price).sort()).toEqual([500, 510, 520]);
  });
});

// ── Fraud patterns ──
describe('suspicious pattern detection', () => {
  test('shared supplier identity produces a high alert that explains itself', async () => {
    const a = await publicIdentity(GOOD);
    const b = await publicIdentity({ ...GOOD, companyName: 'Beta', gstin: '', pan: '' });
    const alerts = detectPatterns({ suppliers: { A: { companyName: 'Gamma', kyc: { identity: a } }, B: { companyName: 'Beta', kyc: { identity: b } } } });
    const rel = alerts.find(x => x.type === 'shared_identity');
    expect(rel.level).toBe('HIGH');
    expect(rel.title).toBe('Suspicious supplier relationship');
    expect(rel.reasons.join(' ')).toMatch(/Bank account/);
  });
  test('similar bids, duplicate invoice and abnormal price', () => {
    const alerts = detectPatterns({
      tenders: [{ id: 't', title: 'Steel', aiAnalysis: { tenderFlags: [], bids: [
        { bidId: 'b1', supplierName: 'A', flags: [{ type: 'similar_proposals', severity: 'high', detail: '95% similar', evidence: { otherSupplier: 'B' } }] }
      ] } }],
      bids: [{ id: 'b1', tenderId: 't', supplierId: 'A', supplierName: 'A', unitPrice: 1000 }],
      bills: [{ id: 'i1', supplierId: 'A', amount: 100, analysis: { flags: [{ type: 'possible_duplicate', detail: 'match' }] } }],
      benchmarks: { t: { sufficient: true, average: 600, median: 600, min: 550, max: 650 } }
    });
    const types = alerts.map(a => a.type);
    expect(types).toEqual(expect.arrayContaining(['similar_proposals', 'possible_duplicate', 'high_bid']));
    alerts.forEach(a => {
      expect(a.reasons.length).toBeGreaterThan(0);
      expect(a.title).not.toMatch(/fraud confirmed/i);
    });
  });
});

// ── Approvals ──
describe('multi-level approval', () => {
  test('thresholds decide the number of approvals', () => {
    expect(levelsFor(20000)).toBe(1);
    expect(levelsFor(200000)).toBe(2);
    expect(levelsFor(900000)).toBe(3);
    expect(levelsFor(900000, { tiers: [{ upTo: null, levels: 1 }] })).toBe(1);
  });
  test('high-value chain completes only after all three roles approve', () => {
    let a = newApproval(900000);
    expect(a.steps.map(s => s.role)).toEqual(['procurement_officer', 'procurement_manager', 'finance_manager']);
    a = decide(a, { role: 'procurement_officer', decision: 'approve', by: 'u1' });
    a = decide(a, { role: 'procurement_manager', decision: 'approve', by: 'u2' });
    expect(a.status).toBe('pending');
    expect(nextStep(a).role).toBe('finance_manager');
    a = decide(a, { role: 'finance_manager', decision: 'approve', by: 'u3' });
    expect(a.status).toBe('approved');
  });
  test('unauthorised role cannot approve', () => {
    const a = newApproval(200000);
    expect(() => decide(a, { role: 'finance_manager', decision: 'approve' })).toThrow(/Only a procurement officer/);
  });
  test('rejection needs a reason', () => {
    const a = newApproval(10000);
    expect(() => decide(a, { role: 'procurement_officer', decision: 'reject', reason: '' })).toThrow(/reason/);
    expect(decide(a, { role: 'admin', decision: 'reject', reason: 'Wrong price' }).status).toBe('rejected');
  });
});

// ── Invoice OCR parsing and checks ──
const SAMPLE = `GAMMA STEEL PRIVATE LIMITED
GSTIN: 27AAPFU0939F1ZV
TAX INVOICE
Invoice No: GS-2026-0147
Invoice Date: 05/10/2026
PO Number: AB12CD34
Description Qty Rate Amount
Steel Beams 20 tons x 500 10000
Sub Total 10000.00
GST 18% 1800.00
Freight 500.00
Grand Total ₹12,300.00`;

describe('invoice OCR parsing', () => {
  test('extracts all fields from a typical invoice', () => {
    const { fields, coverage } = parseInvoiceText(SAMPLE, ['Steel Beams', 'Cement']);
    expect(fields).toMatchObject({
      supplierName: 'GAMMA STEEL PRIVATE LIMITED', invoiceNumber: 'GS-2026-0147', invoiceDate: '2026-10-05',
      poNumber: 'AB12CD34', items: 'Steel Beams', quantity: 20, unitPrice: 500, subtotal: 10000, tax: 1800,
      taxRate: 18, extraCharges: 500, total: 12300
    });
    expect(coverage).toBe(1);
    expect(arithmeticIssues(fields)).toEqual([]);
  });
  test('incorrect extraction is caught by the arithmetic check', () => {
    const { fields } = parseInvoiceText(SAMPLE.replace('Grand Total ₹12,300.00', 'Grand Total ₹13,300.00'), ['Steel Beams']);
    expect(arithmeticIssues(fields).length).toBe(1);
  });
});

describe('invoice checks against the contract', () => {
  const contract = { id: 'AB12CD34xyz', title: 'Steel', unit: 'tons', supplierName: 'Gamma Steel Pvt Ltd', agreedUnitPrice: 500, maxQuantity: 100, quantityInvoiced: 0 };
  const invoice = { id: 'new', supplierId: 's1', consumerId: 'b1', unitCost: 500, quantityRequested: 20, extraCharges: 500, amount: 12300, description: '20 tons' };
  const base = parseInvoiceText(SAMPLE, ['Steel Beams']).fields;

  test('a matching invoice raises no document flags', () => {
    const r = analyzeInvoice({ contract, invoice, extracted: base });
    expect(r.flags.filter(f => ['incorrect_tax', 'supplier_mismatch', 'contract_mismatch', 'arithmetic_mismatch'].includes(f.type))).toEqual([]);
  });
  test('price and quantity mismatch', () => {
    const r = analyzeInvoice({ contract: { ...contract, quantityInvoiced: 90 }, invoice: { ...invoice, unitCost: 650 }, extracted: base });
    expect(r.flags.map(f => f.type)).toEqual(expect.arrayContaining(['price_exceeded', 'quantity_exceeded']));
  });
  test('contract and supplier mismatch, wrong GST, duplicate and suspicious invoice numbers', () => {
    const r = analyzeInvoice({
      contract, invoice,
      extracted: { ...base, poNumber: 'ZZ99ZZ99', supplierName: 'Omega Traders', tax: 1500, taxRate: 18, invoiceNumber: '1111' },
      pastInvoices: [{ id: 'old', supplierId: 's1', invoiceNumber: '1111', amount: 9000 }]
    });
    expect(r.flags.map(f => f.type)).toEqual(expect.arrayContaining([
      'contract_mismatch', 'supplier_mismatch', 'incorrect_tax', 'duplicate_invoice_number', 'suspicious_invoice_number'
    ]));
  });
});

test('ordinary numeric invoice numbers are not called suspicious', () => {
  const contract = { id: 'c1', unit: 'tons', supplierName: 'Gamma Steel', agreedUnitPrice: 500, maxQuantity: 100, quantityInvoiced: 0 };
  const invoice = { id: 'n', supplierId: 's', consumerId: 'b', unitCost: 500, quantityRequested: 1, amount: 500, description: 'x' };
  for (const num of ['20261047', 'INV-2026-0147', '4471']) {
    const r = analyzeInvoice({ contract, invoice, extracted: { invoiceNumber: num } });
    expect(r.flags.map(f => f.type)).not.toContain('suspicious_invoice_number');
  }
  for (const num of ['1111', '000', 'TEST01', '12']) {
    const r = analyzeInvoice({ contract, invoice, extracted: { invoiceNumber: num } });
    expect(r.flags.map(f => f.type)).toContain('suspicious_invoice_number');
  }
});
