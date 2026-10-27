import { api } from '../core/api.js';
import { $, esc, busy, classLabel } from '../core/dom.js';
import { badge, evidenceBlock, statusInfo, STATUS_ORDER } from '../ui/status.js';
import { emptyState, notice } from '../ui/states.js';
import { toast } from '../ui/toast.js';

// One page, three tabs. Each tab is its own route (/faculty/class/:id[/review|/roster]) so it can be linked and bookmarked.
export async function classDetail(ctx) {
  const classId = Number(ctx.params.id);
  const tab = ['review', 'roster'].includes(ctx.params.tab) ? ctx.params.tab : 'overview';
  let rosterMsg = '';   // result of the last roster upload, kept across redraws

  async function draw() {
    const [detail, stats, queue] = await Promise.all([
      api.get(`/api/classes/${classId}`),
      api.get(`/api/certificates/stats/${classId}`),
      api.get(`/api/certificates/review-queue/${classId}`),
    ]);
    if (!ctx.alive()) return;
    const c = detail.class;

    ctx.head({
      title: `${c.program} — ${c.year} — Section ${c.section}`,
      sub: `${c.academic_year} · ${detail.students.length} students on roster`,
      crumbs: [{ label: 'Classes', href: '/faculty/classes' }],
    });

    const base = `#/faculty/class/${classId}`;
    const waiting = detail.students.filter(s => s.state === 'WAITING').length;
    const tabLink = (key, href, label, extra = '') =>
      `<a href="${href}"${tab === key ? ' aria-current="page"' : ''}>${label}${extra}</a>`;
    const tabs = `<nav class="tabs" aria-label="Class sections">
      ${tabLink('overview', base, 'Overview')}
      ${tabLink('review', base + '/review', 'Review queue', `<span class="count${queue.length ? ' count--warn' : ''}">${queue.length}</span>`)}
      ${tabLink('roster', base + '/roster', 'Roster', `<span class="count">${detail.students.length}</span>${waiting ? `<span class="count count--warn" title="Waiting for your approval">${waiting}</span>` : ''}`)}
    </nav>`;

    const body = tab === 'review' ? reviewTab(queue) : tab === 'roster' ? rosterTab(detail) : overviewTab(c, detail, stats);
    // Tell the teacher when they teach nothing here, and (otherwise) that other teachers' subjects are hidden on purpose.
    const taughtHint = detail.subjects.length === 0
      ? notice('warn', 'You have not picked the subjects you teach in this class yet, so there is nothing for you to review here.') + `<p><a class="btn" href="#/faculty/teaching/${classId}">Choose my subjects</a></p>`
      : detail.otherSubjectCount > 0
        ? `<p class="muted">Showing only your subjects. ${detail.otherSubjectCount} other subject${detail.otherSubjectCount > 1 ? 's are' : ' is'} handled by other teachers. <a href="#/faculty/teaching/${classId}">Change my subjects</a></p>`
        : '';
    ctx.render(tabs + taughtHint + body);
  }

  function overviewTab(c, detail, stats) {
    const overall = Object.fromEntries(stats.overall.map(o => [o.status, o.n]));
    return `
      <div class="stack">
        <div class="card row between">
          <div>
            <h2>Tell your students how to find this class</h2>
            <p class="muted">They search for it by name when they sign in. They don't need the ID number.</p>
            <p style="margin-top:8px"><strong>${esc(classLabel(c))}</strong></p>
            <p class="muted">Class ID (fallback): <code>${c.id}</code></p>
          </div>
          <button class="btn secondary" type="button" data-copy="${esc(classLabel(c))}">Copy class name</button>
        </div>

        <div class="stats">
          <div class="stat" data-tone="brand"><div class="n">${detail.students.length}</div><div class="label">Students</div></div>
          ${STATUS_ORDER.map(s => `<div class="stat" data-tone="${statusInfo(s).tone}"><div class="n">${overall[s] || 0}</div><div class="label">${statusInfo(s).label}</div></div>`).join('')}
        </div>

        <section>
          <h2 class="section-title">Verification by subject</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Subject</th>${STATUS_ORDER.map(s => `<th class="num">${statusInfo(s).label}</th>`).join('')}</tr></thead>
            <tbody>${detail.subjects.map(sub => {
              const counts = Object.fromEntries(stats.perSubject.filter(p => p.subject_name === sub.name).map(p => [p.status, p.n]));
              return `<tr><td>${esc(sub.name)}</td>${STATUS_ORDER.map(s => `<td class="num${counts[s] ? '' : ' zero'}">${counts[s] || 0}</td>`).join('')}</tr>`;
            }).join('')}</tbody>
          </table></div>
        </section>
      </div>`;
  }

  function reviewTab(queue) {
    if (queue.length === 0) return emptyState({ title: 'Nothing to review', body: 'Certificates the system can\'t settle on its own will appear here.' });
    return `<div class="stack">${queue.map(cert => `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>${esc(cert.student_name)} <span class="muted">(${esc(cert.roll_number)})</span></h3>
            <p class="muted">${esc(cert.subject_name)} · <span class="filename">${esc(cert.original_filename)}</span>${cert.claimed_issuer ? ` &middot; Student says: <strong>${esc(cert.claimed_issuer)}</strong>` : ''}</p>
          </div>
          <span class="row">
            ${cert.replacedAfterFlag ? '<span class="badge badge--bad">Replaced after being flagged</span>' : ''}
            ${cert.withdrawn ? '<span class="badge badge--idle">Withdrawn by student</span>' : ''}
            ${badge(cert.status)}
          </span>
        </div>
        ${evidenceBlock(cert.status, cert.evidence, { open: true })}
        ${trustBlock(cert)}
        ${historyBlock(cert.history)}
        ${cert.withdrawn ? `
        <div class="row" style="margin-top:14px">
          <button class="btn secondary" type="button" data-decide="DISMISS" data-id="${cert.id}">Dismiss (I have seen this)</button>
        </div>` : `
        <label class="field" style="margin-top:14px"><span>Note to student (shown if you ask them to resubmit)</span>
          <input type="text" maxlength="300" data-note="${cert.id}" placeholder="e.g. Please upload the original PDF from the issuer"></label>
        <div class="row" style="margin-top:10px">
          <button class="btn" type="button" data-decide="VERIFIED" data-id="${cert.id}">Mark verified</button>
          <button class="btn danger" type="button" data-decide="NOT_FOUND" data-id="${cert.id}">Not verified: ask to resubmit</button>
        </div>`}
      </div>`).join('')}</div>`;
  }

  // Websites printed on the certificate that are not on the trusted list. One click saves the website exactly as
  // the certificate prints it (no typing) and re-checks every waiting certificate from it. Sites anyone can publish
  // on (file sharing, link shorteners) come back with a `blocked` reason and get no button.
  function trustBlock(cert) {
    const hosts = cert.unrecognizedHosts || [];
    if (hosts.length === 0) return '';
    return `<div class="trust-box">
      <p><strong>Not on the trusted list:</strong> this certificate points to ${hosts.length > 1 ? 'these websites' : 'a website'} we don't recognise as an issuer.</p>
      ${hosts.map(h => `<div class="trust-row">
        <code class="mono">${esc(h.host)}</code>
        ${h.blocked
          ? `<span class="muted">${esc(h.blocked)}</span>`
          : `<button class="btn secondary" type="button" data-trust="${esc(h.host)}" data-id="${cert.id}">Trust this website</button>`}
      </div>`).join('')}
      <p class="muted">Only trust the issuer's own website. Once trusted, matching certificates from it can be verified automatically, and the ones waiting now are re-checked straight away.</p>
    </div>`;
  }

  // The student's other uploads for the same subject. The student can't see their own automated results,
  // so this is where a teacher spots a flagged upload that was withdrawn and replaced.
  function historyBlock(history) {
    if (!history || history.length === 0) return '';
    return `<details class="evidence" style="margin-top:10px"><summary>Other uploads for this subject (${history.length})</summary>
      <ul class="evidence-list">${history.map(h => `<li><span class="mark" aria-hidden="true">–</span><span>${esc(h.when === 'earlier' ? 'Earlier' : 'Later')}: <span class="filename">${esc(h.filename)}</span> · ${esc(statusInfo(h.status).label)}${h.withdrawn ? ' · withdrawn by student' : ''}${h.faculty_decision ? ` · teacher: ${esc(h.faculty_decision.toLowerCase())}` : ''}</span></li>`).join('')}</ul>
    </details>`;
  }

  // A student's account has three states. WAITING = they set a password via "First time" and cannot sign in until a
  // teacher approves, so a classmate who knows their roll number can't take the account over.
  function accountCell(s) {
    if (s.state === 'ACTIVE') {
      return `<span class="badge badge--ok">Activated</span>
        <button class="btn ghost sm" type="button" data-account="RESET" data-student="${s.id}" data-name="${esc(s.name)}">Reset</button>`;
    }
    if (s.state === 'WAITING') {
      return `<span class="badge badge--warn">Waiting for approval</span>
        <button class="btn sm" type="button" data-account="APPROVE" data-student="${s.id}" data-name="${esc(s.name)}">Approve</button>
        <button class="btn ghost sm" type="button" data-account="REJECT" data-student="${s.id}" data-name="${esc(s.name)}">Reject</button>`;
    }
    return '<span class="badge badge--idle">Not activated</span>';
  }

  function rosterTab(detail) {
    const waiting = detail.students.filter(s => s.state === 'WAITING').length;
    return `
      <div class="stack">
        ${waiting ? notice('warn', `${waiting} student${waiting === 1 ? ' is' : 's are'} waiting for your approval. Approve a request only if you know the person asking is that student. If it is not them, choose Reject and the roll number is free for the real student.`) : ''}
        <form id="rosterForm" class="card stack-sm">
          <h2>Upload or update the student list</h2>
          <p class="muted">An .xlsx file with a roll-number column and a name column. Header names can vary ("Roll No", "Student Name", …).</p>
          <div id="rosterMsg">${rosterMsg}</div>
          <div class="row">
            <input type="file" id="rosterFile" accept=".xlsx,.xls" style="flex:1; min-width:220px">
            <button class="btn" type="submit">Upload roster</button>
          </div>
        </form>
        ${detail.students.length === 0 ? emptyState({ title: 'No students yet', body: 'Upload a roster above and they will appear here.' }) : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Roll number</th><th>Name</th><th>Account</th></tr></thead>
          <tbody>${detail.students.map(s => `<tr><td class="mono">${esc(s.roll_number)}</td><td>${esc(s.name)}</td>
            <td><div class="row">${accountCell(s)}</div></td></tr>`).join('')}</tbody>
        </table></div>`}
      </div>`;
  }

  ctx.on('click', '[data-copy]', async (e, btn) => {
    try { await navigator.clipboard.writeText(btn.dataset.copy); toast('Class name copied', 'success'); }
    catch { toast('Could not copy. Select the text and copy it manually.', 'error'); }
  });

  ctx.on('click', '[data-account]', async (e, btn) => {
    const decision = btn.dataset.account, who = btn.dataset.name;
    // Reject and Reset throw the password away, so ask first.
    const ask = decision === 'RESET'
      ? `Reset ${who}'s account? Their password is removed, they are signed out right away, and they will have to use "First time" again (and you approve it). Their certificates are kept.`
      : decision === 'REJECT' ? `Reject this request for ${who}? The password that was set is thrown away.` : null;
    if (ask && !window.confirm(ask)) return;
    await busy(btn, async () => {
      try {
        await api.post(`/api/classes/${classId}/students/${btn.dataset.student}/account`, { decision });
        toast(decision === 'APPROVE' ? `${who} can now sign in` : decision === 'REJECT' ? 'Request rejected' : 'Account reset', 'success');
        await draw();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  ctx.on('click', '[data-trust]', async (e, btn) => {
    await busy(btn, async () => {
      try {
        const r = await api.post(`/api/certificates/${btn.dataset.id}/trust-host`, { host: btn.dataset.trust });
        const n = r.rechecked;
        toast(n === 0
          ? `${r.host} is now trusted`
          : `${r.host} is now trusted. Re-checked ${n} certificate${n === 1 ? '' : 's'}: ${r.verified} verified, ${r.stillWaiting} still need${r.stillWaiting === 1 ? 's' : ''} a look`, 'success');
        await draw();
      } catch (ex) { toast(ex.message, 'error'); }
    }, 'Checking…');
  });

  ctx.on('click', '[data-decide]', async (e, btn) => {
    const decision = btn.dataset.decide;
    const noteEl = ctx.main.querySelector(`[data-note="${btn.dataset.id}"]`);
    const typed = noteEl ? noteEl.value.trim() : '';
    await busy(btn, async () => {
      try {
        await api.post(`/api/certificates/${btn.dataset.id}/review`, {
          decision,
          // Only a resubmit note is ever shown to the student, so only send what the teacher typed.
          note: decision === 'NOT_FOUND' ? typed : (decision === 'VERIFIED' ? 'Faculty confirmed' : ''),
        });
        toast(decision === 'VERIFIED' ? 'Marked verified' : decision === 'NOT_FOUND' ? 'Student asked to resubmit' : 'Dismissed', 'success');
        await draw();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  ctx.main.addEventListener('submit', async e => {
    if (e.target.id !== 'rosterForm') return;
    e.preventDefault();
    const file = $('#rosterFile', ctx.main).files[0];
    const msgEl = $('#rosterMsg', ctx.main);
    if (!file) { msgEl.innerHTML = notice('error', 'Choose a file first.'); return; }
    const form = new FormData();
    form.append('roster', file);
    await busy($('button[type="submit"]', e.target), async () => {
      try {
        const r = await api.post(`/api/classes/${classId}/roster`, form, true);
        rosterMsg = notice('success', `${r.created} student(s) added from ${r.validRows} of ${r.totalRows} valid rows.`) +
          (r.errors.length ? `<div class="notice error" style="margin-top:8px"><ul>${r.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
        await draw();
      } catch (ex) { msgEl.innerHTML = notice('error', ex.message); }
    }, 'Uploading…');
  });

  await draw();
}
