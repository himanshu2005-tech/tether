import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  IndianRupee, Gavel, Users, FileSignature, FileText, ClipboardCheck, ShieldAlert, AlertTriangle, ShieldCheck, Timer, Droplets
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOrgInsights } from '../services/insights';
import { computeMetrics } from '../services/metrics';
import { BarList, Columns, Distribution, Diverging, monthlySeries } from './Charts';
import { LoadState, InfoTip } from './Guide';

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function Kpi({ icon: Icon, label, value, to, tone, term }) {
  const body = (
    <>
      <Icon />
      <div className="kpi-label">{label}{term && <InfoTip term={term} label={label} />}</div>
      <div className={`kpi-value${tone ? ` text-${tone}` : ''}`}>{value}</div>
    </>
  );
  return to ? <Link to={to} className="kpi-card kpi-link">{body}</Link> : <div className="kpi-card">{body}</div>;
}

export function ChartCard({ title, children, wide }) {
  return (
    <section className={`card chart-card${wide ? ' wide' : ''}`}>
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );
}

// Buyer dashboard: live KPIs and charts from Firestore (no sample numbers)
export default function ProcurementDashboard() {
  const { orgId } = useAuth();
  const { loading, error, data, insights, reload } = useOrgInsights(orgId);
  const m = useMemo(() => (data ? computeMetrics(data, insights) : null), [data, insights]);

  if (loading || error) return <LoadState loading={loading} error={error} onRetry={reload} />;
  const k = m.kpis;

  return (
    <div className="dashboard">
      <div className="kpi-grid kpi-grid-wide">
        <Kpi icon={IndianRupee} label="Procurement value" value={money(k.procurementValue)} to="/contracts" />
        <Kpi icon={Gavel} label="Active tenders" value={k.activeTenders} to="/tenders" />
        <Kpi icon={Users} label="Suppliers" value={k.suppliers} to="/suppliers" />
        <Kpi icon={FileSignature} label="Contracts" value={k.contracts} to="/contracts" />
        <Kpi icon={FileText} label="Invoices" value={k.invoices} to="/my-orders" />
        <Kpi icon={ClipboardCheck} label="Pending approvals" value={k.pendingApprovals} to="/approvals" tone={k.pendingApprovals ? 'warn' : null} />
        <Kpi icon={ShieldAlert} label="High-risk suppliers" value={k.highRiskSuppliers} to="/suppliers" tone={k.highRiskSuppliers ? 'bad' : null} />
        <Kpi icon={AlertTriangle} label="High-risk invoices" value={k.highRiskInvoices} to="/risk" tone={k.highRiskInvoices ? 'bad' : null} />
        <Kpi icon={Droplets} label="Leakage detected" value={money(k.leakageDetected)} to="/risk" term="leakage" />
        <Kpi icon={ShieldCheck} label="Leakage prevented" value={money(k.leakagePrevented)} to="/risk" term="leakageStopped" />
        <Kpi icon={Timer} label="Avg. procurement cycle" value={k.avgCycleDays == null ? 'No data' : `${k.avgCycleDays} days`} />
      </div>

      <div className="chart-grid">
        <ChartCard title="Monthly procurement spend (paid invoices)" wide>
          <Columns data={monthlySeries(data.bills.filter(b => b.status === 'paid'), b => Number(b.amount) || 0)} format={money} empty="No paid invoices in the last 6 months." />
        </ChartCard>
        <ChartCard title="Supplier risk">
          <Distribution parts={m.supplierRisk} empty="No suppliers scored yet." />
        </ChartCard>
        <ChartCard title="Tender status">
          <Distribution parts={m.tenderStatus} empty="No tenders yet." />
        </ChartCard>
        <ChartCard title="Invoice risk (AI checks)">
          <Distribution parts={m.invoiceRisk} empty="No invoices yet." />
        </ChartCard>
        <ChartCard title="Leakage">
          <BarList format={money} empty="No leakage detected." rows={[
            { label: 'Detected', value: k.leakageDetected, tone: 'review' },
            { label: 'Prevented', value: k.leakagePrevented, tone: 'clear' }
          ].filter(r => r.value > 0)} />
        </ChartCard>
        <ChartCard title="Bid price vs. your historical average">
          <Diverging rows={m.deviationByTender} empty="Not enough historical prices to compare yet." />
        </ChartCard>
        <ChartCard title="Supplier performance (invoices passing AI checks)">
          <BarList rows={m.performance.slice(0, 8)} format={v => `${v}%`} empty="No invoices yet." />
        </ChartCard>
      </div>
      <p className="muted" style={{ marginTop: '1rem' }}>
        All figures come from your organisation's records. <Link to="/analytics">Open analytics</Link> for filters and more detail.
      </p>
    </div>
  );
}
