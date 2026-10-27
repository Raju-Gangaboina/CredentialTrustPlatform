// Known issuer domains — used ONLY to add confidence to a verification link that was actually
// found embedded in the document (printed text, PDF hyperlink annotation, or QR code). This file
// deliberately does NOT contain URL templates to construct a verify link from a guessed ID format —
// doing that would mean fetching a URL we invented rather than one the certificate itself provided,
// which breaks the "ask the issuer" premise and risks hammering an issuer's site with guesses.
//
// UPDATED 2026-09-27: domain lists now live in the issuer_registry DB table (verification_method =
// 'domain_link'), editable via the faculty issuer-admin UI (server/routes/issuers.js,
// public "Issuers" page) instead of only by hand-editing this file. STATIC_FALLBACK_DOMAINS below is
// kept as a baseline that's always active even on a fresh/empty DB (e.g. right after
// `npm run seed`, before anyone's added anything through the admin UI) — DB rows are added on top of
// it, never replace it. A faculty member CAN mark one of these inactive in the DB to suppress it
// (an explicit 'inactive' row for a key wins over the static fallback for that key).
const db = require('../db/connection');

const STATIC_FALLBACK_DOMAINS = {
  saylor: ['saylor.org', 'saylor.academy'],
  coursera: ['coursera.org'],
  edx: ['credentials.edx.org', 'edx.org'],
  udemy: ['udemy.com', 'ude.my'],
  hackerrank: ['hackerrank.com'],
  credly: ['credly.com'],
  nptel: ['nptel.ac.in', 'swayam.gov.in', 'examinations.nptel.ac.in'],
  google: ['coursera.org', 'grow.google'],
  freecodecamp: ['freecodecamp.org'],
  'linkedin-learning': ['linkedin.com'],
  cursa: ['cursa.app']
};

// Cached (not re-queried on every single link check within one verification run's tight loop) but
// cheap to invalidate — issuers.js calls invalidateDomainCache() after any add/edit so admin changes
// take effect on the very next certificate check, no server restart needed.
let cache = null;

function buildDomainMap() {
  const map = {};
  for (const [key, domains] of Object.entries(STATIC_FALLBACK_DOMAINS)) map[key] = [...domains];

  let rows = [];
  try {
    rows = db.prepare(`SELECT issuer_key, config_json, status FROM issuer_registry WHERE verification_method = 'domain_link'`).all();
  } catch {
    // issuer_registry table not present yet (e.g. schema not initialized in some standalone script) —
    // fall back to static-only rather than crashing link identification.
    return map;
  }

  for (const row of rows) {
    if (row.status === 'inactive') { delete map[row.issuer_key]; continue; }
    let config = {};
    try { config = JSON.parse(row.config_json || '{}'); } catch { config = {}; }
    if (Array.isArray(config.domains) && config.domains.length > 0) {
      map[row.issuer_key] = config.domains;
    }
  }
  return map;
}

function domainMap() {
  if (!cache) cache = buildDomainMap();
  return cache;
}

function invalidateDomainCache() {
  cache = null;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

// Returns the issuer key whose domain list contains this URL's host (suffix match, so
// "credentials.edx.org" matches an entry of "edx.org"), or null if unrecognized.
function identifyIssuerByDomain(url) {
  const host = hostnameOf(url);
  if (!host) return null;
  for (const [key, domains] of Object.entries(domainMap())) {
    for (const d of domains) {
      const dNorm = d.toLowerCase().replace(/^www\./, '');
      if (host === dNorm || host.endsWith('.' + dNorm)) return key;
    }
  }
  return null;
}

function listActiveIssuerKeys() {
  return Object.keys(domainMap());
}

module.exports = { identifyIssuerByDomain, hostnameOf, invalidateDomainCache, listActiveIssuerKeys, STATIC_FALLBACK_DOMAINS };
