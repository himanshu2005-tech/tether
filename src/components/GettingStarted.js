import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';

// First-run checklist on the Home page. Each step ticks itself off from real data,
// so a new user always knows the next thing to do.
const STEPS = {
  consumer: [
    { title: 'Add your business details', why: 'Helps AI spot suppliers linked to your company.', to: '/profile', done: (u) => Boolean(u.address || u.bankAccount || u.keyPeople) },
    { title: 'Post your first tender', why: 'Describe it in a sentence. AI drafts the rest.', to: '/tenders', done: (u, s) => s.tenders > 0 },
    { title: 'Award a contract', why: 'AI ranks the bids and flags risky ones.', to: '/tenders', done: (u, s) => s.contracts > 0 },
    { title: 'Review invoices in the Risk Center', why: 'Flagged invoices wait for your decision.', to: '/risk', done: (u, s) => s.checkedInvoices > 0 }
  ],
  supplier: [
    { title: 'Add your business details', why: 'Buyers trust complete, verifiable profiles.', to: '/profile', done: (u) => Boolean(u.address || u.bankAccount || u.keyPeople) },
    { title: 'Bid on an open tender', why: 'AI suggests a competitive price.', to: '/tenders', done: (u, s) => s.bids > 0 },
    { title: 'Win a contract', why: 'Awarded bids appear under Contracts.', to: '/contracts', done: (u, s) => s.contracts > 0 },
    { title: 'Raise your first invoice', why: 'Invoices that match the contract clear instantly.', to: '/contracts', done: (u, s) => s.contractInvoices > 0 }
  ]
};

export default function GettingStarted({ role, userData, stats }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(`getting-started:${role}`) === 'hidden'; } catch { return false; }
  });

  const steps = STEPS[role];
  if (!steps || hidden) return null;

  const status = steps.map(s => s.done(userData || {}, stats || {}));
  const completed = status.filter(Boolean).length;
  if (completed === steps.length) return null;
  const nextIndex = status.indexOf(false);

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(`getting-started:${role}`, 'hidden'); } catch { /* storage unavailable */ }
  };

  return (
    <div className="getting-started">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>Get set up</h3>
        </div>
        <button className="guide-close" onClick={dismiss} aria-label="Hide getting started"><X size={16} /></button>
      </div>

      <div className="progress-track"><div className="progress-fill" style={{ width: `${(completed / steps.length) * 100}%` }} /></div>
      <div className="muted" style={{ fontSize: '0.8125rem', marginBottom: '0.5rem' }}>{completed} of {steps.length} done</div>

      <ol className="checklist">
        {steps.map((s, i) => (
          <li key={s.title} className={`checklist-item${status[i] ? ' done' : ''}${i === nextIndex ? ' next' : ''}`}>
            {status[i] ? <CheckCircle2 size={20} /> : <Circle size={20} />}
            <div style={{ flex: 1 }}>
              <div className="checklist-title">{s.title}</div>
              <div className="checklist-why">{s.why}</div>
            </div>
            {!status[i] && (
              <button className={i === nextIndex ? 'btn-primary' : 'btn-secondary'} style={{ marginTop: 0 }} onClick={() => navigate(s.to)}>
                {i === nextIndex ? 'Start' : 'Go'}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
