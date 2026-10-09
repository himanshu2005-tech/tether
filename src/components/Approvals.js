import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, can } from '../security/roles';
import { decideInvoice } from '../services/approvals';
import { PageHeader, RiskBadge, FlagList, ReasonDialog, LoadState } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function ApprovalProgress({ approval }) {
  if (!approval) return <p className="muted">Waiting for AI validation…</p>;
  return (
    <ol className="approval-steps">
      <li className="approval-step done"><CheckCircle2 size={16} /><span><b>AI validation</b></span></li>
      {approval.steps.map(s => (
        <li key={s.role} className={`approval-step ${s.status === 'approved' ? 'done' : s.status === 'rejected' ? 'rejected' : 'waiting'}`}>
          {s.status === 'approved' ? <CheckCircle2 size={16} /> : s.status === 'rejected' ? <XCircle size={16} /> : <Circle size={16} />}
          <span>
            <b>{ROLE_LABELS[s.role]}</b>
            {s.by && <span className="muted"> · {s.byName || 'someone'}{s.actingRole === 'admin' && s.role !== 'admin' ? ' (as admin)' : ''}, {when(s.at)}</span>}
            {s.reason && <span className="approval-reason">“{s.reason}”</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function Approvals() {
  const { currentUser, userData, orgId, role } = useAuth();
  const navigate = useNavigate();
  const [bills, setBills] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('mine');
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!orgId) return undefined;
    return onSnapshot(query(collection(db, 'bills'), where('consumerId', '==', orgId)), snap => {
      setBills(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, err => setError(err.message));
  }, [orgId]);

  const groups = useMemo(() => {
    const all = bills || [];
    // Invoices rejected in the Risk Center leave the queue even though their chain was not finished
    const pending = all.filter(b => b.approval?.status === 'pending' && b.status === 'unpaid');
    return {
      mine: pending.filter(b => can.approveStep(role, b.approval.nextRole)),
      waiting: pending.filter(b => !can.approveStep(role, b.approval.nextRole)),
      intake: all.filter(b => !b.approval && b.status === 'unpaid'),
      done: all.filter(b => b.approval && (b.approval.status !== 'pending' || b.status !== 'unpaid'))
    };
  }, [bills, role]);

  const act = async (bill, decision, reason) => {
    setBusy(prev => ({ ...prev, [bill.id]: true }));
    setMessage(null);
    try {
      const result = await decideInvoice(bill, { decision, reason, role, orgId, user: { uid: currentUser.uid, name: userData?.displayName || currentUser.email } });
      setMessage({ ok: true, text: result.status === 'approved' ? 'Fully approved. It can now be paid.' : result.status === 'rejected' ? 'Invoice rejected.' : `Approved. Now waiting for ${ROLE_LABELS[result.nextRole]}.` });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
      if (decision === 'reject') throw err;
    }
    setBusy(prev => ({ ...prev, [bill.id]: false }));
  };

  const list = groups[tab] || [];
  const tabs = [
    ['mine', `Waiting for you (${groups.mine.length})`],
    ['waiting', `Waiting for others (${groups.waiting.length})`],
    ['intake', `Being validated (${groups.intake.length})`],
    ['done', 'Completed']
  ];

  return (
    <div className="page-container">
      <PageHeader title="Approvals"
        subtitle={`Invoices are validated by AI, then signed off by your team according to their value. You are signed in as ${ROLE_LABELS[role] || role}.`} />

      <div className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {message && <div className={message.ok ? 'success-message' : 'error-message'}>{message.text}</div>}

      {bills === null ? <LoadState loading={!error} error={error} /> : list.length === 0 ? (
        <div className="empty-state">{tab === 'mine' ? 'Nothing needs your approval right now.' : 'Nothing here.'}</div>
      ) : (
        <div className="stack">
          {list.map(b => {
            const step = b.approval?.nextRole;
            const aiHold = b.analysis?.level === 'hold' && b.reviewStatus === 'pending_review';
            const mayAct = b.approval?.status === 'pending' && can.approveStep(role, step);
            return (
              <article key={b.id} className="card">
                <div className="row-between">
                  <div>
                    <div className="list-title">{b.productName} · {money(b.amount)}</div>
                    <div className="list-sub">#{b.invoiceNumber || b.id.slice(0, 8).toUpperCase()} · {b.approval?.tier || 'Awaiting validation'}{b.source === 'upload' ? ' · uploaded document' : ''}</div>
                  </div>
                  <RiskBadge analysis={b.analysis} />
                </div>
                {b.analysis?.summary && <p style={{ marginTop: '0.6rem' }}>{b.analysis.summary}</p>}
                <FlagList flags={b.analysis?.flags} />
                <div className="approval-wrap"><ApprovalProgress approval={b.approval} /></div>
                {mayAct && (
                  <>
                    {aiHold && <div className="notice">The AI put this invoice on hold. Review its flags in the Risk Center before approving.</div>}
                    <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                      <button className="btn-primary" disabled={busy[b.id] || aiHold} onClick={() => act(b, 'approve')}>
                        Approve as {ROLE_LABELS[role === 'admin' ? step : role]}
                      </button>
                      <button className="btn-danger" disabled={busy[b.id]} onClick={() => setRejecting(b)}>Reject</button>
                      {aiHold && <button className="btn-secondary" onClick={() => navigate('/risk')}>Open Risk Center</button>}
                    </div>
                  </>
                )}
                {b.approval?.status === 'pending' && !mayAct && (
                  <p className="muted" style={{ marginTop: '0.5rem' }}>Waiting for {ROLE_LABELS[step]}. Only that role or an admin can sign this step.</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {rejecting && (
        <ReasonDialog title="Reject invoice" confirmLabel="Reject invoice"
          message={`${rejecting.productName} · ${money(rejecting.amount)}. The supplier and your team will see the reason, and it is recorded in the audit trail.`}
          onConfirm={(reason) => act(rejecting, 'reject', reason)} onClose={() => setRejecting(null)} />
      )}
    </div>
  );
}
