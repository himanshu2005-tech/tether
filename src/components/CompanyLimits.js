import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { INDUSTRIES } from '../constants/products';
import { PageHeader } from './Guide';

export default function CompanyLimits() {
  const { currentUser, orgId } = useAuth();
  const [limits, setLimits] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // Industries that already had limits when the page loaded start expanded
  const [startOpen, setStartOpen] = useState([]);

  useEffect(() => {
    if (!currentUser) return;
    getDoc(doc(db, 'limits', orgId))
      .then(snap => {
        const saved = snap.exists() ? snap.data().limits || {} : {};
        setLimits(saved);
        setStartOpen(INDUSTRIES.filter(i => i.products.some(p => saved[p])).map(i => i.id));
      })
      .catch(err => console.error('Failed to fetch limits:', err))
      .finally(() => setLoading(false));
  }, [currentUser, orgId]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const cleaned = {};
    Object.entries(limits).forEach(([k, v]) => {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) cleaned[k] = n;
    });
    try {
      await setDoc(doc(db, 'limits', orgId), { limits: cleaned, updatedAt: serverTimestamp() });
      setMessage({ ok: true, text: 'Limits saved.' });
    } catch (err) {
      setMessage({ ok: false, text: 'Could not save: ' + err.message });
    }
    setSaving(false);
  };

  if (loading) return <div className="page-container"><div className="empty-state"><span className="spinner" /></div></div>;

  return (
    <div className="page-container narrow">
      <PageHeader title="Spending limits" subtitle="The most you'll pay per unit when buying from the catalogue. Leave blank for no limit." />

      <form onSubmit={handleSave}>
        {INDUSTRIES.map(ind => (
          <details key={ind.id} className="group-block" open={startOpen.includes(ind.id)}>
            <summary>
              <span>{ind.name}</span>
              <span className="muted">{ind.products.filter(p => limits[p]).length || 'No'} limit{ind.products.filter(p => limits[p]).length === 1 ? '' : 's'} set</span>
            </summary>
            <div className="list">
              {ind.products.map(product => (
                <label key={product} className="list-row">
                  <span className="list-title">{product}</span>
                  <span className="input-prefix">
                    <span>₹</span>
                    <input type="number" className="form-input" min="0" step="0.01" placeholder="No limit"
                      value={limits[product] || ''} onChange={e => setLimits(prev => ({ ...prev, [product]: e.target.value }))} />
                  </span>
                </label>
              ))}
            </div>
          </details>
        ))}
        <div className="form-actions">
          {message && <span className={message.ok ? 'text-success' : 'text-error'}>{message.text}</span>}
          <button disabled={saving} className="btn-primary" type="submit">{saving ? 'Saving…' : 'Save limits'}</button>
        </div>
      </form>
    </div>
  );
}
