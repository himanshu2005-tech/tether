// Supplier KYC: internal format and consistency checks. No government or bank APIs are called;
// a VERIFIED status means the details are well-formed and don't clash with other suppliers,
// not that a government record was checked.

export const KYC_DISCLAIMER =
  'Verification confirms the validity and consistency of submitted information. It does not independently authenticate government or banking records.';

export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com'
]);

// ─── Format validators ─────────────────────────────────────────────────────────

const GSTIN_RE = /^(0[1-9]|[1-3][0-9])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const clean = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
export const digits = (v) => String(v || '').replace(/\D/g, '');

// GSTIN's last character is a mod-36 check character over the first 14
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CODE.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CODE[(36 - (sum % 36)) % 36];
}

export function validateGstin(value) {
  const v = clean(value);
  if (!v) return { ok: false, format: false, checksum: false, message: 'Not provided' };
  if (v.length !== 15) return { ok: false, format: false, checksum: false, message: `Must be 15 characters (got ${v.length})` };
  if (!GSTIN_RE.test(v)) return { ok: false, format: false, checksum: false, message: 'Not in GSTIN format (2-digit state code, PAN, entity number, Z, check character)' };
  const checksum = gstinCheckChar(v.slice(0, 14)) === v[14];
  return { ok: checksum, format: true, checksum, message: checksum ? 'Valid format and check character' : 'Format is right but the check character does not match, so it may be mistyped' };
}

export function validatePan(value) {
  const v = clean(value);
  if (!v) return { ok: false, message: 'Not provided' };
  if (!PAN_RE.test(v)) return { ok: false, message: 'Not in PAN format (5 letters, 4 digits, 1 letter)' };
  return { ok: true, message: 'Valid format' };
}

export function validateIfsc(value) {
  const v = clean(value);
  if (!v) return { ok: false, message: 'Not provided' };
  if (!IFSC_RE.test(v)) return { ok: false, message: 'Not in IFSC format (4 letters, 0, then 6 letters or digits)' };
  return { ok: true, message: 'Valid format' };
}

export function validateEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(v)) return { ok: false, corporate: false, domain: null, message: 'Not a valid email address' };
  const domain = v.split('@')[1];
  const corporate = !FREE_EMAIL_DOMAINS.has(domain);
  return {
    ok: true, corporate, domain,
    message: corporate ? `Company domain (${domain})` : `Free email provider (${domain}). This is a risk signal, not proof of fraud`
  };
}

export function validatePhone(value) {
  let d = digits(value);
  if (d.startsWith('91') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (d.length !== 10) return { ok: false, normalized: d, message: 'Must be a 10-digit Indian number' };
  if (!/^[2-9]/.test(d)) return { ok: false, normalized: d, message: 'Indian numbers cannot start with 0 or 1' };
  return { ok: true, normalized: d, message: 'Valid format' };
}

export function validateBankAccount(value) {
  const d = digits(value);
  if (!d) return { ok: false, message: 'Not provided' };
  if (d.length < 9 || d.length > 18) return { ok: false, message: 'Bank account numbers are 9 to 18 digits' };
  return { ok: true, message: 'Valid format' };
}

// ─── Normalisation for comparing companies ─────────────────────────────────────

const LEGAL_WORDS = /\b(private|pvt|limited|ltd|llp|inc|incorporated|corp|corporation|company|co|the|opc)\b/g;

export function normalizeCompany(name) {
  return String(name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(LEGAL_WORDS, ' ')
    .replace(/\s+/g, ' ').trim();
}

const ADDRESS_WORDS = [[/\brd\b/g, 'road'], [/\bst\b/g, 'street'], [/\bnr\b/g, 'near'], [/\bopp\b/g, 'opposite'],
  [/\bblr\b/g, 'bangalore'], [/\bbengaluru\b/g, 'bangalore'], [/\bmadras\b/g, 'chennai'], [/\bbombay\b/g, 'mumbai'],
  [/\bflr\b/g, 'floor'], [/\bbldg\b/g, 'building'], [/\bno\b/g, ''], [/\bmain\b/g, 'main']];

export function normalizeAddress(address) {
  // Dots go first so initials like "M.G." become "mg" rather than "m g"
  let a = String(address || '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9 ]/g, ' ');
  ADDRESS_WORDS.forEach(([re, to]) => { a = a.replace(re, to); });
  return a.replace(/\s+/g, ' ').trim();
}

const TITLES = /\b(mr|mrs|ms|dr|shri|smt|sri|kumari|prof)\b/g;
export function normalizePeople(list) {
  return String(list || '').toLowerCase().split(/[,;\n]|\band\b/)
    .map(n => n.replace(/[^a-z ]/g, ' ').replace(TITLES, ' ').replace(/\s+/g, ' ').trim())
    .filter(n => n.length > 3);
}

// Word-overlap similarity (0..1) used for company names and addresses
export function tokenSimilarity(a, b) {
  const A = new Set(String(a).split(' ').filter(Boolean));
  const B = new Set(String(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach(t => { if (B.has(t)) common++; });
  return common / Math.max(A.size, B.size);
}

// Sensitive numbers are stored and compared as fingerprints, so other suppliers never see them.
// (A fingerprint hides the number from casual viewing; short numbers can still be guessed by brute force.)
export async function fingerprint(kind, value) {
  const v = kind === 'phone' ? validatePhone(value).normalized : kind === 'bank' ? digits(value) : clean(value);
  if (!v) return null;
  const data = new TextEncoder().encode(`tether:${kind}:${v}`);
  // Web Crypto: window.crypto in the browser, the global crypto in Node (tests)
  // eslint-disable-next-line no-undef
  const webCrypto = typeof window !== 'undefined' && window.crypto?.subtle ? window.crypto : globalThis.crypto;
  const hash = await webCrypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const maskTail = (value, keep = 4) => {
  const v = clean(value);
  return v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : '';
};

// The comparable, non-sensitive part of a KYC submission (stored on the public profile)
export async function publicIdentity(form) {
  const email = validateEmail(form.email);
  return {
    fingerprints: {
      gstin: await fingerprint('gstin', form.gstin),
      pan: await fingerprint('pan', form.pan),
      bank: await fingerprint('bank', form.bankAccount),
      phone: await fingerprint('phone', form.phone)
    },
    emailDomain: email.ok && email.corporate ? email.domain : null,
    companyNorm: normalizeCompany(form.companyName),
    addressNorm: normalizeAddress(form.address),
    directorsNorm: normalizePeople(form.directors)
  };
}

// ─── Duplicate / relationship detection ───────────────────────────────────────

// Compares one identity with other companies' public identities. `others` = [{ uid, name, identity }]
export function findDuplicates(identity, others = []) {
  const hits = [];
  others.forEach(o => {
    const id = o.identity || {};
    const fp = id.fingerprints || {};
    const mine = identity.fingerprints || {};
    const add = (field, kind) => hits.push({ field, kind, otherUid: o.uid, otherName: o.name || 'Another supplier' });
    if (mine.gstin && mine.gstin === fp.gstin) add('GSTIN', 'identity');
    if (mine.pan && mine.pan === fp.pan) add('PAN', 'identity');
    if (identity.companyNorm && id.companyNorm && tokenSimilarity(identity.companyNorm, id.companyNorm) >= 0.85) add('company name', 'identity');
    if (mine.bank && mine.bank === fp.bank) add('bank account', 'bank');
    if (mine.phone && mine.phone === fp.phone) add('phone number', 'relationship');
    if (identity.emailDomain && identity.emailDomain === id.emailDomain) add('email domain', 'relationship');
    if (identity.addressNorm && id.addressNorm && tokenSimilarity(identity.addressNorm, id.addressNorm) >= 0.8) add('address', 'relationship');
    const shared = (identity.directorsNorm || []).filter(n => (id.directorsNorm || []).includes(n));
    if (shared.length) add(`director (${shared.join(', ')})`, 'relationship');
  });
  return hits;
}

// ─── KYC score ─────────────────────────────────────────────────────────────────

export const REQUIRED_FIELDS = [
  ['companyName', 'Company name'], ['gstin', 'GSTIN'], ['pan', 'PAN'], ['email', 'Email'], ['phone', 'Phone'],
  ['address', 'Address'], ['bankAccount', 'Bank account'], ['ifsc', 'IFSC'], ['directors', 'Directors']
];

export function kycStatus(score) {
  return score >= 80 ? 'VERIFIED' : score >= 60 ? 'NEEDS_REVIEW' : 'HIGH_RISK';
}

export const KYC_STATUS_LABEL = { VERIFIED: 'Verified', NEEDS_REVIEW: 'Needs review', HIGH_RISK: 'High risk' };

// form: raw submitted values; duplicates: output of findDuplicates
export function scoreKyc(form, duplicates = []) {
  const gstin = validateGstin(form.gstin);
  const pan = validatePan(form.pan);
  const ifsc = validateIfsc(form.ifsc);
  const email = validateEmail(form.email);
  const phone = validatePhone(form.phone);
  const bank = validateBankAccount(form.bankAccount);
  const missing = REQUIRED_FIELDS.filter(([k]) => !String(form[k] || '').trim()).map(([, label]) => label);
  const panInGstin = gstin.format && pan.ok && clean(form.gstin).slice(2, 12) === clean(form.pan);

  const identityDupes = duplicates.filter(d => d.kind === 'identity');
  const bankDupes = duplicates.filter(d => d.kind === 'bank');
  const relDupes = duplicates.filter(d => d.kind === 'relationship');
  const describe = (list) => list.map(d => `${d.field} with ${d.otherName}`).join('; ');

  const checks = [
    { key: 'gstin', label: 'GSTIN valid', max: 20, points: gstin.ok ? 20 : gstin.format ? 12 : 0, passed: gstin.ok, detail: gstin.message },
    { key: 'pan', label: 'PAN valid', max: 15, points: !pan.ok ? 0 : (gstin.format && !panInGstin) ? 10 : 15, passed: pan.ok && (!gstin.format || panInGstin),
      detail: !pan.ok ? pan.message : gstin.format && !panInGstin ? 'Valid format, but it does not match the PAN inside the GSTIN' : 'Valid format and matches the GSTIN' },
    { key: 'ifsc', label: 'IFSC valid', max: 10, points: ifsc.ok ? 10 : 0, passed: ifsc.ok, detail: ifsc.message },
    { key: 'email', label: 'Company email', max: 10, points: email.ok && email.corporate ? 10 : email.ok ? 4 : 0, passed: email.ok && email.corporate, detail: email.message },
    { key: 'phone', label: 'Phone valid', max: 10, points: phone.ok ? 10 : 0, passed: phone.ok, detail: phone.message },
    { key: 'complete', label: 'Complete profile', max: 10,
      points: Math.round(10 * (REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) - (bank.ok || !form.bankAccount ? 0 : 2),
      passed: !missing.length && bank.ok,
      detail: missing.length ? `Missing: ${missing.join(', ')}` : bank.ok ? 'All required details provided' : `Bank account: ${bank.message}` },
    { key: 'identity', label: 'No duplicate identity', max: 10, points: identityDupes.length ? 0 : 10, passed: !identityDupes.length,
      detail: identityDupes.length ? `Same ${describe(identityDupes)}` : 'GSTIN, PAN and company name are not used by another supplier' },
    { key: 'bank', label: 'No shared bank account', max: 10, points: bankDupes.length ? 0 : 10, passed: !bankDupes.length,
      detail: bankDupes.length ? `Same ${describe(bankDupes)}` : 'Bank account is not used by another supplier' },
    { key: 'relationship', label: 'No suspicious relationship', max: 5, points: relDupes.length ? 0 : 5, passed: !relDupes.length,
      detail: relDupes.length ? `Shares ${describe(relDupes)}` : 'No shared phone, address, directors or company email domain' }
  ];
  checks.forEach(c => { c.points = Math.max(0, Math.min(c.max, c.points)); });
  const score = checks.reduce((s, c) => s + c.points, 0);
  return { score, status: kycStatus(score), checks, duplicates };
}
