// Owns the fixed frame around every page: layout mode, sidebar, page header, and the fresh <main>.
import { $ } from '../core/dom.js';
import { renderSidebar } from './sidebar.js';
import { renderHead } from './pagehead.js';
import { loadingState } from './states.js';

let bare = false;

// Called at the start of every navigation. Returns a brand-new <main> so old listeners never pile up.
// layout: 'app' (sidebar) | 'bare' (signed-out forms) | 'landing' (bare + the dark landing-page theme)
export function resetShell(layout, path) {
  const landing = layout === 'landing';
  bare = layout === 'bare' || landing;
  $('#app').classList.toggle('bare', bare);
  $('#app').classList.toggle('landing', landing);
  document.body.classList.toggle('is-landing', landing);
  renderSidebar($('#sidebar'), path);
  renderHead($('#pagehead'), { bare });
  if (bare) document.title = 'Credential Trust Platform';
  const old = $('#view');
  const fresh = old.cloneNode(false);
  fresh.innerHTML = loadingState();
  old.replaceWith(fresh);
  return fresh;
}

export function setHead(opts) {
  renderHead($('#pagehead'), { ...opts, bare });
}
