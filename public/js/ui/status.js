// Trust status display. Always an icon + a label, never color alone, and never a percentage.
import { esc } from '../core/dom.js';
import { icon } from './icons.js';

const INFO = {
  VERIFIED:      { tone: 'ok',   label: 'Verified',     icon: 'check' },
  NEEDS_REVIEW:  { tone: 'warn', label: 'Needs review', icon: 'alert' },
  NOT_FOUND:     { tone: 'bad',  label: 'Not found',    icon: 'x' },
  PENDING:       { tone: 'idle', label: 'Pending',      icon: 'clock' },
};

export const STATUS_ORDER = ['VERIFIED', 'NEEDS_REVIEW', 'NOT_FOUND', 'PENDING'];
export const statusInfo = s => INFO[s] || { tone: 'idle', label: String(s || 'Unknown').replace(/_/g, ' '), icon: 'clock' };

export function badge(status) {
  const i = statusInfo(status);
  return `<span class="badge badge--${i.tone}">${icon[i.icon]}${esc(i.label)}</span>`;
}

// What a STUDENT sees. Deliberately separate from the trust statuses above: students are never told an
// automated result (see the STUDENT-BLIND note in server/routes/certificates.js). They only get
// "Submitted" until a teacher acts, then the teacher's own decision.
const STUDENT_INFO = {
  SUBMITTED: { tone: 'idle', label: 'Submitted',          icon: 'clock' },
  APPROVED:  { tone: 'ok',   label: 'Approved',           icon: 'check' },
  RESUBMIT:  { tone: 'warn', label: 'Please resubmit',    icon: 'alert' },
};

export function studentBadge(state) {
  const i = STUDENT_INFO[state] || STUDENT_INFO.SUBMITTED;
  return `<span class="badge badge--${i.tone}">${icon[i.icon]}${esc(i.label)}</span>`;
}

export function evidenceList(evidence) {
  if (!evidence || !evidence.length) return '<p class="muted">No evidence recorded.</p>';
  return `<ul class="evidence-list">${evidence.map(e => {
    const cls = e.pass === null || e.pass === undefined ? '' : e.pass ? 'pass' : 'fail';
    const mark = cls === 'pass' ? '✓' : cls === 'fail' ? '✕' : '–';
    return `<li><span class="mark ${cls}" aria-hidden="true">${mark}</span><span>${esc(e.label)}</span></li>`;
  }).join('')}</ul>`;
}

// A verified certificate needs no explanation, so it shows just the badge. Anything else gets a
// "Why?" disclosure with the checklist. Reviewers pass open=true so the checklist starts expanded.
export function evidenceBlock(status, evidence, { open = false } = {}) {
  if (status === 'VERIFIED' || status === 'PENDING') return '';
  return `<details class="evidence"${open ? ' open' : ''}><summary>Why? View details</summary>${evidenceList(evidence)}</details>`;
}
