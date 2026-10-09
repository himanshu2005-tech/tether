import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { InfoTip, PageHeader } from './Guide';
import { ROLE_LABELS } from '../security/roles';
import IndustryPicker from './IndustryPicker';

export default function Profile() {
  const { currentUser, userData, setUserData, role } = useAuth();
  const location = useLocation();

  // Links like /profile#play-area jump straight to that section
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { companyName: newName.trim() });
      if (setUserData) setUserData(prev => ({ ...prev, companyName: newName.trim() }));
      setEditingName(false);
    } catch (err) {
      alert('Could not update name: ' + err.message);
    }
    setSaving(false);
  };

  const name = userData?.companyName || currentUser?.email;

  return (
    <div className="page-container narrow">
      <PageHeader title="Profile" subtitle="Your company details." />

      <section className="card">
        <div className="profile-head">
          <span className="avatar avatar-lg">{(name || 'US').substring(0, 2).toUpperCase()}</span>
          <div className="profile-name">
            {editingName ? (
              <div className="inline-edit">
                <input autoFocus className="form-input" value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }} />
                <button className="btn-primary btn-sm" style={{ marginTop: 0 }} onClick={saveName} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn-secondary btn-sm" onClick={() => setEditingName(false)}>Cancel</button>
              </div>
            ) : (
              <>
                <h2>{name}</h2>
                <button className="icon-btn" onClick={() => { setNewName(userData?.companyName || ''); setEditingName(true); }}
                  title="Edit company name" aria-label="Edit company name"><Pencil size={15} /></button>
              </>
            )}
            <span className="status-pill">{ROLE_LABELS[role] || 'Buyer'}</span>
          </div>
        </div>
        <dl className="detail-list">
          <div><dt>Email</dt><dd>{currentUser?.email}</dd></div>
          <div><dt>About</dt><dd>{userData?.description || '—'}</dd></div>
          <div><dt>Account ID</dt><dd className="mono">{currentUser?.uid?.substring(0, 16)}…</dd></div>
        </dl>
      </section>

      {userData?.role === 'supplier' && (
        <PlayArea currentUser={currentUser} userData={userData} setUserData={setUserData} />
      )}

      <section className="card">
        <h3 className="section-title">{userData?.role === 'supplier' ? 'Verification (KYC)' : 'Company details'}<InfoTip term="businessDetails" /></h3>
        <p className="muted" style={{ marginBottom: '0.75rem' }}>
          {userData?.role === 'supplier'
            ? 'GSTIN, PAN, bank and director details, checked for format and compared with other suppliers. Bank and PAN numbers stay private.'
            : 'Your company identity, used to spot suppliers linked to your organisation. Bank and PAN numbers stay private.'}
        </p>
        <Link to="/verification" className="btn-secondary">{userData?.kyc ? 'View or update details' : 'Add details'}</Link>
      </section>
    </div>
  );
}

// Industries a supplier serves; decides which tenders they see
function PlayArea({ currentUser, userData, setUserData }) {
  const [industries, setIndustries] = useState(userData?.industries || []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const changed = JSON.stringify([...industries].sort()) !== JSON.stringify([...(userData?.industries || [])].sort());

  const save = async () => {
    if (!industries.length) { setMessage({ ok: false, text: 'Pick at least one industry.' }); return; }
    setSaving(true);
    setMessage(null);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { industries });
      if (setUserData) setUserData(prev => ({ ...prev, industries }));
      setMessage({ ok: true, text: 'Saved. Tenders now match your play area.' });
    } catch (err) {
      setMessage({ ok: false, text: 'Could not save: ' + err.message });
    }
    setSaving(false);
  };

  return (
    <section className="card" id="play-area">
      <h3 className="section-title">Play area</h3>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        The industries you supply. You only see tenders for products in these industries.
      </p>
      <IndustryPicker value={industries} onChange={setIndustries} />
      <div className="form-actions">
        {message && <span className={message.ok ? 'text-success' : 'text-error'}>{message.text}</span>}
        <button className="btn-primary" onClick={save} disabled={saving || !changed}>{saving ? 'Saving…' : 'Save play area'}</button>
      </div>
    </section>
  );
}
