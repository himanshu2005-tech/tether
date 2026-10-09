import React, { useEffect, useState, useCallback } from 'react';
import { Lock, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { STAFF_ROLES, ROLE_LABELS, can } from '../security/roles';
import { APPROVAL_CHAIN, DEFAULT_APPROVAL_SETTINGS } from '../constants/approvals';
import { listMembers, listInvites, createInvite, cancelInvite, setMemberRole, getSettings, saveApprovalSettings } from '../services/org';
import { logAudit } from '../services/audit';
import { PageHeader, LoadState } from './Guide';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// Team members, invitations and approval thresholds (admin only)
export default function Settings() {
  const { currentUser, userData, orgId, role } = useAuth();
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [invite, setInvite] = useState({ email: '', staffRole: 'procurement_officer' });

  const load = useCallback(async () => {
    try {
      const [m, i, s] = await Promise.all([listMembers(orgId), listInvites(orgId), getSettings(orgId)]);
      setMembers(m);
      setInvites(i);
      setTiers(s.approvals.tiers.map(t => ({ ...t })));
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => { if (can.manageTeam(role)) load(); }, [load, role]);

  if (!can.manageTeam(role)) {
    return (
      <div className="page-container"><PageHeader title="Team & settings" />
        <div className="empty-state"><Lock size={22} />Only your organisation's admin can manage the team and approval rules.</div>
      </div>
    );
  }

  const say = (ok, text) => setMessage({ ok, text });

  const sendInvite = async (e) => {
    e.preventDefault();
    try {
      await createInvite({ orgId, orgName: userData?.companyName || 'Organisation', email: invite.email, staffRole: invite.staffRole, invitedBy: currentUser.uid });
      await logAudit({ action: 'TEAM_MEMBER_INVITED', entityType: 'user', entityLabel: invite.email, next: { role: invite.staffRole } });
      say(true, `Invitation saved for ${invite.email} as ${ROLE_LABELS[invite.staffRole]}. Tether doesn't send emails yet, so tell them: open Tether → Create account → Account type "Team member: my company admin invited me" → register with ${invite.email}.`);
      setInvite({ email: '', staffRole: 'procurement_officer' });
      load();
    } catch (err) { say(false, err.message); }
  };

  const changeRole = async (m, staffRole) => {
    if (m.uid === currentUser.uid && staffRole !== 'admin' && !window.confirm('You are removing your own admin rights. Continue?')) return;
    try {
      await setMemberRole(m.uid, staffRole);
      await logAudit({ action: 'TEAM_ROLE_CHANGED', entityType: 'user', entityId: m.uid, entityLabel: m.displayName || m.email, previous: { role: m.staffRole || 'admin' }, next: { role: staffRole } });
      say(true, 'Role updated.');
      load();
    } catch (err) { say(false, err.message); }
  };

  const saveTiers = async () => {
    const clean = tiers.map((t, i) => ({ upTo: i === tiers.length - 1 ? null : Number(t.upTo), levels: Number(t.levels) }));
    if (clean.slice(0, -1).some((t, i, a) => !(t.upTo > 0) || (i > 0 && t.upTo <= a[i - 1].upTo))) { say(false, 'Amounts must be positive and increase from row to row.'); return; }
    try {
      const before = (await getSettings(orgId)).approvals;
      await saveApprovalSettings(orgId, { tiers: clean }, currentUser.uid);
      await logAudit({ action: 'SETTINGS_CHANGED', entityType: 'settings', entityId: orgId, entityLabel: 'Approval thresholds', previous: { tiers: JSON.stringify(before.tiers) }, next: { tiers: JSON.stringify(clean) } });
      say(true, 'Approval thresholds saved. They apply to invoices that arrive from now on.');
    } catch (err) { say(false, err.message); }
  };

  return (
    <div className="page-container narrow">
      <PageHeader title="Team & settings" subtitle="Who can do what in your organisation, and how many approvals an invoice needs." />
      {message && <div className={message.ok ? 'success-message' : 'error-message'}>{message.text}</div>}
      {(!members || error) ? <LoadState loading={!error} error={error} onRetry={load} /> : (
        <>
          <section className="card">
            <h3 className="section-title">Team</h3>
            <div className="list flat">
              {members.map(m => (
                <div key={m.uid} className="list-row">
                  <div className="list-main"><div className="list-title">{m.displayName || m.email}</div><div className="list-sub">{m.email}</div></div>
                  <select className="form-input role-select" value={m.staffRole || 'admin'} onChange={e => changeRole(m, e.target.value)} aria-label="Role">
                    {STAFF_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
              ))}
              {invites.map(i => (
                <div key={i.id} className="list-row">
                  <div className="list-main"><div className="list-title">{i.email}</div><div className="list-sub">Invited as {ROLE_LABELS[i.staffRole]} · not registered yet</div></div>
                  <button className="btn-secondary btn-sm" onClick={async () => { if (window.confirm(`Cancel the invitation for ${i.email}?`)) { await cancelInvite(i.email); load(); } }}>Cancel invite</button>
                </div>
              ))}
            </div>
            <form className="invite-row" onSubmit={sendInvite}>
              <input className="form-input" type="email" placeholder="colleague@company.com" value={invite.email} onChange={e => setInvite(p => ({ ...p, email: e.target.value }))} required aria-label="Email" />
              <select className="form-input role-select" value={invite.staffRole} onChange={e => setInvite(p => ({ ...p, staffRole: e.target.value }))} aria-label="Role">
                {STAFF_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button className="btn-primary" style={{ marginTop: 0 }}><UserPlus size={15} /> Invite</button>
            </form>
          </section>

          <section className="card">
            <h3 className="section-title">Invoice approval thresholds</h3>
            <p className="muted" style={{ marginBottom: '0.75rem' }}>Approvals happen in this order: {APPROVAL_CHAIN.map(r => ROLE_LABELS[r]).join(' → ')}. An admin can sign any step.</p>
            <div className="tier-table">
              {tiers.map((t, i) => (
                <div key={i} className="tier-row">
                  <span>{i === tiers.length - 1 ? `Above ${money(tiers[i - 1]?.upTo || 0)}` : <>Up to ₹ <input type="number" className="form-input tier-input" value={t.upTo ?? ''} onChange={e => setTiers(ts => ts.map((x, j) => j === i ? { ...x, upTo: e.target.value } : x))} aria-label="Up to amount" /></>}</span>
                  <select className="form-input role-select" value={t.levels} onChange={e => setTiers(ts => ts.map((x, j) => j === i ? { ...x, levels: Number(e.target.value) } : x))} aria-label="Approvals needed">
                    {[1, 2, 3].map(n => <option key={n} value={n}>{n} approval{n > 1 ? 's' : ''} ({APPROVAL_CHAIN.slice(0, n).map(r => ROLE_LABELS[r]).join(', ')})</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn-secondary" onClick={() => setTiers(DEFAULT_APPROVAL_SETTINGS.tiers.map(t => ({ ...t })))}>Restore defaults</button>
              <button className="btn-primary" onClick={saveTiers}>Save thresholds</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
