// Derived insights for a buyer organisation: supplier risk scores and suspicious patterns.
// Calculated from loaded data, then synced to Firestore so changes are audited and notified once.
import { useCallback, useEffect, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { loadOrgData, loadAllSupplierIdentities } from './orgData';
import { scoreSupplier } from '../risk/supplierRisk';
import { detectPatterns } from '../risk/fraud';
import { findDuplicates } from '../risk/kyc';
import { logAudit } from './audit';
import { notify } from './notify';

const alertDocId = (orgId, key) => `${orgId}__${key}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 700);
const riskDocId = (orgId, supplierId) => `${orgId}__${supplierId}`;

// Several pages can load insights at the same moment; remember what this session already saved
// so each new alert or score change is written, audited and notified only once
const syncedAlerts = new Set();
const syncedScores = new Map();

export function computeInsights(data, network = []) {
  const stored = Object.fromEntries(data.alerts.map(a => [a.key, a]));
  const detected = detectPatterns(data).map(a => ({
    ...a,
    status: stored[a.key]?.status || 'open',
    dismissReason: stored[a.key]?.dismissReason || null,
    firstSeen: stored[a.key]?.firstSeen || null,
    stored: Boolean(stored[a.key])
  }));

  const risks = {};
  Object.values(data.suppliers).forEach(supplier => {
    const uid = supplier.uid;
    const bidIds = new Set(data.bids.filter(b => b.supplierId === uid).map(b => b.id));
    const bidResults = data.tenders.flatMap(t => (t.aiAnalysis?.bids || []).filter(r => bidIds.has(r.bidId)));
    const bills = data.bills.filter(b => b.supplierId === uid);
    const alerts = detected.filter(a => a.supplierIds?.includes(uid));
    // Relationships with any supplier in the network, found now rather than at KYC time
    const identity = supplier.kyc?.identity;
    const duplicates = identity
      ? findDuplicates(identity, network.filter(n => n.uid !== uid && n.identity).map(n => ({ uid: n.uid, name: n.name, identity: n.identity })))
      : null;
    risks[uid] = { supplier, ...scoreSupplier({ supplier, bidResults, bills, alerts, duplicates }), bids: bidIds.size, invoices: bills.length, duplicates: duplicates || [] };
  });
  return { alerts: detected, risks };
}

// Writes new alerts and changed risk scores, with audit records and notifications
async function syncInsights(data, insights) {
  const { orgId } = data;
  for (const a of insights.alerts) {
    const akey = `${orgId}|${a.key}`;
    if (a.stored || syncedAlerts.has(akey)) continue;
    syncedAlerts.add(akey);
    await setDoc(doc(db, 'fraudAlerts', alertDocId(orgId, a.key)), {
      orgId, key: a.key, category: a.category, type: a.type, level: a.level, title: a.title, reasons: a.reasons,
      supplierIds: a.supplierIds || [], entities: a.entities || [], status: 'open', firstSeen: serverTimestamp()
    }).catch(err => console.warn('Could not save alert', err.message));
    await logAudit({ action: 'FRAUD_FLAG_RAISED', entityType: a.entities?.[0]?.type || 'supplier', entityId: a.entities?.[0]?.id || a.supplierIds?.[0] || null,
      entityLabel: a.title, next: { level: a.level, reasons: a.reasons } });
    if (a.level !== 'LOW') {
      await notify({ orgId, roles: ['procurement_manager', 'admin'] }, {
        kind: 'suspicious_pattern', severity: a.level === 'HIGH' ? 'high' : 'medium',
        title: `Suspicious pattern: ${a.title.toLowerCase()}`, message: a.reasons.join(' '), entityType: 'alert', entityId: a.key, link: '/fraud'
      });
    }
  }

  const prev = Object.fromEntries(data.scores.map(s => [s.supplierId, s]));
  for (const [uid, r] of Object.entries(insights.risks)) {
    const before = prev[uid];
    const skey = `${orgId}|${uid}`;
    if ((before && before.score === r.score) || syncedScores.get(skey) === r.score) continue;
    syncedScores.set(skey, r.score);
    await setDoc(doc(db, 'riskScores', riskDocId(orgId, uid)), {
      orgId, supplierId: uid, supplierName: r.supplier.companyName || r.supplier.email || null,
      score: r.score, level: r.level, factors: r.factors, updatedAt: serverTimestamp()
    }).catch(err => console.warn('Could not save risk score', err.message));
    await logAudit({ action: 'RISK_SCORE_CHANGED', entityType: 'supplier', entityId: uid, entityLabel: r.supplier.companyName,
      previous: before ? { score: before.score, level: before.level } : null, next: { score: r.score, level: r.level, factors: r.factors.map(f => f.label) } });
    if (r.level === 'HIGH' && before?.level !== 'HIGH') {
      await notify({ orgId, roles: ['procurement_manager', 'admin'] }, {
        kind: 'high_risk_supplier', severity: 'high', title: 'High-risk supplier',
        message: `${r.supplier.companyName || 'A supplier'} now scores ${r.score}/100: ${r.factors.slice(0, 3).map(f => f.label.toLowerCase()).join(', ')}.`,
        entityType: 'supplier', entityId: uid, link: `/suppliers?id=${uid}`
      });
    }
  }
}

export async function dismissAlert(orgId, alert, reason) {
  // merge: the alert may not be saved yet if it was only just detected
  await setDoc(doc(db, 'fraudAlerts', alertDocId(orgId, alert.key)), {
    orgId, key: alert.key, category: alert.category, type: alert.type, level: alert.level, title: alert.title, reasons: alert.reasons,
    supplierIds: alert.supplierIds || [], status: 'dismissed', dismissReason: reason, dismissedAt: serverTimestamp()
  }, { merge: true });
  await logAudit({ action: 'FRAUD_FLAG_DISMISSED', entityType: 'alert', entityId: alert.key, entityLabel: alert.title, previous: { status: 'open' }, next: { status: 'dismissed' }, reason });
}

/** Loads an organisation's data plus insights. sync=true saves new alerts and risk changes. */
export function useOrgInsights(orgId, { sync = true } = {}) {
  const [state, setState] = useState({ loading: true, error: null, data: null, insights: null });

  const load = useCallback(async () => {
    if (!orgId) return;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const [data, network] = await Promise.all([loadOrgData(orgId), loadAllSupplierIdentities()]);
      const insights = computeInsights(data, network);
      setState({ loading: false, error: null, data, insights });
      if (sync) syncInsights(data, insights).catch(err => console.warn('Insight sync failed:', err.message));
    } catch (err) {
      setState({ loading: false, error: err.message, data: null, insights: null });
    }
  }, [orgId, sync]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
