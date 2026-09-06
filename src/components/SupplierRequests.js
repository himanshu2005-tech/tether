import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

export default function SupplierRequests() {
  const { currentUser } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // Map of reqId -> extra charge input value
  const [extraCharges, setExtraCharges] = useState({});
  const [submitting, setSubmitting] = useState({});

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'requests'),
      where('supplierId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetched = [];
      snapshot.forEach((docSnap) => {
        fetched.push({ id: docSnap.id, ...docSnap.data() });
      });
      fetched = fetched.filter(req => req.status === 'pending' || req.status === 'active');
      fetched.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setRequests(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching requests:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleDecline = async (requestId) => {
    try {
      await updateDoc(doc(db, 'requests', requestId), { status: 'rejected' });
    } catch (err) {
      alert("Failed to decline: " + err.message);
    }
  };

  const handleAcceptAndBill = async (req) => {
    setSubmitting(prev => ({ ...prev, [req.id]: true }));

    const baseAmount = Number(req.unitCost) * Number(req.quantityRequested);
    const extra = parseFloat(extraCharges[req.id] || 0);
    const totalAmount = baseAmount + (isNaN(extra) ? 0 : extra);

    let description = `${req.quantityRequested} ${req.unit || 'units'} of ${req.productName}`;
    if (!isNaN(extra) && extra > 0) {
      description += ` + ₹${extra.toFixed(2)} additional charges`;
    }

    try {
      await addDoc(collection(db, 'bills'), {
        requestId: req.id,
        supplierId: req.supplierId,
        consumerId: req.consumerId,
        productName: req.productName,
        quantityRequested: req.quantityRequested,
        unitCost: req.unitCost,
        unit: req.unit || 'units',
        baseAmount: baseAmount,
        extraCharges: isNaN(extra) ? 0 : extra,
        amount: totalAmount,
        description: description,
        status: 'unpaid',
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, 'requests', req.id), { status: 'active' });
    } catch (err) {
      console.error("Failed to send bill:", err);
      alert("Failed to send bill: " + err.message);
    }

    setSubmitting(prev => ({ ...prev, [req.id]: false }));
  };

  if (loading) {
    return (
      <div className="page-container" style={{ alignItems: 'center', paddingTop: '4rem' }}>
        <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: '600' }}>Incoming Requests</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          Review and send bills to consumers for their orders.
        </p>
      </div>

      {requests.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
          You have no pending requests at this time.
        </div>
      ) : (
        <div className="products-grid">
          {requests.map(req => {
            const baseAmount = Number(req.unitCost) * Number(req.quantityRequested);
            const extra = parseFloat(extraCharges[req.id] || 0);
            const totalAmount = baseAmount + (isNaN(extra) ? 0 : extra);
            const isActive = req.status === 'active';

            return (
              <div key={req.id} className="product-card">
                <div className="product-icon-wrapper">
                  {req.productName[0]}
                </div>
                <h4 className="product-name">{req.productName}</h4>

                <div className="product-details" style={{ flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span className="stat-label">Requested By:</span>
                    <span className="stat-value" style={{ fontWeight: '500' }}>{req.consumerName}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span className="stat-label">Quantity:</span>
                    <span className="stat-value">{req.quantityRequested} {req.unit || 'units'}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span className="stat-label">Unit Cost:</span>
                    <span className="stat-value">₹{Number(req.unitCost).toFixed(2)}</span>
                  </div>

                  {/* Auto-calculated bill preview */}
                  <div style={{ width: '100%', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span className="stat-label">Base (cost × qty):</span>
                      <span className="stat-value">₹{baseAmount.toFixed(2)}</span>
                    </div>

                    {/* Single field for personal charges */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="Additional charges (₹)"
                        min="0"
                        step="0.01"
                        value={extraCharges[req.id] || ''}
                        onChange={(e) => setExtraCharges(prev => ({ ...prev, [req.id]: e.target.value }))}
                        style={{ padding: '0.5rem 0.75rem' }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', paddingTop: '0.25rem', borderTop: '1px dashed var(--border-color)' }}>
                      <span className="stat-label" style={{ fontWeight: '700', color: 'var(--text-primary)' }}>Total Bill:</span>
                      <span className="stat-value" style={{ fontWeight: '700', fontSize: '1.0625rem' }}>₹{totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem', width: '100%', marginTop: '0.5rem' }}>
                    <button
                      onClick={() => handleAcceptAndBill(req)}
                      disabled={submitting[req.id]}
                      className="btn-primary"
                      style={{ flex: 1, padding: '0.5rem', backgroundColor: '#000', color: '#fff' }}
                    >
                      {submitting[req.id] ? 'Sending…' : isActive ? 'Send Another Bill' : 'Accept & Send Bill'}
                    </button>
                    {req.status === 'pending' && (
                      <button
                        onClick={() => handleDecline(req.id)}
                        className="btn-primary"
                        style={{ flex: 1, padding: '0.5rem', backgroundColor: 'transparent', color: 'var(--text-primary)' }}
                      >
                        Decline
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
