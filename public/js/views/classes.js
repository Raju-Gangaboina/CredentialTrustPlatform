import { api } from '../core/api.js';
import { esc } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { emptyState } from '../ui/states.js';

export async function classes(ctx) {
  ctx.head({
    title: 'Classes',
    sub: 'Only the classes you created or teach in appear here, and inside each one only your subjects.',
    actions: `<a class="btn secondary" href="#/faculty/teaching">Subjects I teach</a><a class="btn" href="#/faculty/classes/new">${icon.plus}New class</a>`,
  });
  const list = await api.get('/api/classes');

  if (list.length === 0) {
    ctx.render(emptyState({
      title: 'You are not teaching any class yet',
      body: 'Pick the classes and subjects you teach. If your class is not listed there, create it and upload its roster.',
      action: '<div class="row"><a class="btn" href="#/faculty/teaching">Pick my subjects</a><a class="btn secondary" href="#/faculty/classes/new">Create a class</a></div>',
    }));
    return;
  }
  ctx.render(`<div class="class-cards">${list.map(c => `
    <a class="class-card" href="#/faculty/class/${c.id}">
      <h3>${esc(c.program)}</h3>
      <p class="muted">${esc(c.year)} · Section ${esc(c.section)}</p>
      <p class="muted">${esc(c.academic_year)}</p>
      <p class="muted">${c.mySubjects.length
        ? `You teach: ${c.mySubjects.map(esc).join(', ')}`
        : 'You have not picked your subjects here yet'}</p>
    </a>`).join('')}</div>`);
}
