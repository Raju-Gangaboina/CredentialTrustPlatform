import { api } from '../core/api.js';
import { loadSession } from '../core/session.js';
import { go } from '../core/router.js';
import { $, esc, busy, classLabel } from '../core/dom.js';
import { notice } from '../ui/states.js';

export async function studentLogin(ctx) {
  let selected = null;   // { id, label }
  let mode = 'login';    // 'login' | 'activate'
  let timer = null;

  ctx.render(`
    <div class="auth auth--wide">
      <h1>Student</h1>
      <span class="muted">Find your class, then sign in with your roll number. First time here? Choose "First time" to set a password;
      your teacher then has to approve it before you can sign in. Your account exists once your faculty has uploaded the roster.</span>
      <div class="card stack">
        <section class="stack-sm">
          <h2>1. Find your class</h2>
          <div id="findClass"></div>
        </section>
        <section class="stack-sm" id="step2" hidden>
          <h2>2. Your account</h2>
          <div class="seg" role="tablist" aria-label="Sign in or first time">
            <button type="button" role="tab" data-mode="login" aria-selected="true">Sign in</button>
            <button type="button" role="tab" data-mode="activate" aria-selected="false">First time</button>
          </div>
          <form id="form" class="stack-sm" novalidate></form>
        </section>
      </div>
    </div>
  `);
  const findEl = $('#findClass', ctx.main);
  const step2 = $('#step2', ctx.main);
  const form = $('#form', ctx.main);

  function drawFind(results = null) {
    if (selected) {
      findEl.innerHTML = `<div class="row between"><div class="notice success"><strong>${esc(selected.label)}</strong></div>
        <button class="btn ghost sm" type="button" data-change>Change class</button></div>`;
      return;
    }
    findEl.innerHTML = `
      <label class="field"><span>Program, section or academic year</span>
        <input id="q" type="search" placeholder="e.g. B.Sc CS, Section A" autocomplete="off"></label>
      <div class="pick-list" id="results">${results === null ? '' : results.length === 0
        ? '<p class="muted">No matching classes found.</p>'
        : results.map(c => `<button class="pick" type="button" data-pick="${c.id}" data-label="${esc(classLabel(c))}">${esc(classLabel(c))}</button>`).join('')}</div>`;
  }

  function drawForm() {
    const activate = mode === 'activate';
    form.innerHTML = `
      <div id="err"></div>
      <label class="field"><span>Roll number</span><input name="rollNumber" autocomplete="username" required></label>
      <label class="field"><span>${activate ? 'Choose a password' : 'Password'}</span>
        <input name="password" type="password" autocomplete="${activate ? 'new-password' : 'current-password'}" required></label>
      <button class="btn" type="submit">${activate ? 'Activate account' : 'Sign in'}</button>`;
    ctx.main.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  }

  ctx.on('input', '#q', (e, input) => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { $('#results', ctx.main).innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const results = await api.get(`/api/classes/public/search?q=${encodeURIComponent(q)}`);
        if (!ctx.alive() || selected) return;
        const keep = $('#q', ctx.main).value;   // re-drawing must not wipe what they typed
        drawFind(results);
        const again = $('#q', ctx.main);
        again.value = keep; again.focus();
      } catch (ex) { $('#results', ctx.main).innerHTML = notice('error', ex.message); }
    }, 250);
  });
  ctx.on('click', '[data-pick]', (e, btn) => {
    selected = { id: Number(btn.dataset.pick), label: btn.dataset.label };
    drawFind();
    step2.hidden = false;
    $('input[name="rollNumber"]', form).focus();
  });
  ctx.on('click', '[data-change]', () => { selected = null; step2.hidden = true; drawFind(); $('#q', ctx.main).focus(); });
  ctx.on('click', '[data-mode]', (e, btn) => { mode = btn.dataset.mode; drawForm(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#err', form);
    err.innerHTML = '';
    if (!selected) { err.innerHTML = notice('error', 'Pick your class first.'); return; }
    const body = { ...Object.fromEntries(new FormData(form)), classId: selected.id };
    await busy($('button[type="submit"]', form), async () => {
      try {
        await api.post(`/api/auth/student/${mode}`, body);
        if (mode === 'activate') {
          // Not signed in: the request now waits for a teacher. Send them to the sign-in form with that explained.
          mode = 'login';
          drawForm();
          $('#err', form).innerHTML = notice('success', 'Request sent. Your teacher has to approve it before you can sign in. Come back later and use "Sign in" with the same roll number and password.');
          return;
        }
        await loadSession();
        go('/student/vault');
      } catch (ex) { err.innerHTML = notice('error', ex.message); }
    }, 'Please wait…');
  });

  drawFind();
  drawForm();
}
