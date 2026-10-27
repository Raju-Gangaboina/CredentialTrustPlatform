import { api } from '../core/api.js';
import { $, esc, busy, classLabel } from '../core/dom.js';
import { studentBadge } from '../ui/status.js';
import { emptyState, notice } from '../ui/states.js';
import { toast } from '../ui/toast.js';

// STUDENT-BLIND: this screen never shows an automated verification result, evidence or extracted fields
// (the server doesn't even send them). A student sees "Submitted", then the teacher's own decision.
// See the STUDENT-BLIND note in server/routes/certificates.js before changing what is rendered here.
export async function studentVault(ctx) {
  ctx.head({ title: 'My credential vault' });

  async function draw() {
    const [mine, certs] = await Promise.all([api.get('/api/classes/mine'), api.get('/api/certificates/mine')]);
    if (!ctx.alive()) return;

    ctx.head({
      title: 'My credential vault',
      sub: mine.class ? classLabel(mine.class) : 'Upload each certificate into the subject it belongs to.',
    });

    const subjects = mine.subjects || [];   // every subject vault for the class, not only ones with uploads
    if (subjects.length === 0) {
      ctx.render(emptyState({ title: 'No subjects yet', body: 'Your faculty hasn\'t set up subjects for this class. Check with them.' }));
      return;
    }
    const bySubject = {};
    certs.forEach(c => (bySubject[c.subject_id] = bySubject[c.subject_id] || []).push(c));

    ctx.render(`
      <div class="stack">
        <form id="uploadForm" class="card panel-dark stack-sm">
          <h2>Upload a certificate</h2>
          <p class="muted">Upload the original certificate file you downloaded from the issuer. Your faculty reviews it and their decision shows up here. PDF, PNG, JPG, WebP or BMP.</p>
          <div id="upErr"></div>
          <div class="grid-2">
            <label class="field"><span>Subject</span>
              <select name="subjectId">${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Certificate file</span><input type="file" name="certificate" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,application/pdf,image/*"></label>
          </div>
          <div class="field combo">
            <label for="issuerInput" id="issuerLabel">Issuer / platform <small class="muted">(optional)</small></label>
            <input type="text" name="issuerName" id="issuerInput" maxlength="80" autocomplete="off"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="issuerList"
              placeholder="Start typing, e.g. Udemy, Infosys Springboard, IBM">
            <ul class="combo-list" id="issuerList" role="listbox" aria-labelledby="issuerLabel" hidden></ul>
          </div>
          <div><button class="btn" type="submit">Upload</button></div>
        </form>

        <div class="stack">${subjects.map(s => {
          const items = bySubject[s.id] || [];
          return `<section class="vault">
            <div class="vault-head"><h3>${esc(s.name)}</h3><span class="count">${items.length}</span></div>
            ${items.length === 0 ? '<p class="muted vault-empty">No certificates uploaded yet.</p>' : items.map(c => `
              <div class="vault-item">
                <div class="row between">
                  <span class="filename">${esc(c.original_filename)}</span>
                  <span class="row">
                    ${studentBadge(c.state)}
                    ${c.canWithdraw ? `<button class="btn danger sm" type="button" data-withdraw="${c.id}">Withdraw</button>` : ''}
                  </span>
                </div>
                ${c.state === 'RESUBMIT' ? `<p class="muted" style="margin-top:8px">Your faculty asked for a new upload.${c.note ? ` Note: ${esc(c.note)}` : ''}</p>` : ''}
              </div>`).join('')}
          </section>`;
        }).join('')}</div>
      </div>`);
  }

  ctx.main.addEventListener('submit', async e => {
    if (e.target.id !== 'uploadForm') return;
    e.preventDefault();
    const err = $('#upErr', ctx.main);
    const file = e.target.certificate.files[0];
    const subjectId = e.target.subjectId.value;
    if (!file || !subjectId) { err.innerHTML = notice('error', 'Pick a subject and a file.'); return; }
    const form = new FormData();
    form.append('certificate', file);
    form.append('issuerName', (e.target.issuerName.value || '').trim());
    await busy($('button[type="submit"]', e.target), async () => {
      try {
        await api.post(`/api/certificates/subject/${subjectId}`, form, true);
        toast('Submitted. Your faculty will review it.', 'success');
        await draw();
      } catch (ex) { err.innerHTML = notice('error', ex.message); }
    }, 'Uploading…');
  });

  // ---- Issuer typeahead ----------------------------------------------------------------------------
  // After 2 letters, suggest known issuers from the registry. Free text is still allowed: the list can
  // never hold every issuer, and what the student types is only a HINT shown to the teacher
  // ("Student says: ..."). It is never used by verification and never changes a status.
  let comboTimer = null;
  let comboSeq = 0;
  let comboItems = [];
  let comboActive = -1;

  const comboInput = () => $('#issuerInput', ctx.main);
  const comboList = () => $('#issuerList', ctx.main);

  function comboClose() {
    const input = comboInput(), list = comboList();
    comboItems = []; comboActive = -1;
    if (list) { list.hidden = true; list.innerHTML = ''; }
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  }

  function comboDraw(typed) {
    const input = comboInput(), list = comboList();
    if (!input || !list) return;
    list.innerHTML = comboItems.length
      ? comboItems.map((it, i) => `<li class="combo-item" role="option" id="issuerOpt${i}" data-i="${i}" aria-selected="${i === comboActive}">${esc(it.name)}</li>`).join('')
      : `<li class="combo-empty" role="presentation">No known issuer matches "${esc(typed)}". Keep typing the name as it appears on your certificate.</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (comboActive >= 0) input.setAttribute('aria-activedescendant', `issuerOpt${comboActive}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function comboPick(i) {
    const item = comboItems[i], input = comboInput();
    if (!item || !input) return;
    input.value = item.name;
    comboClose();
  }

  ctx.main.addEventListener('input', e => {
    if (e.target.id !== 'issuerInput') return;
    clearTimeout(comboTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { comboSeq++; comboClose(); return; }
    comboTimer = setTimeout(async () => {
      const seq = ++comboSeq;
      let items = [];
      try { items = await api.get(`/api/issuers/suggest?q=${encodeURIComponent(q)}`); } catch { items = []; }
      if (seq !== comboSeq || !ctx.alive() || !comboInput()) return;   // a newer keystroke or a page change won
      comboItems = Array.isArray(items) ? items : [];
      comboActive = -1;
      comboDraw(q);
    }, 150);
  });

  ctx.main.addEventListener('keydown', e => {
    if (e.target.id !== 'issuerInput') return;
    const open = !comboList().hidden;
    if (e.key === 'ArrowDown' && comboItems.length) {
      e.preventDefault();
      comboActive = (comboActive + 1) % comboItems.length;
      comboDraw(e.target.value);
    } else if (e.key === 'ArrowUp' && comboItems.length) {
      e.preventDefault();
      comboActive = (comboActive - 1 + comboItems.length) % comboItems.length;
      comboDraw(e.target.value);
    } else if (e.key === 'Enter' && open && comboActive >= 0) {
      e.preventDefault();   // choose the highlighted issuer instead of submitting the form
      comboPick(comboActive);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      comboClose();
    }
  });

  ctx.main.addEventListener('mousedown', e => {
    const opt = e.target.closest && e.target.closest('.combo-item');
    if (!opt) return;
    e.preventDefault();     // keep focus in the input so the list doesn't close before the pick lands
    comboPick(Number(opt.dataset.i));
  });

  ctx.main.addEventListener('focusout', e => {
    if (e.target.id === 'issuerInput') comboClose();
  });

  ctx.on('click', '[data-withdraw]', async (e, btn) => {
    if (!confirm('Withdraw this upload? Use this only if it was the wrong file. Your faculty can still see that it was uploaded.')) return;
    await busy(btn, async () => {
      try {
        await api.del(`/api/certificates/${btn.dataset.withdraw}`);
        toast('Upload withdrawn', 'success');
        await draw();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  await draw();
}
