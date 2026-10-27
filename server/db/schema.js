const db = require('./connection');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS faculty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id INTEGER NOT NULL REFERENCES faculty(id),
      program TEXT NOT NULL,
      year TEXT NOT NULL,
      section TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL REFERENCES classes(id),
      roll_number TEXT NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      activated INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(class_id, roll_number)
    );

    CREATE TABLE IF NOT EXISTS issuer_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer_key TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      official_domain TEXT,
      verification_method TEXT,
      config_json TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS catalog_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      degree_type TEXT,
      total_semesters INTEGER NOT NULL DEFAULT 6,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS catalog_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL REFERENCES catalog_programs(id),
      semester TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(program_id, semester, name)
    );

    CREATE TABLE IF NOT EXISTS issuer_sessions (
      issuer_key TEXT PRIMARY KEY,
      cookie TEXT NOT NULL,
      saved_by_faculty_id INTEGER REFERENCES faculty(id),
      saved_at TEXT DEFAULT (datetime('now')),
      last_check_ok INTEGER,
      last_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now')),
      extracted_json TEXT,
      issuer_key TEXT,
      status TEXT DEFAULT 'PENDING',
      evidence_json TEXT,
      reviewed_by_faculty INTEGER DEFAULT 0
    );
  `);

  // ---- Migration: faculty approval (added 2026-10-03) ----
  // `CREATE TABLE IF NOT EXISTS` never adds columns to a table that already exists, so older databases
  // get them here. EXISTING faculty rows default to 'approved' on purpose: they were already using the
  // system before approvals existed, and locking them out would be wrong. New signups are inserted
  // explicitly as 'pending' by routes/auth.js.
  //   role   : 'faculty' (teacher) | 'admin'
  //   status : 'pending' | 'approved' | 'rejected'
  const facultyCols = db.prepare('PRAGMA table_info(faculty)').all().map((c) => c.name);
  if (!facultyCols.includes('role')) db.exec("ALTER TABLE faculty ADD COLUMN role TEXT NOT NULL DEFAULT 'faculty'");
  if (!facultyCols.includes('status')) db.exec("ALTER TABLE faculty ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
  if (!facultyCols.includes('decided_at')) db.exec('ALTER TABLE faculty ADD COLUMN decided_at TEXT');

  // ---- Migration: which teacher teaches which subject (added 2026-10-03) ----
  // A class used to have exactly one owner (classes.faculty_id) who saw everything in it. In a real
  // college many teachers share a class and each teaches different subjects, so access now follows
  // this table: a teacher sees a class only if they created it or teach a subject in it, and within
  // it only the subjects they teach. A subject already belongs to one class, so subject_id alone
  // implies the class / section.
  // BACKFILL (runs once, only when the table is first created): every existing class's creator is
  // assigned all of that class's subjects, so current teachers keep exactly the access they had.
  const hadTeaching = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teaching'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS teaching (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      faculty_id INTEGER NOT NULL REFERENCES faculty(id),
      subject_id INTEGER NOT NULL REFERENCES subjects(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(faculty_id, subject_id)
    );
  `);
  if (!hadTeaching) {
    db.exec(`
      INSERT OR IGNORE INTO teaching (faculty_id, subject_id)
      SELECT c.faculty_id, s.id FROM subjects s JOIN classes c ON c.id = s.class_id;
    `);
  }

  // ---- Migration: students no longer see automated results (added 2026-10-03) ----
  // Why: if a student can see that a fake was caught, they can delete it and upload the real one, and the
  // platform never notices. So students only ever see "Submitted" plus a HUMAN decision from a teacher,
  // and a student can no longer erase an upload: "delete" is now a soft withdraw.
  //   withdrawn_at     : set when the student withdraws an upload. The row, file and evidence are kept so
  //                      the teacher still sees it (and sees that it was replaced).
  //   faculty_decision : the teacher's decision, the ONLY thing a student is ever told about the result:
  //                      'APPROVED' | 'RESUBMIT' | 'DISMISSED' (teacher acknowledged a withdrawn upload).
  //                      NULL = the teacher has not acted. Set ONLY by POST /:certId/review.
  //   faculty_note     : optional note from the teacher, shown to the student with a RESUBMIT.
  const certCols = db.prepare('PRAGMA table_info(certificates)').all().map((c) => c.name);
  if (!certCols.includes('withdrawn_at')) db.exec('ALTER TABLE certificates ADD COLUMN withdrawn_at TEXT');
  if (!certCols.includes('faculty_note')) db.exec('ALTER TABLE certificates ADD COLUMN faculty_note TEXT');

  // ---- Migration: issuer the student says a certificate is from (added 2026-10-03) ----
  //   claimed_issuer : free text picked/typed in the student upload form (typeahead over issuer_registry).
  //                    ADVISORY ONLY: shown to the teacher as "Student says: ...", never read by verification
  //                    and never changes a status, because a student can type anything. NULL = left blank.
  if (!certCols.includes('claimed_issuer')) db.exec('ALTER TABLE certificates ADD COLUMN claimed_issuer TEXT');

  // ---- Migration: teacher approves a student's first sign-up (added 2026-10-03) ----
  // Before this, anyone who knew a roll number could open "First time" and set the password first, becoming that
  // student. Now setting a password only files a REQUEST; the student cannot sign in until a teacher of the class approves it.
  //   activation_requested_at : set when the student sets a password. activated stays 0 until a teacher approves.
  //   account states: activated = 1 -> active | activated = 0 and this set -> waiting for approval | otherwise -> not activated.
  // Students who are ALREADY activated stay active (they were using the system before approvals existed).
  const studentCols = db.prepare('PRAGMA table_info(students)').all().map((c) => c.name);
  if (!studentCols.includes('activation_requested_at')) db.exec('ALTER TABLE students ADD COLUMN activation_requested_at TEXT');

  // ---- Migration: websites on a certificate that are not on the trusted list (added 2026-10-03) ----
  //   link_hosts_json : JSON array of the website names (hostnames, exactly as printed in the certificate's
  //                     links / QR code) that were NOT on the trusted issuer list when the check ran. Feeds the
  //                     teacher's "Trust this website" button (routes/certificates.js), so nobody types a domain.
  //                     NULL = not recorded yet (older rows are filled in once, in the background, at server start).
  //                     '[]'  = checked, nothing unlisted. Teacher-side only: never sent to a student.
  if (!certCols.includes('link_hosts_json')) db.exec('ALTER TABLE certificates ADD COLUMN link_hosts_json TEXT');
  if (!certCols.includes('faculty_decision')) {
    db.exec('ALTER TABLE certificates ADD COLUMN faculty_decision TEXT');
    // One-time backfill: rows a teacher already resolved by hand carry the "Faculty manual review:" evidence line.
    // (reviewed_by_faculty alone can't be used: the Udemy-proof tool also sets it.)
    db.exec(`
      UPDATE certificates SET faculty_decision = CASE status WHEN 'VERIFIED' THEN 'APPROVED' ELSE 'RESUBMIT' END
      WHERE reviewed_by_faculty = 1 AND status IN ('VERIFIED', 'NOT_FOUND')
        AND evidence_json LIKE '%Faculty manual review:%';
    `);
  }
}

module.exports = { initSchema };
