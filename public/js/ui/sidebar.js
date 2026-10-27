// Role-aware main navigation. Rendered fresh on every navigation so the active item is always right.
import { session, homeFor } from '../core/session.js';
import { esc } from '../core/dom.js';
import { icon } from './icons.js';

const NAV = {
  admin: [
    { href: '/admin/faculty', label: 'Teacher approvals', icon: 'faculty', match: /^\/admin\/faculty/ },
    { href: '/admin/teaching', label: 'Who teaches what', icon: 'classes', match: /^\/admin\/teaching/ },
  ],
  faculty: [
    { href: '/faculty/classes', label: 'Classes', icon: 'classes', match: /^\/faculty\/(classes|class)(\/|$)/ },
    { href: '/faculty/teaching', label: 'Subjects I teach', icon: 'faculty', match: /^\/faculty\/teaching/ },
    { href: '/faculty/issuers', label: 'Issuers', icon: 'issuers', match: /^\/faculty\/issuers/ },
  ],
  student: [
    { href: '/student/vault', label: 'My vault', icon: 'vault', match: /^\/student\/vault/ },
  ],
};

const TITLE = { admin: 'Admin', faculty: 'Faculty', student: 'Student' };

const initials = n => (String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('') || '?').toUpperCase();

export function renderSidebar(el, path) {
  if (!session.role) { el.innerHTML = ''; return; }
  const items = NAV[session.role] || [];
  el.innerHTML = `
    <a class="brand" href="#${homeFor(session.role)}"><span class="brand-mark">${icon.seal}</span><span class="brand-text"><strong>Credential Trust</strong><small>Verification platform</small></span></a>
    <div class="nav-title">${TITLE[session.role] || 'Signed in'}</div>
    <ul class="nav">
      ${items.map(i => `<li><a href="#${i.href}"${i.match.test(path) ? ' aria-current="page"' : ''}>${icon[i.icon]}${i.label}</a></li>`).join('')}
    </ul>
    <div class="sidebar-foot">
      <div class="who-row"><span class="avatar" aria-hidden="true">${esc(initials(session.name))}</span><div class="who">${esc(session.name || 'Signed in')}<small>${esc(session.role)}</small></div></div>
      <button class="btn ghost sm" type="button" data-logout>${icon.logout}Sign out</button>
    </div>`;
  el.querySelector('[data-logout]').onclick = () => document.dispatchEvent(new CustomEvent('app:logout'));
}
