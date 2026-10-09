import React, { useState, useRef, useEffect, useId } from 'react';
import { Sparkles, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { LEVEL_LABEL } from '../api';
import { GLOSSARY, FLAG_GLOSSARY, SEVERITY_GLOSSARY } from '../constants/glossary';

// Small "i" button that explains a term in plain words. Pass a glossary key or custom text.
export function InfoTip({ term, text, label }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  const id = useId();
  const body = text || GLOSSARY[term];

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!body) return null;

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Open towards the side with more room so the bubble never runs off screen
    if (ref.current) setAlignRight(ref.current.getBoundingClientRect().left > window.innerWidth / 2);
    setOpen(o => !o);
  };

  return (
    <span className="infotip" ref={ref}>
      <button type="button" className="infotip-btn" aria-label={`What is ${label || term || 'this'}?`}
        aria-expanded={open} aria-describedby={open ? id : undefined} onClick={toggle}>i</button>
      {open && (
        <span role="tooltip" id={id} className={`infotip-bubble${alignRight ? ' infotip-right' : ''}`} onClick={e => e.stopPropagation()}>
          {body}
        </span>
      )}
    </span>
  );
}

// Page title with a one-line explanation, so every screen says what it is for
export function PageHeader({ title, subtitle, action, term }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}{term && <InfoTip term={term} label={title} />}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </header>
  );
}

// Small label marking content produced by AI
export function AiTag({ children = 'AI', term }) {
  return (
    <span className="ai-tag-wrap">
      <span className="ai-tag"><Sparkles size={12} />{children}</span>
      {term && <InfoTip term={term} label={typeof children === 'string' ? children : undefined} />}
    </span>
  );
}

const LEVEL_ICON = { clear: ShieldCheck, review: ShieldAlert, hold: ShieldX };

export function RiskBadge({ analysis, compact }) {
  if (!analysis) return null;
  const Icon = LEVEL_ICON[analysis.level] || ShieldAlert;
  return (
    <span className="ai-tag-wrap">
      <span className={`risk-badge risk-${analysis.level}`} title={`Risk score ${analysis.riskScore}/100`}>
        <Icon size={14} />
        {compact ? analysis.riskScore : `${LEVEL_LABEL[analysis.level]} · risk ${analysis.riskScore}/100`}
      </span>
    </span>
  );
}

export function FlagList({ flags }) {
  if (!flags?.length) return null;
  return (
    <ul className="flag-list">
      {flags.map((f, i) => (
        <li key={i} className={`flag-item flag-${f.severity}`}>
          <div className="flag-title">
            <span className={`severity-dot sev-${f.severity}`} title={SEVERITY_GLOSSARY[f.severity]} />
            {f.title}
            <InfoTip text={FLAG_GLOSSARY[f.type]} label={f.title} />
          </div>
          <div className="flag-detail">{f.detail}</div>
        </li>
      ))}
    </ul>
  );
}

// ─── Risk level and KYC badges (icon + text, never colour alone) ────────────────

const LEVEL_TONE = { LOW: 'clear', MEDIUM: 'review', HIGH: 'hold' };
const LEVEL_TEXT = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' };

export function LevelBadge({ level, score, compact }) {
  if (!level) return <span className="status-pill">Not scored</span>;
  const Icon = LEVEL_ICON[LEVEL_TONE[level]] || ShieldAlert;
  return (
    <span className={`risk-badge risk-${LEVEL_TONE[level]}`}>
      <Icon size={14} />{compact ? score : `${LEVEL_TEXT[level]}${score != null ? ` · ${score}/100` : ''}`}
    </span>
  );
}

const KYC_TONE = { VERIFIED: 'clear', NEEDS_REVIEW: 'review', HIGH_RISK: 'hold' };
const KYC_TEXT = { VERIFIED: 'Verified', NEEDS_REVIEW: 'Needs review', HIGH_RISK: 'High risk' };

export function KycBadge({ kyc }) {
  if (!kyc?.status) return <span className="status-pill">Not verified</span>;
  const Icon = LEVEL_ICON[KYC_TONE[kyc.status]];
  return <span className={`risk-badge risk-${KYC_TONE[kyc.status]}`}><Icon size={14} />KYC {KYC_TEXT[kyc.status]} · {kyc.score}</span>;
}

// ─── Dialogs ───────────────────────────────────────────────────────────────────

export function Dialog({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Asks for a reason before a destructive action (reject, dismiss). The reason is required.
export function ReasonDialog({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { setError('Please give a reason.'); return; }
    setBusy(true);
    try { await onConfirm(reason.trim()); onClose(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {message && <p className="muted" style={{ marginBottom: '0.75rem' }}>{message}</p>}
        <label className="form-label" htmlFor="reason">Reason</label>
        <textarea id="reason" className="form-input" rows={3} autoFocus value={reason} onChange={e => setReason(e.target.value)} />
        {error && <div className="error-message" style={{ marginTop: '0.75rem' }}>{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

// Shown while a page loads its data, or when it fails
export function LoadState({ loading, error, onRetry }) {
  if (loading) return <div className="empty-state"><span className="spinner" /> Loading…</div>;
  if (error) return (
    <div className="empty-state">
      <span className="text-error">Could not load data: {error}</span>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
  return null;
}
