import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { analyzeTenderBids, extractTerms, getBidGuidance } from '../api';
import { RiskBadge, FlagList, AiTag, InfoTip } from './Guide';
import { Sparkles } from 'lucide-react';
import { db } from '../firebase';
import {
  doc, onSnapshot, collection, query, where, addDoc, updateDoc,
  increment, serverTimestamp, writeBatch
} from 'firebase/firestore';

export default function TenderDetail() {
  const { tenderId } = useParams();
  const navigate = useNavigate();
  const { currentUser, userData } = useAuth();
  const [tender, setTender] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState('');
  const autoAnalyzedFor = useRef(null);
  const [guidance, setGuidance] = useState(null);

  const priceRef = useRef();
  const qtyRef = useRef();
  const daysRef = useRef();
  const proposalRef = useRef();

  const isOwner = tender && currentUser && tender.buyerId === currentUser.uid;
  const isSupplier = userData?.role === 'supplier';
  const myBid = bids.find(b => b.supplierId === currentUser?.uid);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'tenders', tenderId), (snap) => {
      setTender(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [tenderId]);

  useEffect(() => {
    if (!tender || !currentUser) return;
    // The buyer sees every bid; a supplier sees only their own
    const q = isOwner
      ? query(collection(db, 'bids'), where('tenderId', '==', tenderId))
      : query(collection(db, 'bids'), where('tenderId', '==', tenderId), where('supplierId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => a.unitPrice - b.unitPrice);
      setBids(list);
    });
    return unsubscribe;
  }, [tender, tenderId, isOwner, currentUser]);

  // Suppliers get AI price guidance before bidding
  const canBid = isSupplier && !myBid && tender?.status === 'open';
  useEffect(() => {
    if (!canBid || guidance) return;
    getBidGuidance(tender, userData?.description || '').then(setGuidance).catch(() => setGuidance({ unavailable: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBid]);

  const analysis = tender?.aiAnalysis;
  const analysisFor = (bidId) => analysis?.bids?.find(r => r.bidId === bidId);

  const handleAnalyze = async () => {
    if (!bids.length) return;
    setAnalyzing(true);
    setAiError('');
    try {
      const result = await analyzeTenderBids(tender, bids);
      await updateDoc(doc(db, 'tenders', tenderId), {
        aiAnalysis: { ...result, bidCount: bids.length, analyzedAt: new Date().toISOString() }
      });
    } catch (err) {
      setAiError(err.message);
    }
    setAnalyzing(false);
  };

  // Re-run the analysis automatically whenever the buyer opens a tender with new bids
  useEffect(() => {
    if (!isOwner || tender?.status === 'awarded' || !bids.length) return;
    if (analysis?.bidCount === bids.length || autoAnalyzedFor.current === bids.length) return;
    autoAnalyzedFor.current = bids.length;
    handleAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, bids.length, analysis?.bidCount, tender?.status]);

  const handlePlaceBid = async (e) => {
    e.preventDefault();
    setError('');
    const unitPrice = parseFloat(priceRef.current.value);
    const quantity = parseInt(qtyRef.current.value, 10);
    const deliveryDays = parseInt(daysRef.current.value, 10);
    if (isNaN(unitPrice) || isNaN(quantity) || isNaN(deliveryDays)) {
      setError('Please fill out all fields correctly.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'bids'), {
        tenderId: tenderId,
        buyerId: tender.buyerId,
        supplierId: currentUser.uid,
        supplierName: userData?.companyName || currentUser.email,
        unitPrice: unitPrice,
        quantity: quantity,
        totalAmount: unitPrice * quantity,
        deliveryDays: deliveryDays,
        proposal: proposalRef.current.value,
        status: 'submitted',
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'tenders', tenderId), { bidCount: increment(1) });
    } catch (err) {
      setError('Failed to place bid: ' + err.message);
    }
    setIsSubmitting(false);
  };

  const handleCloseBidding = async () => {
    await updateDoc(doc(db, 'tenders', tenderId), { status: 'closed' });
  };

  const handleAward = async (winningBid) => {
    if (!window.confirm(`Award this contract to ${winningBid.supplierName} at ₹${winningBid.unitPrice.toFixed(2)}/${tender.unit}?`)) return;
    setIsSubmitting(true);
    try {
      // Module 2: the LLM reads the free-text terms into checkable fields (null if the service is down)
      const extractedTerms = tender.terms ? await extractTerms(tender.terms).catch(() => null) : null;

      // The contract becomes the ground truth that later invoices are validated against
      const contractRef = await addDoc(collection(db, 'contracts'), {
        tenderId: tenderId,
        bidId: winningBid.id,
        buyerId: tender.buyerId,
        buyerName: tender.buyerName,
        supplierId: winningBid.supplierId,
        supplierName: winningBid.supplierName,
        title: tender.title,
        productName: tender.productName,
        unit: tender.unit,
        agreedUnitPrice: winningBid.unitPrice,
        maxQuantity: winningBid.quantity,
        quantityInvoiced: 0,
        amountInvoiced: 0,
        deliveryDays: winningBid.deliveryDays,
        terms: tender.terms || '',
        extractedTerms: extractedTerms,
        status: 'active',
        createdAt: serverTimestamp()
      });

      const batch = writeBatch(db);
      batch.update(doc(db, 'tenders', tenderId), {
        status: 'awarded',
        awardedBidId: winningBid.id,
        awardedSupplierId: winningBid.supplierId,
        contractId: contractRef.id
      });
      bids.forEach(b => {
        batch.update(doc(db, 'bids', b.id), { status: b.id === winningBid.id ? 'awarded' : 'rejected' });
      });
      await batch.commit();
      navigate('/contracts');
    } catch (err) {
      setError('Failed to award contract: ' + err.message);
    }
    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ alignItems: 'center', paddingTop: '4rem' }}>
        <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
      </div>
    );
  }

  if (!tender) {
    return <div className="page-container"><p>Tender not found.</p></div>;
  }

  const lowestPrice = bids.length ? Math.min(...bids.map(b => b.unitPrice)) : null;

  return (
    <div className="page-container">
      <button className="back-link" onClick={() => navigate('/tenders')}>‹ Tenders</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <span className={`status-pill status-${tender.status}`}>{tender.status}</span>
          <h1 className="page-title" style={{ marginTop: '0.6rem' }}>{tender.title}</h1>
          <p className="page-subtitle">Posted by {tender.buyerName}</p>
        </div>
        {isOwner && tender.status === 'open' && (
          <button className="btn-secondary" onClick={handleCloseBidding}>Close bidding</button>
        )}
      </div>

      <div className="product-details spec-strip">
        <div className="product-stat"><span className="stat-label">Product</span><span className="stat-value">{tender.productName}</span></div>
        <div className="product-stat"><span className="stat-label">Quantity</span><span className="stat-value">{tender.quantity} {tender.unit}</span></div>
        <div className="product-stat"><span className="stat-label">Max unit price</span><span className="stat-value">₹{Number(tender.maxUnitPrice).toFixed(2)}</span></div>
        <div className="product-stat"><span className="stat-label">Bids close</span><span className="stat-value">{tender.bidDeadline}</span></div>
        <div className="product-stat"><span className="stat-label">Deliver by</span><span className="stat-value">{tender.deliveryBy}</span></div>
      </div>

      {tender.terms && (
        <div className="terms-block">
          <h3 className="section-title">Contract terms</h3>
          <p>{tender.terms}</p>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {/* Supplier: place a bid */}
      {canBid && (
        <div className="form-container">
          <h3 className="section-title">Your bid</h3>

          {guidance && !guidance.unavailable && (
            <div className="guidance">
              <div className="guidance-head">
                <AiTag term="priceGuidance">Price guidance</AiTag>
                <span className="guidance-basis">Based on {guidance.basis}</span>
              </div>
              <div className="guidance-range">
                <div>
                  <div className="stat-label">Competitive range</div>
                  <div className="guidance-value">₹{guidance.low.toLocaleString('en-IN')} – ₹{guidance.high.toLocaleString('en-IN')}</div>
                </div>
                <button type="button" className="btn-secondary" onClick={() => { priceRef.current.value = guidance.suggested; }}>
                  Use ₹{guidance.suggested.toLocaleString('en-IN')}
                </button>
              </div>
              <p className="guidance-tip">{guidance.tip}</p>
            </div>
          )}
          {!guidance && <p className="muted" style={{ marginBottom: '1rem' }}><span className="spinner" /> Getting AI price guidance…</p>}

          <form onSubmit={handlePlaceBid} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="price">Unit price (₹)</label>
                <input type="number" id="price" className="form-input" ref={priceRef} required min="0.01" step="0.01" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="qty">Quantity you can supply</label>
                <input type="number" id="qty" className="form-input" ref={qtyRef} required min="1" defaultValue={tender.quantity} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="days">Delivery (days)</label>
                <input type="number" id="days" className="form-input" ref={daysRef} required min="1" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="proposal">Proposal</label>
              <textarea id="proposal" className="form-input" ref={proposalRef} rows={4}
                placeholder="Why your company, quality certifications, warranty, payment terms..." />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button disabled={isSubmitting} className="btn-primary" type="submit">
                {isSubmitting ? 'Submitting…' : 'Submit bid'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AI evaluation summary (buyer only) */}
      {isOwner && bids.length > 0 && (
        <div className="ai-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
              <AiTag term="bidEvaluation">Bid evaluation</AiTag>
            </div>
            <button className="btn-secondary" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? 'Analyzing…' : 'Re-run analysis'}
            </button>
          </div>
          {aiError && <div className="error-message" style={{ marginTop: '0.75rem' }}>{aiError}</div>}
          {analyzing && !analysis && <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Checking prices, proposals and supplier relationships…</p>}
          {analysis && (
            <>
              <p style={{ marginTop: '0.75rem' }}>{analysis.summary}</p>
              <FlagList flags={analysis.tenderFlags} />
              {analysis.bidCount !== bids.length && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>New bids arrived since this analysis. Re-run to include them.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Bids list: all bids for the owner, own bid for a supplier */}
      {(isOwner || myBid) && (
        <div>
          <h3 style={{ fontWeight: '500', marginBottom: '1rem' }}>
            {isOwner ? `Bids received (${bids.length})` : 'Your bid'}
          </h3>
          {bids.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)' }}>
              No bids yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {bids.map(b => {
                const ai = isOwner ? analysisFor(b.id) : null;
                const recommended = isOwner && analysis?.recommendedBidId === b.id && tender.status !== 'awarded';
                return (
                <div key={b.id} className={`bid-card${recommended ? ' bid-recommended' : ''}`}>
                  {recommended && <div className="recommended-tag"><Sparkles size={14} /> AI recommended</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <strong>{b.supplierName}</strong>
                      {isOwner && b.unitPrice === lowestPrice && bids.length > 1 && (
                        <span className="status-pill status-open" style={{ marginLeft: '0.5rem' }}>lowest</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {ai && <RiskBadge analysis={ai} />}
                      <span className={`status-pill status-${b.status}`}>{b.status}</span>
                    </div>
                  </div>
                  <div className="product-details" style={{ marginTop: '0.75rem' }}>
                    <div className="product-stat"><span className="stat-label">Unit price</span><span className="stat-value">₹{b.unitPrice.toFixed(2)}</span></div>
                    <div className="product-stat"><span className="stat-label">Quantity</span><span className="stat-value">{b.quantity} {tender.unit}</span></div>
                    <div className="product-stat"><span className="stat-label">Total</span><span className="stat-value">₹{b.totalAmount.toFixed(2)}</span></div>
                    <div className="product-stat"><span className="stat-label">Delivery</span><span className="stat-value">{b.deliveryDays} days</span></div>
                  </div>
                  {b.proposal && <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{b.proposal}</p>}
                  {ai && <FlagList flags={ai.flags} />}
                  {ai && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Value score {ai.valueScore}/100<InfoTip term="valueScore" label="value score" /></div>}
                  {isOwner && tender.status !== 'awarded' && (
                    <button className="btn-primary" disabled={isSubmitting} onClick={() => handleAward(b)} style={{ marginTop: '1rem' }}>
                      Award contract
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
