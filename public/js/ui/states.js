// Loading, error, empty and inline-notice markup.
import { esc } from '../core/dom.js';

export const loadingState = () => '<div class="loading" role="status">Loading…</div>';

export const errorState = message => `
  <div class="state">
    <h2>Something went wrong</h2>
    <p>${esc(message)}</p>
    <button class="btn secondary" type="button" onclick="location.reload()">Try again</button>
  </div>`;

export const emptyState = ({ title, body = '', action = '' }) => `
  <div class="state">
    <h2>${esc(title)}</h2>
    ${body ? `<p>${esc(body)}</p>` : ''}
    ${action}
  </div>`;

// kind: 'error' | 'success' | 'warn' | ''
export const notice = (kind, message) => `<div class="notice ${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${esc(message)}</div>`;
