// Issuer admin — lets faculty view/add/update entries in issuer_registry without hand-editing
// seedIssuers.js. Two kinds of issuer live in this one table, distinguished by verification_method:
//
//   - 'domain_link' issuers (the common case — Coursera, edX, NPTEL, etc, and now anything faculty
//     add here): config_json holds { domains: [...] }. These feed knownIssuers.js's
//     identifyIssuerByDomain(), which is what the generic link-checking path in registry.js uses to
//     decide "recognized domain -> can reach VERIFIED" vs "unrecognized domain -> caps at
//     NEEDS_REVIEW even on a text match" (see registry.js's header comment for why that distinction
//     matters). Adding a domain_link issuer here has a REAL effect on live verification outcomes —
//     it is not just a cosmetic list.
//   - Adapter-backed issuers (currently only 'saylor', verification_method 'certificate_id_pattern'):
//     the actual verification logic lives in code (server/verification/adapters/saylor.js), which
//     reads this table only for config_json.id_pattern and to confirm the issuer has been
//     "approved" (registry.js refuses to run an adapter with no matching issuer_registry row - see
//     its NEEDS_REVIEW "not yet registered" branch). This admin UI can edit an adapter issuer's
//     display name / status / id_pattern, but cannot create a brand-new adapter from scratch — that
//     still needs a new file in adapters/ and a code change to registry.js's ADAPTERS array. Say so
//     plainly in the UI rather than pretending otherwise.
//
// status: 'active' | 'inactive'. Inactive issuers are excluded from identifyIssuerByDomain() and
// left out of the ADAPTERS-config lookup path used above — a faculty member can disable an issuer
// without deleting its history/config.
const express = require('express');
const db = require('../db/connection');
const { requireFaculty } = require('./auth');
const { invalidateDomainCache, identifyIssuerByDomain, STATIC_FALLBACK_DOMAINS } = require('../verification/knownIssuers');

const router = express.Router();

const ADAPTER_ISSUER_KEYS = new Set(['saylor']); // keys with real code in verification/adapters/

// The issuer key is an internal, permanent label (certificates and adapters refer to it), so people no longer
// type it: it is made from the display name ("Infosys Wingspan" -> "infosys-wingspan"). If that is taken, or
// belongs to a built-in issuer (the static baseline list or one with adapter code), a number is added
// ("-2", "-3", ...). Reusing a built-in key would silently replace its domains, so those are off limits.
function makeIssuerKey(displayName) {
  const base = String(displayName || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40).replace(/-+$/, '');
  if (!base) return null;
  const taken = (k) => ADAPTER_ISSUER_KEYS.has(k) || Object.prototype.hasOwnProperty.call(STATIC_FALLBACK_DOMAINS, k)
    || !!db.prepare('SELECT 1 FROM issuer_registry WHERE issuer_key = ?').get(k);
  let key = base;
  for (let n = 2; taken(key); n++) key = `${base}-${n}`;
  return key;
}

function parseConfig(row) {
  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch { config = {}; }
  return {
    id: row.id,
    issuerKey: row.issuer_key,
    displayName: row.display_name,
    officialDomain: row.official_domain,
    verificationMethod: row.verification_method,
    status: row.status,
    domains: Array.isArray(config.domains) ? config.domains : [],
    // Websites built into the code for this issuer (knownIssuers.js baseline). Shown read-only so an adapter-backed
    // issuer such as Saylor does not look like it recognises nothing.
    builtInDomains: STATIC_FALLBACK_DOMAINS[row.issuer_key] || [],
    aliases: Array.isArray(config.aliases) ? config.aliases.filter((a) => typeof a === 'string') : [],
    idPattern: config.id_pattern || null,
    hasAdapterCode: ADAPTER_ISSUER_KEYS.has(row.issuer_key)
  };
}

// Typeahead for the student upload form (also usable by teachers). Any signed-in student or teacher may call it.
// It returns ONLY { key, name } of ACTIVE issuers: never domains, patterns or other config. Matching is
// done in this order of preference: name/alias starts with the text, a WORD in it starts with the text,
// then (3+ letters only) the text appears anywhere. Fewer than 2 letters returns nothing.
router.get('/suggest', (req, res) => {
  if (!req.session.studentId && !req.session.facultyId) return res.status(401).json({ error: 'Login required' });
  const q = String(req.query.q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
  if (q.length < 2) return res.json([]);

  const rows = db.prepare("SELECT issuer_key, display_name, config_json FROM issuer_registry WHERE status = 'active'").all();
  const hits = [];
  for (const r of rows) {
    let aliases = [];
    try {
      const cfg = JSON.parse(r.config_json || '{}');
      if (Array.isArray(cfg.aliases)) aliases = cfg.aliases.filter((a) => typeof a === 'string');
    } catch { /* bad config_json: just match on the name */ }

    // Ranking, best first. With only 2 letters typed, the display name and whole aliases/keys can match
    // from their start, but a word buried inside an alias cannot (otherwise "sp" would list "Certiport"
    // because of its alias "microsoft office specialist").
    const display = r.display_name.toLowerCase();
    const others = [r.issuer_key.replace(/-/g, ' '), ...aliases].map((s) => s.toLowerCase());
    const wordsOf = (s) => s.split(/[^a-z0-9+]+/);
    let score = 0;
    if (display.startsWith(q)) score = 5;
    else if (others.some((n) => n.startsWith(q))) score = 4;
    else if (wordsOf(display).some((w) => w.startsWith(q))) score = 3;
    else if (q.length >= 3 && others.some((n) => wordsOf(n).some((w) => w.startsWith(q)))) score = 2;
    else if (q.length >= 3 && (display.includes(q) || others.some((n) => n.includes(q)))) score = 1;
    if (score > 0) hits.push({ score, key: r.issuer_key, name: r.display_name });
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  res.json(hits.slice(0, 8).map(({ key, name }) => ({ key, name })));
});

router.get('/', requireFaculty, (req, res) => {
  const rows = db.prepare('SELECT * FROM issuer_registry ORDER BY display_name').all();
  res.json(rows.map(parseConfig));
});

// Create a new domain_link issuer (the kind this UI can fully create — see header comment).
// The key is generated from the display name (makeIssuerKey above). A caller may still send an explicit
// issuerKey (old clients / scripts); it is validated exactly as before.
router.post('/', requireFaculty, (req, res) => {
  const { displayName, domains } = req.body;
  if (!displayName || !String(displayName).trim()) return res.status(400).json({ error: 'A display name is required' });
  let issuerKey = req.body.issuerKey ? String(req.body.issuerKey) : null;
  if (issuerKey && !/^[a-z0-9-]+$/.test(issuerKey)) return res.status(400).json({ error: 'issuerKey must be lowercase letters, numbers, hyphens only (used as a code identifier)' });
  if (!issuerKey) {
    issuerKey = makeIssuerKey(displayName);
    if (!issuerKey) return res.status(400).json({ error: 'The display name needs at least one letter or number' });
  }
  const domainList = String(domains || '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  if (domainList.length === 0) return res.status(400).json({ error: 'At least one domain is required, e.g. "coursera.org"' });

  // A website that is already recognised (by a built-in issuer or one added earlier) needs no second entry: it would
  // only create a duplicate card and a duplicate name in the student's dropdown.
  for (const d of domainList) {
    const owner = identifyIssuerByDomain(`https://${d}/`);
    if (owner) {
      const row = db.prepare('SELECT display_name FROM issuer_registry WHERE issuer_key = ?').get(owner);
      return res.status(409).json({ error: `${d} is already recognised as ${row ? row.display_name : owner}. No need to add it again.` });
    }
  }

  const existing = db.prepare('SELECT id FROM issuer_registry WHERE issuer_key = ?').get(issuerKey);
  if (existing) return res.status(409).json({ error: `Issuer key "${issuerKey}" already exists` });

  db.prepare(`
    INSERT INTO issuer_registry (issuer_key, display_name, official_domain, verification_method, config_json, status)
    VALUES (?, ?, ?, 'domain_link', ?, 'active')
  `).run(issuerKey, String(displayName).trim(), domainList[0], JSON.stringify({ domains: domainList }));

  invalidateDomainCache();
  res.json({ ok: true, issuerKey });
});

// Update an existing issuer: display name, domain list (domain_link issuers), status, and — for
// adapter-backed issuers only — the id_pattern their code reads out of config_json.
router.put('/:issuerKey', requireFaculty, (req, res) => {
  const { issuerKey } = req.params;
  const row = db.prepare('SELECT * FROM issuer_registry WHERE issuer_key = ?').get(issuerKey);
  if (!row) return res.status(404).json({ error: 'Issuer not found' });

  let config = {};
  try { config = JSON.parse(row.config_json || '{}'); } catch { config = {}; }

  const { displayName, domains, idPattern, status } = req.body;
  const newDisplayName = displayName !== undefined ? displayName : row.display_name;
  const newStatus = status !== undefined ? status : row.status;
  if (newStatus !== 'active' && newStatus !== 'inactive') {
    return res.status(400).json({ error: 'status must be "active" or "inactive"' });
  }

  let newOfficialDomain = row.official_domain;
  if (row.verification_method === 'domain_link' && domains !== undefined) {
    const domainList = String(domains)
      .split(',')
      .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .filter(Boolean);
    if (domainList.length === 0) return res.status(400).json({ error: 'At least one domain is required' });
    config.domains = domainList;
    newOfficialDomain = domainList[0];
  }
  if (ADAPTER_ISSUER_KEYS.has(issuerKey) && idPattern !== undefined) {
    config.id_pattern = idPattern;
  }

  db.prepare(`
    UPDATE issuer_registry SET display_name = ?, official_domain = ?, config_json = ?, status = ?
    WHERE issuer_key = ?
  `).run(newDisplayName, newOfficialDomain, JSON.stringify(config), newStatus, issuerKey);

  invalidateDomainCache();
  res.json({ ok: true });
});

module.exports = router;
