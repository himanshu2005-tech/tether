import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { PREDEFINED_PRODUCTS } from '../constants/products';

export default function CompanyLimits() {
  const { currentUser } = useAuth();
  const [limits, setLimits] = useState({});
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function fetchLimits() {
      if (!currentUser) return;
      try {
        const docRef = doc(db, 'limits', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setLimits(docSnap.data().limits || {});
        }
      } catch (err) {
        console.error("Failed to fetch limits:", err);
      }
      setLoading(false);
    }
    fetchLimits();
  }, [currentUser]);

  const handleLimitChange = (productName, value) => {
    setLimits(prev => ({
      ...prev,
      [productName]: value
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSaving(true);
    
    // Clean up empty limits before saving
    const cleanedLimits = {};
    Object.keys(limits).forEach(key => {
      const val = parseFloat(limits[key]);
      if (!isNaN(val) && val > 0) {
        cleanedLimits[key] = val;
      }
    });

    try {
      await setDoc(doc(db, 'limits', currentUser.uid), {
        limits: cleanedLimits,
        updatedAt: serverTimestamp()
      });
      setSuccess("Limits saved successfully!");
    } catch (err) {
      setError("Failed to save limits: " + err.message);
    }
    setIsSaving(false);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ alignItems: 'center', paddingTop: '4rem' }}>
        <span className="spinner" style={{ width: '2rem', height: '2rem' }}></span>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2.5rem', fontWeight: '700' }}>Company Limits</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          Set the maximum price per unit you are willing to spend for these products. 
          We'll warn you if a supplier's price exceeds your limit.
        </p>
      </div>

      <div className="form-container" style={{ padding: '2rem', border: '1px solid var(--border-color)' }}>
        {error && <div className="error-message">{error}</div>}
        {success && <div style={{ color: 'green', marginBottom: '1.5rem', fontWeight: '500' }}>{success}</div>}
        
        <form onSubmit={handleSave}>
          <div className="limits-grid">
            {PREDEFINED_PRODUCTS.map(product => (
              <div key={product} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '1rem',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <span style={{ fontWeight: '500' }}>{product}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>₹</span>
                  <input 
                    type="number" 
                    className="form-input" 
                    style={{ width: '120px', textAlign: 'right' }}
                    min="0"
                    step="0.01"
                    placeholder="No limit"
                    value={limits[product] || ''}
                    onChange={(e) => handleLimitChange(product, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button disabled={isSaving} className="btn-primary" type="submit" style={{ padding: '0.75rem 2rem' }}>
              {isSaving ? <span className="spinner"></span> : 'Save Limits'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
