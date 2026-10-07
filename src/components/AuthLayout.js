import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Moon, Sun, Gavel, FileCheck2, ShieldCheck } from 'lucide-react';

export default function AuthLayout() {
  const { isDarkMode, toggleTheme } = useTheme();
  const { currentUser } = useAuth();

  // Redirect to dashboard if user is already authenticated
  if (currentUser) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-layout-container">
      <div className="auth-left">
        <button 
          className="theme-toggle" 
          onClick={toggleTheme} 
          aria-label="Toggle theme"
          style={{ position: 'absolute', top: '1.25rem', left: '1.25rem' }}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <Outlet />
      </div>
      <div className="auth-right">
        <div className="auth-hero">
          <p className="auth-hero-eyebrow">Tether</p>
          <h1 className="auth-hero-title">Procurement,<br />without the leakage.</h1>
          <p className="auth-hero-subtitle">
            Post a requirement, let suppliers compete for it, and have every invoice checked against the contract before a rupee leaves your account.
          </p>
          <ul className="auth-hero-points">
            <li>
              <Gavel size={20} />
              <span><strong>Competitive tenders</strong>Suppliers bid, and bids that look coordinated are flagged.</span>
            </li>
            <li>
              <FileCheck2 size={20} />
              <span><strong>Contract-aware invoices</strong>Price, quantity and extra charges are checked against what was agreed.</span>
            </li>
            <li>
              <ShieldCheck size={20} />
              <span><strong>Pay with confidence</strong>Duplicates and overcharges are held until you approve them.</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
