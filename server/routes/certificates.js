const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/connection');
const { requireStudent, requireFaculty } = require('./auth');
const { subjectVisibility, accessibleClass, canReviewCertificate } = require('../db/access');
const { extractFromFile } = require('../verification/extractor');
const { runVerification, unverifiablePlatformName, collectUnrecognizedHosts } = require('../verification/registry');
const { identifyIssuerByDomain, invalidateDomainCache } = require('../verification/knownIssuers');
const { checkProvenance, applyProvenanceCap } = require('../verification/provenance');
const { detectForwardedCopy } = require('../verification/copyDetection');
const { UDEMY_ID_RE, parseSnippet, judge } = require('../verification/udemyProof');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads', 'certificates');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${unique}${path.extname(file.originalname)}`);
  }
});
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return cb(new Error(`Unsupported file type: ${ext || '(none)'}. Upload a PDF or an image (png/jpg/webp/bmp).`));
    cb(null, true);
  }
});

// ---------------------------------------------------------------------------------------------------
// STUDENT-BLIND DESIGN (decided with the project owner, 2026-10-03)
//
// A student never sees ANY automated verification result: not Verified, not Needs review, not the
// evidence, not the extracted fields, not the "this looks like a forwarded copy" warning. If they could,
// they could upload a fake, see it get flagged, delete it and upload the original, and nobody would ever
// notice; a "Verified" badge would also let a forger keep tweaking a fake until it passes.
//
// So the student only ever gets:
//   * SUBMITTED : everything is "submitted" until a teacher acts
//   * APPROVED / RESUBMIT (+ the teacher's own note) : a HUMAN decision, set only by POST /:certId/review
// Teachers see everything (status, evidence, and the full upload history of that student + subject).
// "Delete" is now a soft WITHDRAW: the row, file and evidence stay so the teacher can see it.
//
// RULE FOR FUTURE EDITS: student routes must pick explicit columns (see studentView). Never `SELECT c.*`
// or formatCert() in a route a student can call, or the automated result leaks again.
// ---------------------------------------------------------------------------------------------------

// Limits. With no feedback to probe there is little to abuse, so these just stop flooding and churn.
// A teacher's RESUBMIT request never counts against the student.
const MAX_UPLOADS_PER_SUBJECT = 10;      // all uploads incl. withdrawn ones (+1 for each teacher RESUBMIT)
const MAX_WITHDRAWALS_PER_SUBJECT = 3;   // withdrawals the student chose themselves

// A certificate the teacher still has to act on. NOT_FOUND is included on purpose: the student is told
// nothing automatically, so an auto-NOT_FOUND must reach a teacher or it would sit forever.
const NEEDS_TEACHER_SQL = "(c.faculty_decision IS NULL AND c.status IN ('NEEDS_REVIEW', 'NOT_FOUND'))";

// Anything still PENDING when the server starts was cut off by a restart (checks now run in the
// background after the upload response). Hand it to a teacher rather than leave it spinning.
db.prepare("UPDATE certificates SET status = 'NEEDS_REVIEW', evidence_json = ? WHERE status = 'PENDING'")
  .run(JSON.stringify([{ label: 'Processing was interrupted (the server restarted before the checks finished). Needs a manual look.', pass: false }]));

function discardFile(file) {
  if (file && file.path) fs.unlink(file.path, () => {});
}

// Student uploads a certificate into a subject vault. The response is immediate and says nothing about
// the outcome; extraction + verification run in the background (processCertificate below).
router.post('/subject/:subjectId', requireStudent, upload.single('certificate'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: certificate)' });
  const subjectId = Number(req.params.subjectId);

  const subject = db.prepare('SELECT s.*, c.id as class_id FROM subjects s JOIN classes c ON s.class_id = c.id WHERE s.id = ?').get(subjectId);
  if (!subject) { discardFile(req.file); return res.status(404).json({ error: 'Subject vault not found' }); }

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.session.studentId);
  if (!student || student.class_id !== subject.class_id) {
    discardFile(req.file);
    return res.status(403).json({ error: 'Student does not belong to this class/vault' });
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM certificates WHERE student_id = ? AND subject_id = ?').get(student.id, subjectId).n;
  const grants = db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE student_id = ? AND subject_id = ? AND faculty_decision = 'RESUBMIT'").get(student.id, subjectId).n;
  if (total >= MAX_UPLOADS_PER_SUBJECT + grants) {
    discardFile(req.file);
    return res.status(429).json({ error: 'You have reached the upload limit for this subject. Please talk to your faculty.' });
  }

  // Optional: the issuer/platform the student picked or typed. ADVISORY ONLY. It is shown to the teacher as
  // "Student says: ..." and is never read by verification and never changes a status (a student can type anything).
  const claimedIssuer = String(req.body.issuerName || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || null;

  const insertInfo = db.prepare(`
    INSERT INTO certificates (student_id, subject_id, original_filename, stored_filename, status, claimed_issuer)
    VALUES (?, ?, ?, ?, 'PENDING', ?)
  `).run(student.id, subjectId, req.file.originalname, req.file.filename, claimedIssuer);
  const certId = Number(insertInfo.lastInsertRowid);

  res.json({ ok: true, certificateId: certId, state: 'SUBMITTED' });

  processCertificate(certId, req.file, student).catch((err) => {
    console.error('processCertificate crashed for certificate', certId, err);
  });
});

// The real pipeline, run AFTER the student has already been answered. Never throws to the caller: any
// failure just routes the certificate to a teacher as NEEDS_REVIEW with the reason in the evidence.
async function processCertificate(certId, file, student, leadEvidence = []) {
  try {
    // Layer 0: Content Credentials (C2PA) provenance check on the raw file. A threat here does not
    // stop the pipeline (the other layers still run) but caps the final status at NEEDS_REVIEW.
    // See verification/provenance.js. Never throws; a failure just means no extra evidence.
    let provenance = { threat: false, evidence: [] };
    try { provenance = await checkProvenance(file.path); }
    catch (provErr) { console.warn('Provenance check failed (ignored):', provErr.message); }

    const extraction = await extractFromFile(file.path, { studentName: student.name });
    const verification = await runVerification(extraction, { studentName: student.name });

    const finalStatus = applyProvenanceCap(verification.status, provenance);
    // Soft upload check: file name looks like a WhatsApp/Telegram/screenshot copy. Evidence only (teacher
    // side); never changes status or blocks the upload. See verification/copyDetection.js.
    const copyNote = detectForwardedCopy(file.originalname);
    const evidence = [...leadEvidence, ...provenance.evidence, ...(copyNote ? [copyNote.evidence] : []), ...verification.evidence];
    // Worst case, said plainly: a platform nobody can ask (Scaler, ExcelR) AND a file that is a screenshot / WhatsApp
    // copy. The issuer cannot be asked, and the copy has lost the hidden label that reveals AI-made images, so no
    // automatic check could have caught a fake here. Evidence only: never changes status, never reaches the student.
    if (copyNote && unverifiablePlatformName(verification.issuerKey)) {
      evidence.unshift({
        label: `Extra care needed: this ${unverifiablePlatformName(verification.issuerKey)} file looks like a ${copyNote.kind} copy. ${unverifiablePlatformName(verification.issuerKey)} certificates cannot be checked with the issuer, and a copy loses the hidden data that reveals AI-made images, so nothing automatic could have caught a fake here. Ask the student for the original download.`,
        pass: false
      });
    }

    db.prepare(`
      UPDATE certificates
      SET extracted_json = ?, issuer_key = ?, status = ?, evidence_json = ?, link_hosts_json = ?
      WHERE id = ?
    `).run(
      JSON.stringify(extraction.fields),
      verification.issuerKey,
      finalStatus,
      JSON.stringify(evidence),
      JSON.stringify(verification.unrecognizedHosts || []),
      certId
    );
  } catch (err) {
    db.prepare('UPDATE certificates SET status = ?, evidence_json = ? WHERE id = ?')
      .run('NEEDS_REVIEW', JSON.stringify([{ label: `Processing error: ${err.message}`, pass: false }]), certId);
  }
}

// Student: list own certificates. Explicit columns only (see the STUDENT-BLIND note above).
router.get('/mine', requireStudent, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.subject_id, c.original_filename, c.uploaded_at, c.faculty_decision, c.faculty_note,
           sub.name AS subject_name
    FROM certificates c
    JOIN subjects sub ON c.subject_id = sub.id
    WHERE c.student_id = ? AND c.withdrawn_at IS NULL
    ORDER BY c.uploaded_at DESC, c.id DESC
  `).all(req.session.studentId);
  res.json(rows.map(studentView));
});

// The ONLY shape a student ever receives for a certificate.
function studentView(row) {
  const state = row.faculty_decision === 'APPROVED' ? 'APPROVED'
    : row.faculty_decision === 'RESUBMIT' ? 'RESUBMIT'
    : 'SUBMITTED';
  return {
    id: row.id,
    subject_id: row.subject_id,
    subject_name: row.subject_name,
    original_filename: row.original_filename,
    uploaded_at: row.uploaded_at,
    state,
    note: state === 'RESUBMIT' ? (row.faculty_note || null) : null,   // the teacher's own words, nothing automated
    canWithdraw: state !== 'APPROVED',
  };
}

// Student: withdraw one of their own uploads (wrong file, duplicate, or a teacher asked for a new one).
// SOFT: the row, the stored file and the evidence are kept so the teacher still sees it and can see it was
// replaced. (This used to hard-delete, which let a student erase a flagged fake without a trace.)
router.delete('/:certId', requireStudent, (req, res) => {
  const certId = Number(req.params.certId);
  const cert = db.prepare('SELECT * FROM certificates WHERE id = ? AND student_id = ? AND withdrawn_at IS NULL').get(certId, req.session.studentId);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  if (cert.faculty_decision === 'APPROVED') {
    return res.status(409).json({ error: 'Your faculty has approved this certificate, so it can\'t be withdrawn. Ask them if something is wrong.' });
  }
  // Withdrawals a teacher asked for (RESUBMIT) are free; only ones the student chose count toward the cap.
  if (cert.faculty_decision !== 'RESUBMIT') {
    const used = db.prepare(`
      SELECT COUNT(*) AS n FROM certificates
      WHERE student_id = ? AND subject_id = ? AND withdrawn_at IS NOT NULL
        AND (faculty_decision IS NULL OR faculty_decision != 'RESUBMIT')
    `).get(req.session.studentId, cert.subject_id).n;
    if (used >= MAX_WITHDRAWALS_PER_SUBJECT) {
      return res.status(429).json({ error: 'You have withdrawn the maximum number of uploads for this subject. Please talk to your faculty.' });
    }
  }
  db.prepare("UPDATE certificates SET withdrawn_at = datetime('now') WHERE id = ?").run(certId);
  res.json({ ok: true });
});

// Faculty: submit what Udemy's own page shows for a certificate number (sent by the bookmarklet in
// public/udemy-proof.html, from the faculty member's browser). Compares Udemy's recipient name with
// every certificate in the SUBJECTS THIS TEACHER MAY SEE (db/access.js) that carries that number, and
// updates them. Certificates in other teachers' subjects are never touched.
router.post('/udemy-proof', requireFaculty, (req, res) => {
  const { udemyId, snippet } = req.body || {};
  if (!udemyId || !UDEMY_ID_RE.test(udemyId)) return res.status(400).json({ error: 'Not a valid Udemy certificate number (UC-...)' });
  if (typeof snippet !== 'string' || snippet.length > 4000) return res.status(400).json({ error: 'Missing or oversized page snippet' });

  const { recipientName, courseTitle } = parseSnippet(snippet);
  if (!recipientName) return res.status(422).json({ error: 'Could not find the "Certificate Recipient" name on that page' });

  const vis = subjectVisibility(req.session.facultyId);
  const rows = db.prepare(`
    SELECT c.*, s.name AS student_name, s.roll_number
    FROM certificates c
    JOIN students s ON c.student_id = s.id
    JOIN subjects sub ON sub.id = c.subject_id
    JOIN classes cl ON cl.id = sub.class_id
    WHERE c.extracted_json LIKE ? AND ${vis.sql}
  `).all(`%${udemyId}%`, ...vis.params);

  const results = rows.map((row) => {
    const extracted = row.extracted_json ? JSON.parse(row.extracted_json) : {};
    const verdict = judge({ udemyName: recipientName, certName: extracted.recipientName, studentName: row.student_name });
    const evidence = JSON.parse(row.evidence_json || '[]');
    evidence.push({ label: `Udemy's own page for ${udemyId} (checked in a faculty browser): recipient "${recipientName}"${courseTitle ? `, course "${courseTitle}"` : ''}`, pass: true });
    evidence.push(...verdict.evidence);
    const decided = verdict.status !== 'NEEDS_REVIEW';
    db.prepare('UPDATE certificates SET status = ?, evidence_json = ?, reviewed_by_faculty = ? WHERE id = ?')
      .run(verdict.status, JSON.stringify(evidence), decided ? 1 : 0, row.id);
    return { certId: row.id, studentName: row.student_name, rollNumber: row.roll_number, certificateName: extracted.recipientName || null, status: verdict.status };
  });

  res.json({ udemyId, udemyRecipient: recipientName, udemyCourse: courseTitle, matched: results.length, results });
});

// Faculty: the worklist for a class: certificates a teacher still has to act on (NEEDS_REVIEW or NOT_FOUND,
// no teacher decision yet), including ones the student has already withdrawn (those are tagged `withdrawn`).
// Each item carries the student's full upload history for that subject. Only subjects this teacher may see.
router.get('/review-queue/:classId', requireFaculty, (req, res) => {
  const classId = Number(req.params.classId);
  const cls = accessibleClass(req.session.facultyId, classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const vis = subjectVisibility(req.session.facultyId);
  const rows = db.prepare(`
    SELECT c.*, s.name as student_name, s.roll_number, sub.name as subject_name
    FROM certificates c
    JOIN students s ON c.student_id = s.id
    JOIN subjects sub ON c.subject_id = sub.id
    JOIN classes cl ON cl.id = sub.class_id
    WHERE s.class_id = ? AND ${NEEDS_TEACHER_SQL} AND ${vis.sql}
    ORDER BY c.uploaded_at ASC, c.id ASC
  `).all(classId, ...vis.params);

  const attemptsStmt = db.prepare(`
    SELECT id, original_filename, uploaded_at, status, withdrawn_at, faculty_decision
    FROM certificates WHERE student_id = ? AND subject_id = ? ORDER BY id
  `);
  res.json(rows.map((row) => queueItem(row, attemptsStmt.all(row.student_id, row.subject_id))));
});

// An earlier upload counts as "flagged, then withdrawn" when the student withdrew it while it was
// NEEDS_REVIEW / NOT_FOUND and no teacher had asked them to redo it (a teacher's RESUBMIT makes the
// replacement expected, not suspicious). A teacher merely dismissing it does not clear the flag.
function wasFlaggedThenWithdrawn(a) {
  return !!a.withdrawn_at
    && (a.status === 'NEEDS_REVIEW' || a.status === 'NOT_FOUND')
    && (a.faculty_decision === null || a.faculty_decision === 'DISMISSED');
}

function queueItem(row, attempts) {
  return {
    ...formatCert(row),
    withdrawn: !!row.withdrawn_at,
    // Websites on this certificate that are still not on the trusted list (offered as "Trust this website").
    // Re-checked against the live list on every read, so the button disappears the moment a site is trusted.
    unrecognizedHosts: row.withdrawn_at ? [] : unlistedHostsOf(row),
    replacedAfterFlag: attempts.some((a) => a.id < row.id && wasFlaggedThenWithdrawn(a)),
    history: attempts.filter((a) => a.id !== row.id).map((a) => ({
      id: a.id,
      filename: a.original_filename,
      uploaded_at: a.uploaded_at,
      status: a.status,
      withdrawn: !!a.withdrawn_at,
      faculty_decision: a.faculty_decision,
      when: a.id < row.id ? 'earlier' : 'later',
    })),
  };
}

// Faculty: act on a worklist item. This is the ONLY place a student's APPROVED / RESUBMIT state is set.
//   VERIFIED  -> student sees "Approved"
//   NOT_FOUND -> student sees "Resubmit" plus the teacher's note (and gets one extra upload allowance)
//   DISMISS   -> only for an upload the student already withdrew: the teacher has seen it, so it leaves the
//                worklist; the student is told nothing and the "flagged then withdrawn" history is kept.
// Only a teacher who may see that certificate's subject can decide it.
router.post('/:certId/review', requireFaculty, (req, res) => {
  const certId = Number(req.params.certId);
  const { decision, note } = req.body || {};
  if (!['VERIFIED', 'NOT_FOUND', 'DISMISS'].includes(decision)) return res.status(400).json({ error: 'decision must be VERIFIED, NOT_FOUND or DISMISS' });

  const cert = db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  if (!canReviewCertificate(req.session.facultyId, certId)) {
    return res.status(403).json({ error: 'This certificate is in a subject you do not teach' });
  }
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 300) : '';
  const evidence = JSON.parse(cert.evidence_json || '[]');

  if (decision === 'DISMISS') {
    if (!cert.withdrawn_at) return res.status(400).json({ error: 'Only an upload the student has withdrawn can be dismissed. Mark it verified or not found instead.' });
    evidence.push({ label: 'Faculty acknowledged this upload after the student withdrew it', pass: null });
    db.prepare("UPDATE certificates SET faculty_decision = 'DISMISSED', reviewed_by_faculty = 1, evidence_json = ? WHERE id = ?")
      .run(JSON.stringify(evidence), certId);
    return res.json({ ok: true });
  }

  evidence.push({ label: `Faculty manual review: ${cleanNote || 'no note'}`, pass: decision === 'VERIFIED' });
  db.prepare(`
    UPDATE certificates
    SET status = ?, evidence_json = ?, reviewed_by_faculty = 1, faculty_decision = ?, faculty_note = ?
    WHERE id = ?
  `).run(
    decision,
    JSON.stringify(evidence),
    decision === 'VERIFIED' ? 'APPROVED' : 'RESUBMIT',
    decision === 'NOT_FOUND' && cleanNote ? cleanNote : null,
    certId
  );

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------------
// "TRUST THIS WEBSITE" (teacher button in the review queue)
//
// When a certificate points to a website that is not on the trusted issuer list, a text-confirmed match can
// only ever reach NEEDS_REVIEW (see verification/registry.js). The teacher can fix that for good with one click:
//   1. the website name comes from the certificate itself (certificates.link_hosts_json), exactly as printed, so
//      the teacher never types a domain and the server only accepts a host that is really on THIS certificate;
//   2. it is saved as a normal 'domain_link' issuer (same table the Issuers page edits, so it can be renamed or
//      deactivated there later);
//   3. every certificate still waiting that carries the same website is re-checked straight away.
// Trusting a site is a judgement call, so a short list of places ANYONE can publish a page (file-sharing, link
// shorteners, free site builders) is refused: a student could put a fake "verification page" there.
// ---------------------------------------------------------------------------------------------------
const OPEN_PUBLISHING_HOSTS = [
  'drive.google.com', 'docs.google.com', 'sites.google.com', 'googleusercontent.com', 'dropbox.com', 'onedrive.live.com',
  '1drv.ms', 'sharepoint.com', 'box.com', 'wetransfer.com', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'rebrand.ly',
  'cutt.ly', 'linktr.ee', 'github.io', 'githubusercontent.com', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev',
  'herokuapp.com', 'web.app', 'firebaseapp.com', 'glitch.me', 'repl.co', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com',
  'wixsite.com', 'weebly.com', 'blogspot.com', 'wordpress.com', 'notion.site', 'canva.com', '000webhostapp.com',
];
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function hostIsUnder(host, domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '');
  return !!d && (host === d || host.endsWith('.' + d));
}

// null = fine to trust, otherwise the plain-words reason it is not.
function untrustableReason(host) {
  if (!HOSTNAME_RE.test(host) || /^[0-9.]+$/.test(host)) return 'This is not a normal website name.';
  const open = OPEN_PUBLISHING_HOSTS.find((d) => hostIsUnder(host, d));
  return open ? `Anyone can publish a page on ${open}, so it cannot be trusted as an issuer's own website.` : null;
}

function parseHosts(row) {
  try {
    const v = JSON.parse(row.link_hosts_json || '[]');
    return Array.isArray(v) ? v.filter((h) => typeof h === 'string') : [];
  } catch { return []; }
}

// What the review queue shows: hosts on this certificate that are STILL not on the trusted list.
function unlistedHostsOf(row) {
  return parseHosts(row)
    .filter((h) => !identifyIssuerByDomain(`https://${h}/`))
    .map((h) => ({ host: h, blocked: untrustableReason(h) }));
}

const trustRechecksRunning = new Set();

// Re-run the whole pipeline for every certificate still waiting on a teacher that carries this website.
// Waiting = same definition as the worklist (no teacher decision yet, not withdrawn, NEEDS_REVIEW / NOT_FOUND).
async function recheckWaitingFrom(host) {
  const rows = db.prepare(`
    SELECT c.*, s.name AS student_name
    FROM certificates c JOIN students s ON s.id = c.student_id
    WHERE c.faculty_decision IS NULL AND c.withdrawn_at IS NULL
      AND c.status IN ('NEEDS_REVIEW', 'NOT_FOUND') AND c.link_hosts_json IS NOT NULL
    ORDER BY c.id
  `).all().filter((r) => parseHosts(r).includes(host));

  let verified = 0, stillWaiting = 0;
  for (const r of rows) {
    const file = { path: path.join(uploadDir, r.stored_filename), originalname: r.original_filename };
    if (!fs.existsSync(file.path)) { stillWaiting++; continue; }   // file gone: leave the old evidence untouched
    await processCertificate(r.id, file, { name: r.student_name },
      [{ label: `Re-checked automatically after a teacher chose to trust ${host}`, pass: null }]);
    const after = db.prepare('SELECT status, faculty_decision FROM certificates WHERE id = ?').get(r.id);
    if (after.status === 'VERIFIED') verified++; else stillWaiting++;
  }
  return { rechecked: rows.length, verified, stillWaiting };
}

router.post('/:certId/trust-host', requireFaculty, async (req, res) => {
  const certId = Number(req.params.certId);
  const host = String((req.body || {}).host || '').trim().toLowerCase();

  const cert = db.prepare('SELECT * FROM certificates WHERE id = ?').get(certId);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  if (!canReviewCertificate(req.session.facultyId, certId)) {
    return res.status(403).json({ error: 'This certificate is in a subject you do not teach' });
  }
  // Already trusted (e.g. another tab or teacher clicked first): nothing to save, nothing waiting to re-check.
  if (host && identifyIssuerByDomain(`https://${host}/`)) {
    return res.json({ ok: true, host, alreadyTrusted: true, rechecked: 0, verified: 0, stillWaiting: 0 });
  }
  if (!host || !parseHosts(cert).includes(host)) {
    return res.status(400).json({ error: 'That website is not on this certificate' });
  }
  const reason = untrustableReason(host);
  if (reason) return res.status(400).json({ error: reason });
  if (trustRechecksRunning.has(host)) return res.status(409).json({ error: 'Already checking certificates from this website. Give it a moment.' });

  trustRechecksRunning.add(host);
  try {
    if (!identifyIssuerByDomain(`https://${host}/`)) {
      const key = 'trusted-' + host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      // If a teacher deliberately DEACTIVATED an issuer that covers this website, one click must not undo that.
      // (Re-trusting this button's own entry is fine: that is exactly what the click means.)
      const { STATIC_FALLBACK_DOMAINS } = require('../verification/knownIssuers');
      const switchedOff = db.prepare("SELECT issuer_key, display_name, config_json FROM issuer_registry WHERE verification_method = 'domain_link' AND status = 'inactive'").all()
        .find((r) => {
          let domains = [];
          try { domains = JSON.parse(r.config_json || '{}').domains || []; } catch { /* bad config: ignore */ }
          return r.issuer_key !== key && [...domains, ...(STATIC_FALLBACK_DOMAINS[r.issuer_key] || [])].some((d) => hostIsUnder(host, d));
        });
      if (switchedOff) {
        return res.status(409).json({ error: `${switchedOff.display_name} covers this website but is switched off. Turn it back on from the Issuers page instead.` });
      }

      const existing = db.prepare('SELECT * FROM issuer_registry WHERE issuer_key = ?').get(key);
      if (existing) {
        let config = {};
        try { config = JSON.parse(existing.config_json || '{}'); } catch { config = {}; }
        const domains = Array.isArray(config.domains) ? config.domains : [];
        if (!domains.includes(host)) domains.push(host);
        config.domains = domains;
        db.prepare("UPDATE issuer_registry SET config_json = ?, status = 'active' WHERE issuer_key = ?").run(JSON.stringify(config), key);
      } else {
        db.prepare(`
          INSERT INTO issuer_registry (issuer_key, display_name, official_domain, verification_method, config_json, status)
          VALUES (?, ?, ?, 'domain_link', ?, 'active')
        `).run(key, host, host, JSON.stringify({ domains: [host], trusted_from_certificate: certId }));
      }
      invalidateDomainCache();
    }

    const result = await recheckWaitingFrom(host);
    res.json({ ok: true, host, ...result });
  } finally {
    trustRechecksRunning.delete(host);
  }
});

// Certificates checked before link_hosts_json existed have no website list yet, so their button could not show.
// Fill it in once, quietly, after the server starts: waiting certificates only, and no status or evidence is touched.
// Rows whose old evidence never mentions an unrecognized domain need no file work at all.
async function backfillLinkHosts() {
  db.prepare(`
    UPDATE certificates SET link_hosts_json = '[]'
    WHERE link_hosts_json IS NULL AND status IN ('NEEDS_REVIEW', 'NOT_FOUND')
      AND COALESCE(evidence_json, '') NOT LIKE '%[unrecognized domain]%'
  `).run();
  const rows = db.prepare(`
    SELECT c.id, c.stored_filename, s.name AS student_name
    FROM certificates c JOIN students s ON s.id = c.student_id
    WHERE c.link_hosts_json IS NULL AND c.status IN ('NEEDS_REVIEW', 'NOT_FOUND') ORDER BY c.id
  `).all();
  for (const r of rows) {
    try {
      const fp = path.join(uploadDir, r.stored_filename);
      if (!fs.existsSync(fp)) continue;
      const extraction = await extractFromFile(fp, { studentName: r.student_name });
      db.prepare('UPDATE certificates SET link_hosts_json = ? WHERE id = ?')
        .run(JSON.stringify(collectUnrecognizedHosts(extraction.links || [])), r.id);
    } catch (err) {
      console.warn('Could not list websites for certificate', r.id, '(will retry next start):', err.message);
    }
  }
}
const backfillTimer = setTimeout(() => {
  backfillLinkHosts().catch((err) => console.warn('Website backfill failed (ignored):', err.message));
}, 3000);
if (backfillTimer.unref) backfillTimer.unref();

// Faculty: dashboard stats for a class (overall + per-subject heatmap) — only subjects this teacher may see.
router.get('/stats/:classId', requireFaculty, (req, res) => {
  const classId = Number(req.params.classId);
  const cls = accessibleClass(req.session.facultyId, classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const vis = subjectVisibility(req.session.facultyId);
  const overall = db.prepare(`
    SELECT c.status, COUNT(*) as n FROM certificates c
    JOIN students s ON c.student_id = s.id
    JOIN subjects sub ON c.subject_id = sub.id
    JOIN classes cl ON cl.id = sub.class_id
    WHERE s.class_id = ? AND c.withdrawn_at IS NULL AND ${vis.sql} GROUP BY c.status
  `).all(classId, ...vis.params);

  const perSubject = db.prepare(`
    SELECT sub.name as subject_name, c.status, COUNT(*) as n
    FROM certificates c
    JOIN students s ON c.student_id = s.id
    JOIN subjects sub ON c.subject_id = sub.id
    JOIN classes cl ON cl.id = sub.class_id
    WHERE s.class_id = ? AND c.withdrawn_at IS NULL AND ${vis.sql} GROUP BY sub.name, c.status
  `).all(classId, ...vis.params);

  const studentCount = db.prepare('SELECT COUNT(*) as n FROM students WHERE class_id = ?').get(classId).n;

  res.json({ studentCount, overall, perSubject });
});

function formatCert(row) {
  return {
    ...row,
    extracted: row.extracted_json ? JSON.parse(row.extracted_json) : null,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null
  };
}

module.exports = router;
