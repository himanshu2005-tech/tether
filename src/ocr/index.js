// Invoice OCR. Providers are small adapters that turn a file into { text, confidence };
// swap or add one in PROVIDERS without touching the rest of the app.
//
//  - PDFs with a text layer: text is read directly with pdf.js (fast, ~100% confidence)
//  - scanned PDFs and images (JPG/PNG): rendered and read with Tesseract OCR
//
// Both libraries are loaded from a CDN only when someone uploads an invoice, so they add
// nothing to the normal page load and no npm dependencies.

import { parseInvoiceText, overallConfidence } from './parseInvoice';
import { structureInvoice } from '../ai/llm';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const MAX_BYTES = 10 * 1024 * 1024;

let tesseractPromise;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.async = true;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseractPromise = null; reject(new Error('Could not load the OCR engine. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return tesseractPromise;
}

let pdfjsPromise;
async function loadPdfjs() {
  pdfjsPromise ||= import(/* webpackIgnore: true */ PDFJS_URL).then(mod => {
    mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return mod;
  }).catch(err => { pdfjsPromise = null; throw new Error('Could not load the PDF reader. ' + err.message); });
  return pdfjsPromise;
}

async function ocrImage(source, onProgress) {
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(source, 'eng', {
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100)); }
  });
  return { text: data.text || '', confidence: Math.round(data.confidence || 0) };
}

// ─── Providers ────────────────────────────────────────────────────────────────

const PROVIDERS = {
  async pdf(file, onProgress) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = Math.min(doc.numPages, 3);
    let text = '';
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Group text items into lines by their vertical position
      const rows = {};
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        (rows[y] ||= []).push(it);
      });
      text += Object.keys(rows).sort((a, b) => b - a)
        .map(y => rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str).join(' '))
        .join('\n') + '\n';
    }
    if (text.replace(/\s/g, '').length > 40) {
      return { text, confidence: 99, method: 'PDF text layer' };
    }
    // Scanned PDF: render the first page and OCR it
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const res = await ocrImage(canvas, onProgress);
    return { ...res, method: 'OCR of scanned PDF' };
  },

  async image(file, onProgress) {
    const res = await ocrImage(file, onProgress);
    return { ...res, method: 'OCR (Tesseract)' };
  }
};

export function validateFile(file) {
  if (!file) return 'Choose a file.';
  const ext = file.name.split('.').pop().toLowerCase();
  if (!ACCEPTED_TYPES.includes(file.type) && !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) return 'Only PDF, JPG, JPEG or PNG files are supported.';
  if (file.size > MAX_BYTES) return 'File is larger than 10 MB.';
  return null;
}

/**
 * Reads an invoice file and returns extracted fields.
 * { fields, found, confidence, ocrConfidence, method, text, aiAssisted }
 */
export async function extractInvoice(file, { knownProducts = [], onProgress } = {}) {
  const error = validateFile(file);
  if (error) throw new Error(error);
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const raw = await (isPdf ? PROVIDERS.pdf : PROVIDERS.image)(file, onProgress);

  const parsed = parseInvoiceText(raw.text, knownProducts);
  let fields = parsed.fields;
  let found = parsed.found;
  let aiAssisted = false;

  // The language model fills in fields the rules missed. Rule-based values win when both exist,
  // and anything the AI adds is marked so the user checks it.
  const missing = Object.keys(found).filter(k => !found[k]);
  if (missing.length && raw.text.trim()) {
    const ai = await structureInvoice(raw.text, knownProducts).catch(() => null);
    if (ai) {
      missing.forEach(k => {
        if (ai[k] != null && ai[k] !== '') { fields = { ...fields, [k]: ai[k] }; found = { ...found, [k]: 'ai' }; aiAssisted = true; }
      });
    }
  }

  const coverage = Object.values(found).filter(Boolean).length / Object.keys(found).length;
  return {
    fields, found, text: raw.text, method: raw.method, aiAssisted,
    ocrConfidence: raw.confidence,
    confidence: overallConfidence({ ocrConfidence: raw.confidence, coverage, fields })
  };
}
