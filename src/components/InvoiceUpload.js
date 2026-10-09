import React, { useState } from 'react';
import { collection, addDoc, doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { Upload, FileText, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { db } from '../firebase';
import { extractInvoice, validateFile, ACCEPT_ATTR } from '../ocr';
import { INVOICE_FIELDS, arithmeticIssues } from '../ocr/parseInvoice';
import { analyzeInvoice } from '../api';
import { PREDEFINED_PRODUCTS } from '../constants/products';
import { logAudit } from '../services/audit';
import { notify } from '../services/notify';
import { RiskBadge, FlagList, AiTag } from './Guide';

const NUMERIC = ['quantity', 'unitPrice', 'subtotal', 'tax', 'extraCharges', 'total'];
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Supplier uploads an invoice for a contract: OCR → review and correct → validate → submit
export default function InvoiceUpload({ contract, currentUser, userData, onClose, onSubmitted }) {
  const [stage, setStage] = useState('pick'); // pick → reading → review → checked
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [ocr, setOcr] = useState(null);
  const [fields, setFields] = useState({});
  const [corrected, setCorrected] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const read = async (f) => {
    const problem = validateFile(f);
    if (problem) { setError(problem); return; }
    setFile(f);
    setError('');
    setStage('reading');
    setProgress(0);
    try {
      const result = await extractInvoice(f, { knownProducts: PREDEFINED_PRODUCTS, onProgress: setProgress });
      setOcr(result);
      setFields(Object.fromEntries(INVOICE_FIELDS.map(([k]) => [k, result.fields[k] ?? ''])));
      setStage('review');
      await logAudit({
        action: 'OCR_EXTRACTED', entityType: 'contract', entityId: contract.id, entityLabel: contract.title, orgId: contract.buyerId,
        next: { file: f.name, method: result.method, confidence: result.confidence, fieldsFound: Object.values(result.found).filter(Boolean).length }
      });
    } catch (err) {
      setError(err.message);
      setStage('pick');
    }
  };

  const setField = (k, v) => {
    setFields(prev => ({ ...prev, [k]: v }));
    if (!corrected.includes(k)) setCorrected(prev => [...prev, k]);
    setAnalysis(null);
    if (stage === 'checked') setStage('review');
  };

  const clean = () => Object.fromEntries(Object.entries(fields).map(([k, v]) =>
    [k, NUMERIC.includes(k) ? (v === '' || v == null ? null : Number(v)) : (v === '' ? null : String(v).trim())]));

  const toBill = (f) => {
    const quantity = Number(f.quantity) || 0;
    const unitCost = Number(f.unitPrice) || 0;
    const subtotal = f.subtotal ?? quantity * unitCost;
    const extra = Number(f.extraCharges) || 0;
    const tax = Number(f.tax) || 0;
    return {
      contractId: contract.id,
      supplierId: contract.supplierId,
      consumerId: contract.buyerId,
      productName: contract.productName,
      quantityRequested: quantity,
      unitCost,
      unit: contract.unit,
      baseAmount: subtotal,
      extraCharges: extra,
      tax,
      amount: f.total ?? subtotal + tax + extra,
      invoiceNumber: f.invoiceNumber,
      description: `${quantity} ${contract.unit} of ${contract.productName} (invoice ${f.invoiceNumber || 'without number'})`
    };
  };

  const validate = async () => {
    const f = clean();
    if (!f.quantity || !f.unitPrice) { setError('Quantity and unit price are needed to check the invoice.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await analyzeInvoice(contract, toBill(f), f);
      setAnalysis(result);
      setStage('checked');
    } catch (err) {
      setError('Could not run the checks: ' + err.message);
    }
    setBusy(false);
  };

  const submit = async () => {
    const f = clean();
    setBusy(true);
    try {
      const bill = toBill(f);
      const ref = await addDoc(collection(db, 'bills'), {
        ...bill,
        status: 'unpaid',
        source: 'upload',
        // Supplier-side check, shown to the supplier; the buyer re-validates on arrival
        analysis: analysis ? { ...analysis, analyzedAt: new Date().toISOString() } : null,
        reviewStatus: 'awaiting_validation',
        ocr: {
          fileName: file?.name || null, method: ocr?.method || null,
          confidence: ocr?.confidence ?? null, ocrConfidence: ocr?.ocrConfidence ?? null,
          fields: f, corrected, aiAssisted: !!ocr?.aiAssisted
        },
        submittedBy: currentUser.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'contracts', contract.id), {
        quantityInvoiced: increment(bill.quantityRequested),
        amountInvoiced: increment(bill.amount)
      });
      await logAudit({
        action: 'INVOICE_UPLOADED', entityType: 'invoice', entityId: ref.id, entityLabel: `#${f.invoiceNumber || ref.id.slice(0, 8).toUpperCase()}`,
        orgId: contract.buyerId,
        next: { amount: bill.amount, quantity: bill.quantityRequested, unitPrice: bill.unitCost, ocrConfidence: ocr?.confidence ?? null, correctedFields: corrected },
        meta: { contractId: contract.id, supplier: userData?.companyName }
      });
      await notify({ orgId: contract.buyerId, roles: ['procurement_officer', 'procurement_manager', 'admin'] }, {
        kind: 'invoice_uploaded', severity: 'info', title: 'Invoice uploaded',
        message: `${userData?.companyName || 'A supplier'} uploaded invoice ${f.invoiceNumber || ''} for ${money(bill.amount)} on "${contract.title}".`,
        entityType: 'invoice', entityId: ref.id, link: '/approvals'
      });
      onSubmitted?.(analysis);
    } catch (err) {
      setError('Could not submit: ' + err.message);
    }
    setBusy(false);
  };

  const issues = stage === 'review' || stage === 'checked' ? arithmeticIssues(clean()) : [];

  return (
    <div className="upload-panel">
      <div className="row-between">
        <strong>Upload invoice</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      {error && <div className="error-message" style={{ marginTop: '0.75rem' }}>{error}</div>}

      {stage === 'pick' && (
        <label className="dropzone"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); }}>
          <Upload size={22} />
          <span><b>Choose a file</b> or drop it here</span>
          <span className="muted">PDF, JPG or PNG, up to 10 MB</span>
          <input type="file" accept={ACCEPT_ATTR} onChange={e => e.target.files[0] && read(e.target.files[0])} hidden />
        </label>
      )}

      {stage === 'reading' && (
        <div className="empty-state" style={{ marginTop: '0.75rem' }}>
          <span className="spinner" />
          <span>Reading {file?.name}{progress ? ` · ${progress}%` : ''}…</span>
          <span className="muted">The OCR engine downloads the first time you use it.</span>
        </div>
      )}

      {(stage === 'review' || stage === 'checked') && ocr && (
        <>
          <div className="ocr-summary">
            <FileText size={18} />
            <div>
              <div><b>{file?.name}</b> · {ocr.method}</div>
              <div className="muted">Check every field against the document and correct anything wrong before validating.</div>
            </div>
            <div className="ocr-confidence">
              <span className="ocr-confidence-value">{ocr.confidence}%</span>
              <span className="muted">OCR confidence</span>
            </div>
          </div>

          <div className="ocr-grid">
            {INVOICE_FIELDS.map(([k, label]) => {
              const state = corrected.includes(k) ? 'corrected' : ocr.found[k] === 'ai' ? 'ai' : ocr.found[k] ? 'found' : 'missing';
              return (
                <div key={k} className={`form-group ocr-field ${state}`}>
                  <label className="form-label">
                    {state === 'missing' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                    {label}
                    {state === 'ai' && <AiTag>AI</AiTag>}
                    {state === 'corrected' && <span className="ocr-tag">edited</span>}
                  </label>
                  <input className="form-input" value={fields[k] ?? ''} type={NUMERIC.includes(k) ? 'number' : k === 'invoiceDate' ? 'date' : 'text'}
                    step="0.01" onChange={e => setField(k, e.target.value)} placeholder={state === 'missing' ? 'Not found, please enter' : ''} />
                </div>
              );
            })}
          </div>

          {issues.length > 0 && (
            <div className="notice" style={{ marginTop: '1rem' }}>{issues.join(' ')} Check the numbers against the document.</div>
          )}

          {stage === 'checked' && analysis && (
            <div className={`ai-panel ai-panel-${analysis.level}`} style={{ marginTop: '1rem' }}>
              <div className="row-between"><strong>Checked against the contract</strong><RiskBadge analysis={analysis} /></div>
              <p style={{ marginTop: '0.5rem' }}>{analysis.summary}</p>
              <FlagList flags={analysis.flags} />
            </div>
          )}

          <div className="form-actions">
            <button className="btn-secondary" onClick={() => { setStage('pick'); setOcr(null); setAnalysis(null); setCorrected([]); }}>Use another file</button>
            {stage === 'review' && <button className="btn-primary" onClick={validate} disabled={busy}>{busy ? 'Checking…' : 'Validate invoice'}</button>}
            {stage === 'checked' && <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit to buyer'}</button>}
          </div>
        </>
      )}
    </div>
  );
}
