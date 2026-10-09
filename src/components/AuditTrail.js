import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Download, Lock } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { AUDIT_ACTIONS, logAudit } from '../services/audit';
import { loadOrgData, loadAllSupplierIdentities } from '../services/orgData';
import { computeInsights } from '../services/insights';
import { buildReportHtml, openPrintable } from '../services/report';
import { ROLE_LABELS, can } from '../security/roles';
import { PageHeader, LoadState, Dialog } from './Guide';

const DAY = 86400000;
const toMs = (ts, fallback) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : fallback ? Date.parse(fallback) : 0);
const stamp = (ms) => new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isoDay = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const brief = (v) => (v == null ? null : typeof v === 'object'
  ? Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(', ') : x && typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ')
  : String(v));

export default function AuditTrail() {
  const { currentUser, userData, orgId, role } = useAuth();
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [user, setUser] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!orgId || !can.viewAudit(role)) return undefined;
    return onSnapshot(query(collection(db, 'auditLogs'), where('orgId', '==', orgId)), snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data(), ms: toMs(d.data().createdAt, d.data().clientTime) })).sort((a, b) => b.ms - a.ms));
    }, err => setError(err.message));
  }, [orgId, role]);

  const users = useMemo(() => [...new Map((logs || []).map(l => [l.userId, l.userName || l.userId])).entries()], [logs]);
  const entities = useMemo(() => [...new Set((logs || []).map(l => l.entityType).filter(Boolean))], [logs]);

  const shown = useMemo(() => (logs || []).filter(l => {
    if (from && l.ms < new Date(from).getTime()) return false;
    if (to && l.ms > new Date(to).getTime() + DAY - 1) return false;
    if (user && l.userId !== user) return false;
    if (action && l.action !== action) return false;
    if (entity && l.entityType !== entity) return false;
    if (q) {
      const hay = [l.userName, l.action, AUDIT_ACTIONS[l.action], l.entityLabel, l.entityId, l.reason, brief(l.next), brief(l.previous)].join(' ').toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [logs, q, from, to, user, action, entity]);

  if (!can.viewAudit(role)) {
    return (
      <div className="page-container">
        <PageHeader title="Audit trail" />
        <div className="empty-state"><Lock size={22} />Only admins, procurement managers and finance managers can view the audit trail.</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader title="Audit trail"
        subtitle="Every important action, who did it and when. Records can't be edited or deleted."
        action={can.exportReport(role) && <button className="btn-primary" style={{ marginTop: 0 }} onClick={() => setExporting(true)}><Download size={15} /> Export audit report</button>} />

      <div className="filter-bar">
        <input className="form-input" placeholder="Search actions, people, invoices…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        <input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
        <input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
        <select className="form-input" value={user} onChange={e => setUser(e.target.value)} aria-label="User">
          <option value="">All users</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className="form-input" value={action} onChange={e => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>{Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-input" value={entity} onChange={e => setEntity(e.target.value)} aria-label="Entity">
          <option value="">All entities</option>{entities.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>

      {logs === null ? <LoadState loading={!error} error={error} /> : shown.length === 0 ? (
        <div className="empty-state">{logs.length ? 'No events match these filters.' : 'No events recorded yet.'}</div>
      ) : (
        <div className="card table-card">
          <p className="muted" style={{ margin: '0 0 0.5rem' }}>{shown.length} event{shown.length === 1 ? '' : 's'}</p>
          <div className="table-scroll">
            <table className="risk-table audit-table">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
              <tbody>
                {shown.slice(0, 500).map(l => (
                  <tr key={l.id}>
                    <td className="nowrap">{stamp(l.ms)}</td>
                    <td><b>{l.userName || '—'}</b><div className="muted">{ROLE_LABELS[l.userRole] || l.userRole}</div></td>
                    <td><span className="action-code">{l.action}</span><div className="muted">{AUDIT_ACTIONS[l.action]}</div></td>
                    <td>{l.entityType}<div className="muted">{l.entityLabel}</div></td>
                    <td className="audit-details">
                      {l.previous && <div><span className="muted">Before:</span> {brief(l.previous)}</div>}
                      {l.next && <div><span className="muted">After:</span> {brief(l.next)}</div>}
                      {l.reason && <div><span className="muted">Reason:</span> {l.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 500 && <p className="muted">Showing the latest 500. Narrow the filters or export the report for everything.</p>}
        </div>
      )}

      {exporting && (
        <ExportDialog logs={logs || []} orgId={orgId} onClose={() => setExporting(false)}
          generatedBy={`${userData?.displayName || currentUser.email} (${ROLE_LABELS[role]})`} orgName={userData?.companyName || 'Organisation'} />
      )}
    </div>
  );
}

function ExportDialog({ logs, orgId, orgName, generatedBy, onClose }) {
  const today = Date.now();
  const [from, setFrom] = useState(isoDay(today - 30 * DAY));
  const [to, setTo] = useState(isoDay(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async (e) => {
    e.preventDefault();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime() + DAY - 1;
    if (!(fromMs <= toMs)) { setError('The start date must be before the end date.'); return; }
    setBusy(true);
    setError('');
    try {
      const [data, network] = await Promise.all([loadOrgData(orgId), loadAllSupplierIdentities()]);
      const insights = computeInsights(data, network);
      const periodLogs = logs.filter(l => l.ms >= fromMs && l.ms <= toMs).sort((a, b) => a.ms - b.ms);
      openPrintable(buildReportHtml({ orgName, generatedBy, from: fromMs, to: toMs, logs: periodLogs, data, insights }));
      await logAudit({ action: 'REPORT_EXPORTED', entityType: 'report', entityLabel: `${from} to ${to}`, next: { events: periodLogs.length } });
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <Dialog title="Export audit report" onClose={onClose}>
      <form onSubmit={generate}>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>Includes procurement, supplier and risk summaries, suspicious activities, invoice anomalies, approval history and every audit event in the period. Choose "Save as PDF" in the print window.</p>
        <div className="field-grid">
          <div className="form-group"><label className="form-label" htmlFor="rf">From</label><input id="rf" type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="rt">To</label><input id="rt" type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        {error && <div className="error-message" style={{ marginTop: '0.75rem' }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Preparing…' : 'Generate PDF'}</button>
        </div>
      </form>
    </Dialog>
  );
}
