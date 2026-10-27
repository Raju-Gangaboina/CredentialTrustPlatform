// AI forensic check — ADVISORY ONLY, NEVER A DECIDING VOTE.
//
// This is the one piece of "ask an AI whether it looks real" the product deliberately keeps out of
// the trust decision (see memory.md section 1 — the whole point of this platform is asking the
// *issuer*, not an AI's gut feeling). But the user specifically wants a second, clearly-labeled
// opinion layer for cases the issuer-check pipeline can't reach at all — e.g. Scaler/ExcelR-style
// certificates with no public verification portal (confirmed, see memory.md section 5) — where an
// AI's read on "does this look like a template-generated / AI-generated image" is better than
// nothing, AS LONG AS faculty can see exactly what it is and isn't.
//
// HARD RULE, enforced by the caller (server/routes/certificates.js), not by trusting this file
// alone: whatever this module returns must NEVER affect `status` (VERIFIED / NOT_FOUND /
// NEEDS_REVIEW / PENDING). It only ever appends one extra, clearly-labeled evidence line for
// faculty to read, after the real status has already been decided by runVerification().
//
// Requires either ANTHROPIC_API_KEY or GROQ_API_KEY in the environment (checked in that order —
// Anthropic preferred when both are set, since Claude vision tends to follow the narrow "advisory
// only" instruction more reliably, but Groq works fine and has a free tier for anyone without an
// Anthropic key). If neither is set, this reports itself as unavailable rather than silently doing
// nothing or faking a result — see the "not configured" branch below. Copy .env.example to .env and
// set one of the two keys to turn this on.
const fs = require('fs');

const ANTHROPIC_MODEL = process.env.AI_FORENSICS_MODEL || 'claude-sonnet-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_MODEL = process.env.AI_FORENSICS_GROQ_MODEL || 'qwen/qwen3.8-27b'; // was llama-4-scout, which Groq removed (HTTP 404, 2026-09-28)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const PROMPT_BASE = `You are doing a purely advisory, non-authoritative visual check on a certificate image for a campus system. This is NOT the source of truth — a rule-based system already checked the issuer directly. Your job is narrow: look ONLY for visual red flags that suggest the certificate graphic itself may be AI-generated, templated/forged, or digitally tampered with (e.g. inconsistent fonts within the same field, warped or nonsensical logos/seals, garbled text, mismatched shadow/lighting on a "signature", telltale diffusion-model artifacts, an unusually generic/stock template look). Do NOT try to confirm whether the credential is real — you have no way to know that from a picture alone, and must not imply otherwise.

Respond with ONLY a JSON object, no other text, no markdown fences:
{"suspicious": true|false, "confidence": "low"|"medium"|"high", "reasons": ["short reason", ...]}
If nothing looks off, return {"suspicious": false, "confidence": "low", "reasons": []}.`;

// Built per call so the model always knows today's date. A vision model has no clock and judges
// dates against its own training cutoff: on 2026-10-03 it flagged a September 2026 date as "future"
// (seen in the wild, 2026-10-03). Also tells it that WhatsApp/screenshot damage is normal here, since
// students upload forwarded images and that is not evidence of tampering.
function buildPrompt() {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, server local time
  return `${PROMPT_BASE}

Context you must respect: today's date is ${today}. Any date on or before ${today} is NOT in the future, whatever your training data suggests. Never call a date "future" or "impossible" unless it is after ${today}. Also ignore image-quality effects: these files are often forwarded through WhatsApp, screenshotted or cropped, so compression blur, cropping, low resolution, odd aspect ratio or colour shifts are NOT evidence of tampering. Only report things you can actually point to in the image; if unsure, do not flag it.`;
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY);
}

function getProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GROQ_API_KEY) return 'groq';
  return null;
}

// Returns { available: boolean, evidence: {label, pass} } — `pass` here is purely cosmetic (drives
// an icon in the UI) and is NEVER read by the verification engine's status logic; see header.
async function runForensicCheck(extraction, filepath) {
  const label = (text, pass) => ({ label: `[AI forensic check — advisory only, does not affect status] ${text}`, pass });

  const provider = getProvider();
  if (!provider) {
    return {
      available: false,
      evidence: label('Not run — no ANTHROPIC_API_KEY or GROQ_API_KEY configured on this server (see .env.example)', null)
    };
  }

  let imageBase64 = null;
  let mediaType = 'image/png';
  try {
    if (extraction.sourceType === 'image-ocr') {
      imageBase64 = fs.readFileSync(filepath).toString('base64');
      const ext = filepath.slice(filepath.lastIndexOf('.') + 1).toLowerCase();
      mediaType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    } else if (extraction.renderedPageImageBase64) {
      imageBase64 = extraction.renderedPageImageBase64;
      mediaType = 'image/png';
    }
  } catch (err) {
    return { available: false, evidence: label(`Not run — could not read image data (${err.message})`, null) };
  }

  if (!imageBase64) {
    return { available: false, evidence: label('Not run — no image available for this file (text-only PDF page render was not produced)', null) };
  }

  try {
    const { ok, status, textBlock } = provider === 'groq'
      ? await callGroq(imageBase64, mediaType)
      : await callAnthropic(imageBase64, mediaType);

    if (!ok) {
      return { available: false, evidence: label(`Not run — API call failed (HTTP ${status})`, null) };
    }
    if (!textBlock) return { available: false, evidence: label('Not run — no response content', null) };

    let parsed;
    try {
      parsed = JSON.parse(textBlock.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch {
      return { available: false, evidence: label('Ran, but response was not parseable — treat as no opinion', null) };
    }

    if (parsed.suspicious) {
      const reasons = Array.isArray(parsed.reasons) && parsed.reasons.length ? `: ${parsed.reasons.join('; ')}` : '';
      return {
        available: true,
        evidence: label(`Flagged possible visual signs of AI-generation/tampering (confidence: ${parsed.confidence || 'unknown'})${reasons} — human judgement required, this is a hint, not proof`, false)
      };
    }
    return { available: true, evidence: label('No obvious visual signs of AI-generation/tampering detected — this does NOT confirm authenticity, only that nothing looked visually off (an AI can miss a fully regenerated certificate, so this is never a pass)', null) };
  } catch (err) {
    return { available: false, evidence: label(`Not run — request error (${err.message})`, null) };
  }
}

// Anthropic Messages API — content is an array of blocks; we want the first { type: 'text' } one.
async function callAnthropic(imageBase64, mediaType) {
  const PROMPT = buildPrompt();
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: PROMPT }
        ]
      }]
    })
  });
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json();
  const block = (data.content || []).find(b => b.type === 'text');
  return { ok: true, textBlock: block ? block.text : null };
}

// Groq's OpenAI-compatible chat.completions endpoint — image goes in as a data: URI inside an
// image_url content part, response text is choices[0].message.content (a plain string, not blocks).
async function callGroq(imageBase64, mediaType) {
  const PROMPT = buildPrompt();
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } }
        ]
      }]
    })
  });
  if (!response.ok) return { ok: false, status: response.status };
  const data = await response.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return { ok: true, textBlock: text || null };
}

module.exports = { runForensicCheck, isConfigured };
