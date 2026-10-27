// Live Web Verification — the actual "go check with the issuer" step.
//
// Given a candidate URL (found embedded in the certificate: a printed link, a PDF hyperlink
// annotation, or a decoded QR code) and the fields we extracted from the document, this fetches
// that URL for real and looks for corroborating evidence on the page: does the certificate ID
// and/or recipient name we pulled off the document actually appear on the page the certificate
// itself points to?
//
// This is deliberately NOT "does the URL 200" — a live domain proves nothing on its own. The
// evidence that matters is whether the *content* of that page corroborates the document.
//
// Safety: the URL comes from something a student uploaded, so treat it as untrusted input.
//   - Only http/https.
//   - Resolve the hostname and reject private/loopback/link-local IPs (basic SSRF guard).
//   - Hard timeout, capped response size, capped redirect hops, no credentials/cookies sent.
const dns = require('dns').promises;
const net = require('net');

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5; // was 3 — some issuer sites chain an HTTP redirect *and* a meta-refresh
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB is plenty for an HTML verification page

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::1') return true;
    if (norm.startsWith('fe80:')) return true; // link-local
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique local
    return false;
  }
  return true; // not a recognizable IP at all — refuse rather than guess
}

async function assertSafeHost(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Host ${hostname} resolved to no addresses`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Refusing to fetch ${hostname}: resolves to a private/internal address`);
    }
  }
}

function normalizeEncodingLabel(charset) {
  if (!charset) return 'utf8';
  const c = charset.replace(/[^a-z0-9]/g, '');
  if (c === 'utf8') return 'utf8';
  if (c === 'iso88591' || c === 'latin1' || c === 'windows1252' || c === 'cp1252') return 'latin1';
  if (c === 'utf16le' || c === 'ucs2') return 'utf16le';
  if (c === 'ascii' || c === 'usascii') return 'ascii';
  return 'utf8'; // unknown/unsupported label — safest fallback rather than throwing
}

function decodeBody(rawBuf, contentType) {
  const charsetMatch = /charset=([^;]+)/i.exec(contentType || '');
  let charset = charsetMatch ? charsetMatch[1].trim().toLowerCase().replace(/^["']|["']$/g, '') : null;
  if (!charset) {
    // No charset on the HTTP header — check for an in-document <meta charset> declaration.
    // ASCII-safe to read as latin1 for this scan since we're only looking for the charset token.
    const head = rawBuf.toString('latin1', 0, Math.min(rawBuf.length, 4096));
    const metaMatch = /<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i.exec(head);
    if (metaMatch) charset = metaMatch[1].toLowerCase();
  }
  try {
    return rawBuf.toString(normalizeEncodingLabel(charset));
  } catch {
    return rawBuf.toString('utf8');
  }
}

function findMetaRefreshUrl(body) {
  // Some issuer verification pages return HTTP 200 for an interstitial that immediately
  // reassigns the browser via <meta http-equiv="refresh" content="0;url=...">. Without
  // following this, the "real" verification content is never actually fetched, and the
  // interstitial's own boilerplate gets checked instead — producing false inconclusive/no-match
  // results for a page that would otherwise resolve cleanly.
  const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']([^"']+)["']/i.exec(body);
  if (!m) return null;
  const contentAttr = m[1];
  const urlMatch = /url\s*=\s*(.+)$/i.exec(contentAttr);
  if (!urlMatch) return null;
  return urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

// Manual redirect-following fetch with per-hop safety checks (native fetch's own redirect
// handling doesn't let us re-validate the destination host at each hop).
async function safeFetch(url, redirectsLeft = MAX_REDIRECTS, cookie = null) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  await assertSafeHost(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; CampusCredentialTrust-VerificationBot/1.0; +https://; Chrome/120.0.0.0 Safari/537.36)',
      'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    if (cookie) headers['Cookie'] = cookie;
    res = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'manual', headers });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`);
    throw new Error(`Network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get('location');
    if (!location) throw new Error(`Redirect (${res.status}) with no Location header`);
    if (redirectsLeft <= 0) throw new Error('Too many redirects');
    const nextUrl = new URL(location, parsed).toString();
    const sameHost = nextUrl.startsWith(parsed.protocol + '//' + parsed.hostname);
    return safeFetch(nextUrl, redirectsLeft - 1, sameHost ? cookie : null);
  }

  const reader = res.body ? res.body.getReader() : null;
  let received = 0;
  const chunks = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BODY_BYTES) { reader.cancel(); break; }
      chunks.push(value);
    }
  }
  const rawBuf = Buffer.concat(chunks);
  const contentType = res.headers.get('content-type') || '';
  const body = decodeBody(rawBuf, contentType);

  // Follow a client-side meta-refresh redirect the same way we follow an HTTP redirect —
  // bounded by the same redirectsLeft budget so a redirect loop still terminates.
  if (redirectsLeft > 0 && /^text\/html/i.test(contentType || 'text/html')) {
    const metaUrl = findMetaRefreshUrl(body);
    if (metaUrl) {
      const nextUrl = new URL(metaUrl, parsed).toString();
      const sameHost = nextUrl.startsWith(parsed.protocol + '//' + parsed.hostname);
      return safeFetch(nextUrl, redirectsLeft - 1, sameHost ? cookie : null);
    }
  }

  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    body,
    contentType,
    finalUrl: parsed.toString()
  };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Collapses a string down to a comparable "core": lowercase, and strip everything but letters
// and digits. This is what makes ID/name matching actually robust across real-world formatting
// noise — e.g. a certificate ID extracted as "2164168-379RD" still matches a page that renders it
// as "2164168379 RD" or "Code: 2164168379-RD", and a name like "O'Brien, Sam" still matches
// "O’Brien Sam" (curly apostrophe) or "SAM O'BRIEN". A plain case-insensitive substring check (the
// old behavior) breaks on any of these and produces a false "no textual match" — indistinguishable
// from the credential genuinely not being on the page.
function normalizeForMatch(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics after NFKD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function fuzzyContains(haystackNormalized, needleRaw) {
  const needle = normalizeForMatch(needleRaw);
  if (!needle) return false;
  return haystackNormalized.includes(needle);
}

const NEGATIVE_SIGNALS = [
  /certificate (?:could not be|not) (?:be )?(?:found|verified)/i,
  /no (?:such|matching|record of this) certificate/i,
  /\binvalid (?:certificate|credential|code)\b/i,
  /\b404\b.{0,20}not found/i,
  /this (?:credential|certificate|badge) (?:has been )?revoked/i,
  /(?:certificate|credential) (?:has )?expired/i,
  /we (?:could not|couldn't|can't|cannot) find (?:a |any )?(?:matching )?(?:certificate|credential|record)/i,
  /no results? (?:were )?found for this (?:id|code|number)/i
];

// Signals that the page didn't actually run the lookup at all — a login wall, a CAPTCHA, a bot
// challenge, etc. Found via a real test against a real Saylor certificate (2026-09-25): Saylor's
// verification URL returns HTTP 200 with a normal-looking page, but the actual lookup is gated
// behind "You are not logged in" — so an unauthenticated fetch NEVER gets a real answer from that
// page. Without this check, that reads exactly like "page loaded, cert not mentioned" and produces
// a confident (and wrong) NOT_FOUND on a genuine certificate. This is worse than not checking at
// all, so it gets its own category instead of falling through to a match/no-match verdict.
const INCONCLUSIVE_SIGNALS = [
  /you are not logged in/i,
  /(?:please )?(?:log|sign) in to (?:view|continue|verify)/i,
  /login required/i,
  /authentication required/i,
  /verify (?:you are|you're) (?:human|not a robot)/i,
  /complete the captcha/i,
  /access denied/i,
  /enable javascript to (?:view|continue|run)/i,
  // Client-rendered SPA shells: fetching the raw HTML gets an (almost) empty page because the
  // actual verification result is drawn by JavaScript after load, which this fetcher never runs.
  // Without this, an SPA's near-empty shell reads exactly like "page loaded, nothing matched".
  /^\s*<div id=["'](?:root|app)["']\s*>\s*<\/div>/i,
  /you need to enable javascript to run this app/i,
  /loading\.{2,3}\s*$/i,
  /rate limit(?:ed)?/i,
  /too many requests/i,
  /service (?:temporarily )?unavailable/i,
  /cloudflare/i // a raw Cloudflare challenge/interstitial page rather than the real site content
];

// Runs the live check and returns an evidence array (never throws — a failed/ambiguous fetch is
// itself evidence, not an exception the caller has to handle).
async function checkVerificationUrl(url, fields, sessionCookie = null) {
  const evidence = [];
  let result;
  try {
    result = await safeFetch(url, MAX_REDIRECTS, sessionCookie);
  } catch (err) {
    evidence.push({ label: `Fetched embedded verification link (${url}) — failed: ${err.message}`, pass: false });
    return { evidence, reachable: false, matched: false };
  }

  if (!result.ok) {
    evidence.push({ label: `Fetched embedded verification link (${url}) — HTTP ${result.status}`, pass: false });
    return { evidence, reachable: true, httpOk: false, matched: false };
  }
  evidence.push({ label: `Fetched embedded verification link (${url}) — page loaded (HTTP ${result.status})`, pass: true });

  const isJson = /application\/(?:[a-z.+-]+\+)?json/i.test(result.contentType || '');
  // Some issuer "verify" endpoints are JSON APIs, not HTML pages (common behind a mobile-app-style
  // verify link). Checking raw JSON text works fine for substring matching, but stripping it as
  // HTML would be a no-op anyway — keep the raw text either way and just skip the HTML-entity pass.
  const pageText = isJson ? result.body : stripHtml(result.body);
  const normalizedPage = normalizeForMatch(pageText);

  for (const neg of NEGATIVE_SIGNALS) {
    if (neg.test(pageText)) {
      evidence.push({ label: 'Verification page explicitly indicates this credential is not valid/found', pass: false });
      return { evidence, reachable: true, httpOk: true, matched: false, explicitlyInvalid: true };
    }
  }

  for (const sig of INCONCLUSIVE_SIGNALS) {
    if (sig.test(pageText)) {
      const sessionNote = sessionCookie
        ? ' A stored login session for this issuer was attached but still hit this wall - it has likely expired; a faculty member should log in again and refresh it.'
        : ' No stored login session for this issuer - a faculty member can save one (one-time login bridge) to make this check conclusive going forward.';
      evidence.push({ label: 'Verification page loaded but did not actually run the lookup (looks like a login wall, CAPTCHA, bot challenge, rate limit, or a JS-only page this checker cannot render) - cannot confirm or deny this credential from an automated request.' + sessionNote, pass: false });
      return { evidence, reachable: true, httpOk: true, matched: false, inconclusive: true, sessionStale: Boolean(sessionCookie) };
    }
  }

  // A page with almost no text at all (after stripping tags) is a strong sign the real content
  // never rendered server-side — treat it the same as the explicit SPA-shell signals above rather
  // than confidently reporting "no match" against essentially nothing.
  if (!isJson && pageText.length < 40) {
    evidence.push({ label: 'Verification page returned almost no readable text content (likely a JavaScript-rendered page this automated checker cannot execute) — cannot confirm or deny this credential', pass: false });
    return { evidence, reachable: true, httpOk: true, matched: false, inconclusive: true };
  }

  let matched = false;
  if (fields.certificateId) {
    const idFound = fuzzyContains(normalizedPage, fields.certificateId);
    evidence.push({ label: `Certificate ID (${fields.certificateId}) appears on the verification page`, pass: idFound });
    matched = matched || idFound;
  }
  if (fields.recipientName) {
    const nameFound = fuzzyContains(normalizedPage, fields.recipientName);
    evidence.push({ label: `Recipient name (${fields.recipientName}) appears on the verification page`, pass: nameFound });
    matched = matched || nameFound;
  }
  if (!fields.certificateId && !fields.recipientName) {
    evidence.push({ label: 'Verification page loaded, but no certificate ID or recipient name was extracted from the document to cross-check against it', pass: false });
  }

  return { evidence, reachable: true, httpOk: true, matched, pageTextSample: pageText.slice(0, 500) };
}

module.exports = { checkVerificationUrl, safeFetch, isPrivateIp, normalizeForMatch };
