const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const db = require('../db/connection');
const { requireFaculty, requireStudent } = require('./auth');
const { accessibleClass, visibleSubjects } = require('../db/access');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'rosters') });

const DEFAULT_SUBJECTS = ['Data Structures', 'Operating Systems', 'DBMS', 'Computer Networks', 'Mathematics'];

// Create a class + auto-generate its subject vaults. The creator is NOT automatically assigned to every
// subject: they pick the ones they actually teach afterwards (routes/teaching.js), because in a real
// college each teacher takes only some subjects of a class.
router.post('/', requireFaculty, (req, res) => {
  const { program, year, section, academicYear, subjects } = req.body;
  if (!program || !year || !section || !academicYear) {
    return res.status(400).json({ error: 'program, year, section, academicYear are required' });
  }

  const info = db.prepare(`
    INSERT INTO classes (faculty_id, program, year, section, academic_year)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.session.facultyId, program, year, section, academicYear);

  const classId = Number(info.lastInsertRowid);
  const requested = (Array.isArray(subjects) && subjects.length > 0) ? subjects : DEFAULT_SUBJECTS;
  const seen = new Set();
  const subjectList = [];
  for (const raw of requested) { // trim + de-duplicate (case-insensitive)
    const name = String(raw || '').trim();
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); subjectList.push(name); }
  }
  const insertSubject = db.prepare('INSERT INTO subjects (class_id, name) VALUES (?, ?)');
  for (const s of subjectList) insertSubject.run(classId, s);

  res.json({ ok: true, classId, subjects: subjectList });
});

// Classes this teacher can see: ones they created, plus ones where they teach a subject. Each comes with
// `mySubjects` = the names of the subjects they teach in it.
router.get('/', requireFaculty, (req, res) => {
  const f = req.session.facultyId;
  const classes = db.prepare(`
    SELECT c.* FROM classes c
    WHERE c.faculty_id = ?
       OR EXISTS (SELECT 1 FROM teaching t JOIN subjects s ON s.id = t.subject_id WHERE t.faculty_id = ? AND s.class_id = c.id)
    ORDER BY c.id DESC
  `).all(f, f);
  const taught = db.prepare(`
    SELECT s.name FROM teaching t JOIN subjects s ON s.id = t.subject_id
    WHERE t.faculty_id = ? AND s.class_id = ? ORDER BY s.id
  `);
  const rows = classes.map((c) => ({ ...c, mySubjects: taught.all(f, c.id).map((r) => r.name) }));
  res.json(rows);
});

// PUBLIC (no login required): search classes by name so students don't have to know a raw numeric
// ID. Returns only non-sensitive identifying fields — no roster, no faculty info.
// Tokenized AND match across all fields combined, so a query spanning multiple fields (e.g. the
// full displayed label "Program — Semester 5 — Section A") still matches, not just single-field text.
router.get('/public/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const tokens = q.toLowerCase().split(/[\s\-\u2013\u2014/,()]+/).filter(Boolean);
  if (tokens.length === 0) return res.json([]);

  const rows = db.prepare('SELECT id, program, year, section, academic_year FROM classes ORDER BY id DESC').all();
  const matches = rows.filter(r => {
    const haystack = `${r.program} ${r.year} ${r.section} ${r.academic_year}`.toLowerCase();
    return tokens.every(t => haystack.includes(t));
  }).slice(0, 20);

  res.json(matches);
});

// Student: their own class + its full subject list (so students see every vault, not just
// the subjects they've already uploaded a certificate into).
router.get('/mine', requireStudent, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.session.studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(student.class_id);
  const subjects = db.prepare('SELECT * FROM subjects WHERE class_id = ? ORDER BY id').all(student.class_id);

  res.json({ class: cls, subjects });
});

// Header matching for roster spreadsheets: colleges name these columns all sorts of ways
// ("Roll Number", "Student Name", "Reg No", "Full Name", etc). Match loosely rather than
// requiring an exact "roll_number"/"name" header, since that's what real uploads look like.
function normalizeHeader(k) {
  return String(k).toLowerCase().replace(/[\s_]/g, '');
}
function findRollKey(keys) {
  return keys.find(k => {
    const n = normalizeHeader(k);
    return n === 'rollnumber' || n === 'rollno' || n === 'regno' || n === 'registrationnumber' || n === 'rollnum' || n === 'id';
  });
}
function findNameKey(keys) {
  return keys.find(k => normalizeHeader(k).includes('name'));
}

// Roster upload: validates the sheet, reports issues, creates student rows (unactivated).
// Accepts flexible headers (see findRollKey/findNameKey above) — case/spacing/wording insensitive.
// Allowed for anyone with access to the class (creator, or a teacher who teaches a subject in it).
router.post('/:classId/roster', requireFaculty, upload.single('roster'), (req, res) => {
  const classId = Number(req.params.classId);
  const cls = accessibleClass(req.session.facultyId, classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: roster)' });

  const workbook = XLSX.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) {
    return res.json({ ok: true, totalRows: 0, validRows: 0, created: 0, skippedAsDuplicateInDb: 0, errors: ['Sheet appears to be empty, or the header row could not be read.'] });
  }

  const headerKeys = Object.keys(rows[0]);
  const rollKey = findRollKey(headerKeys);
  const nameKey = findNameKey(headerKeys);

  if (!rollKey || !nameKey) {
    return res.json({
      ok: true, totalRows: rows.length, validRows: 0, created: 0, skippedAsDuplicateInDb: 0,
      errors: [
        `Could not find the expected columns in the sheet. Found headers: ${headerKeys.join(', ')}.`,
        `Looking for a roll-number-like column${rollKey ? ` (found: "${rollKey}")` : ' (none matched)'} and a name-like column${nameKey ? ` (found: "${nameKey}")` : ' (none matched)'}.`
      ]
    });
  }

  const normalized = rows.map(r => ({
    roll_number: String(r[rollKey]).trim(),
    name: String(r[nameKey]).trim()
  }));

  const errors = [];
  const seen = new Set();
  const valid = [];
  normalized.forEach((r, idx) => {
    const rowNum = idx + 2; // account for header row
    if (!r.roll_number) { errors.push(`Row ${rowNum}: missing roll number`); return; }
    if (!r.name) { errors.push(`Row ${rowNum}: missing name`); return; }
    if (seen.has(r.roll_number)) { errors.push(`Row ${rowNum}: duplicate roll number ${r.roll_number}`); return; }
    seen.add(r.roll_number);
    valid.push(r);
  });

  const insertStudent = db.prepare(`
    INSERT OR IGNORE INTO students (class_id, roll_number, name, activated)
    VALUES (?, ?, ?, 0)
  `);
  let created = 0;
  for (const r of valid) {
    const info = insertStudent.run(classId, r.roll_number, r.name);
    if (info.changes > 0) created++;
  }

  res.json({
    ok: true,
    totalRows: rows.length,
    validRows: valid.length,
    created,
    skippedAsDuplicateInDb: valid.length - created,
    errors,
    matchedColumns: { rollKey, nameKey }
  });
});

// Class detail: ONLY the subjects this teacher may see (see db/access.js) + the class-wide roster.
router.get('/:classId', requireFaculty, (req, res) => {
  const classId = Number(req.params.classId);
  const cls = accessibleClass(req.session.facultyId, classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const subjects = visibleSubjects(req.session.facultyId, classId);
  const total = db.prepare('SELECT COUNT(*) AS n FROM subjects WHERE class_id = ?').get(classId).n;
  const students = db.prepare('SELECT id, roll_number, name, activated, activation_requested_at FROM students WHERE class_id = ? ORDER BY roll_number').all(classId)
    // `state` is what the roster shows: ACTIVE | WAITING (set a password, needs a teacher's approval) | NOT_ACTIVATED.
    // The password hash is never selected here.
    .map(({ activation_requested_at, ...s }) => ({
      ...s,
      state: s.activated ? 'ACTIVE' : activation_requested_at ? 'WAITING' : 'NOT_ACTIVATED',
      requested_at: s.activated ? null : activation_requested_at,
    }));

  res.json({ class: cls, subjects, otherSubjectCount: total - subjects.length, students });
});

// Teacher: decide on a student's account. Allowed for anyone with access to the class (same rule as the roster).
//   APPROVE : a student who set a password via "First time" may now sign in.
//   REJECT  : not the right person: the request and its password are thrown away, the roll number is free again.
//   RESET   : an already-active (or waiting) account is wiped back to "not activated" (forgotten password, or someone
//             else claimed it). Anyone currently signed in as that student is cut off at once (auth.js requireStudent).
// The student's certificates are untouched by all three.
router.post('/:classId/students/:studentId/account', requireFaculty, (req, res) => {
  const classId = Number(req.params.classId);
  const studentId = Number(req.params.studentId);
  const { decision } = req.body || {};
  if (!['APPROVE', 'REJECT', 'RESET'].includes(decision)) return res.status(400).json({ error: 'decision must be APPROVE, REJECT or RESET' });
  if (!accessibleClass(req.session.facultyId, classId)) return res.status(404).json({ error: 'Class not found' });

  const s = db.prepare('SELECT id, activated, password_hash, activation_requested_at FROM students WHERE id = ? AND class_id = ?').get(studentId, classId);
  if (!s) return res.status(404).json({ error: 'Student not found in this class' });
  const waiting = !s.activated && !!s.activation_requested_at && !!s.password_hash;

  if (decision === 'APPROVE') {
    if (!waiting) return res.status(400).json({ error: 'This student has no request waiting for approval' });
    db.prepare('UPDATE students SET activated = 1, activation_requested_at = NULL WHERE id = ?').run(studentId);
  } else if (decision === 'REJECT') {
    if (!waiting) return res.status(400).json({ error: 'This student has no request waiting for approval' });
    db.prepare('UPDATE students SET password_hash = NULL, activation_requested_at = NULL WHERE id = ?').run(studentId);
  } else {
    db.prepare('UPDATE students SET password_hash = NULL, activated = 0, activation_requested_at = NULL WHERE id = ?').run(studentId);
  }
  res.json({ ok: true });
});

module.exports = router;
