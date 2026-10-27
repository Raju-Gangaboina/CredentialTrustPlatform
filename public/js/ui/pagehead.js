// Page header: breadcrumbs, title, subtitle and (link-style) action buttons.
// Signed-out pages show just the brand.
import { esc } from '../core/dom.js';
import { icon } from './icons.js';

export function renderHead(el, { title = '', sub = '', crumbs = [], actions = '', bare = false } = {}) {
  if (bare) {
    el.hidden = false;
    el.innerHTML = `<a class="brand" href="#/"><span class="brand-mark">${icon.seal}</span><span class="brand-text"><strong>Credential Trust</strong><small>Verification platform</small></span></a>`;
    return;
  }
  document.title = title ? `${title} · Credential Trust Platform` : 'Credential Trust Platform';
  if (!title) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="pagehead-main">
      ${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(c => `<a href="#${c.href}">${esc(c.label)}</a>`).join('<span aria-hidden="true">/</span>')}</nav>` : ''}
      <h1>${esc(title)}</h1>
      ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
    </div>
    ${actions ? `<div class="pagehead-actions">${actions}</div>` : ''}`;
}
