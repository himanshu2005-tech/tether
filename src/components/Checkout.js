import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Star, ShieldCheck, CreditCard, ChevronLeft } from 'lucide-react';
import { RiskBadge, FlagList } from './Guide';

export default function Checkout() {
  const { billId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);

  useEffect(() => {
    const fetchBill = async () => {
      try {
        const docRef = doc(db, 'bills', billId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().consumerId === currentUser.uid) {
          setBill({ id: docSnap.id, ...docSnap.data() });
        } else {
          alert("Bill not found or access denied.");
          navigate('/my-orders');
        }
      } catch (err) {
        console.error("Error fetching bill:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchBill();
  }, [billId, currentUser, navigate]);

  const analysis = bill?.analysis;
  const isRejected = bill?.reviewStatus === 'rejected';
  // Invoices the AI puts on hold can only be paid after the buyer approves them in the Risk Center
  const isBlocked = isRejected || (analysis?.level === 'hold' && bill?.reviewStatus !== 'approved');

  const handlePayment = async () => {
    if (isBlocked) return;
    if (rating === 0) {
      alert("Please rate the supplier before paying!");
      return;
    }
    setPaying(true);
    
    try {
      // Mark bill as paid
      await updateDoc(doc(db, 'bills', bill.id), { status: 'paid' });
      
      // Save the rating
      await addDoc(collection(db, 'ratings'), {
        consumerId: currentUser.uid,
        supplierId: bill.supplierId,
        billId: bill.id,
        productId: bill.productId || null,
        productName: bill.productName || 'Unknown',
        rating: rating,
        createdAt: serverTimestamp()
      });
      
      navigate('/my-orders');
    } catch (err) {
      console.error("Payment error:", err);
      alert("Payment failed: " + err.message);
      setPaying(false);
    }
  };

  if (loading) return <div className="page-container"><span className="spinner"></span></div>;
  if (!bill) return null;

  return (
    <div className="page-container" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <button onClick={() => navigate('/my-orders')} className="btn-secondary" style={{ marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', color: 'var(--text-primary)', backgroundColor: 'transparent', border: '1px solid var(--border-color)' }}>
        <ChevronLeft size={18} /> Back to Orders
      </button>

      <div style={{ backgroundColor: 'var(--surface-color)', padding: '2rem', borderRadius: '1rem', border: '1px solid var(--border-color)', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck color="var(--primary-color)" /> Secure Checkout
        </h2>

        <div style={{ backgroundColor: 'var(--background-color)', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Paying for</p>
          <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>{bill.productName}</h3>
          <p style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Bill #{bill.id.substring(0, 8).toUpperCase()}</p>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <span style={{ fontWeight: '500' }}>Total Amount</span>
            <span style={{ fontSize: '1.5rem', fontWeight: '700' }}>₹{Number(bill.amount).toFixed(2)}</span>
          </div>
        </div>

        {analysis && (
          <div className={`ai-panel ai-panel-${analysis.level}`} style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>Tether AI invoice check</strong>
              <RiskBadge analysis={analysis} />
            </div>
            <p style={{ marginTop: '0.5rem' }}>{analysis.summary}</p>
            <FlagList flags={analysis.flags} />
            {bill.reviewStatus === 'approved' && <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>You reviewed and approved this invoice.</p>}
            {isBlocked && !isRejected && (
              <button className="btn-secondary" style={{ marginTop: '0.75rem' }} onClick={() => navigate('/risk')}>
                Review in Risk Center
              </button>
            )}
          </div>
        )}
        {!analysis && bill.contractId && (
          <p style={{ marginBottom: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            This invoice has not been checked by Tether AI yet. You can run the check from the Risk Center.
          </p>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h4 style={{ fontWeight: '500', marginBottom: '0.75rem' }}>Rate Supplier before paying</h4>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={32}
                fill={(hoverRating || rating) >= star ? '#eab308' : 'none'}
                color={(hoverRating || rating) >= star ? '#eab308' : 'var(--text-secondary)'}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              />
            ))}
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            Your rating helps Tether AI suggest better suppliers in the future!
          </p>
        </div>

        <button 
          onClick={handlePayment} 
          disabled={paying || isBlocked}
          className="btn-primary" 
          style={{ width: '100%', padding: '1rem', fontSize: '1.1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
        >
          {paying ? <span className="spinner"></span>
            : isRejected ? 'Invoice rejected'
            : isBlocked ? 'Payment on hold: review required'
            : <><CreditCard size={20} /> Pay ₹{Number(bill.amount).toFixed(2)}</>}
        </button>
      </div>
    </div>
  );
}
