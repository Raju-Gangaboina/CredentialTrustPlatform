// Hash router. Each route is { view, role?, guestOnly?, layout?, redirect? }.
//   role      - the route needs that role signed in, otherwise we bounce to its sign-in page
//   guestOnly - signed-in users are sent to their home page instead
//   layout    - 'app' (sidebar, default) or 'bare' (signed-out pages)
// A view is `async (ctx) => {}` and gets:
//   ctx.params            path parameters
//   ctx.render(html)      writes into the page; returns false if the user already navigated away
//   ctx.head({...})       sets the page header (title, sub, crumbs, actions)
//   ctx.on(type, sel, fn) delegated event listener scoped to this page
//   ctx.alive()           false once another navigation has started
import { session, clearSession, homeFor, loginFor } from './session.js';
import { delegate } from './dom.js';
import { resetShell, setHead } from '../ui/shell.js';
import { errorState } from '../ui/states.js';

const table = [];
let navId = 0;

export function route(pattern, def) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  table.push({ re, keys, ...def });
}

export function go(path) {
  if (location.hash === '#' + path) dispatch();
  else location.hash = '#' + path;
}

function match(path) {
  for (const r of table) {
    const m = path.match(r.re);
    if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export async function dispatch() {
  const id = ++navId;
  const path = location.hash.slice(1).split('?')[0] || '/';
  const hit = match(path);
  if (!hit) return go(homeFor(session.role));

  const { r, params } = hit;
  if (r.redirect) return go(r.redirect);
  if (r.role && session.role !== r.role) return go(loginFor(r.role));
  if (r.guestOnly && session.role) return go(homeFor(session.role));

  const main = resetShell(r.layout || 'app', path);
  const alive = () => id === navId;
  const ctx = {
    params,
    alive,
    render: html => { if (alive()) main.innerHTML = html; return alive(); },
    head: opts => { if (alive()) setHead(opts); },
    on: (type, sel, fn) => delegate(main, type, sel, fn),
    main,
  };

  try {
    await r.view(ctx);
  } catch (e) {
    if (!alive()) return;
    if (e.status === 401 && r.role) { clearSession(); return go(loginFor(r.role)); }
    ctx.render(errorState(e.message));
  }
  if (alive()) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
