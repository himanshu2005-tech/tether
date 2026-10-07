import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { getBriefing } from '../api';
import { AiTag, InfoTip } from './Guide';
import GettingStarted from './GettingStarted';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

async function loadBuyerStats(uid) {
  const [tendersSnap, contractsSnap, billsSnap] = await Promise.all([
    getDocs(query(collection(db, 'tenders'), where('buyerId', '==', uid))),
    getDocs(query(collection(db, 'contracts'), where('buyerId', '==', uid))),
    getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid)))
  ]);
  const tenders = tendersSnap.docs.map(d => d.data());
  const bills = billsSnap.docs.map(d => d.data());
  const open = tenders.filter(t => t.status === 'open');
  return {
    tenders: tenders.length,
    openTenders: open.length,
    bidsReceived: open.reduce((s, t) => s + (t.bidCount || 0), 0),
    contracts: contractsSnap.size,
    checkedInvoices: bills.filter(b => b.analysis).length,
    pendingReview: bills.filter(b => b.reviewStatus === 'pending_review').length,
    unpaid: bills.filter(b => b.status === 'unpaid' && b.reviewStatus !== 'pending_review').length,
    leakageStopped: bills
      .filter(b => b.analysis && (b.reviewStatus === 'rejected' || (b.reviewStatus === 'pending_review' && b.status !== 'paid')))
      .reduce((s, b) => s + (b.analysis.estimatedLeakage || 0), 0)
  };
}

async function loadSupplierStats(uid) {
  const [openSnap, bidsSnap, contractsSnap, billsSnap] = await Promise.all([
    getDocs(query(collection(db, 'tenders'), where('status', '==', 'open'))),
    getDocs(query(collection(db, 'bids'), where('supplierId', '==', uid))),
    getDocs(query(collection(db, 'contracts'), where('supplierId', '==', uid))),
    getDocs(query(collection(db, 'bills'), where('supplierId', '==', uid)))
  ]);
  const bidTenderIds = new Set(bidsSnap.docs.map(d => d.data().tenderId));
  const bills = billsSnap.docs.map(d => d.data());
  return {
    openTenders: openSnap.size,
    newTenders: openSnap.docs.filter(d => !bidTenderIds.has(d.id)).length,
    bids: bidsSnap.size,
    contracts: contractsSnap.size,
    contractInvoices: bills.filter(b => b.contractId).length,
    flaggedInvoices: bills.filter(b => b.analysis && b.analysis.level !== 'clear').length,
    billed: bills.reduce((s, b) => s + (b.amount || 0), 0)
  };
}

// The one thing the user should do next, decided from their data
function nextStep(isSupplier, s) {
  if (isSupplier) {
    if (s.newTenders > 0) return { label: `Bid on ${s.newTenders} open tender${s.newTenders > 1 ? 's' : ''}`, to: '/tenders' };
    if (s.contracts > 0) return { label: 'Invoice your contracts', to: '/contracts' };
    return { label: 'Browse tenders', to: '/tenders' };
  }
  if (s.pendingReview > 0) return { label: `Review ${s.pendingReview} flagged invoice${s.pendingReview > 1 ? 's' : ''}`, to: '/risk' };
  if (s.bidsReceived > 0) return { label: 'Compare bids', to: '/tenders' };
  if (s.unpaid > 0) return { label: 'Pay cleared invoices', to: '/my-orders' };
  return { label: 'Create a tender', to: '/tenders' };
}

function fallbackBriefing(isSupplier, s) {
  if (isSupplier) {
    if (s.newTenders > 0) return `There ${s.newTenders === 1 ? 'is 1 open tender' : `are ${s.newTenders} open tenders`} you haven't bid on yet.`;
    return 'You are up to date. New tenders from buyers will appear here.';
  }
  if (s.pendingReview > 0) return `${s.pendingReview} invoice${s.pendingReview > 1 ? 's were' : ' was'} flagged by AI and ${s.pendingReview > 1 ? 'are' : 'is'} waiting for your decision.`;
  if (s.bidsReceived > 0) return `You have ${s.bidsReceived} bid${s.bidsReceived > 1 ? 's' : ''} on your open tenders, already ranked by AI.`;
  return 'Everything is in order. Post a tender whenever you need something supplied.';
}

export default function Home() {
  const { currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [briefing, setBriefing] = useState(null);

  const isSupplier = userData?.role === 'supplier';
  const name = userData?.companyName || currentUser?.email;

  useEffect(() => {
    if (!currentUser || !userData?.role) return;
    (isSupplier ? loadSupplierStats : loadBuyerStats)(currentUser.uid)
      .then(setStats)
      .catch(err => { console.error(err); setStats({}); });
  }, [currentUser, userData, isSupplier]);

  // AI briefing, cached for the session so it only regenerates when the numbers change
  useEffect(() => {
    if (!stats) return;
    const key = `briefing:${currentUser.uid}:${JSON.stringify(stats)}`;
    try {
      const cached = sessionStorage.getItem(key);
      if (cached) { setBriefing(cached); return; }
    } catch { /* storage unavailable */ }
    getBriefing(userData.role, name, stats)
      .then(r => {
        const text = r.text || fallbackBriefing(isSupplier, stats);
        setBriefing(text);
        try { sessionStorage.setItem(key, text); } catch { /* storage unavailable */ }
      })
      .catch(() => setBriefing(fallbackBriefing(isSupplier, stats)));
  }, [stats, currentUser, userData, name, isSupplier]);

  const step = stats && nextStep(isSupplier, stats);
  const tiles = !stats ? [] : isSupplier
    ? [
        { label: 'Open tenders', value: stats.openTenders, to: '/tenders' },
        { label: 'Contracts won', value: stats.contracts, to: '/contracts' },
        { label: 'Total billed', value: money(stats.billed) }
      ]
    : [
        { label: 'Bids received', value: stats.bidsReceived, to: '/tenders' },
        { label: 'Invoices to review', value: stats.pendingReview, to: '/risk', alert: stats.pendingReview > 0 },
        { label: 'Leakage stopped', value: money(stats.leakageStopped), to: '/risk', term: 'leakageStopped' }
      ];

  return (
    <div className="page-container">
      <p className="eyebrow">{greeting()}</p>
      <h1 className="page-title">{name}</h1>

      <section className="briefing">
        <AiTag>Briefing</AiTag>
        {briefing ? (
          <p className="briefing-text">{briefing}</p>
        ) : (
          <div className="briefing-skeleton"><span /><span /></div>
        )}
        {step && (
          <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => navigate(step.to)}>
            {step.label} <ArrowRight size={16} />
          </button>
        )}
      </section>

      <div className="tiles">
        {tiles.map(t => (
          // A div rather than a button so the "i" button inside it is valid HTML
          <div
            key={t.label}
            className={`tile${t.alert ? ' tile-alert' : ''}${t.to ? ' tile-link' : ''}`}
            role={t.to ? 'link' : undefined}
            tabIndex={t.to ? 0 : undefined}
            onClick={() => t.to && navigate(t.to)}
            onKeyDown={e => { if (t.to && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(t.to); } }}
          >
            <span className="tile-value">{t.value ?? '–'}</span>
            <span className="tile-label">{t.label}{t.term && <InfoTip term={t.term} label={t.label} />}</span>
          </div>
        ))}
      </div>

      {stats && <GettingStarted role={userData.role} userData={userData} stats={stats} />}
    </div>
  );
}
