import React, { useState, useEffect } from 'react';
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  Home, Gavel, FileSignature, FileText, ShieldAlert, Package, Inbox, Store, SlidersHorizontal,
  User, LogOut, Moon, Sun, Menu, X, HandCoins, Users, BadgeCheck, ClipboardCheck, AlertOctagon,
  BarChart3, ScrollText, Bell, Settings as SettingsIcon
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import ChatAssistant from './ChatAssistant';
import GlobalSearch from './GlobalSearch';
import { NotificationBell, useNotifications } from './Notifications';
import { useInvoiceIntake } from '../services/useInvoiceIntake';
import { can, ROLE_LABELS } from '../security/roles';

export default function Layout() {
  const { isDarkMode, toggleTheme } = useTheme();
  const { currentUser, userData, logout, orgId, role: permRole, profileError, retryProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const role = userData?.role;
  const { items: notifications } = useNotifications();
  const unread = (notifications || []).filter(n => !n.read).length;

  // Any signed-in buyer team member validates newly arrived invoices in the background
  useInvoiceIntake(orgId, role !== 'supplier' && can.reviewRisk(permRole));

  // Close the mobile menu whenever the page changes
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Live badge counts: flagged invoices (buyer) and new direct requests (supplier)
  useEffect(() => {
    if (!currentUser || !role) return;
    const q = role === 'consumer'
      ? query(collection(db, 'bills'), where('consumerId', '==', orgId))
      : query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid), where('status', '==', 'pending'));
    return onSnapshot(q, (snap) => {
      if (role === 'consumer') {
        setReviewCount(snap.docs.filter(d => d.data().reviewStatus === 'pending_review').length);
        setApprovalCount(snap.docs.filter(d => d.data().approval?.status === 'pending' && can.approveStep(permRole, d.data().approval.nextRole)).length);
      } else setRequestCount(snap.size);
    }, () => {});
  }, [currentUser, role, orgId, permRole]);

  // Navigation by role: suppliers see their own work; buyer team members see sections their role allows
  const sections = role === 'supplier'
    ? [
        { items: [
          { to: '/', label: 'Dashboard', icon: Home, end: true },
          { to: '/tenders', label: 'Tenders', icon: Gavel },
          { to: '/bids', label: 'My bids', icon: HandCoins },
          { to: '/contracts', label: 'Contracts', icon: FileSignature },
          { to: '/my-invoices', label: 'Invoices', icon: FileText },
          { to: '/verification', label: 'Verification', icon: BadgeCheck }
        ] },
        { title: 'Direct sales', items: [
          { to: '/my-products', label: 'My catalogue', icon: Package },
          { to: '/requests', label: 'Direct requests', icon: Inbox, count: requestCount }
        ] }
      ]
    : [
        { items: [
          { to: '/', label: 'Dashboard', icon: Home, end: true },
          { to: '/tenders', label: 'Tenders', icon: Gavel },
          { to: '/bids', label: 'Bids', icon: HandCoins },
          { to: '/contracts', label: 'Contracts', icon: FileSignature },
          { to: '/my-orders', label: 'Invoices', icon: FileText },
          { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, count: approvalCount }
        ] },
        { title: 'Suppliers & risk', items: [
          { to: '/suppliers', label: 'Suppliers', icon: Users, end: true },
          { to: '/suppliers?tab=verification', label: 'Supplier verification', icon: BadgeCheck, match: 'tab=verification' },
          { to: '/risk', label: 'Risk Center', icon: ShieldAlert, count: reviewCount },
          { to: '/fraud', label: 'Fraud detection', icon: AlertOctagon }
        ] },
        { title: 'Insights', items: [
          { to: '/analytics', label: 'Analytics', icon: BarChart3 },
          can.viewAudit(permRole) && { to: '/audit', label: 'Audit trail', icon: ScrollText },
          { to: '/notifications', label: 'Notifications', icon: Bell, count: unread }
        ].filter(Boolean) },
        { title: 'Direct buying', items: [
          { to: '/search', label: 'Catalogue', icon: Store },
          { to: '/company-limits', label: 'Spending limits', icon: SlidersHorizontal },
          can.manageTeam(permRole) && { to: '/settings', label: 'Team & settings', icon: SettingsIcon }
        ].filter(Boolean) }
      ];

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Failed to log out', err);
    }
  };

  const name = userData?.companyName || currentUser?.email || '';
  const initials = name.substring(0, 2).toUpperCase() || 'US';

  // Links that differ only by query string (Suppliers vs. verification tab) need an exact match
  const isOn = (item, isActive) => (item.match ? location.search.includes(item.match)
    : isActive && !(item.to === '/suppliers' && location.search.includes('tab=verification')));
  const NavItem = ({ item }) => (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `side-link${isOn(item, isActive) ? ' active' : ''}`}>
      <item.icon size={17} />
      <span>{item.label}</span>
      {item.count > 0 && <span className="side-count">{item.count}</span>}
    </NavLink>
  );

  // Never show the app without knowing the user's role
  if (currentUser && !userData) {
    return (
      <div className="account-gate">
        {profileError ? (
          <>
            <p>{profileError}</p>
            <div className="form-actions" style={{ justifyContent: 'center' }}>
              <button className="btn-secondary" onClick={handleLogout}>Sign out</button>
              <button className="btn-primary" onClick={retryProfile}>Try again</button>
            </div>
          </>
        ) : (<><span className="spinner" /> Loading your account…</>)}
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="side-top">
          <Link to="/" className="brand">Tether</Link>
          <button className="icon-btn side-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <nav className="side-nav">
          {sections.map((sec, i) => (
            <React.Fragment key={i}>
              {sec.title && <div className="side-section">{sec.title}</div>}
              {sec.items.map(item => <NavItem key={item.to} item={item} />)}
            </React.Fragment>
          ))}
        </nav>

        <div className="side-bottom">
          <NavLink to="/profile" className={({ isActive }) => `side-account${isActive ? ' active' : ''}`}>
            <span className="avatar">{initials}</span>
            <span className="side-account-text">
              <span className="side-account-name">{name}</span>
              <span className="side-account-role">{ROLE_LABELS[permRole] || 'Buyer'}</span>
            </span>
            <User size={15} />
          </NavLink>
          <div className="side-actions">
            <button className="side-action" onClick={toggleTheme}>
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
              {isDarkMode ? 'Light mode' : 'Dark mode'}
            </button>
            <button className="side-action danger" onClick={handleLogout}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <GlobalSearch />
          <NotificationBell />
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      <ChatAssistant />
    </div>
  );
}
