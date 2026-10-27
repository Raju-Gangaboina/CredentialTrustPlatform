import { api } from '../core/api.js';
import { loadSession, session, homeFor } from '../core/session.js';
import { go } from '../core/router.js';
import { $, busy } from '../core/dom.js';
import { notice } from '../ui/states.js';

export async function facultyLogin(ctx) {
  let mode = 'login';
  let flash = ''; // one-off message shown above the form (e.g. "request sent")

  ctx.render(`
    <div class="auth">
      <h1>Faculty</h1>
      <span class="muted">Sign in to manage your classes and review flagged certificates. New teacher accounts must be approved by the college admin before first use.</span>
      <div class="card stack">
        <div class="seg" role="tablist" aria-label="Sign in or create account">
          <button type="button" role="tab" data-mode="login" aria-selected="true">Sign in</button>
          <button type="button" role="tab" data-mode="signup" aria-selected="false">Request account</button>
        </div>
        <form id="form" class="stack-sm" novalidate></form>
      </div>
    </div>
  `);
  const form = $('#form', ctx.main);

  function draw() {
    const signup = mode === 'signup';
    form.innerHTML = `
      <div id="err">${flash}</div>
      ${signup ? '<label class="field"><span>Name</span><input name="name" autocomplete="name" required></label>' : ''}
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"${signup ? ' minlength="8"' : ''} required></label>
      ${signup ? '<p class="muted">At least 8 characters. An admin will review your request, and you can sign in once it is approved.</p>' : ''}
      <button class="btn" type="submit">${signup ? 'Request account' : 'Sign in'}</button>`;
    flash = '';
    ctx.main.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  }

  ctx.on('click', '[data-mode]', (e, btn) => { mode = btn.dataset.mode; draw(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const err = $('#err', form);
    err.innerHTML = '';
    await busy($('button[type="submit"]', form), async () => {
      try {
        const res = await api.post(`/api/auth/faculty/${mode}`, data);
        if (mode === 'signup') {
          // Not signed in: the account is pending until an admin approves it.
          flash = notice('success', res.message || 'Request sent. An admin must approve your account before you can sign in.');
          mode = 'login';
          draw();
          return;
        }
        await loadSession();
        go(homeFor(session.role)); // admins land on the approvals page, teachers on their classes
      } catch (ex) { err.innerHTML = notice(ex.status === 403 ? 'warn' : 'error', ex.message); }
    }, 'Please wait…');
  });

  draw();
}
