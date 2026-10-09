// Watches a buyer organisation's incoming invoices and validates each new one once (see
// services/approvals.js). Runs in the background for any signed-in buyer team member.
import { useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getSettings } from './org';
import { intakeInvoice } from './approvals';

export function useInvoiceIntake(orgId, enabled) {
  useEffect(() => {
    if (!orgId || !enabled) return undefined;
    let settings = null;
    let stopped = false;
    const started = new Set();

    const unsub = onSnapshot(query(collection(db, 'bills'), where('consumerId', '==', orgId)), async (snap) => {
      const waiting = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => !b.approval && b.status === 'unpaid' && !started.has(b.id));
      if (!waiting.length) return;
      settings ||= await getSettings(orgId);
      for (const bill of waiting) {
        if (stopped) return;
        started.add(bill.id);
        try {
          await intakeInvoice(bill, { orgId, settings });
        } catch (err) {
          console.warn('Invoice intake failed for', bill.id, err.message);
          started.delete(bill.id);
        }
      }
    }, (err) => console.warn('Invoice intake listener:', err.message));

    return () => { stopped = true; unsub(); };
  }, [orgId, enabled]);
}
