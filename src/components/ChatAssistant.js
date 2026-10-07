import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  collection, query, where, getDocs, doc, getDoc,
  addDoc, updateDoc, setDoc, serverTimestamp
} from 'firebase/firestore';
import {
  MessageCircle, X, Send, Sparkles, Gavel, FileText, FileSignature, ShieldAlert,
  Package, Inbox, CheckCircle2, AlertCircle, ArrowRight, Target
} from 'lucide-react';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { RiskBadge, InfoTip } from './Guide';

// Called straight from the browser with the key in .env
const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;
const MODEL = process.env.REACT_APP_GROQ_MODEL || 'qwen/qwen3.8-27b';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const shortId = (id) => id.substring(0, 8).toUpperCase();

// Helper to handle Groq 429 rate limits
const fetchWithRetry = async (url, options, maxRetries = 4) => {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
    await new Promise(r => setTimeout(r, delay));
  }
  return fetch(url, options);
};

// ─── Tool definitions ──────────────────────────────────────────────────────────

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } }
});

const buildTools = (role) => {
  if (role === 'supplier') {
    return [
      fn('navigate_to', 'Open a page in the app.', {
        page: { type: 'string', enum: ['home', 'tenders', 'contracts', 'my-products', 'requests', 'profile'] }
      }, ['page']),
      fn('find_tenders', 'List open tenders the supplier can bid on. By default only tenders for the products this supplier sells.', {
        product_name: { type: 'string', description: 'Optional product to filter by. Leave empty to use the supplier focus.' }
      }),
      fn('my_bids', 'Show the bids this supplier has placed and whether they won.'),
      fn('my_contracts', 'Show contracts this supplier has won and how much is left to invoice.'),
      fn('list_requests', 'List direct purchase requests from buyers.', {
        status: { type: 'string', enum: ['pending', 'active', 'all'] }
      }, ['status']),
      fn('list_products', "List the supplier's own catalogue products."),
      fn('send_bill', 'Send a bill for a direct purchase request.', {
        request_id: { type: 'string' },
        extra_charges: { type: 'number', description: 'Extra charges in ₹, 0 if none.' }
      }, ['request_id', 'extra_charges'])
    ];
  }
  return [
    fn('navigate_to', 'Open a page in the app.', {
      page: { type: 'string', enum: ['home', 'tenders', 'contracts', 'my-orders', 'risk', 'search', 'profile'] }
    }, ['page']),
    fn('list_my_tenders', "Show the buyer's tenders with the number of bids each has.", {
      status: { type: 'string', enum: ['open', 'all'] }
    }, ['status']),
    fn('list_bills', 'List invoices. Use "flagged" for invoices the AI flagged that need review.', {
      status: { type: 'string', enum: ['unpaid', 'paid', 'flagged', 'all'] }
    }, ['status']),
    fn('risk_summary', 'Summary of AI invoice checks: how many checked, flagged, and money saved.'),
    fn('pay_bill', 'Open checkout for a bill.', { bill_id: { type: 'string', description: '8-character bill ID' } }, ['bill_id']),
    fn('verify_payment', 'Check that a bill was paid.', { payment_id: { type: 'string', description: '8-character bill ID' } }, ['payment_id']),
    fn('search_products', 'Search the supplier catalogue for small direct purchases.', {
      product_name: { type: 'string', description: `One of: ${PREDEFINED_PRODUCTS.join(', ')}` },
      max_price: { type: 'number' },
      min_quantity: { type: 'number' }
    }, ['product_name']),
    fn('set_company_limit', 'Set the maximum unit price the company will pay for a product.', {
      product_name: { type: 'string', description: `One of: ${PREDEFINED_PRODUCTS.join(', ')}` },
      max_price_per_unit: { type: 'number' }
    }, ['product_name', 'max_price_per_unit'])
  ];
};

const TOOL_STATUS = {
  navigate_to: 'Opening the page',
  find_tenders: 'Finding tenders for you',
  my_bids: 'Checking your bids',
  my_contracts: 'Loading your contracts',
  list_requests: 'Loading requests',
  list_products: 'Loading your products',
  send_bill: 'Sending the bill',
  list_my_tenders: 'Loading your tenders',
  list_bills: 'Loading invoices',
  risk_summary: 'Summarising AI checks',
  pay_bill: 'Finding the bill',
  verify_payment: 'Checking the payment',
  search_products: 'Searching suppliers',
  set_company_limit: 'Saving the limit'
};

// ─── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name, args, { currentUser, navigate, focus }) {
  const uid = currentUser?.uid;
  switch (name) {
    case 'navigate_to': {
      navigate('/' + (args.page === 'home' ? '' : args.page));
      return { type: 'notice', ok: true, message: `Opened ${args.page.replace('-', ' ')}.` };
    }

    case 'find_tenders': {
      const snap = await getDocs(query(collection(db, 'tenders'), where('status', '==', 'open')));
      const bidSnap = await getDocs(query(collection(db, 'bids'), where('supplierId', '==', uid)));
      const bidOn = new Set(bidSnap.docs.map(d => d.data().tenderId));
      const wanted = args.product_name ? [args.product_name] : focus;
      let tenders = snap.docs.map(d => ({ id: d.id, ...d.data(), alreadyBid: bidOn.has(d.id) }));
      if (wanted.length) {
        const w = wanted.map(p => p.toLowerCase());
        tenders = tenders.filter(t => w.includes(String(t.productName).toLowerCase()));
      }
      return { type: 'tender_list', audience: 'supplier', tenders, filter: wanted };
    }

    case 'my_bids': {
      const snap = await getDocs(query(collection(db, 'bids'), where('supplierId', '==', uid)));
      const bids = await Promise.all(snap.docs.map(async d => {
        const b = { id: d.id, ...d.data() };
        const t = await getDoc(doc(db, 'tenders', b.tenderId)).catch(() => null);
        return { ...b, tenderTitle: t?.exists() ? t.data().title : 'Tender' };
      }));
      return { type: 'bid_list', bids };
    }

    case 'my_contracts': {
      const snap = await getDocs(query(collection(db, 'contracts'), where('supplierId', '==', uid)));
      return { type: 'contract_list', contracts: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }

    case 'list_my_tenders': {
      const snap = await getDocs(query(collection(db, 'tenders'), where('buyerId', '==', uid)));
      let tenders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (args.status === 'open') tenders = tenders.filter(t => t.status === 'open');
      return { type: 'tender_list', audience: 'buyer', tenders };
    }

    case 'list_bills': {
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid)));
      let bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (args.status === 'unpaid') bills = bills.filter(b => b.status === 'unpaid');
      if (args.status === 'paid') bills = bills.filter(b => b.status === 'paid');
      if (args.status === 'flagged') bills = bills.filter(b => b.reviewStatus === 'pending_review');
      bills.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      return { type: 'bill_list', bills, status: args.status };
    }

    case 'risk_summary': {
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid)));
      const bills = snap.docs.map(d => d.data()).filter(b => b.analysis);
      const pending = bills.filter(b => b.reviewStatus === 'pending_review');
      return {
        type: 'risk_summary',
        checked: bills.length,
        pending: pending.length,
        cleared: bills.filter(b => b.analysis.level === 'clear').length,
        saved: bills
          .filter(b => b.reviewStatus === 'rejected' || (b.reviewStatus === 'pending_review' && b.status !== 'paid'))
          .reduce((s, b) => s + (b.analysis.estimatedLeakage || 0), 0)
      };
    }

    case 'pay_bill': {
      const id = args.bill_id.replace('#', '').trim().toUpperCase();
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid)));
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(b => shortId(b.id) === id);
      if (!found) return { type: 'notice', ok: false, message: `No bill found with ID #${id}.` };
      if (found.status === 'paid') return { type: 'notice', ok: true, message: `Bill #${id} is already paid.` };
      return { type: 'bill_list', bills: [found], status: 'single' };
    }

    case 'verify_payment': {
      const id = args.payment_id.replace('#', '').trim().toUpperCase();
      const snap = await getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid), where('status', '==', 'paid')));
      const found = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(b => shortId(b.id) === id);
      return found
        ? { type: 'notice', ok: true, message: `Payment confirmed: #${id}, ${found.productName}, ${money(found.amount)}.` }
        : { type: 'notice', ok: false, message: `No paid bill found with ID #${id}.` };
    }

    case 'search_products': {
      const snap = await getDocs(query(collection(db, 'products'), where('name', '==', args.product_name)));
      let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (args.max_price) results = results.filter(r => r.cost <= args.max_price);
      if (args.min_quantity) results = results.filter(r => r.quantity >= args.min_quantity);
      results.sort((a, b) => a.cost - b.cost);
      return { type: 'search_results', results, product: args.product_name };
    }

    case 'set_company_limit': {
      const limRef = doc(db, 'limits', uid);
      const existing = await getDoc(limRef);
      const current = existing.exists() ? (existing.data().limits || {}) : {};
      await setDoc(limRef, { limits: { ...current, [args.product_name]: args.max_price_per_unit } }, { merge: true });
      return { type: 'notice', ok: true, message: `Limit saved: ${args.product_name} at most ${money(args.max_price_per_unit)} per unit.` };
    }

    case 'list_requests': {
      const q = args.status === 'all'
        ? query(collection(db, 'requests'), where('supplierId', '==', uid))
        : query(collection(db, 'requests'), where('supplierId', '==', uid), where('status', '==', args.status));
      const snap = await getDocs(q);
      return { type: 'request_list', requests: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }

    case 'list_products': {
      const snap = await getDocs(query(collection(db, 'products'), where('supplierId', '==', uid)));
      return { type: 'product_list', products: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }

    case 'send_bill': {
      const reqDoc = await getDoc(doc(db, 'requests', args.request_id));
      if (!reqDoc.exists()) return { type: 'notice', ok: false, message: 'Request not found.' };
      const req = reqDoc.data();
      const base = Number(req.unitCost) * Number(req.quantityRequested);
      const extra = args.extra_charges || 0;
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
        amount: base + extra,
        description: `${req.quantityRequested} ${req.unit || 'units'} of ${req.productName}${extra > 0 ? ` + ₹${extra} charges` : ''}`,
        status: 'unpaid',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'requests', args.request_id), { status: 'active' });
      return { type: 'notice', ok: true, message: `Bill sent to ${req.consumerName} for ${money(base + extra)}.` };
    }

    default:
      return { type: 'notice', ok: false, message: `I can't do "${name}" yet.` };
  }
}

// Compact version of a result for the model, so it can comment without repeating the box
function summariseForModel(r) {
  switch (r.type) {
    case 'tender_list': return { shown: 'tenders', count: r.tenders.length, titles: r.tenders.slice(0, 5).map(t => t.title) };
    case 'bid_list': return { shown: 'bids', count: r.bids.length, won: r.bids.filter(b => b.status === 'awarded').length };
    case 'contract_list': return { shown: 'contracts', count: r.contracts.length };
    case 'bill_list': return { shown: 'bills', count: r.bills.length, total: r.bills.reduce((s, b) => s + (b.amount || 0), 0), flagged: r.bills.filter(b => b.reviewStatus === 'pending_review').length, ids: r.bills.slice(0, 5).map(b => shortId(b.id)) };
    case 'search_results': return { shown: 'suppliers', count: r.results.length };
    case 'request_list': return { shown: 'requests', count: r.requests.length };
    case 'product_list': return { shown: 'products', count: r.products.length };
    default: return r;
  }
}

// ─── Result boxes ──────────────────────────────────────────────────────────────

function ResultBox({ icon: Icon, title, count, help, children, action }) {
  return (
    <div className="chat-box">
      <div className="chat-box-head">
        <span className="chat-box-title"><Icon size={15} />{title}{help && <InfoTip text={help} />}</span>
        {count != null && <span className="chat-box-count">{count}</span>}
      </div>
      <div className="chat-box-body">{children}</div>
      {action && <div className="chat-box-foot">{action}</div>}
    </div>
  );
}

function Row({ title, sub, right }) {
  return (
    <div className="chat-row">
      <div className="chat-row-main">
        <div className="chat-row-title">{title}</div>
        {sub && <div className="chat-row-sub">{sub}</div>}
      </div>
      {right && <div className="chat-row-right">{right}</div>}
    </div>
  );
}

const Empty = ({ children }) => <div className="chat-empty">{children}</div>;

function OpenLink({ to, navigate, children }) {
  return (
    <button className="chat-link" onClick={() => navigate(to)}>
      {children} <ArrowRight size={13} />
    </button>
  );
}

function SearchResults({ data, currentUser, userData }) {
  const [quantities, setQuantities] = useState({});
  const [requested, setRequested] = useState({});

  const request = async (r) => {
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
        createdAt: serverTimestamp()
      });
      setRequested(p => ({ ...p, [r.id]: 'done' }));
    } catch (err) {
      setRequested(p => ({ ...p, [r.id]: null }));
      alert(err.message);
    }
  };

  return (
    <ResultBox icon={Package} title={`Suppliers for ${data.product}`} count={data.results.length}>
      {!data.results.length ? <Empty>No supplier lists this product yet.</Empty> : data.results.map(r => (
        <Row key={r.id}
          title={r.companyName || 'Supplier'}
          sub={`${money(r.cost)} per ${r.unit || 'unit'} · ${r.quantity} available`}
          right={requested[r.id] === 'done' ? <span className="status-pill status-active">Requested</span> : (
            <span className="chat-inline">
              <input type="number" min="1" max={r.quantity} placeholder="Qty" className="form-input chat-qty"
                value={quantities[r.id] || ''} onChange={e => setQuantities(p => ({ ...p, [r.id]: e.target.value }))} />
              <button className="btn-primary btn-sm" style={{ marginTop: 0 }} title="Ask this supplier for the quantity you entered"
                disabled={!quantities[r.id] || requested[r.id] === 'loading'} onClick={() => request(r)}>Request</button>
            </span>
          )} />
      ))}
    </ResultBox>
  );
}

function RequestList({ requests }) {
  const [extras, setExtras] = useState({});
  const [state, setState] = useState({});

  const send = async (r) => {
    const extra = parseFloat(extras[r.id] || 0);
    setState(p => ({ ...p, [r.id]: 'sending' }));
    try {
      await executeTool('send_bill', { request_id: r.id, extra_charges: isNaN(extra) ? 0 : extra }, {});
      setState(p => ({ ...p, [r.id]: 'sent' }));
    } catch (err) {
      setState(p => ({ ...p, [r.id]: null }));
      alert(err.message);
    }
  };

  return (
    <ResultBox icon={Inbox} title="Direct requests" count={requests.length}>
      {!requests.length ? <Empty>No requests right now.</Empty> : requests.map(r => {
        const base = Number(r.unitCost) * Number(r.quantityRequested);
        return (
          <Row key={r.id}
            title={`${r.productName} · ${r.quantityRequested} ${r.unit || 'units'}`}
            sub={`${r.consumerName} · ${money(base)}`}
            right={r.status !== 'pending' || state[r.id] === 'sent'
              ? <span className="status-pill status-active">{state[r.id] === 'sent' ? 'Billed' : r.status}</span>
              : (
                <span className="chat-inline">
                  <input type="number" min="0" placeholder="Extra ₹" className="form-input chat-qty"
                    value={extras[r.id] || ''} onChange={e => setExtras(p => ({ ...p, [r.id]: e.target.value }))} />
                  <button className="btn-primary btn-sm" style={{ marginTop: 0 }} title="Send a bill for this request"
                    disabled={state[r.id] === 'sending'} onClick={() => send(r)}>Send bill</button>
                </span>
              )} />
        );
      })}
    </ResultBox>
  );
}

export function ResultView({ data, navigate, currentUser, userData }) {
  switch (data.type) {
    case 'notice':
      return (
        <div className={`chat-notice ${data.ok ? 'ok' : 'bad'}`}>
          {data.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{data.message}</span>
        </div>
      );

    case 'tender_list': {
      const forSupplier = data.audience === 'supplier';
      return (
        <ResultBox icon={Gavel}
          title={forSupplier ? (data.filter?.length ? `Open tenders for ${data.filter.join(', ')}` : 'Open tenders') : 'Your tenders'}
          count={data.tenders.length}
          action={<OpenLink to="/tenders" navigate={navigate}>{forSupplier ? 'See all tenders' : 'Go to tenders'}</OpenLink>}>
          {!data.tenders.length ? <Empty>{forSupplier ? 'No open tenders for your products right now.' : 'No tenders yet.'}</Empty>
            : data.tenders.map(t => (
              <Row key={t.id}
                title={t.title}
                sub={`${t.productName} · ${t.quantity} ${t.unit} · up to ${money(t.maxUnitPrice)}${forSupplier ? ` · ${t.buyerName}` : ''}`}
                right={
                  <span className="chat-inline">
                    {forSupplier
                      ? (t.alreadyBid && <span className="status-pill status-awarded">Bid placed</span>)
                      : <span className="chat-muted">{t.bidCount || 0} bids</span>}
                    <button className="btn-secondary btn-sm" title="Open this tender" onClick={() => navigate(`/tenders/${t.id}`)}>Open</button>
                  </span>
                } />
            ))}
        </ResultBox>
      );
    }

    case 'bid_list':
      return (
        <ResultBox icon={Gavel} title="Your bids" count={data.bids.length}
          action={<OpenLink to="/contracts" navigate={navigate}>Go to contracts</OpenLink>}>
          {!data.bids.length ? <Empty>You haven't bid on anything yet.</Empty> : data.bids.map(b => (
            <Row key={b.id}
              title={b.tenderTitle}
              sub={`${money(b.unitPrice)} per unit · ${b.quantity} units · ${b.deliveryDays} days`}
              right={<span className={`status-pill status-${b.status}`}>{b.status === 'submitted' ? 'Waiting' : b.status}</span>} />
          ))}
        </ResultBox>
      );

    case 'contract_list':
      return (
        <ResultBox icon={FileSignature} title="Your contracts" count={data.contracts.length}
          action={<OpenLink to="/contracts" navigate={navigate}>Raise an invoice</OpenLink>}>
          {!data.contracts.length ? <Empty>No contracts yet. Win a tender to get one.</Empty> : data.contracts.map(c => (
            <Row key={c.id}
              title={c.title}
              sub={`${c.buyerName} · ${money(c.agreedUnitPrice)} per ${c.unit}`}
              right={<span className="chat-muted">{c.quantityInvoiced || 0} / {c.maxQuantity} billed</span>} />
          ))}
        </ResultBox>
      );

    case 'bill_list': {
      const titles = { unpaid: 'Unpaid invoices', paid: 'Paid invoices', flagged: 'Invoices needing review', all: 'All invoices', single: 'Invoice' };
      return (
        <ResultBox icon={FileText} title={titles[data.status] || 'Invoices'} count={data.status === 'single' ? null : data.bills.length}
          help="Bills from suppliers. The coloured number is the AI risk score: green is safe, amber needs a look, red is on hold."
          action={data.status !== 'single' && <OpenLink to={data.status === 'flagged' ? '/risk' : '/my-orders'} navigate={navigate}>{data.status === 'flagged' ? 'Open Risk Center' : 'See all invoices'}</OpenLink>}>
          {!data.bills.length ? <Empty>Nothing here.</Empty> : data.bills.map(b => (
            <Row key={b.id}
              title={`${b.productName} · ${money(b.amount)}`}
              sub={`#${shortId(b.id)}${b.analysis?.summary ? ` · ${b.analysis.summary}` : ''}`}
              right={
                <span className="chat-inline">
                  {b.analysis && <RiskBadge analysis={b.analysis} compact />}
                  {b.status === 'paid'
                    ? <span className="status-pill status-paid">Paid</span>
                    : b.status === 'rejected'
                      ? <span className="status-pill status-rejected">Rejected</span>
                      : <button className="btn-primary btn-sm" style={{ marginTop: 0 }}
                          title={b.reviewStatus === 'pending_review' ? 'Read why the AI flagged it' : 'Open the payment page'}
                          onClick={() => navigate(b.reviewStatus === 'pending_review' ? '/risk' : `/checkout/${b.id}`)}>
                          {b.reviewStatus === 'pending_review' ? 'Review' : 'Pay'}
                        </button>}
                </span>
              } />
          ))}
        </ResultBox>
      );
    }

    case 'risk_summary':
      return (
        <ResultBox icon={ShieldAlert} title="AI invoice checks"
          action={<OpenLink to="/risk" navigate={navigate}>Open Risk Center</OpenLink>}>
          <div className="chat-stats">
            <div><span>{data.checked}</span>Checked</div>
            <div className={data.pending ? 'warn' : ''}><span>{data.pending}</span>To review</div>
            <div><span>{data.cleared}</span>Cleared</div>
            <div><span>{money(data.saved)}</span>Saved</div>
          </div>
        </ResultBox>
      );

    case 'search_results':
      return <SearchResults data={data} currentUser={currentUser} userData={userData} />;

    case 'request_list':
      return <RequestList requests={data.requests} />;

    case 'product_list':
      return (
        <ResultBox icon={Package} title="Your catalogue" count={data.products.length}
          action={<OpenLink to="/my-products" navigate={navigate}>Manage products</OpenLink>}>
          {!data.products.length ? <Empty>No products listed yet.</Empty> : data.products.map(p => (
            <Row key={p.id} title={p.name} sub={`${p.quantity} ${p.unit || 'units'} in stock`} right={<span className="chat-muted">{money(p.cost)} / {p.unit || 'unit'}</span>} />
          ))}
        </ResultBox>
      );

    default:
      return null;
  }
}

// Minimal formatting for the model's replies: **bold** and bullet lines
function FormattedText({ text }) {
  const lines = text.split('\n');
  const out = [];
  let list = [];
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong> : part);
  const flush = () => { if (list.length) { out.push(<ul key={`l${out.length}`}>{list}</ul>); list = []; } };
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
    if (m) list.push(<li key={i}>{inline(m[1], i)}</li>);
    else { flush(); if (line.trim()) out.push(<p key={i}>{inline(line, i)}</p>); }
  });
  flush();
  return <>{out}</>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ChatAssistant() {
  const { currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role, content, results?: [] }
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null);
  const [context, setContext] = useState('');
  const [focus, setFocus] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const role = userData?.role;
  const isSupplier = role === 'supplier';
  const busy = Boolean(status);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100); }, [open]);

  // Load the user's own data once: it decides the focus, the suggestions and the model's context
  useEffect(() => {
    if (!open || !currentUser || !role || context) return;
    (async () => {
      try {
        const name = userData?.companyName || currentUser.email;
        if (isSupplier) {
          const [products, contracts, bids, tenders] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'contracts'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'bids'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'tenders'), where('status', '==', 'open')))
          ]);
          // A supplier's focus is what they actually sell: catalogue products plus products they've won contracts for
          const sells = [...new Set([...products.docs.map(d => d.data().name), ...contracts.docs.map(d => d.data().productName)])];
          const matching = tenders.docs.filter(d => !sells.length || sells.map(s => s.toLowerCase()).includes(String(d.data().productName).toLowerCase()));
          setFocus(sells);
          setSuggestions([
            sells.length ? `Show open tenders for ${sells[0]}` : 'Show open tenders',
            'How are my bids doing?',
            contracts.size ? 'Which contracts can I invoice?' : 'List my products',
            'Do I have any direct requests?'
          ]);
          setContext(`Company: ${name} (supplier). Sells: ${sells.join(', ') || 'not set yet'}. ` +
            `Open tenders matching what they sell: ${matching.length}. Bids placed: ${bids.size}. Contracts won: ${contracts.size}.`);
        } else {
          const [tenders, bills] = await Promise.all([
            getDocs(query(collection(db, 'tenders'), where('buyerId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid)))
          ]);
          const all = bills.docs.map(d => d.data());
          const flagged = all.filter(b => b.reviewStatus === 'pending_review').length;
          const unpaid = all.filter(b => b.status === 'unpaid').length;
          const products = [...new Set(tenders.docs.map(d => d.data().productName))];
          setSuggestions([
            flagged ? `Show the ${flagged} invoice${flagged > 1 ? 's' : ''} that need review` : 'How much has the AI saved me?',
            'How are my tenders doing?',
            unpaid ? 'Show my unpaid invoices' : 'Show my paid invoices',
            products[0] ? `Find catalogue suppliers for ${products[0]}` : 'Take me to tenders'
          ]);
          setContext(`Company: ${name} (buyer). Tenders: ${tenders.size} (${tenders.docs.filter(d => d.data().status === 'open').length} open). ` +
            `Invoices: ${all.length}, unpaid: ${unpaid}, flagged for review: ${flagged}. Buys: ${products.join(', ') || 'nothing yet'}.`);
        }
      } catch (e) {
        console.error(e);
        setContext('Context unavailable.');
      }
    })();
  }, [open, currentUser, userData, role, isSupplier, context]);

  const buildSystem = () =>
    `You are Tether's assistant inside a B2B procurement app where buyers post tenders, suppliers bid, and AI checks invoices. ` +
    `Use ₹ for money. Be brief and friendly; explain in simple words a student would understand.
Always call a tool when the user asks for data or an action. Results are shown to the user as boxes, so after a tool runs reply in ONE short sentence that adds insight or a next step. Never repeat the list.
${isSupplier && focus.length ? `This supplier only sells: ${focus.join(', ')}. Keep the conversation to these products and do not suggest other products unless the user asks.` : ''}
Context: ${context || 'loading'}`;

  const send = async (textArg) => {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setStatus('Thinking');

    const tools = buildTools(role);
    const ctx = { currentUser, navigate, focus };
    // The model sees plain text history; result boxes stay attached to the message that produced them
    let convo = history.map(m => ({ role: m.role, content: m.content }));
    const results = [];

    try {
      if (!GROQ_API_KEY) throw new Error('No AI key found. Add REACT_APP_GROQ_API_KEY to the .env file and restart npm start.');
      for (let i = 0; i < 5; i++) {
        const res = await fetchWithRetry(CHAT_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'system', content: buildSystem() }, ...convo],
            tools,
            tool_choice: 'auto',
            temperature: 0.4,
            max_completion_tokens: 600
          })
        });
        if (!res.ok) throw new Error(res.status === 401 ? 'The AI key in .env is not valid.' : `AI error ${res.status}. Please try again.`);
        const choice = (await res.json()).choices[0];

        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
          const call = choice.message.tool_calls[0];
          const args = JSON.parse(call.function.arguments || '{}');
          setStatus(TOOL_STATUS[call.function.name] || 'Working on it');
          const result = await executeTool(call.function.name, args, ctx);
          results.push(result);
          convo = [...convo, choice.message, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(summariseForModel(result)) }];
          setStatus('Writing a reply');
          continue;
        }

        const reply = (choice.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        setMessages(prev => [...prev, { role: 'assistant', content: reply, results }]);
        break;
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '', results: [...results, { type: 'notice', ok: false, message: err.message }] }]);
    }
    setStatus(null);
  };

  if (!currentUser) return null;

  return (
    <>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Tether assistant">
          <div className="chat-header">
            <div className="chat-header-title">
              <Sparkles size={16} />
              <span>Tether assistant</span>
            </div>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close assistant" title="Close"><X size={16} /></button>
          </div>

          {isSupplier && focus.length > 0 && (
            <div className="chat-focus">
              <Target size={13} />
              <span>Showing only what you sell: <strong>{focus.join(', ')}</strong></span>
            </div>
          )}

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="chat-welcome-title">Hi{userData?.companyName ? `, ${userData.companyName}` : ''}</div>
                <p>{isSupplier
                  ? 'I can find tenders that match what you sell, track your bids and help you invoice.'
                  : 'I can show your tenders and invoices, explain AI warnings and take you to the right page.'}</p>
                <div className="chat-suggest-label">
                  Try one of these
                </div>
                <div className="chat-suggestions">
                  {(suggestions.length ? suggestions : ['Loading suggestions…']).map(s => (
                    <button key={s} className="chat-chip" disabled={!suggestions.length} onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.results?.map((r, j) => (
                  <ResultView key={j} data={r} navigate={navigate} currentUser={currentUser} userData={userData} />
                ))}
                {m.content && (
                  <div className={`chat-bubble ${m.role}`}>
                    {m.role === 'assistant' ? <FormattedText text={m.content} /> : m.content}
                  </div>
                )}
              </div>
            ))}

            {status && (
              <div className="chat-status"><span className="spinner" /> {status}…</div>
            )}
            <div ref={bottomRef} />
          </div>

          <form className="chat-input" onSubmit={e => { e.preventDefault(); send(); }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isSupplier ? 'e.g. any new tenders for me?' : 'e.g. which invoices need my attention?'}
              disabled={busy}
              className="form-input"
            />
            <button type="submit" className="btn-primary chat-send" disabled={busy || !input.trim()} aria-label="Send" title="Send">
              <Send size={15} />
            </button>
          </form>
        </div>
      )}

      <button className="chat-fab" onClick={() => setOpen(o => !o)} title={open ? 'Close assistant' : 'Ask the Tether assistant'} aria-label="Tether assistant">
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>
    </>
  );
}
