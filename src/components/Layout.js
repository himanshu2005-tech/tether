import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Moon, Sun } from 'lucide-react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import ChatAssistant from './ChatAssistant';

export default function Layout() {
  const { isDarkMode, toggleTheme } = useTheme();
  const { currentUser, userData, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Listen for pending requests for suppliers
  useEffect(() => {
    let unsubscribe;
    if (userData && userData.role === 'supplier' && currentUser) {
      const q = query(
        collection(db, 'requests'), 
        where('supplierId', '==', currentUser.uid),
        where('status', '==', 'pending')
      );
      unsubscribe = onSnapshot(q, (snapshot) => {
        setPendingRequestsCount(snapshot.size);
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userData, currentUser]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error("Failed to log out", err);
    }
  };

  const getInitials = () => {
    if (userData && userData.companyName) {
      return userData.companyName.substring(0, 2).toUpperCase();
    }
    if (currentUser && currentUser.email) {
      return currentUser.email.substring(0, 2).toUpperCase();
    }
    return "US";
  };

  return (
    <div className="app-container">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">
          Tether
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          
          <button 
            className="theme-toggle" 
            onClick={toggleTheme} 
            aria-label="Toggle theme"
            title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {currentUser && (
            <div className="profile-section" ref={dropdownRef}>
              {userData && userData.role && (
                <span style={{ 
                  fontSize: '0.875rem', 
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  {userData.role}
                </span>
              )}
              
              <button 
                className="avatar-btn" 
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {getInitials()}
              </button>

              {dropdownOpen && (
                <div className="dropdown-menu">
                  <button 
                    className="dropdown-item" 
                    onClick={() => { setDropdownOpen(false); navigate('/profile'); }}
                  >
                    Profile
                  </button>
                  
                  {userData && userData.role === 'supplier' && (
                    <>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/my-products'); }}
                      >
                        My Products
                      </button>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/requests'); }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <span>Requests</span>
                        {pendingRequestsCount > 0 && (
                          <span style={{ 
                            backgroundColor: 'var(--primary-color)', 
                            color: 'var(--primary-text)', 
                            borderRadius: '50%', 
                            width: '1.25rem', 
                            height: '1.25rem', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }}>
                            {pendingRequestsCount}
                          </span>
                        )}
                      </button>
                    </>
                  )}

                  {userData && userData.role === 'consumer' && (
                    <>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/search'); }}
                        style={{ fontWeight: '600' }}
                      >
                        Search Products
                      </button>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/company-limits'); }}
                      >
                        Company Limits
                      </button>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/my-orders'); }}
                      >
                        My Orders
                      </button>
                      <button 
                        className="dropdown-item" 
                        onClick={() => { setDropdownOpen(false); navigate('/payments'); }}
                      >
                        Payments
                      </button>
                    </>
                  )}

                  <button 
                    className="dropdown-item" 
                    onClick={handleLogout}
                    style={{ color: 'var(--error-color)' }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </nav>
      
      <main className="main-content">
        <Outlet />
      </main>

      <ChatAssistant />
    </div>
  );
}
