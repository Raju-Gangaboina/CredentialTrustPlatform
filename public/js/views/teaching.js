import { api } from '../core/api.js';
import { esc, busy } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { emptyState } from '../ui/states.js';
import { toast } from '../ui/toast.js';

// "Subjects I teach": a teacher narrows the list of classes (course / semester / section) and ticks ONLY the
// subjects they teach. After that, every screen shows just those subjects (server enforces it — db/access.js).
// /faculty/teaching/:classId opens with just that one class (used right after creating a class).
export async function teaching(ctx) {
  ctx.head({
    title: 'Subjects I teach',
    sub: 'Pick the classes and subjects you teach. Your dashboard and review queue will show only those.',
    crumbs: [{ label: 'Classes', href: '/faculty/classes' }],
  });
  let all = await api.get('/api/teaching/classes');
  if (!ctx.alive()) return;

  const f = { program: '', year: '', section: '', focus: ctx.params.classId ? Number(ctx.params.classId) : null };
  const uniq = arr => [...new Set(arr)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sel = (key, label, values) => `
    <label class="field"><span>${label}</span>
      <select data-filter="${key}">
        <option value="">All</option>
        ${values.map(v => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select></label>`;

  function card(c) {
    return `
      <div class="card stack-sm" data-class="${c.id}">
        <div>
          <h3>${esc(c.program)}</h3>
          <p class="muted">${esc(c.year)} · Section ${esc(c.section)} · ${esc(c.academic_year)}</p>
        </div>
        ${c.subjects.length === 0 ? '<p class="muted">No subjects in this class yet. Add one below.</p>' : `
        <div class="checks">${c.subjects.map(s => `
          <label class="check"><input type="checkbox" data-sub="${s.id}"${s.mine ? ' checked' : ''}>
            <span>${esc(s.name)}${s.others ? ` <small class="muted">· also taught by ${s.others} other${s.others > 1 ? 's' : ''}</small>` : ''}</span></label>`).join('')}
        </div>`}
        <div class="row">
          <input data-extra placeholder="Subject missing? Type it here" style="flex:1; min-width:200px">
          <button class="btn secondary" type="button" data-addsub>Add</button>
        </div>
        <div class="row end"><button class="btn" type="button" data-save>Save my subjects</button></div>
      </div>`;
  }

  function draw() {
    if (!ctx.alive()) return;
    if (all.length === 0) {
      ctx.render(emptyState({
        title: 'No classes exist yet',
        body: 'Create the class first, then come back to pick the subjects you teach in it.',
        action: `<a class="btn" href="#/faculty/classes/new">${icon.plus}New class</a>`,
      }));
      return;
    }
    const shown = all.filter(c =>
      (f.focus ? c.id === f.focus : true) &&
      (!f.program || c.program === f.program) &&
      (!f.year || c.year === f.year) &&
      (!f.section || c.section === f.section));

    const top = f.focus
      ? `<div class="card row between"><span>Showing the class you just created. Tick the subjects <strong>you</strong> teach in it.</span>
           <button class="btn secondary sm" type="button" data-all>Show all classes</button></div>`
      : `<div class="card"><div class="grid-2">
           ${sel('program', 'Course', uniq(all.map(c => c.program)))}
           ${sel('year', 'Semester', uniq(all.map(c => c.year)))}
           ${sel('section', 'Section', uniq(all.map(c => c.section)))}
         </div></div>`;

    ctx.render(`<div class="stack">${top}
      ${shown.length === 0
        ? emptyState({ title: 'No class matches', body: 'Change the filters above, or create the class if it is not listed.', action: `<a class="btn" href="#/faculty/classes/new">${icon.plus}New class</a>` })
        : shown.map(card).join('')}
    </div>`);
  }

  const classOf = el => all.find(c => c.id === Number(el.closest('[data-class]').dataset.class));

  ctx.on('change', '[data-filter]', (e, s) => { f[s.dataset.filter] = s.value; draw(); });
  ctx.on('click', '[data-all]', () => { f.focus = null; draw(); });
  ctx.on('change', '[data-sub]', (e, cb) => {
    const s = classOf(cb).subjects.find(x => x.id === Number(cb.dataset.sub));
    if (s) s.mine = cb.checked; // pending until "Save"
  });

  ctx.on('click', '[data-save]', async (e, btn) => {
    const c = classOf(btn);
    await busy(btn, async () => {
      try {
        const r = await api.put(`/api/teaching/class/${c.id}`, { subjectIds: c.subjects.filter(s => s.mine).map(s => s.id) });
        toast(r.count ? `Saved: you teach ${r.count} subject${r.count > 1 ? 's' : ''} in this class` : 'Saved: you no longer teach in this class', 'success');
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  async function addSubject(el) {
    const c = classOf(el);
    const input = el.closest('[data-class]').querySelector('[data-extra]');
    const name = input.value.trim();
    if (!name) return;
    try {
      const r = await api.post(`/api/teaching/class/${c.id}/subjects`, { name });
      const have = c.subjects.find(s => s.id === r.subject.id);
      if (have) have.mine = true; else c.subjects.push({ id: r.subject.id, name: r.subject.name, mine: true, others: 0 });
      draw();
      toast(r.existed ? `"${r.subject.name}" already existed. Ticked for you` : `Added "${r.subject.name}" and ticked it for you`, 'success');
    } catch (ex) { toast(ex.message, 'error'); }
  }
  ctx.on('click', '[data-addsub]', (e, btn) => addSubject(btn));
  ctx.on('keydown', '[data-extra]', (e, input) => {
    if (e.key === 'Enter') { e.preventDefault(); addSubject(input); }
  });

  draw();
}
