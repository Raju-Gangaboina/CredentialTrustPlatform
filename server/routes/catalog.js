const express = require('express');
const db = require('../db/connection');
const { requireFaculty } = require('./auth');

const router = express.Router();

// Public: list every course in the catalog (predefined SSDC programs + anything faculty added).
router.get('/programs', (req, res) => {
  const rows = db.prepare('SELECT * FROM catalog_programs ORDER BY name').all();
  res.json(rows);
});

// Public: a program's subjects, optionally filtered to one semester.
// Used by the "create class" screen to pre-fill subject checkboxes, and by anyone
// browsing what's available for a course.
router.get('/programs/:programId/subjects', (req, res) => {
  const programId = Number(req.params.programId);
  const program = db.prepare('SELECT * FROM catalog_programs WHERE id = ?').get(programId);
  if (!program) return res.status(404).json({ error: 'Course not found' });

  const semester = req.query.semester ? String(req.query.semester) : null;
  const rows = semester
    ? db.prepare('SELECT * FROM catalog_subjects WHERE program_id = ? AND semester = ? ORDER BY id').all(programId, semester)
    : db.prepare('SELECT * FROM catalog_subjects WHERE program_id = ? ORDER BY semester, id').all(programId);

  res.json({ program, subjects: rows });
});

// Faculty: add a brand-new course to the catalog (e.g. one SSDC offers that isn't listed yet).
router.post('/programs', requireFaculty, (req, res) => {
  const { name, totalSemesters, degreeType } = req.body;
  const cleanName = String(name || '').trim();
  const sems = Number(totalSemesters);
  if (!cleanName || !sems || sems < 1 || sems > 12) {
    return res.status(400).json({ error: 'name and a valid totalSemesters (1-12) are required' });
  }

  const existing = db.prepare('SELECT id FROM catalog_programs WHERE name = ?').get(cleanName);
  if (existing) return res.json({ ok: true, programId: existing.id, alreadyExisted: true });

  const info = db.prepare(`
    INSERT INTO catalog_programs (name, degree_type, total_semesters, note)
    VALUES (?, ?, ?, ?)
  `).run(cleanName, degreeType || 'UG', sems, 'Added by faculty from the app.');

  res.json({ ok: true, programId: Number(info.lastInsertRowid) });
});

// Faculty: add a subject to a course's semester — fills a gap in an unpublished course,
// or extends an existing one with a subject the syllabus page didn't list.
router.post('/programs/:programId/subjects', requireFaculty, (req, res) => {
  const programId = Number(req.params.programId);
  const semester = String(req.body.semester || '').trim();
  const subjectName = String(req.body.name || '').trim();
  if (!semester || !subjectName) return res.status(400).json({ error: 'semester and name are required' });

  const program = db.prepare('SELECT * FROM catalog_programs WHERE id = ?').get(programId);
  if (!program) return res.status(404).json({ error: 'Course not found' });

  const info = db.prepare(`
    INSERT OR IGNORE INTO catalog_subjects (program_id, semester, name) VALUES (?, ?, ?)
  `).run(programId, semester, subjectName);

  const row = db.prepare('SELECT * FROM catalog_subjects WHERE program_id = ? AND semester = ? AND name = ?').get(programId, semester, subjectName);
  res.json({ ok: true, added: info.changes > 0, subject: row });
});

module.exports = router;
