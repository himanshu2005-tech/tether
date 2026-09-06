import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Moon, Sun } from 'lucide-react';

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
          style={{ position: 'absolute', top: '1.5rem', left: '2rem' }}
        >
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <Outlet />
      </div>
      <div className="auth-right">
        <div className="auth-hero">
          <h1 className="auth-hero-title">Tether</h1>
          <p className="auth-hero-subtitle">Warehouse Accounts Management</p>
        </div>
      </div>
    </div>
  );
}
