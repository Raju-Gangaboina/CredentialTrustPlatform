// Detects uploads that look like a forwarded / screenshot COPY rather than the original download.
//
// Why: WhatsApp, Telegram and screenshots re-compress the image and throw away its hidden metadata,
// which is exactly what the C2PA layer (provenance.js) reads. A forger who forwards an AI-made
// certificate on WhatsApp therefore slips past it. We cannot see that from the pixels reliably, but
// these apps name their files in very recognisable ways, so the file name is a cheap, low-false-
// positive signal.
//
// SOFT BY DESIGN (decided with the owner, 2026-10-03): this only adds an evidence line and a
// warning for the student and faculty. It NEVER changes `status` and NEVER blocks the upload,
// because a forwarded copy of a genuine certificate still verifies through the issuer (seen live
// with a WhatsApp-sent Udemy certificate), so blocking would punish honest students.
//
// Honest limit: this is a speed bump, not a lock. Renaming the file defeats it. It exists to catch
// the careless case (forward on WhatsApp, upload without renaming), which is the case that would
// otherwise bypass the metadata check unnoticed.
const PATTERNS = [
  { kind: 'WhatsApp', re: /^WhatsApp (Image|Video|Document)?\s*\d{4}-\d{2}-\d{2}/i },
  { kind: 'WhatsApp', re: /^IMG-\d{8}-WA\d+/i },
  { kind: 'WhatsApp', re: /-WA\d{3,}\.\w+$/i },
  { kind: 'Telegram', re: /^photo_\d+@\d{2}-\d{2}-\d{4}/i },
  { kind: 'Telegram', re: /^photo_\d{4}-\d{2}-\d{2}_/i },
  { kind: 'screenshot', re: /^Screen ?shot/i },
  { kind: 'screenshot', re: /^Screenshot[_ -]/i },
  { kind: 'screenshot', re: /^Snip(ping)?[ _.-]/i }
];

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

// Returns null when nothing looks like a copy, otherwise { kind, message, evidence }.
// Only image files are considered: a PDF can't be "a screenshot", and a PDF named like a WhatsApp
// attachment is still the original document.
function detectForwardedCopy(originalName) {
  const name = String(originalName || '').trim();
  if (!name || !IMAGE_EXT.test(name)) return null;
  const hit = PATTERNS.find((p) => p.re.test(name));
  if (!hit) return null;

  const message =
    `This file looks like a ${hit.kind} copy, not the original download (judging by its file name). ` +
    `Copies lose the hidden data we use to detect AI-generated or edited certificates, so that check could not run. ` +
    `For best results upload the original downloaded file (on WhatsApp use "send as Document"), or add the certificate link.`;

  return {
    kind: hit.kind,
    message,
    // pass:null renders as a neutral dash — it is a caution, not evidence against the certificate.
    evidence: { label: `Upload check: ${message}`, pass: null }
  };
}

module.exports = { detectForwardedCopy };
