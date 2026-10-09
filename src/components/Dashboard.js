import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, getDocs, doc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, Sparkles, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { chat } from '../ai/llm';
import { PageHeader } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Turns "50 laptops under ₹50,000" into { product_name, min_quantity, max_price }. Falls back to the raw text.
async function understand(text, products) {
  const out = await chat([
    { role: 'system', content: `Extract a product search. Reply with JSON only: {"product_name": string|null, "min_quantity": number|null, "max_price": number|null}. product_name must be one of: ${products.join(', ')}` },
    { role: 'user', content: text }
  ], { json: true, maxTokens: 120 });
  try {
    const p = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    if (p.product_name) return p;
  } catch { /* fall through */ }
  const match = products.find(p => text.toLowerCase().includes(p.toLowerCase().replace(/s$/, '')));
  return { product_name: match || text, min_quantity: null, max_price: null };
}

export default function Dashboard() {
  const { currentUser, userData, orgId } = useAuth();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const [results, setResults] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [qty, setQty] = useState({});
  const [requested, setRequested] = useState({});

  const run = useCallback(async (raw) => {
    if (!raw.trim()) return;
    setSearching(true);
    setError('');
    setResults(null);
    try {
      const all = await getDocs(collection(db, 'products'));
      const names = [...new Set([...PREDEFINED_PRODUCTS, ...all.docs.map(d => d.data().name).filter(Boolean)])];
      const p = await understand(raw, names);
      setParsed(p);

      const limitsDoc = await getDoc(doc(db, 'limits', orgId)).catch(() => null);
      const limit = limitsDoc?.exists() ? (limitsDoc.data().limits || {})[p.product_name] : null;

      let rows = all.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(r => String(r.name).toLowerCase() === String(p.product_name).toLowerCase()
          || String(r.name).toLowerCase().includes(String(p.product_name).toLowerCase()));
      if (p.min_quantity) rows = rows.filter(r => r.quantity >= p.min_quantity);
      if (p.max_price) rows = rows.filter(r => r.cost <= p.max_price);

      rows = await Promise.all(rows.map(async r => {
        if (!r.companyName && r.supplierId) {
          const u = await getDoc(doc(db, 'users', r.supplierId)).catch(() => null);
          if (u?.exists()) r.companyName = u.data().companyName || u.data().email;
        }
        return { ...r, overLimit: limit && r.cost > limit ? r.cost - limit : 0 };
      }));
      rows.sort((a, b) => a.cost - b.cost);
      setResults(rows);
      if (p.min_quantity) setQty(Object.fromEntries(rows.map(r => [r.id, p.min_quantity])));
    } catch (err) {
      setError('Search failed: ' + err.message);
      setResults([]);
    }
    setSearching(false);
  }, [orgId]);

  // A product picked in the top search bar arrives as ?q=
  useEffect(() => {
    const q = params.get('q');
    if (q) { setText(q); run(q); }
  }, [params, run]);

  const submit = (e) => {
    e.preventDefault();
    setParams(text.trim() ? { q: text.trim() } : {});
  };

  const request = async (item) => {
    const n = parseInt(qty[item.id], 10);
    if (!n) return;
    setRequested(p => ({ ...p, [item.id]: 'loading' }));
    try {
      await addDoc(collection(db, 'requests'), {
        consumerId: orgId,
        requestedBy: currentUser.uid,
        consumerName: userData?.companyName || currentUser.email,
        supplierId: item.supplierId,
        productId: item.id,
        productName: item.name,
        quantityRequested: n,
        unitCost: item.cost,
        unit: item.unit || 'units',
        totalCost: n * item.cost,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setRequested(p => ({ ...p, [item.id]: 'done' }));
    } catch (err) {
      setRequested(p => ({ ...p, [item.id]: null }));
      setError('Could not send request: ' + err.message);
    }
  };

  return (
    <div className="page-container">
      <PageHeader title="Catalogue" subtitle="For small, quick purchases. Order directly from suppliers' listed stock." />

      <form className="search-hero" onSubmit={submit}>
        <Sparkles size={18} />
        <input
          className="search-hero-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What do you need? e.g. 50 laptops under ₹50,000"
        />
        <button className="btn-primary" style={{ marginTop: 0 }} disabled={searching || !text.trim()}>
          {searching ? <span className="spinner" /> : <><Search size={15} /> Search</>}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {parsed && results && (
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Showing <b>{parsed.product_name}</b>
          {parsed.min_quantity ? `, at least ${parsed.min_quantity}` : ''}
          {parsed.max_price ? `, up to ${money(parsed.max_price)} each` : ''}, cheapest first.
        </p>
      )}

      {results && results.length === 0 && !searching && (
        <div className="empty-state">No supplier lists this yet. For larger orders, post a tender instead.</div>
      )}

      {results && results.length > 0 && (
        <div className="list">
          {results.map(item => (
            <div key={item.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{item.companyName || 'Supplier'}</div>
                <div className="list-sub">{item.name} · {item.quantity} {item.unit || 'units'} available</div>
                {item.overLimit > 0 && (
                  <div className="row-warning"><AlertTriangle size={13} /> {money(item.overLimit)} above your spending limit</div>
                )}
              </div>
              <div className="list-meta">
                <span className="list-amount">{money(item.cost)} <span className="list-unit">/ {item.unit === 'units' ? 'unit' : item.unit || 'unit'}</span></span>
                {requested[item.id] === 'done' ? (
                  <span className="status-pill status-active">Requested</span>
                ) : (
                  <>
                    <input type="number" min="1" max={item.quantity} placeholder="Qty" className="form-input qty-input"
                      value={qty[item.id] || ''} onChange={e => setQty(p => ({ ...p, [item.id]: e.target.value }))} />
                    <button className="btn-primary btn-sm" style={{ marginTop: 0 }}
                      disabled={!qty[item.id] || requested[item.id] === 'loading' || item.overLimit > 0}
                      title={item.overLimit > 0 ? 'Above your spending limit' : 'Ask this supplier for the quantity'}
                      onClick={() => request(item)}>
                      Request
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
