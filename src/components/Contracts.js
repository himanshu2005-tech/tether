import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { analyzeInvoice } from '../api';
import { PageHeader, RiskBadge, FlagList, AiTag } from './Guide';
import { db } from '../firebase';
import { Upload } from 'lucide-react';
import InvoiceUpload from './InvoiceUpload';
import { logAudit } from '../services/audit';
import { notify } from '../services/notify';
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';

export default function Contracts() {
  const { currentUser, userData, orgId } = useAuth();
  const isSupplier = userData?.role === 'supplier';
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoiceForm, setInvoiceForm] = useState({});
  const [submitting, setSubmitting] = useState({});
  const [lastResult, setLastResult] = useState({});
  const [uploadFor, setUploadFor] = useState(null);

  useEffect(() => {
    if (!currentUser) return;
    const field = isSupplier ? 'supplierId' : 'buyerId';
    const q = query(collection(db, 'contracts'), where(field, '==', isSupplier ? currentUser.uid : orgId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setContracts(list);
      setLoading(false);
    });
    return unsubscribe;
  }, [currentUser, isSupplier, orgId]);

  const updateField = (contractId, field, value) => {
    setInvoiceForm(prev => ({ ...prev, [contractId]: { ...prev[contractId], [field]: value } }));
  };

  const handleRaiseInvoice = async (c) => {
    const form = invoiceForm[c.id] || {};
    const quantity = parseInt(form.quantity, 10);
    const unitCost = parseFloat(form.unitCost ?? c.agreedUnitPrice);
    const extra = parseFloat(form.extra || 0);
    if (isNaN(quantity) || quantity <= 0 || isNaN(unitCost)) {
      alert('Enter a valid quantity and unit price.');
      return;
    }

    setSubmitting(prev => ({ ...prev, [c.id]: true }));
    const baseAmount = unitCost * quantity;
    const extraCharges = isNaN(extra) ? 0 : extra;
    let description = `${quantity} ${c.unit} of ${c.productName} (contract: ${c.title})`;
    if (extraCharges > 0) description += ` + ₹${extraCharges.toFixed(2)} additional charges`;

    const invoice = {
      contractId: c.id,
      supplierId: c.supplierId,
      consumerId: c.buyerId,
      productName: c.productName,
      quantityRequested: quantity,
      unitCost: unitCost,
      extraCharges: extraCharges,
      amount: baseAmount + extraCharges,
      description: description
    };

    try {
      // Every invoice is checked by the AI service before it reaches the buyer.
      // If the service is unreachable the invoice is still sent, marked as unchecked.
      let analysis = null;
      try {
        analysis = await analyzeInvoice(c, invoice);
        analysis.analyzedAt = new Date().toISOString();
      } catch (err) {
        console.warn('Invoice analysis unavailable:', err.message);
      }

      // Same shape as existing bills so Payments/Checkout keep working,
      // plus contractId so invoices can be validated against agreed terms
      const ref = await addDoc(collection(db, 'bills'), {
        contractId: c.id,
        supplierId: c.supplierId,
        consumerId: c.buyerId,
        productName: c.productName,
        quantityRequested: quantity,
        unitCost: unitCost,
        unit: c.unit,
        baseAmount: baseAmount,
        extraCharges: extraCharges,
        amount: baseAmount + extraCharges,
        description: description,
        status: 'unpaid',
        analysis: analysis,
        // The buyer re-validates every invoice on arrival; this is the supplier's own pre-check
        reviewStatus: 'awaiting_validation',
        source: 'manual',
        submittedBy: currentUser.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'contracts', c.id), {
        quantityInvoiced: increment(quantity),
        amountInvoiced: increment(baseAmount + extraCharges)
      });
      await logAudit({
        action: 'INVOICE_UPLOADED', entityType: 'invoice', entityId: ref.id, entityLabel: `#${ref.id.slice(0, 8).toUpperCase()}`, orgId: c.buyerId,
        next: { amount: baseAmount + extraCharges, quantity, unitPrice: unitCost, source: 'manual entry' }, meta: { contractId: c.id }
      });
      await notify({ orgId: c.buyerId, roles: ['procurement_officer', 'procurement_manager', 'admin'] }, {
        kind: 'invoice_uploaded', severity: 'info', title: 'Invoice received',
        message: `${userData?.companyName || 'A supplier'} invoiced ₹${(baseAmount + extraCharges).toLocaleString('en-IN')} on "${c.title}".`,
        entityType: 'invoice', entityId: ref.id, link: '/approvals'
      });
      setInvoiceForm(prev => ({ ...prev, [c.id]: {} }));
      setLastResult(prev => ({ ...prev, [c.id]: analysis || { unchecked: true } }));
    } catch (err) {
      alert('Failed to raise invoice: ' + err.message);
    }
    setSubmitting(prev => ({ ...prev, [c.id]: false }));
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
      <PageHeader
        title="Contracts"

        subtitle={isSupplier
          ? 'Contracts you have won. Every invoice you raise is checked by AI against the agreed terms.'
          : 'Agreed prices and quantities. AI checks each supplier invoice against them before you pay.'}
      />

      {contracts.length === 0 ? (
        <div className="empty-state">
          {isSupplier ? 'You have not been awarded any contracts yet.' : 'Award a tender to create a contract.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {contracts.map(c => {
            const remaining = c.maxQuantity - (c.quantityInvoiced || 0);
            const form = invoiceForm[c.id] || {};
            return (
              <div key={c.id} className="bid-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{c.title}</strong>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {isSupplier ? `Buyer: ${c.buyerName}` : `Supplier: ${c.supplierName}`}
                    </div>
                  </div>
                  <span className={`status-pill status-${c.status}`}>{c.status}</span>
                </div>

                <div className="product-details" style={{ marginTop: '0.75rem' }}>
                  <div className="product-stat"><span className="stat-label">Product</span><span className="stat-value">{c.productName}</span></div>
                  <div className="product-stat"><span className="stat-label">Agreed price</span><span className="stat-value">₹{Number(c.agreedUnitPrice).toFixed(2)} / {c.unit}</span></div>
                  <div className="product-stat"><span className="stat-label">Invoiced</span><span className="stat-value">{c.quantityInvoiced || 0} / {c.maxQuantity} {c.unit}</span></div>
                  <div className="product-stat"><span className="stat-label">Billed so far</span><span className="stat-value">₹{Number(c.amountInvoiced || 0).toFixed(2)}</span></div>
                </div>

                {c.extractedTerms?.summary && (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <AiTag>Terms</AiTag> {c.extractedTerms.summary}
                    {c.extractedTerms.extraChargesAllowed === false && ' Extra charges are not allowed.'}
                  </p>
                )}

                {lastResult[c.id] && (
                  <div className="ai-panel" style={{ marginTop: '1rem' }}>
                    {lastResult[c.id].unchecked ? (
                      <p>Invoice sent. Your pre-check could not run, but the buyer's system validates every invoice when it arrives.</p>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong>Invoice sent · <AiTag>Checked</AiTag></strong>
                          <RiskBadge analysis={lastResult[c.id]} />
                        </div>
                        <p style={{ marginTop: '0.5rem' }}>{lastResult[c.id].summary}</p>
                        <FlagList flags={lastResult[c.id].flags} />
                      </>
                    )}
                  </div>
                )}

                {isSupplier && c.status === 'active' && uploadFor === c.id && (
                  <InvoiceUpload contract={c} currentUser={currentUser} userData={userData}
                    onClose={() => setUploadFor(null)}
                    onSubmitted={(analysis) => { setUploadFor(null); setLastResult(prev => ({ ...prev, [c.id]: analysis || { unchecked: true } })); }} />
                )}

                {isSupplier && c.status === 'active' && uploadFor !== c.id && (
                  <button className="btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setUploadFor(c.id)}>
                    <Upload size={15} /> Upload invoice (PDF or image)
                  </button>
                )}

                {isSupplier && c.status === 'active' && uploadFor !== c.id && (
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                      <label className="form-label">Quantity</label>
                      <input type="number" className="form-input" min="1" placeholder={`≤ ${remaining}`}
                        value={form.quantity || ''} onChange={e => updateField(c.id, 'quantity', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                      <label className="form-label">Unit price (₹)</label>
                      <input type="number" className="form-input" step="0.01"
                        value={form.unitCost ?? c.agreedUnitPrice} onChange={e => updateField(c.id, 'unitCost', e.target.value)} />
                    </div>
                    <div className="form-group" style={{ flex: 1, minWidth: '120px' }}>
                      <label className="form-label">Extra charges (₹)</label>
                      <input type="number" className="form-input" step="0.01" placeholder="0"
                        value={form.extra || ''} onChange={e => updateField(c.id, 'extra', e.target.value)} />
                    </div>
                    <button className="btn-primary" disabled={submitting[c.id]} onClick={() => handleRaiseInvoice(c)} style={{ marginTop: 0 }}>
                      {submitting[c.id] ? 'Checking…' : 'Or enter manually'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
