// Seeds catalog_programs / catalog_subjects from server/data/courseCatalog.js.
// Idempotent (INSERT OR IGNORE) — safe to call on every server start, and also runnable
// standalone with: npm run seed:catalog
const db = require('./connection');
const { initSchema } = require('./schema');
const CATALOG = require('../data/courseCatalog');

function seedCatalog() {
  initSchema();

  const insertProgram = db.prepare(`
    INSERT OR IGNORE INTO catalog_programs (name, degree_type, total_semesters, note)
    VALUES (?, ?, ?, ?)
  `);
  const getProgramId = db.prepare('SELECT id FROM catalog_programs WHERE name = ?');
  const insertSubject = db.prepare(`
    INSERT OR IGNORE INTO catalog_subjects (program_id, semester, name) VALUES (?, ?, ?)
  `);

  let programCount = 0;
  let subjectCount = 0;

  for (const program of CATALOG) {
    insertProgram.run(program.name, program.degreeType || 'UG', program.totalSemesters, program.note || null);
    const row = getProgramId.get(program.name);
    if (!row) continue;
    programCount++;
    const semesters = program.semesters || {};
    for (const [semester, subjects] of Object.entries(semesters)) {
      for (const subjectName of subjects) {
        const info = insertSubject.run(row.id, semester, subjectName);
        if (info.changes > 0) subjectCount++;
      }
    }
  }

  return { programCount, subjectCount };
}

module.exports = { seedCatalog };

if (require.main === module) {
  const result = seedCatalog();
  console.log(`Catalog seed complete: ${result.programCount} program(s) checked, ${result.subjectCount} new subject row(s) inserted.`);
}
