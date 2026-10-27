import { api } from '../core/api.js';
import { go } from '../core/router.js';
import { $, esc, busy } from '../core/dom.js';
import { notice } from '../ui/states.js';

export async function newClass(ctx) {
  ctx.head({ title: 'New class', crumbs: [{ label: 'Classes', href: '/faculty/classes' }] });
  const programs = await api.get('/api/catalog/programs');
  if (!ctx.alive()) return;

  let subjects = [];   // [{ name, checked }] - catalog subjects plus any the faculty added

  ctx.render(`
    <form id="form" class="card stack" novalidate>
      <div id="err"></div>
      <div class="grid-2">
        <label class="field"><span>Course</span>
          <select id="program">
            ${programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            <option value="__new__">+ Add a new course…</option>
          </select></label>
        <label class="field"><span>Semester</span><select id="semester"></select></label>
        <label class="field"><span>Section</span><input id="section" placeholder="A" required></label>
        <label class="field"><span>Academic year</span><input id="year" placeholder="2026–27" required></label>
      </div>

      <div id="newProgram" class="inset stack-sm" hidden>
        <div class="grid-2">
          <label class="field"><span>New course name</span><input id="npName" placeholder="e.g. B.Com (Honours)"></label>
          <label class="field"><span>Number of semesters</span><input id="npSem" type="number" min="1" max="12" value="6"></label>
        </div>
        <button class="btn secondary sm" type="button" id="npSave">Save course</button>
      </div>

      <fieldset>
        <legend>Subjects for this semester (untick any that don't apply, or add one that's missing)</legend>
        <div id="picker" class="checks"></div>
        <div class="row" style="margin-top:10px">
          <input id="extra" placeholder="Add a subject not listed above" style="flex:1; min-width:200px">
          <button class="btn secondary" type="button" id="addSubject">Add</button>
        </div>
      </fieldset>

      <div class="row end">
        <a class="btn ghost" href="#/faculty/classes">Cancel</a>
        <button class="btn" type="submit">Create class</button>
      </div>
    </form>
  `);

  const el = id => $('#' + id, ctx.main);
  const program = el('program'), semester = el('semester'), picker = el('picker');
  const isNew = () => program.value === '__new__';
  const err = msg => { el('err').innerHTML = msg ? notice('error', msg) : ''; };

  function drawSemesters() {
    const p = programs.find(x => String(x.id) === program.value);
    const total = isNew() ? 6 : (p ? p.total_semesters : 6);
    semester.innerHTML = Array.from({ length: total }, (_, i) => `<option value="Semester ${i + 1}">Semester ${i + 1}</option>`).join('');
  }

  function drawPicker(message) {
    if (subjects.length === 0) {
      picker.innerHTML = `<p class="muted">${esc(message || 'No subjects listed for this semester yet. Add some below.')}</p>`;
      return;
    }
    picker.innerHTML = subjects.map((s, i) =>
      `<label class="check"><input type="checkbox" data-i="${i}"${s.checked ? ' checked' : ''}><span>${esc(s.name)}</span></label>`).join('');
  }

  async function loadSubjects() {
    if (isNew()) { subjects = []; drawPicker('Save the new course first, then add its subjects below.'); return; }
    picker.innerHTML = '<p class="muted">Loading subjects…</p>';
    try {
      const r = await api.get(`/api/catalog/programs/${program.value}/subjects?semester=${encodeURIComponent(semester.value)}`);
      if (!ctx.alive()) return;
      subjects = r.subjects.map(s => ({ name: s.name, checked: true }));
      drawPicker(r.program && r.program.note);
    } catch (ex) { picker.innerHTML = notice('error', ex.message); }
  }

  program.onchange = async () => { el('newProgram').hidden = !isNew(); drawSemesters(); await loadSubjects(); };
  semester.onchange = loadSubjects;
  ctx.on('change', '[data-i]', (e, cb) => { subjects[Number(cb.dataset.i)].checked = cb.checked; });

  function addSubject() {
    const name = el('extra').value.trim();
    if (!name) return;
    if (!subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) subjects.push({ name, checked: true });
    el('extra').value = '';
    drawPicker();
  }
  el('addSubject').onclick = addSubject;

  async function saveProgram() {
    err('');
    const name = el('npName').value.trim();
    const totalSemesters = Number(el('npSem').value);
    if (!name || !totalSemesters) return err('Enter a course name and number of semesters.');
    try {
      const r = await api.post('/api/catalog/programs', { name, totalSemesters });
      programs.push({ id: r.programId, name, total_semesters: totalSemesters });
      const opt = new Option(name, String(r.programId));
      program.insertBefore(opt, program.querySelector('option[value="__new__"]'));
      program.value = String(r.programId);
      el('newProgram').hidden = true;
      drawSemesters();
      await loadSubjects();
    } catch (ex) { err(ex.message); }
  }
  el('npSave').onclick = saveProgram;

  // Enter inside a helper input should trigger that helper, not submit the whole form.
  ctx.on('keydown', '#extra, #newProgram input', (e, input) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input.id === 'extra') addSubject(); else saveProgram();
  });

  el('form').addEventListener('submit', async e => {
    e.preventDefault();
    err('');
    if (isNew()) return err('Save the new course first, or pick an existing one.');
    const section = el('section').value.trim();
    const academicYear = el('year').value.trim();
    if (!section || !academicYear) return err('Section and academic year are required.');
    const chosen = subjects.filter(s => s.checked).map(s => s.name);
    if (chosen.length === 0) return err('Pick at least one subject for this class.');
    await busy($('button[type="submit"]', ctx.main), async () => {
      try {
        const r = await api.post('/api/classes', {
          program: program.options[program.selectedIndex].textContent,
          year: semester.value, section, academicYear, subjects: chosen,
        });
        go(`/faculty/teaching/${r.classId}`); // next: tick the subjects YOU teach in this new class
      } catch (ex) { err(ex.message); }
    }, 'Creating…');
  });

  drawSemesters();
  await loadSubjects();
}
