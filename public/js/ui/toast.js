// Transient confirmation messages (replaces alert()).
import { esc } from '../core/dom.js';

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = esc(message);
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}
