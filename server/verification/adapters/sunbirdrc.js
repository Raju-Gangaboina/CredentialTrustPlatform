// SunbirdRC Verifiable-Credential adapter.
//
// SunbirdRC (https://sunbird-rc.dev) is the open-source credentialing platform behind Infosys
// Springboard/Wingspan certificates (confirmed 2026-09-27 — see memory.md) and, per SunbirdRC's own
// documentation, is also reused across other India-based credentialing deployments. Its certificates
// print the SAME generic, non-specific base URL on every certificate ("verify.onwingspan.com"), but
// embed a full, cryptographically-signed W3C Verifiable Credential (recipient, course, completion
// date, Ed25519 signature) directly inside the printed QR code — see extractor.js/qrPdfWorker.js for
// how that gets decoded. This adapter is what turns that decoded payload into evidence.
//
// SIGNATURE VERIFICATION STATUS: tried, for real, to independently verify the Ed25519
// signature (2026-09-27) and could not — see the three bullets below. AS OF 2026-09-28 this
// adapter DOES still return bare VERIFIED for a matching cert anyway — that's a deliberate,
// informed product decision by the project owner (see memory.md section 19), not because the gap
// below got closed. Read that section before changing the status logic further down this file.
//   - `proof.verificationMethod` is always the literal string "did:india" on every SunbirdRC
//     credential seen so far — including SunbirdRC's OWN official Verify-API documentation sample,
//     for a completely unrelated issuer ("did:web:openg2p"). That confirms it's a fixed placeholder
//     their signing library writes into every proof, not a real, resolvable key reference — there is
//     no public key to check the signature against via this field.
//   - Tried resolving the issuer DID itself directly (`did:web:sunbirdrc.dev/vc/skill` ->
//     `https://sunbirdrc.dev/vc/skill/did.json`, plus the standard `.well-known/did.json` variants):
//     every path returns their frontend app's HTML shell (a client-side-routed SPA fallback), not a
//     DID document. This specific deployment does not publicly serve one.
//   - SunbirdRC's real Verify API (`POST {registry-url}/api/v1/verify`) is documented as needing a
//     Bearer access token against the REGISTRY OWNER'S OWN instance — it's for the issuer to verify
//     their own signed credentials, not for an outside relying party like this campus platform to
//     call over the public internet.
// Given that, we deliberately do NOT hand-roll Ed25519/JSON-LD signature verification ourselves —
// the actual crypto step (Linked Data Proofs canonicalization + detached-JWS verification) is easy
// to get subtly wrong, and a false "signature verified" is worse than an honest "couldn't check."
// If a future SunbirdRC deployment DOES publish a resolvable did:web document, this is the one place
// to wire in a real check — candidate: the `@sunbird-rc/verification-sdk` npm package (wraps Digital
// Bazaar's audited JSON-LD signature-suite libraries; installs cleanly, no native build). Until then,
// this adapter's strongest evidence is the cross-check against the platform's OWN roster record of
// who the student is — see verify() below — which needs no external key at all.

const issuerKey = 'sunbirdrc';

const SUNBIRD_ISSUER_PATTERN = /sunbirdrc|onwingspan/i;

function looksLikeSunbirdVc(vc) {
  if (!vc || typeof vc !== 'object') return false;
  const issuer = String(vc.issuer || '');
  const proofType = (vc.proof && vc.proof.type) || '';
  return SUNBIRD_ISSUER_PATTERN.test(issuer) && /Ed25519Signature/i.test(proofType);
}

function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ');
}

function nameTokens(s) {
  const n = normalizeName(s);
  return n ? n.split(' ') : [];
}

// Is `shorter` a subsequence of `longer` (same order, gaps allowed)? Lets "Raju Yadav" match
// "Gangaboina Raju Yadav" (a legitimate short form of the roster name) without letting an
// unrelated single shared token (e.g. just "Raju") count as a confident match on its own.
function isSubsequence(shorter, longer) {
  let i = 0;
  for (const tok of longer) {
    if (tok === shorter[i]) i += 1;
    if (i === shorter.length) return true;
  }
  return i === shorter.length;
}

// Returns 'exact' | 'partial' | 'ambiguous' | 'none'.
// - exact: full normalized strings match.
// - partial: the shorter name (>=2 tokens) is an in-order subsequence of the longer one — e.g. a
//   student uploading with "Raju Yadav" against a roster name of "Gangaboina Raju Yadav". Treated
//   as a real match, not a mismatch.
// - ambiguous: only a single shared token (e.g. just a first name) — too weak to confirm on its
//   own, but also not a confident mismatch, so this must NOT auto-reject (see verify() below).
// - none: no meaningful overlap — a genuine mismatch.
function compareNames(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 'none';
  if (ta.join(' ') === tb.join(' ')) return 'exact';
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (shorter.length >= 2 && isSubsequence(shorter, longer)) return 'partial';
  if (shorter.length === 1 && longer.includes(shorter[0])) return 'ambiguous';
  return 'none';
}

// context: { studentName } — the platform's own roster record of who uploaded this certificate.
// Cross-checking against the name embedded in the SIGNED payload is much stronger evidence than an
// OCR/text-layer guess, because it's exactly the data the issuer's signature covers (even though we
// can't verify the signature bytes ourselves — see header comment).
function verify(vc, context = {}) {
  const evidence = [];
  const subject = vc.credentialSubject || {};

  evidence.push({
    label: `Certificate carries a signed W3C Verifiable Credential (issuer: ${vc.issuer || 'unknown'}, signature: ${(vc.proof && vc.proof.type) || 'unknown'}) — decoded from the QR code, not just the printed page`,
    pass: true
  });

  evidence.push({
    label: `Signed payload states: recipient "${subject.issuedTo || '(missing)'}", course "${subject.course || '(missing)'}", completed ${subject.completedOn || '(missing)'}`,
    pass: Boolean(subject.issuedTo && subject.course)
  });

  let nameMismatch = false;
  let nameAmbiguous = false;
  let nameChecked = false;
  if (context.studentName && subject.issuedTo) {
    nameChecked = true;
    const result = compareNames(context.studentName, subject.issuedTo);
    nameMismatch = result === 'none';
    nameAmbiguous = result === 'ambiguous';
    const labels = {
      exact: `Recipient name in the signed credential matches this student's registered name ("${context.studentName}")`,
      partial: `Recipient name in the signed credential ("${subject.issuedTo}") is a partial/short form of this student's registered name ("${context.studentName}") — treated as a match`,
      ambiguous: `Recipient name in the signed credential ("${subject.issuedTo}") shares only a single name part with this student's registered name ("${context.studentName}") — too weak to confirm on its own, flagged for human attention`,
      none: `Recipient name in the signed credential ("${subject.issuedTo}") does NOT match this student's registered name ("${context.studentName}") — likely mismatch, needs human attention`
    };
    evidence.push({ label: labels[result], pass: result === 'exact' || result === 'partial' });
  } else {
    evidence.push({ label: 'Could not cross-check recipient name (student roster name or credential subject name unavailable)', pass: false });
  }

  evidence.push({
    label: 'Signature authenticity not cryptographically confirmed (see header comment for why) — this platform trusts the QR\'s decoded content plus the roster-name cross-check above as sufficient evidence, by product decision, not because the signature was actually checked',
    pass: true
  });

  // PRODUCT DECISION, 2026-09-28 (see memory.md section 19 for full reasoning/risk writeup — read
  // it before changing this again): auto-VERIFIED whenever the payload is a recognizable
  // SunbirdRC/Wingspan VC shape, course+date are present, AND the name check is 'exact' or
  // 'partial'. Explicitly requested by the project owner after being told the real risk: since the
  // Ed25519 signature is never actually checked (see header comment), this means ANY correctly-
  // shaped JSON with a matching name — not just a genuinely-issued one — will pass as VERIFIED. A
  // single-token ('ambiguous') name match is still NOT enough on its own — too weak, stays
  // NEEDS_REVIEW. A real mismatch ('none') still correctly returns NOT_FOUND. Do not silently
  // "fix" this back to NEEDS_REVIEW-always without the owner's say-so — it was a deliberate,
  // informed tradeoff, not an oversight.
  let status;
  if (nameMismatch) {
    status = 'NOT_FOUND';
  } else if (nameAmbiguous || !nameChecked) {
    status = 'NEEDS_REVIEW';
  } else if (subject.issuedTo && subject.course) {
    status = 'VERIFIED';
  } else {
    status = 'NEEDS_REVIEW';
  }

  return { status, evidence, issuerKey };
}

module.exports = { issuerKey, looksLikeSunbirdVc, verify, compareNames };
