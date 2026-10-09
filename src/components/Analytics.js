import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useOrgInsights } from '../services/insights';
import { computeMetrics } from '../services/metrics';
import { INDUSTRIES } from '../constants/products';
import { BarList, Columns, Distribution, Diverging, monthlySeries } from './Charts';
import { ChartCard, Kpi, money } from './ProcurementDashboard';
import { PageHeader, LoadState } from './Guide';
import {
  IndianRupee, Users, ShieldAlert, Gauge, Gavel, CheckCircle2, Activity, Timer, FileText, XCircle, Clock, Flag, Copy, AlertOctagon, Droplets, ShieldCheck
} from 'lucide-react';

const DAY = 86400000;
const PRESETS = { all: 'All time', 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months', custom: 'Custom range' };

export default function Analytics() {
  const { orgId } = useAuth();
  const { loading, error, data, insights, reload } = useOrgInsights(orgId);
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [industry, setIndustry] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [status, setStatus] = useState('');

  const filters = useMemo(() => {
    const f = { supplierId: supplierId || null, industry: industry || null, riskLevel: riskLevel || null, status: status || null };
    if (range === 'custom') {
      if (from) f.from = new Date(from).getTime();
      if (to) f.to = new Date(to).getTime() + DAY - 1;
    } else if (range !== 'all') {
      f.from = Date.now() - Number(range) * DAY;
    }
    return f;
  }, [range, from, to, supplierId, industry, riskLevel, status]);

  const m = useMemo(() => (data ? computeMetrics(data, insights, filters) : null), [data, insights, filters]);
  const active = Object.values(filters).some(Boolean);

  const reset = () => { setRange('all'); setFrom(''); setTo(''); setSupplierId(''); setIndustry(''); setRiskLevel(''); setStatus(''); };

  return (
    <div className="page-container">
      <PageHeader title="Analytics" subtitle="Spend, suppliers, tenders, invoices and risk, calculated from your organisation's records." />

      <div className="filter-bar">
        <select className="form-input" value={range} onChange={e => setRange(e.target.value)} aria-label="Date range">
          {Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {range === 'custom' && <>
          <input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" />
          <input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} aria-label="To" />
        </>}
        <select className="form-input" value={supplierId} onChange={e => setSupplierId(e.target.value)} aria-label="Supplier">
          <option value="">All suppliers</option>
          {data && Object.values(data.suppliers).map(s => <option key={s.uid} value={s.uid}>{s.companyName || s.email}</option>)}
        </select>
        <select className="form-input" value={industry} onChange={e => setIndustry(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {INDUSTRIES.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select className="form-input" value={riskLevel} onChange={e => setRiskLevel(e.target.value)} aria-label="Supplier risk">
          <option value="">Any supplier risk</option>
          <option value="LOW">Low risk</option><option value="MEDIUM">Medium risk</option><option value="HIGH">High risk</option>
        </select>
        <select className="form-input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <optgroup label="Tenders"><option value="open">Open</option><option value="closed">Closed</option><option value="awarded">Awarded</option></optgroup>
          <optgroup label="Invoices"><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="paid">Paid</option><option value="rejected">Rejected</option></optgroup>
        </select>
        {active && <button className="btn-secondary" onClick={reset}>Clear filters</button>}
      </div>

      {(loading || error) ? <LoadState loading={loading} error={error} onRetry={reload} /> : (
        <>
          <h2 className="group-title">Spend</h2>
          <div className="kpi-grid">
            <Kpi icon={IndianRupee} label="Total spend (paid)" value={money(m.kpis.totalSpend)} />
            <Kpi icon={IndianRupee} label="Contracted value" value={money(m.kpis.procurementValue)} />
          </div>
          <div className="chart-grid">
            <ChartCard title="Monthly spend" wide>
              <Columns data={monthlySeries(m.filtered.bills.filter(b => b.status === 'paid'), b => Number(b.amount) || 0, 12)} format={money} empty="No paid invoices for these filters." />
            </ChartCard>
            <ChartCard title="Spend by category"><BarList rows={m.spendByCategory} format={money} empty="No paid invoices for these filters." /></ChartCard>
            <ChartCard title="Spend by supplier"><BarList rows={m.spendBySupplier.slice(0, 10)} format={money} empty="No paid invoices for these filters." /></ChartCard>
          </div>

          <h2 className="group-title">Suppliers</h2>
          <div className="kpi-grid">
            <Kpi icon={Users} label="Suppliers" value={m.kpis.suppliers} to="/suppliers" />
            <Kpi icon={ShieldAlert} label="High-risk suppliers" value={m.kpis.highRiskSuppliers} tone={m.kpis.highRiskSuppliers ? 'bad' : null} to="/suppliers" />
            <Kpi icon={Gauge} label="Average supplier risk" value={`${m.kpis.averageSupplierRisk}/100`} term="riskScore" />
          </div>
          <div className="chart-grid">
            <ChartCard title="Supplier risk distribution"><Distribution parts={m.supplierRisk} empty="No suppliers for these filters." /></ChartCard>
            <ChartCard title="Supplier performance (invoices passing AI checks)"><BarList rows={m.performance.slice(0, 10)} format={v => `${v}%`} empty="No invoices for these filters." /></ChartCard>
          </div>

          <h2 className="group-title">Tenders</h2>
          <div className="kpi-grid">
            <Kpi icon={Gavel} label="Total tenders" value={m.kpis.totalTenders} to="/tenders" />
            <Kpi icon={Activity} label="Active" value={m.kpis.activeTenders} />
            <Kpi icon={CheckCircle2} label="Completed (awarded)" value={m.kpis.completedTenders} />
            <Kpi icon={Users} label="Average bids per tender" value={m.kpis.bidsPerTender} />
            <Kpi icon={Timer} label="Average procurement cycle" value={m.kpis.avgCycleDays == null ? 'No data' : `${m.kpis.avgCycleDays} days`} />
          </div>
          <div className="chart-grid">
            <ChartCard title="Tender status"><Distribution parts={m.tenderStatus} empty="No tenders for these filters." /></ChartCard>
            <ChartCard title="Bid price vs. historical average"><Diverging rows={m.deviationByTender} empty="Not enough historical prices for these tenders." /></ChartCard>
          </div>

          <h2 className="group-title">Invoices</h2>
          <div className="kpi-grid">
            <Kpi icon={FileText} label="Total invoices" value={m.kpis.invoices} to="/my-orders" />
            <Kpi icon={CheckCircle2} label="Approved or paid" value={m.kpis.invoicesApproved} />
            <Kpi icon={XCircle} label="Rejected" value={m.kpis.invoicesRejected} />
            <Kpi icon={Clock} label="Pending" value={m.kpis.invoicesPending} to="/approvals" />
            <Kpi icon={Flag} label="Flagged by AI" value={m.kpis.invoicesFlagged} to="/risk" />
            <Kpi icon={Copy} label="Duplicates" value={m.kpis.duplicateInvoices} />
          </div>
          <div className="chart-grid">
            <ChartCard title="Invoice status"><Distribution parts={m.invoiceStatus} empty="No invoices for these filters." /></ChartCard>
            <ChartCard title="Invoice risk"><Distribution parts={m.invoiceRisk} empty="No invoices for these filters." /></ChartCard>
          </div>

          <h2 className="group-title">Risk</h2>
          <div className="kpi-grid">
            <Kpi icon={AlertOctagon} label="Open risk alerts" value={m.kpis.riskAlerts} to="/fraud" />
            <Kpi icon={Droplets} label="Leakage detected" value={money(m.kpis.leakageDetected)} term="leakage" />
            <Kpi icon={ShieldCheck} label="Leakage prevented" value={money(m.kpis.leakagePrevented)} term="leakageStopped" />
          </div>
          <div className="chart-grid">
            <ChartCard title="Alerts by category"><BarList rows={m.alertCategories.filter(c => c.value)} empty="No open alerts." /></ChartCard>
            <ChartCard title="Flagged invoices by month">
              <Columns data={monthlySeries(m.filtered.bills.filter(b => b.analysis && b.analysis.level !== 'clear'), () => 1, 6)} empty="No flagged invoices." />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
