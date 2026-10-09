import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';
import { ShieldCheck, ShieldAlert, IndianRupee, ScanSearch } from 'lucide-react';
import { analyzeInvoice } from '../api';
import { PageHeader, RiskBadge, FlagList, InfoTip, ReasonDialog } from './Guide';
import { logAudit } from '../services/audit';

const FLAG_LABELS = {
  price_exceeded: 'Price above contract',
  quantity_exceeded: 'Quantity above contract',
  extra_charges_not_allowed: 'Extra charges not allowed',
  extra_charges_exceeded: 'Extra charges over cap',
  extra_charges_unverified: 'Extra charges unverified',
  possible_duplicate: 'Possible duplicate',
  statistical_anomaly: 'Unusual pattern (ML)',
  buyer_conflict: 'Conflict of interest'
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function RiskCenter() {
  const { currentUser, orgId } = useAuth();
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('queue');
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [busy, setBusy] = useState({});

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'bills'), where('consumerId', '==', orgId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setBills(list);
      setLoading(false);
    });
    return unsubscribe;
  }, [currentUser, orgId]);

  const stats = useMemo(() => {
    const analyzed = bills.filter(b => b.analysis);
    const flagged = analyzed.filter(b => b.analysis.level !== 'clear');
    const byType = {};
    flagged.forEach(b => b.analysis.flags.forEach(f => { byType[f.type] = (byType[f.type] || 0) + 1; }));
    // Leakage counts as prevented once the invoice was rejected, or while it is still held unpaid
    const prevented = flagged
      .filter(b => b.reviewStatus === 'rejected' || (b.reviewStatus === 'pending_review' && b.status !== 'paid'))
      .reduce((s, b) => s + (b.analysis.estimatedLeakage || 0), 0);

    const bySupplier = {};
    analyzed.forEach(b => {
      const s = (bySupplier[b.supplierId] ||= { supplierId: b.supplierId, invoices: 0, flagged: 0, leakage: 0, totalRisk: 0 });
      s.invoices += 1;
      s.totalRisk += b.analysis.riskScore;
      if (b.analysis.level !== 'clear') { s.flagged += 1; s.leakage += b.analysis.estimatedLeakage || 0; }
    });

    return {
      analyzed: analyzed.length,
      unanalyzed: bills.length - analyzed.length,
      flagged: flagged.length,
      pending: flagged.filter(b => b.reviewStatus === 'pending_review').length,
      autoCleared: analyzed.filter(b => b.analysis.level === 'clear').length,
      prevented,
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      suppliers: Object.values(bySupplier).sort((a, b) => b.totalRisk / b.invoices - a.totalRisk / a.invoices)
    };
  }, [bills]);

  const [supplierNames, setSupplierNames] = useState({});
  useEffect(() => {
    const missing = stats.suppliers.map(s => s.supplierId).filter(id => id && !(id in supplierNames));
    if (!missing.length) return;
    Promise.all(missing.map(id => getDoc(doc(db, 'users', id)))).then(snaps => {
      setSupplierNames(prev => ({
        ...prev,
        ...Object.fromEntries(snaps.map((s, i) => [missing[i], s.exists() ? (s.data().companyName || s.data().email) : 'Unknown supplier']))
      }));
    });
  }, [stats.suppliers, supplierNames]);

  const [rejecting, setRejecting] = useState(null);

  // Approving here clears the AI flags so the invoice can continue through its approval chain;
  // rejecting stops it. Both are recorded with who decided and why.
  const decide = async (bill, decision, reason = null) => {
    setBusy(prev => ({ ...prev, [bill.id]: true }));
    try {
      await updateDoc(doc(db, 'bills', bill.id), decision === 'approve'
        ? { reviewStatus: 'approved', reviewedAt: new Date().toISOString(), reviewedBy: currentUser.uid }
        : { reviewStatus: 'rejected', status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: currentUser.uid, rejectReason: reason });
      await logAudit({
        action: decision === 'approve' ? 'RISK_REVIEW_DECISION' : 'INVOICE_REJECTED', entityType: 'invoice', entityId: bill.id,
        entityLabel: `#${bill.invoiceNumber || bill.id.slice(0, 8).toUpperCase()}`,
        previous: { reviewStatus: bill.reviewStatus, aiLevel: bill.analysis?.level }, next: { reviewStatus: decision === 'approve' ? 'approved' : 'rejected' },
        reason, meta: { amount: bill.amount, flags: (bill.analysis?.flags || []).map(f => f.type) }
      });
    } catch (err) {
      alert('Could not save decision: ' + err.message);
      if (decision === 'reject') throw err;
    }
    setBusy(prev => ({ ...prev, [bill.id]: false }));
  };

  // Runs the AI check on invoices created before it existed (old direct-purchase bills)
  const scanOlder = async () => {
    setScanning(true);
    setScanMessage('');
    const pending = bills.filter(b => !b.analysis);
    let done = 0;
    try {
      for (const bill of pending) {
        let contract = null;
        if (bill.contractId) {
          const snap = await getDoc(doc(db, 'contracts', bill.contractId));
          if (snap.exists()) contract = { id: snap.id, ...snap.data(), quantityInvoiced: Math.max(0, (snap.data().quantityInvoiced || 0) - bill.quantityRequested) };
        }
        // Without a contract, the bill's own price is the reference, so only duplicate, anomaly and relationship checks apply
        contract ||= { title: bill.productName, unit: bill.unit || 'units', agreedUnitPrice: bill.unitCost, maxQuantity: Number.MAX_SAFE_INTEGER, quantityInvoiced: 0 };
        const analysis = await analyzeInvoice(contract, bill);
        analysis.analyzedAt = new Date().toISOString();
        const reviewStatus = bill.status === 'paid' ? 'paid_before_check' : analysis.level === 'clear' ? 'auto_cleared' : 'pending_review';
        await updateDoc(doc(db, 'bills', bill.id), { analysis, reviewStatus });
        done += 1;
      }
      setScanMessage(`Checked ${done} older invoice${done === 1 ? '' : 's'}.`);
    } catch (err) {
      setScanMessage(`Checked ${done} of ${pending.length}. ${err.message}`);
    }
    setScanning(false);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ alignItems: 'center', paddingTop: '4rem' }}>
        <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
      </div>
    );
  }

  const queue = bills.filter(b => b.analysis && b.reviewStatus === 'pending_review');
  const history = bills.filter(b => b.analysis && b.reviewStatus !== 'pending_review');
  const maxType = stats.byType[0]?.[1] || 1;

  return (
    <div className="page-container">
      <PageHeader
        title="Risk Center"
        term="leakage"
        subtitle="AI checks every invoice before you pay. Anything suspicious waits here for your decision."
      />

      <div className="kpi-grid">
        <Kpi icon={ScanSearch} label="Invoices checked" value={stats.analyzed} />
        <Kpi icon={ShieldAlert} label="Awaiting your review" value={stats.pending} highlight={stats.pending > 0} />
        <Kpi icon={ShieldCheck} label="Cleared automatically" value={stats.autoCleared} />
        <Kpi icon={IndianRupee} label="Leakage stopped" term="leakageStopped" value={money(stats.prevented)} hint="Overcharges, duplicates and disallowed charges not paid out" />
      </div>

      {stats.unanalyzed > 0 && (
        <div className="ai-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <span>{stats.unanalyzed} older invoice{stats.unanalyzed === 1 ? ' has' : 's have'} not been checked yet.</span>
          <button className="btn-secondary" onClick={scanOlder} disabled={scanning}>{scanning ? 'Checking…' : 'Check them now'}</button>
        </div>
      )}
      {scanMessage && <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>{scanMessage}</p>}

      <div className="tabs">
        <button className={tab === 'queue' ? 'tab active' : 'tab'} onClick={() => setTab('queue')}>Review queue ({queue.length})</button>
        <button className={tab === 'insights' ? 'tab active' : 'tab'} onClick={() => setTab('insights')}>Insights</button>
        <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>All checked ({history.length})</button>
      </div>

      {tab === 'queue' && (
        queue.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck size={28} />
            <p>Nothing needs your attention. New flagged invoices will appear here.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {queue.map(b => (
              <InvoiceCard key={b.id} bill={b} supplierName={supplierNames[b.supplierId]}>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <button className="btn-primary" style={{ marginTop: 0 }} disabled={busy[b.id]} onClick={() => decide(b, 'approve')}>Clear flags</button>
                  <button className="btn-danger" disabled={busy[b.id]} onClick={() => setRejecting(b)}>Reject invoice</button>
                </div>
              </InvoiceCard>
            ))}
          </div>
        )
      )}

      {tab === 'insights' && (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          <div className="bid-card">
            <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>What the AI caught</h3>
            {stats.byType.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>No flags yet.</p>
            ) : stats.byType.map(([type, count]) => (
              <div key={type} className="bar-row">
                <span className="bar-label">{FLAG_LABELS[type] || type}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(count / maxType) * 100}%` }} /></div>
                <span className="bar-value">{count}</span>
              </div>
            ))}
          </div>

          <div className="bid-card">
            <h3 style={{ fontWeight: 600, marginBottom: '1rem' }}>Supplier risk</h3>
            {stats.suppliers.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>No checked invoices yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="risk-table">
                  <thead>
                    <tr><th>Supplier</th><th>Invoices</th><th>Flagged</th><th>Avg. risk<InfoTip term="riskScore" /></th><th>Est. leakage<InfoTip term="leakage" /></th></tr>
                  </thead>
                  <tbody>
                    {stats.suppliers.map(s => {
                      const avg = Math.round(s.totalRisk / s.invoices);
                      return (
                        <tr key={s.supplierId}>
                          <td>{supplierNames[s.supplierId] || '…'}</td>
                          <td>{s.invoices}</td>
                          <td>{s.flagged} ({Math.round((s.flagged / s.invoices) * 100)}%)</td>
                          <td><RiskBadge analysis={{ riskScore: avg, level: avg >= 60 ? 'hold' : avg >= 25 ? 'review' : 'clear' }} compact /></td>
                          <td>{money(s.leakage)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        history.length === 0 ? (
          <div className="empty-state"><p>No checked invoices yet.</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {history.map(b => (
              <InvoiceCard key={b.id} bill={b} supplierName={supplierNames[b.supplierId]}>
                <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Decision: {REVIEW_LABEL[b.reviewStatus] || b.reviewStatus}
                  {b.status === 'unpaid' && b.reviewStatus !== 'rejected' && (
                    <button className="link-button" onClick={() => navigate('/checkout/' + b.id)}>Go to payment →</button>
                  )}
                </div>
              </InvoiceCard>
            ))}
          </div>
        )
      )}
      {rejecting && (
        <ReasonDialog title="Reject invoice" confirmLabel="Reject invoice"
          message="The invoice will be blocked from payment. The reason is recorded in the audit trail."
          onConfirm={(reason) => decide(rejecting, 'reject', reason)} onClose={() => setRejecting(null)} />
      )}
    </div>
  );
}

const REVIEW_LABEL = {
  auto_cleared: 'Cleared automatically',
  approved: 'Approved by you',
  rejected: 'Rejected by you',
  paid_before_check: 'Paid before the AI check existed',
  unchecked: 'Not checked'
};

function Kpi({ icon: Icon, label, value, hint, highlight, term }) {
  return (
    <div className={`kpi-card${highlight ? ' kpi-highlight' : ''}`} title={hint}>
      <Icon size={20} />
      <div className="kpi-label">{label}{term && <InfoTip term={term} label={label} />}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function InvoiceCard({ bill, supplierName, children }) {
  const a = bill.analysis;
  return (
    <div className="bid-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <strong>{money(bill.amount)}</strong> · {bill.description}
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {supplierName || 'Supplier'}{bill.createdAt?.seconds ? ` · ${new Date(bill.createdAt.seconds * 1000).toLocaleDateString()}` : ''}
          </div>
        </div>
        <RiskBadge analysis={a} />
      </div>
      {a.summary && <p style={{ marginTop: '0.75rem' }}>{a.summary}</p>}
      <FlagList flags={a.flags} />
      {a.estimatedLeakage > 0 && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>Estimated leakage if paid<InfoTip term="leakage" />: <strong>{money(a.estimatedLeakage)}</strong></div>
      )}
      {children}
    </div>
  );
}
