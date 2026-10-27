// Extraction layer: file (PDF or image) -> raw text + embedded links -> best-effort structured fields.
// This is the input to the verification engine, not the trust decision itself.
//
// Three sources of signal, merged:
//   1. Text — PDF text layer (pdfjs) or OCR (tesseract.js) for images.
//   2. Links — PDF hyperlink annotations (many cert PDFs embed a clickable "Verify" link even when
//      the URL isn't printed as visible text) + any http(s) URL found in the text itself.
//   3. QR codes — decoded from image uploads (jimp + jsqr). Most issuer certificates (Coursera,
//      Credly, edX, HackerRank, NPTEL, etc.) print a QR code linking straight to a verification page,
//      often the ONLY place the verify URL lives on the document.
//
// PDFs ARE now rendered to a bitmap for QR decoding, using pdf-to-png-converter (backed by
// @napi-rs/canvas, which ships pre-built native binaries - no compiler/node-gyp needed, unlike
// plain node-canvas which this machine couldn't build - see memory.md section 3 for that history).
// This matters more than it might look: a real Infosys Springboard certificate (tested 2026-09-27)
// prints the SAME generic base URL ("https://verify.onwingspan.com") on every certificate,
// regardless of student or course - the actual per-certificate payload (a full signed W3C
// Verifiable Credential, not just an ID) lives ONLY inside the QR image. Without decoding the QR,
// every Wingspan-style certificate would extract a useless, non-specific "link" that can never
// verify anything.
//
// IMPORTANT (bug found + fixed 2026-09-27): the PDF QR-render step MUST run in an isolated
// worker_thread (see qrPdfWorker.js), not inline in this file. `pdf-to-png-converter` bundles its
// own private copy of pdfjs-dist (6.2.108) while this file uses the top-level pdfjs-dist (4.10.38)
// for text/annotations — loading both in the SAME thread throws "API version does not match Worker
// version", every time, in either load order (confirmed by direct testing). Before this fix, the QR
// render step silently failed and was swallowed by the surrounding try/catch, so verifiableCredential
// was NEVER actually populated even though the QR itself decoded perfectly in isolated testing.
// Don't move this back inline without re-solving that version conflict some other way first.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const Jimp = require('jimp').Jimp ? require('jimp').Jimp : require('jimp');
const jsQR = require('jsqr');
const { createWorker } = require('tesseract.js');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const QR_PDF_WORKER_PATH = path.join(__dirname, 'qrPdfWorker.js');

function isImageFile(filepath) {
  return IMAGE_EXTENSIONS.has(path.extname(filepath).toLowerCase());
}

// Render (up to) the first few pages of a PDF to bitmaps and scan each for a QR code, entirely in
// a separate worker thread so its private pdfjs-dist copy never coexists with ours. Resolves to
// { qrLinks: string[], verifiableCredential: object|null, firstPagePngBase64: string|null } — never
// rejects (worst case: everything empty/null).
function scanPdfForQr(filepath, { pagesToProcess = [1, 2, 3], viewportScale = 2.0, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* already stopped */ }
      resolve(result);
    };

    const worker = new Worker(QR_PDF_WORKER_PATH, { workerData: { filepath, pagesToProcess, viewportScale } });
    const timer = setTimeout(() => finish({ qrLinks: [], verifiableCredential: null, firstPagePngBase64: null, error: 'timed out' }), timeoutMs);

    worker.on('message', (msg) => finish({
      qrLinks: msg.qrLinks || [],
      verifiableCredential: msg.verifiableCredential || null,
      firstPagePngBase64: msg.firstPagePngBase64 || null
    }));
    worker.on('error', (err) => finish({ qrLinks: [], verifiableCredential: null, firstPagePngBase64: null, error: err.message }));
    worker.on('exit', () => finish({ qrLinks: [], verifiableCredential: null, firstPagePngBase64: null }));
  });
}

// ---------- PDF ----------

async function extractPdf(filepath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filepath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  let text = '';
  const links = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';

    const annotations = await page.getAnnotations();
    for (const ann of annotations) {
      if (ann.url) links.push({ url: ann.url, source: 'pdf-link-annotation' });
    }
  }

  const { qrLinks, verifiableCredential, firstPagePngBase64 } = await scanPdfForQr(filepath);
  for (const url of qrLinks) {
    if (!links.some(l => l.url === url)) links.push({ url, source: 'qr-code-in-pdf' });
  }

  return { text, links, verifiableCredential, renderedPageImageBase64: firstPagePngBase64 };
}

// ---------- Images: OCR + QR ----------

let ocrWorkerPromise = null;
function getOcrWorker() {
  // Reused across requests instead of spinning up a fresh worker (and re-downloading the language
  // data) per upload.
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng');
  }
  return ocrWorkerPromise;
}

async function ocrImage(filepath) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(filepath);
  return data.text || '';
}

async function decodeQr(filepath) {
  try {
    const image = await Jimp.read(filepath);
    const { data, width, height } = image.bitmap;
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
    return code ? code.data : null;
  } catch (err) {
    return null;
  }
}

// Small-print pass. Whole-image OCR reads the big text (title, name) but routinely misses the tiny gray
// certificate number / validation code that issuers print in a corner (found 2026-09-28: a Udemy
// certificate's top-right "Certificate no: UC-..." and a Cursa certificate's bottom "VALIDATION CODE"
// were both invisible to it). Cropping a corner, enlarging it 3x and boosting contrast reads them
// cleanly. Only runs when the first pass found no ID-looking text, and stops at the first hit.
const ID_HINT_RE = /(?:certificate\s*(?:id|no)|cert\.?\s*no|credential\s*id|validation\s*code|reg\S*\s*no)\s*[:.]?\s*[A-Za-z0-9]{4,}|\bUC-[0-9a-f]{8}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
const SMALL_PRINT_REGIONS = [
  [0.5, 0.0, 1.0, 0.18],  // top-right (Udemy)
  [0.0, 0.82, 1.0, 1.0],  // bottom band (Cursa, many others)
  [0.5, 0.82, 1.0, 1.0],  // bottom-right
  [0.0, 0.0, 0.5, 0.18]   // top-left
];

async function ocrSmallPrint(filepath, firstPassText) {
  if (ID_HINT_RE.test(firstPassText)) return firstPassText;
  let combined = firstPassText;
  try {
    const worker = await getOcrWorker();
    for (const [x0, y0, x1, y1] of SMALL_PRINT_REGIONS) {
      const img = await Jimp.read(filepath);
      const { width: W, height: H } = img.bitmap;
      img.crop({ x: Math.floor(W * x0), y: Math.floor(H * y0), w: Math.floor(W * (x1 - x0)), h: Math.floor(H * (y1 - y0)) });
      img.scale(3);
      img.greyscale();
      img.normalize();
      img.contrast(0.4);
      const { data } = await worker.recognize(await img.getBuffer('image/png'));
      if (data.text && data.text.trim()) combined += '\n' + data.text;
      if (ID_HINT_RE.test(data.text || '')) break;
    }
  } catch (err) {
    // A failed extra pass must never break the upload — fall back to whatever the first pass read.
  }
  return combined;
}

async function extractImage(filepath) {
  const [firstPassText, qrData] = await Promise.all([ocrImage(filepath), decodeQr(filepath)]);
  const text = await ocrSmallPrint(filepath, firstPassText);
  const links = [];
  let verifiableCredential = null;
  if (qrData) {
    const raw = qrData.trim();
    if (/^https?:\/\//i.test(raw)) {
      links.push({ url: raw, source: 'qr-code' });
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.proof || (parsed.type && String(parsed.type).includes('VerifiableCredential')))) {
          verifiableCredential = parsed;
        }
      } catch { /* QR held something else this pipeline doesn't handle */ }
    }
  }
  return { text, links, qrRaw: qrData, verifiableCredential };
}

// ---------- Shared field extraction ----------

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

function findUrlsInText(text) {
  const found = text.match(URL_RE) || [];
  // Trim trailing punctuation OCR/PDF text extraction often tacks on.
  return found.map(u => u.replace(/[.,;:]+$/, ''));
}

function normalizeNameForMatch(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractFields(text, context = {}) {
  const fields = {};

  // Certificate ID. Prefer an explicitly labeled ID ("Certificate ID:", "Cert No", "Reg No", etc.)
  // over a bare digit-grab — found via a real test (2026-09-25): an ExcelR certificate's bare-digit
  // regex grabbed "09092026" (the date, embedded inside "59501/EXCELR/EDL/09092026") instead of the
  // actual "Reg/Cert No. 59501". A labeled value, when present, is much more likely to be the real ID.
  const labeledIdMatch = text.match(/(?:certificate\s*id|cert(?:ificate)?\.?\s*no\.?|credential\s*id|validation\s*code|reg(?:istration)?\.?\s*(?:\/\s*cert\.?\s*)?no\.?)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{2,40})/i);
  const idMatch = labeledIdMatch ||
    text.match(/\b([0-9]{8,}[A-Z]{0,3})\b/) ||
    text.match(/\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/) ||
    text.match(/\b(UC-[0-9a-fA-F-]{20,})\b/); // Udemy certificate ID format
  if (idMatch) fields.certificateId = idMatch[1].replace(/[.,;:]+$/, '');

  // Date: "Month DD, YYYY" pattern.
  const dateMatch = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/);
  if (dateMatch) fields.date = dateMatch[0];

  // Percentage score, if present.
  const pctMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/);
  if (pctMatch) fields.scorePercent = pctMatch[1];

  // Hours, if present.
  const hoursMatch = text.match(/\b(\d+)\s*Hours?\b/i);
  if (hoursMatch) fields.hours = hoursMatch[1];

  // Recipient name: certificates overwhelmingly phrase this a handful of standard ways. Best-effort
  // only — used as a cross-check signal against a fetched verification page, never load-bearing on
  // its own.
  // Guard against false positives: PDF text-layer extraction order often doesn't match visual
  // reading order (found via a real test, 2026-09-25 — an ExcelR certificate's "AWARDED TO" was
  // immediately followed in the raw text stream by "Reg/Cert No...", not the actual name, because
  // that's the order those elements were drawn in the PDF). "Reg" is a plausible-looking capitalized
  // word, so it passed the old pattern. Rather than report a wrong name as fact, skip a match whose
  // first word is a common label rather than a name.
  const NAME_FALSE_POSITIVES = /^(reg|cert|certificate|no|id|ref|reference|date|issued|awarded|serial|number|code|for|successfully|the)$/i;
  const nameMatch =
    text.match(/(?:certify that|certifies that|is (?:hereby )?awarded to|awarded to|presented to|this is to certify that)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3})/i) ||
    text.match(/(?:^|\n)\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s*\n\s*(?:has (?:successfully )?completed|has earned)/i);
  if (nameMatch) {
    const candidate = nameMatch[1].trim();
    const firstWord = candidate.split(/\s+/)[0];
    if (!NAME_FALSE_POSITIVES.test(firstWord)) fields.recipientName = candidate;
  }

  // Fallback: none of the phrase-based patterns above matched, but if we already know who's
  // uploading this (context.studentName, threaded in from the caller's own roster record), check
  // whether that exact name appears anywhere in the text as a standalone line. Found via a real test
  // (2026-09-27): a genuine Scaler Topics certificate prints the recipient's name as a bare line with
  // no preceding "awarded to"/"certify that" phrase, so nothing above matched it even though OCR read
  // the name correctly. Deliberately narrow — this only ever CONFIRMS a name we're already told to
  // expect, never invents a new one, so it can't misfire the way a generic "grab any capitalized
  // line" rule would (this same certificate also has the signer's name, "Anshuman Singh", printed in
  // an equally name-shaped line — only roster context can tell those two apart).
  if (!fields.recipientName && context.studentName) {
    const target = normalizeNameForMatch(context.studentName);
    if (target) {
      const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (normalizeNameForMatch(line) === target) {
          fields.recipientName = line;
          fields.recipientNameSource = 'matched-against-roster-name';
          break;
        }
      }
    }
  }

  // Issuer guess: look for known issuer names anywhere in the text. Format-only signal — the
  // registry decides whether that's enough to attempt a live check, not this function.
  const knownIssuers = [
    { key: 'saylor', pattern: /saylor/i },
    { key: 'coursera', pattern: /coursera/i },
    { key: 'edx', pattern: /\bedX\b/ },
    { key: 'udemy', pattern: /udemy/i },
    { key: 'hackerrank', pattern: /hackerrank/i },
    { key: 'credly', pattern: /credly/i },
    { key: 'nptel', pattern: /nptel|swayam/i },
    { key: 'google', pattern: /google (?:career )?certificate/i },
    { key: 'freecodecamp', pattern: /freecodecamp/i },
    { key: 'linkedin-learning', pattern: /linkedin learning/i },
    { key: 'infosys-springboard', pattern: /infosys springboard|onwingspan/i },
    { key: 'cursa', pattern: /\bcursa\b|cursa\.app/i },
    // Platforms whose certificates carry nothing an issuer can be asked about (see UNVERIFIABLE_PLATFORMS in
    // registry.js). Last on purpose: a certificate that names a verifiable issuer is never mislabelled as these.
    { key: 'scaler', pattern: /\bscaler\b/i },
    { key: 'excelr', pattern: /\bexcelr\b/i }
  ];
  for (const iss of knownIssuers) {
    if (iss.pattern.test(text)) {
      fields.issuerGuess = iss.key;
      break;
    }
  }

  return fields;
}

// ---------- Entry point ----------

async function extractFromFile(filepath, context = {}) {
  let text = '';
  let links = [];
  let sourceType = 'unknown';
  let verifiableCredential = null;
  let renderedPageImageBase64 = null;
  const warnings = [];

  try {
    if (isImageFile(filepath)) {
      sourceType = 'image-ocr';
      const result = await extractImage(filepath);
      text = result.text;
      links = result.links;
      verifiableCredential = result.verifiableCredential;
      if (!result.qrRaw) warnings.push('No QR code detected on this image.');
    } else {
      sourceType = 'pdf';
      const result = await extractPdf(filepath);
      text = result.text;
      links = result.links;
      verifiableCredential = result.verifiableCredential;
      renderedPageImageBase64 = result.renderedPageImageBase64;
    }
  } catch (err) {
    return { rawText: '', fields: {}, links: [], sourceType, extractionError: err.message, verifiableCredential: null };
  }

  // Also pick up any bare URL printed as visible text (common: "Verify at coursera.org/verify/xxx").
  for (const url of findUrlsInText(text)) {
    if (!links.some(l => l.url === url)) links.push({ url, source: 'text' });
  }

  const fields = extractFields(text, context);

  return { rawText: text, fields, links, sourceType, warnings, verifiableCredential, renderedPageImageBase64 };
}

module.exports = { extractFromFile, findUrlsInText };
