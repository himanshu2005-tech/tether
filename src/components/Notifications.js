import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Bell } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { markRead, markAllRead } from '../services/notify';
import { PageHeader, LoadState } from './Guide';

const ago = (ms) => {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const msOf = (n) => (n.createdAt?.toMillis ? n.createdAt.toMillis() : Date.now());

// Live list of the signed-in user's notifications, newest first
export function useNotifications() {
  const { currentUser } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!currentUser) return undefined;
    return onSnapshot(query(collection(db, 'notifications'), where('userId', '==', currentUser.uid)), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => msOf(b) - msOf(a)));
    }, err => setError(err.message));
  }, [currentUser]);
  return { items, error };
}

function Item({ n, onOpen }) {
  return (
    <button className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => onOpen(n)}>
      <span className={`notif-dot sev-${n.severity}`} aria-label={`${n.severity} severity`} />
      <span className="notif-text">
        <span className="notif-title">{n.title}</span>
        <span className="notif-message">{n.message}</span>
        <span className="notif-time">{ago(msOf(n))}</span>
      </span>
    </button>
  );
}

export function NotificationBell() {
  const { items } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const unread = (items || []).filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const openItem = (n) => {
    if (!n.read) markRead(n.id).catch(() => {});
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="bell" ref={ref}>
      <button className="icon-btn bell-btn" onClick={() => setOpen(o => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} title="Notifications">
        <Bell size={18} />
        {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="row-between bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="link-button" style={{ marginLeft: 0 }} onClick={() => markAllRead(items)}>Mark all read</button>}
          </div>
          {!items?.length ? <div className="empty-state compact">You're all caught up.</div> : items.slice(0, 8).map(n => <Item key={n.id} n={n} onOpen={openItem} />)}
          <Link to="/notifications" className="bell-all" onClick={() => setOpen(false)}>See all notifications</Link>
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const { items, error } = useNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const shown = (items || []).filter(n => filter === 'all' || (filter === 'unread' ? !n.read : n.severity === filter));

  const openItem = (n) => {
    if (!n.read) markRead(n.id).catch(() => {});
    if (n.link) navigate(n.link);
  };

  return (
    <div className="page-container narrow">
      <PageHeader title="Notifications" subtitle="Alerts about tenders, bids, invoices, approvals and risk that concern you."
        action={items?.some(n => !n.read) && <button className="btn-secondary" onClick={() => markAllRead(items)}>Mark all read</button>} />
      <div className="tabs">
        {[['all', 'All'], ['unread', 'Unread'], ['high', 'High'], ['medium', 'Medium'], ['info', 'Info']].map(([k, label]) => (
          <button key={k} className={filter === k ? 'tab active' : 'tab'} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {items === null ? <LoadState loading={!error} error={error} /> : shown.length === 0 ? (
        <div className="empty-state">Nothing here.</div>
      ) : (
        <div className="list notif-list">{shown.map(n => <Item key={n.id} n={n} onOpen={openItem} />)}</div>
      )}
    </div>
  );
}
