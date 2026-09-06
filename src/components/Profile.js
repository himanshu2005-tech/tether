import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { User, Mail, Building, Shield, Edit2, Check, X } from 'lucide-react';

export default function Profile() {
  const { currentUser, userData, setUserData } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleEditName = () => {
    setNewName(userData?.companyName || '');
    setEditingName(true);
  };

  const handleSaveName = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { companyName: newName.trim() });
      if (setUserData) setUserData(prev => ({ ...prev, companyName: newName.trim() }));
      setEditingName(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('Failed to update name: ' + err.message);
    }
    setSaving(false);
  };

  const initials = (userData?.companyName || currentUser?.email || 'US').substring(0, 2).toUpperCase();
  const isSupplier = userData?.role === 'supplier';

  const InfoRow = ({ icon: Icon, label, value, action }) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '1.25rem 0',
      borderBottom: '1px solid var(--border-color)',
      gap: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1 }}>
        <div style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
          <Icon size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.125rem' }}>{label}</p>
          <p style={{ fontWeight: '500' }}>{value}</p>
        </div>
      </div>
      {action}
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: '560px' }}>

      {/* Avatar Header */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '1rem',
        marginBottom: '2.5rem',
        paddingBottom: '2.5rem',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{
          width: '72px',
          height: '72px',
          borderRadius: '50%',
          backgroundColor: 'var(--text-primary)',
          color: 'var(--bg-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          fontWeight: '700',
          letterSpacing: '-0.02em',
          flexShrink: 0,
        }}>
          {initials}
        </div>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
            {userData?.companyName || currentUser?.email}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{
              padding: '0.2rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)'
            }}>
              {userData?.role}
            </span>
            <span style={{
              padding: '0.2rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: '600',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)'
            }}>
              Active
            </span>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div>
        {/* Company Name — editable */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 0',
          borderBottom: '1px solid var(--border-color)',
          gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1 }}>
            <div style={{ color: 'var(--text-secondary)', flexShrink: 0 }}><Building size={18} /></div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.125rem' }}>Company Name</p>
              {editingName ? (
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="form-input"
                  style={{ padding: '0.375rem 0.625rem', fontSize: '0.9375rem', marginTop: '0.25rem' }}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                />
              ) : (
                <p style={{ fontWeight: '500' }}>{userData?.companyName || '—'}</p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            {editingName ? (
              <>
                <button onClick={handleSaveName} disabled={saving} className="btn-primary" style={{ padding: '0.375rem 0.75rem', minHeight: 'unset', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Check size={14} /> {saving ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingName(false)} className="btn-primary" style={{ padding: '0.375rem 0.75rem', minHeight: 'unset', margin: 0, backgroundColor: 'transparent', color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center' }}>
                  <X size={14} />
                </button>
              </>
            ) : (
              <button onClick={handleEditName} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}>
                <Edit2 size={15} />
              </button>
            )}
          </div>
        </div>

        <InfoRow icon={Mail} label="Email Address" value={currentUser?.email} />
        <InfoRow icon={Shield} label="Account ID" value={currentUser?.uid?.substring(0, 16) + '…'} />
        <InfoRow icon={User} label="Role" value={userData?.role ? userData.role.charAt(0).toUpperCase() + userData.role.slice(1) : '—'} />
      </div>

      {saved && (
        <div style={{ marginTop: '1.5rem', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: '500' }}>
          ✓ Company name updated successfully
        </div>
      )}
    </div>
  );
}
