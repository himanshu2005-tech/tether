import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Search, FileText, Gavel, FileSignature, Package, Inbox, CornerDownLeft, Sparkles, LayoutGrid } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { PREDEFINED_PRODUCTS, inPlayArea } from '../constants/products';

const shortId = (id) => id.substring(0, 8).toUpperCase();
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const REFRESH_MS = 60 * 1000;

const GROUPS = [
  { key: 'bill', label: 'Invoices', icon: FileText },
  { key: 'tender', label: 'Tenders', icon: Gavel },
  { key: 'contract', label: 'Contracts', icon: FileSignature },
  { key: 'request', label: 'Requests', icon: Inbox },
  { key: 'product', label: 'Products', icon: Package },
  { key: 'page', label: 'Pages', icon: LayoutGrid }
];

const PAGES = {
  consumer: [
    ['Dashboard', '/'], ['Tenders', '/tenders'], ['Bids', '/bids'], ['Contracts', '/contracts'], ['Invoices', '/my-orders'],
    ['Approvals', '/approvals'], ['Suppliers', '/suppliers'], ['Supplier verification', '/suppliers?tab=verification'],
    ['Risk Center', '/risk'], ['Fraud detection', '/fraud'], ['Analytics', '/analytics'], ['Audit trail', '/audit'],
    ['Notifications', '/notifications'], ['Team & settings', '/settings'], ['Company details', '/verification'],
    ['Catalogue', '/search'], ['Spending limits', '/company-limits'], ['Profile', '/profile']
  ],
  supplier: [
    ['Dashboard', '/'], ['Tenders', '/tenders'], ['My bids', '/bids'], ['Contracts', '/contracts'], ['My invoices', '/my-invoices'],
    ['Verification', '/verification'], ['Notifications', '/notifications'], ['My catalogue', '/my-products'],
    ['Direct requests', '/requests'], ['Profile', '/profile']
  ]
};

const billStatus = (b) =>
  b.status === 'paid' ? 'Paid' : b.status === 'rejected' ? 'Rejected' : b.reviewStatus === 'pending_review' ? 'Needs review' : 'Unpaid';

// Builds a flat, searchable list of everything this user can see
async function buildIndex(uid, role, userData) {
  const items = [];
  const add = (kind, id, title, sub, to, extra = '') =>
    items.push({ kind, id, title, sub, to, haystack: `${title} ${sub} ${extra} ${id} ${shortId(id)}`.toLowerCase() });
  const safe = (p) => p.catch(() => ({ docs: [] }));

  if (role === 'supplier') {
    const [open, contracts, bills, products, requests] = await Promise.all([
      safe(getDocs(query(collection(db, 'tenders'), where('status', '==', 'open')))),
      safe(getDocs(query(collection(db, 'contracts'), where('supplierId', '==', uid)))),
      safe(getDocs(query(collection(db, 'bills'), where('supplierId', '==', uid)))),
      safe(getDocs(query(collection(db, 'products'), where('supplierId', '==', uid)))),
      safe(getDocs(query(collection(db, 'requests'), where('supplierId', '==', uid))))
    ]);
    open.docs.filter(d => inPlayArea(d.data(), userData)).forEach(d => { const t = d.data(); add('tender', d.id, t.title, `${t.productName} · ${t.quantity} ${t.unit} · ${t.buyerName}`, `/tenders/${d.id}`, t.productName); });
    contracts.docs.forEach(d => { const c = d.data(); add('contract', d.id, c.title, `${c.buyerName} · ${money(c.agreedUnitPrice)} per ${c.unit}`, '/contracts', c.productName); });
    bills.docs.forEach(d => { const b = d.data(); add('bill', d.id, `${b.productName} · ${money(b.amount)}`, `#${shortId(d.id)} · ${billStatus(b)}`, b.contractId ? '/contracts' : '/requests', b.description); });
    products.docs.forEach(d => { const p = d.data(); add('product', d.id, p.name, `${p.quantity} ${p.unit || 'units'} · ${money(p.cost)} each`, '/my-products'); });
    requests.docs.forEach(d => { const r = d.data(); add('request', d.id, `${r.productName} · ${r.quantityRequested} ${r.unit || 'units'}`, `${r.consumerName} · ${r.status}`, '/requests'); });
  } else {
    const [tenders, contracts, bills, products] = await Promise.all([
      safe(getDocs(query(collection(db, 'tenders'), where('buyerId', '==', uid)))),
      safe(getDocs(query(collection(db, 'contracts'), where('buyerId', '==', uid)))),
      safe(getDocs(query(collection(db, 'bills'), where('consumerId', '==', uid)))),
      safe(getDocs(collection(db, 'products')))
    ]);
    tenders.docs.forEach(d => { const t = d.data(); add('tender', d.id, t.title, `${t.productName} · ${t.bidCount || 0} bids · ${t.status}`, `/tenders/${d.id}`, t.productName); });
    contracts.docs.forEach(d => { const c = d.data(); add('contract', d.id, c.title, `${c.supplierName} · ${money(c.agreedUnitPrice)} per ${c.unit}`, '/contracts', c.productName); });
    bills.docs.forEach(d => {
      const b = d.data();
      const to = b.status === 'paid' ? `/payments?id=${shortId(d.id)}` : b.status === 'rejected' ? '/my-orders' : `/checkout/${d.id}`;
      add('bill', d.id, `${b.productName} · ${money(b.amount)}`, `#${shortId(d.id)} · ${billStatus(b)}`, to, b.description);
    });
    // Products buyers can order directly: one entry per product name
    const names = new Set([...PREDEFINED_PRODUCTS, ...products.docs.map(d => d.data().name).filter(Boolean)]);
    const offers = {};
    products.docs.forEach(d => { const n = d.data().name; offers[n] = (offers[n] || 0) + 1; });
    names.forEach(n => items.push({
      kind: 'product', id: `product:${n}`, title: n,
      sub: offers[n] ? `${offers[n]} supplier${offers[n] > 1 ? 's' : ''} in the catalogue` : 'No suppliers listed yet',
      to: `/search?q=${encodeURIComponent(n)}`, haystack: n.toLowerCase()
    }));
  }

  (PAGES[role] || PAGES.consumer).forEach(([title, to]) =>
    items.push({ kind: 'page', id: `page:${to}`, title, sub: 'Go to page', to, haystack: title.toLowerCase() }));
  return items;
}

function score(item, q, tokens) {
  const sid = item.kind === 'page' || item.kind === 'product' ? '' : shortId(item.id).toLowerCase();
  if (sid && sid === q.replace('#', '')) return 100;              // exact ID
  if (sid && q.length >= 3 && sid.startsWith(q.replace('#', ''))) return 90; // partial ID
  if (!tokens.every(t => item.haystack.includes(t))) return 0;
  const title = item.title.toLowerCase();
  if (title.startsWith(q)) return 70;
  if (title.includes(q)) return 55;
  return 40;
}

export default function GlobalSearch() {
  const { currentUser, userData, orgId } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const loadedAt = useRef(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const role = userData?.role;

  const load = useCallback(async () => {
    if (!currentUser || !role || loading || Date.now() - loadedAt.current < REFRESH_MS) return;
    setLoading(true);
    try {
      setIndex(await buildIndex(userData?.role === 'supplier' ? currentUser.uid : orgId, role, userData));
      loadedAt.current = Date.now();
    } catch (e) {
      console.error('Search index failed', e);
      setIndex(prev => prev || []);
    }
    setLoading(false);
  }, [currentUser, orgId, role, userData, loading]);

  // Ctrl/Cmd+K focuses the search from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!index) return [];
    if (!term) return index.filter(i => i.kind === 'page').slice(0, 6);
    const tokens = term.replace('#', '').split(/\s+/).filter(Boolean);
    return index
      .map(i => ({ ...i, s: score(i, term, tokens) }))
      .filter(i => i.s > 0)
      .sort((a, b) => b.s - a.s);
  }, [index, q]);

  // Group, at most 5 per group, keeping the order of GROUPS; then an "ask AI" row
  const grouped = useMemo(() => {
    const out = [];
    GROUPS.forEach(g => {
      const rows = results.filter(r => r.kind === g.key).slice(0, 5);
      if (rows.length) out.push({ ...g, rows });
    });
    return out;
  }, [results]);
  const flat = useMemo(() => {
    const rows = grouped.flatMap(g => g.rows);
    if (q.trim()) rows.push({ kind: 'ask', id: 'ask', title: `Ask the assistant: “${q.trim()}”` });
    return rows;
  }, [grouped, q]);

  useEffect(() => { setActive(0); }, [q]);

  const choose = (item) => {
    if (!item) return;
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    if (item.kind === 'ask') {
      window.dispatchEvent(new CustomEvent('tether:ask', { detail: q.trim() }));
      return;
    }
    navigate(item.to);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  };

  let rowIndex = -1;
  const placeholder = role === 'supplier'
    ? 'Search tenders, invoices, products or an ID'
    : 'Search invoices, tenders, products or an ID';

  return (
    <div className="gsearch" ref={boxRef}>
      <div className={`gsearch-field${open ? ' focused' : ''}`}>
        <Search size={16} />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); load(); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search"
          role="combobox"
          aria-expanded={open}
          aria-controls="gsearch-list"
        />
        <kbd className="gsearch-kbd">Ctrl K</kbd>
      </div>

      {open && (
        <div className="gsearch-panel" id="gsearch-list" role="listbox">
          {!index && loading && <div className="gsearch-empty"><span className="spinner" /> Loading…</div>}
          {index && q.trim() && grouped.length === 0 && (
            <div className="gsearch-empty">No matches for “{q.trim()}”.</div>
          )}
          {!q.trim() && index && <div className="gsearch-hint">Type an invoice ID like <b>A1B2C3D4</b>, a product, or a tender name.</div>}

          {grouped.map(g => (
            <div key={g.key} className="gsearch-group">
              <div className="gsearch-label">{g.label}</div>
              {g.rows.map(r => {
                rowIndex += 1;
                const i = rowIndex;
                return (
                  <button key={r.id} role="option" aria-selected={i === active}
                    className={`gsearch-row${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                    <g.icon size={16} className="gsearch-icon" />
                    <span className="gsearch-text">
                      <span className="gsearch-title">{r.title}</span>
                      <span className="gsearch-sub">{r.sub}</span>
                    </span>
                    {i === active && <CornerDownLeft size={14} className="gsearch-enter" />}
                  </button>
                );
              })}
            </div>
          ))}

          {q.trim() && (() => {
            const i = flat.length - 1;
            return (
              <div className="gsearch-group">
                <button role="option" aria-selected={i === active}
                  className={`gsearch-row gsearch-ask${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(flat[i])}>
                  <Sparkles size={16} className="gsearch-icon" />
                  <span className="gsearch-text"><span className="gsearch-title">{flat[i].title}</span></span>
                  {i === active && <CornerDownLeft size={14} className="gsearch-enter" />}
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
