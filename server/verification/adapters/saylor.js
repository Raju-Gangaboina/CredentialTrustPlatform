// Reference issuer adapter for Saylor Academy.
//
// UPDATED 2026-09-27 (this session): a real, working, anonymous verification endpoint HAS now
// been confirmed — reverse this file's prior assumption. Saylor's "Verify certificates" tool at
// VERIFY_URL is publicly callable with NO login, but it is a two-step Moodle form, not a simple
// GET-with-query-param:
//   1. GET VERIFY_URL?code=<id>       — establishes a guest session + sesskey. This ONLY
//      pre-fills the code input; it does NOT run the lookup. A plain fetch of this URL alone
//      (what this project's earlier session, and this session's own first attempt, both did)
//      returns a page that always says "You are not logged in" in the page FOOTER — that text is
//      generic Moodle boilerplate shown to every anonymous visitor on every page, unrelated to
//      whether the lookup itself needs auth. It is NOT a login wall for this tool, and matching on
//      it (as server/verification/webCheck.js's INCONCLUSIVE_SIGNALS does, for other issuers where
//      a login wall is real) produced a false "inconclusive" here.
//   2. POST VERIFY_URL with code + sesskey + the hidden `_qf__tool_certificate_verify_certificate_form=1`
//      + verify=Verify (the actual submit values Moodle's form posts) — THIS runs the real lookup
//      and returns a page with either `<p class="m-0 alert-success">This certificate is valid</p>`
//      plus a table of Full name / Certificate / Date issued / Expiry date / Status, or an
//      invalid/not-found indication.
// Confirmed live against a real certificate (2164168379RD, Ragi Dharma Teja) on 2026-09-27: the
// two-step flow above returns "This certificate is valid" with the correct name, course, and
// issue date. Don't revert to a format-only stub, and don't try a single GET — both were tried
// and failed to reach the real result.
//
// Still fails safe: any network error, timeout, or unrecognized response shape from Saylor's page
// (site redesign, etc.) falls through to NEEDS_REVIEW with an honest evidence line, never a
// fabricated VERIFIED/NOT_FOUND.

const { compareNames } = require('./sunbirdrc');

const issuerKey = 'saylor';
const VERIFY_URL = 'https://learn.saylor.org/admin/tool/certificate/index.php';
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; CampusCredentialTrust-VerificationBot/1.0)';

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

function cookieHeaderFromResponse(res) {
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

function extractTableField(html, label) {
  const re = new RegExp(`${label}<\\/td>\\s*<td[^>]*>([^<]*)<`, 'i');
  const m = re.exec(html);
  return m ? m[1].trim() : null;
}

// Runs the real two-step check. Never throws for an ordinary "not found" outcome — only for
// genuine network/timeout failures, which the caller treats as inconclusive (NEEDS_REVIEW).
async function checkSaylorLive(certificateId) {
  const getRes = await fetchWithTimeout(`${VERIFY_URL}?code=${encodeURIComponent(certificateId)}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
  const getBody = await getRes.text();
  const sesskeyMatch = /"sesskey":"([^"]+)"/.exec(getBody);
  if (!sesskeyMatch) {
    return { ok: false, reason: "Could not find a session key on Saylor's verify page — page format may have changed" };
  }
  const cookieHeader = cookieHeaderFromResponse(getRes);

  const formBody = new URLSearchParams({
    code: certificateId,
    sesskey: sesskeyMatch[1],
    _qf__tool_certificate_verify_certificate_form: '1',
    verify: 'Verify'
  });
  const postRes = await fetchWithTimeout(VERIFY_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    body: formBody.toString()
  });
  const postBody = await postRes.text();

  if (/This certificate is valid/i.test(postBody)) {
    return {
      ok: true,
      valid: true,
      fullName: extractTableField(postBody, 'Full name'),
      certLabel: extractTableField(postBody, 'Certificate'),
      dateIssued: extractTableField(postBody, 'Date issued'),
      status: extractTableField(postBody, 'Status')
    };
  }
  if (/not verified|could not be found|invalid code|no certificate/i.test(postBody)) {
    return { ok: true, valid: false };
  }
  return { ok: false, reason: "Saylor's page responded but the result wasn't in the expected format — page may have changed, needs manual check" };
}

// context: optional { studentName } — the roster name of whoever uploaded this certificate, used
// to cross-check against the name Saylor's own record reports (stronger evidence than trusting
// the document's own text, which could be edited).
async function verify(fields, registryConfig, context = {}) {
  const evidence = [];
  const config = JSON.parse(registryConfig.config_json || '{}');
  const idPattern = config.id_pattern ? new RegExp(config.id_pattern) : null;

  evidence.push({ label: 'Issuer identified as Saylor Academy', pass: true });

  const hasId = Boolean(fields.certificateId);
  evidence.push({ label: 'Certificate ID extracted from document', pass: hasId });

  // No configured pattern (e.g. issuer_registry row missing/empty) shouldn't block the live lookup.
  let idFormatOk = hasId && !idPattern;
  if (hasId && idPattern) {
    idFormatOk = idPattern.test(fields.certificateId);
    evidence.push({ label: "Certificate ID matches Saylor's expected format", pass: idFormatOk });
  }

  if (!hasId || !idFormatOk) {
    evidence.push({ label: 'Skipped live Saylor lookup — no valid-format certificate ID to check', pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  let live;
  try {
    live = await checkSaylorLive(fields.certificateId);
  } catch (err) {
    live = { ok: false, reason: `Network error contacting Saylor's verify tool: ${err.message}` };
  }

  if (!live.ok) {
    evidence.push({ label: `Live Saylor verification check — ${live.reason}`, pass: false });
    return { status: 'NEEDS_REVIEW', evidence, issuerKey };
  }

  if (!live.valid) {
    evidence.push({ label: "Saylor's own verification tool reports this certificate code as not valid / not found", pass: false });
    return { status: 'NOT_FOUND', evidence, issuerKey };
  }

  evidence.push({
    label: `Saylor's verification tool confirms this certificate is valid — Full name: ${live.fullName || 'n/a'}, Certificate: ${live.certLabel || 'n/a'}, Date issued: ${live.dateIssued || 'n/a'}, Status: ${live.status || 'n/a'}`,
    pass: true
  });

  if (context.studentName && live.fullName) {
    // Same tolerant matching as the SunbirdRC adapter: exact, or a >=2-token in-order subset (e.g.
    // "Raju Yadav" vs "Gangaboina Raju Yadav"), or the same >=2 name tokens in a different order
    // (Saylor often prints "First Last" while the roster is "Last First").
    const tokens = (s) => String(s).toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
    const a = tokens(live.fullName);
    const b = tokens(context.studentName);
    const shared = a.filter((t) => b.includes(t)).length;
    const cmp = compareNames(live.fullName, context.studentName);
    const nameMatches = cmp === 'exact' || cmp === 'partial' || shared >= 2;
    evidence.push({ label: "Full name on Saylor's live record matches the uploading student's registered name", pass: nameMatches });
    if (!nameMatches) {
      evidence.push({ label: 'Name mismatch flagged for human review rather than auto-approved', pass: false });
      return { status: 'NEEDS_REVIEW', evidence, issuerKey };
    }
  }

  return { status: 'VERIFIED', evidence, issuerKey };
}

module.exports = { issuerKey, matches, verify };
