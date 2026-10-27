// Logic for the "Udemy proof" flow: a faculty member opens the Udemy certificate page in their OWN
// browser (which Udemy serves normally — scripts get HTTP 403), clicks the bookmarklet from
// public/udemy-proof.html, and it sends the page's text snippet here. We read the recipient name
// Udemy holds for that certificate number and compare it with the uploaded certificate.
//
// Trust note: the snippet comes from the faculty member's browser, so this is as trustworthy as the
// faculty member — the same trust already placed in the manual review button. It is NOT evidence a
// student can supply (the route is faculty-only).

const { compareNames } = require('./adapters/udemy');

const UDEMY_ID_RE = /^UC-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const INITIALS_ONLY = /^[A-Z]{1,3}$/; // Udemy shows an avatar with initials just above the name

// snippet = page text starting at "Certificate Recipient". Lines (from innerText) look like:
//   Certificate Recipient:
//   AG                       <- avatar initials (optional)
//   ALLURI ABHIRAM GOUD
//   About the Course:
//   AI for Cyber Security : Threat Detection, SOC Automation
function parseSnippet(snippet) {
  const lines = String(snippet || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^certificate recipient/i.test(l));
  if (start < 0) return { recipientName: null, courseTitle: null };

  let recipientName = null;
  let i = start + 1;
  for (; i < lines.length; i++) {
    if (/^about the course/i.test(lines[i])) break;
    if (INITIALS_ONLY.test(lines[i])) continue;
    recipientName = lines[i];
    break;
  }

  let courseTitle = null;
  const about = lines.findIndex((l) => /^about the course/i.test(l));
  if (about >= 0) {
    for (let j = about + 1; j < lines.length; j++) {
      if (lines[j].length >= 8) { courseTitle = lines[j]; break; }
    }
  }
  return { recipientName, courseTitle };
}

// Turns Udemy's name + the names we hold into a verdict.
//   NOT_FOUND    : Udemy's name shares no words with the certificate or student name -> issued to someone else
//   VERIFIED     : every name we hold matches Udemy's exactly (ignoring case/accents/word order)
//   NEEDS_REVIEW : partial overlap (middle names, initials) — a human decides
function judge({ udemyName, certName, studentName }) {
  const checks = [];
  if (certName) checks.push({ what: 'the name printed on the uploaded certificate', value: certName });
  if (studentName) checks.push({ what: "the student's registered name", value: studentName });
  if (!checks.length) return { status: 'NEEDS_REVIEW', evidence: [{ label: 'No name available to compare with Udemy\'s record', pass: false }] };

  const evidence = [];
  let worst = 'same';
  for (const c of checks) {
    const r = compareNames(udemyName, c.value);
    if (r === 'different') worst = 'different';
    else if (r !== 'same' && worst !== 'different') worst = 'overlap';
    evidence.push({
      label: r === 'same'
        ? `Udemy's recipient name matches ${c.what} (${c.value})`
        : r === 'different'
          ? `Udemy's recipient name (${udemyName}) does NOT match ${c.what} (${c.value}) — this certificate number was issued to someone else`
          : `Udemy's recipient name (${udemyName}) only partly matches ${c.what} (${c.value})`,
      pass: r === 'same'
    });
  }
  const status = worst === 'different' ? 'NOT_FOUND' : worst === 'overlap' ? 'NEEDS_REVIEW' : 'VERIFIED';
  return { status, evidence };
}

module.exports = { UDEMY_ID_RE, parseSnippet, judge };
