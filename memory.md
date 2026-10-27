# Campus Credential Trust & Verification Platform — Build Memory

> Read this file first, every session, on every account. It is the single source of truth for what's
> built, what's decided, and what to do next. Update it after every meaningful change — don't wait
> until the end of a session. If you (Claude) are picking this up fresh: read this whole file, then
> `Get-ChildItem -Recurse` the project to confirm reality matches what's written below, then continue
> from "NEXT STEPS."

## 1. What this is

A campus platform that verifies student-submitted certificates by asking the *issuer*, not by asking
an AI whether the document "looks real." AI is used for extraction only; a rule-based Verification
Engine decides trust status based on evidence, and every status ships with an evidence checklist
(never a percentage score).

Pitch line: **"We don't ask AI whether a certificate looks real. We ask the issuer whether it actually
exists."**

Scope: **V1 (Campus Vault) + V2 (Verification Engine)**. V3 (Credential Passport/Network) is
explicitly OUT of scope — vision-slide only, not being built.

## 2. Project location & how to run it

- Root: `C:\Users\rajuy\Documents\CredentialTrustPlatform`
- Run: `node server/index.js` from the root → serves at `http://localhost:3000`
- First-time setup on a fresh checkout: `npm install` then `npm run seed` (seeds issuer_registry)
- DB is a single file `data.sqlite` in the project root (gitignored-worthy, not yet a git repo)
- To restart after code changes: kill existing `node.exe` process, relaunch `node server/index.js`.
  There is no watch/reload — routes are loaded once at require time.

## 3. Architecture decisions (locked)

- **Stack:** Node.js + Express (backend), vanilla HTML/CSS/JS (frontend, no framework).
- **DB:** `node:sqlite` (Node's built-in module, `DatabaseSync`) — NOT better-sqlite3. Better-sqlite3
  needed native compilation (Visual Studio Build Tools not installed on this machine) and failed to
  install. node:sqlite needs zero native build and works fine on Node 24.13. It logs an
  "experimental feature" warning on startup — expected, harmless.
- **Auth:** `express-session` + `bcrypt` (bcrypt installed fine, no native-build issue in practice).
  Two roles: `faculty`, `student`. Session-based.
- **File upload:** `multer`. Roster upload via `xlsx` package. Certificates: PDF only for now.
- **PDF text extraction:** `pdfjs-dist` v4, legacy build, loaded via dynamic `import()` from CommonJS
  (`server/verification/extractor.js`). **NOT `pdf-parse`** — pdf-parse bundles an ancient pdf.js
  (v1.10.100) that throws "bad XRef entry" on modern PDF xref tables and was abandoned mid-build.
  Don't reintroduce it.
- **Roster header matching:** deliberately loose (`normalizeHeader`/`findRollKey`/`findNameKey` in
  `server/routes/classes.js`). Matches roll-number-ish headers ("Roll Number", "Roll No", "Reg No",
  "id", etc.) and any header containing "name" ("Student Name", "Full Name", "name"). This was a real
  bug found via the user's actual roster file (headers were "Roll Number" / "Student Name", not
  "roll_number" / "name") — fixed and tested. Don't tighten this back to exact-string matching.
- **Verification engine (V2):** issuer adapters in `server/verification/adapters/`, each exports
  `{ issuerKey, matches(extractedFields), verify(fields, issuerRecord) -> {status, evidence[], issuerKey} }`.
  `server/verification/registry.js` tries adapters in order; falls back to an honest "unknown issuer"
  or "adapter not registered" result rather than guessing.
- **Trust status values:** `VERIFIED`, `NOT_FOUND`, `NEEDS_REVIEW`, `PENDING`. No percentage score,
  anywhere, ever — this is a deliberate product decision, not a placeholder.

## 4. Data model (SQLite tables) — see `server/db/schema.js` for exact DDL

`faculty`, `classes`, `subjects`, `students`, `issuer_registry`, `certificates`. Certificates store
`extracted_json` and `evidence_json` as JSON text columns.

## 5. Build status

### V1 — Campus Vault: DONE and tested end-to-end
- [x] Project scaffold
- [x] SQLite schema + init
- [x] Faculty auth (signup/login) — tested via API
- [x] Class creation (auto-creates 5 default subject vaults) — tested
- [x] Student roster upload (.xlsx, flexible headers) — tested with user's real header format
- [x] Student activation (roll number → set password) + login — tested
- [x] Certificate upload endpoint (student side, per subject vault) — tested
- [x] Faculty dashboard: stats (overall status counts) + per-subject heatmap table — tested
- [x] Faculty review queue + approve/reject — tested
- [x] Clean minimal frontend (`public/index.html` + `public/css/style.css` + `public/js/app.js`,
      hash-router SPA, warm-paper/pine-green design, NOT a generic Bootstrap look) — built, NOT YET
      visually confirmed in a real browser by either Claude or the user (screenshot tool was
      declined by user once — functional correctness confirmed via API only so far).

### V2 — Verification Engine: core done, needs more issuers
- [x] Extraction pipeline (pdfjs-dist → regex field extraction: certificateId, date, scorePercent,
      hours, issuerGuess) — tested against a real generated PDF, all fields extracted correctly.
- [x] issuer_registry table + seed script (`server/db/seedIssuers.js`) — currently seeds ONLY Saylor.
- [x] Saylor adapter — HONEST STUB: validates certificate-ID format only, cannot confirm existence
      (no public Saylor verification API confirmed yet), so it correctly returns NEEDS_REVIEW, never
      VERIFIED, until a real endpoint is found. This is intentional, not a bug — don't "fix" it into
      falsely returning VERIFIED.
- [x] Unknown-issuer fallback → NEEDS_REVIEW, appears in faculty review queue — tested.
- [x] Evidence report generator (checklist structure) — tested, renders correctly in review queue UI.
- [x] Faculty manual-review UI (approve/reject) — tested via API, wired into frontend.
- [ ] More issuer adapters (only Saylor exists). Next candidates: whatever issuers actually appear in
      the user's real student uploads — don't build speculative adapters, wait for real certs.
- [ ] OCR for scanned/image certificates (stretch goal, not started).

## 6. NEXT STEPS

1. **Visually confirm the frontend in a real browser** (open http://localhost:3000, click through
   landing → faculty signup → create class → roster upload → review queue → student login → upload
   cert). Nobody has actually looked at the rendered UI yet, only tested via raw API calls.
2. Ask the user to try their REAL roster file (`students_roll_numbers.xlsx`, headers "Roll Number" /
   "Student Name", 60 students) end to end now that the header-matching bug is fixed.
3. Get a real certificate sample from the user (not the synthetic pdfkit-generated one used for
   testing) to validate the extractor against real-world formatting/layout.
4. Consider: class ID is currently a raw number the student has to be told out-of-band — fine for
   now, but a "join code" or the faculty sharing a link might be nicer UX later. Not urgent.
5. No frontend for creating/approving new issuer adapters yet (the "new issuer detected" admin flow
   from the original design doc) — currently only editable by hand via `seedIssuers.js`. Build this
   once there's a second real issuer to onboard.

## 7. Known non-issues / things NOT to "fix"

- `node:sqlite` experimental warning on server start — expected, harmless, ignore.
- Saylor adapter never returning VERIFIED — correct behavior, see section 5.
- `npm install` shows deprecation warnings (inflight, npmlog, rimraf, glob, gauge, tar) — all
  transitive deps of multer/xlsx, harmless for a dev project. `multer@1.x` has known CVEs per `npm
  audit` — low priority for a local campus project, but worth upgrading to multer 2.x before any real
  deployment.

## 8. Bugs found and fixed (chronological, keep for context)

1. **better-sqlite3 native build failure** (no Visual Studio Build Tools) → switched to `node:sqlite`.
2. **pdf-parse "bad XRef entry" on all real PDFs** (ancient bundled pdf.js) → switched to `pdfjs-dist`
   v4 with dynamic `import()`.
3. **Test PDF generation bug** (unrelated to the app itself): a Node one-liner using pdfkit called
   `doc.end()` and exited before the write stream flushed, producing a corrupt/truncated PDF. Fixed
   by waiting for the stream's `finish` event. Only relevant if generating more test fixtures.
4. **Registry evidence bug**: "Issuer identified" evidence line said `pass: false` even when the
   issuer WAS correctly identified (just not yet in the DB registry table) — misleading. Fixed to
   distinguish "issuer identified but not registered" from "issuer genuinely unknown."
5. **Roster header matching too strict** (real bug found via user's actual file): only matched exact
   headers `roll_number`/`name`; user's file has `Roll Number`/`Student Name`. Every row was rejected
   as "missing name." Fixed with loose header matching (see section 3). Tested against a file
   replicating the user's real headers — 5/5 rows matched correctly.

## 9. Changelog (newest first)

- 2026-09-25: Fixed roster header-matching bug (see section 8.5) after user reported their real
  roster file wasn't uploading. Tested and confirmed fixed. Cleaned up scratch test files.
- 2026-09-25: V1 + V2 core built and tested end-to-end via direct API calls (PowerShell
  Invoke-RestMethod). Frontend built (SPA, custom design) but not yet visually confirmed in-browser.
  Three real bugs found and fixed during testing (better-sqlite3, pdf-parse, evidence-label bug) —
  see section 8.


## 10. Bug fix — 2026-09-25, second session

**Bug:** Student "Activate account" screen asked for "Class ID" with no explanation. The user
(faculty) typed the program name ("Bsc Hons in cs") into it, since that's what "Class ID" sounds like
it means. Real Class ID is the numeric primary key, only visible in the faculty page's URL
(`#/faculty/class/2`). Activation failed with "Roll number not found in this class roster" because
classId=NaN/garbage never matched. This was a real UX gap, not a training/instruction issue.

**Fix:**
- New public (no-auth) endpoint `GET /api/classes/public/search?q=...` — searches program/year/
  section/academic_year, returns id + display fields only (no roster/faculty data exposed).
- Student login/activate page (`renderStudentLogin` in `public/js/app.js`) now has a type-ahead class
  search box instead of a raw numeric input. Student picks their class from matched results; the
  numeric classId is tracked internally and no longer something they have to know or type.
- Faculty class detail page now has a highlighted "Give this to your students" card at the top showing
  both the human-readable class label AND the raw numeric ID (labeled "fallback"), so faculty
  understand what to actually communicate to students.
- Tested: search endpoint returns correct matches unauthenticated; activation with the correct numeric
  ID (2, for "Bsc Hons in cs") succeeds for roll number 201224378011 (Gangaboina Raju Yadav), who was
  the student blocked by this bug.

**Don't regress:** keep the class search endpoint public/unauthenticated (students aren't logged in
yet when they need it) but keep it non-sensitive (only id/program/year/section/academic_year — never
roster or faculty identity through this endpoint).

## 11. Changelog (add to top of existing list)

- 2026-09-25 (later): Fixed Class-ID UX bug (section 10). Added public class search endpoint,
  reworked student login/activate UI, added Class ID callout to faculty class page. Verified via
  API testing (search endpoint + activation with correct ID for the actual blocked student).

## 12. Real verification engine rebuild — 2026-09-25, third session (continuation, this session)

Picked up from screenshots of a prior session that hit its message limit mid-rebuild (last visible
step: an in-progress edit to `server/routes/certificates.js`, with a preceding `certificates.js`
tool call shown as "Failed"). Confirmed on disk + by direct testing that the rebuild is actually
**complete and working** — the mid-session "Failed" tool call did not leave anything broken:

- `server/verification/extractor.js` — rewritten to do real OCR (tesseract.js) for images, real QR
  decoding (jimp + jsqr), PDF hyperlink-annotation extraction, and bare-URL-in-text extraction.
  `package.json` now has `jimp`, `jsqr`, `tesseract.js` as real dependencies (installed, present in
  `node_modules`).
- `server/verification/webCheck.js` (new) — real live HTTP verification: fetches a candidate URL
  found on the document, with SSRF guards (rejects private/loopback/link-local resolved IPs, http/https
  only, manual bounded redirect-following, timeout, response size cap), strips HTML, checks for
  negative signals ("certificate not found", "revoked", etc.), and cross-checks the extracted
  certificate ID / recipient name against the fetched page's text.
- `server/verification/knownIssuers.js` (new) — domain allowlist used only to rank/prioritize links
  actually found on the document (never used to construct/guess a verify URL).
- `server/verification/registry.js` — rewritten around real links: recognized-domain link match ->
  VERIFIED, recognized domain reachable but no match -> NOT_FOUND, explicit "not found/revoked" text
  on the page -> NOT_FOUND, unrecognized-domain match -> NEEDS_REVIEW (flagged, never auto-approved),
  no link at all -> falls through to the Saylor adapter (format-only) or an honest NEEDS_REVIEW that
  states exactly what was/wasn't found.
- `server/routes/certificates.js` — unchanged in shape, still calls `extractFromFile` +
  `runVerification` correctly; confirmed it `require()`s with no syntax errors.

**Verified this session** (server was already running as PID 34068 from the prior session — left it
running, did not restart it):
- `node -e` direct test of `extractFromFile('./test_cert.pdf')` -> correct fields (certificateId,
  date, scorePercent, hours, issuerGuess: saylor), then `runVerification(extraction)` -> NEEDS_REVIEW
  with honest evidence ("no public Saylor verification endpoint confirmed yet"). This is correct,
  expected behavior for this specific synthetic test PDF (it has no embedded verify link), not a bug.
- `require('./server/routes/certificates')` loads cleanly.
- Server responds correctly on `/api/classes/public/search`.
- Did NOT test the image/OCR/QR path this session (no test image certificate available — only
  `test_cert.pdf` and `test_roster.xlsx` exist in the project). Did NOT test a real link-bearing
  certificate through `webCheck.js`'s live-fetch path end-to-end (no such sample on hand either).
- Did NOT complete a full authenticated HTTP upload test (POST `/api/certificates/subject/:id`) —
  don't have the real student's activation password and didn't want to guess/reset it.

**Next steps, updated:**
1. Get a real image-based certificate (screenshot/photo of a cert, or a QR-bearing PDF) from the user
   to actually exercise the OCR + QR path — this is the one part of the rebuild not yet verified live.
2. Get a real certificate that has a genuine issuer verification link/QR (e.g. a Coursera or NPTEL
   cert) to test `webCheck.js`'s live-fetch-and-cross-check path end-to-end — the synthetic Saylor
   test PDF has no such link, so that path is implemented but untested against a live target.
3. Everything else from section 6's original NEXT STEPS still applies (visual frontend confirmation,
   more issuer adapters as real certs come in, etc.).

## 13. Real-certificate testing + a critical trust bug fixed — 2026-09-25, same session (continuation)

User sent two REAL certificates (not synthetic test fixtures): a genuine Saylor Academy cert
(`2164168379RD`, has a real embedded PDF hyperlink annotation to
`https://learn.saylor.org/admin/tool/certificate/index.php?code=2164168379RD`) and a genuine ExcelR
"Certificate of Participation" (Git & GitHub, Reg/Cert No. 59501, no embedded verification link at
all). Ran the actual project code (not a reconstruction) against both, first in a sandboxed copy to
read fields safely, then the live-fetch step for real on this machine (sandbox network is restricted
and can't reach saylor.org, so that part had to run here).

**Critical bug found and fixed:** the real Saylor certificate's verification link loads fine
(HTTP 200) but the actual page is a login-gated Moodle form ("Code Required... You are not logged
in") — an unauthenticated fetch can never get a real answer from it. The OLD registry logic treated
"recognized domain reached, no textual match" as NOT_FOUND — so this genuine, real certificate was
getting auto-marked NOT_FOUND. Since NOT_FOUND items never reach the faculty review queue (only
NEEDS_REVIEW does), this meant a real student's real certificate would be silently rejected with no
human ever seeing it — worse than the placeholder behavior from before the rebuild.

**Fix (see comments in the files themselves for full reasoning):**
- `webCheck.js`: added `INCONCLUSIVE_SIGNALS` (login wall, CAPTCHA, "access denied", JS-required,
  etc.) as a distinct category from `NEGATIVE_SIGNALS` (explicit "not found/revoked" text). An
  inconclusive page returns `{ inconclusive: true }`, never `explicitlyInvalid`.
- `registry.js`: NOT_FOUND is now ONLY returned when a page explicitly says the credential doesn't
  exist. "Reachable, no explicit invalid signal, but also no textual match" (whether due to a login
  wall, a non-2xx response, a fetch error, or a genuinely blank/no-match page) now falls to
  NEEDS_REVIEW with evidence explaining what actually happened, never an automatic NOT_FOUND.
- Also fixed: `issuerKey` in the link-checking path was always `fields.issuerGuess` (text-based
  issuer detection), which can be null even when a link's domain WAS positively identified (this
  happened here — "Saylor" isn't in the cert's selectable text, only in a logo image, so
  `issuerGuess` was never set even though the link's domain correctly identified as `saylor`). Now
  uses the domain-identified issuer key first, falling back to the text guess.
- **Don't revert this to "reachable + no match = NOT_FOUND"** without also giving NOT_FOUND items a
  human review path (they currently have none — see `server/routes/certificates.js` review-queue
  query, which only pulls `NEEDS_REVIEW`).

**Secondary bugs found (same real-cert test) and fixed in `extractor.js`:**
- Certificate-ID regex was a bare "8+ digit run" grab with no preference for a labeled value. On the
  ExcelR cert ("Reg/Cert No. 59501 /EXCELR/EDL/09092026") it grabbed "09092026" (part of the date
  embedded in the reg string) instead of "59501" (the real ID). Fixed: now tries a labeled pattern
  ("Certificate ID", "Cert No", "Reg No", "Credential ID", etc.) first, falls back to the old bare-digit
  regex only if no label is found. Verified against both real certs: Saylor still correctly extracts
  `2164168379RD`, ExcelR now correctly extracts `59501`.
- Recipient-name regex could grab a label word ("Reg") instead of the real name, because PDF
  text-layer extraction order doesn't always match visual reading order (this ExcelR PDF's "AWARDED
  TO" is followed in the raw text stream by "Reg/Cert No...", not the name — those elements are drawn
  in a different order than they're laid out visually). Fixed with a denylist: if the matched
  "name"'s first word is a common label (reg, cert, no, id, ref, date, issued, etc.), the match is
  discarded rather than reported as fact. This is a narrow guard, not a real fix for PDF reading-order
  in general — expect more of this class of bug from other real certs with unusual layouts; the
  underlying fix would be positional (x/y) text extraction instead of raw concatenation, not done here.

**Verified (real machine, real files, real network):**
- `extractFromFile` on both real PDFs → correct fields after the fixes above.
- `runVerification` on the real Saylor link → now NEEDS_REVIEW (not NOT_FOUND) with evidence that
  correctly names the login-wall as the reason, `issuerKey: "saylor"`.
- Did not yet re-run the ExcelR cert through `runVerification` post-fix (no link on that cert, so its
  status was already NEEDS_REVIEW before and after — only the evidence quality changed).
- Still not tested: OCR/QR path (need an image-format certificate), and a certificate from an issuer
  whose verification page is NOT login-gated (to confirm the VERIFIED path actually fires end-to-end
  for a real match — every real link tested so far has been inconclusive or link-less).
- The two real certificate files were NOT copied into the project's local fixtures — they exist as
  chat uploads and in Claude's own sandbox, not on this machine. If the user wants them as permanent
  test fixtures, they'd need to save them from the chat into the project folder by hand.

**Next steps, updated again:**
1. Find or wait for a real certificate whose issuer verification page is NOT login-gated, to confirm
   the VERIFIED path fires correctly end-to-end (every real sample so far has been inconclusive or
   had no link at all).
2. Still need an image-based certificate to test OCR + QR.
3. Consider whether Saylor specifically is even a good adapter target given its verify page requires
   login — the honest NEEDS_REVIEW outcome is probably permanent for Saylor certs unless a logged-in
   session/API key becomes available, not a temporary gap to "finish."


## 14. Session picked up on a NEW account (this account) — 2026-09-27, continuation

User switched Claude accounts mid-build (hit a message limit) and pasted a screenshot + transcript of
the prior account's last visible turn, which described QR-in-PDF decoding, a SunbirdRC adapter, and
an AI-forensics advisory check as **not yet wired in**. On picking this up: read this file, then
walked the actual `server/` tree and diffed it against both the transcript and this file's own
section 13 — reality had moved further than either: **all three were already fully implemented and
wired in** by the time this session started (dated code comments in the files themselves say
2026-09-27, i.e. later the same day as section 13, on the other account). This file (memory.md) was
stale — hadn't been updated past section 13 despite that later work happening. Don't trust the
previous account's own self-report over the actual files on disk; always re-`Get-ChildItem` /read the
real code, especially right after an account switch.

**Confirmed present and correct by reading the actual files (not just trusting comments):**
- `server/verification/qrPdfWorker.js` + the `scanPdfForQr` wrapper in `extractor.js` — PDF pages are
  rendered to bitmaps via `pdf-to-png-converter` (installed, in `package.json` deps) **inside an
  isolated `worker_thread`**, specifically because `pdf-to-png-converter` bundles its own private
  pdfjs-dist (6.2.108) that throws "API version does not match Worker version" if loaded in the same
  thread as this project's top-level pdfjs-dist (4.10.38). This was a real bug, found and fixed on
  2026-09-27 (silently swallowed by a try/catch before the fix — `verifiableCredential` was never
  populated even though the QR itself decoded fine in isolation). Don't move the render step back
  inline without solving that version conflict some other way first.
- `server/verification/adapters/sunbirdrc.js` — decodes SunbirdRC/Infosys-Springboard signed W3C
  Verifiable Credentials from the QR payload, cross-checks the signed `credentialSubject.issuedTo`
  against the platform's own roster name for that student, and **deliberately never confirms the
  Ed25519 signature itself** (documented, real reasons in the file: `did:india` is a non-resolvable
  placeholder verificationMethod on every SunbirdRC credential seen including their own docs sample;
  no publicly-served DID document; their real Verify API needs the registry owner's own bearer token,
  not a public relying-party call). Returns NEEDS_REVIEW normally, NOT_FOUND only on an actual name
  mismatch between the signed payload and the uploader. Registered in `registry.js` at priority 0,
  ahead of generic link-checking — correct, matches the reasoning in registry.js's own header comment.
- `server/verification/aiForensics.js` + its call site in `server/routes/certificates.js` — this is
  the "can AI tell if the certificate image itself was ChatGPT/AI-generated" feature the user asked
  for. Calls the real Claude API (`claude-sonnet-5`, needs `ANTHROPIC_API_KEY`) with the rendered
  cert image, asking ONLY for visual-tampering red flags — explicitly never asked to confirm
  authenticity. Runs strictly AFTER `runVerification()` has already set `status`; its result is
  appended to the evidence array only and is architecturally incapable of changing `status` (verified
  by reading `certificates.js` — the forensics call happens after `db.prepare(...).run(...)` computes
  its args from `verification.status`, not from the forensics result). Fails safe: no `.env` file
  exists in the project yet (only `.env.example`), so right now this always reports itself as
  "[AI forensic check — advisory only] Not run — no ANTHROPIC_API_KEY configured" — correct,
  documented fallback behavior, not a bug. **To turn it on:** copy `.env.example` to `.env` and set a
  real `ANTHROPIC_API_KEY` — needs the user's own key, Claude can't supply one.

**Verified live, this session (server was already running as PIDs 14412/36056 since 11:22 on this
machine — left it running, did not restart it):**
- `GET /api/classes/public/search` → HTTP 200, responds correctly — server is healthy right now.
- Ran `extractFromFile` + `runVerification` directly (not through HTTP) against two REAL files
  already sitting in `server/uploads/certificates/` from earlier testing:
  - The 681KB PDF (ExcelR cert, `certificateId: 59501`) → no link/QR found (correct — this cert has
    none) → NEEDS_REVIEW with honest evidence. Matches section 13's finding exactly.
  - A real JPEG certificate (Scaler Topics "Certificate of Excellence", AI course, signed by Anshuman
    Singh) → OCR pipeline itself works fine (confirmed by re-running with raw text logged: OCR
    correctly read "Gangaboina Raju Yadav", the course title, and the signer's name), but
    `extractFields`'s recipient-name regex found NO match on this cert, because the name is printed
    as a bare standalone line with no preceding "awarded to"/"certify that"-style phrase — this
    format doesn't match any of the current name patterns. **Known gap, not yet fixed**: the regex
    also has no safe way to pick "Gangaboina Raju Yadav" over "ANSHUMAN SINGH" if loosened to grab any
    capitalized-word line, since both look like names and only one is the recipient — needs either
    roster-name cross-referencing at extraction time (compare candidate lines against the actual
    enrolled student's name, which the caller already has as `context.studentName` by the time
    `runVerification` runs, but `extractFields` itself currently has no access to it) or positional
    (x/y) layout info, not a quick regex tweak. Correctly still produces an honest NEEDS_REVIEW
    either way (no cert ID, no link/QR on this cert) — this gap affects evidence quality, not
    trust-status correctness.
- Found + traced a real crash from earlier today (`verify_boot_err.log`, 11:18am): tesseract.js-core's
  `tesseract-core-relaxedsimd.wasm` was missing from `node_modules`, crashing OCR entirely. File now
  present (created 12:04pm, i.e. after the crash — an `npm install` on the other account evidently
  fixed it before this session started). Confirmed fixed by successfully OCR'ing the real JPEG above
  with no error. Flagging in case it recurs: if `node_modules` ever gets partially copied/zipped
  between machines or accounts again, `tesseract.js-core`'s wasm files (6 of them, ~13MB total) are
  the ones most likely to go missing silently.
- Deleted two throwaway `_healthcheck*.js` scripts used for the above testing — not part of the app.

**Next steps, updated again:**
1. If the user wants the AI forensic check actually running (not just "not configured"): they need to
   provide their own `ANTHROPIC_API_KEY` in a new `.env` file (copy from `.env.example`).
2. ~~Fix the recipient-name extraction gap~~ DONE, same session: threaded `context.studentName`
   through `extractFromFile(filepath, context)` → `extractFields(text, context)` in `extractor.js`,
   and pass `{ studentName: student.name }` from `certificates.js`'s upload route. Added a narrow
   fallback — only CONFIRMS the roster name if it appears verbatim (normalized) as a standalone line
   in the extracted text, never invents a name from a generic "any capitalized line" grab (which
   would've been ambiguous on this exact cert — the signer "Anshuman Singh" is equally name-shaped).
   Re-tested against the real Scaler JPEG with the real student's name → correctly now extracts
   `recipientName: "Gangaboina Raju Yadav"`, tagged `recipientNameSource: "matched-against-roster-name"`
   so downstream code/evidence can tell a roster-confirmed name apart from a phrase-matched guess.
3. Everything from section 6 / section 12 still applies (visual frontend confirmation in a real
   browser — still hasn't happened as far as this file shows; more issuer adapters as real certs
   come in).
4. Keep this file (memory.md) updated in the SAME session actions are taken in, on whichever account
   is active — section 13→14 drifted out of sync because updates lagged the actual code changes.

## 15. Groq support added to AI forensic check — 2026-09-27, continuation

User asked whether a Groq API key would work with the AI forensic check. It wouldn't have —
`aiForensics.js` was hardcoded to Anthropic's Messages API request/response shape. Added Groq as a
second supported provider rather than just answering "no":

- `isConfigured()`/new `getProvider()`: checks `ANTHROPIC_API_KEY` first, falls back to `GROQ_API_KEY`.
  Both can be set; Anthropic wins if so. Set only `GROQ_API_KEY` if that's the one you have — free
  tier, vision-capable (`meta-llama/llama-4-scout-17b-16e-instruct` by default, overridable via
  `AI_FORENSICS_GROQ_MODEL`).
- Split the API call into `callAnthropic()` (unchanged request shape, Claude Messages API, image as
  a base64 `source` block) and `callGroq()` (Groq's OpenAI-compatible `chat.completions` endpoint,
  image as a `data:` URI inside an `image_url` content part, response text at
  `choices[0].message.content` — a plain string, not content blocks like Anthropic's).
- Same downstream JSON-parsing/evidence logic either way — provider choice is invisible past the
  `callX()` functions, still strictly advisory-only, still can't touch `status` (unchanged from
  section 14's description of the architecture).
- `.env.example` updated: both `ANTHROPIC_API_KEY=` and `GROQ_API_KEY=` now listed, with
  `AI_FORENSICS_GROQ_MODEL` documented alongside the existing `AI_FORENSICS_MODEL`.
- Verified: `node -e "require('./server/verification/aiForensics')"` loads clean, `isConfigured()`
  correctly returns `false` with no `.env` present yet. Not yet tested with a REAL Groq key (user
  hasn't provided one) — only load/syntax verified. Restarted the server (now PID 29332) so the
  change is live; confirmed healthy via the same public search-endpoint check used in section 14.

**Next step:** once the user drops a real `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`) into a `.env` file,
upload a real image certificate through the app and confirm the forensic evidence line actually
populates instead of "not configured" — this is the one path in this feature still unexercised live.

## 16. Saylor adapter fixed for real — a public verify endpoint DOES exist — 2026-09-27, new session (different account)

User asked to check the Saylor and Infosys certs. Ran the real pipeline (as before, NEEDS_REVIEW for
both) and separately fetched Saylor's verify URL directly — got the same "You are not logged in"
footer text section 13 already found, so at first this just re-confirmed the earlier conclusion.

**Then the user manually used the verify form in a real, logged-out browser and got a real "This
certificate is valid" result** (screenshot: Full name Ragi Dharma Teja, Certificate MA007: Algebra,
Status Valid) — directly contradicting section 13's "login-gated" conclusion. Investigated why, by
replicating the browser's actual request with PowerShell `Invoke-WebRequest`/`-WebSession`:

- **Section 13 was wrong, and so was this session's own first re-check.** Saylor's verify page is a
  two-step Moodle form, not a simple GET-with-query-param: (1) `GET index.php?code=<id>` only
  pre-fills the code input and returns a session + `sesskey` — it never runs the lookup; (2)
  `POST index.php` with `code` + that `sesskey` + the hidden `_qf__tool_certificate_verify_certificate_form=1`
  + `verify=Verify` is what actually runs it. Neither the earlier session's plain `fetch`, nor this
  session's own first re-check, ever did step 2 — both only ever did step 1, saw the pre-filled form
  page (which always carries "You are not logged in" in the page **footer** — generic Moodle
  boilerplate shown to every anonymous visitor on every page, unrelated to this tool) and concluded
  "login wall." Confirmed with the real two-step flow via PowerShell: returns "This certificate is
  valid" with the correct name/course/date for `2164168379RD`, and a distinct `"Not verified"`
  (`alert-danger`) message for a made-up code — a real, working, anonymous, public verification
  endpoint, exactly as `saylor.js`'s own header comment said to look for ("If/when a real Saylor
  verification endpoint is confirmed, only this file needs to change").
- **Fixed `server/verification/adapters/saylor.js`**: replaced the format-only honest-stub with a
  real implementation of the two-step GET-then-POST flow (session cookie carried via
  `Headers.getSetCookie()`, sesskey scraped from `M.cfg`, 8s timeout via `AbortController`). Parses
  either "This certificate is valid" (+ Full name/Certificate/Date issued/Status table) or
  "Not verified"/other explicit-invalid text; anything else (network error, timeout, unrecognized
  page shape) fails safe to `NEEDS_REVIEW`, never a fabricated result. When `context.studentName` is
  available, cross-checks it against the *live* full name Saylor's own page reports (stronger
  evidence than trusting the uploaded document's own printed text) and flags a mismatch to
  `NEEDS_REVIEW` rather than auto-approving.
- **Updated `registry.js`** to pass `context` through to `adapter.verify(fields, issuerRecord, context)`
  (previously dropped on the floor for the no-link adapter path — `context.studentName` only ever
  reached the SunbirdRC path before this).
- **Verified directly (not through HTTP upload)**: real cert `2164168379RD` → `VERIFIED`, full
  evidence including the live-fetched name/course/date and a passing name cross-check. Made-up code
  `9999999999XX` → `NOT_FOUND`, confirming the negative path also works and isn't just a fluke of
  matching too broadly. Restarted the server (now PID 18840) so the fix is live.
- **Don't revert this to the honest-stub** — the false "login wall" conclusion in section 13 came
  from an incomplete test (GET only), not a real limitation of Saylor's site. If Saylor's page
  layout changes and this adapter starts always returning NEEDS_REVIEW again, re-verify with the full
  two-step flow by hand (`Invoke-WebRequest -SessionVariable` in PowerShell, or equivalent) before
  assuming the endpoint stopped working.
- **Not yet done**: the generic link-checking path in `webCheck.js` still has the same class of bug
  for *other* issuers — its `INCONCLUSIVE_SIGNALS` regex (`/you are not logged in/i`, etc.) will
  false-positive on any Moodle site's generic anonymous-footer text the same way it did here, even
  for a tool that doesn't actually require login. This was only fixed for Saylor specifically (which
  has its own dedicated adapter); a document whose *link-based* path hits a Moodle site with this
  same boilerplate would still get marked inconclusive. Consider scoping `INCONCLUSIVE_SIGNALS`
  matching to the main content region rather than the whole page, or dropping the generic
  "not logged in" phrase entirely since it's too easily boilerplate rather than a real gate — not
  done this session, flagging for whoever picks this up next.

## 17. Issuer admin frontend built + did:india / Infosys Wingspan questions closed out — 2026-09-27, new session (third account)

User picked this up on a third Claude account, referencing a prior session's screenshots (that
session was investigating whether `did:india` resolves via `https://identity.gov.in/.well-known/did.json`,
and separately showed an Infosys Wingspan QR-verification page as a UX reference). Confirmed by
direct DNS lookup this session: **`identity.gov.in` does not resolve at all** — no host, let alone a
served `did.json`. This matches, and closes out, what `sunbirdrc.js`'s header comment already
concluded by other means (see section 14) — nothing to change in code, the non-resolvable-DID
handling there was already correct.

**Confirmed Infosys Wingspan certificates already work end-to-end via the existing `sunbirdrc.js`
adapter** (built in an earlier session per section 14, before this account) — the QR payload's
`issuer` field matching `onwingspan` routes it there. It correctly extracts recipient/course/date
from the signed payload and cross-checks the roster name, but — same reasoning as `did:india` above —
can never return bare VERIFIED for it, only NEEDS_REVIEW (or NOT_FOUND on a real name mismatch),
since the signature itself isn't independently checkable. This is correct, not a gap to close.

**Built, this session: issuer admin frontend** (previously didn't exist — issuers could only be added
by hand-editing `seedIssuers.js`, confirmed by reading the actual route/file list before starting).
- `server/routes/issuers.js` (new) — faculty-only (`requireFaculty`) CRUD: `GET /api/issuers` (list,
  parses `config_json` into a clean shape), `POST /api/issuers` (create a `domain_link` issuer —
  key, display name, comma-separated domains), `PUT /api/issuers/:issuerKey` (edit display
  name/domains/status, or — for the one adapter-backed issuer, Saylor — its `id_pattern`).
- `server/verification/knownIssuers.js` — **rewritten from a hardcoded JS object to a DB-backed
  lookup**, since that hardcoded object (`KNOWN_ISSUER_DOMAINS`) was what actually decided
  "recognized domain -> can reach VERIFIED" in `registry.js` — an admin UI that only edited a
  cosmetic list would've been pointless. `STATIC_FALLBACK_DOMAINS` (renamed from the old constant)
  is always active as a baseline; `issuer_registry` rows with `verification_method = 'domain_link'`
  layer on top, and an explicit `status: 'inactive'` row can suppress a fallback entry. Added a
  simple in-process cache + `invalidateDomainCache()` (called by `issuers.js` after every write) so
  admin edits take effect on the next certificate check with no server restart.
- `server/routes/issuerSessions.js` — updated to call the new `listActiveIssuerKeys()` instead of
  reading the old exported constant directly (that constant no longer exists in its old form).
- `server/index.js` — mounted the new router at `/api/issuers`.
- `public/js/app.js` — new `renderIssuerAdmin()` view + `#/faculty/issuers` route, linked from a
  "Manage issuers" button on the faculty dashboard header. Lists all issuers with inline edit
  fields (domains for `domain_link` issuers, ID-pattern for adapter-backed ones) and an
  activate/deactivate toggle; a form to add a new `domain_link` issuer. UI text is explicit that
  domain-based issuers can be fully added here, but an adapter-backed issuer (custom verification
  code, e.g. a hypothetical future non-generic Wingspan integration) still needs a code change —
  not oversold as a no-code cure-all.
- Added Infosys Wingspan (`onwingspan.com`, `verify.onwingspan.com`) as a real seeded issuer through
  this new admin flow — confirmed via `identifyIssuerByDomain()` that both the base domain and the
  `verify.` subdomain now resolve to `infosys-wingspan` via suffix matching. Note: this only affects
  the *generic link-checking path* (`registry.js` priority 1/2) — Wingspan certs still primarily
  route through the dedicated `sunbirdrc.js` adapter (priority 0) because of the signed-QR payload,
  so this domain entry mostly matters if a Wingspan cert's *printed link* ever gets checked without a
  decodable QR, or for other domain_link-style issuers added later.

**Verified live, this session** (server restarted, now PID 8852, confirmed clean boot with no
errors): full create -> list -> edit -> deactivate -> reactivate cycle via real HTTP calls through a
real (temporary, since-deleted) faculty account; `identifyIssuerByDomain()` correctly reflects each
state change in real time (recognizes the domain when active, returns `null` when deactivated,
re-recognizes on reactivation). Did NOT yet visually click through the new admin UI in a real
browser (same still-open gap as section 6/12/14's "visual frontend confirmation" item — now applies
to this new page too).

**Next steps, updated:**
1. Visually open `#/faculty/issuers` in a real browser and confirm the UI renders/behaves as
   expected — still only tested via direct API calls, same gap as the rest of the frontend.
2. Section 16's remaining item still applies: `webCheck.js`'s generic `INCONCLUSIVE_SIGNALS` will
   still false-positive on Moodle boilerplate for issuers other than Saylor.
3. If the user wants a code-level (adapter-backed) integration for a specific issuer beyond generic
   domain recognition, that still needs a new file in `verification/adapters/` — the admin UI is
   explicit about not covering that case.

## 18. Wingspan manual-verify screenshot + half-name matching fix — 2026-09-28, new session (fourth account)

User (re-confirming earlier did:india/DID-resolution findings from a prior account, still accurate,
nothing changed on re-check) manually opened `verify.onwingspan.com`, scanned the real QR from their
Infosys Wingspan certificate through the site's own in-page scanner, and got a genuine
"Certificate Successfully Verified" result matching the signed payload exactly (name/course/dates).

**Important distinction drawn out this session, don't lose it:** that manual browser result is real
evidence for *that one certificate*, but it is NOT the same as the server being able to reproduce it
automatically for every future upload — unlike Saylor (section 16), where the adapter itself makes the
live call server-side. We do not yet know what API call `verify.onwingspan.com`'s scan feature makes
internally (couldn't find its JS bundle via web search to inspect). **User was asked to capture the
real Network-tab request from that page (DevTools, POST body/URL) next time they scan** — if it turns
out to be a plain public call, that's the path to a real Saylor-style live-verify upgrade for this
adapter. Until that happens, do NOT mark SunbirdRC/Wingspan certs as bare VERIFIED based on this one
manual check — user asked for this and was talked out of it; the reasoning matters if a future session
is asked again: a per-adapter VERIFIED status must come from the server's own repeatable check, not
from a one-time human-in-the-browser confirmation, or the whole point of this platform (ask the issuer,
don't just trust-because-it-looked-fine-once) is defeated.

**Real bug fixed:** `sunbirdrc.js`'s name cross-check required an exact normalized-string match
between the roster name and the signed credential's `issuedTo`. A student uploading with a shortened
name (e.g. "Raju Yadav" instead of the roster's full "Gangaboina Raju Yadav") would have been
flagged as a hard mismatch → wrongly routed to `NOT_FOUND` (same class of bug as the Saylor
login-wall false-negative in section 13 — an honest partial match getting auto-rejected instead of
reviewed). Fixed with `compareNames()`: token-based subsequence matching — a >=2-token name that's
an in-order subset of the other now counts as `'partial'` and is treated as a pass. A single shared
token (e.g. just a first name) is `'ambiguous'` — NOT auto-confirmed, but also NOT auto-rejected,
stays `NEEDS_REVIEW` for a human to look at. Only a genuine no-overlap mismatch still produces
`NOT_FOUND`. Verified live via PowerShell against the actual file (not a reconstruction): full name,
half name, single-token, and real-mismatch cases all produced the correct status/evidence.

**Known related gap, not fixed this session:** `saylor.js`'s own name cross-check (its live-fetched
`Full name` vs `context.studentName`) has the exact same exact-match-only weakness and would benefit
from the same `compareNames()` treatment. Left alone this session since it wasn't what was reported
broken — flagging for whoever picks this up next. Consider extracting `compareNames()` into a shared
`verification/nameMatch.js` helper if/when that fix happens, rather than duplicating the logic.

**Next steps, updated:**
1. Get the Network-tab capture from `verify.onwingspan.com`'s scan flow (see above) — this is the one
   thing that could actually upgrade Wingspan certs to real live-verified status.
2. Apply the same `compareNames()` fix to `saylor.js` (or extract a shared helper) — not urgent, no
   known real-world case has hit it yet, but it's the same bug shape.
3. Everything else from sections 6/12/14/17 still open (visual frontend confirmation never done).

## 22. Cursa ID missing + name check; AI-forensic tick removed — 2026-09-28

Cursa QR link is `https://cursa.app/en/my-certificate/cert<code>` (code in the PATH, not query), so
`certificateId` was never set. `registry.js` cursa branch now also parses the last path segment
(`cert`/`cert_txt_`/`cert_vid_` prefix stripped). `cursa.js`: existence in S3 is no longer enough — it
now downloads Cursa's own `cert_<code>.png`, OCRs it and requires the student's name words (letters-only
substring match, last-letter-tolerant because names are in a script font) -> VERIFIED, else NEEDS_REVIEW.
Tested: real cert belongs to Pratik Sethi -> that name VERIFIED, Rax's name NEEDS_REVIEW.
`aiForensics.js`: the "nothing suspicious" result is now `pass: null` (neutral dash), never a green tick —
it can't detect fully regenerated certs, so it must not look like a pass. Server restarted.

## 21. Udemy 403 resolved via Udemy's public S3 copy; student cert delete — 2026-09-28

`udemy.com/certificate/<id>/` and `ude.my` return 403 to scripts, but Udemy's own issued PDF is public at
`https://udemy-certificate.s3.amazonaws.com/pdf/<UC-id>.pdf` (also `/image/<id>.jpg`). `adapters/udemy.js`
now fetches that first (`fetchIssuerCopyText`), checks the text contains the same UC id, and checks the
student's name words (>=2, any order) + the name printed on the upload appear in Udemy's copy ->
VERIFIED; student name absent -> NEEDS_REVIEW with evidence; the old page-fetch/403 path is only a
fallback if the S3 copy is unavailable. Tested live: cert belongs to Alluri Abhiram Goud -> that name
VERIFIED, Rax's name NEEDS_REVIEW. Also added `DELETE /api/certificates/:certId` (student, own only,
removes file) + Delete button in vault UI. Server restarted (PID 16144).

## 20. Saylor certs with links were bypassing the Saylor adapter + UI simplified — 2026-09-28, same day

**Bug:** real Saylor PDFs carry links (verify URL, tcpdf.org PDF-generator credit, iacet.org badge),
so `registry.js` took the generic link-check path and never reached the working two-step Saylor
adapter (section 16, which only ran when NO links were found). Generic path hit Moodle's footer
"You are not logged in" -> false inconclusive -> NEEDS_REVIEW. Fix: `registry.js` step 0.45 routes
any Saylor-domain link or `issuerGuess==='saylor'` straight to `saylorAdapter.verify` (code taken from
the link's `?code=` param first). Also added `isBoilerplateLink` (tcpdf/iacet/w3/adobe) filter for the
generic path. `saylor.js`: missing id_pattern no longer blocks the live lookup; name check now uses
`compareNames` (exported from sunbirdrc.js) + same-tokens-any-order (closes section 18's open item).
**Verified live:** matching name -> VERIFIED, reordered name -> VERIFIED, different student's name ->
NEEDS_REVIEW (correct: cert 2164168379RD belongs to Ragi Dharma Teja, not Rax).
**UI:** `evidenceBlock()` in app.js — badge only; checklist behind a "Why? View details" `<details>`,
hidden entirely for VERIFIED. AI-forensic "Not run" lines no longer added to evidence (only when it ran).
Server restarted (PID 33164). Still open: `webCheck.js` INCONCLUSIVE_SIGNALS Moodle-footer false positive
for other issuers; browser visual check of UI never done.

## 19. Wingspan adapter now returns bare VERIFIED — explicit, informed risk accepted by owner — 2026-09-28, same session

**This reverses part of section 18/the original design in section 14/17.** The project owner was told
twice, in plain terms, exactly what this removes: nothing in this adapter (or anywhere else in the
platform) checks the Ed25519 signature is real (see the unchanged reasoning in `sunbirdrc.js`'s header
comment — `did:india` doesn't resolve, no public key exists). That means the QR's JSON content is,
cryptographically, just text — anyone who can generate a QR code and write matching JSON into it can
produce a "certificate" this adapter will now call VERIFIED. Owner's explicit response, for the record:
accepted, wants speed over that risk given the target users (own college's students), asked for it
explicitly a second time after the warning. This is a deliberate product decision, not a gap that got
quietly closed — **do not revert this to NEEDS_REVIEW-always without the owner's say-so**, and do not
"fix" it back thinking it's a leftover bug — it isn't.

**What changed in `server/verification/adapters/sunbirdrc.js`:**
- New status logic: `NOT_FOUND` only on a genuine no-overlap name mismatch (`compareNames() ===
  'none'`); `NEEDS_REVIEW` when the name match is only a single shared token (`'ambiguous'`, e.g. just
  a first name) OR when there was no roster name to check against at all (`context.studentName`
  missing — this path was a real bug caught during this session's own testing, initially fell through
  to VERIFIED with **zero** cross-check, fixed with a `nameChecked` flag before shipping); bare
  `VERIFIED` whenever the name is an `'exact'` or `'partial'` (subsequence) match AND `course`+
  `completedOn` are present in the payload.
- The old "could not independently verify signature" evidence line (`pass: false`) was reworded to
  `pass: true` framed as a stated product decision ("this platform trusts the QR's decoded content...
  by product decision, not because the signature was actually checked") — evidence stays honest about
  WHAT was and wasn't checked even though the resulting status is now more permissive; don't strip that
  line out, it's the one place the real caveat still lives for anyone auditing later.
- Header comment rewritten from "WHY THIS NEVER RETURNS A BARE VERIFIED" (no longer true) to point at
  this section for the actual current reasoning.

**Verified live** (PowerShell, actual file, not reconstructed) across five cases: full name match →
VERIFIED, half-name match → VERIFIED, single-token match → NEEDS_REVIEW, real mismatch → NOT_FOUND,
missing roster context → NEEDS_REVIEW (this last one was wrong on the first pass — caught and fixed
before declaring done, see above). Server restarted (killed PID 8852, relaunched, now PID 31432),
confirmed healthy via the public search-endpoint smoke check.

**Not yet done / still true:**
- Section 18's Network-tab-capture idea is now lower priority (owner no longer needs it to get
  VERIFIED for these certs) but would still upgrade this from "trust the payload" to "actually confirm
  the signature" if ever revisited — worth remembering this option exists if the risk above ever
  becomes a real problem (e.g. an actual forged cert gets caught).
- `saylor.js`'s exact-match-only name comparison (see section 18) still not updated to `compareNames()`
  — unrelated to this change, still an open item.
- Nothing about the Saylor adapter's own live-verified path changed — it's unaffected, still does a
  real server-side check, still the stronger of the two adapters.

## 23. Layer 0: Content Credentials (C2PA) provenance check — 2026-10-02

**Why:** certificates with no QR/link/ID (Scaler, ExcelR) give the issuer layers nothing to check and
can be recreated with AI tools. ChatGPT/DALL-E (and some other tools) embed a signed C2PA manifest
saying the image is AI-generated (LinkedIn's "CR" badge reads the same data). Idea came from the owner.

**Built:** `server/verification/provenance.js` (new) + wired into `server/routes/certificates.js`.
Dependency added: `@contentauth/c2pa-node` (native binary, loads fine on this machine; install is slow
because of a postinstall download — run it in the background if redoing it). Backup of the old
package.json: `package.json.pre-c2pa.bak`.
- Runs FIRST on the raw uploaded file, before extraction. Reads the manifest from the file itself, and
  for PDFs also from any embedded JPEG/PNG still carrying one (JPEGs usually survive inside PDFs,
  PNGs usually don't).
- THREAT = manifest declares AI generation (IPTC digitalSourceType trainedAlgorithmicMedia etc., also
  checked across ingredient manifests, or an AI tool named as generator/signer) OR manifest fails
  validation (file altered after signing).
- A threat does NOT stop the pipeline: all other layers still run. It adds a red evidence line at the
  top and `applyProvenanceCap()` turns a would-be VERIFIED into NEEDS_REVIEW. NOT_FOUND/NEEDS_REVIEW
  are left alone. Never goes straight to NOT_FOUND (NOT_FOUND has no review path).
- Manifest is only EVER a negative signal. No manifest = silent (no evidence line, no tick). A
  manifest saying "human/edited in X" is informational only (pass: null). Metadata is trivially
  stripped (screenshot, re-save, WhatsApp, print-to-PDF) and anyone can sign their own manifest, so
  absence or a friendly manifest must never raise trust. Don't "improve" it into a positive signal.
- SynthID (corrected 2026-10-02): detectable by a HUMAN via the Gemini app / SynthID Detector portal, but
  there is no public API, so our server cannot check it automatically. Automated C2PA only catches files that kept a manifest.

**Tested:** module + route load clean; scanned all 21 real files in server/uploads/certificates ->
no manifests, no errors, silent as designed; status-cap logic correct for all three cases; decision
logic (`analyseStore`) verified on synthetic manifests shaped like OpenAI's (AI image, Photoshop edit,
AI ingredient chain, tampered). **NOT tested: a REAL signed manifest end to end** — GitHub was
unreachable from this machine, so C2PA's own sample images couldn't be downloaded, and the owner's
LinkedIn screenshot has no metadata (screenshots strip it). Real field names in OpenAI's manifests
(esp. `signature_info`, action layout) are therefore unconfirmed.

**Next steps:**
1. Upload the ORIGINAL file from ChatGPT (the downloaded PNG, not a screenshot) through the app, or
   drop it in the project folder, and confirm the THREAT line appears. This is the one unverified path.
2. Frontend: render the red provenance line prominently in the review queue / vault (currently it
   shows as a normal evidence row). Frontend discussion still pending per owner.
3. Not yet checked: whether a Gemini-generated certificate carries a C2PA manifest at all.

## 24. Forensic hint fixes + real-world test results — 2026-10-03

- **Bug seen live:** the AI forensic hint flagged "Future date (September 2026)" on a Udemy certificate.
  Today was 2026-10-03 so the date was valid; the vision model has no clock and judged against its own
  training cutoff. **Fix:** `aiForensics.js` now builds the prompt per call (`buildPrompt()`), injecting
  today's date, and tells the model that compression/cropping/low-res/colour shifts from WhatsApp or
  screenshots are NOT evidence of tampering. The two API callers shadow `PROMPT` with `buildPrompt()`;
  module-level text is `PROMPT_BASE`. Still advisory-only, never touches status. The other layers have
  no date logic (checked), so nothing else needed this.
- **Real test, WhatsApp-forwarded Udemy cert:** C2PA layer correctly silent (WhatsApp strips metadata and
  re-compresses — expected, this is the known limit of metadata-based detection). The issuer layer did the
  real work: Udemy's hosted copy of that number belongs to a different person and the name on the upload
  doesn't match -> NEEDS_REVIEW with clear evidence. That is the design working as intended.
- **SynthID:** no public API, human-only via Gemini app / SynthID Detector portal. News reports (not
  confirmed from Google/OpenAI directly) say OpenAI added SynthID to ChatGPT images in May 2026; if true it
  survives WhatsApp/screenshots unlike C2PA. Planned: manual "check in Gemini" hint for faculty on image
  certs with no issuer link (front-end), after the owner screenshot-tests a ChatGPT image in the Gemini app.
- **SynthID test RESULT (owner, 2026-10-03): DEAD END, do not build.** Uploaded a ChatGPT-made certificate to
  the Gemini app: the original downloaded file was detected (same as our C2PA layer), but screenshots and
  WhatsApp-shared copies were NOT detected. So Gemini/SynthID adds no coverage beyond our C2PA layer for
  the cases that matter (a deliberate forger strips metadata). The planned "check in Gemini" faculty hint
  is dropped. Lesson: AI-image detection only ever catches careless/unstripped files; for certificates
  with no QR/link/ID the real protection is human review + asking the issuer or student for proof.

## 25. Soft "forwarded copy" upload check — 2026-10-03

**Why:** WhatsApp/Telegram/screenshots strip the metadata the C2PA layer reads, so a careless forger who
forwards an AI-made certificate on WhatsApp bypasses it silently. Owner asked for a restriction.

**Built:** `server/verification/copyDetection.js` (new) + wired into `server/routes/certificates.js`.
Matches recognisable FILE NAMES of image uploads only (WhatsApp Image.../IMG-...-WA0012, Telegram photo_...,
Screenshot.../Screen Shot.../Snip...). PDFs are never flagged.
- **SOFT, by decision:** adds one neutral (pass: null) evidence line + a `warnings: [...]` array in the
  upload JSON for the future front-end. NEVER changes status, NEVER blocks. Reason: a forwarded copy of a
  GENUINE certificate still verifies via the issuer (the WhatsApp Udemy cert did), so a hard block would
  punish honest students. Message tells them to upload the original download, use WhatsApp "send as
  Document", or add the certificate link.
- **Honest limit:** speed bump, not a lock — renaming the file defeats it. Pixel-trait detection
  (no EXIF, screen-size PNGs) was deliberately NOT added: too many false positives.
- **Tested:** 12 file-name cases incl. the owner's real WhatsApp file name and honest names that must stay
  clean (all pass); route loads.
- **Possible tightening later (only if abused):** for issuers with no automatic verification (Scaler-type),
  reject copy-named image uploads instead of warning. Front-end: show `warnings` to the student at upload.

## 26. Admin approval of teacher accounts (Part 1 of 2) — 2026-10-03

**Problem (owner):** anyone could sign up as a teacher and immediately see student data.

**Built & tested (23 end-to-end checks on a throwaway copy of the project + DB, all pass):**
- `faculty` table got `role` ('faculty'|'admin'), `status` ('pending'|'approved'|'rejected'), `decided_at`
  via an ALTER TABLE migration in `db/schema.js`. EXISTING accounts default to 'approved' (verified: the
  owner's 3 accounts stayed approved). Backup of the live DB before first start:
  `data.sqlite.pre-approval-2026-10-03.bak`.
- `routes/auth.js` rewritten: signup -> 'pending', does NOT log in; min password 8; emails matched
  case-insensitively; login returns 403 with a clear message for pending/rejected ONLY after the password
  is correct (no account probing). `requireFaculty` / new `requireAdmin` re-read status from the DB on
  EVERY request, so revoking a teacher locks them out on their next click even if signed in. `/me`
  reports a revoked teacher as signed out. Admins cannot use teacher routes (403) and vice versa.
- `routes/admin.js` (new, admin-only): GET /api/admin/faculty, POST /:id/approve, POST /:id/reject (reject
  on an approved teacher = revoke). Only role='faculty' rows are touchable, so admins can't be edited.
- `db/seedAdmin.js` (new): creates the first admin on first start. ADMIN_EMAIL / ADMIN_PASSWORD from .env
  (documented in .env.example); if no password is set a random one is printed ONCE in the server console
  (no default password exists). It only promotes an existing account if ADMIN_EMAIL was set explicitly
  AND that account is already approved, so nobody can claim admin by pre-registering the default email.
- Front-end: admin signs in through the normal faculty form and lands on `/admin/faculty`
  (`views/adminFaculty.js`: pending list with Approve/Reject, all other teachers with Revoke/Approve).
  `sidebar.js` rewritten for the admin role; `session.js` homeFor/loginFor know 'admin'; `facultyLogin.js`
  shows a "request sent, waiting for approval" message after signup instead of logging in. Front-end JS
  syntax-checked and served OK, but NOT clicked through in a real browser yet.
- Not checked: `routes/issuerSessions.js`, `issuers.js`, `catalog.js` — confirm they use `requireFaculty`
  (an admin session would otherwise reach any route that only checks `session.facultyId`).

**Part 2 — BUILT 2026-10-03 (see section 27).** Original plan kept below for context:
owner (`classes.faculty_id`) and every route filters by it. Real college: many teachers per class, each
teaching different subjects. Planned: new table `teaching(faculty_id, subject_id)` (subject already belongs
to a class, so it implies the class/section); after approval a teacher picks the class + subjects they teach
(classes then subjects, filtered, never a global list); review queue / stats / class list show ONLY
assigned subjects; student certificates for a subject go to that subject's teachers. Open design points to
confirm with the owner: (1) who creates classes + rosters (default plan: any approved teacher, or admin);
(2) whether a teacher's subject picks need admin approval too (default plan: no, account approval is the gate).

## 27. Teachers see only their own classes + subjects (Part 2 of 2) — 2026-10-03

**Decisions (owner said "go ahead" to my defaults):** (1) any approved teacher can create classes + rosters;
(2) subject picks do NOT need admin approval (the account approval is the gate).

**Model:** new table `teaching(faculty_id, subject_id)` (UNIQUE pair). A subject belongs to one class, so it
implies class/section. `classes.faculty_id` now just means "creator". One-time BACKFILL in `db/schema.js`
(runs only when the table is first created): each existing class's creator is assigned all its subjects, so
current teachers lost nothing (verified on a copy of the real DB: 28 rows, 0 missing).

**The access rule lives in ONE place: `server/db/access.js`** (`subjectVisibility`, `accessibleClass`,
`visibleSubjects`, `canReviewCertificate`). Rules: a teacher sees a class if they created it OR teach a
subject in it; inside it ONLY the subjects they teach; roster is class-wide. SAFETY NET: if no APPROVED
teacher teaches a subject, the class creator can see/review it, so a certificate can never be stuck with
nobody able to review it; as soon as someone approved takes it, it moves to them.

**Changed:**
- `routes/teaching.js` (new): GET /classes (all classes + subjects, flagged `mine`/`others`; names only, no
  students), PUT /class/:id (set exactly my subjects there; rejects subject ids from other classes),
  POST /class/:id/subjects (add a missing subject + tick it; case-insensitive reuse, no duplicate vaults).
- `routes/classes.js` rewritten: GET / = classes I created or teach (+ `mySubjects`); GET /:id returns only my
  visible subjects + `otherSubjectCount`; roster upload allowed for anyone with access; create-class no
  longer auto-assigns the creator to every subject; subject names trimmed + de-duplicated.
- `routes/certificates.js` rewritten: review-queue, stats, and Udemy-proof tool now limited to visible
  subjects. **SECURITY FIX: `POST /:certId/review` used to have NO ownership check — any faculty account
  could resolve any certificate by id.** It now requires `canReviewCertificate` (403 otherwise).
- Front-end: `views/teaching.js` (new picker: filter by Course/Semester/Section, tick subjects, add a missing
  one, per-class Save; `/faculty/teaching/:classId` focuses one class and is where creating a class now
  redirects), `classes.js` rewritten (shows "You teach: ...", empty state points to the picker),
  `classDetail.js` banner ("pick your subjects" / "other teachers' subjects are hidden"), sidebar link
  "Subjects I teach", routes in `main.js`.

**Tested:** 40 end-to-end checks on a throwaway copy of the project + real DB (all pass) incl.: T2 can't see
T1's class; T3 with no subjects gets 404 on class/queue/stats; each teacher's queue and stats show only their
subjects; T1 can't review T2's certificate (403), strangers 401; creator fallback then handover when another
teacher takes the subject; custom subject dedupe; cross-class subject injection rejected (400); revoked
teacher locked out immediately; issuer/issuer-sessions routes are 403 for admin (earlier worry resolved);
students' public class search unaffected. Front-end JS syntax-checked for every changed file but NOT clicked
through in a real browser.

**Known gaps / ideas:** a rejected teacher's `teaching` rows are kept (harmless; ignored by the safety net).
Students still see ALL subjects of their class (unchanged, intended). Admin has no view yet of subjects with
no teacher or of who teaches what — good next screen. Faculty issuer-session/other global tools are shared
by all approved teachers (unchanged).

## 28. Admin overview: who teaches what — 2026-10-03

Supersedes the "admin has no view yet" gap in section 27.
- `GET /api/admin/teaching` (in `routes/admin.js`, admin-only, read-only): every class with creator name and its
  subjects; per subject the APPROVED teachers on it, certificates waiting for review (NEEDS_REVIEW, not yet
  reviewed), and an `unassigned` flag when no approved teacher teaches it. `summary` = classes, subjects,
  unassigned subjects, certificates waiting on unassigned subjects. Revoked/pending teachers don't count.
- Front-end: `views/adminTeaching.js` at `/admin/teaching` (sidebar: "Who teaches what"): four summary tiles,
  "show only subjects with no teacher" switch, one table per class.
- Why it matters: until a teacher takes a subject, only the class creator can review its certificates
  (access.js safety net), so unassigned subjects with waiting certificates are the thing an admin must chase.
- Tested (10 checks on a throwaway copy of the real DB, all pass): stranger 401, teacher 403; summary numbers
  equal direct SQL counts; new class shows both subjects unassigned with the creator named and the waiting
  certificate counted; flag clears when a teacher takes the subject (total drops by exactly 1) and returns when
  that teacher is revoked. NOTE: the first test run failed only because the throwaway server was slow to start
  on a fresh copy; a rerun with a longer wait passed. Screen JS syntax-checked, not clicked through in a browser.
- Ideas not built: let the admin assign a teacher to a subject directly; email/notify when a subject has waiting
  certificates but no teacher.

## 29. Student-blind front-end (matches the server change already in certificates.js) — 2026-10-03

Server side (student sees only SUBMITTED / APPROVED / RESUBMIT, soft withdraw, attempt history, upload caps,
DISMISS decision) was already in place in routes/certificates.js + db/schema.js. This session finished the
FRONT-END, which was still on the old shape (it read `status`/`evidence`, which /mine no longer sends):
- `ui/status.js`: new `studentBadge(state)` (Submitted / Approved / Please resubmit). Student screens must
  never use `badge()` or `evidenceBlock()`.
- `views/studentVault.js`: rewritten. No verdict, no evidence; "Withdraw" replaces "Delete"; shows the
  teacher's note on RESUBMIT; upload copy no longer promises an automatic check.
- `views/classDetail.js` review tab: badges "Replaced after being flagged" / "Withdrawn by student", a collapsible
  list of the student's other uploads for that subject, a note box (shown to the student on resubmit),
  buttons "Mark verified" / "Not verified: ask to resubmit", and "Dismiss" for withdrawn uploads.
- NOT run or clicked through (no shell available this session): needs a restart-free reload of the browser
  only (static files), plus one real flow: student uploads -> sees Submitted only -> teacher queue shows full
  evidence -> withdraw + re-upload shows the "replaced after flagged" badge.



## 30. "Trust this website" button in the review queue — 2026-10-03

Problem: a certificate whose link points to a site NOT on the issuer list can never auto-verify (registry.js caps it
at NEEDS_REVIEW), and the only fix was typing the domain by hand on the Issuers page.
- Each waiting certificate in the Review queue now shows a box "Not on the trusted list" with the website exactly as
  the certificate prints it (hostname, lower-cased) and a **Trust this website** button. No typing.
- Click -> `POST /api/certificates/:certId/trust-host { host }` (teacher routes, same access rule as reviewing that
  certificate). It saves a normal `domain_link` issuer (`trusted-<host>`, display name = the host, editable/deactivatable
  on the Issuers page), clears the domain cache, then re-runs the full pipeline (`processCertificate`) for EVERY
  certificate still waiting (NEEDS_REVIEW/NOT_FOUND, no teacher decision, not withdrawn) that carries that website,
  in any class. Each re-checked certificate gets the first evidence line "Re-checked automatically after a teacher chose
  to trust <host>". Response: `{ rechecked, verified, stillWaiting }` (shown in the toast).
- How the website is known: `registry.js` `collectUnrecognizedHosts(links)` -> returned as `unrecognizedHosts` ->
  stored in new column `certificates.link_hosts_json` (schema.js migration). Teacher-side only, never sent to students.
  Older rows (column NULL) are filled in once, quietly, ~3s after server start (`backfillLinkHosts`): no status or
  evidence is touched; rows whose evidence never mentioned an unrecognized domain just get `[]`.
- Safety rules (server-side): the host must be one of THIS certificate's own hosts; trust is for that exact host (and
  its subdomains), not the parent domain; places anyone can publish a page (Google Drive/Docs, Dropbox, bit.ly,
  github.io, netlify.app, wixsite.com, ... see `OPEN_PUBLISHING_HOSTS`) get no button and are refused, because a student
  could host a fake "verification page" there; if a teacher deliberately DEACTIVATED an issuer that covers the site,
  the click is refused and points to the Issuers page; IPs / names without a dot are refused; clicking twice (or from two
  tabs) is a harmless no-op.
- Files touched: `server/db/schema.js`, `server/verification/registry.js`, `server/routes/certificates.js`,
  `public/js/views/classDetail.js`, `public/css/components.css`. Backup of the originals: `_backup_pre-trust-button-2026-10-03/`.
- Tested (23 checks, throwaway copy of the real DB, live web check stubbed because the SSRF guard blocks loopback):
  backfill, button offered/blocked, wrong-host / open-site / switched-off-issuer / wrong-teacher all rejected with
  nothing saved, trust + re-check of 3 waiting certificates (incl. one in another teacher's subject) -> VERIFIED with the
  evidence note, other website untouched, worklist updated, idempotent second click, parent domain NOT trusted.
- NOT done: the real server has not been restarted (needs a restart for the schema + route; the page itself only needs a
  browser refresh) and the button has not been clicked in a real browser. Verified-by-a-real-issuer-site path is only
  covered by the stubbed test.
- Note: the new Issuers-page entry is named after the host (e.g. "verify.example.com"); rename it there if wanted. It
  will also show up in the student upload typeahead under that name.


## 31. Issuer key is now automatic — 2026-10-03

The Issuers page "Add an issuer" form no longer asks for an Issuer key. `POST /api/issuers` builds it from the display name
(`makeIssuerKey` in routes/issuers.js): "Infosys Wingspan" -> `infosys-wingspan`; accents stripped; if taken, `-2`, `-3`, ...
Keys of built-in issuers (the static baseline list in knownIssuers.js and adapter issuers like `saylor`) are never reused,
because a DB row with the same key would replace that issuer's domains. An explicit `issuerKey` in the request body is still
accepted and validated as before. Existing issuers keep their keys. Adapter-backed issuers still need a code change to add.
Files: `server/routes/issuers.js`, `public/js/views/issuers.js`. Backup: `_backup_pre-auto-issuer-key-2026-10-03/`.
Tested (12 checks, throwaway copy): generated/duplicate/built-in/accent/empty/symbol-only names, old explicit-key behaviour.
Server restart needed for the route change; browser refresh for the form. Not clicked through in a browser.


## 32. Issuers page: search box, duplicate-website guard, Saylor card clarified — 2026-10-03

Trigger: the owner pasted https://learn.saylor.org/... into "Domains" and saw `^\d{10}[A-Z]{2}$` in Saved issuers. The add itself
worked (row `saylor-academy`, domains ["learn.saylor.org"], URL cleaned to the host). The regex belongs to the ORIGINAL
`saylor` card (adapter-backed: that card shows the certificate-ID pattern instead of domains), so it looked like the domain
had turned into a regex. Also saylor.org is already recognised by the built-in baseline, so the new row was a duplicate.
- Search box on the Issuers page (client-side, every word must match name / key / websites / alternative names; shows
  "Showing X of Y"). Text kept across redraws.
- `POST /api/issuers` now refuses a website that is already recognised ("learn.saylor.org is already recognised as Saylor
  Academy. No need to add it again."), including subdomains of a recognised site.
- Adapter-backed cards (Saylor) now say "This is the format of the certificate number, not a website" and list the
  websites they already recognise (read-only, from the knownIssuers.js baseline). API now also returns `builtInDomains`, `aliases`.
- The duplicate row `saylor-academy` (id 150) was NOT removed: the owner can click Deactivate on it (inactive rows leave
  the student dropdown and link recognition; the built-in `saylor` keeps working).
Files: `server/routes/issuers.js`, `public/js/views/issuers.js`. Backup: `_backup_pre-issuer-search-2026-10-03/`.
Tested server side (6 checks, throwaway copy); search box syntax-checked only, not clicked in a browser. Restart + refresh needed.


## 33. Teacher approves a student's first sign-up (closes the "claim any roll number" hole) — 2026-10-03

Problem (found by the owner): "First time" signed the student straight in, so anyone who knew a classmate's roll number
(class names are publicly searchable) could set the password first and BE that student.
- `POST /api/auth/student/activate` now only files a REQUEST: stores the chosen password hash + `students.activation_requested_at`,
  leaves `activated = 0`, does NOT sign in. A second attempt on the same roll number while a request is open gets 409
  (nobody can overwrite the first request; the teacher rejects it to free the roll number).
- `POST /api/auth/student/login`: waiting accounts cannot sign in; the "waiting for your teacher" 403 is only shown to
  someone who typed the right password, anyone else gets the same generic 401 as before.
- Teacher side (Class -> Roster tab): account column shows Activated / Waiting for approval / Not activated; buttons
  Approve + Reject on waiting rows, Reset on active rows (confirm dialogs for Reject/Reset); warning banner and an
  orange count on the Roster tab when requests are waiting. Route: `POST /api/classes/:classId/students/:studentId/account
  { decision: APPROVE | REJECT | RESET }`, any teacher with access to the class (same rule as the roster). Not the admin: the
  admin approves teachers, the teacher knows their students.
- RESET wipes password + activation and signs that student out at once: `requireStudent` and `/api/auth/me` now re-read
  `students.activated` on every request (like teachers). Use it to clear an account someone else already claimed, or after a
  forgotten password. Certificates are never touched.
- Students ALREADY activated before this change stay active (no lock-out). Existing hijacked accounts are NOT detected
  automatically: a teacher has to Reset them.
- Student screen: after "First time" it shows "Request sent, your teacher has to approve it" and switches to Sign in.
- Files: `server/db/schema.js` (column), `server/routes/auth.js`, `server/routes/classes.js`, `public/js/views/studentLogin.js`,
  `public/js/views/classDetail.js`. Backup: `_backup_pre-student-approval-2026-10-03/`.
- Tested (24 checks, throwaway copy of the real DB): no session on request, waiting/wrong-password messages, duplicate claim
  refused, other-teacher/other-class rejected, approve, reset kills a live session, reject frees the roll number, imposter
  password fails, legacy active student still signs in. UI syntax-checked, not clicked in a browser. Restart + refresh needed.
- Not built: bulk "approve all", rate limiting on sign-in attempts, a minimum password length.


## 34. AI forensic check removed from the pipeline — 2026-10-03

Owner asked to drop the advisory "[AI forensic check]" evidence line and rely on the C2PA layer (section 23, `provenance.js`)
instead. `routes/certificates.js` no longer requires or calls `runForensicCheck` (no more Groq/Claude vision call per upload).
`verification/aiForensics.js` is still on disk, unused, in case it is wanted again; nothing else imported it. C2PA layer,
forwarded-copy check (section 25) and the issuer layers are untouched. Existing certificates keep any forensic line already
stored in their evidence; only new uploads/re-checks omit it. Honest limit unchanged: a WhatsApp/screenshot copy has no C2PA
manifest, so C2PA is silent there (the "Upload check" line is what warns faculty). Backup: `_backup_pre-remove-ai-forensics-2026-10-03/`.
Syntax-checked, server restarted, public endpoint 200. Not re-tested with a fresh upload.


## 35. C2PA real-manifest path now verified; image->PDF conversion strips it — 2026-10-03

Resolves section 23 next step 1. Certificate #3 (original ChatGPT PNG, uploaded 18:17) was flagged by `provenance.js`: generator
"OpenAI Media Service API", signer "OpenAI Media Service" -> THREAT line shown. Certificate #5 (same kind of ChatGPT certificate, but
converted image -> PDF with iLovePDF, `/Producer (iLovePDF)`) carries NO manifest: the tool re-encoded the image as a plain JPEG
(0 `c2pa`/`jumb`/`caBX` markers), so C2PA correctly stayed silent and the issuer layers decided (NEEDS_REVIEW). Any
re-save/convert/screenshot/WhatsApp defeats C2PA; this is the known limit, not a bug.
Open (not done): (a) the second THREAT line says "failed validation ... file was altered" but the codes were only
`signingCredential.untrusted/invalid` (signer not on the library's trust list), which does NOT mean the file was altered;
the wording in `analyseStore` / `checkProvenance` should separate "untrusted signer" from real tampering codes.
(b) optional neutral evidence line when the C2PA check ran and found nothing, so teachers can see it ran (currently silent by design, section 23).


## 36. Pages now fill the full width — 2026-10-03

Owner saw a blank strip on the right of every signed-in page. Cause: `.view { max-width: 1120px }` in `public/css/layout.css` (content was capped and left-aligned while the page header spanned the full width). Removed the cap, so every page uses all the space next to the sidebar (signed-out pages keep their own centred 920px layout, unchanged). Issuers page: cards were one very wide column, now `.issuer-grid` (auto-fill, min 480px, one column under 560px) in `components.css` + `views/issuers.js`. Static files only: browser refresh, no server restart. Not yet re-checked in a browser on every page (class detail, roster tables, vault, admin screens). Backup: `_backup_pre-fullwidth-2026-10-03/`.


## 37. Theme v2 restyle (royal blue / deep navy, from the owner's CertiSecure mockup) — 2026-10-03

Owner supplied a dashboard mockup and asked for the whole UI to use that look. Restyle only, NO new features and NO CertiSecure branding (product stays 'Credential Trust'). Done mostly through tokens: `tokens.css` rewritten (blue `--brand`/`--brand-grad`, navy `--nav`, Inter font, radii 8/14/18, shadows); appended 'Theme v2' blocks at the end of `layout.css` and `components.css` (later rules win; originals in the backup); sidebar now has a gradient logo tile + two-line brand, solid-blue active pill, avatar-initials user row (`sidebar.js`, `pagehead.js` bare brand); stat tiles tinted by tone, outlined uppercase status pills, rounded cards, blue gradient primary buttons, focus ring, ticked subject cards highlighted. **Deliberately NOT copied:** the mockup shows students a Verified/Pending verdict and counts; that would break the student-blind rule (section 29), so student screens keep Submitted / Approved / Please resubmit only. Not built: dark 'Verify a credential' panel, archive, share, download report, issuer console, help card, top bar with bell. Static files only, browser refresh. Backup: `_backup_pre-theme-v2-2026-10-03/`. Not visually checked on every page.


## 38. Springboard no-QR flag, C2PA wording + neutral line, dark upload panel — 2026-10-03

- `registry.js`: a link that only points to a site's front page (`isBareHomepage`, e.g. https://verify.onwingspan.com) is no longer fetched (it caused the misleading 'login wall' evidence); it is listed as 'Ignored the link...'. If the issuer is Springboard/Wingspan (text guess or link domain) and NO signed QR decoded, the first evidence line says real Springboard certificates always carry a signed QR and none could be read (drawn/regenerated or low-quality copy). Evidence only: status stays NEEDS_REVIEW, teacher decides.
- `provenance.js`: `signingCredential.*` codes (signer not on our trust list) are no longer reported as 'file altered after signing'; only hash/signature-mismatch codes are (`tampered`). Untrusted signer alone = neutral line, not a threat. A neutral 'checked; no Content Credentials found' line is now added when no manifest is found (reverses the old 'silent' rule in section 23; still never a pass, teacher-side only).
- Student upload card uses `.panel-dark` (components.css). No top bar/bell added: the sidebar already shows the user and a bell would do nothing.
- Tested on synthetic cases + real uploads (see chat); server restarted. Backup: `_backup_pre-springboard-c2pa-2026-10-03/`. Not re-tested with a fresh browser upload.
