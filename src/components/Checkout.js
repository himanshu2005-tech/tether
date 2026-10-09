import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Star, CreditCard } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { RiskBadge, FlagList } from './Guide';
import { ApprovalProgress } from './Approvals';
import { can, ROLE_LABELS } from '../security/roles';
import { logAudit } from '../services/audit';
import { notify } from '../services/notify';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function Checkout() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const { currentUser, orgId, role } = useAuth();
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'bills', billId))
      .then(snap => {
        if (snap.exists() && snap.data().consumerId === orgId) setBill({ id: snap.id, ...snap.data() });
        else navigate('/my-orders');
      })
      .catch(err => console.error('Error fetching bill:', err))
      .finally(() => setLoading(false));
  }, [billId, currentUser, orgId, navigate]);

  const analysis = bill?.analysis;
  const isRejected = bill?.reviewStatus === 'rejected';
  // Invoices the AI puts on hold can only be paid after the buyer approves them in the Risk Center
  const isBlocked = isRejected || (analysis?.level === 'hold' && bill?.reviewStatus !== 'approved');
  const isPaid = bill?.status === 'paid';
  // Payment needs the full approval chain. Every unpaid invoice, older ones included, gets one
  // automatically when a buyer team member is online (see services/approvals.js)
  const awaitingApproval = !!bill && !isPaid && !isRejected && bill.approval?.status !== 'approved';
  const mayPay = can.pay(role);

  const pay = async () => {
    if (isBlocked || isPaid || awaitingApproval || !mayPay) return;
    if (!rating) { setError('Rate the supplier before paying.'); return; }
    setPaying(true);
    setError('');
    try {
      await updateDoc(doc(db, 'bills', bill.id), { status: 'paid', paidBy: currentUser.uid, paidAt: serverTimestamp() });
      const ref = `#${bill.invoiceNumber || bill.id.substring(0, 8).toUpperCase()}`;
      await logAudit({ action: 'PAYMENT_COMPLETED', entityType: 'invoice', entityId: bill.id, entityLabel: ref,
        previous: { status: bill.status }, next: { status: 'paid', amount: bill.amount }, meta: { supplierId: bill.supplierId, rating } });
      await notify({ userIds: [bill.supplierId] }, {
        kind: 'payment_completed', severity: 'info', title: `Invoice ${ref} paid`,
        message: `${money(bill.amount)} for ${bill.productName} was paid.`, entityType: 'invoice', entityId: bill.id, link: '/my-invoices'
      });
      await addDoc(collection(db, 'ratings'), {
        consumerId: orgId,
        ratedBy: currentUser.uid,
        supplierId: bill.supplierId,
        billId: bill.id,
        productId: bill.productId || null,
        productName: bill.productName || 'Unknown',
        rating,
        createdAt: serverTimestamp()
      });
      navigate(`/payments?id=${bill.id.substring(0, 8).toUpperCase()}`);
    } catch (err) {
      setError('Payment failed: ' + err.message);
      setPaying(false);
    }
  };

  if (loading) return <div className="page-container"><div className="empty-state"><span className="spinner" /></div></div>;
  if (!bill) return null;

  return (
    <div className="page-container narrow">
      <button className="back-link" onClick={() => navigate('/my-orders')}>‹ Invoices</button>
      <h1 className="page-title" style={{ marginBottom: '1.5rem' }}>Pay invoice</h1>

      <section className="card">
        <dl className="detail-list">
          <div><dt>Product</dt><dd>{bill.productName}</dd></div>
          <div><dt>Invoice</dt><dd className="mono">#{bill.id.substring(0, 8).toUpperCase()}</dd></div>
          <div><dt>Details</dt><dd>{bill.description}</dd></div>
          <div className="detail-total"><dt>Total</dt><dd>{money(bill.amount)}</dd></div>
        </dl>
      </section>

      {analysis && (
        <section className={`ai-panel ai-panel-${analysis.level}`}>
          <div className="row-between">
            <strong>AI invoice check</strong>
            <RiskBadge analysis={analysis} />
          </div>
          <p style={{ marginTop: '0.5rem' }}>{analysis.summary}</p>
          <FlagList flags={analysis.flags} />
          {bill.reviewStatus === 'approved' && <p className="muted" style={{ marginTop: '0.5rem' }}>You reviewed and approved this invoice.</p>}
          {isBlocked && !isRejected && (
            <button className="btn-secondary" style={{ marginTop: '0.9rem' }} onClick={() => navigate('/risk')}>Review in Risk Center</button>
          )}
        </section>
      )}

      {bill.approval && (
        <section className="card"><h3 className="section-title">Approvals</h3><ApprovalProgress approval={bill.approval} /></section>
      )}

      {!isPaid && !isBlocked && !awaitingApproval && mayPay && (
        <section className="card">
          <h3 className="section-title">Rate the supplier</h3>
          <div className="stars" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" className="star-btn" aria-label={`${n} star${n > 1 ? 's' : ''}`}
                onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}>
                <Star size={26} className={(hover || rating) >= n ? 'star on' : 'star'} />
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: '0.4rem' }}>Ratings help you compare suppliers later.</p>
        </section>
      )}

      {error && <div className="error-message">{error}</div>}

      <button onClick={pay} disabled={paying || isBlocked || isPaid || awaitingApproval || !mayPay} className="btn-primary btn-block">
        {paying ? <span className="spinner" />
          : isPaid ? 'Already paid'
          : isRejected ? 'Invoice rejected'
          : isBlocked ? 'On hold: review required'
          : awaitingApproval ? (bill.approval ? `Waiting for ${ROLE_LABELS[bill.approval.nextRole]} approval` : 'Waiting for AI validation')
          : !mayPay ? 'Only an admin or finance manager can pay'
          : <><CreditCard size={18} /> Pay {money(bill.amount)}</>}
      </button>
    </div>
  );
}
