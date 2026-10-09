import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOrgInsights } from '../services/insights';
import { KYC_DISCLAIMER } from '../risk/kyc';
import { industryName } from '../constants/products';
import { PageHeader, LevelBadge, KycBadge, LoadState, Dialog, InfoTip } from './Guide';

const LEVEL_SORT = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export default function Suppliers() {
  const { orgId } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'verification' ? 'verification' : 'risk';
  const openId = params.get('id');
  const { loading, error, insights, reload } = useOrgInsights(orgId);
  const [filter, setFilter] = useState('all');

  const rows = useMemo(() => Object.values(insights?.risks || {})
    .sort((a, b) => LEVEL_SORT[a.level] - LEVEL_SORT[b.level] || b.score - a.score), [insights]);

  const shown = rows.filter(r => tab === 'verification'
    ? (filter === 'all' || (filter === 'none' ? !r.supplier.kyc?.status : r.supplier.kyc?.status === filter))
    : (filter === 'all' || r.level === filter));
  const open = openId ? insights?.risks?.[openId] : null;
  const setTab = (t) => setParams(t === 'risk' ? {} : { tab: t });

  return (
    <div className="page-container">
      <PageHeader title="Suppliers" term="supplierRisk"
        subtitle="Every supplier who has bid on or invoiced your organisation, with a risk score built from verification, bidding and invoicing history." />

      <div className="tabs">
        <button className={tab === 'risk' ? 'tab active' : 'tab'} onClick={() => setTab('risk')}>Risk scores</button>
        <button className={tab === 'verification' ? 'tab active' : 'tab'} onClick={() => setTab('verification')}>Verification (KYC)</button>
      </div>

      <div className="filter-row">
        <select className="form-input" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter">
          <option value="all">All suppliers</option>
          {tab === 'risk'
            ? <><option value="HIGH">High risk</option><option value="MEDIUM">Medium risk</option><option value="LOW">Low risk</option></>
            : <><option value="VERIFIED">Verified</option><option value="NEEDS_REVIEW">Needs review</option><option value="HIGH_RISK">High risk</option><option value="none">Not verified</option></>}
        </select>
        <button className="btn-secondary" onClick={reload}>Refresh</button>
      </div>

      {(loading || error) ? <LoadState loading={loading} error={error} onRetry={reload} /> : shown.length === 0 ? (
        <div className="empty-state">{rows.length ? 'No suppliers match this filter.' : 'No suppliers yet. They appear here once they bid on your tenders.'}</div>
      ) : (
        <div className="list">
          {shown.map(r => (
            <button key={r.supplier.uid} className="list-row list-button" onClick={() => setParams({ ...(tab === 'verification' ? { tab } : {}), id: r.supplier.uid })}>
              <span className="list-main">
                <span className="list-title">{r.supplier.companyName || r.supplier.email || 'Supplier'}</span>
                <span className="list-sub">
                  {r.bids} bid{r.bids === 1 ? '' : 's'} · {r.invoices} invoice{r.invoices === 1 ? '' : 's'}
                  {r.supplier.industries?.length ? ` · ${r.supplier.industries.map(industryName).join(', ')}` : ''}
                </span>
                {tab === 'risk' && r.factors.length > 0 && <span className="list-sub">Main reason: {r.factors.slice().sort((a, b) => b.points - a.points)[0].label}</span>}
              </span>
              <span className="list-meta">
                {tab === 'risk' ? <LevelBadge level={r.level} score={r.score} /> : <KycBadge kyc={r.supplier.kyc} />}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && <SupplierDetail risk={open} onClose={() => setParams(tab === 'verification' ? { tab } : {})} />}
    </div>
  );
}

function SupplierDetail({ risk, onClose }) {
  const s = risk.supplier;
  const kyc = s.kyc;
  return (
    <Dialog title={s.companyName || 'Supplier'} onClose={onClose}>
      <div className="row-between" style={{ marginBottom: '0.75rem' }}>
        <LevelBadge level={risk.level} score={risk.score} />
        <KycBadge kyc={kyc} />
      </div>

      <h3 className="section-title">Why this score<InfoTip term="riskScore" /></h3>
      {risk.factors.length === 0 ? <p className="muted">No risk factors found.</p> : (
        <ul className="factor-list">
          {risk.factors.slice().sort((a, b) => b.points - a.points).map(f => (
            <li key={f.key}><span className="factor-points">+{f.points}</span><span><b>{f.label}</b>{f.detail && <span className="muted"> · {f.detail}</span>}</span></li>
          ))}
        </ul>
      )}

      <h3 className="section-title" style={{ marginTop: '1.25rem' }}>Verification</h3>
      {!kyc?.checks ? <p className="muted">This supplier has not submitted KYC details yet.</p> : (
        <>
          <ul className="kyc-checks compact">
            {kyc.checks.map(c => (
              <li key={c.key} className={c.passed ? 'pass' : 'fail'}>
                {c.passed ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                <span className="kyc-check-text"><b>{c.label}</b><span className="muted">{c.detail}</span></span>
                <span className="kyc-points">{c.points}/{c.max}</span>
              </li>
            ))}
          </ul>
          <dl className="detail-list" style={{ marginTop: '0.75rem' }}>
            <div><dt>GSTIN</dt><dd className="mono">{s.gstin || '—'}</dd></div>
            <div><dt>PAN</dt><dd className="mono">{kyc.masked?.pan || '—'}</dd></div>
            <div><dt>Bank account</dt><dd className="mono">{kyc.masked?.bankAccount || '—'}</dd></div>
            <div><dt>Directors</dt><dd>{s.directors || s.keyPeople || '—'}</dd></div>
            <div><dt>Submitted</dt><dd>{kyc.submittedAt ? new Date(kyc.submittedAt).toLocaleDateString('en-IN') : '—'}</dd></div>
          </dl>
        </>
      )}
      {risk.duplicates?.length > 0 && (
        <div className="notice" style={{ marginTop: '0.75rem' }}>
          {risk.duplicates.map((d, i) => <div key={i}>⚠ Shared {d.field} detected with {d.otherName}</div>)}
        </div>
      )}
      <div className="disclaimer" style={{ marginTop: '1rem' }}><ShieldCheck size={15} /> {KYC_DISCLAIMER}</div>
      <div className="form-actions"><button className="btn-secondary" onClick={onClose}>Close</button></div>
    </Dialog>
  );
}
