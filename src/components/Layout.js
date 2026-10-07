import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
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
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  // Buyers: count invoices the AI flagged that still need a decision
  useEffect(() => {
    if (!currentUser || userData?.role !== 'consumer') return;
    const q = query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid));
    return onSnapshot(q, (snapshot) => {
      setPendingReviewCount(snapshot.docs.filter(d => d.data().reviewStatus === 'pending_review').length);
    });
  }, [currentUser, userData]);

  const navItems = userData?.role === 'consumer'
    ? [
        { to: '/tenders', label: 'Tenders' },
        { to: '/contracts', label: 'Contracts' },
        { to: '/my-orders', label: 'Invoices' },
        { to: '/risk', label: 'Risk Center', count: pendingReviewCount }
      ]
    : userData?.role === 'supplier'
    ? [
        { to: '/tenders', label: 'Tenders' },
        { to: '/contracts', label: 'Contracts' }
      ]
    : [];

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
        {currentUser && navItems.length > 0 && (
          <div className="nav-links">
            {navItems.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                {item.label}
                {item.count > 0 && <span className="nav-count">{item.count}</span>}
              </NavLink>
            ))}
          </div>
        )}
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
              
              <button 
                className="avatar-btn" title="Your account: profile and sign out" 
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
