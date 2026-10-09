import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { PageHeader } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function SupplierRequests() {
  const { currentUser } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [extraCharges, setExtraCharges] = useState({});
  const [submitting, setSubmitting] = useState({});

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.status === 'pending' || r.status === 'active')
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setRequests(list);
      setLoading(false);
    }, () => setLoading(false));
  }, [currentUser]);

  const handleDecline = async (id) => {
    try {
      await updateDoc(doc(db, 'requests', id), { status: 'rejected' });
    } catch (err) {
      alert('Could not decline: ' + err.message);
    }
  };

  const handleBill = async (req) => {
    setSubmitting(prev => ({ ...prev, [req.id]: true }));
    const base = Number(req.unitCost) * Number(req.quantityRequested);
    const extra = parseFloat(extraCharges[req.id] || 0) || 0;
    let description = `${req.quantityRequested} ${req.unit || 'units'} of ${req.productName}`;
    if (extra > 0) description += ` + ₹${extra.toFixed(2)} additional charges`;
    try {
      await addDoc(collection(db, 'bills'), {
        requestId: req.id,
        supplierId: req.supplierId,
        consumerId: req.consumerId,
        productName: req.productName,
        quantityRequested: req.quantityRequested,
        unitCost: req.unitCost,
        unit: req.unit || 'units',
        baseAmount: base,
        extraCharges: extra,
        amount: base + extra,
        description,
        status: 'unpaid',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'requests', req.id), { status: 'active' });
      setExtraCharges(prev => ({ ...prev, [req.id]: '' }));
    } catch (err) {
      alert('Could not send bill: ' + err.message);
    }
    setSubmitting(prev => ({ ...prev, [req.id]: false }));
  };

  if (loading) return <div className="page-container"><div className="empty-state"><span className="spinner" /></div></div>;

  return (
    <div className="page-container">
      <PageHeader title="Direct requests" subtitle="Buyers ordering from your catalogue. Add any extra charges and send them a bill." />

      {requests.length === 0 ? (
        <div className="empty-state">No requests right now.</div>
      ) : (
        <div className="list">
          {requests.map(req => {
            const base = Number(req.unitCost) * Number(req.quantityRequested);
            const extra = parseFloat(extraCharges[req.id] || 0) || 0;
            return (
              <div key={req.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">{req.productName} · {req.quantityRequested} {req.unit || 'units'}</div>
                  <div className="list-sub">{req.consumerName} · {money(req.unitCost)} each · base {money(base)}</div>
                </div>
                <div className="list-meta">
                  <span className={`status-pill status-${req.status === 'active' ? 'active' : 'closed'}`}>{req.status === 'active' ? 'Billed' : 'New'}</span>
                  <input type="number" min="0" step="0.01" placeholder="Extra ₹" className="form-input qty-input"
                    value={extraCharges[req.id] || ''} onChange={e => setExtraCharges(prev => ({ ...prev, [req.id]: e.target.value }))} />
                  <button className="btn-primary btn-sm" style={{ marginTop: 0 }} disabled={submitting[req.id]} onClick={() => handleBill(req)}>
                    {submitting[req.id] ? 'Sending…' : `${req.status === 'active' ? 'Bill again' : 'Send bill'} · ${money(base + extra)}`}
                  </button>
                  {req.status === 'pending' && (
                    <button className="btn-secondary btn-sm" onClick={() => handleDecline(req.id)}>Decline</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
