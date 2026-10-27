import { api } from '../core/api.js';
import { $, $$, esc, busy } from '../core/dom.js';
import { notice, emptyState } from '../ui/states.js';
import { toast } from '../ui/toast.js';

const methodLabel = m => (m === 'domain_link' ? 'Domain recognition (generic link checking)' : 'Adapter-backed (custom code)');

export async function issuers(ctx) {
  ctx.head({
    title: 'Issuers',
    sub: 'Which certificate links are treated as coming from a real, recognised issuer.',
  });

  let query = '';   // the search box text, kept across redraws (save / activate re-render the list)

  // Hide the cards that don't match every word typed in the search box (name, key, websites, alternative names).
  function applyFilter() {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const cards = $$('[data-issuer]', ctx.main);
    let shown = 0;
    for (const c of cards) {
      const hit = terms.every(t => c.dataset.search.includes(t));
      c.style.display = hit ? '' : 'none';
      if (hit) shown++;
    }
    const count = $('#issuerCount', ctx.main);
    if (count) count.textContent = terms.length ? `Showing ${shown} of ${cards.length}` : `${cards.length} issuers`;
    const none = $('#issuerNone', ctx.main);
    if (none) none.hidden = !(terms.length && shown === 0);
  }

  async function draw() {
    const list = await api.get('/api/issuers');
    if (!ctx.alive()) return;
    ctx.render(`
      <div class="stack">
        ${notice('', 'Adding a domain lets a matching, text-confirmed certificate reach Verified automatically instead of stopping at Needs review for an unrecognised site. Issuers with custom verification code (such as Saylor Academy) need a code change to add, but you can still edit their display name, status or ID pattern here.')}

        <details class="card" id="addCard">
          <summary><strong>Add an issuer</strong></summary>
          <form id="addForm" class="stack-sm" style="margin-top:14px" novalidate>
            <div id="addErr"></div>
            <label class="field"><span>Display name</span><input name="displayName" placeholder="e.g. Infosys Wingspan" required></label>
            <label class="field"><span>Domains, comma-separated</span><input name="domains" placeholder="e.g. onwingspan.com, verify.onwingspan.com" required></label>
            <div><button class="btn" type="submit">Add issuer</button></div>
          </form>
        </details>

        <section>
          <div class="row between">
            <h2 class="section-title">Registered issuers</h2>
            <span class="muted" id="issuerCount"></span>
          </div>
          <label class="field" style="margin-bottom:14px"><span>Search issuers</span>
            <input type="search" id="issuerSearch" value="${esc(query)}" autocomplete="off" placeholder="Name, key or website, e.g. saylor"></label>
          <p class="muted" id="issuerNone" hidden>No issuer matches that search.</p>
          ${list.length === 0 ? emptyState({ title: 'No issuers yet' }) : `<div class="issuer-grid">${list.map(iss => `
            <div class="card stack-sm" data-issuer="${esc(iss.issuerKey)}" data-search="${esc([iss.displayName, iss.issuerKey, ...iss.domains, ...iss.builtInDomains, ...iss.aliases].join(' ').toLowerCase())}">
              <div class="card-head">
                <div>
                  <h3>${esc(iss.displayName)} <span class="muted mono">${esc(iss.issuerKey)}</span></h3>
                  <p class="muted">${methodLabel(iss.verificationMethod)}${iss.hasAdapterCode ? ' · has custom verification code' : ''}</p>
                </div>
                <span class="badge ${iss.status === 'active' ? 'badge--ok' : 'badge--idle'}">${esc(iss.status)}</span>
              </div>
              <label class="field"><span>Display name</span><input class="f-name" value="${esc(iss.displayName)}"></label>
              ${iss.verificationMethod === 'domain_link'
                ? `<label class="field"><span>Domains, comma-separated</span><input class="f-domains" value="${esc(iss.domains.join(', '))}"></label>`
                : `<label class="field"><span>Certificate ID pattern (regex, advanced)</span><input class="f-pattern mono" value="${esc(iss.idPattern || '')}"></label>
                   <p class="muted">This is the format of the certificate number, not a website.${iss.builtInDomains.length ? ` Websites it already recognises: <span class="mono">${esc(iss.builtInDomains.join(', '))}</span>.` : ''}</p>`}
              <div class="row">
                <button class="btn secondary" type="button" data-save="${esc(iss.issuerKey)}">Save changes</button>
                <button class="btn ${iss.status === 'active' ? 'danger' : ''}" type="button" data-toggle="${esc(iss.issuerKey)}" data-next="${iss.status === 'active' ? 'inactive' : 'active'}">${iss.status === 'active' ? 'Deactivate' : 'Activate'}</button>
              </div>
            </div>`).join('')}</div>`}
        </section>
      </div>`);
    applyFilter();
  }

  ctx.on('input', '#issuerSearch', (e, input) => { query = input.value; applyFilter(); });

  ctx.main.addEventListener('submit', async e => {
    if (e.target.id !== 'addForm') return;
    e.preventDefault();
    const err = $('#addErr', ctx.main);
    err.innerHTML = '';
    await busy($('button[type="submit"]', e.target), async () => {
      try {
        await api.post('/api/issuers', Object.fromEntries(new FormData(e.target)));
        toast('Issuer added', 'success');
        await draw();
      } catch (ex) { err.innerHTML = notice('error', ex.message); }
    }, 'Adding…');
  });

  ctx.on('click', '[data-save]', async (e, btn) => {
    const card = btn.closest('[data-issuer]');
    const body = { displayName: $('.f-name', card).value.trim() };
    const domains = $('.f-domains', card), pattern = $('.f-pattern', card);
    if (domains) body.domains = domains.value;
    if (pattern) body.idPattern = pattern.value;
    await busy(btn, async () => {
      try {
        await api.put(`/api/issuers/${encodeURIComponent(btn.dataset.save)}`, body);
        toast('Changes saved', 'success');
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  ctx.on('click', '[data-toggle]', async (e, btn) => {
    await busy(btn, async () => {
      try {
        await api.put(`/api/issuers/${encodeURIComponent(btn.dataset.toggle)}`, { status: btn.dataset.next });
        await draw();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });

  await draw();
}
