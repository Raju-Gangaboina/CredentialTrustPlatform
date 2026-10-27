const express = require('express');
const db = require('../db/connection');
const { requireFaculty } = require('./auth');

const router = express.Router();
router.use(requireFaculty); // approved teachers only

// Every class with its subjects, flagged with which ones THIS teacher already teaches (`mine`) and how many
// other teachers teach each (`others`). Only class names and subject names are exposed here — never a
// roster, student or certificate — so a teacher can find the class + subjects they teach and pick them.
router.get('/classes', (req, res) => {
  const f = req.session.facultyId;
  const classes = db.prepare('SELECT id, program, year, section, academic_year FROM classes ORDER BY program, year, section, id').all();
  const subjects = db.prepare(`
    SELECT s.id, s.class_id, s.name,
           EXISTS (SELECT 1 FROM teaching t WHERE t.subject_id = s.id AND t.faculty_id = ?) AS mine,
           (SELECT COUNT(*) FROM teaching t JOIN faculty fa ON fa.id = t.faculty_id
             WHERE t.subject_id = s.id AND t.faculty_id <> ? AND fa.status = 'approved') AS others
    FROM subjects s ORDER BY s.id
  `).all(f, f);

  const byClass = new Map();
  for (const s of subjects) {
    if (!byClass.has(s.class_id)) byClass.set(s.class_id, []);
    byClass.get(s.class_id).push({ id: s.id, name: s.name, mine: !!s.mine, others: s.others });
  }
  res.json(classes.map((c) => ({ ...c, subjects: byClass.get(c.id) || [] })));
});

// Set EXACTLY which subjects of one class this teacher teaches. Send [] to stop teaching in the class.
// Only subjects that belong to that class are accepted, so one request can't touch another class.
router.put('/class/:classId', (req, res) => {
  const f = req.session.facultyId;
  const classId = Number(req.params.classId);
  const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const ids = Array.isArray(req.body.subjectIds) ? req.body.subjectIds.map(Number) : null;
  if (!ids || ids.some((n) => !Number.isInteger(n))) return res.status(400).json({ error: 'subjectIds must be a list of subject ids' });

  const inClass = new Set(db.prepare('SELECT id FROM subjects WHERE class_id = ?').all(classId).map((r) => r.id));
  if (ids.some((n) => !inClass.has(n))) return res.status(400).json({ error: 'One of those subjects does not belong to this class' });

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM teaching WHERE faculty_id = ? AND subject_id IN (SELECT id FROM subjects WHERE class_id = ?)').run(f, classId);
    const ins = db.prepare('INSERT OR IGNORE INTO teaching (faculty_id, subject_id) VALUES (?, ?)');
    for (const id of new Set(ids)) ins.run(f, id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Could not save your subjects' });
  }
  res.json({ ok: true, count: new Set(ids).size });
});

// Add a subject that is missing from a class (e.g. the default list didn't include it) and mark it as
// taught by this teacher. If a subject with that name already exists in the class (any capitalisation),
// that one is reused instead of creating a duplicate vault.
router.post('/class/:classId/subjects', (req, res) => {
  const f = req.session.facultyId;
  const classId = Number(req.params.classId);
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'Enter a subject name (up to 120 characters)' });
  const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  let subject = db.prepare('SELECT id, name FROM subjects WHERE class_id = ? AND lower(name) = lower(?)').get(classId, name);
  const existed = !!subject;
  if (!subject) {
    const info = db.prepare('INSERT INTO subjects (class_id, name) VALUES (?, ?)').run(classId, name);
    subject = { id: Number(info.lastInsertRowid), name };
  }
  db.prepare('INSERT OR IGNORE INTO teaching (faculty_id, subject_id) VALUES (?, ?)').run(f, subject.id);
  res.json({ ok: true, existed, subject });
});

module.exports = router;
