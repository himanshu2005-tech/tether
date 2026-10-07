import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Plus, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { draftTender } from '../api';
import { PageHeader, InfoTip } from './Guide';

const EMPTY = { title: '', productName: '', quantity: '', unit: 'units', maxUnitPrice: '', bidDeadline: '', deliveryBy: '', terms: '' };
const UNITS = ['units', 'kg', 'tons', 'liters', 'meters', 'boxes'];

export default function Tenders() {
  const { currentUser, userData } = useAuth();
  const isBuyer = userData?.role === 'consumer';
  const [tenders, setTenders] = useState([]);
  const [myBidTenderIds, setMyBidTenderIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  const [composing, setComposing] = useState(false);
  const [brief, setBrief] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [showFields, setShowFields] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    // Buyers see their own tenders; suppliers see every open tender
    const q = isBuyer
      ? query(collection(db, 'tenders'), where('buyerId', '==', currentUser.uid))
      : query(collection(db, 'tenders'), where('status', '==', 'open'));
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setTenders(list);
      setLoading(false);
    });
  }, [currentUser, isBuyer]);

  useEffect(() => {
    if (!currentUser || isBuyer) return;
    const q = query(collection(db, 'bids'), where('supplierId', '==', currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      setMyBidTenderIds(new Set(snapshot.docs.map(d => d.data().tenderId)));
    });
  }, [currentUser, isBuyer]);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const reset = () => {
    setComposing(false);
    setBrief('');
    setForm(EMPTY);
    setShowFields(false);
    setError('');
  };

  const handleDraft = async () => {
    if (!brief.trim()) return;
    setDrafting(true);
    setError('');
    try {
      const d = await draftTender(brief, PREDEFINED_PRODUCTS);
      setForm({
        title: d.title || '',
        productName: d.productName || '',
        quantity: d.quantity ?? '',
        unit: d.unit || 'units',
        maxUnitPrice: d.maxUnitPrice ?? '',
        bidDeadline: d.bidDeadline || '',
        deliveryBy: d.deliveryBy || '',
        terms: d.terms || brief
      });
      setShowFields(true);
    } catch (err) {
      setError(err.message);
      setForm(prev => ({ ...prev, terms: brief }));
      setShowFields(true);
    }
    setDrafting(false);
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    const quantity = parseInt(form.quantity, 10);
    const maxUnitPrice = parseFloat(form.maxUnitPrice);
    if (!form.title || !form.productName || isNaN(quantity) || isNaN(maxUnitPrice) || !form.bidDeadline || !form.deliveryBy) {
      setError('A few details are missing. Check the highlighted fields.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await addDoc(collection(db, 'tenders'), {
        buyerId: currentUser.uid,
        buyerName: userData?.companyName || currentUser.email,
        title: form.title,
        productName: form.productName,
        quantity,
        unit: form.unit,
        maxUnitPrice,
        bidDeadline: form.bidDeadline,
        deliveryBy: form.deliveryBy,
        terms: form.terms,
        status: 'open',
        bidCount: 0,
        createdAt: serverTimestamp()
      });
      reset();
    } catch (err) {
      setError('Could not publish: ' + err.message);
    }
    setIsSubmitting(false);
  };

  const missing = (v) => showFields && error && (v === '' || v === null) ? ' input-missing' : '';

  return (
    <div className="page-container">
      <PageHeader
        title={isBuyer ? 'Tenders' : 'Open tenders'}
        subtitle={isBuyer
          ? 'Tell us what you need. Suppliers compete, and AI helps you pick.'
          : 'Requirements posted by buyers. Open one to bid, with AI price guidance.'}
        action={isBuyer && !composing && (
          <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => setComposing(true)}>
            <Plus size={16} /> New tender
          </button>
        )}
      />

      {composing && (
        <div className="composer">
          <label className="composer-label" htmlFor="brief">
            <Sparkles size={16} /> What do you need?
          </label>
          <textarea
            id="brief"
            className="composer-input"
            rows={3}
            autoFocus
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="e.g. 200 tons of steel beams at our Chennai plant by 15 December. Up to ₹600 a ton, all-inclusive, paid within 45 days."
          />
          <div className="composer-actions">
            <button className="link-button" style={{ marginLeft: 0 }} onClick={() => setShowFields(true)}>Fill in manually</button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-secondary" onClick={reset}>Cancel</button>
              <button className="btn-primary" style={{ marginTop: 0 }} onClick={handleDraft} disabled={drafting || !brief.trim()}>
                {drafting ? <><span className="spinner" /> Drafting…</> : <><Sparkles size={15} /> Draft with AI</>}
              </button>
            </div>
          </div>

          {showFields && (
            <form onSubmit={handlePublish} className="composer-fields">
              <p className="composer-hint">Review the details below, then publish.</p>
              <div className="field-grid">
                <Field label="Title" wide>
                  <input className={'form-input' + missing(form.title)} value={form.title} onChange={set('title')} />
                </Field>
                <Field label="Product">
                  <input className={'form-input' + missing(form.productName)} value={form.productName} onChange={set('productName')} list="tender-products" />
                  <datalist id="tender-products">{PREDEFINED_PRODUCTS.map(p => <option key={p} value={p} />)}</datalist>
                </Field>
                <Field label="Quantity">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input type="number" min="1" className={'form-input' + missing(form.quantity)} value={form.quantity} onChange={set('quantity')} />
                    <select className="form-input" style={{ maxWidth: '7.5rem' }} value={form.unit} onChange={set('unit')}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </Field>
                <Field label="Max price per unit (₹)">
                  <input type="number" min="0.01" step="0.01" className={'form-input' + missing(form.maxUnitPrice)} value={form.maxUnitPrice} onChange={set('maxUnitPrice')} />
                </Field>
                <Field label="Bids close">
                  <input type="date" className={'form-input' + missing(form.bidDeadline)} value={form.bidDeadline} onChange={set('bidDeadline')} />
                </Field>
                <Field label="Deliver by">
                  <input type="date" className={'form-input' + missing(form.deliveryBy)} value={form.deliveryBy} onChange={set('deliveryBy')} />
                </Field>
                <Field label="Contract terms" wide>
                  <textarea rows={5} className="form-input" value={form.terms} onChange={set('terms')} />
                </Field>
              </div>
              {error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Publishing…' : 'Publish tender'}
                </button>
              </div>
            </form>
          )}
          {!showFields && error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}
        </div>
      )}

      {loading ? (
        <div className="empty-state"><span className="spinner" /></div>
      ) : tenders.length === 0 ? (
        <div className="empty-state">
          {isBuyer ? 'No tenders yet. Create one and suppliers will start bidding.' : 'No open tenders right now. Check back soon.'}
        </div>
      ) : (
        <div className="list">
          {tenders.map(t => (
            <Link key={t.id} to={`/tenders/${t.id}`} className="list-row">
              <div className="list-main">
                <div className="list-title">{t.title}</div>
                <div className="list-sub">
                  {isBuyer ? t.productName : `${t.buyerName} · ${t.productName}`} · {t.quantity} {t.unit} · up to ₹{Number(t.maxUnitPrice).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="list-meta">
                {isBuyer
                  ? <span className="list-count">{t.bidCount || 0} bid{t.bidCount === 1 ? '' : 's'}</span>
                  : myBidTenderIds.has(t.id) && <span className="status-pill status-awarded">Bid placed</span>}
                <span className={`status-pill status-${t.status}`}>{t.status}</span>
                <ChevronRight size={18} className="list-chevron" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, wide, tip, children }) {
  return (
    <div className={`form-group${wide ? ' field-wide' : ''}`}>
      <label className="form-label">{label}{tip && <InfoTip term={tip} label={label} />}</label>
      {children}
    </div>
  );
}
