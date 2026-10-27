const express = require('express');
const db = require('../db/connection');
const { requireAdmin } = require('./auth');

const router = express.Router();
router.use(requireAdmin); // every route in this file is admin-only

const LIST_SQL = `
  SELECT f.id, f.name, f.email, f.status, f.created_at, f.decided_at,
         (SELECT COUNT(*) FROM classes c WHERE c.faculty_id = f.id) AS class_count
  FROM faculty f
  WHERE f.role = 'faculty'
`;

// All teacher accounts, newest first. Optional ?status=pending|approved|rejected.
router.get('/faculty', (req, res) => {
  const status = String(req.query.status || '');
  const rows = ['pending', 'approved', 'rejected'].includes(status)
    ? db.prepare(`${LIST_SQL} AND f.status = ? ORDER BY f.id DESC`).all(status)
    : db.prepare(`${LIST_SQL} ORDER BY f.id DESC`).all();
  res.json(rows);
});

// approve = let them in (also re-approves a rejected sign-up); reject = refuse a pending sign-up or
// revoke an approved teacher. Revoking takes effect immediately: requireFaculty re-reads the status
// on every request, so an already-signed-in teacher is locked out on their next click.
function decide(newStatus) {
  return (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT id, role FROM faculty WHERE id = ?").get(id);
    if (!row || row.role !== 'faculty') return res.status(404).json({ error: 'Teacher account not found' });
    db.prepare("UPDATE faculty SET status = ?, decided_at = datetime('now') WHERE id = ?").run(newStatus, id);
    const updated = db.prepare(`${LIST_SQL} AND f.id = ?`).get(id);
    res.json({ ok: true, faculty: updated });
  };
}
router.post('/faculty/:id/approve', decide('approved'));
router.post('/faculty/:id/reject', decide('rejected'));

// Who teaches what. Every class with its subjects, the approved teachers on each subject, and how many
// certificates are waiting for review. A subject with no approved teacher is flagged `unassigned`: until
// someone takes it, only the class creator can review its certificates (db/access.js safety net), so the
// admin needs to see these. Read-only.
router.get('/teaching', (req, res) => {
  const classes = db.prepare(`
    SELECT c.id, c.program, c.year, c.section, c.academic_year, f.name AS creator
    FROM classes c LEFT JOIN faculty f ON f.id = c.faculty_id
    ORDER BY c.program, c.year, c.section, c.id
  `).all();
  const subjects = db.prepare(`
    SELECT s.id, s.class_id, s.name,
      (SELECT COUNT(*) FROM certificates ce WHERE ce.subject_id = s.id AND ce.status IN ('NEEDS_REVIEW', 'NOT_FOUND') AND ce.faculty_decision IS NULL) AS waiting
    FROM subjects s ORDER BY s.id
  `).all();
  const teachers = db.prepare(`
    SELECT t.subject_id, f.name FROM teaching t JOIN faculty f ON f.id = t.faculty_id
    WHERE f.status = 'approved' AND f.role = 'faculty' ORDER BY f.name
  `).all();

  const teachersBySubject = new Map();
  for (const t of teachers) {
    if (!teachersBySubject.has(t.subject_id)) teachersBySubject.set(t.subject_id, []);
    teachersBySubject.get(t.subject_id).push(t.name);
  }
  const subjectsByClass = new Map();
  let unassigned = 0, waitingUnassigned = 0;
  for (const s of subjects) {
    const names = teachersBySubject.get(s.id) || [];
    if (names.length === 0) { unassigned++; waitingUnassigned += s.waiting; }
    if (!subjectsByClass.has(s.class_id)) subjectsByClass.set(s.class_id, []);
    subjectsByClass.get(s.class_id).push({ id: s.id, name: s.name, teachers: names, waiting: s.waiting, unassigned: names.length === 0 });
  }

  res.json({
    summary: { classes: classes.length, subjects: subjects.length, unassigned, waitingUnassigned },
    classes: classes.map((c) => ({ ...c, subjects: subjectsByClass.get(c.id) || [] }))
  });
});

module.exports = router;
