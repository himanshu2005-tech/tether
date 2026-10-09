// Turns OCR text from an invoice into structured fields. Pure and provider-agnostic: any OCR
// engine that returns plain text can feed it. Each field also gets a confidence so the user knows
// which ones to double-check before validating.

export const INVOICE_FIELDS = [
  ['supplierName', 'Supplier'],
  ['invoiceNumber', 'Invoice number'],
  ['invoiceDate', 'Invoice date'],
  ['poNumber', 'PO / contract number'],
  ['items', 'Item'],
  ['quantity', 'Quantity'],
  ['unitPrice', 'Unit price'],
  ['subtotal', 'Subtotal'],
  ['tax', 'GST / tax'],
  ['extraCharges', 'Additional charges'],
  ['total', 'Total']
];

// Either comma grouping (1,23,456.00 or 123,456.00) or a plain number (123456.00)
const NUM = '([0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)';
const toNumber = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')));
const lines = (text) => String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

// First match of any pattern, searched line by line so labels and values on the same line pair up
function findLabelled(ls, patterns) {
  for (const re of patterns) {
    for (const l of ls) {
      const m = l.match(re);
      if (m) return m[1];
    }
  }
  return null;
}

function amountAfter(ls, labelRe) {
  for (const l of ls) {
    if (!labelRe.test(l)) continue;
    // Rates like "18%" are not amounts, so drop them before reading numbers
    const rest = l.replace(/[0-9]+(?:\.[0-9]+)?\s*%/g, ' ');
    const nums = [...rest.matchAll(new RegExp(NUM, 'g'))].map(m => toNumber(m[1])).filter(n => n != null);
    if (nums.length) return nums[nums.length - 1];
  }
  return null;
}

function parseDate(s) {
  if (!s) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/(\d{1,2})\s*([A-Za-z]{3})[a-z]*,?\s*(\d{4})/);
  if (m && months[m[2].toLowerCase()]) return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}

/**
 * text: OCR output; knownProducts: product names to look for in item lines
 * Returns { fields, found: { field: boolean }, coverage (0..1) }
 */
export function parseInvoiceText(text, knownProducts = []) {
  const ls = lines(text);
  const all = ls.join('\n');

  const invoiceNumber = findLabelled(ls, [
    /invoice\s*(?:no\.?|number|#|num)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
    /\binv\s*(?:no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i,
    /bill\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i
  ]);
  const poNumber = findLabelled(ls, [
    /(?:p\.?o\.?|purchase\s*order|contract)\s*(?:no\.?|number|#|ref(?:erence)?|id)?\s*[:#-]\s*([A-Z0-9][A-Z0-9/_-]{3,})/i,
    /(?:contract|po)\s*(?:no\.?|number|#|ref|id)\s*([A-Z0-9][A-Z0-9/_-]{3,})/i
  ]);
  const dateRaw = findLabelled(ls, [
    /(?:invoice\s*date|date\s*of\s*invoice|bill\s*date|dated?)\s*[:-]?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}|[0-9]{1,2}\s*[A-Za-z]{3,9},?\s*[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
  ]);

  // Supplier: an explicit label, otherwise the first line that looks like a company name
  let supplierName = findLabelled(ls, [/(?:supplier|seller|vendor|from|sold\s*by)\s*[:-]\s*(.{3,80})/i]);
  if (!supplierName) {
    supplierName = ls.find(l => /\b(pvt|private|ltd|limited|llp|industries|traders|enterprises|corporation|corp|co\.?|inc)\b/i.test(l)
      && !/invoice|bill to|ship to|buyer|customer/i.test(l)) || null;
  }

  const subtotal = amountAfter(ls, /sub\s*-?\s*total|taxable\s*(?:value|amount)/i);
  const taxCgst = amountAfter(ls, /\bcgst\b/i);
  const taxSgst = amountAfter(ls, /\bsgst\b/i);
  let tax = amountAfter(ls, /\bigst\b|\bgst\b|\btax\b/i);
  if (taxCgst != null && taxSgst != null && /cgst/i.test(all)) tax = taxCgst + taxSgst;
  const taxRateRaw = all.match(/(?:gst|igst|tax)[^\n%]{0,20}?(\d{1,2}(?:\.\d+)?)\s*%/i);
  const extraCharges = amountAfter(ls, /freight|shipping|transport|delivery\s*charge|handling|packing|additional\s*charge|other\s*charge|loading/i);
  const total = amountAfter(ls, /grand\s*total|total\s*amount|amount\s*payable|net\s*payable|invoice\s*total|^total\b|\btotal\s*[:₹]/i);

  // Item line: a known product name, or the line with quantity × rate
  let items = null, quantity = null, unitPrice = null;
  const productRe = knownProducts.length
    ? new RegExp(`(${knownProducts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, '')).join('|')})s?`, 'i')
    : null;
  for (const l of ls) {
    const prod = productRe && l.match(productRe);
    const qtyRate = l.match(new RegExp(`${NUM}\\s*(?:nos|units?|pcs|kg|tons?|tonnes?|mt|ltrs?|liters?|litres?|meters?|m|boxes?)?\\s*(?:x|×|@|\\*)\\s*(?:₹|rs\\.?)?\\s*${NUM}`, 'i'));
    if (prod || qtyRate) {
      if (prod && !items) items = prod[0].trim();
      if (qtyRate && quantity == null) { quantity = toNumber(qtyRate[1]); unitPrice = toNumber(qtyRate[2]); }
      if (!qtyRate && prod && quantity == null) {
        // Columns: "<item> <qty> <rate> <amount>"
        const nums = [...l.slice(prod.index + prod[0].length).matchAll(new RegExp(NUM, 'g'))].map(m => toNumber(m[1]));
        if (nums.length >= 2) { quantity = nums[0]; unitPrice = nums[1]; }
      }
    }
    if (items && quantity != null) break;
  }
  if (quantity == null) quantity = toNumber(findLabelled(ls, [new RegExp(`(?:qty|quantity)\\s*[:-]?\\s*${NUM}`, 'i')]));
  if (unitPrice == null) unitPrice = toNumber(findLabelled(ls, [new RegExp(`(?:unit\\s*price|rate|price\\s*per\\s*unit)\\s*[:-]?\\s*(?:₹|rs\\.?)?\\s*${NUM}`, 'i')]));

  const fields = {
    supplierName: supplierName ? supplierName.replace(/\s{2,}/g, ' ').trim() : null,
    invoiceNumber: invoiceNumber ? invoiceNumber.toUpperCase() : null,
    invoiceDate: parseDate(dateRaw),
    poNumber: poNumber ? poNumber.toUpperCase() : null,
    items,
    quantity,
    unitPrice,
    subtotal: subtotal ?? (quantity != null && unitPrice != null ? Math.round(quantity * unitPrice * 100) / 100 : null),
    tax,
    taxRate: taxRateRaw ? Number(taxRateRaw[1]) : null,
    extraCharges: extraCharges ?? 0,
    total
  };
  const found = Object.fromEntries(INVOICE_FIELDS.map(([k]) => [k, fields[k] != null && fields[k] !== '' && !(k === 'extraCharges' && extraCharges == null)]));
  const coverage = Object.values(found).filter(Boolean).length / INVOICE_FIELDS.length;
  return { fields, found, coverage };
}

// Arithmetic consistency of the extracted numbers, used for confidence and by the invoice checks
export function arithmeticIssues(f) {
  const issues = [];
  const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
  if (f.quantity != null && f.unitPrice != null && f.subtotal != null && !close(f.quantity * f.unitPrice, f.subtotal)) {
    issues.push(`Quantity × unit price (${f.quantity} × ${f.unitPrice}) does not equal the subtotal ${f.subtotal}`);
  }
  if (f.subtotal != null && f.total != null) {
    const expected = Number(f.subtotal) + Number(f.tax || 0) + Number(f.extraCharges || 0);
    if (!close(expected, f.total)) issues.push(`Subtotal + tax + charges (${expected.toFixed(2)}) does not equal the total ${f.total}`);
  }
  return issues;
}

// Overall confidence: how sure the OCR engine was about the characters, how many fields were found,
// and whether the numbers add up
export function overallConfidence({ ocrConfidence, coverage, fields }) {
  const arithmeticOk = arithmeticIssues(fields).length === 0 ? 1 : 0.6;
  const c = (ocrConfidence / 100) * 0.5 + coverage * 0.35 + arithmeticOk * 0.15;
  return Math.round(Math.max(0, Math.min(1, c)) * 100);
}
