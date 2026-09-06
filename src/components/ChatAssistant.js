import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection, query, where, getDocs, doc, getDoc,
  addDoc, updateDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import { MessageCircle, X, Send, Bot, Package, CheckCircle, AlertCircle } from 'lucide-react';
import { PREDEFINED_PRODUCTS } from '../constants/products';

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const MODEL = 'qwen/qwen3.8-27b';

// Helper to handle Groq 429 rate limits
const fetchWithRetry = async (url, options, maxRetries = 4) => {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    // Exponential backoff with jitter: 1s, 2s, 4s, 8s
    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
    console.warn(`Groq 429 Rate Limit hit. Retrying in ${Math.round(delay)}ms...`);
    await new Promise(r => setTimeout(r, delay));
  }
  // final attempt
  return await fetch(url, options);
};

// ─── Tool Definitions ──────────────────────────────────────────────────────────
const buildTools = (role) => {
  const common = [
    {
      type: 'function',
      function: {
        name: 'navigate_to',
        description: 'Navigate the user to a specific page in the app.',
        parameters: {
          type: 'object',
          properties: {
            page: {
              type: 'string',
              enum: role === 'supplier'
                ? ['home', 'my-products', 'requests', 'profile']
                : ['home', 'search', 'my-orders', 'payments', 'company-limits', 'profile'],
              description: 'The page to navigate to',
            },
          },
          required: ['page'],
        },
      },
    },
  ];

  const consumerTools = [
    {
      type: 'function',
      function: {
        name: 'search_products',
        description: 'Search for products available from suppliers. Use whenever user wants to find, buy, or compare products.',
        parameters: {
          type: 'object',
          properties: {
            product_name: { type: 'string', description: `Product name. Must be one of: ${PREDEFINED_PRODUCTS.join(', ')}` },
            max_price: { type: 'number', description: 'Max unit price in ₹ (optional)' },
            min_quantity: { type: 'number', description: 'Min quantity needed (optional)' },
          },
          required: ['product_name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_bills',
        description: 'List the consumer\'s bills. Use when user asks about bills, payments due, or spending history.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['unpaid', 'paid', 'all'], description: 'Filter bills by status' },
          },
          required: ['status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'pay_bill',
        description: 'Mark a specific bill as paid. Ask user for the bill ID if not provided.',
        parameters: {
          type: 'object',
          properties: {
            bill_id: { type: 'string', description: '8-character bill display ID (e.g. A1B2C3D4)' },
          },
          required: ['bill_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'set_company_limit',
        description: 'Set or update a maximum unit price the company is willing to pay for a product.',
        parameters: {
          type: 'object',
          properties: {
            product_name: { type: 'string', description: `Product name. One of: ${PREDEFINED_PRODUCTS.join(', ')}` },
            max_price_per_unit: { type: 'number', description: 'Maximum price per unit in ₹' },
          },
          required: ['product_name', 'max_price_per_unit'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'verify_payment',
        description: 'Verify a payment by its ID. Use when user asks to check or verify a payment.',
        parameters: {
          type: 'object',
          properties: {
            payment_id: { type: 'string', description: '8-character payment ID' },
          },
          required: ['payment_id'],
        },
      },
    },
  ];

  const supplierTools = [
    {
      type: 'function',
      function: {
        name: 'list_requests',
        description: 'List incoming purchase requests from buyers.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'active', 'all'], description: 'Filter by request status' },
          },
          required: ['status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_products',
        description: 'List the supplier\'s own products with stock and pricing.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_bill',
        description: 'Send a bill to a consumer for a specific request. Automatically calculates base cost + extra charges.',
        parameters: {
          type: 'object',
          properties: {
            request_id: { type: 'string', description: 'The request document ID' },
            extra_charges: { type: 'number', description: 'Any additional charges in ₹ (e.g. shipping). Use 0 if none.' },
          },
          required: ['request_id', 'extra_charges'],
        },
      },
    },
  ];

  return role === 'supplier'
    ? [...common, ...supplierTools]
    : [...common, ...consumerTools];
};

// ─── Tool Executor ─────────────────────────────────────────────────────────────
async function executeTool(name, args, { currentUser, userData, navigate }) {
  switch (name) {

    case 'navigate_to': {
      navigate('/' + (args.page === 'home' ? '' : args.page));
      return { success: true, message: `Navigated to ${args.page}` };
    }

    case 'search_products': {
      const q = query(collection(db, 'products'), where('name', '==', args.product_name));
      const snap = await getDocs(q);
      let results = [];
      snap.forEach(d => results.push({ id: d.id, ...d.data() }));

      results = await Promise.all(results.map(async item => {
        if (!item.companyName && item.supplierId) {
          try {
            const u = await getDoc(doc(db, 'users', item.supplierId));
            if (u.exists()) item.companyName = u.data().companyName || u.data().email;
          } catch (_) {}
        }
        return item;
      }));

      if (args.max_price) results = results.filter(r => r.cost <= args.max_price);
      if (args.min_quantity) results = results.filter(r => r.quantity >= args.min_quantity);
      results.sort((a, b) => a.cost - b.cost);
      return { type: 'search_results', results, args };
    }

    case 'list_bills': {
      const billQuery = args.status === 'all'
        ? query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid))
        : query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid), where('status', '==', args.status));
      const snap = await getDocs(billQuery);
      const bills = [];
      snap.forEach(d => bills.push({ id: d.id, displayId: d.id.substring(0, 8).toUpperCase(), ...d.data() }));
      bills.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      return {
        type: 'bill_list',
        bills,
        summary: `${bills.length} bills | Total: ₹${bills.reduce((s, b) => s + (b.amount || 0), 0).toFixed(2)}`,
      };
    }

    case 'pay_bill': {
      const id = args.bill_id.replace('#', '').trim().toUpperCase();
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid)));
      let found = null;
      snap.forEach(d => {
        if (d.id.substring(0, 8).toUpperCase() === id) found = { id: d.id, ...d.data() };
      });
      if (!found) return { success: false, message: `No bill found with ID #${id}` };
      if (found.status === 'paid') return { success: false, message: `Bill #${id} is already paid.` };
      await updateDoc(doc(db, 'bills', found.id), { status: 'paid' });
      return { type: 'pay_success', bill: { ...found, displayId: id } };
    }

    case 'set_company_limit': {
      const limRef = doc(db, 'limits', currentUser.uid);
      const existing = await getDoc(limRef);
      const current = existing.exists() ? (existing.data().limits || {}) : {};
      const updated = { ...current, [args.product_name]: args.max_price_per_unit };
      await setDoc(limRef, { limits: updated }, { merge: true });
      return { success: true, message: `Limit set: ${args.product_name} → ₹${args.max_price_per_unit}/unit` };
    }

    case 'verify_payment': {
      const id = args.payment_id.replace('#', '').trim().toUpperCase();
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid), where('status', '==', 'paid')));
      let found = null;
      snap.forEach(d => { if (d.id.substring(0, 8).toUpperCase() === id) found = { id: d.id, displayId: id, ...d.data() }; });
      return found
        ? { type: 'payment_verified', bill: found }
        : { success: false, message: `No paid receipt found for ID #${id}.` };
    }

    case 'list_requests': {
      let q;
      if (args.status === 'all') {
        q = query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid));
      } else {
        q = query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid), where('status', '==', args.status));
      }
      const snap = await getDocs(q);
      const reqs = [];
      snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
      reqs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      return { type: 'request_list', requests: reqs };
    }

    case 'list_products': {
      const snap = await getDocs(query(collection(db, 'products'), where('supplierId', '==', currentUser.uid)));
      const products = [];
      snap.forEach(d => products.push({ id: d.id, ...d.data() }));
      return { type: 'product_list', products };
    }

    case 'send_bill': {
      const reqDoc = await getDoc(doc(db, 'requests', args.request_id));
      if (!reqDoc.exists()) return { success: false, message: 'Request not found.' };
      const req = reqDoc.data();
      const base = Number(req.unitCost) * Number(req.quantityRequested);
      const extra = args.extra_charges || 0;
      const total = base + extra;
      const desc = `${req.quantityRequested} ${req.unit || 'units'} of ${req.productName}${extra > 0 ? ` + ₹${extra} charges` : ''}`;
      await addDoc(collection(db, 'bills'), {
        requestId: args.request_id,
        supplierId: req.supplierId,
        consumerId: req.consumerId,
        productName: req.productName,
        quantityRequested: req.quantityRequested,
        unitCost: req.unitCost,
        unit: req.unit || 'units',
        baseAmount: base,
        extraCharges: extra,
        amount: total,
        description: desc,
        status: 'unpaid',
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'requests', args.request_id), { status: 'active' });
      return { success: true, message: `Bill sent to ${req.consumerName} for ₹${total.toFixed(2)}` };
    }

    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}

// ─── Rich UI Renderers ─────────────────────────────────────────────────────────
function SearchResultCards({ data, currentUser, userData }) {
  const [quantities, setQuantities] = useState({});
  const [requested, setRequested] = useState({});

  if (!data.results.length) return (
    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '0.5rem' }}>
      No suppliers found.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {data.results.map(r => (
        <div key={r.id} style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.625rem', padding: '0.75rem 1rem', fontSize: '0.8125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Package size={13} />
            <span style={{ fontWeight: '600' }}>{r.companyName || 'Supplier'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.775rem' }}>
            <span>₹{Number(r.cost).toFixed(2)} / {r.unit || 'unit'}</span>
            <span>Avail: {r.quantity} {r.unit || 'units'}</span>
          </div>
          {requested[r.id] === 'success' ? (
            <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Requested ✅</div>
          ) : (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input type="number" min="1" max={r.quantity} placeholder="Qty"
                value={quantities[r.id] || ''}
                onChange={e => setQuantities(p => ({ ...p, [r.id]: e.target.value }))}
                className="form-input"
                style={{ width: '65px', padding: '0.3rem 0.45rem', fontSize: '0.775rem' }}
              />
              <button
                disabled={requested[r.id] === 'loading' || !quantities[r.id]}
                onClick={async () => {
                  const qty = parseInt(quantities[r.id], 10);
                  if (!qty) return;
                  setRequested(p => ({ ...p, [r.id]: 'loading' }));
                  try {
                    await addDoc(collection(db, 'requests'), {
                      consumerId: currentUser.uid,
                      consumerName: userData?.companyName || currentUser.email,
                      supplierId: r.supplierId,
                      productId: r.id,
                      productName: r.name,
                      quantityRequested: qty,
                      unitCost: r.cost,
                      unit: r.unit || 'units',
                      totalCost: qty * r.cost,
                      status: 'pending',
                      createdAt: serverTimestamp(),
                    });
                    setRequested(p => ({ ...p, [r.id]: 'success' }));
                  } catch (err) {
                    setRequested(p => ({ ...p, [r.id]: null }));
                    alert(err.message);
                  }
                }}
                className="btn-primary"
                style={{ flex: 1, padding: '0.3rem 0.5rem', margin: 0, minHeight: 'unset', fontSize: '0.775rem', opacity: !quantities[r.id] ? 0.5 : 1 }}
              >
                {requested[r.id] === 'loading' ? '…' : 'Request'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BillListCards({ bills }) {
  const [paying, setPaying] = useState({});
  const [paid, setPaid] = useState({});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {bills.map(b => {
        const isPaid = b.status === 'paid' || paid[b.id];
        return (
          <div key={b.id} style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: '600' }}>{b.productName}</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>#{b.displayId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: '700' }}>₹{Number(b.amount).toFixed(2)}</span>
              {isPaid ? (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>PAID ✓</span>
              ) : (
                <button
                  disabled={paying[b.id]}
                  onClick={async () => {
                    setPaying(p => ({ ...p, [b.id]: true }));
                    try {
                      await updateDoc(doc(db, 'bills', b.id), { status: 'paid' });
                      setPaid(p => ({ ...p, [b.id]: true }));
                    } catch (err) { alert(err.message); }
                    setPaying(p => ({ ...p, [b.id]: false }));
                  }}
                  className="btn-primary"
                  style={{ padding: '0.25rem 0.75rem', margin: 0, minHeight: 'unset', fontSize: '0.75rem' }}
                >
                  {paying[b.id] ? '…' : 'Pay Now'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestListCards({ requests }) {
  const [sending, setSending] = useState({});
  const [extras, setExtras] = useState({});
  const [billed, setBilled] = useState({});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {requests.map(r => {
        const base = Number(r.unitCost) * Number(r.quantityRequested);
        const extra = parseFloat(extras[r.id] || 0);
        const total = base + (isNaN(extra) ? 0 : extra);
        return (
          <div key={r.id} style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: '600' }}>{r.productName}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{r.status}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: '0.375rem' }}>From: {r.consumerName} · Qty: {r.quantityRequested} · Base: ₹{base.toFixed(2)}</div>
            {billed[r.id] ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Bill sent ✅</div>
            ) : (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input type="number" min="0" step="0.01" placeholder="Extra ₹"
                  value={extras[r.id] || ''}
                  onChange={e => setExtras(p => ({ ...p, [r.id]: e.target.value }))}
                  className="form-input"
                  style={{ width: '80px', padding: '0.3rem 0.45rem', fontSize: '0.775rem' }}
                />
                <button
                  disabled={sending[r.id]}
                  onClick={async () => {
                    setSending(p => ({ ...p, [r.id]: true }));
                    try {
                      await executeTool('send_bill', { request_id: r.id, extra_charges: isNaN(extra) ? 0 : extra }, {});
                      setBilled(p => ({ ...p, [r.id]: true }));
                    } catch (err) { alert(err.message); }
                    setSending(p => ({ ...p, [r.id]: false }));
                  }}
                  className="btn-primary"
                  style={{ flex: 1, padding: '0.3rem 0.5rem', margin: 0, minHeight: 'unset', fontSize: '0.775rem' }}
                >
                  {sending[r.id] ? '…' : `Send Bill ₹${total.toFixed(0)}`}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PaymentVerifiedCard({ bill }) {
  return (
    <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.625rem', padding: '1rem', fontSize: '0.8125rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <CheckCircle size={16} />
        <span style={{ fontWeight: '700' }}>Payment Verified</span>
        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>#{bill.displayId}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
        <span>{bill.productName}</span>
        <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>₹{Number(bill.amount).toFixed(2)}</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{bill.description}</div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function ChatAssistant() {
  const { currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [richBlocks, setRichBlocks] = useState({}); // index → rich data
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (userData?.role && messages.length === 0) {
      const hints = userData.role === 'supplier'
        ? ['• "Show my pending requests"', '• "Send a bill for request ID xyz"', '• "List my products"', '• "Take me to my products"']
        : ['• "Find laptops below ₹80,000"', '• "Show my unpaid bills"', '• "Pay bill A1B2C3D4"', '• "Set Iron limit to ₹500/kg"', '• "Verify payment A1B2C3D4"'];
      setMessages([{ role: 'assistant', content: `Hey! I'm your Tether AI assistant (Qwen 27B).\n\nHere's what I can do:\n${hints.join('\n')}` }]);
    }
  }, [userData]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, richBlocks]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  useEffect(() => {
    if (!open || !currentUser || context) return;
    const fetch = async () => {
      try {
        const role = userData?.role;
        let ctx = `User: ${userData?.companyName || currentUser.email} | Role: ${role}\nProducts catalogue: ${PREDEFINED_PRODUCTS.join(', ')}\n`;
        if (role === 'supplier') {
          const [products, requests, bills] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'bills'), where('supplierId', '==', currentUser.uid))),
          ]);
          ctx += `My products: ${products.docs.map(d => `${d.data().name}(qty:${d.data().quantity},₹${d.data().cost})`).join('; ')}\n`;
          ctx += `Requests: ${requests.docs.filter(d => d.data().status === 'pending').length} pending. IDs: ${requests.docs.map(d => `${d.id.substring(0, 8)} [${d.data().status}] ${d.data().productName} from ${d.data().consumerName}`).join('; ')}\n`;
          ctx += `Total billed: ₹${bills.docs.reduce((s, d) => s + (d.data().amount || 0), 0).toFixed(2)}\n`;
        } else {
          const [orders, bills, limitsDoc] = await Promise.all([
            getDocs(query(collection(db, 'requests'), where('consumerId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid))),
            getDoc(doc(db, 'limits', currentUser.uid)),
          ]);
          const unpaid = bills.docs.filter(d => d.data().status === 'unpaid');
          const paid = bills.docs.filter(d => d.data().status === 'paid');
          ctx += `Orders: ${orders.size} | Unpaid bills: ${unpaid.length} (₹${unpaid.reduce((s, d) => s + (d.data().amount || 0), 0).toFixed(2)} due) | Spent: ₹${paid.reduce((s, d) => s + (d.data().amount || 0), 0).toFixed(2)}\n`;
          if (limitsDoc.exists()) {
            const lim = limitsDoc.data().limits || {};
            ctx += `Limits: ${Object.entries(lim).map(([k, v]) => `${k}: ₹${v}/unit`).join(', ')}\n`;
          }
        }
        setContext(ctx);
      } catch (e) { console.error(e); }
    };
    fetch();
  }, [open, currentUser, userData, context]);

  const buildSystem = () =>
    `You are a concise, expert AI assistant embedded in Tether, a B2B warehouse management platform. Use ₹ for currency. Keep answers brief.
When the user wants to search/buy products, list bills, pay bills, set limits, verify payments, navigate, or manage requests — always call the appropriate tool.
Do not describe results in text if a tool can fetch them.
Context: ${context || 'Loading...'}`;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    const userMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setIsLoading(true);

    const tools = buildTools(userData?.role);
    const ctx = { currentUser, userData, navigate };
    let toolMessageHistory = [...history];

    try {
      // Agentic loop: keep calling tools until no more tool calls
      let iteration = 0;
      while (iteration < 5) {
        iteration++;
        const res = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'system', content: buildSystem() }, ...toolMessageHistory],
            tools,
            tool_choice: 'auto',
            temperature: 0.6,
            max_completion_tokens: 1024,
          }),
        });

        if (!res.ok) throw new Error(`Groq API error: ${res.status}`);
        const data = await res.json();
        const choice = data.choices[0];

        if (choice.finish_reason === 'tool_calls') {
          const toolCall = choice.message.tool_calls[0];
          const fnName = toolCall.function.name;
          const fnArgs = JSON.parse(toolCall.function.arguments);

          const statusMsg = { role: 'assistant', content: `🔧 Running: **${fnName.replace(/_/g, ' ')}**…` };
          setMessages(prev => [...prev, statusMsg]);

          const result = await executeTool(fnName, fnArgs, ctx);

          // Store rich UI data if applicable
          if (result.type) {
            const msgIndex = toolMessageHistory.length + 1;
            setRichBlocks(prev => ({ ...prev, [msgIndex]: result }));
          }

          const resultStr = result.type
            ? JSON.stringify({ count: result.results?.length ?? result.bills?.length ?? result.requests?.length ?? result.products?.length, ...result })
            : JSON.stringify(result);

          toolMessageHistory = [
            ...toolMessageHistory,
            choice.message,
            { role: 'tool', tool_call_id: toolCall.id, content: resultStr },
          ];

          // Remove status message before streaming final response
          setMessages(prev => prev.filter((_, i) => i !== prev.length - 1));

        } else {
          // Stream final response
          const streamRes = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: MODEL,
              messages: [{ role: 'system', content: buildSystem() }, ...toolMessageHistory],
              temperature: 0.6,
              max_completion_tokens: 512,
              stream: true,
            }),
          });
          if (!streamRes.ok) throw new Error(`Groq API error: ${streamRes.status}`);

          const reader = streamRes.body.getReader();
          const decoder = new TextDecoder();
          let full = '';
          const insertIdx = messages.length + toolMessageHistory.length - history.length;
          setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
            for (const line of lines) {
              const data = line.replace('data: ', '');
              if (data === '[DONE]') continue;
              try {
                const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
                full += delta;
                setMessages(prev => { const u = [...prev]; u[u.length - 1] = { role: 'assistant', content: full }; return u; });
              } catch (_) {}
            }
          }
          break;
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }]);
    }

    setIsLoading(false);
  };

  const renderRichBlock = (idx, data) => {
    if (!data) return null;
    switch (data.type) {
      case 'search_results':
        return <SearchResultCards key={idx} data={data} currentUser={currentUser} userData={userData} />;
      case 'bill_list':
        return <BillListCards key={idx} bills={data.bills} />;
      case 'pay_success':
        return (
          <div key={idx} style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={14} />
              <span>Bill #{data.bill.displayId} paid ✅ — ₹{Number(data.bill.amount).toFixed(2)}</span>
            </div>
          </div>
        );
      case 'payment_verified':
        return <PaymentVerifiedCard key={idx} bill={data.bill} />;
      case 'request_list':
        return <RequestListCards key={idx} requests={data.requests} />;
      case 'product_list':
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {data.products.map(p => (
              <div key={p.id} style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: '600' }}>{p.name}</span>
                <span style={{ color: 'var(--text-secondary)' }}>Qty: {p.quantity} · ₹{p.cost}/{p.unit || 'unit'}</span>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  if (!currentUser) return null;

  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', bottom: '5rem', right: '1.5rem',
          width: '385px', height: '580px',
          backgroundColor: 'var(--bg-color)',
          border: '1px solid var(--border-color)',
          borderRadius: '1rem',
          display: 'flex', flexDirection: 'column',
          zIndex: 1000,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--surface-color)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <Bot size={18} />
              <span style={{ fontWeight: '600', fontSize: '0.9375rem' }}>Tether AI</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '9999px', padding: '0.1rem 0.5rem' }}>Qwen 27B</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}>
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {messages.map((msg, i) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%', padding: '0.625rem 0.875rem',
                    borderRadius: msg.role === 'user' ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
                    backgroundColor: msg.role === 'user' ? 'var(--text-primary)' : 'var(--surface-color)',
                    color: msg.role === 'user' ? 'var(--bg-color)' : 'var(--text-primary)',
                    fontSize: '0.875rem', lineHeight: '1.55',
                    border: msg.role === 'assistant' ? '1px solid var(--border-color)' : 'none',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {msg.content || (isLoading && i === messages.length - 1 ? <span style={{ opacity: 0.4 }}>● ● ●</span> : '')}
                  </div>
                </div>
                {/* Rich UI block after this message if any */}
                {renderRichBlock(i, richBlocks[i])}
              </React.Fragment>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '0.875rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask anything or give a command…"
              disabled={isLoading}
              className="form-input"
              style={{ flex: 1, padding: '0.625rem 0.875rem', fontSize: '0.875rem', color: 'var(--text-primary)' }}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="btn-primary"
              style={{ padding: '0 0.875rem', minHeight: 'unset', margin: 0, opacity: (!input.trim() || isLoading) ? 0.4 : 1 }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          width: '52px', height: '52px', borderRadius: '50%',
          backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          transition: 'transform 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.08)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        title="Tether AI Assistant"
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}
