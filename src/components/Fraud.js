import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, Users, FileText, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOrgInsights, dismissAlert } from '../services/insights';
import { can } from '../security/roles';
import { PageHeader, LevelBadge, LoadState, ReasonDialog } from './Guide';

const CATEGORIES = [
  { key: 'collusion', label: 'Supplier collusion indicators', icon: Users },
  { key: 'invoice', label: 'Invoice fraud indicators', icon: FileText },
  { key: 'anomaly', label: 'Procurement anomalies', icon: TrendingUp }
];

export default function Fraud() {
  const { orgId, role } = useAuth();
  const { loading, error, insights, reload } = useOrgInsights(orgId);
  const [showDismissed, setShowDismissed] = useState(false);
  const [level, setLevel] = useState('all');
  const [dismissing, setDismissing] = useState(null);
  const [dismissed, setDismissed] = useState({});

  const alerts = useMemo(() => (insights?.alerts || [])
    .map(a => (dismissed[a.key] ? { ...a, status: 'dismissed', dismissReason: dismissed[a.key] } : a))
    .filter(a => (showDismissed || a.status !== 'dismissed') && (level === 'all' || a.level === level)), [insights, showDismissed, level, dismissed]);

  const counts = useMemo(() => {
    const open = (insights?.alerts || []).filter(a => a.status !== 'dismissed' && !dismissed[a.key]);
    return { HIGH: open.filter(a => a.level === 'HIGH').length, MEDIUM: open.filter(a => a.level === 'MEDIUM').length, LOW: open.filter(a => a.level === 'LOW').length };
  }, [insights, dismissed]);

  return (
    <div className="page-container">
      <PageHeader title="Fraud detection"
        subtitle="Patterns across bids, suppliers and invoices that deserve a closer look. A pattern is a reason to check, not proof of fraud." />

      <div className="kpi-grid">
        {['HIGH', 'MEDIUM', 'LOW'].map(l => (
          <button key={l} className={`kpi-card kpi-button${level === l ? ' selected' : ''}`} onClick={() => setLevel(level === l ? 'all' : l)}>
            <AlertOctagon />
            <div className="kpi-label"><LevelBadge level={l} /></div>
            <div className="kpi-value">{counts[l]}</div>
          </button>
        ))}
      </div>

      <div className="filter-row">
        <label className="checkbox"><input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} /> Show dismissed</label>
        <button className="btn-secondary" onClick={reload}>Re-scan</button>
      </div>

      {(loading || error) ? <LoadState loading={loading} error={error} onRetry={reload} /> : (
        CATEGORIES.map(cat => {
          const items = alerts.filter(a => a.category === cat.key);
          return (
            <section key={cat.key} className="alert-section">
              <h2 className="section-title"><cat.icon size={17} />&nbsp;{cat.label} <span className="muted">&nbsp;· {items.length}</span></h2>
              {items.length === 0 ? <div className="empty-state compact">No suspicious patterns found.</div> : items.map(a => (
                <article key={a.key} className={`card alert-card level-${a.level}${a.status === 'dismissed' ? ' dismissed' : ''}`}>
                  <div className="row-between">
                    <strong>🚨 {a.title}</strong>
                    <LevelBadge level={a.level} />
                  </div>
                  <p className="alert-kicker">Suspicious pattern detected</p>
                  <div className="alert-reasons">{a.reasons.map((r, i) => <div key={i}>{r}</div>)}</div>
                  <div className="row-between" style={{ marginTop: '0.6rem' }}>
                    <span className="list-sub">
                      {a.supplierIds?.length > 0 && a.supplierIds.slice(0, 3).map(id => <Link key={id} to={`/suppliers?id=${id}`} className="chip-link">Supplier</Link>)}
                      {a.entities?.filter(e => e.type === 'tender').map(e => <Link key={e.id} to={`/tenders/${e.id}`} className="chip-link">Tender</Link>)}
                      {a.entities?.some(e => e.type === 'invoice') && <Link to="/approvals" className="chip-link">Invoices</Link>}
                    </span>
                    {a.status === 'dismissed'
                      ? <span className="muted">Dismissed: {a.dismissReason}</span>
                      : can.viewAudit(role) && <button className="btn-secondary btn-sm" onClick={() => setDismissing(a)}>Dismiss</button>}
                  </div>
                </article>
              ))}
            </section>
          );
        })
      )}

      {dismissing && (
        <ReasonDialog title="Dismiss this alert" confirmLabel="Dismiss"
          message="Explain why this pattern is not a concern. The reason is kept in the audit trail."
          onConfirm={async (reason) => { await dismissAlert(orgId, dismissing, reason); setDismissed(prev => ({ ...prev, [dismissing.key]: reason })); }}
          onClose={() => setDismissing(null)} />
      )}
    </div>
  );
}
