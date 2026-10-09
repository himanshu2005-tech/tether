import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { loadPriceHistory } from '../services/orgData';
import { benchmark, comparePrice } from '../risk/benchmark';
import { BarList } from './Charts';
import { InfoTip } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const TONE = { above: 'hold', high: 'review', below: 'review', low: 'neutral', normal: 'accent', unknown: 'accent' };

// Compares each bid with this organisation's own past prices for the same product
export default function PriceBenchmark({ tender, bids }) {
  const { orgId } = useAuth();
  const [bm, setBm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!orgId || !tender) return;
    loadPriceHistory(orgId, tender.productName, tender.id).then(h => setBm(benchmark(h))).catch(err => setError(err.message));
  }, [orgId, tender]);

  if (error) return null;
  if (!bm) return <section className="card"><h3 className="section-title">Price benchmark</h3><p className="muted"><span className="spinner" /> Loading history…</p></section>;

  return (
    <section className="card benchmark">
      <h3 className="section-title">Price benchmark<InfoTip text="Each bid is compared with prices you paid or were offered for the same product before: past contracts, past bids and paid invoices. No outside data is used." /></h3>
      {!bm.sufficient ? (
        <p className="muted">Insufficient historical data for reliable benchmarking. ({bm.samples} past price{bm.samples === 1 ? '' : 's'} for {tender.productName}; at least 3 are needed.)</p>
      ) : (
        <>
          <dl className="bench-stats">
            <div><dt>Historical average</dt><dd>{money(bm.average)}</dd></div>
            <div><dt>Median</dt><dd>{money(bm.median)}</dd></div>
            <div><dt>Lowest</dt><dd>{money(bm.min)}</dd></div>
            <div><dt>Highest</dt><dd>{money(bm.max)}</dd></div>
          </dl>
          <p className="muted" style={{ margin: '0.25rem 0 0.75rem' }}>
            From {bm.samples} past prices ({Object.entries(bm.sources).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}).
          </p>
          {bids.length > 0 && (
            <>
              <BarList format={money} marker={{ label: 'Historical average', value: bm.average }}
                rows={bids.map(b => {
                  const c = comparePrice(b.unitPrice, bm);
                  return { label: b.supplierName, value: b.unitPrice, tone: TONE[c.position], badge: ['above', 'high'].includes(c.position) ? '⚠' : null, note: `${c.label} · ${pct(c.vsAverage)} vs average` };
                })} />
              <div className="table-scroll">
                <table className="risk-table" style={{ marginTop: '0.75rem' }}>
                  <thead><tr><th>Supplier</th><th>Bid</th><th>vs. average</th><th>vs. median</th><th>Position</th></tr></thead>
                  <tbody>
                    {bids.map(b => {
                      const c = comparePrice(b.unitPrice, bm);
                      return (
                        <tr key={b.id}>
                          <td>{b.supplierName}</td><td>{money(b.unitPrice)}</td><td>{pct(c.vsAverage)}</td><td>{pct(c.vsMedian)}</td>
                          <td className={['above', 'high'].includes(c.position) ? 'text-warn' : ''}>{['above', 'high'].includes(c.position) ? '⚠ ' : ''}{c.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
