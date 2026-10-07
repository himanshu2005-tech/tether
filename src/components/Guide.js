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
