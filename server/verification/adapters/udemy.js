// Issuer adapter for Udemy certificates (UC-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
//
// WHY THIS EXISTS: a certificate can be regenerated end-to-end by an image model with only the
// recipient name changed (tested 2026-09-28 with a real Udemy certificate whose name was swapped).
// Pixel forensics (ELA / copy-move) can't see that, because nothing was pasted over. What CAN catch
// it is Udemy's own record: udemy.com/certificate/<UC-id>/ shows "Certificate Recipient: <name>" in a
// normal browser, and that name is the one Udemy actually issued to.
//
// LIMITS (confirmed 2026-09-28): plain scripted requests to udemy.com/certificate/<id>/ and to the
// ude.my short link both return HTTP 403 (bot protection). So this adapter:
//   - attaches a faculty-supplied session cookie if one is stored (issuerSessions, key "udemy"),
//   - never treats a 403/challenge/timeout as a pass — it returns NEEDS_REVIEW with the link so a
//     human can open it and compare names,
//   - only issues NOT_FOUND for a clean 404 or a name that shares no words with Udemy's record.
// The recipient-name parsing below is written from the page as seen in a browser and has NOT been
// exercised against a live scripted response (we can't get one past the 403). If Udemy's markup
// differs, the parse returns null and the result is NEEDS_REVIEW, never a false VERIFIED.

const { getCookieHeader, recordCheckResult } = require('../issuerSessions');

const issuerKey = 'udemy';
const FETCH_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ID_RE = /^UC-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function matches(extractedFields) {
  return extractedFields.issuerGuess === issuerKey;
}

function tokens(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
}

// 'same' = identical word sets; 'overlap' = some shared words (middle names, initials, ordering);
// 'different' = no shared words at all.
function compareNames(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 'unknown';
  const shared = [...A].filter((t) => B.has(t)).length;
  if (shared === A.size && shared === B.size) return 'same';
  if (shared === 0) return 'different';
  return 'overlap';
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

// Best-effort: text following the "Certificate Recipient" heading, then a few JSON-ish shapes.
function parseRecipient(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  let m = text.match(/Certificate\s+Recipient\s*:?\s*(?:<[^>]*>\s*)*(?:[A-Z]{1,3}\s*(?:<[^>]*>\s*)+)?([^<]{3,80})</i);
  if (m) return decodeEntities(m[1]);
  m = html.match(/"(?:recipient_?name|recipientName|user_?name|display_?name)"\s*:\s*"([^"]{3,80})"/i);
  if (m) return decodeEntities(m[1]);
  return null;
}

async function fetchCertificatePage(id) {
  const url = `https://www.udemy.com/certificate/${id}/`;
  const cookie = getCookieHeader(issuerKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(cookie ? { Cookie: cookie } : {}) },
      signal: controller.signal
    });
    const body = res.ok ? await res.text() : '';
    return { url, status: res.status, body, usedCookie: Boolean(cookie) };
  } catch (err) {
    return { url, error: err.message, usedCookie: Boolean(cookie) };
  } finally {
    clearTimeout(timer);
  }
}

// Udemy hosts every issued certificate as a public PDF on S3 (same file Udemy's own "Download"
// button gives, confirmed live 2026-09-28: HTTP 200 for a real id, reachable from a normal machine
// even though udemy.com/certificate/<id>/ itself returns 403 to scripts). The recipient name printed
// in THAT copy is Udemy's own record, so comparing against it does the same job as the blocked page.
// The name sits in the text next to instructor names, so instead of guessing which line is the
// recipient, we check whether the student's name words appear in Udemy's copy.
async function fetchIssuerCopyText(id) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const url = `https://udemy-certificate.s3.amazonaws.com/pdf/${id}.pdf`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const tmp = path.join(os.tmpdir(), `udemy_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024 || buf.slice(0, 4).toString() !== '%PDF') return null;
    fs.writeFileSync(tmp, buf);
    const { extractFromFile } = require('../extractor');
    const ex = await extractFromFile(tmp, {});
    const text = String(ex.rawText || '');
    // Must actually be this certificate, not some other file.
    if (!text.toUpperCase().includes(id.toUpperCase())) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    fs.unlink(tmp, () => {});
  }
}

// How many of `name`'s words appear as words in `text`.
function nameWordsFoundIn(name, text) {
  const words = new Set(tokens(text));
  const mine = tokens(name);
  return { found: mine.filter((t) => words.has(t)).length, total: mine.length };
}

async function verify(fields, registryConfig, context = {}) {
  const evidence = [];
  evidence.push({ label: 'Issuer identified as Udemy', pass: true });

  const id = fields.certificateId;
  if (!id) {
    evidence.push({ label: 'Certificate number not found in the document — cannot look it up on Udemy', pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }
  evidence.push({ label: `Certificate number extracted (${id})`, pass: true });

  if (!ID_RE.test(id)) {
    evidence.push({ label: 'Certificate number is not in Udemy\'s UC-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx format', pass: false });
    return { status: 'NOT_FOUND', evidence, issuerKey };
  }

  const issuerText = await fetchIssuerCopyText(id);
  if (issuerText) {
    evidence.push({ label: "Udemy's own hosted copy of this certificate was retrieved and matches this certificate number", pass: true });
    const between = /Instructors?\s+([\s\S]*?)\s+Date\b/i.exec(issuerText);
    if (between) evidence.push({ label: `Names printed on Udemy's copy (instructor + recipient): ${between[1].replace(/\s+/g, ' ').trim().slice(0, 120)}`, pass: null });

    const need = (n) => Math.min(2, n.total);
    let studentOk = null;
    if (context.studentName) {
      const r = nameWordsFoundIn(context.studentName, issuerText);
      studentOk = r.total > 0 && r.found >= need(r);
      evidence.push({ label: studentOk ? `Udemy's copy names the uploading student (${context.studentName})` : `Udemy's copy does NOT contain the uploading student's registered name (${context.studentName}) — this certificate number appears to be issued to someone else`, pass: studentOk });
    }
    let printedOk = null;
    if (fields.recipientName) {
      const r = nameWordsFoundIn(fields.recipientName, issuerText);
      printedOk = r.total > 0 && r.found >= need(r);
      evidence.push({ label: printedOk ? `Name printed on the uploaded file (${fields.recipientName}) matches Udemy's copy` : `Name printed on the uploaded file (${fields.recipientName}) does NOT match Udemy's copy — possible edited/regenerated certificate`, pass: printedOk });
    }
    if (studentOk === true && printedOk !== false) return { status: 'VERIFIED', evidence, issuerKey };
    if (studentOk === null && printedOk === true) return { status: 'VERIFIED', evidence, issuerKey };
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  const page = await fetchCertificatePage(id);
  const manualLink = page.url;

  if (page.error) {
    evidence.push({ label: `Could not reach Udemy (${page.error}). Open ${manualLink} and confirm the recipient name matches this certificate.`, pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }
  if (page.status === 404) {
    recordCheckResult(issuerKey, true);
    evidence.push({ label: 'Udemy has no certificate with this number', pass: false });
    return { status: 'NOT_FOUND', evidence, issuerKey };
  }
  if (page.status !== 200) {
    if (page.usedCookie) recordCheckResult(issuerKey, false);
    evidence.push({
      label: `Udemy blocked the automatic check (HTTP ${page.status}). Not treated as valid — open ${manualLink} and confirm the recipient name matches this certificate.`,
      pass: false
    });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  recordCheckResult(issuerKey, true);
  const udemyName = parseRecipient(page.body);
  if (!udemyName) {
    evidence.push({ label: `Udemy page loaded but the recipient name could not be read automatically. Open ${manualLink} to compare.`, pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }
  evidence.push({ label: `Udemy's record for this certificate names the recipient as: ${udemyName}`, pass: true });

  const checks = [];
  if (fields.recipientName) checks.push({ what: 'the name printed on the certificate', value: fields.recipientName });
  if (context.studentName) checks.push({ what: "the uploading student's registered name", value: context.studentName });
  if (!checks.length) {
    evidence.push({ label: 'No name available to compare against Udemy\'s record', pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  let worst = 'same';
  for (const c of checks) {
    const r = compareNames(udemyName, c.value);
    if (r === 'different') worst = 'different';
    else if ((r === 'overlap' || r === 'unknown') && worst !== 'different') worst = 'overlap';
    evidence.push({
      label: r === 'same'
        ? `Udemy's recipient name matches ${c.what} (${c.value})`
        : r === 'different'
          ? `Udemy's recipient name (${udemyName}) does NOT match ${c.what} (${c.value}) — this certificate number was issued to someone else`
          : `Udemy's recipient name (${udemyName}) only partly matches ${c.what} (${c.value}) — needs a human look`,
      pass: r === 'same'
    });
  }

  if (worst === 'different') return { status: 'NOT_FOUND', evidence, issuerKey };
  if (worst === 'overlap') return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  return { status: 'VERIFIED', evidence, issuerKey };
}

module.exports = { issuerKey, matches, verify, compareNames, parseRecipient };
