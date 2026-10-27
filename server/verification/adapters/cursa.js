// Reference issuer adapter for Cursa (cursa.app) — free-course certificates.
//
// CONFIRMED LIVE 2026-09-28 via direct testing: Cursa's own "Certificate Validation" page
// (https://cursa.app/en/my-certificate) is NOT itself the check — it's a static page whose
// "Check" button renders "Certificate valid" for EVERY code typed in, including three garbage
// codes made up on the spot. Fetching that page and looking for a success string (the naive
// approach) would be strictly worse than no check at all: a guaranteed rubber stamp for any code.
//
// The REAL check, reverse-engineered from the page's own client-side script
// (https://cursa.app/js/my-certificate-min.js, function validateCertificateNew): for a code
// entered in the "Issued in 2026 or later" form, the page just asks whether an image exists at
// one of three fixed S3 URLs —
//   https://cursacertificates.s3.amazonaws.com/cert_{code}.png       (image certificates)
//   https://cursacertificates.s3.amazonaws.com/cert_txt_{code}.png   (text-style certificates)
//   https://cursacertificates.s3.amazonaws.com/cert_vid_{code}.png   (video-course certificates)
// — via a plain browser <img> load, treating onload as valid and onerror as invalid. That's
// genuinely spoof-resistant: only Cursa can write to their own S3 bucket, so a code nobody at
// Cursa ever issued has no matching object there. Confirmed directly (2026-09-28): a real code's
// cert_ URL returns HTTP 200, and made-up codes return 404 on all three variants.
//
// This adapter reimplements that same check server-side as a HEAD request (no need to download
// the actual PNG bytes just to confirm existence) against all three variants, since we don't know
// ahead of time which certificate style a given code belongs to.
//
// Pre-2026 certificates use a DIFFERENT scheme entirely (see the page's "Issued before 2026"
// section and validateCertificate() in the same JS file): a "u"-prefixed or "c"-prefixed code
// checked against Cursa's own private API (apiurl + "history/validateUser"/"validateCourse"),
// which is undocumented and not confirmed safe/stable to call from outside their own site — NOT
// implemented here. A pre-2026-style code (starts with a bare "u" or "c" followed by digits, per
// that function) falls through to NEEDS_REVIEW rather than guessing at that undocumented API.
//
// Still fails safe: any network error, timeout, or unrecognized response shape falls through to
// NEEDS_REVIEW with an honest evidence line, never a fabricated VERIFIED/NOT_FOUND.

const issuerKey = 'cursa';
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; CampusCredentialTrust-VerificationBot/1.0)';

const S3_BASE = 'https://cursacertificates.s3.amazonaws.com/';
const CERT_VARIANTS = ['cert_', 'cert_txt_', 'cert_vid_'];

// Pre-2026-style codes ("u12345" / "c12345-xyz") use a different, undocumented API — we
// deliberately don't guess at that one. A 2026+ code is otherwise fairly free-form (alphanumeric),
// so this is a narrow "looks like the old scheme" exclusion, not a positive format check.
const PRE_2026_STYLE = /^[uc]\d/i;

function matches(extractedFields) {
  return extractedFields.issuerGuess === issuerKey;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// HEAD-checks each of the three S3 object variants for this code, exactly matching the site's own
// client-side logic (which tries them in this same order). Returns { ok, exists, variant } where
// `exists` mirrors what the site itself would tell the student, or { ok: false, reason } on a
// genuine network failure (not a 404 — a 404 is a normal, meaningful "no").
async function checkCursaLive(code) {
  for (const prefix of CERT_VARIANTS) {
    const url = `${S3_BASE}${prefix}${encodeURIComponent(code)}.png`;
    let res;
    try {
      res = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
      return { ok: false, reason: `Network error checking Cursa's certificate storage: ${err.message}` };
    }
    if (res.status === 200) {
      return { ok: true, exists: true, variant: prefix };
    }
    if (res.status !== 404 && res.status !== 403) {
      // Some other, unexpected status (5xx, throttling, etc.) — don't treat as a confident "no".
      return { ok: false, reason: `Cursa's certificate storage returned an unexpected status (${res.status}) — needs manual check` };
    }
  }
  return { ok: true, exists: false };
}

async function verify(fields, registryConfig, context = {}) {
  const evidence = [];

  evidence.push({ label: 'Issuer identified as Cursa', pass: true });

  const hasId = Boolean(fields.certificateId);
  evidence.push({ label: 'Certificate ID extracted from document', pass: hasId });

  if (!hasId) {
    evidence.push({ label: 'Skipped live Cursa lookup — no certificate ID to check', pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  if (PRE_2026_STYLE.test(fields.certificateId)) {
    evidence.push({
      label: 'Certificate code looks like a pre-2026 Cursa format, which uses a different, undocumented verification API — not automatically checked, needs manual confirmation',
      pass: false
    });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  let live;
  try {
    live = await checkCursaLive(fields.certificateId);
  } catch (err) {
    live = { ok: false, reason: `Unexpected error checking Cursa's certificate storage: ${err.message}` };
  }

  if (!live.ok) {
    evidence.push({ label: `Live Cursa verification check — ${live.reason}`, pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  if (!live.exists) {
    evidence.push({
      label: "No matching certificate image found in Cursa's certificate storage for this code (checked all known certificate-type variants) — same negative result Cursa's own validation page would show",
      pass: false
    });
    return { status: 'NOT_FOUND', evidence, issuerKey };
  }

  evidence.push({
    label: `A matching certificate image exists in Cursa's own certificate storage for this code (variant: ${live.variant.replace(/_$/, '') || 'standard'}) — this is the same check Cursa's own site performs, done server-side against their storage directly`,
    pass: true
  });

  // Note: the storage check confirms existence only; the recipient-name comparison happens below
  // against Cursa's own stored image.

  // Existence alone isn't enough: anyone can take a REAL code and edit the name on their copy. So
  // also read the name off Cursa's own stored image (OCR) and compare it to the uploading student.
  // Cursa renders names without reliable spacing ("PRATIKSETHI"), so compare on letters only.
  if (context.studentName) {
    const copyText = await readCursaCopyText(fields.certificateId, live.variant);
    if (!copyText) {
      evidence.push({ label: "Could not read the name from Cursa's own copy of this certificate (OCR failed) — the code is real but the recipient wasn't confirmed, needs a human look", pass: false });
      return { status: 'NEEDS_REVIEW', evidence, issuerKey };
    }
    const squashed = copyText.toLowerCase().replace(/[^a-z]/g, '');
    const words = context.studentName.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter((w) => w.length >= 3);
    // Names are drawn in a script font, so OCR often garbles the last letter(s) ("SETHI" -> "SETH EE").
    // Allow a word to match on all-but-its-last-letter when it's long enough to stay specific.
    const found = words.filter((w) => squashed.includes(w) || (w.length >= 5 && squashed.includes(w.slice(0, -1)))).length;
    const nameOk = words.length > 0 && found >= Math.min(2, words.length);
    evidence.push({
      label: nameOk
        ? `Cursa's own copy of this certificate names the uploading student (${context.studentName})`
        : `Cursa's own copy of this certificate does NOT contain the uploading student's registered name (${context.studentName}) — the code is real but appears to be issued to someone else (or the name couldn't be read clearly)`,
      pass: nameOk
    });
    if (!nameOk) return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  return { status: 'VERIFIED', evidence, issuerKey };
}

// Downloads Cursa's stored PNG for this code and OCRs it (via the shared extractor).
async function readCursaCopyText(code, variant) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `cursa_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
  try {
    const res = await fetchWithTimeout(`${S3_BASE}${variant}${encodeURIComponent(code)}.png`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return null;
    fs.writeFileSync(tmp, buf);
    const { extractFromFile } = require('../extractor');
    const ex = await extractFromFile(tmp, {});
    return String(ex.rawText || '') || null;
  } catch {
    return null;
  } finally {
    fs.unlink(tmp, () => {});
  }
}

module.exports = { issuerKey, matches, verify };
