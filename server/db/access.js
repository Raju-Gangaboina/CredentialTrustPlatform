// The ONE place that decides what a teacher may see. Every faculty route uses these helpers so the rule
// can't drift between screens.
//
// RULES (agreed with the project owner, 2026-10-03):
//   * A teacher sees a CLASS if they created it, or teach at least one subject in it.
//   * Inside a class they see only the SUBJECTS they teach (rows in `teaching`) — and only the
//     certificates, stats and review queue for those subjects.
//   * Safety net: if NO approved teacher teaches a subject yet, the class's creator can see (and
//     review) it, so a certificate can never get stuck with nobody able to review it. The moment
//     someone approved takes the subject, it moves to them.
//   * A class's students/roster are class-wide, so anyone with access to the class sees the roster.
const db = require('./connection');

// SQL fragment: is subject alias `sub` (joined to class alias `cl`) visible to teacher `?`?
// Needs the teacher id passed TWICE, in order — use subjectVisibility(facultyId).params.
const VISIBLE_SUBJECT_SQL = `(
  sub.id IN (SELECT t.subject_id FROM teaching t WHERE t.faculty_id = ?)
  OR (
    cl.faculty_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM teaching t2 JOIN faculty f2 ON f2.id = t2.faculty_id
      WHERE t2.subject_id = sub.id AND f2.status = 'approved'
    )
  )
)`;

function subjectVisibility(facultyId) {
  return { sql: VISIBLE_SUBJECT_SQL, params: [facultyId, facultyId] };
}

// The class row if this teacher may see it, otherwise undefined.
function accessibleClass(facultyId, classId) {
  return db.prepare(`
    SELECT c.* FROM classes c
    WHERE c.id = ?
      AND (c.faculty_id = ?
        OR EXISTS (SELECT 1 FROM teaching t JOIN subjects s ON s.id = t.subject_id
                   WHERE t.faculty_id = ? AND s.class_id = c.id))
  `).get(classId, facultyId, facultyId);
}

// Subjects of one class that this teacher may see.
function visibleSubjects(facultyId, classId) {
  const v = subjectVisibility(facultyId);
  return db.prepare(`
    SELECT sub.* FROM subjects sub JOIN classes cl ON cl.id = sub.class_id
    WHERE sub.class_id = ? AND ${v.sql}
    ORDER BY sub.id
  `).all(classId, ...v.params);
}

// May this teacher review this certificate?
function canReviewCertificate(facultyId, certId) {
  const v = subjectVisibility(facultyId);
  return !!db.prepare(`
    SELECT 1 FROM certificates c
    JOIN subjects sub ON sub.id = c.subject_id
    JOIN classes cl ON cl.id = sub.class_id
    WHERE c.id = ? AND ${v.sql}
  `).get(certId, ...v.params);
}

module.exports = { subjectVisibility, accessibleClass, visibleSubjects, canReviewCertificate };
