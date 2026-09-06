import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Search, Package, FileText, CreditCard, ShoppingBag, AlertCircle, TrendingUp, Clock } from 'lucide-react';

export default function Home() {
  const { currentUser, userData } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const isSupplier = userData?.role === 'supplier';
  const isConsumer = userData?.role === 'consumer';

  useEffect(() => {
    if (!currentUser || !userData?.role) return;

    const fetchStats = async () => {
      setLoading(true);
      try {
        if (isSupplier) {
          const [productsSnap, pendingRequestsSnap, allRequestsSnap] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('supplierId', '==', currentUser.uid))),
            getDocs(query(collection(db, 'requests'), where('supplierId', '==', currentUser.uid), where('status', '==', 'pending'))),
            getDocs(query(collection(db, 'bills'), where('supplierId', '==', currentUser.uid))),
          ]);

          const totalRevenue = allRequestsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

          setStats({
            products: productsSnap.size,
            pendingRequests: pendingRequestsSnap.size,
            totalBilled: totalRevenue,
          });
        } else {
          const [pendingBillsSnap, paidBillsSnap, ordersSnap] = await Promise.all([
            getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid), where('status', '==', 'unpaid'))),
            getDocs(query(collection(db, 'bills'), where('consumerId', '==', currentUser.uid), where('status', '==', 'paid'))),
            getDocs(query(collection(db, 'requests'), where('consumerId', '==', currentUser.uid))),
          ]);

          const totalSpent = paidBillsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

          setStats({
            pendingBills: pendingBillsSnap.size,
            totalOrders: ordersSnap.size,
            totalSpent,
          });
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };

    fetchStats();
  }, [currentUser, userData]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const StatCard = ({ icon: Icon, label, value, onClick }) => (
    <div
      onClick={onClick}
      style={{
        backgroundColor: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        borderRadius: '0.875rem',
        padding: '1.5rem',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, transform 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.borderColor = 'var(--text-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.625rem', display: 'inline-flex' }}>
          <Icon size={22} color="var(--text-primary)" />
        </div>
        {onClick && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>→</span>}
      </div>
      <div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>{label}</p>
        <p style={{ fontSize: '1.75rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
          {loading ? '–' : value}
        </p>
      </div>
    </div>
  );

  const QuickAction = ({ icon: Icon, label, description, onClick }) => (
    <button
      onClick={onClick}
      style={{
        backgroundColor: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        borderRadius: '0.875rem',
        padding: '1.25rem 1.5rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        textAlign: 'left',
        width: '100%',
        color: 'var(--text-primary)',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
    >
      <div style={{ backgroundColor: 'var(--bg-color)', borderRadius: '0.5rem', padding: '0.625rem', display: 'inline-flex', flexShrink: 0 }}>
        <Icon size={20} />
      </div>
      <div>
        <p style={{ fontWeight: '600', fontSize: '0.9375rem' }}>{label}</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.125rem' }}>{description}</p>
      </div>
    </button>
  );

  return (
    <div className="page-container">

      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
          {greeting()},
        </p>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
          {userData?.companyName || currentUser?.email}
        </h1>
        <span style={{
          display: 'inline-block',
          marginTop: '0.5rem',
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
      </div>

      {/* Supplier Dashboard */}
      {isSupplier && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
            <StatCard icon={Package} label="Products Listed" value={stats.products ?? '–'} onClick={() => navigate('/my-products')} />
            <StatCard icon={Clock} label="Pending Requests" value={stats.pendingRequests ?? '–'} onClick={() => navigate('/requests')} />
            <StatCard icon={TrendingUp} label="Total Billed (₹)" value={stats.totalBilled != null ? `₹${stats.totalBilled.toFixed(0)}` : '–'} />
          </div>

          <h3 style={{ fontWeight: '600', marginBottom: '1rem', fontSize: '1rem' }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px' }}>
            <QuickAction icon={Package} label="Manage Inventory" description="Add, edit or remove your products" onClick={() => navigate('/my-products')} />
            <QuickAction icon={FileText} label="View Requests" description={stats.pendingRequests > 0 ? `${stats.pendingRequests} pending request${stats.pendingRequests > 1 ? 's' : ''} awaiting your response` : 'Check incoming orders from buyers'} onClick={() => navigate('/requests')} />
          </div>
        </>
      )}

      {/* Consumer Dashboard */}
      {isConsumer && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
            <StatCard icon={AlertCircle} label="Unpaid Bills" value={stats.pendingBills ?? '–'} onClick={() => navigate('/my-orders')} />
            <StatCard icon={ShoppingBag} label="Total Orders" value={stats.totalOrders ?? '–'} onClick={() => navigate('/my-orders')} />
            <StatCard icon={CreditCard} label="Total Spent (₹)" value={stats.totalSpent != null ? `₹${stats.totalSpent.toFixed(0)}` : '–'} />
          </div>

          <h3 style={{ fontWeight: '600', marginBottom: '1rem', fontSize: '1rem' }}>Quick Actions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '480px' }}>
            <QuickAction icon={Search} label="Search Products" description="Browse suppliers and request products" onClick={() => navigate('/search')} />
            <QuickAction icon={FileText} label="My Orders & Bills" description={stats.pendingBills > 0 ? `${stats.pendingBills} unpaid bill${stats.pendingBills > 1 ? 's' : ''} waiting for payment` : 'View all your orders and pay bills'} onClick={() => navigate('/my-orders')} />
            <QuickAction icon={CreditCard} label="Payment Tracking" description="Verify payments using a receipt ID" onClick={() => navigate('/payments')} />
          </div>
        </>
      )}
    </div>
  );
}
