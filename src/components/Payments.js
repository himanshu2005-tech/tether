import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { PageHeader } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Receipt for a paid invoice. Opened from the top search bar (/payments?id=A1B2C3D4).
export default function Payments() {
  const { currentUser, orgId } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = (params.get('id') || '').replace('#', '').trim().toUpperCase();
  const [receipt, setReceipt] = useState(undefined);

  useEffect(() => {
    if (!id || !currentUser) { setReceipt(null); return; }
    setReceipt(undefined);
    getDocs(query(collection(db, 'bills'), where('consumerId', '==', orgId), where('status', '==', 'paid')))
      .then(snap => {
        const d = snap.docs.find(x => x.id.substring(0, 8).toUpperCase() === id);
        setReceipt(d ? { id: d.id, ...d.data() } : null);
      })
      .catch(() => setReceipt(null));
  }, [id, currentUser, orgId]);

  return (
    <div className="page-container narrow">
      <PageHeader title="Receipt" subtitle="Proof of a completed payment. Find any invoice using the search bar at the top." />

      {receipt === undefined && <div className="empty-state"><span className="spinner" /></div>}

      {receipt === null && (
        <div className="empty-state">
          <XCircle size={28} />
          {id ? <>No paid invoice with ID <b>#{id}</b> in your account.</> : 'Search for an invoice ID in the bar at the top.'}
          <button className="btn-secondary" onClick={() => navigate('/my-orders')}>See all invoices</button>
        </div>
      )}

      {receipt && (
        <div className="receipt">
          <div className="receipt-head">
            <CheckCircle2 size={36} />
            <div className="receipt-title">Payment confirmed</div>
            <div className="receipt-id">#{id}</div>
          </div>
          <dl className="receipt-body">
            <div><dt>Product</dt><dd>{receipt.productName}</dd></div>
            <div><dt>Description</dt><dd>{receipt.description}</dd></div>
            <div><dt>Date</dt><dd>{receipt.createdAt ? new Date(receipt.createdAt.toMillis()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd></div>
            <div className="receipt-total"><dt>Total paid</dt><dd>{money(receipt.amount)}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}
