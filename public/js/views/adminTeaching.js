import { api } from '../core/api.js';
import { esc } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { emptyState } from '../ui/states.js';

// Admin overview: who teaches what. Subjects nobody (approved) teaches are flagged, because until a teacher
// takes them only the class creator can review their certificates.
export async function adminTeaching(ctx) {
  ctx.head({
    title: 'Who teaches what',
    sub: 'Every class and its subjects with the teachers assigned. Subjects without a teacher are flagged.',
  });
  const data = await api.get('/api/admin/teaching');
  if (!ctx.alive()) return;

  let onlyGaps = false;

  function draw() {
    if (!ctx.alive()) return;
    const s = data.summary;
    if (s.classes === 0) {
      ctx.render(emptyState({ title: 'No classes yet', body: 'Classes appear here once a teacher creates one.' }));
      return;
    }

    const classes = data.classes
      .map(c => ({ ...c, rows: onlyGaps ? c.subjects.filter(x => x.unassigned) : c.subjects }))
      .filter(c => c.rows.length > 0);

    const stat = (n, label, tone) => `<div class="stat" data-tone="${tone}"><div class="n">${n}</div><div class="label">${label}</div></div>`;

    ctx.render(`<div class="stack">
      <div class="stats">
        ${stat(s.classes, 'Classes', 'brand')}
        ${stat(s.subjects, 'Subjects', 'brand')}
        ${stat(s.unassigned, 'Subjects with no teacher', s.unassigned ? 'warn' : 'ok')}
        ${stat(s.waitingUnassigned, 'Certificates waiting on those', s.waitingUnassigned ? 'bad' : 'ok')}
      </div>
      <label class="check"><input type="checkbox" id="onlyGaps"${onlyGaps ? ' checked' : ''}><span>Show only subjects with no teacher</span></label>
      ${classes.length === 0
        ? emptyState({ title: 'Every subject has a teacher', body: 'Nothing needs attention right now.' })
        : classes.map(c => `
          <section>
            <h2 class="section-title">${esc(c.program)} <span class="muted">· ${esc(c.year)} · Section ${esc(c.section)} · ${esc(c.academic_year)}</span></h2>
            <p class="muted">Created by ${esc(c.creator || 'unknown')}</p>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Subject</th><th>Teachers</th><th class="num">Waiting for review</th></tr></thead>
              <tbody>${c.rows.map(x => `<tr>
                <td>${esc(x.name)}</td>
                <td>${x.unassigned
                  ? `<span class="badge badge--warn">${icon.alert}No teacher</span>`
                  : x.teachers.map(esc).join(', ')}</td>
                <td class="num${x.waiting ? '' : ' zero'}">${x.waiting}</td>
              </tr>`).join('')}</tbody>
            </table></div>
          </section>`).join('')}
    </div>`);
  }

  ctx.on('change', '#onlyGaps', (e, cb) => { onlyGaps = cb.checked; draw(); });
  draw();
}
