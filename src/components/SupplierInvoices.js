import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { PageHeader, RiskBadge, FlagList, LoadState } from './Guide';
import { ApprovalProgress } from './Approvals';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STATUS = (b) => (b.status === 'paid' ? ['Paid', 'paid'] : b.status === 'rejected' ? ['Rejected', 'rejected']
  : b.approval?.status === 'approved' ? ['Approved, awaiting payment', 'active'] : !b.approval ? ['Being validated', 'closed'] : ['In approval', 'closed']);

// The supplier's invoices and where each one is in the buyer's approval process
export default function SupplierInvoices() {
  const { currentUser } = useAuth();
  const [bills, setBills] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!currentUser) return undefined;
    return onSnapshot(query(collection(db, 'bills'), where('supplierId', '==', currentUser.uid)), snap => {
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, err => setError(err.message));
  }, [currentUser]);

  return (
    <div className="page-container">
      <PageHeader title="My invoices" subtitle="Invoices you've sent. The buyer's system checks each one against the contract, then their team approves it." />
      {bills === null ? <LoadState loading={!error} error={error} /> : bills.length === 0 ? (
        <div className="empty-state">No invoices yet. Upload one from Contracts.</div>
      ) : (
        <div className="stack">
          {bills.map(b => {
            const [label, cls] = STATUS(b);
            const rejected = b.approval?.steps?.find(s => s.status === 'rejected');
            return (
              <details key={b.id} className="card invoice-card">
                <summary className="row-between">
                  <span>
                    <span className="list-title">{b.productName} · {money(b.amount)}</span>
                    <span className="list-sub"> #{b.invoiceNumber || b.id.slice(0, 8).toUpperCase()}</span>
                  </span>
                  <span className="list-meta">
                    {b.analysis && <RiskBadge analysis={b.analysis} compact />}
                    <span className={`status-pill status-${cls}`}>{label}</span>
                  </span>
                </summary>
                {rejected && <div className="error-message" style={{ marginTop: '0.75rem' }}>Rejected: {rejected.reason}</div>}
                {b.analysis?.summary && <p style={{ marginTop: '0.75rem' }}>{b.analysis.summary}</p>}
                <FlagList flags={b.analysis?.flags} />
                <div className="approval-wrap"><ApprovalProgress approval={b.approval} /></div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
