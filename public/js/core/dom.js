// Small DOM helpers shared by every view.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// One listener on a container instead of one per button; survives re-rendering the container's HTML.
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, e => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export const classLabel = c => `${c.program} — ${c.year} — Section ${c.section} (${c.academic_year})`;

// Disable a button while an async action runs, so double-clicks can't double-submit.
export async function busy(button, fn, label) {
  const original = button.textContent;
  button.disabled = true;
  if (label) button.textContent = label;
  try { return await fn(); }
  finally { button.disabled = false; button.textContent = original; }
}
