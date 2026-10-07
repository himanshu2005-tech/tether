// Groq LLM helpers, called straight from the browser with the key in .env (REACT_APP_GROQ_API_KEY).
// Everything here is optional: if no key is set or a call fails, the engine's rule-based
// results are still returned with a template explanation.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.REACT_APP_GROQ_MODEL || 'qwen/qwen3.8-27b';

async function chat(messages, { json = false, maxTokens = 400 } = {}) {
  const key = process.env.REACT_APP_GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_completion_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Strip any reasoning block some models emit
    return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch {
    return null;
  }
}

// Module 2: turn free-text contract terms into structured, checkable fields
async function extractTerms(text) {
  const fallback = regexExtract(text);
  if (!text || !text.trim()) return { ...fallback, source: 'none' };

  const out = await chat([
    {
      role: 'system',
      content: 'You extract procurement contract terms. Reply with JSON only, using exactly these keys: ' +
        '{"extraChargesAllowed": true|false|null, "maxExtraCharges": number|null, "extraChargesClause": string|null, ' +
        '"paymentTermsDays": number|null, "latePenalty": string|null, "qualityRequirements": string[], "summary": string}. ' +
        'Use null when the text does not say. extraChargesAllowed=false only if the text forbids or excludes extra/additional charges (e.g. "price inclusive of all charges"). ' +
        'summary is one plain-English sentence.'
    },
    { role: 'user', content: text.slice(0, 6000) }
  ], { json: true, maxTokens: 500 });

  if (!out) return { ...fallback, source: 'rules' };
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    return { ...fallback, ...parsed, source: 'llm' };
  } catch {
    return { ...fallback, source: 'rules' };
  }
}

function regexExtract(text = '') {
  const t = text.toLowerCase();
  let extraChargesAllowed = null;
  if (/(no|without) (extra|additional|hidden) charges|inclusive of all|all[- ]inclusive|extra charges (are )?not (allowed|permitted)/.test(t)) extraChargesAllowed = false;
  else if (/extra charges|additional charges|freight|transport charges/.test(t)) extraChargesAllowed = true;
  const cap = t.match(/(?:extra|additional)[^.]*?(?:up to|max(?:imum)?|not exceeding)\s*₹?\s*([\d,]+)/);
  const days = t.match(/(?:net|within)\s*(\d{1,3})\s*days/);
  return {
    extraChargesAllowed,
    maxExtraCharges: cap ? Number(cap[1].replace(/,/g, '')) : null,
    extraChargesClause: null,
    paymentTermsDays: days ? Number(days[1]) : null,
    latePenalty: null,
    qualityRequirements: [],
    summary: null
  };
}

function templateSummary(result, kind) {
  if (!result.flags?.length && kind === 'invoice') return 'No issues found. The invoice matches the contract terms and your normal invoicing pattern.';
  const top = [...(result.flags || [])].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  return top.slice(0, 3).map(f => f.detail).join(' ');
}

// Module 5: plain-language explanation of the structured flags
async function explainInvoice(result, contract) {
  if (!result.flags.length) return templateSummary(result, 'invoice');
  const text = await chat([
    {
      role: 'system',
      content: 'You are a procurement auditor. In 2-3 short sentences, explain to a non-technical finance manager why this invoice was flagged and what they should do before paying. Use only the facts given. Use ₹ for money. No preamble.'
    },
    { role: 'user', content: JSON.stringify({ contract: { title: contract.title, agreedUnitPrice: contract.agreedUnitPrice, maxQuantity: contract.maxQuantity }, riskScore: result.riskScore, decision: result.level, estimatedLeakage: result.estimatedLeakage, flags: result.flags.map(f => ({ type: f.type, severity: f.severity, detail: f.detail })) }) }
  ]);
  return text || templateSummary(result, 'invoice');
}

async function explainBids(result, tender) {
  const flagged = result.bids.filter(b => b.flags.length);
  const rec = result.bids.find(b => b.bidId === result.recommendedBidId);
  const fallback = [
    rec ? `Recommended: ${rec.supplierName} (best balance of price, delivery and risk).` : 'No bid is safe to recommend without review.',
    ...result.tenderFlags.map(f => f.detail),
    ...flagged.slice(0, 2).map(b => `${b.supplierName}: ${b.flags[0].title.toLowerCase()}.`)
  ].join(' ');
  if (!flagged.length && !result.tenderFlags.length) return fallback;
  const text = await chat([
    {
      role: 'system',
      content: 'You are a procurement advisor. In 2-4 short sentences, tell the buyer which bid to pick and warn about any suspicious bids, using only the facts given. Plain language, no preamble, use ₹.'
    },
    { role: 'user', content: JSON.stringify({ tender: { title: tender.title, product: tender.productName, maxUnitPrice: tender.maxUnitPrice }, recommended: rec?.supplierName || null, tenderFlags: result.tenderFlags.map(f => f.detail), bids: result.bids.map(b => ({ supplier: b.supplierName, valueScore: b.valueScore, risk: b.riskScore, flags: b.flags.map(f => f.detail) })) }) }
  ]);
  return text || fallback;
}

export { chat, extractTerms, explainInvoice, explainBids, MODEL, GROQ_URL };

// ─── Assistive AI (drafting, guidance, briefings) ──────────────────────────────

const UNITS = ['units', 'kg', 'tons', 'liters', 'meters', 'boxes'];

function parseJson(out) {
  if (!out) return null;
  try { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { return null; }
}

// Turns a plain-English requirement into a complete tender form
async function draftTender(text, products = []) {
  const today = new Date().toISOString().slice(0, 10);
  const out = await chat([
    {
      role: 'system',
      content: `Today is ${today}. Turn a buyer's procurement request into a tender. Reply with JSON only: ` +
        '{"title": string, "productName": string, "quantity": number|null, "unit": one of ' + JSON.stringify(UNITS) + ', ' +
        '"maxUnitPrice": number|null (rupees per unit), "bidDeadline": "YYYY-MM-DD"|null, "deliveryBy": "YYYY-MM-DD"|null, ' +
        '"terms": string (clear numbered contract terms in plain English, include payment, delivery, quality and whether extra charges are allowed)}. ' +
        'Prefer a productName from this list when it fits: ' + JSON.stringify(products) + '. ' +
        'If no bid deadline is given, use 7 days from today. Keep the title under 70 characters.'
    },
    { role: 'user', content: String(text).slice(0, 3000) }
  ], { json: true, maxTokens: 700 });

  const parsed = parseJson(out);
  if (parsed) return { ...parsed, unit: UNITS.includes(parsed.unit) ? parsed.unit : 'units', source: 'llm' };

  // Rule-based fallback
  const t = String(text);
  const qty = t.match(/(\d[\d,]*)\s*(tons?|kg|units?|liters?|meters?|boxes?)/i);
  const price = t.match(/(?:₹|rs\.?|inr)\s*([\d,]+)|([\d,]+)\s*(?:rupees|\/\s*(?:ton|kg|unit))/i);
  const product = products.find(p => t.toLowerCase().includes(p.toLowerCase().replace(/s$/, '')));
  const unitWord = qty?.[2]?.toLowerCase().replace(/s$/, '');
  return {
    title: t.slice(0, 70),
    productName: product || '',
    quantity: qty ? Number(qty[1].replace(/,/g, '')) : null,
    unit: UNITS.find(u => u.startsWith(unitWord || '#')) || 'units',
    maxUnitPrice: price ? Number((price[1] || price[2]).replace(/,/g, '')) : null,
    bidDeadline: null,
    deliveryBy: null,
    terms: t,
    source: 'rules'
  };
}

// Suggests a competitive bid price from past contract prices
async function bidGuidance({ tender, marketPrices = [], companyDescription = '' }) {
  const sorted = [...marketPrices].map(Number).filter(n => n > 0).sort((a, b) => a - b);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const ceiling = Number(tender.maxUnitPrice);
  let low, high, basis;
  if (sorted.length >= 3) {
    low = q(0.25); high = Math.min(q(0.75), ceiling); basis = `${sorted.length} past contracts for ${tender.productName}`;
  } else {
    low = ceiling * 0.85; high = ceiling * 0.95; basis = 'the buyer\'s maximum price (not enough past contracts yet)';
  }
  if (low > high) low = high * 0.95;
  const suggested = Math.round(((low + high) / 2) * 100) / 100;

  const tip = await chat([
    { role: 'system', content: 'You coach a B2B supplier bidding on a tender. In one or two short sentences, give practical advice on what to include in their proposal to win, based on the tender terms. No preamble, no pricing numbers.' },
    { role: 'user', content: JSON.stringify({ tender: { title: tender.title, product: tender.productName, quantity: tender.quantity, unit: tender.unit, deliveryBy: tender.deliveryBy, terms: tender.terms }, supplier: companyDescription }) }
  ], { maxTokens: 150 });

  return {
    low: Math.round(low * 100) / 100,
    high: Math.round(high * 100) / 100,
    suggested,
    basis,
    tip: tip || 'Address every contract term explicitly, state your delivery timeline, and mention certifications or warranties.'
  };
}

// A short, personal status update for the Home page
async function briefing({ role, name, facts }) {
  const out = await chat([
    { role: 'system', content: `You are Tether's assistant writing a Home page briefing for a ${role === 'supplier' ? 'supplier' : 'buyer'} company. Write two short sentences: what matters right now, then the single most useful next step. Use only the facts given, ₹ for money, friendly and professional, no greeting, no preamble.` },
    { role: 'user', content: JSON.stringify({ company: name, ...facts }) }
  ], { maxTokens: 120 });
  return { text: out || null };
}

export { draftTender };
export { bidGuidance };
export { briefing };
