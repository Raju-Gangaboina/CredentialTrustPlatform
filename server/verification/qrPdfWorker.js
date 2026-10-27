// Runs the PDF-to-PNG render + QR scan for a single certificate PDF, in an isolated worker
// thread — NOT inline in extractor.js's main-thread pdfjs-dist usage.
//
// Why this needs to be a separate thread (found + confirmed by direct testing, 2026-09-27):
// `pdf-to-png-converter` bundles its OWN private copy of `pdfjs-dist` (currently 6.2.108, nested
// under its own node_modules), while our own text/hyperlink-annotation extraction in extractor.js
// requires the top-level `pdfjs-dist` (currently 4.10.38). These are two genuinely different
// resolved packages, but pdfjs-dist's Node "fake worker" bookkeeping is not scoped per-package-copy
// within a single process/module registry — loading both at once in the same thread throws:
//   "The API version "X" does not match the Worker version "Y"."
// every single time, regardless of which one loads first (verified both orders fail). The QR/VC
// payload was therefore NEVER actually being captured in the previous version of this code even
// though it worked perfectly in isolation during manual testing — a real, confirmed bug, not a
// hypothetical one. Running the render+scan step in a `worker_threads` Worker gives it its own
// module registry (a fresh `require` cache per thread), so the two pdfjs-dist copies never coexist
// in the same JS realm. This is cheap enough to do per-upload (a few hundred ms) and needs no new
// dependency, unlike upgrading/aligning pdfjs-dist versions (risk to the working text-extraction
// path) or shelling out to a child process (higher overhead, same fix).
'use strict';
const { parentPort, workerData } = require('worker_threads');

async function run() {
  const Jimp = require('jimp').Jimp ? require('jimp').Jimp : require('jimp');
  const jsQR = require('jsqr');
  const { pdfToPng } = require('pdf-to-png-converter');

  const { filepath, pagesToProcess, viewportScale } = workerData;
  const qrLinks = [];
  let verifiableCredential = null;
  let firstPagePngBase64 = null;

  try {
    const pngPages = await pdfToPng(filepath, { viewportScale, pagesToProcess });
    if (pngPages.length > 0) firstPagePngBase64 = pngPages[0].content.toString('base64');
    for (const pngPage of pngPages) {
      const img = await Jimp.read(pngPage.content);
      const { data: pixelData, width, height } = img.bitmap;
      const code = jsQR(new Uint8ClampedArray(pixelData.buffer, pixelData.byteOffset, pixelData.length), width, height);
      if (!code) continue;

      const raw = code.data.trim();
      if (/^https?:\/\//i.test(raw)) {
        qrLinks.push(raw);
      } else {
        // Not a URL — check whether it's a self-contained signed credential (W3C Verifiable
        // Credential JSON, e.g. SunbirdRC/Infosys Springboard certificates) rather than a link.
        try {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.proof || (parsed.type && String(parsed.type).includes('VerifiableCredential')))) {
            verifiableCredential = parsed;
          }
        } catch { /* not JSON either — QR contains something else this pipeline doesn't handle */ }
      }
      if (verifiableCredential || qrLinks.length > 0) break; // found something usable on this page, stop
    }
  } catch (err) {
    // Render/scan failed (corrupt PDF, unsupported page, etc.) — report nothing found, not fatal.
    parentPort.postMessage({ qrLinks: [], verifiableCredential: null, firstPagePngBase64: null, error: err.message });
    return;
  }

  // firstPagePngBase64 is handed back up so the caller (extractFromFile) can reuse this exact
  // rendering for the AI-forensics advisory check (aiForensics.js) instead of rendering the PDF to
  // an image a second time — rendering is the expensive/version-conflict-prone step here, not the
  // encoding.
  parentPort.postMessage({ qrLinks, verifiableCredential, firstPagePngBase64 });
}

run().catch(err => {
  parentPort.postMessage({ qrLinks: [], verifiableCredential: null, firstPagePngBase64: null, error: err.message });
});
