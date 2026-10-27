const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/connection');

const router = express.Router();

const MIN_PASSWORD = 8;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---- Faculty signup/login ----
// Teacher accounts are NOT usable right after signup: they start as 'pending' and an admin must
// approve them (routes/admin.js). Signup therefore does not log anyone in.
router.post('/faculty/signup', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });

  const existing = db.prepare('SELECT id FROM faculty WHERE lower(email) = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO faculty (name, email, password_hash, role, status) VALUES (?, ?, ?, 'faculty', 'pending')")
    .run(name, email, hash);

  res.json({
    ok: true,
    pending: true,
    message: 'Request sent. The college admin must approve your account before you can sign in.'
  });
});

router.post('/faculty/login', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM faculty WHERE lower(email) = lower(?)').get(email);
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  // Status is only revealed AFTER the password is right, so strangers can't probe who has an account.
  if (row.status === 'pending') {
    return res.status(403).json({ error: 'Your account is waiting for admin approval. You can sign in once it has been approved.', status: 'pending' });
  }
  if (row.status === 'rejected') {
    return res.status(403).json({ error: 'Your sign-up was not approved. Please contact the college admin.', status: 'rejected' });
  }

  req.session.studentId = null; // logging in as faculty in this browser ends any student session it had
  req.session.facultyId = row.id;
  res.json({ ok: true, facultyId: row.id, name: row.name, role: row.role === 'admin' ? 'admin' : 'faculty' });
});

// ---- Student login (account must already be activated: roster upload, then first-time request, then teacher approval) ----
router.post('/student/login', async (req, res) => {
  const { rollNumber, classId } = req.body;
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM students WHERE roll_number = ? AND class_id = ?').get(rollNumber, classId);
  if (!row) return res.status(401).json({ error: 'Account not found or not activated' });

  if (!row.activated) {
    // Waiting for a teacher's approval. Said only to someone who knows the password that was just set, so a stranger
    // can't tell which roll numbers have a request open.
    if (row.password_hash && row.activation_requested_at && await bcrypt.compare(password, row.password_hash)) {
      return res.status(403).json({ error: 'Your account is waiting for your teacher to approve it. Try again once they have.', status: 'pending' });
    }
    return res.status(401).json({ error: 'Account not found or not activated' });
  }

  const ok = await bcrypt.compare(password, row.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.facultyId = null; // logging in as a student in this browser ends any faculty session it had
  req.session.studentId = row.id;
  res.json({ ok: true, studentId: row.id, name: row.name });
});

// First-time request (roll number must exist in the roster already). It does NOT sign the student in and does not
// activate anything: it stores the chosen password and waits for a teacher of the class to approve it
// (POST /api/classes/:classId/students/:studentId/account). Otherwise anyone who knew a roll number could claim it first.
router.post('/student/activate', async (req, res) => {
  const { rollNumber, classId } = req.body;
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM students WHERE roll_number = ? AND class_id = ?').get(rollNumber, classId);
  if (!row) return res.status(404).json({ error: 'Roll number not found in this class roster' });
  if (row.activated) return res.status(409).json({ error: 'Account already activated. Please log in.' });
  if (row.activation_requested_at) {
    return res.status(409).json({ error: 'A request for this roll number is already waiting for your teacher. If it was not you, tell your teacher so they can reject it.' });
  }
  if (!password) return res.status(400).json({ error: 'Choose a password' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare("UPDATE students SET password_hash = ?, activation_requested_at = datetime('now') WHERE id = ?").run(hash, row.id);
  res.json({ ok: true, pending: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  let facultyId = req.session.facultyId || null;
  const studentId = req.session.studentId || null;
  let role = null;
  let name = null;
  if (facultyId) {
    const row = db.prepare('SELECT name, role, status FROM faculty WHERE id = ?').get(facultyId);
    if (row && row.status === 'approved') {
      role = row.role === 'admin' ? 'admin' : 'faculty';
      name = row.name;
    } else {
      // Account was removed, rejected or revoked since this browser signed in: treat as signed out.
      req.session.facultyId = null;
      facultyId = null;
    }
  } else if (studentId) {
    // Same rule as requireStudent below: a reset / not-yet-approved account counts as signed out.
    const row = db.prepare('SELECT name, activated FROM students WHERE id = ?').get(studentId);
    if (row && row.activated) {
      role = 'student';
      name = row.name;
    } else {
      req.session.studentId = null;
    }
  }
  // facultyId/studentId kept for backwards compatibility; role + name let the UI show who is signed in after a refresh.
  res.json({ facultyId, studentId: role === 'student' ? studentId : null, role, name });
});

// The session only stores an id, so the account is re-read from the database on every protected
// request. That means rejecting or revoking a teacher takes effect immediately, even if they are
// already signed in.
function currentFaculty(req) {
  const id = req.session.facultyId;
  if (!id) return null;
  return db.prepare('SELECT id, role, status FROM faculty WHERE id = ?').get(id) || null;
}

function requireFaculty(req, res, next) {
  const f = currentFaculty(req);
  if (!f) return res.status(401).json({ error: 'Faculty login required' });
  if (f.status !== 'approved') return res.status(403).json({ error: 'Your faculty account is not approved' });
  if (f.role !== 'faculty') return res.status(403).json({ error: 'This area is for teachers' });
  next();
}

function requireAdmin(req, res, next) {
  const f = currentFaculty(req);
  if (!f) return res.status(401).json({ error: 'Admin login required' });
  if (f.status !== 'approved' || f.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
  next();
}

function requireStudent(req, res, next) {
  if (!req.session.studentId) return res.status(401).json({ error: 'Student login required' });
  // Re-read from the database on every request (like teachers above): when a teacher resets an account, anyone still
  // signed in as that student is cut off immediately instead of when the browser session expires.
  const row = db.prepare('SELECT activated FROM students WHERE id = ?').get(req.session.studentId);
  if (!row || !row.activated) {
    req.session.studentId = null;
    return res.status(401).json({ error: 'Student login required' });
  }
  next();
}

module.exports = { router, requireFaculty, requireAdmin, requireStudent };
