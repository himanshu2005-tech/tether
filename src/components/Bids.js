import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { ChevronRight } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { PageHeader, LevelBadge, LoadState } from './Guide';
import { riskLevel } from '../risk/supplierRisk';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STATUS = { submitted: 'Waiting', awarded: 'Awarded', rejected: 'Not selected' };

// Every bid across the organisation's tenders (buyer), or the supplier's own bids
export default function Bids() {
  const { currentUser, userData, orgId } = useAuth();
  const isSupplier = userData?.role === 'supplier';
  const [bids, setBids] = useState(null);
  const [tenders, setTenders] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentUser) return undefined;
    const q = isSupplier
      ? query(collection(db, 'bids'), where('supplierId', '==', currentUser.uid))
      : query(collection(db, 'bids'), where('buyerId', '==', orgId));
    return onSnapshot(q, snap => setBids(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))),
      err => setError(err.message));
  }, [currentUser, isSupplier, orgId]);

  // Tender titles and AI results for each bid
  useEffect(() => {
    if (!bids?.length) return;
    const q = isSupplier ? null : query(collection(db, 'tenders'), where('buyerId', '==', orgId));
    if (q) getDocs(q).then(s => setTenders(Object.fromEntries(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])))).catch(() => {});
  }, [bids, isSupplier, orgId]);

  const aiFor = (b) => tenders[b.tenderId]?.aiAnalysis?.bids?.find(r => r.bidId === b.id);

  return (
    <div className="page-container">
      <PageHeader title={isSupplier ? 'My bids' : 'Bids'}
        subtitle={isSupplier ? 'Offers you have sent and whether they won.' : 'Every bid on your tenders, with its AI risk score. Open a tender to compare bids side by side.'} />
      {bids === null ? <LoadState loading={!error} error={error} /> : bids.length === 0 ? (
        <div className="empty-state">{isSupplier ? "You haven't bid on anything yet." : 'No bids yet.'}</div>
      ) : (
        <div className="list">
          {bids.map(b => {
            const ai = aiFor(b);
            return (
              <Link key={b.id} to={`/tenders/${b.tenderId}`} className="list-row">
                <div className="list-main">
                  <div className="list-title">{isSupplier ? (b.tenderTitle || 'Tender') : b.supplierName}</div>
                  <div className="list-sub">
                    {!isSupplier && `${tenders[b.tenderId]?.title || 'Tender'} · `}{money(b.unitPrice)} per unit · {b.quantity} units · {b.deliveryDays} days
                  </div>
                </div>
                <div className="list-meta">
                  {ai && <LevelBadge level={riskLevel(ai.riskScore)} score={ai.riskScore} compact />}
                  {ai && <span className="list-count">Value {ai.valueScore}/100</span>}
                  <span className={`status-pill status-${b.status}`}>{STATUS[b.status] || b.status}</span>
                  <ChevronRight size={18} className="list-chevron" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
