import React, { useState } from 'react';

// Small, dependency-free chart pieces that follow the app's design tokens.
// One series = one colour (the accent). Status colours (green/amber/red) are only used when the
// colour means clear / review / high risk, and always come with a text label.

function useTooltip() {
  const [tip, setTip] = useState(null);
  const bind = (text) => ({
    onMouseMove: (e) => {
      const box = e.currentTarget.closest('.chart').getBoundingClientRect();
      setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
    },
    onMouseLeave: () => setTip(null),
    onFocus: (e) => {
      const box = e.currentTarget.closest('.chart').getBoundingClientRect();
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ text, x: r.left - box.left + r.width / 2, y: r.top - box.top });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
    'aria-label': text
  });
  const node = tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
  return [bind, node];
}

// Horizontal bars for comparing named values (suppliers, categories)
export function BarList({ rows, format = (v) => v, empty = 'No data yet.', marker = null }) {
  const [bind, tip] = useTooltip();
  if (!rows.length) return <div className="chart-empty">{empty}</div>;
  const max = Math.max(...rows.map(r => r.value), marker?.value || 0) || 1;
  return (
    <div className="chart barlist">
      {rows.map(r => (
        <div key={r.label} className="barlist-row">
          <span className="barlist-label" title={r.label}>{r.label}</span>
          <span className="barlist-track">
            <span className={`barlist-fill${r.tone ? ` tone-${r.tone}` : ''}`} style={{ width: `${(r.value / max) * 100}%` }}
              {...bind(`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`)} />
            {marker && <span className="barlist-marker" style={{ left: `${(marker.value / max) * 100}%` }} title={`${marker.label}: ${format(marker.value)}`} />}
          </span>
          <span className="barlist-value">{format(r.value)}{r.badge && <span className={`barlist-badge tone-${r.tone || 'neutral'}`}>{r.badge}</span>}</span>
        </div>
      ))}
      {marker && <div className="chart-legend"><span className="legend-marker" /> {marker.label}: {format(marker.value)}</div>}
      {tip}
    </div>
  );
}

// Vertical columns over time (one series)
export function Columns({ data, format = (v) => v, empty = 'No data yet.' }) {
  const [bind, tip] = useTooltip();
  if (!data.length || data.every(d => !d.value)) return <div className="chart-empty">{empty}</div>;
  const max = Math.max(...data.map(d => d.value)) || 1;
  return (
    <div className="chart columns" role="img" aria-label={data.map(d => `${d.label}: ${format(d.value)}`).join(', ')}>
      <div className="columns-plot">
        {data.map(d => (
          <div key={d.label} className="columns-col">
            <span className="columns-bar" style={{ height: `${(d.value / max) * 100}%` }} {...bind(`${d.label}: ${format(d.value)}`)} />
          </div>
        ))}
      </div>
      <div className="columns-axis">{data.map(d => <span key={d.label}>{d.label}</span>)}</div>
      {tip}
    </div>
  );
}

// One stacked bar showing how a total splits into labelled parts (e.g. low / medium / high risk)
export function Distribution({ parts, empty = 'No data yet.' }) {
  const [bind, tip] = useTooltip();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="chart-empty">{empty}</div>;
  return (
    <div className="chart distribution">
      <div className="distribution-bar">
        {parts.filter(p => p.value).map(p => (
          <span key={p.label} className={`distribution-seg tone-${p.tone || 'neutral'}`} style={{ flexGrow: p.value }}
            {...bind(`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`)} />
        ))}
      </div>
      <ul className="chart-legend-list">
        {parts.map(p => (
          <li key={p.label}><span className={`legend-swatch tone-${p.tone || 'neutral'}`} />{p.label}<b>{p.value}</b></li>
        ))}
      </ul>
      {tip}
    </div>
  );
}

// Groups dated rows into the last `months` calendar months
export function monthlySeries(rows, value, months = 6, dateOf = (r) => r.createdAtMs) {
  const now = new Date();
  const buckets = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-IN', { month: 'short' }), value: 0 });
  }
  rows.forEach(r => {
    const ms = dateOf(r);
    if (!ms) return;
    const d = new Date(ms);
    const b = buckets.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.value += value(r);
  });
  return buckets;
}

// Two-sided bars around zero, e.g. % above or below the historical average price
export function Diverging({ rows, format = (v) => `${v > 0 ? '+' : ''}${v}%`, empty = 'No data yet.', negLabel = 'Below', posLabel = 'Above' }) {
  const [bind, tip] = useTooltip();
  if (!rows.length) return <div className="chart-empty">{empty}</div>;
  const max = Math.max(...rows.map(r => Math.abs(r.value))) || 1;
  return (
    <div className="chart diverging">
      <div className="diverging-head"><span>{negLabel}</span><span>0</span><span>{posLabel}</span></div>
      {rows.map(r => (
        <div key={r.label} className="diverging-row">
          <span className="barlist-label" title={r.label}>{r.label}</span>
          <span className="diverging-track">
            <span className="diverging-zero" />
            <span className={`diverging-bar ${r.value >= 0 ? 'pos' : 'neg'}`}
              style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value >= 0 ? 'left' : 'right']: '50%' }}
              {...bind(`${r.label}: ${format(r.value)}`)} />
          </span>
          <span className="barlist-value">{format(r.value)}</span>
        </div>
      ))}
      {tip}
    </div>
  );
}
