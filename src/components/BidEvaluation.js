import React from 'react';
import { CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';
import { InfoTip, AiTag } from './Guide';

const STATUS = {
  pass: { icon: CheckCircle2, label: 'Passed', cls: 'pass' },
  fail: { icon: AlertTriangle, label: 'Problem found', cls: 'fail' },
  unknown: { icon: MinusCircle, label: 'Could not check', cls: 'unknown' }
};

// Shows how a bid's value score was built and every check that was run on it
export default function BidEvaluation({ ai, open }) {
  if (!ai) return null;

  if (!ai.breakdown) {
    return (
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        Value score {ai.valueScore}/100. Press <b>Re-run analysis</b> above to see how it was worked out.
      </p>
    );
  }

  const passed = ai.checks.filter(c => c.status === 'pass').length;
  const failed = ai.checks.filter(c => c.status === 'fail').length;

  return (
    <details className="eval" open={open}>
      <summary className="eval-summary">
        <span>How this bid was evaluated</span>
        <span className="eval-score">{ai.valueScore}<span>/100</span><InfoTip term="valueScore" label="value score" /></span>
      </summary>

      <div className="eval-section">
        <div className="eval-subhead">Score</div>
        {ai.breakdown.map(part => (
          <div key={part.key} className="eval-bar-row">
            <div className="eval-bar-top">
              <span className="eval-bar-label">{part.label}</span>
              <span className="eval-bar-points">{part.points} <span>of {part.weight}</span></span>
            </div>
            <div className="eval-bar-track"><div className="eval-bar-fill" style={{ width: `${(part.points / part.weight) * 100}%` }} /></div>
            <div className="eval-bar-detail">{part.detail}</div>
          </div>
        ))}
      </div>

      <div className="eval-section">
        <div className="eval-subhead">
          Checks <span className="muted">· {passed} passed{failed ? `, ${failed} problem${failed > 1 ? 's' : ''}` : ''}</span>
        </div>
        <ul className="eval-checks">
          {ai.checks.map(c => {
            const st = STATUS[c.status];
            return (
              <li key={c.label} className={`eval-check ${st.cls}`}>
                <st.icon size={15} aria-label={st.label} />
                <span className="eval-check-text">
                  <span className="eval-check-label">{c.label}{c.ai && <AiTag>AI</AiTag>}</span>
                  <span className="eval-check-detail">{c.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
