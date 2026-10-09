import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { PageHeader } from './Guide';

const UNITS = ['units', 'kg', 'tons', 'liters', 'meters', 'boxes'];
const EMPTY = { name: '', quantity: '', unit: 'units', cost: '' };

export default function MyProducts() {
  const { currentUser, userData } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchProducts = useCallback(async () => {
    if (!currentUser) return;
    try {
      const snap = await getDocs(query(collection(db, 'products'), where('supplierId', '==', currentUser.uid)));
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error fetching products:', err);
    }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleAdd = async (e) => {
    e.preventDefault();
    const quantity = parseInt(form.quantity, 10);
    const cost = parseFloat(form.cost);
    if (!form.name.trim() || isNaN(quantity) || isNaN(cost)) {
      setError('Fill in the product, quantity and price.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await addDoc(collection(db, 'products'), {
        supplierId: currentUser.uid,
        companyName: userData?.companyName || currentUser.email,
        name: form.name.trim(),
        quantity,
        unit: form.unit,
        cost,
        createdAt: serverTimestamp()
      });
      setForm(EMPTY);
      setAdding(false);
      await fetchProducts();
    } catch (err) {
      setError('Could not add product: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <div className="page-container">
      <PageHeader
        title="My catalogue"
        subtitle="Stock buyers can order directly. These products also decide which tenders the assistant shows you."
        action={!adding && <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => setAdding(true)}><Plus size={16} /> Add product</button>}
      />

      {adding && (
        <form className="card form-card" onSubmit={handleAdd}>
          <div className="field-grid">
            <div className="form-group field-wide">
              <label className="form-label" htmlFor="p-name">Product</label>
              <input id="p-name" className="form-input" list="product-list" value={form.name} onChange={set('name')} placeholder="e.g. Steel Beams" autoFocus />
              <datalist id="product-list">{PREDEFINED_PRODUCTS.map(p => <option key={p} value={p} />)}</datalist>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="p-qty">Quantity in stock</label>
              <input id="p-qty" type="number" min="1" className="form-input" value={form.quantity} onChange={set('quantity')} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="p-unit">Unit</label>
              <select id="p-unit" className="form-input" value={form.unit} onChange={set('unit')}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="p-cost">Price per unit (₹)</label>
              <input id="p-cost" type="number" min="0.01" step="0.01" className="form-input" value={form.cost} onChange={set('cost')} />
            </div>
          </div>
          {error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setForm(EMPTY); setError(''); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="empty-state"><span className="spinner" /></div>
      ) : products.length === 0 ? (
        <div className="empty-state">Nothing listed yet. Add a product so buyers can order it.</div>
      ) : (
        <div className="list">
          {products.map(p => (
            <div key={p.id} className="list-row">
              <div className="list-main">
                <div className="list-title">{p.name}</div>
                <div className="list-sub">{p.quantity} {p.unit || 'units'} in stock</div>
              </div>
              <div className="list-meta">
                <span className="list-amount">₹{Number(p.cost).toLocaleString('en-IN', { maximumFractionDigits: 2 })} <span className="list-unit">/ {p.unit === 'units' ? 'unit' : p.unit || 'unit'}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
