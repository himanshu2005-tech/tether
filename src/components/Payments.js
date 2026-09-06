import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Search, CheckCircle, XCircle, Receipt } from 'lucide-react';

export default function Payments() {
  const { currentUser } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    setReceipt(null);
    setNotFound(false);
    setHasSearched(true);

    const formattedTerm = searchTerm.replace('#', '').trim().toUpperCase();

    try {
      const q = query(
        collection(db, 'bills'),
        where('consumerId', '==', currentUser.uid),
        where('status', '==', 'paid')
      );

      const querySnapshot = await getDocs(q);
      let foundReceipt = null;

      querySnapshot.forEach((docSnap) => {
        const id = docSnap.id.substring(0, 8).toUpperCase();
        if (id === formattedTerm) {
          foundReceipt = { id: docSnap.id, displayId: id, ...docSnap.data() };
        }
      });

      if (foundReceipt) {
        setReceipt(foundReceipt);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      console.error(err);
      setNotFound(true);
    }

    setIsSearching(false);
  };

  return (
    <div className="page-container">

      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Receipt size={28} />
          <h2 style={{ fontSize: '2rem', fontWeight: '600' }}>Payment Tracking</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>
          Enter a Payment ID to verify and retrieve a receipt for any completed transaction.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '2.5rem', maxWidth: '560px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search
            size={18}
            style={{
              position: 'absolute', left: '1rem', top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
              pointerEvents: 'none'
            }}
          />
          <input
            type="text"
            className="form-input"
            placeholder="Enter Payment ID (e.g. A1B2C3D4)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ paddingLeft: '2.75rem', width: '100%', boxSizing: 'border-box' }}
            required
          />
        </div>
        <button
          type="submit"
          disabled={isSearching}
          className="btn-primary"
          style={{ padding: '0 1.75rem', whiteSpace: 'nowrap' }}
        >
          {isSearching ? <span className="spinner"></span> : 'Verify'}
        </button>
      </form>

      {/* Not Found State */}
      {hasSearched && notFound && !isSearching && (
        <div style={{
          maxWidth: '480px',
          border: '1px solid var(--border-color)',
          borderRadius: '1rem',
          padding: '2.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          textAlign: 'center'
        }}>
          <XCircle size={48} color="var(--error-color)" />
          <div>
            <p style={{ fontWeight: '600', fontSize: '1.125rem' }}>No Receipt Found</p>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.375rem', fontSize: '0.875rem' }}>
              No paid bill matching <span style={{ fontFamily: 'monospace', fontWeight: '600' }}>#{searchTerm.replace('#','').trim().toUpperCase()}</span> was found in your account.
            </p>
          </div>
        </div>
      )}

      {/* Receipt Card */}
      {receipt && (
        <div style={{ maxWidth: '480px' }}>
          {/* Verified Header */}
          <div style={{
            border: '1px solid var(--border-color)',
            borderBottom: 'none',
            borderRadius: '1rem 1rem 0 0',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
            textAlign: 'center',
            backgroundColor: 'var(--surface-color)'
          }}>
            <CheckCircle size={52} color="var(--text-primary)" />
            <div>
              <p style={{ fontWeight: '700', fontSize: '1.25rem' }}>Payment Verified</p>
              <p style={{ fontFamily: 'monospace', fontSize: '1rem', color: 'var(--text-secondary)', marginTop: '0.25rem', letterSpacing: '0.05em' }}>
                #{receipt.displayId}
              </p>
            </div>
          </div>

          {/* Receipt Body */}
          <div style={{
            border: '1px solid var(--border-color)',
            borderTop: '1px dashed var(--border-color)',
            borderRadius: '0 0 1rem 1rem',
            backgroundColor: 'var(--surface-color)',
            overflow: 'hidden'
          }}>
            {[
              { label: 'Product', value: receipt.productName },
              { label: 'Description', value: receipt.description },
              { label: 'Date Paid', value: receipt.createdAt ? new Date(receipt.createdAt.toMillis()).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A' },
            ].map(({ label, value }) => (
              <div key={label} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.875rem 2rem',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{label}</span>
                <span style={{ fontWeight: '500' }}>{value}</span>
              </div>
            ))}

            {/* Total row */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.25rem 2rem',
              backgroundColor: 'var(--bg-color)'
            }}>
              <span style={{ fontWeight: '700', fontSize: '1.0625rem' }}>Total Paid</span>
              <span style={{ fontWeight: '700', fontSize: '1.25rem' }}>
                ₹{Number(receipt.amount).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
