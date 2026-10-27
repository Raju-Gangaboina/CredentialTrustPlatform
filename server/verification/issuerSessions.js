// One-time-login session bridge for issuers whose verification page requires being logged in
// (e.g. Saylor Academy's Moodle-based cert lookup — see webCheck.js INCONCLUSIVE_SIGNALS).
//
// How it works:
//   1. A faculty member logs into the issuer's site ONCE in their own real browser.
//   2. They copy that browser session's Cookie header (via DevTools) and paste it into the
//      faculty settings screen -> POST /api/issuer-sessions/:issuerKey.
//   3. We store that cookie string and attach it as a Cookie header on every future automated
//      fetch to that issuer's domain, so the verification page sees an authenticated request
//      instead of hitting its login wall.
//
// This is explicitly NOT a scripted/automated login (no password is ever stored here, and we
// never submit the issuer's login form programmatically) — it's a manual one-time bridge that a
// human deliberately sets up, using their own session, for their own institution's use. Sessions
// naturally expire (the issuer's site will log them out eventually); when that happens the
// checker will start seeing the login wall again and this module will flag the stored session as
// stale so a faculty member knows to refresh it. There is no way to detect "expired" without
// trying it, so staleness is only known after a real check comes back inconclusive again.
//
// IMPORTANT CAVEATS worth keeping in mind before relying on this for real:
//   - Whether this is allowed depends on the issuer's own Terms of Service — logging in as
//     yourself and letting automated requests reuse that session may or may not be permitted.
//     This module doesn't make that judgment call; a faculty member/admin should check Saylor's
//     (or any other issuer's) ToS before relying on this for anything beyond a manual test.
//   - The stored cookie is a real, live login session — treat it like a password. It's kept in
//     the local SQLite file, not encrypted at rest here; don't commit data.sqlite to source
//     control, and clear the session (DELETE /api/issuer-sessions/:issuerKey) if this machine is
//     shared or the faculty member's account access changes.
//   - Only ever attach the stored cookie to requests going TO that issuer's own known domain(s)
//     (see knownIssuers.js) — never send it anywhere else.
const db = require('../db/connection');

function getSession(issuerKey) {
  return db.prepare('SELECT * FROM issuer_sessions WHERE issuer_key = ?').get(issuerKey) || null;
}

function saveSession(issuerKey, cookie, facultyId) {
  db.prepare(`
    INSERT INTO issuer_sessions (issuer_key, cookie, saved_by_faculty_id, saved_at, last_check_ok, last_checked_at)
    VALUES (?, ?, ?, datetime('now'), NULL, NULL)
    ON CONFLICT(issuer_key) DO UPDATE SET
      cookie = excluded.cookie,
      saved_by_faculty_id = excluded.saved_by_faculty_id,
      saved_at = datetime('now'),
      last_check_ok = NULL,
      last_checked_at = NULL
  `).run(issuerKey, cookie, facultyId || null);
}

function clearSession(issuerKey) {
  db.prepare('DELETE FROM issuer_sessions WHERE issuer_key = ?').run(issuerKey);
}

function recordCheckResult(issuerKey, ok) {
  db.prepare(`
    UPDATE issuer_sessions SET last_check_ok = ?, last_checked_at = datetime('now')
    WHERE issuer_key = ?
  `).run(ok ? 1 : 0, issuerKey);
}

// Cookie string only — never returns/logs anything else about the session.
function getCookieHeader(issuerKey) {
  const row = getSession(issuerKey);
  return row ? row.cookie : null;
}

module.exports = { getSession, saveSession, clearSession, recordCheckResult, getCookieHeader };
