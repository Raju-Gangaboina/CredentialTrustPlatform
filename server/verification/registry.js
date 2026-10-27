// Verification Engine — decides trust status from what was extracted.
//
// Priority order:
//   0. If the document's QR code decoded into a self-contained signed W3C Verifiable Credential
//      (SunbirdRC/Infosys-Springboard style — see adapters/sunbirdrc.js) -> that's stronger, more
//      specific evidence than the generic non-specific link these certificates print (every
//      Wingspan certificate prints the SAME base URL regardless of student/course), so it's handled
//      by a dedicated adapter BEFORE the generic link-checking path below.
//   1. If the document contains a link (printed URL, PDF hyperlink annotation, or QR code) whose
//      domain we recognize as a real issuer's verification site -> fetch it live, cross-check the
//      page content against the extracted certificate ID / recipient name -> VERIFIED if it matches.
//   2. If the document contains a link to an UNRECOGNIZED domain -> still fetch it (that's what the
//      certificate itself is pointing to), but content-matching a page on a domain we don't
//      independently vouch for is weaker evidence — a forged certificate could point to a page the
//      student controls that just echoes their own name back. Best outcome there is NEEDS_REVIEW
//      with full evidence, never an automatic VERIFIED.
//   3. If there's no usable link at all -> honest NEEDS_REVIEW, same as before, but now the evidence
//      says explicitly what extraction did/didn't find (OCR ran, QR scanned, no link present, etc.)
//      instead of just "manual review needed."
//   4. Issuer-specific adapters (server/verification/adapters/*) can still override this for cases
//      that need bespoke handling (see saylor.js for the one that currently exists).
//
// NOT_FOUND is deliberately conservative: it is only ever returned when a verification page
// EXPLICITLY says the credential doesn't exist/is invalid/was revoked (see webCheck.js
// NEGATIVE_SIGNALS), OR when a signed credential's own payload contradicts who uploaded it (see
// adapters/sunbirdrc.js). A recognized-domain page that loads fine but simply doesn't textually
// contain our extracted ID/name is NOT enough on its own to say NOT_FOUND — proven wrong by a real
// test against a real Saylor certificate (2026-09-25): Saylor's verify page sits behind a login
// wall, so an unauthenticated fetch always "loads fine" and never contains the ID, which used to
// produce a confident NOT_FOUND on a genuinely real certificate. Since NOT_FOUND items never reach
// the faculty review queue (only NEEDS_REVIEW does — see server/routes/certificates.js), a wrong
// NOT_FOUND here means a real student's real certificate gets silently marked as not found with no
// human ever seeing it. Given that asymmetry, an inconclusive check always falls to NEEDS_REVIEW,
// never NOT_FOUND. Don't loosen this back to "reachable + no match = NOT_FOUND" without also making
// sure NOT_FOUND results get a human review path.
const db = require('../db/connection');
const saylorAdapter = require('./adapters/saylor');
const cursaAdapter = require('./adapters/cursa');
const udemyAdapter = require('./adapters/udemy');
const sunbirdrcAdapter = require('./adapters/sunbirdrc');
const { checkVerificationUrl } = require('./webCheck');
const { identifyIssuerByDomain } = require('./knownIssuers');
const { getCookieHeader, recordCheckResult } = require('./issuerSessions');

const ADAPTERS = [saylorAdapter, cursaAdapter, udemyAdapter];
const MAX_LINKS_TO_CHECK = 3;

// Platforms whose certificates have no QR code, link or ID that the issuer can be asked about, so no
// automatic check can ever prove them (confirmed against real Scaler / ExcelR files, memory.md section 5).
// Listed here so the teacher is told that plainly instead of seeing a vague "needs manual verification".
const UNVERIFIABLE_PLATFORMS = { scaler: 'Scaler', excelr: 'ExcelR' };
function unverifiablePlatformName(issuerKey) {
  return UNVERIFIABLE_PLATFORMS[issuerKey] || null;
}

function getIssuerRecord(issuerKey) {
  const row = db.prepare('SELECT * FROM issuer_registry WHERE issuer_key = ?').get(issuerKey);
  return row || null;
}

// context: optional extra info the caller has that extraction alone doesn't — currently just
// { studentName }, used by adapters/sunbirdrc.js to cross-check the signed credential's own
// recipient name against who actually uploaded it.
async function runVerification(extraction, context = {}) {
  const { fields, links = [], sourceType, warnings = [], verifiableCredential } = extraction;

  // 0: a decoded, self-contained signed credential beats a generic link — handle it first.
  if (verifiableCredential && sunbirdrcAdapter.looksLikeSunbirdVc(verifiableCredential)) {
    return sunbirdrcAdapter.verify(verifiableCredential, context);
  }

  // 0.4: Udemy certificates go straight to the Udemy adapter. Its pages return 403 to scripts, so the
  // generic link check would only ever land on "inconclusive" and never compare the recipient name.
  const udemyLink = links.find((l) => identifyIssuerByDomain(l.url) === 'udemy');
  if (fields.issuerGuess === 'udemy' || udemyLink) {
    let udemyId = fields.certificateId;
    if (udemyLink) {
      const m = udemyLink.url.match(/UC-[0-9a-fA-F-]{20,}/);
      if (m) udemyId = m[0];
    }
    return udemyAdapter.verify({ ...fields, certificateId: udemyId, issuerGuess: 'udemy' }, getIssuerRecord('udemy') || {}, context);
  }

  // 0.5: a link to Cursa's certificate page is a special case, same reason as SunbirdRC above
  // but for the opposite reason — Cursa's page is a plain GET that ALWAYS renders "Certificate
  // valid" for any code (confirmed live, 2026-09-28 — see adapters/cursa.js header comment), so
  // the generic checkVerificationUrl() text-match path below would read that boilerplate as a
  // match for every certificate, forged or not. Route straight to the Cursa adapter's real check
  // (S3 object existence) instead, using the code from the link's querystring when present
  // (Cursa's own "Check" button prefills that input from a matching URL param) and otherwise
  // falling back to whatever certificateId extraction found in the document text.
  const cursaLink = links.find((l) => identifyIssuerByDomain(l.url) === 'cursa');
  if (cursaLink) {
    let codeFromLink = null;
    try {
      const u = new URL(cursaLink.url);
      codeFromLink = u.searchParams.get('code') || u.searchParams.get('id') || null;
      // QR codes on Cursa certificates point at .../my-certificate/cert<code> — the code is the
      // last path segment with a leading "cert" (S3 objects are then cert_<code>.png).
      if (!codeFromLink) {
        const seg = u.pathname.split('/').filter(Boolean).pop() || '';
        const m = /^cert_?(?:txt_|vid_)?([A-Za-z0-9]{8,64})$/i.exec(seg);
        if (m) codeFromLink = m[1];
      }
    } catch { /* not a parseable URL — fall back to extracted fields below */ }
    const cursaFields = codeFromLink ? { ...fields, certificateId: codeFromLink } : fields;
    const issuerRecord = getIssuerRecord(cursaAdapter.issuerKey) || {};
    return cursaAdapter.verify(cursaFields, issuerRecord, context);
  }

  // 0.45: Saylor certificates. Saylor's verify page is a two-step Moodle form (GET for a session,
  // then POST to actually run the lookup) — see adapters/saylor.js. The generic link check below
  // only does the GET, so it can never get a real answer from Saylor (it just sees the generic
  // "You are not logged in" footer and gives up). Before this route existed, any Saylor PDF that
  // carried its verify link (i.e. every real one) skipped the working adapter entirely. The code in
  // the link's ?code= param is more reliable than text extraction, so prefer it.
  const saylorLink = links.find((l) => identifyIssuerByDomain(l.url) === 'saylor');
  if (fields.issuerGuess === 'saylor' || saylorLink) {
    let saylorCode = fields.certificateId;
    if (saylorLink) {
      try {
        const fromLink = new URL(saylorLink.url).searchParams.get('code');
        if (fromLink) saylorCode = fromLink;
      } catch { /* unparseable link — fall back to extracted certificateId */ }
    }
    const saylorRecord = getIssuerRecord(saylorAdapter.issuerKey) || {};
    return saylorAdapter.verify({ ...fields, certificateId: saylorCode, issuerGuess: 'saylor' }, saylorRecord, context);
  }

  // 1/2: try links actually found on the document, recognized-domain ones first.
  // Ignore boilerplate links that are never a verification page (PDF-generator credit, accreditation
  // badges) so they don't clutter evidence or eat one of the MAX_LINKS_TO_CHECK slots.
  // A link that only points to a website's front page (e.g. https://verify.onwingspan.com) can never identify one
  // certificate, so it is not fetched; it is only mentioned in the evidence.
  const ignoredHomepages = links.filter((l) => !isBoilerplateLink(l.url) && isBareHomepage(l.url));
  const usableLinks = links.filter((l) => !isBoilerplateLink(l.url) && !isBareHomepage(l.url));
  if (usableLinks.length > 0) {
    const uniqueLinks = dedupeLinks(usableLinks);
    const ranked = [...uniqueLinks].sort((a, b) => {
      const aKnown = identifyIssuerByDomain(a.url) ? 1 : 0;
      const bKnown = identifyIssuerByDomain(b.url) ? 1 : 0;
      return bKnown - aKnown;
    }).slice(0, MAX_LINKS_TO_CHECK);

    const evidence = [];
    evidence.push({ label: describeExtractionSource(sourceType, usableLinks), pass: true });
    if (verifiableCredential) {
      evidence.push({ label: 'A QR code also decoded into structured data, but it was not recognized as a SunbirdRC-style signed credential — treated as informational only', pass: null });
    }

    let sawExplicitlyInvalid = false;
    let sawRecognizedMatch = false;
    let sawUnrecognizedMatch = false;
    let sawInconclusive = false;
    let identifiedIssuerKey = null;

    for (const link of ranked) {
      const issuerKeyForLink = identifyIssuerByDomain(link.url);
      if (issuerKeyForLink && !identifiedIssuerKey) identifiedIssuerKey = issuerKeyForLink;
      const prefix = issuerKeyForLink ? `[recognized issuer: ${issuerKeyForLink}] ` : '[unrecognized domain] ';
      // Only attach a stored session cookie when we independently identified this link's domain
      // as belonging to that exact issuer - never send a saved session to an unrecognized domain.
      const sessionCookie = issuerKeyForLink ? getCookieHeader(issuerKeyForLink) : null;
      const result = await checkVerificationUrl(link.url, fields, sessionCookie);
      if (issuerKeyForLink && sessionCookie) {
        recordCheckResult(issuerKeyForLink, !result.sessionStale);
      }
      evidence.push(...result.evidence.map(e => ({ ...e, label: prefix + e.label })));

      if (result.explicitlyInvalid) sawExplicitlyInvalid = true;
      if (result.inconclusive || !result.reachable || result.httpOk === false) sawInconclusive = true;
      if (result.matched) {
        if (issuerKeyForLink) sawRecognizedMatch = true;
        else sawUnrecognizedMatch = true;
      }
    }

    let status;
    if (sawExplicitlyInvalid) {
      status = 'NOT_FOUND';
    } else if (sawRecognizedMatch) {
      status = 'VERIFIED';
    } else if (sawUnrecognizedMatch) {
      evidence.push({ label: 'Match found, but only on a domain we don\'t independently recognize as an official issuer verification site — flagged for human confirmation rather than auto-approved', pass: false });
      status = 'NEEDS_REVIEW';
    } else if (sawInconclusive) {
      evidence.push({ label: 'Verification page(s) did not give a conclusive answer (login wall, bot challenge, or fetch error) — needs manual confirmation, not treated as not-found', pass: false });
      status = 'NEEDS_REVIEW';
    } else {
      // Page(s) loaded fine, no explicit invalid signal, but also no textual match — genuinely
      // didn't corroborate this credential. Still NEEDS_REVIEW rather than an automatic NOT_FOUND,
      // since a plain-text match/no-match is a weak signal on its own (see header comment) — a
      // human makes the final call either way, this evidence just tells them what was found.
      evidence.push({ label: 'Verification page(s) loaded successfully but did not textually confirm this certificate ID or recipient name — needs manual confirmation', pass: false });
      status = 'NEEDS_REVIEW';
    }

    return { status, evidence, issuerKey: identifiedIssuerKey || fields.issuerGuess || null, unrecognizedHosts: collectUnrecognizedHosts(links) };
  }

  // 3: no link/QR found anywhere on the document — still try a legacy issuer adapter (format-only
  // checks), then fall back to an honest, specific "couldn't verify" result.
  for (const adapter of ADAPTERS) {
    if (adapter.matches(fields)) {
      const issuerRecord = getIssuerRecord(adapter.issuerKey);
      if (!issuerRecord) {
        return {
          status: 'NEEDS_REVIEW',
          issuerKey: adapter.issuerKey,
          evidence: [
            { label: `Issuer identified as ${adapter.issuerKey}`, pass: true },
            { label: 'Certificate ID extracted from document', pass: Boolean(fields.certificateId) },
            { label: `Adapter '${adapter.issuerKey}' found but not yet registered in issuer_registry (run npm run seed, or an admin needs to approve this issuer)`, pass: false }
          ]
        };
      }
      return adapter.verify(fields, issuerRecord, context);
    }
  }

  return noLinkFoundResult(fields, sourceType, warnings, { ignoredHomepages, springboardNoQr: !verifiableCredential && isSpringboardClaim(fields, links) });
}

function isBareHomepage(url) {
  try { const u = new URL(url); return (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash; } catch { return false; }
}
const SPRINGBOARD_KEYS = ['infosys-springboard', 'infosys-wingspan', 'springboard', 'wingspan'];
function isSpringboardClaim(fields, links = []) {
  if (SPRINGBOARD_KEYS.includes(String(fields.issuerGuess || '').toLowerCase())) return true;
  return links.some((l) => SPRINGBOARD_KEYS.includes(identifyIssuerByDomain(l.url)));
}

const BOILERPLATE_HOSTS = ['tcpdf.org', 'iacet.org', 'w3.org', 'adobe.com', 'itextpdf.com', 'pdflib.com'];
function isBoilerplateLink(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return BOILERPLATE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

// The website names (hostnames) on the document's usable links that are NOT on the trusted issuer list, written
// exactly as the certificate prints them (lower-cased only: hostnames are case-insensitive). Saved on the
// certificate so the teacher's "Trust this website" button can offer them without anyone typing a domain.
// Same boilerplate filter as the link check above; capped so a link-stuffed PDF can't bloat the row.
function collectUnrecognizedHosts(links = []) {
  const hosts = [];
  for (const l of links) {
    if (!l || !l.url || isBoilerplateLink(l.url)) continue;
    if (identifyIssuerByDomain(l.url)) continue;
    let host;
    try { host = new URL(l.url).hostname.toLowerCase(); } catch { continue; }
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts.slice(0, 5);
}

function dedupeLinks(links) {
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    out.push(l);
  }
  return out;
}

function describeExtractionSource(sourceType, links) {
  const sources = [...new Set(links.map(l => l.source))];
  const sourceLabel = sourceType === 'image-ocr' ? 'OCR text + QR scan' : 'PDF text + hyperlinks';
  return `Extraction (${sourceLabel}) found ${links.length} verification link(s) on the document (via: ${sources.join(', ')})`;
}

function noLinkFoundResult(fields, sourceType, warnings, extra = {}) {
  const evidence = [
    { label: sourceType === 'image-ocr' ? 'OCR ran on the uploaded image, no verification link or QR code found on it' : 'PDF text and hyperlink annotations scanned, no verification link found on it', pass: false },
    { label: 'Issuer identified from text', pass: Boolean(fields.issuerGuess) },
    { label: 'Certificate ID extracted from document', pass: Boolean(fields.certificateId) },
    { label: 'No verification link, QR code, or known-issuer adapter available — cannot check with the issuer automatically, needs manual verification', pass: false }
  ];
  const platform = unverifiablePlatformName(fields.issuerGuess);
  if (platform) {
    // First line on purpose: it is the most useful thing the teacher can read for these certificates.
    evidence.unshift({
      label: `${platform} certificates cannot be verified automatically: they carry no QR code, link or lookup page the issuer could be asked about. Please check this one yourself (for example, ask the student to show it inside their ${platform} account).`,
      pass: null
    });
  }
  for (const l of (extra.ignoredHomepages || [])) {
    evidence.push({ label: `Ignored the link ${l.url}: it only points to the website's front page, so it cannot identify this certificate (every certificate from that issuer prints the same address).`, pass: null });
  }
  if (extra.springboardNoQr) {
    // Real Springboard/Wingspan certificates always carry a QR with signed data (see adapters/sunbirdrc.js). Evidence only:
    // a low-quality real copy can fail to decode too, so a teacher decides; status stays NEEDS_REVIEW.
    evidence.unshift({ label: 'Infosys Springboard / Wingspan certificates always carry a QR code with signed data, but no readable QR was found on this file. It may be a low-quality copy, or a certificate that was drawn or regenerated (an AI-made certificate usually has a QR that looks real but holds nothing). Ask the student for the original download, or check it yourself on verify.onwingspan.com.', pass: false });
  }
  for (const w of warnings) evidence.push({ label: w, pass: false });
  return { status: 'NEEDS_REVIEW', evidence, issuerKey: fields.issuerGuess || null };
}

module.exports = { runVerification, getIssuerRecord, unverifiablePlatformName, collectUnrecognizedHosts };
