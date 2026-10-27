// Campus Credential Trust Platform — client app.
// Plain JS, hash-based routing, fetch() against /api/*. No framework.

const api = {
  async call(method, url, body, isForm) {
    const opts = { method, credentials: 'include' };
    if (body) {
      if (isForm) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  },
  get(url) { return this.call('GET', url); },
  post(url, body, isForm) { return this.call('POST', url, body, isForm); }
};

const app = document.getElementById('app');
const sessionChip = document.getElementById('sessionChip');

let session = { facultyId: null, studentId: null, facultyName: null, studentName: null };

async function refreshSession() {
  try {
    const me = await api.get('/api/auth/me');
    session.facultyId = me.facultyId;
    session.studentId = me.studentId;
  } catch (e) { /* ignore */ }
  renderSessionChip();
}

function renderSessionChip() {
  if (session.facultyId) {
    sessionChip.innerHTML = `Faculty session ${session.facultyName ? '· ' + esc(session.facultyName) : ''} <button class="ghost" id="logoutBtn">Log out</button>`;
  } else if (session.studentId) {
    sessionChip.innerHTML = `Student session ${session.studentName ? '· ' + esc(session.studentName) : ''} <button class="ghost" id="logoutBtn">Log out</button>`;
  } else {
    sessionChip.innerHTML = '';
    return;
  }
  document.getElementById('logoutBtn').onclick = async () => {
    await api.post('/api/auth/logout');
    session = { facultyId: null, studentId: null };
    location.hash = '#/';
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status.replace('_',' ')}</span>`;
}

function evidenceList(evidence) {
  if (!evidence || !evidence.length) return '<p class="muted">No evidence recorded.</p>';
  return `<ul class="evidence-list">${evidence.map(e => `
    <li><span class="mark ${e.pass === null ? '' : (e.pass ? 'pass' : 'fail')}">${e.pass === null ? '–' : (e.pass ? '✓' : '✕')}</span><span>${esc(e.label)}</span></li>
  `).join('')}</ul>`;
}

// Status shows as just the badge. The tick/cross checklist only exists behind a click, and only
// for results that aren't cleanly VERIFIED — a verified certificate needs no explanation.
function evidenceBlock(status, evidence) {
  if (status === 'VERIFIED' || status === 'PENDING') return '';
  return `<details class="evidence-details"><summary>Why? View details</summary>${evidenceList(evidence)}</details>`;
}

function classLabel(c) {
  return `${c.program} — ${c.year} — Section ${c.section} (${c.academic_year})`;
}

// ---------- Router ----------
const routes = {
  '/': renderLanding,
  '/faculty/login': renderFacultyLogin,
  '/faculty/dashboard': renderFacultyDashboard,
  '/faculty/issuers': renderIssuerAdmin,
  '/student/login': renderStudentLogin,
  '/student/vault': renderStudentVault,
};

function router() {
  const hash = location.hash.replace('#', '') || '/';
  const classMatch = hash.match(/^\/faculty\/class\/(\d+)$/);
  if (classMatch) return renderClassDetail(Number(classMatch[1]));
  const fn = routes[hash] || renderLanding;
  fn();
}
window.addEventListener('hashchange', router);

// ---------- Views ----------
function renderLanding() {
  app.innerHTML = `
    <h1>Who's signing in?</h1>
    <p class="lede">Faculty manage classes, rosters, and review flagged certificates. Students upload
    coursework certificates into their class's subject vaults.</p>
    <div class="role-picker">
      <div class="role-card" id="pickFaculty">
        <h3>Faculty</h3>
        <p>Create a class, upload the roster, review flagged credentials, see the trust dashboard.</p>
      </div>
      <div class="role-card" id="pickStudent">
        <h3>Student</h3>
        <p>Find your class by name, log in with your roll number, upload certificates.</p>
      </div>
    </div>
  `;
  document.getElementById('pickFaculty').onclick = () => location.hash = '#/faculty/login';
  document.getElementById('pickStudent').onclick = () => location.hash = '#/student/login';
}

function renderFacultyLogin() {
  app.innerHTML = `
    <h1>Faculty</h1>
    <div class="grid-2">
      <div class="card">
        <h3>Log in</h3>
        <div id="loginError"></div>
        <div class="field"><label>Email</label><input id="loginEmail" type="email"></div>
        <div class="field"><label>Password</label><input id="loginPassword" type="password"></div>
        <button id="loginBtn">Log in</button>
      </div>
      <div class="card">
        <h3>First time here? Create an account</h3>
        <div id="signupError"></div>
        <div class="field"><label>Name</label><input id="suName"></div>
        <div class="field"><label>Email</label><input id="suEmail" type="email"></div>
        <div class="field"><label>Password</label><input id="suPassword" type="password"></div>
        <button id="signupBtn">Create account</button>
      </div>
    </div>
  `;
  document.getElementById('loginBtn').onclick = async () => {
    const errEl = document.getElementById('loginError');
    errEl.innerHTML = '';
    try {
      const r = await api.post('/api/auth/faculty/login', {
        email: val('loginEmail'), password: val('loginPassword')
      });
      session.facultyId = r.facultyId; session.facultyName = r.name;
      renderSessionChip();
      location.hash = '#/faculty/dashboard';
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
  document.getElementById('signupBtn').onclick = async () => {
    const errEl = document.getElementById('signupError');
    errEl.innerHTML = '';
    try {
      const r = await api.post('/api/auth/faculty/signup', {
        name: val('suName'), email: val('suEmail'), password: val('suPassword')
      });
      session.facultyId = r.facultyId; session.facultyName = val('suName');
      renderSessionChip();
      location.hash = '#/faculty/dashboard';
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
}

function val(id) { return document.getElementById(id).value.trim(); }

async function renderFacultyDashboard() {
  if (!session.facultyId) { location.hash = '#/faculty/login'; return; }
  app.innerHTML = `<h1>Your classes</h1><p class="lede">Loading…</p>`;
  let classes, programs;
  try {
    [classes, programs] = await Promise.all([api.get('/api/classes'), api.get('/api/catalog/programs')]);
  }
  catch (e) { app.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return; }

  app.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h1>Your classes</h1>
      <button class="secondary" id="goIssuersBtn" type="button">Manage issuers</button>
    </div>
    <div class="card">
      <h3>Create a new class</h3>
      <div id="createError"></div>
      <div class="grid-2">
        <div class="field">
          <label>Course</label>
          <select id="cProgram">
            ${programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
            <option value="__new__">+ Add a new course…</option>
          </select>
        </div>
        <div class="field">
          <label>Semester</label>
          <select id="cSemester"></select>
        </div>
        <div class="field"><label>Section</label><input id="cSection" placeholder="A"></div>
        <div class="field"><label>Academic year</label><input id="cAcademicYear" placeholder="2026–27"></div>
      </div>

      <div id="newProgramForm" style="display:none; border:1px dashed var(--line); border-radius:8px; padding:14px; margin-bottom:14px;">
        <div class="grid-2">
          <div class="field"><label>New course name</label><input id="npName" placeholder="e.g. B.Com (Honours)"></div>
          <div class="field"><label>Number of semesters</label><input id="npSemesters" type="number" min="1" max="12" value="6"></div>
        </div>
        <button class="secondary" id="npSaveBtn" type="button">Save course</button>
      </div>

      <div class="field">
        <label>Subjects for this semester <span class="muted">(uncheck any that don't apply, or add one that's missing)</span></label>
        <div id="subjectPicker" class="subject-picker"><p class="muted">Loading subjects…</p></div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <input id="newSubjectName" placeholder="Add a subject not listed above" style="flex:1; padding:9px 11px; border:1px solid var(--line); border-radius:7px; background:var(--paper);">
          <button class="secondary" id="addSubjectBtn" type="button">Add</button>
        </div>
      </div>

      <button id="createClassBtn">Create class</button>
    </div>
    <h2>Existing classes</h2>
    <div id="classList">
      ${classes.length === 0 ? '<p class="muted">No classes yet.</p>' : classes.map(c => `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3>${esc(c.program)} — ${esc(c.year)} — Section ${esc(c.section)}</h3>
              <p class="muted">${esc(c.academic_year)}</p>
            </div>
            <button class="secondary" data-open="${c.id}">Open</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const programSelect = document.getElementById('cProgram');
  const semesterSelect = document.getElementById('cSemester');
  const newProgramForm = document.getElementById('newProgramForm');
  const subjectPicker = document.getElementById('subjectPicker');
  let catalogSubjects = [];
  let extraSubjects = [];

  function currentProgramTotalSemesters() {
    if (programSelect.value === '__new__') return 6;
    const p = programs.find(pp => String(pp.id) === programSelect.value);
    return p ? p.total_semesters : 6;
  }

  function renderSemesterOptions() {
    const total = currentProgramTotalSemesters();
    semesterSelect.innerHTML = Array.from({ length: total }, (_, i) => `<option value="Semester ${i + 1}">Semester ${i + 1}</option>`).join('');
  }

  function renderSubjectPicker(note) {
    const all = [...catalogSubjects, ...extraSubjects];
    if (all.length === 0) {
      subjectPicker.innerHTML = `<p class="muted">${note ? esc(note) : "No subjects listed yet for this semester — add some below."}</p>`;
      return;
    }
    subjectPicker.innerHTML = all.map(name => `
      <label class="subject-checkbox">
        <input type="checkbox" checked data-subject-name="${esc(name)}">
        <span>${esc(name)}</span>
      </label>
    `).join('');
  }

  async function renderSubjectsForSelection() {
    if (programSelect.value === '__new__') {
      catalogSubjects = [];
      subjectPicker.innerHTML = '<p class="muted">Save the new course first, then add its subjects below.</p>';
      return;
    }
    subjectPicker.innerHTML = '<p class="muted">Loading subjects…</p>';
    try {
      const r = await api.get(`/api/catalog/programs/${programSelect.value}/subjects?semester=${encodeURIComponent(semesterSelect.value)}`);
      catalogSubjects = r.subjects.map(s => s.name);
      renderSubjectPicker(r.program && r.program.note);
    } catch (e) {
      subjectPicker.innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    }
  }

  programSelect.onchange = async () => {
    newProgramForm.style.display = programSelect.value === '__new__' ? 'block' : 'none';
    extraSubjects = [];
    renderSemesterOptions();
    await renderSubjectsForSelection();
  };
  semesterSelect.onchange = async () => {
    extraSubjects = [];
    await renderSubjectsForSelection();
  };

  document.getElementById('addSubjectBtn').onclick = () => {
    const input = document.getElementById('newSubjectName');
    const name = input.value.trim();
    if (!name) return;
    extraSubjects.push(name);
    input.value = '';
    renderSubjectPicker();
  };

  document.getElementById('npSaveBtn').onclick = async () => {
    const errEl = document.getElementById('createError');
    errEl.innerHTML = '';
    const name = val('npName');
    const totalSemesters = Number(document.getElementById('npSemesters').value);
    if (!name || !totalSemesters) { errEl.innerHTML = `<div class="notice error">Enter a course name and number of semesters.</div>`; return; }
    try {
      const r = await api.post('/api/catalog/programs', { name, totalSemesters });
      const newProgram = { id: r.programId, name, total_semesters: totalSemesters };
      programs.push(newProgram);
      const opt = document.createElement('option');
      opt.value = String(newProgram.id);
      opt.textContent = name;
      programSelect.insertBefore(opt, programSelect.querySelector('option[value="__new__"]'));
      programSelect.value = String(newProgram.id);
      newProgramForm.style.display = 'none';
      renderSemesterOptions();
      await renderSubjectsForSelection();
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };

  renderSemesterOptions();
  await renderSubjectsForSelection();

  document.getElementById('createClassBtn').onclick = async () => {
    const errEl = document.getElementById('createError');
    errEl.innerHTML = '';
    if (programSelect.value === '__new__') { errEl.innerHTML = `<div class="notice error">Save the new course first (or pick an existing one).</div>`; return; }
    const programName = programSelect.options[programSelect.selectedIndex].textContent;
    const semesterLabel = semesterSelect.value;
    const section = val('cSection');
    const academicYear = val('cAcademicYear');
    if (!section || !academicYear) { errEl.innerHTML = `<div class="notice error">Section and academic year are required.</div>`; return; }

    const checked = Array.from(subjectPicker.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.dataset.subjectName);
    if (checked.length === 0) { errEl.innerHTML = `<div class="notice error">Pick at least one subject (or add one) for this class.</div>`; return; }

    try {
      const r = await api.post('/api/classes', {
        program: programName, year: semesterLabel, section, academicYear, subjects: checked
      });
      location.hash = `#/faculty/class/${r.classId}`;
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
  document.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = () => location.hash = `#/faculty/class/${btn.dataset.open}`;
  });
  document.getElementById('goIssuersBtn').onclick = () => location.hash = '#/faculty/issuers';
}

// ---------- Issuer admin ----------
function issuerMethodLabel(m) {
  return m === 'domain_link' ? 'Domain recognition (generic link-checking)' : 'Adapter-backed (custom code)';
}

async function renderIssuerAdmin() {
  if (!session.facultyId) { location.hash = '#/faculty/login'; return; }
  app.innerHTML = `<p class="lede">Loading…</p>`;
  let issuers;
  try { issuers = await api.get('/api/issuers'); }
  catch (e) { app.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return; }

  app.innerHTML = `
    <button class="link-btn" id="backBtn">← Dashboard</button>
    <h1>Issuers</h1>
    <p class="lede">These control which certificate links get treated as coming from a real,
    recognized issuer. Adding a domain here lets a matching, text-confirmed certificate reach
    <strong>VERIFIED</strong> automatically instead of capping at NEEDS_REVIEW for an unrecognized
    site. This only covers domain-based recognition — issuers with custom verification code
    (currently just Saylor Academy) need a code change to add, though you can still edit their
    display name, status, or ID-format pattern here.</p>

    <div class="card">
      <h3>Add a new issuer</h3>
      <div id="addIssuerError"></div>
      <div class="grid-2">
        <div class="field"><label>Issuer key</label><input id="newIssuerKey" placeholder="e.g. infosys-wingspan"></div>
        <div class="field"><label>Display name</label><input id="newIssuerName" placeholder="e.g. Infosys Wingspan"></div>
      </div>
      <div class="field"><label>Domain(s), comma-separated</label><input id="newIssuerDomains" placeholder="e.g. onwingspan.com, verify.onwingspan.com"></div>
      <button id="addIssuerBtn">Add issuer</button>
    </div>

    <h2>Registered issuers</h2>
    ${issuers.length === 0 ? '<p class="muted">None yet.</p>' : issuers.map(iss => `
      <div class="card" data-issuer-card="${esc(iss.issuerKey)}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h3>${esc(iss.displayName)} <span class="muted">(${esc(iss.issuerKey)})</span></h3>
            <p class="muted">${issuerMethodLabel(iss.verificationMethod)}${iss.hasAdapterCode ? ' · has custom verification code' : ''}</p>
          </div>
          <span class="badge ${iss.status === 'active' ? 'VERIFIED' : 'NOT_FOUND'}">${esc(iss.status)}</span>
        </div>
        <div class="field"><label>Display name</label><input class="edit-name" value="${esc(iss.displayName)}"></div>
        ${iss.verificationMethod === 'domain_link' ? `
          <div class="field"><label>Domain(s), comma-separated</label><input class="edit-domains" value="${esc(iss.domains.join(', '))}"></div>
        ` : `
          <div class="field"><label>Certificate-ID pattern (regex, advanced)</label><input class="edit-idpattern" value="${esc(iss.idPattern || '')}"></div>
        `}
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="secondary" data-save="${esc(iss.issuerKey)}" type="button">Save changes</button>
          <button class="${iss.status === 'active' ? 'danger' : ''}" data-toggle="${esc(iss.issuerKey)}" data-next="${iss.status === 'active' ? 'inactive' : 'active'}" type="button">${iss.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        </div>
        <div class="save-msg"></div>
      </div>
    `).join('')}
  `;

  document.getElementById('backBtn').onclick = () => location.hash = '#/faculty/dashboard';

  document.getElementById('addIssuerBtn').onclick = async () => {
    const errEl = document.getElementById('addIssuerError');
    errEl.innerHTML = '';
    try {
      await api.post('/api/issuers', {
        issuerKey: val('newIssuerKey'),
        displayName: val('newIssuerName'),
        domains: val('newIssuerDomains')
      });
      renderIssuerAdmin();
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };

  document.querySelectorAll('[data-save]').forEach(btn => {
    btn.onclick = async () => {
      const key = btn.dataset.save;
      const card = document.querySelector(`[data-issuer-card="${CSS.escape(key)}"]`);
      const msgEl = card.querySelector('.save-msg');
      const body = { displayName: card.querySelector('.edit-name').value.trim() };
      const domainsInput = card.querySelector('.edit-domains');
      const idPatternInput = card.querySelector('.edit-idpattern');
      if (domainsInput) body.domains = domainsInput.value;
      if (idPatternInput) body.idPattern = idPatternInput.value;
      try {
        await api.call('PUT', `/api/issuers/${encodeURIComponent(key)}`, body);
        msgEl.innerHTML = `<div class="notice success">Saved.</div>`;
      } catch (e) { msgEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
    };
  });

  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api.call('PUT', `/api/issuers/${encodeURIComponent(btn.dataset.toggle)}`, { status: btn.dataset.next });
        renderIssuerAdmin();
      } catch (e) { alert(e.message); }
    };
  });
}

async function renderClassDetail(classId) {
  if (!session.facultyId) { location.hash = '#/faculty/login'; return; }
  app.innerHTML = `<p class="lede">Loading…</p>`;

  let detail, stats, queue;
  try {
    [detail, stats, queue] = await Promise.all([
      api.get(`/api/classes/${classId}`),
      api.get(`/api/certificates/stats/${classId}`),
      api.get(`/api/certificates/review-queue/${classId}`)
    ]);
  } catch (e) { app.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return; }

  const c = detail.class;
  const statusOrder = ['VERIFIED', 'NEEDS_REVIEW', 'NOT_FOUND', 'PENDING'];
  const overallMap = Object.fromEntries(stats.overall.map(o => [o.status, o.n]));

  app.innerHTML = `
    <button class="link-btn" id="backBtn">← All classes</button>
    <h1>${esc(c.program)} — ${esc(c.year)} — Section ${esc(c.section)}</h1>
    <p class="lede">${esc(c.academic_year)} · ${detail.students.length} students on roster</p>

    <div class="card" style="border-color: var(--accent); background: var(--accent-soft);">
      <h3 style="margin-bottom:4px;">Give this to your students</h3>
      <p class="muted" style="margin-bottom:10px;">Students search for the class by NAME when they
      log in — they don't need this number. Only share it if you'd rather tell them directly.</p>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="muted">Class name they should search for:</span>
        <strong>${esc(classLabel(c))}</strong>
      </div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:6px;">
        <span class="muted">Raw Class ID (fallback):</span>
        <code style="font-size:1.1rem; font-weight:700;">${c.id}</code>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-box"><div class="n">${detail.students.length}</div><div class="label">Students</div></div>
      ${statusOrder.map(s => `<div class="stat-box"><div class="n">${overallMap[s] || 0}</div><div class="label">${s.replace('_',' ')}</div></div>`).join('')}
    </div>

    <h2>Verification by subject</h2>
    <div class="card">
      <table>
        <thead><tr><th>Subject</th>${statusOrder.map(s => `<th>${s.replace('_',' ')}</th>`).join('')}</tr></thead>
        <tbody>
          ${detail.subjects.map(sub => {
            const counts = Object.fromEntries(stats.perSubject.filter(p => p.subject_name === sub.name).map(p => [p.status, p.n]));
            return `<tr><td>${esc(sub.name)}</td>${statusOrder.map(s => `<td>${counts[s] || 0}</td>`).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <h2>Review queue ${queue.length ? `<span class="badge NEEDS_REVIEW">${queue.length} pending</span>` : ''}</h2>
    <div id="reviewQueue">
      ${queue.length === 0 ? '<p class="muted">Nothing needs manual review right now.</p>' : queue.map(cert => `
        <div class="card">
          <div style="display:flex; justify-content:space-between;">
            <div>
              <h3>${esc(cert.student_name)} (${esc(cert.roll_number)}) — ${esc(cert.subject_name)}</h3>
              <p class="muted">${esc(cert.original_filename)}</p>
            </div>
            ${statusBadge(cert.status)}
          </div>
          ${evidenceBlock(cert.status, cert.evidence)}
          <div style="margin-top:12px; display:flex; gap:8px;">
            <button data-approve="${cert.id}">Mark verified</button>
            <button class="danger" data-reject="${cert.id}">Mark not found</button>
          </div>
        </div>
      `).join('')}
    </div>

    <h2>Roster</h2>
    <div class="card">
      <h3>Upload / update student list (.xlsx — roll-number and name columns, any reasonable header names)</h3>
      <div id="rosterMsg"></div>
      <input type="file" id="rosterFile" accept=".xlsx,.xls">
      <button id="rosterBtn" style="margin-left:10px;">Upload roster</button>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Roll number</th><th>Name</th><th>Account</th></tr></thead>
        <tbody>
          ${detail.students.map(s => `<tr><td>${esc(s.roll_number)}</td><td>${esc(s.name)}</td><td>${s.activated ? 'Activated' : 'Not activated yet'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('backBtn').onclick = () => location.hash = '#/faculty/dashboard';

  document.getElementById('rosterBtn').onclick = async () => {
    const msgEl = document.getElementById('rosterMsg');
    const fileInput = document.getElementById('rosterFile');
    if (!fileInput.files.length) { msgEl.innerHTML = `<div class="notice error">Choose a file first.</div>`; return; }
    const form = new FormData();
    form.append('roster', fileInput.files[0]);
    try {
      const r = await api.post(`/api/classes/${classId}/roster`, form, true);
      msgEl.innerHTML = `<div class="notice success">${r.created} student(s) added from ${r.validRows}/${r.totalRows} valid rows.</div>
        ${r.errors.length ? `<div class="errors-list">${r.errors.map(esc).join('<br>')}</div>` : ''}`;
      setTimeout(() => renderClassDetail(classId), 900);
    } catch (e) { msgEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };

  document.querySelectorAll('[data-approve]').forEach(btn => {
    btn.onclick = async () => {
      await api.post(`/api/certificates/${btn.dataset.approve}/review`, { decision: 'VERIFIED', note: 'Faculty confirmed' });
      renderClassDetail(classId);
    };
  });
  document.querySelectorAll('[data-reject]').forEach(btn => {
    btn.onclick = async () => {
      await api.post(`/api/certificates/${btn.dataset.reject}/review`, { decision: 'NOT_FOUND', note: 'Faculty could not confirm' });
      renderClassDetail(classId);
    };
  });
}

function renderStudentLogin() {
  app.innerHTML = `
    <h1>Student</h1>
    <p class="lede">Search for your class by name below, then log in with your roll number. First time
    here? Activate your account instead — it's created automatically once your faculty uploads the roster.</p>

    <div class="card">
      <h3>Find your class</h3>
      <div class="field"><label>Program / section / academic year</label><input id="classSearch" placeholder="Start typing e.g. B.Sc CS, Section A…"></div>
      <div id="classResults" class="muted"></div>
      <div id="selectedClass" style="margin-top:8px;"></div>
    </div>

    <div class="grid-2" id="loginForms" style="display:none;">
      <div class="card">
        <h3>Log in</h3>
        <div id="sLoginError"></div>
        <div class="field"><label>Roll number</label><input id="sRoll"></div>
        <div class="field"><label>Password</label><input id="sPassword" type="password"></div>
        <button id="sLoginBtn">Log in</button>
      </div>
      <div class="card">
        <h3>Activate account (first time)</h3>
        <div id="sActError"></div>
        <div class="field"><label>Roll number</label><input id="aRoll"></div>
        <div class="field"><label>Choose a password</label><input id="aPassword" type="password"></div>
        <button id="sActBtn">Activate</button>
      </div>
    </div>
  `;

  let selectedClassId = null;
  const searchInput = document.getElementById('classSearch');
  const resultsEl = document.getElementById('classResults');
  const selectedEl = document.getElementById('selectedClass');
  const formsEl = document.getElementById('loginForms');

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const results = await api.get(`/api/classes/public/search?q=${encodeURIComponent(q)}`);
        resultsEl.innerHTML = results.length === 0
          ? 'No matching classes found.'
          : results.map(c => `<div class="link-btn" style="display:block; margin:4px 0; text-align:left;" data-pick="${c.id}" data-label="${esc(classLabel(c))}">${esc(classLabel(c))}</div>`).join('');
        resultsEl.querySelectorAll('[data-pick]').forEach(el => {
          el.onclick = () => {
            selectedClassId = Number(el.dataset.pick);
            selectedEl.innerHTML = `<div class="notice success">Selected: ${esc(el.dataset.label)} (Class ID ${selectedClassId})</div>`;
            resultsEl.innerHTML = '';
            searchInput.value = '';
            formsEl.style.display = 'grid';
          };
        });
      } catch (e) { resultsEl.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
    }, 250);
  });

  document.getElementById('sLoginBtn').onclick = async () => {
    const errEl = document.getElementById('sLoginError');
    errEl.innerHTML = '';
    if (!selectedClassId) { errEl.innerHTML = `<div class="notice error">Pick your class above first.</div>`; return; }
    try {
      const r = await api.post('/api/auth/student/login', { rollNumber: val('sRoll'), classId: selectedClassId, password: val('sPassword') });
      session.studentId = r.studentId; session.studentName = r.name;
      renderSessionChip();
      location.hash = '#/student/vault';
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
  document.getElementById('sActBtn').onclick = async () => {
    const errEl = document.getElementById('sActError');
    errEl.innerHTML = '';
    if (!selectedClassId) { errEl.innerHTML = `<div class="notice error">Pick your class above first.</div>`; return; }
    try {
      await api.post('/api/auth/student/activate', { rollNumber: val('aRoll'), classId: selectedClassId, password: val('aPassword') });
      session.studentId = true;
      renderSessionChip();
      location.hash = '#/student/vault';
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
}

async function renderStudentVault() {
  if (!session.studentId) { location.hash = '#/student/login'; return; }
  app.innerHTML = `<p class="lede">Loading…</p>`;
  let mine, certs;
  try {
    [mine, certs] = await Promise.all([api.get('/api/classes/mine'), api.get('/api/certificates/mine')]);
  }
  catch (e) { app.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; return; }

  const subjects = mine.subjects || []; // every subject vault for the student's class, not just ones with uploads
  const certsBySubjectId = {};
  certs.forEach(c => { (certsBySubjectId[c.subject_id] = certsBySubjectId[c.subject_id] || []).push(c); });

  app.innerHTML = `
    <h1>Your credential vault</h1>
    <p class="lede">${mine.class ? esc(classLabel(mine.class)) + ' · ' : ''}Upload a certificate into the subject it belongs to. Each upload is checked against
    what its issuer can confirm — status updates automatically or gets queued for your faculty to review.</p>

    <div class="card">
      <h3>Upload a certificate</h3>
      <div id="upErr"></div>
      <div class="field">
        <label>Subject</label>
        <select id="upSubjectId">
          ${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
        </select>
      </div>
      <input type="file" id="upFile" accept="application/pdf">
      <button id="upBtn" style="margin-left:10px;">Upload</button>
    </div>

    ${subjects.length === 0 ? '<p class="muted">No subjects have been set up for your class yet — check with your faculty.</p>' : subjects.map(s => `
      <div class="subject-vault">
        <div class="subject-vault-head"><h3>${esc(s.name)}</h3></div>
        ${(certsBySubjectId[s.id] || []).length === 0 ? '<p class="muted">No certificates uploaded yet.</p>' : certsBySubjectId[s.id].map(c => `
          <div style="border-top:1px solid var(--line); padding-top:10px; margin-top:10px;">
            <div style="display:flex; justify-content:space-between;">
              <span>${esc(c.original_filename)}</span>
              <span style="display:flex; gap:10px; align-items:center;">
                ${statusBadge(c.status)}
                <button class="danger" data-delete-cert="${c.id}" type="button" style="padding:4px 10px; font-size:0.85rem;">Delete</button>
              </span>
            </div>
            ${evidenceBlock(c.status, c.evidence)}
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;

  document.querySelectorAll('[data-delete-cert]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this certificate? This cannot be undone.')) return;
      try {
        await api.call('DELETE', `/api/certificates/${btn.dataset.deleteCert}`);
        renderStudentVault();
      } catch (e) { alert(e.message); }
    };
  });

  document.getElementById('upBtn').onclick = async () => {
    const errEl = document.getElementById('upErr');
    errEl.innerHTML = '';
    const fileInput = document.getElementById('upFile');
    const subjectSelect = document.getElementById('upSubjectId');
    const subjectId = subjectSelect ? subjectSelect.value : '';
    if (!fileInput.files.length || !subjectId) { errEl.innerHTML = `<div class="notice error">Pick a subject and a file.</div>`; return; }
    const form = new FormData();
    form.append('certificate', fileInput.files[0]);
    try {
      await api.post(`/api/certificates/subject/${subjectId}`, form, true);
      renderStudentVault();
    } catch (e) { errEl.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; }
  };
}

// ---------- Boot ----------
refreshSession().then(router);
