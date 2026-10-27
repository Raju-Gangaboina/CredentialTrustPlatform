// Seeds issuer_registry with well-known certificate issuers.
//   - Called automatically on every server start (server/index.js), so a fresh database is never empty.
//   - Also runnable standalone: npm run seed
//
// SAFE TO RE-RUN. Rows are INSERT OR IGNORE keyed on issuer_key, so nothing an admin has edited (domains,
// display name, active/inactive) is ever overwritten. The one exception is `aliases`: if an existing row
// has none yet, ours are filled in, because aliases only power the student typeahead.
//
// Two kinds of row (see routes/issuers.js for the long explanation):
//   - 'domain_link'            : a list of the issuer's OWN domains. A verification link embedded in a
//                                certificate that points at one of these (suffix match, so "verify.x.com"
//                                matches "x.com") is "recognised" and may reach VERIFIED when the text also
//                                matches. Only first-party domains belong here. Job boards, social networks,
//                                code hosts and the like are deliberately left out, because anyone can
//                                put a page of their own on them.
//   - 'certificate_id_pattern' : issuers with real adapter code in server/verification/adapters/ (saylor, cursa).
//
// `aliases` : extra words that should also make the issuer show up in the student typeahead
//             (abbreviations, old names, common misspellings). They never affect verification.
const db = require('./connection');
const { initSchema } = require('./schema');

// WHICH DOMAINS MAY AUTO-VERIFY. A "recognised" website is only as trustworthy as the least controlled page on
// it: company sites also host forums, public profiles and user articles, and a student could put a page there
// that repeats their own name and certificate ID. So only these keys get their domains switched on:
//   - the ones that were already trusted before (static list in verification/knownIssuers.js), unchanged, and
//   - infosys-springboard, whose verification host (verify.onwingspan.com) is printed on real certificates.
// Every other issuer below is NAME-ONLY for now (empty domain list): it still appears in the student dropdown, but
// links to its site are not treated as proof. A domain is added later, on purpose, once a teacher has seen a real
// certificate and confirmed the exact verification website (the "Trust this website" step).
const TRUSTED_DOMAIN_KEYS = new Set([
  'infosys-springboard', 'nptel', 'coursera', 'edx', 'udemy', 'freecodecamp', 'linkedin-learning', 'hackerrank', 'credly'
]);

function domainIssuer(key, name, domains, aliases = []) {
  return {
    issuer_key: key,
    display_name: name,
    official_domain: domains[0],
    verification_method: 'domain_link',
    config: { domains: TRUSTED_DOMAIN_KEYS.has(key) ? domains : [], aliases }
  };
}

const ISSUERS = [
  // ---- Issuers with real adapter code ----
  {
    issuer_key: 'saylor',
    display_name: 'Saylor Academy',
    official_domain: 'saylor.org',
    verification_method: 'certificate_id_pattern',
    config: {
      // Saylor certificate IDs follow a pattern like "2164168379RD" (10 digits + 2 initials).
      // NOTE: Saylor does not currently expose a public lookup API we can call programmatically.
      // Until a real endpoint is confirmed, this adapter validates ID *format* and flags the cert
      // NEEDS_REVIEW rather than falsely claiming VERIFIED. See memory.md section 7.
      id_pattern: '^\\d{10}[A-Z]{2}$',
      aliases: ['sailor', 'saylor.org', 'saylor academy']
    }
  },
  {
    issuer_key: 'cursa',
    display_name: 'Cursa',
    official_domain: 'cursa.app',
    verification_method: 'certificate_id_pattern',
    config: {
      // Cursa (2026+ certificates) doesn't expose a documented lookup API either, but its
      // "Check" button's own client-side logic just tests whether a matching object exists in
      // its public S3 bucket (cursacertificates.s3.amazonaws.com) — confirmed live, 2026-09-28.
      // That check needs no ID-format assumption, so no id_pattern here; see adapters/cursa.js.
      domains: ['cursa.app'],
      aliases: ['cursa.app']
    }
  },

  // ---- India: platforms students most often bring certificates from ----
  // Infosys Springboard certificates say "To verify, scan the QR code at https://verify.onwingspan.com".
  domainIssuer('infosys-springboard', 'Infosys Springboard', ['onwingspan.com'], ['infosys', 'wingspan', 'infytq', 'spring board']),
  domainIssuer('nptel', 'NPTEL / SWAYAM', ['nptel.ac.in', 'swayam.gov.in', 'examinations.nptel.ac.in'], ['swayam', 'nptel swayam']),
  domainIssuer('scaler', 'Scaler', ['scaler.com'], ['scaler academy', 'scaler school of technology']),
  domainIssuer('excelr', 'ExcelR', ['excelr.com'], ['excel r', 'excelr solutions']),
  domainIssuer('simplilearn', 'Simplilearn', ['simplilearn.com'], ['simpli learn']),
  domainIssuer('great-learning', 'Great Learning', ['mygreatlearning.com', 'greatlearning.in'], ['greatlearning', 'mygreatlearning', 'great lakes']),
  domainIssuer('upgrad', 'upGrad', ['upgrad.com'], ['up grad']),
  domainIssuer('coding-ninjas', 'Coding Ninjas (Naukri Code360)', ['codingninjas.com'], ['code360', 'naukri code360']),
  domainIssuer('geeksforgeeks', 'GeeksforGeeks', ['geeksforgeeks.org'], ['gfg', 'geeks for geeks']),
  domainIssuer('edureka', 'Edureka', ['edureka.co']),
  domainIssuer('intellipaat', 'Intellipaat', ['intellipaat.com']),
  domainIssuer('guvi', 'GUVI', ['guvi.in'], ['hcl guvi', 'guvi geek networks']),
  domainIssuer('internshala', 'Internshala Trainings', ['internshala.com'], ['internshala trainings']),
  domainIssuer('unstop', 'Unstop', ['unstop.com'], ['dare2compete']),
  domainIssuer('tcs-ion', 'TCS iON', ['tcsion.com'], ['tcs', 'tcs ion']),
  domainIssuer('wipro', 'Wipro TalentNext', ['wipro.com'], ['talentnext', 'wipro talentnext']),
  domainIssuer('nasscom', 'NASSCOM FutureSkills Prime', ['futureskillsprime.in'], ['nasscom', 'future skills prime', 'futureskills']),
  domainIssuer('skill-india', 'Skill India / NSDC', ['skillindiadigital.gov.in', 'nsdcindia.org', 'msde.gov.in'], ['nsdc', 'skill india digital', 'msde']),

  // ---- Global course platforms ----
  domainIssuer('coursera', 'Coursera', ['coursera.org']),
  domainIssuer('edx', 'edX', ['credentials.edx.org', 'edx.org']),
  domainIssuer('udemy', 'Udemy', ['udemy.com', 'ude.my']),
  domainIssuer('udacity', 'Udacity', ['udacity.com']),
  domainIssuer('datacamp', 'DataCamp', ['datacamp.com'], ['data camp']),
  domainIssuer('codecademy', 'Codecademy', ['codecademy.com']),
  domainIssuer('kaggle', 'Kaggle', ['kaggle.com'], ['kaggle learn']),
  domainIssuer('pluralsight', 'Pluralsight', ['pluralsight.com']),
  domainIssuer('futurelearn', 'FutureLearn', ['futurelearn.com']),
  domainIssuer('alison', 'Alison', ['alison.com']),
  domainIssuer('freecodecamp', 'freeCodeCamp', ['freecodecamp.org'], ['fcc', 'free code camp']),
  domainIssuer('linkedin-learning', 'LinkedIn Learning', ['linkedin.com'], ['lynda']),
  domainIssuer('hackerrank', 'HackerRank', ['hackerrank.com'], ['hacker rank']),
  domainIssuer('hubspot', 'HubSpot Academy', ['hubspot.com']),

  // ---- Company / vendor certifications ----
  // IBM digital badges are usually issued through Credly (below); IBM's own sites are listed here.
  domainIssuer('ibm', 'IBM SkillsBuild', ['ibm.com', 'skillsbuild.org'], ['ibm', 'skills build', 'ibm digital badge']),
  domainIssuer('microsoft', 'Microsoft Learn', ['microsoft.com'], ['azure', 'ms learn', 'microsoft azure', 'microsoft certified']),
  domainIssuer('aws', 'AWS Training & Certification', ['aws.amazon.com', 'skillbuilder.aws'], ['amazon web services', 'aws skill builder', 'amazon']),
  domainIssuer('google-cloud', 'Google Cloud Skills Boost', ['cloudskillsboost.google', 'skills.google', 'cloud.google.com'], ['gcp', 'google cloud', 'qwiklabs']),
  domainIssuer('oracle', 'Oracle University', ['oracle.com'], ['oci', 'oracle certified', 'java certification']),
  domainIssuer('cisco', 'Cisco Networking Academy', ['netacad.com', 'cisco.com'], ['ccna', 'netacad', 'cisco']),
  domainIssuer('salesforce', 'Salesforce Trailhead', ['salesforce.com'], ['trailhead', 'trailblazer']),
  domainIssuer('red-hat', 'Red Hat', ['redhat.com'], ['rhce', 'rhcsa']),
  domainIssuer('mongodb', 'MongoDB University', ['mongodb.com'], ['mongo']),
  domainIssuer('uipath', 'UiPath Academy', ['uipath.com'], ['ui path', 'rpa']),
  domainIssuer('fortinet', 'Fortinet', ['fortinet.com'], ['nse']),
  domainIssuer('comptia', 'CompTIA', ['comptia.org'], ['comp tia']),

  // ---- Digital-credential platforms (issuers publish their certificates through these) ----
  domainIssuer('credly', 'Credly', ['credly.com'], ['acclaim', 'digital badge']),
  domainIssuer('accredible', 'Accredible', ['accredible.com', 'credential.net'], ['credential.net']),
  domainIssuer('certiport', 'Certiport', ['certiport.com'], ['microsoft office specialist'])
];

function seedIssuers() {
  initSchema();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO issuer_registry (issuer_key, display_name, official_domain, verification_method, config_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getConfig = db.prepare('SELECT config_json FROM issuer_registry WHERE issuer_key = ?');
  const setConfig = db.prepare('UPDATE issuer_registry SET config_json = ? WHERE issuer_key = ?');

  let added = 0;
  for (const iss of ISSUERS) {
    const info = insert.run(iss.issuer_key, iss.display_name, iss.official_domain, iss.verification_method, JSON.stringify(iss.config));
    if (info.changes > 0) { added++; continue; }

    // Row already exists: leave everything alone except filling in missing aliases.
    if (!Array.isArray(iss.config.aliases) || iss.config.aliases.length === 0) continue;
    const row = getConfig.get(iss.issuer_key);
    let config = {};
    try { config = JSON.parse((row && row.config_json) || '{}'); } catch { config = {}; }
    if (!Array.isArray(config.aliases)) {
      config.aliases = iss.config.aliases;
      setConfig.run(JSON.stringify(config), iss.issuer_key);
    }
  }
  return { total: ISSUERS.length, added };
}

module.exports = { seedIssuers };

if (require.main === module) {
  const { total, added } = seedIssuers();
  console.log(`Issuer seed complete: ${total} issuer(s) checked, ${added} new.`);
}
