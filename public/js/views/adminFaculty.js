import { api } from '../core/api.js';
import { esc, busy } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { emptyState } from '../ui/states.js';
import { toast } from '../ui/toast.js';

// Teacher approvals (admin only). Anyone can request a teacher account; nobody can sign in, or see any
// student data, until an admin approves them here. Revoking works immediately (server re-checks status
// on every request).
const STATUS = {
  pending:  { tone: 'warn', label: 'Pending',  icon: 'clock' },
  approved: { tone: 'ok',   label: 'Approved', icon: 'check' },
  rejected: { tone: 'bad',  label: 'Rejected', icon: 'x' },
};
const pill = s => {
  const i = STATUS[s] || STATUS.pending;
  return `<span class="badge badge--${i.tone}">${icon[i.icon]}${i.label}</span>`;
};
const day = d => esc(String(d || '').slice(0, 10)) || '—';

export async function adminFaculty(ctx) {
  ctx.head({
    title: 'Teacher approvals',
    sub: 'Anyone can request a teacher account. Only teachers you approve can sign in and see student data.',
  });
  let list = await api.get('/api/admin/faculty');

  function draw() {
    if (!ctx.alive()) return;
    const pending = list.filter(f => f.status === 'pending');
    const decided = list.filter(f => f.status !== 'pending');

    const pendingBlock = pending.length === 0
      ? emptyState({ title: 'No pending requests', body: 'New teacher sign-ups will appear here for your approval.' })
      : `<div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Email</th><th>Requested</th><th></th></tr></thead>
          <tbody>${pending.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td>${esc(f.email)}</td>
            <td>${day(f.created_at)}</td>
            <td class="row">
              <button class="btn sm" type="button" data-act="approve" data-id="${f.id}" data-name="${esc(f.name)}">Approve</button>
              <button class="btn danger sm" type="button" data-act="reject" data-id="${f.id}" data-name="${esc(f.name)}">Reject</button>
            </td></tr>`).join('')}</tbody>
        </table></div>`;

    const decidedBlock = decided.length === 0
      ? '<p class="muted">No other teacher accounts yet.</p>'
      : `<div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th class="num">Classes</th><th>Decided</th><th></th></tr></thead>
          <tbody>${decided.map(f => `<tr>
            <td>${esc(f.name)}</td>
            <td>${esc(f.email)}</td>
            <td>${pill(f.status)}</td>
            <td class="num">${f.class_count}</td>
            <td>${day(f.decided_at)}</td>
            <td>${f.status === 'approved'
              ? `<button class="btn danger sm" type="button" data-act="reject" data-was="approved" data-id="${f.id}" data-name="${esc(f.name)}">Revoke access</button>`
              : `<button class="btn secondary sm" type="button" data-act="approve" data-id="${f.id}" data-name="${esc(f.name)}">Approve</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;

    ctx.render(`<div class="stack">
      <section>
        <h2 class="section-title">Waiting for approval <span class="count${pending.length ? ' count--warn' : ''}">${pending.length}</span></h2>
        ${pendingBlock}
      </section>
      <section>
        <h2 class="section-title">All other teacher accounts</h2>
        ${decidedBlock}
      </section>
    </div>`);
  }

  ctx.on('click', '[data-act]', async (e, btn) => {
    const { act, id, name, was } = btn.dataset;
    if (was === 'approved' && !confirm(`Revoke ${name}'s access? They will be signed out of the system on their next action.`)) return;
    await busy(btn, async () => {
      try {
        const res = await api.post(`/api/admin/faculty/${id}/${act}`);
        list = list.map(f => (f.id === res.faculty.id ? res.faculty : f));
        draw();
        toast(act === 'approve' ? `${name} approved` : was === 'approved' ? `${name}'s access revoked` : `${name} rejected`, 'success');
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  draw();
}
