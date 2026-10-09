// Tether analysis engine.
// Every check returns a structured flag { type, severity, title, detail, evidence } so each
// decision is traceable (Module 5: explainable flagging). No check blocks on its own; the
// combined risk score decides whether an invoice is clear, needs review, or should be held.

import { IsolationForest } from './ml/isolationForest';
import { pairwiseSimilarity, cosine, tfidfVectors, normalize } from './ml/text';
import { median, robustZ, coefficientOfVariation, clamp } from './ml/stats';
import { findDuplicates } from '../risk/kyc';

const SEVERITY_WEIGHT = { high: 40, medium: 20, low: 8 };
const PUBLIC_EMAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com']);

function flag(type, severity, title, detail, evidence = {}) {
  return { type, severity, title, detail, evidence };
}

function scoreFlags(flags, extra = 0) {
  const raw = flags.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0) + extra;
  const riskScore = Math.round(clamp(raw, 0, 100));
  const level = riskScore >= 60 ? 'hold' : riskScore >= 25 ? 'review' : 'clear';
  return { riskScore, level };
}

// ─── Module 4 (lite): relationship / entity resolution ─────────────────────────
// Compares two company profiles for shared identifiers that indicate the same owner.
function sharedIdentifiers(a = {}, b = {}) {
  const matches = [];
  // Verified profiles compare fingerprints of bank account, PAN, GSTIN and phone (the raw numbers
  // are private), plus normalised address, directors and company email domain
  if (a?.kyc?.identity && b?.kyc?.identity) {
    findDuplicates(a.kyc.identity, [{ uid: 'other', name: 'other', identity: b.kyc.identity }])
      .forEach(d => matches.push({ field: d.field, value: '(private)' }));
  }
  const same = (x, y) => normalize(x) && normalize(x) === normalize(y);

  if (same(a.bankAccount, b.bankAccount)) matches.push({ field: 'bank account', value: a.bankAccount });
  if (same(a.gstin, b.gstin)) matches.push({ field: 'GSTIN', value: a.gstin });
  if (normalize(a.phone).slice(-10).length === 10 && normalize(a.phone).slice(-10) === normalize(b.phone).slice(-10)) {
    matches.push({ field: 'phone', value: a.phone });
  }
  if (a.address && b.address) {
    const [va, vb] = tfidfVectors([a.address, b.address]);
    const sim = cosine(va, vb);
    if (sim > 0.85 || same(a.address, b.address)) matches.push({ field: 'address', value: a.address, similarity: +sim.toFixed(2) });
  }
  const domain = e => String(e || '').split('@')[1]?.toLowerCase();
  if (domain(a.email) && domain(a.email) === domain(b.email) && !PUBLIC_EMAIL_DOMAINS.has(domain(a.email))) {
    matches.push({ field: 'email domain', value: domain(a.email) });
  }
  const people = p => String(p.keyPeople || '').split(',').map(s => normalize(s)).filter(s => s.length > 3);
  const common = people(a).filter(n => people(b).includes(n));
  if (common.length) {
    const names = String(a.keyPeople).split(',').map(s => s.trim()).filter(n => common.includes(normalize(n)));
    matches.push({ field: 'key people', value: names.join(', ') });
  }
  // The same field can be found by both the fingerprint and the legacy raw comparison
  return matches.filter((m, k) => matches.findIndex(x => x.field === m.field) === k);
}

// ─── Bid evaluation ────────────────────────────────────────────────────────────
function analyzeBids({ tender, bids = [], marketPrices = [], profiles = {}, buyerProfile = {}, supplierHistory = {}, proposalReviews = null }) {
  const perBid = Object.fromEntries(bids.map(b => [b.id, []]));
  const tenderFlags = [];

  // 1. Collusion: near-identical proposal wording between different suppliers
  pairwiseSimilarity(bids.map(b => b.proposal)).forEach(({ i, j, similarity }) => {
    if (similarity < 0.75) return;
    const [a, b] = [bids[i], bids[j]];
    const pct = Math.round(similarity * 100);
    const f = other => flag('similar_proposals', similarity >= 0.9 ? 'high' : 'medium',
      'Proposal text nearly identical to another bid',
      `This proposal is ${pct}% similar to ${other.supplierName}'s. Independent suppliers rarely write near-identical proposals; this is a common sign of coordinated (rigged) bidding.`,
      { similarity: pct, otherSupplier: other.supplierName });
    perBid[a.id].push(f(b));
    perBid[b.id].push(f(a));
  });

  // 2. Collusion: bidders sharing bank account / address / phone / people
  for (let i = 0; i < bids.length; i++) {
    for (let j = i + 1; j < bids.length; j++) {
      const [a, b] = [bids[i], bids[j]];
      const shared = sharedIdentifiers(profiles[a.supplierId], profiles[b.supplierId]);
      if (!shared.length) continue;
      const what = shared.map(s => s.field).join(', ');
      perBid[a.id].push(flag('linked_bidders', 'high', 'Linked to another bidder',
        `Shares ${what} with ${b.supplierName}. Two "competing" bids from the same owner can fake competition.`, { otherSupplier: b.supplierName, shared }));
      perBid[b.id].push(flag('linked_bidders', 'high', 'Linked to another bidder',
        `Shares ${what} with ${a.supplierName}. Two "competing" bids from the same owner can fake competition.`, { otherSupplier: a.supplierName, shared }));
    }
  }

  // 3. Conflict of interest: bidder linked to the buyer company itself
  bids.forEach(b => {
    const shared = sharedIdentifiers(profiles[b.supplierId], buyerProfile);
    if (shared.length) {
      perBid[b.id].push(flag('buyer_conflict', 'high', 'Possible conflict of interest',
        `This supplier shares ${shared.map(s => s.field).join(', ')} with your own company. It may be a shell company linked to an employee.`, { shared }));
    }
  });

  // 4. Price clustering across all bids (cover bidding / price-fixing signal)
  const prices = bids.map(b => b.unitPrice);
  const cv = coefficientOfVariation(prices);
  if (bids.length >= 3 && cv !== null && cv < 0.015) {
    tenderFlags.push(flag('price_clustering', 'medium', 'Bid prices are suspiciously close',
      `All ${bids.length} bids are within ${(cv * 100).toFixed(1)}% of each other. Genuine competition usually shows more spread; tight clustering can indicate price-fixing.`,
      { coefficientOfVariation: +cv.toFixed(4), prices }));
  }

  // 5. Price anomaly vs. market history (robust z-score) and vs. budget
  const reference = marketPrices.length >= 3 ? marketPrices : prices;
  const marketMedian = median(reference);
  bids.forEach(b => {
    const others = marketPrices.length >= 3 ? marketPrices : prices.filter(p => p !== b.unitPrice);
    const z = robustZ(b.unitPrice, others);
    if (z <= -3) {
      perBid[b.id].push(flag('price_too_low', 'medium', 'Abnormally low price',
        `₹${b.unitPrice.toFixed(2)} is far below the typical ₹${marketMedian.toFixed(2)}. Very low bids can win the contract and then recover the money through inflated invoices or extra charges.`,
        { expected: +marketMedian.toFixed(2), actual: b.unitPrice, zScore: +z.toFixed(2) }));
    } else if (z >= 3) {
      perBid[b.id].push(flag('price_too_high', 'low', 'Unusually high price',
        `₹${b.unitPrice.toFixed(2)} is well above the typical ₹${marketMedian.toFixed(2)} for ${tender.productName}.`,
        { expected: +marketMedian.toFixed(2), actual: b.unitPrice, zScore: +z.toFixed(2) }));
    }
    if (b.unitPrice > tender.maxUnitPrice) {
      perBid[b.id].push(flag('over_budget', 'medium', 'Above your maximum price',
        `Bid of ₹${b.unitPrice.toFixed(2)} exceeds the tender ceiling of ₹${Number(tender.maxUnitPrice).toFixed(2)}.`,
        { expected: tender.maxUnitPrice, actual: b.unitPrice }));
    }
    if (b.quantity < tender.quantity) {
      perBid[b.id].push(flag('partial_quantity', 'low', 'Cannot supply full quantity',
        `Offers ${b.quantity} of the ${tender.quantity} ${tender.unit} required.`, { expected: tender.quantity, actual: b.quantity }));
    }
    const hist = supplierHistory[b.supplierId];
    if (hist && hist.invoices >= 3 && hist.flagged / hist.invoices > 0.3) {
      perBid[b.id].push(flag('supplier_history', 'medium', 'Poor invoicing history',
        `${hist.flagged} of this supplier's ${hist.invoices} past invoices were flagged for review.`, hist));
    }
  });

  // AI reading of each proposal (vague, unverifiable or worrying claims)
  if (proposalReviews) {
    bids.forEach(b => {
      const concern = proposalReviews[b.id];
      if (concern) {
        perBid[b.id].push(flag('weak_proposal', 'low', 'Proposal raises questions', concern, { source: 'ai' }));
      }
    });
  }

  // Rank: cheapest price, fastest delivery, lowest risk
  const minPrice = Math.min(...prices);
  const minDays = Math.min(...bids.map(b => b.deliveryDays || 1));
  const single = bids.length === 1;
  const hasMarket = marketPrices.length >= 3;
  const results = bids.map(b => {
    const flags = perBid[b.id];
    const { riskScore, level } = scoreFlags(flags);
    const priceRatio = minPrice / b.unitPrice;
    const deliveryRatio = minDays / (b.deliveryDays || 1);
    const riskRatio = 1 - riskScore / 100;

    // How the value score was built, so the buyer can see the reasoning
    const breakdown = [
      {
        key: 'price', label: 'Price', weight: 55, points: Math.round(55 * priceRatio),
        detail: single ? 'Only bid so far, so there is nothing to compare the price with yet'
          : priceRatio === 1 ? 'Lowest price of all bids'
          : `${Math.round((b.unitPrice / minPrice - 1) * 100)}% more than the lowest bid (₹${minPrice.toLocaleString('en-IN')})`
      },
      {
        key: 'delivery', label: 'Delivery speed', weight: 20, points: Math.round(20 * deliveryRatio),
        detail: single ? `${b.deliveryDays} days; no other bids to compare with`
          : deliveryRatio === 1 ? `Fastest delivery (${b.deliveryDays} days)`
          : `${b.deliveryDays} days, against the fastest ${minDays} days`
      },
      {
        key: 'risk', label: 'Low risk', weight: 25, points: Math.round(25 * riskRatio),
        detail: flags.length ? `Risk ${riskScore}/100 from ${flags.length} warning${flags.length > 1 ? 's' : ''} below` : 'No warnings found (risk 0/100)'
      }
    ];

    // The total is the sum of the parts, so the numbers on screen always add up
    const valueScore = breakdown.reduce((sum, part) => sum + part.points, 0);

    // Every check that was run on this bid, passed or not
    const has = (type) => flags.some(f => f.type === type);
    const profile = profiles[b.supplierId] || {};
    const hasIdentity = ['address', 'phone', 'gstin', 'bankAccount', 'keyPeople'].some(k => profile[k]);
    const hist = supplierHistory[b.supplierId];
    const checks = [
      { label: 'Within your maximum price', status: has('over_budget') ? 'fail' : 'pass',
        detail: `₹${b.unitPrice.toLocaleString('en-IN')} against your limit of ₹${Number(tender.maxUnitPrice).toLocaleString('en-IN')}` },
      { label: 'Price looks normal', status: has('price_too_low') || has('price_too_high') ? 'fail' : (!hasMarket && single ? 'unknown' : 'pass'),
        detail: hasMarket ? `Compared with ${marketPrices.length} past contracts for ${tender.productName}`
          : single ? 'No past contracts or other bids to compare with yet' : 'Compared with the other bids' },
      { label: 'Can supply the full quantity', status: has('partial_quantity') ? 'fail' : 'pass',
        detail: `${b.quantity} of ${tender.quantity} ${tender.unit}` },
      { label: 'Proposal is clear and credible', status: has('weak_proposal') ? 'fail' : proposalReviews ? 'pass' : 'unknown',
        detail: proposalReviews ? 'Read by AI for vague, unverifiable or worrying claims' : 'AI review unavailable', ai: true },
      { label: 'Proposal written independently', status: has('similar_proposals') ? 'fail' : single ? 'unknown' : 'pass',
        detail: single ? 'Needs at least two bids to compare' : 'Compared word-by-word with the other proposals' },
      { label: 'Not linked to another bidder', status: has('linked_bidders') ? 'fail' : single ? 'unknown' : hasIdentity ? 'pass' : 'unknown',
        detail: single ? 'Needs at least two bids to compare' : hasIdentity ? 'Bank account, address, phone, GSTIN and directors compared' : 'Supplier has not added business details' },
      { label: 'No link to your company', status: has('buyer_conflict') ? 'fail' : hasIdentity ? 'pass' : 'unknown',
        detail: hasIdentity ? 'Compared with your own business details' : 'Supplier has not added business details, so this could not be checked' },
      { label: 'Good invoicing history', status: has('supplier_history') ? 'fail' : hist && hist.invoices ? 'pass' : 'unknown',
        detail: hist && hist.invoices ? `${hist.flagged} of ${hist.invoices} past invoices flagged` : 'No past invoices yet' }
    ];

    return { bidId: b.id, supplierName: b.supplierName, riskScore, level, valueScore, flags, breakdown, checks };
  });

  const eligible = results.filter(r => r.level !== 'hold').sort((a, b) => b.valueScore - a.valueScore);
  return {
    bids: results,
    tenderFlags,
    recommendedBidId: eligible[0]?.bidId || null,
    singleBid: single,
    marketMedian: marketMedian ?? null
  };
}

// ─── Invoice validation ────────────────────────────────────────────────────────
function invoiceFeatures(inv, priceReference) {
  const ref = priceReference || inv.unitCost || 1;
  return [
    Math.log1p(inv.amount || 0),
    (inv.unitCost || 0) / ref,
    (inv.extraCharges || 0) / Math.max(inv.amount || 1, 1),
    Math.log1p(inv.quantityRequested || 0)
  ];
}

function invoiceSimilarity(a, b) {
  const amountSim = 1 - Math.min(1, Math.abs(a.amount - b.amount) / Math.max(a.amount, b.amount, 1));
  const qtySim = a.quantityRequested === b.quantityRequested ? 1 : 1 - Math.min(1, Math.abs(a.quantityRequested - b.quantityRequested) / Math.max(a.quantityRequested, b.quantityRequested, 1));
  const [va, vb] = tfidfVectors([a.description, b.description]);
  const textSim = cosine(va, vb);
  const days = a.createdAtMs && b.createdAtMs ? Math.abs(a.createdAtMs - b.createdAtMs) / 86400000 : 0;
  const timeSim = days <= 30 ? 1 - days / 30 : 0;
  return { score: 0.35 * amountSim + 0.25 * qtySim + 0.25 * textSim + 0.15 * timeSim, amountSim, qtySim, textSim, days };
}

function analyzeInvoice({ contract, invoice, pastInvoices = [], supplierProfile = {}, buyerProfile = {}, extracted = null }) {
  const flags = [];
  let leakage = 0;
  const agreed = Number(contract.agreedUnitPrice);
  const qty = Number(invoice.quantityRequested);

  // Module 1: rule-based validation against the contract (deterministic, traceable)
  if (invoice.unitCost > agreed + 1e-6) {
    const over = (invoice.unitCost - agreed) * qty;
    leakage += over;
    flags.push(flag('price_exceeded', 'high', 'Price higher than contract',
      `Billed ₹${invoice.unitCost.toFixed(2)} per ${contract.unit}, but the contract price is ₹${agreed.toFixed(2)}. Overcharge: ₹${over.toFixed(2)}.`,
      { expected: agreed, actual: invoice.unitCost, overcharge: +over.toFixed(2) }));
  }

  const alreadyInvoiced = Number(contract.quantityInvoiced || 0);
  if (alreadyInvoiced + qty > contract.maxQuantity) {
    const excess = alreadyInvoiced + qty - contract.maxQuantity;
    leakage += excess * Math.min(agreed, invoice.unitCost);
    flags.push(flag('quantity_exceeded', 'high', 'More than the contracted quantity',
      `This invoice brings the total to ${alreadyInvoiced + qty} ${contract.unit}, but the contract covers ${contract.maxQuantity}. Excess: ${excess} ${contract.unit}.`,
      { expected: contract.maxQuantity, actual: alreadyInvoiced + qty, excess }));
  }

  // Module 2: checks driven by terms the LLM extracted from the contract text
  const terms = contract.extractedTerms || {};
  const extra = Number(invoice.extraCharges || 0);
  if (extra > 0) {
    if (terms.extraChargesAllowed === false) {
      leakage += extra;
      flags.push(flag('extra_charges_not_allowed', 'high', 'Extra charges not allowed by contract',
        `The contract does not permit additional charges, but ₹${extra.toFixed(2)} was added.${terms.extraChargesClause ? ` Contract says: "${terms.extraChargesClause}"` : ''}`,
        { expected: 0, actual: extra }));
    } else if (terms.maxExtraCharges != null && extra > terms.maxExtraCharges) {
      leakage += extra - terms.maxExtraCharges;
      flags.push(flag('extra_charges_exceeded', 'medium', 'Extra charges above contract limit',
        `₹${extra.toFixed(2)} in extra charges exceeds the contract cap of ₹${Number(terms.maxExtraCharges).toFixed(2)}.`,
        { expected: terms.maxExtraCharges, actual: extra }));
    } else if (terms.extraChargesAllowed == null) {
      flags.push(flag('extra_charges_unverified', 'low', 'Extra charges need confirmation',
        `₹${extra.toFixed(2)} in extra charges was added and the contract does not clearly say whether they are allowed.`,
        { actual: extra }));
    }
  }

  // Module 3: content-based duplicate detection (catches resubmissions with a changed ID)
  const sameParties = pastInvoices.filter(p =>
    p.id !== invoice.id && p.supplierId === invoice.supplierId && p.consumerId === invoice.consumerId && p.status !== 'rejected');
  let best = null;
  sameParties.forEach(p => {
    const s = invoiceSimilarity(invoice, p);
    if (!best || s.score > best.score) best = { ...s, invoice: p };
  });
  if (best && best.score >= 0.7) {
    const high = best.score >= 0.85;
    if (high) leakage += invoice.amount;
    flags.push(flag('possible_duplicate', high ? 'high' : 'medium', 'Looks like a duplicate invoice',
      `${Math.round(best.score * 100)}% match with an earlier invoice (₹${Number(best.invoice.amount).toFixed(2)}, ${Math.round(best.days)} day(s) apart). Amount, quantity and description are compared, not just the invoice number.`,
      { similarity: Math.round(best.score * 100), matchedInvoiceId: best.invoice.id, matchedAmount: best.invoice.amount, daysApart: Math.round(best.days) }));
  }

  // Checks on an uploaded invoice document (fields read by OCR and confirmed by the supplier)
  if (extracted) {
    const ex = extracted;
    const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

    // GST: rate must be a standard Indian slab, and the amount must match the rate
    if (ex.tax != null && Number(ex.subtotal) > 0) {
      const effective = (Number(ex.tax) / Number(ex.subtotal)) * 100;
      const slabs = [0, 0.25, 3, 5, 12, 18, 28];
      const nearest = slabs.reduce((best, r) => (Math.abs(r - effective) < Math.abs(best - effective) ? r : best), 0);
      const stated = ex.taxRate != null ? Number(ex.taxRate) : null;
      if (Math.abs(nearest - effective) > 0.6 || (stated != null && Math.abs(stated - effective) > 0.6)) {
        flags.push(flag('incorrect_tax', 'medium', 'GST amount looks wrong',
          `Tax of ₹${Number(ex.tax).toFixed(2)} is ${effective.toFixed(1)}% of the subtotal${stated != null ? `, but the invoice states ${stated}%` : ', which is not a standard GST rate'}.`,
          { expected: stated ?? nearest, actual: +effective.toFixed(2) }));
      }
    }

    // The numbers on the document must add up
    if (ex.quantity != null && ex.unitPrice != null && ex.subtotal != null && !close(ex.quantity * ex.unitPrice, ex.subtotal)) {
      flags.push(flag('arithmetic_mismatch', 'medium', 'Invoice totals do not add up',
        `${ex.quantity} × ₹${ex.unitPrice} = ₹${(ex.quantity * ex.unitPrice).toFixed(2)}, but the subtotal says ₹${ex.subtotal}.`,
        { expected: +(ex.quantity * ex.unitPrice).toFixed(2), actual: ex.subtotal }));
    }
    if (ex.subtotal != null && ex.total != null) {
      const expected = Number(ex.subtotal) + Number(ex.tax || 0) + Number(ex.extraCharges || 0);
      if (!close(expected, ex.total)) {
        flags.push(flag('arithmetic_mismatch', 'medium', 'Invoice total does not add up',
          `Subtotal + tax + charges = ₹${expected.toFixed(2)}, but the total says ₹${Number(ex.total).toFixed(2)}.`,
          { expected: +expected.toFixed(2), actual: ex.total }));
      }
    }

    // Supplier on the document must be the contracted supplier
    if (ex.supplierName && contract.supplierName) {
      const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\b(private|pvt|limited|ltd|llp|inc|co|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const a = new Set(norm(ex.supplierName).split(' ')), b = new Set(norm(contract.supplierName).split(' '));
      const common = [...a].filter(t => b.has(t)).length;
      if (common / Math.max(a.size, b.size, 1) < 0.5) {
        flags.push(flag('supplier_mismatch', 'high', 'Supplier name does not match the contract',
          `The invoice is from "${ex.supplierName}", but the contract is with "${contract.supplierName}".`,
          { expected: contract.supplierName, actual: ex.supplierName }));
      }
    }

    // PO / contract reference must point at this contract
    if (ex.poNumber && contract.id) {
      const ref = String(ex.poNumber).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const mine = String(contract.id).toUpperCase();
      if (!mine.startsWith(ref.slice(-8)) && !ref.includes(mine.slice(0, 8))) {
        flags.push(flag('contract_mismatch', 'medium', 'Contract reference does not match',
          `The invoice quotes PO/contract "${ex.poNumber}", but it was uploaded against contract ${mine.slice(0, 8)}.`,
          { expected: mine.slice(0, 8), actual: ex.poNumber }));
      }
    }

    // Invoice number: reused, or a pattern that is rarely genuine
    if (ex.invoiceNumber) {
      const num = String(ex.invoiceNumber).toUpperCase();
      const reused = pastInvoices.find(p => p.id !== invoice.id && p.supplierId === invoice.supplierId
        && String(p.invoiceNumber || '').toUpperCase() === num);
      if (reused) {
        leakage += Number(invoice.amount) || 0;
        flags.push(flag('duplicate_invoice_number', 'high', 'Invoice number already used',
          `Invoice number ${num} was already submitted by this supplier (₹${Number(reused.amount).toFixed(2)}).`,
          { matchedInvoiceId: reused.id }));
      }
      const digitsOnly = num.replace(/\D/g, '');
      if (num.replace(/[^A-Z0-9]/g, '').length < 3 || /^(\d)\1+$/.test(digitsOnly) || /^0+$/.test(digitsOnly)
        || /^(123|1234|12345|123456)$/.test(digitsOnly) || /TEST|DUMMY|SAMPLE/.test(num)) {
        flags.push(flag('suspicious_invoice_number', 'low', 'Unusual invoice number',
          `Invoice number "${num}" is very short, repetitive or looks like a placeholder.`, { actual: num }));
      }
    }
  }

  // ML: Isolation Forest over this buyer's invoice history
  let anomalyScore = null;
  let anomalyMethod = null;
  const priceByProduct = {};
  pastInvoices.forEach(p => { (priceByProduct[p.productName] ||= []).push(p.unitCost); });
  const refFor = inv => inv.id === invoice.id || inv === invoice ? agreed : median(priceByProduct[inv.productName] || [inv.unitCost]);
  const training = pastInvoices.filter(p => p.id !== invoice.id).map(p => invoiceFeatures(p, refFor(p)));
  const point = invoiceFeatures(invoice, agreed);
  if (training.length >= 10) {
    const forest = new IsolationForest({ trees: 150, sampleSize: 128 }).fit(training);
    anomalyScore = forest.score(point);
    anomalyMethod = 'isolation_forest';
  } else if (training.length >= 3) {
    const z = Math.abs(robustZ(point[0], training.map(t => t[0])));
    anomalyScore = clamp(0.4 + z / 10, 0, 1);
    anomalyMethod = 'robust_zscore';
  }
  if (anomalyScore !== null && anomalyScore >= 0.62) {
    flags.push(flag('statistical_anomaly', anomalyScore >= 0.7 ? 'medium' : 'low', 'Unusual compared to your history',
      `The AI model rates this invoice as unusual (anomaly score ${anomalyScore.toFixed(2)}) based on amount, price, extra charges and quantity across your ${training.length} past invoices.`,
      { anomalyScore: +anomalyScore.toFixed(3), method: anomalyMethod, sampleSize: training.length }));
  }

  // Module 4 (lite): supplier ↔ buyer relationship
  const shared = sharedIdentifiers(supplierProfile, buyerProfile);
  if (shared.length) {
    flags.push(flag('buyer_conflict', 'high', 'Supplier linked to your company',
      `Supplier shares ${shared.map(s => s.field).join(', ')} with your company. This can indicate an undisclosed employee–vendor relationship.`, { shared }));
  }

  const { riskScore, level } = scoreFlags(flags, anomalyScore ? Math.max(0, (anomalyScore - 0.5) * 40) : 0);
  return {
    riskScore, level, flags,
    anomalyScore: anomalyScore === null ? null : +anomalyScore.toFixed(3),
    anomalyMethod,
    estimatedLeakage: +leakage.toFixed(2)
  };
}

export { analyzeBids, analyzeInvoice, sharedIdentifiers, scoreFlags };
