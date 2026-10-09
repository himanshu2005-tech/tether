import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  KYC_DISCLAIMER, REQUIRED_FIELDS, validateGstin, validatePan, validateIfsc, validateEmail, validatePhone, validateBankAccount
} from '../risk/kyc';
import { submitKyc } from '../services/kyc';
import { PageHeader, KycBadge, InfoTip } from './Guide';

const HINTS = {
  gstin: '15 characters, e.g. 27AAPFU0939F1ZV', pan: '10 characters, e.g. AAPFU0939F', ifsc: '11 characters, e.g. HDFC0001234',
  phone: '10-digit number', directors: 'Comma separated, e.g. Ravi Kumar, Anita Rao', bankAccount: 'Kept private; others only see the last 4 digits'
};
const LIVE = { gstin: validateGstin, pan: validatePan, ifsc: validateIfsc, email: validateEmail, phone: validatePhone, bankAccount: validateBankAccount };

// Supplier KYC (scored) or a buyer company's identity details (used to spot conflicts of interest)
export default function Verification() {
  const { currentUser, userData, setUserData } = useAuth();
  const isSupplier = userData?.role === 'supplier';
  const [form, setForm] = useState(null);
  const [result, setResult] = useState(userData?.kyc?.checks ? userData.kyc : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Prefill: public profile plus the owner's private details
  useEffect(() => {
    if (!currentUser) return;
    getDoc(doc(db, 'users', currentUser.uid, 'private', 'kyc')).catch(() => null).then(priv => {
      const p = priv?.exists() ? priv.data() : {};
      setForm({
        companyName: userData?.companyName || '', email: p.email || userData?.email || '', phone: p.phone || userData?.phone || '',
        address: userData?.address || '', gstin: p.gstin || userData?.gstin || '', pan: p.pan || '',
        bankAccount: p.bankAccount || userData?.bankAccount || '', ifsc: p.ifsc || '', directors: userData?.directors || userData?.keyPeople || ''
      });
    });
  }, [currentUser, userData]);

  const set = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { kyc, publicFields } = await submitKyc({ uid: currentUser.uid, form, isSupplier, previousStatus: userData?.kyc?.status || null });
      setUserData(prev => ({ ...prev, ...publicFields }));
      setResult(kyc);
    } catch (err) {
      setError('Could not save: ' + err.message);
    }
    setSaving(false);
  };

  if (!form) return <div className="page-container"><div className="empty-state"><span className="spinner" /></div></div>;

  return (
    <div className="page-container narrow">
      <PageHeader
        title={isSupplier ? 'Supplier verification' : 'Company details'}
        subtitle={isSupplier
          ? 'Your details are checked for correct format and compared with other suppliers. Buyers see your verification status.'
          : 'Used to spot suppliers linked to your company (for example the same address or bank account). Bank and PAN stay private.'} />

      <div className="disclaimer"><ShieldCheck size={16} /> {KYC_DISCLAIMER}</div>

      {isSupplier && result?.checks && (
        <section className="card">
          <div className="row-between">
            <h3 className="section-title" style={{ margin: 0 }}>Result<InfoTip text="Each check adds points up to 100. 80 or more is Verified, 60 to 79 Needs review, below 60 High risk." /></h3>
            <KycBadge kyc={result} />
          </div>
          <ul className="kyc-checks">
            {result.checks.map(c => (
              <li key={c.key} className={c.passed ? 'pass' : 'fail'}>
                {c.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                <span className="kyc-check-text"><b>{c.label}</b><span className="muted">{c.detail}</span></span>
                <span className="kyc-points">{c.points}/{c.max}</span>
              </li>
            ))}
          </ul>
          {result.duplicates?.length > 0 && (
            <div className="notice" style={{ marginTop: '0.75rem' }}>
              {result.duplicates.map((d, i) => <div key={i}>⚠ Shared {d.field} detected with {d.otherName}</div>)}
            </div>
          )}
        </section>
      )}

      <form className="card" onSubmit={submit}>
        <div className="field-grid">
          {REQUIRED_FIELDS.map(([k, label]) => {
            const check = LIVE[k] && form[k] ? LIVE[k](form[k]) : null;
            return (
              <div key={k} className={`form-group${k === 'address' || k === 'directors' ? ' field-wide' : ''}`}>
                <label className="form-label" htmlFor={`kyc-${k}`}>{label}{k === 'gstin' && <InfoTip term="gstin" />}{k === 'directors' && <InfoTip term="keyPeople" />}</label>
                <input id={`kyc-${k}`} className={`form-input${check && !check.ok ? ' input-missing' : ''}`} value={form[k]} onChange={set(k)}
                  placeholder={HINTS[k] || ''} autoComplete="off" />
                {check && <span className={check.ok ? 'field-ok' : 'field-bad'}>{check.message}</span>}
              </div>
            );
          })}
        </div>
        {error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Checking…' : isSupplier ? 'Submit for verification' : 'Save details'}</button>
        </div>
      </form>
    </div>
  );
}
