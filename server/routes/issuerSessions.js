// Faculty-only endpoints for the one-time-login session bridge (see
// server/verification/issuerSessions.js for the full explanation and caveats).
//
// Flow for the faculty member:
//   1. Log into the issuer's site (e.g. saylor.org) in their own normal browser, once.
//   2. Open DevTools -> Network tab -> reload -> click any request to that site -> copy the
//      "Cookie" request header value.
//   3. Paste it here: POST /api/issuer-sessions/:issuerKey  { "cookie": "...pasted value..." }
//
// Never returns the stored cookie value itself in any response - only whether one exists and
// whether it last worked - so it can't leak back out through this API once saved.
const express = require('express');
const { requireFaculty } = require('./auth');
const { getSession, saveSession, clearSession } = require('../verification/issuerSessions');
const { listActiveIssuerKeys } = require('../verification/knownIssuers');

const router = express.Router();

router.get('/', requireFaculty, (req, res) => {
  const statuses = listActiveIssuerKeys().map(issuerKey => {
    const row = getSession(issuerKey);
    return {
      issuerKey,
      hasSession: Boolean(row),
      savedAt: row ? row.saved_at : null,
      lastCheckOk: row ? (row.last_check_ok === null ? null : Boolean(row.last_check_ok)) : null,
      lastCheckedAt: row ? row.last_checked_at : null
    };
  });
  res.json({ issuers: statuses });
});

router.post('/:issuerKey', requireFaculty, (req, res) => {
  const { issuerKey } = req.params;
  const { cookie } = req.body || {};
  if (!listActiveIssuerKeys().includes(issuerKey)) {
    return res.status(400).json({ error: `Unknown issuer key '${issuerKey}'` });
  }
  if (!cookie || typeof cookie !== 'string' || cookie.trim().length < 5) {
    return res.status(400).json({ error: 'Missing or implausibly short cookie value' });
  }
  saveSession(issuerKey, cookie.trim(), req.session.facultyId);
  res.json({ ok: true, issuerKey });
});

router.delete('/:issuerKey', requireFaculty, (req, res) => {
  clearSession(req.params.issuerKey);
  res.json({ ok: true });
});

module.exports = router;
