'use strict';

/**
 * Speech-to-text with Gemini 3.5 Transcribe (Gemini Developer API).
 *
 *   model     gemini-3.5-transcribe (public preview, announced 2026-08-26)
 *   endpoint  POST https://generativelanguage.googleapis.com/v1beta/interactions
 *   audio     uploaded through the Files API first, passed by uri
 *   config    generation_config.transcription_config:
 *               language_codes ['uz-UZ'] (omit = auto-detect, mixed speech),
 *               mode 'verbatim' (default) | 'smart',
 *               diarization_mode 'speaker' (verbatim only, up to 8 speakers)
 *   limits    1 hour per request; 30 minutes with diarization or timestamps
 *   price     $2.00 / 1M audio-input tokens, $12.00 / 1M output tokens
 *             (~ $0.003 + $0.002 a minute) — ai.google.dev pricing, 2026-10-14
 *
 * Docs: https://ai.google.dev/gemini-api/docs/transcribe
 *
 * Off unless GEMINI_API_KEY is set. The response shape of the Interactions
 * API is read defensively (output_text, outputs[], steps[]), because only the
 * SDK accessor is documented; /api/admin/stt/compare shows the raw response
 * on staging so the parser can be checked against a real call.
 */

const usageLedger = require('./usage-ledger');

const MODEL = () => String(process.env.GEMINI_STT_MODEL || 'gemini-3.5-transcribe').trim();
const BASE = 'https://generativelanguage.googleapis.com';
// ~ $0.003 a minute of audio at $2.00 / 1M = 25 audio tokens a second; used
// only when the response carries no token counts (then marked estimated).
const EST_AUDIO_TOKENS_PER_SEC = 25;

function apiKey() { return String(process.env.GEMINI_API_KEY || '').trim(); }
function hasKey() { return apiKey().length > 0; }

function langCode(lang) {
  const l = String(lang || '').toLowerCase();
  if (!l || l === 'auto') return null;
  if (l.startsWith('uz')) return 'uz-UZ';
  if (l.startsWith('ru')) return 'ru-RU';
  if (l.startsWith('en')) return 'en-US';
  return /^[a-z]{2}-[A-Z]{2}$/.test(lang) ? lang : null;
}

function httpError(status, text, what) {
  const e = new Error(`Gemini ${what} ${status}: ${String(text || '').slice(0, 300)}`);
  e.status = status;
  return e;
}

async function uploadFile(buffer, mimeType, { timeoutMs = 60000, fetchImpl = fetch } = {}) {
  const start = await fetchImpl(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey(),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `stt-${Date.now()}` } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!start.ok) throw httpError(start.status, await start.text().catch(() => ''), 'upload start');
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error('Gemini upload: no upload url');
  const up = await fetchImpl(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(buffer.length) },
    body: buffer,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!up.ok) throw httpError(up.status, await up.text().catch(() => ''), 'upload');
  const data = await up.json();
  let file = data && data.file;
  if (!file || !file.uri) throw new Error('Gemini upload: no file uri');
  // audio is usually ACTIVE at once; wait briefly if it is still processing
  for (let i = 0; i < 20 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const g = await fetchImpl(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': apiKey() }, signal: AbortSignal.timeout(15000) });
    if (g.ok) file = await g.json();
  }
  if (file.state === 'FAILED') throw new Error('Gemini upload: file processing failed');
  return file;
}

function deleteFile(name, fetchImpl = fetch) {
  if (!name) return;
  fetchImpl(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey() }, signal: AbortSignal.timeout(15000) }).catch(() => {});
}

/** The transcript text of an Interactions response, whatever its shape. */
function textOf(resp) {
  if (!resp || typeof resp !== 'object') return '';
  if (typeof resp.output_text === 'string') return resp.output_text;
  if (typeof resp.outputText === 'string') return resp.outputText;
  const parts = [];
  for (const o of Array.isArray(resp.outputs) ? resp.outputs : []) if (o && typeof o.text === 'string') parts.push(o.text);
  if (parts.length) return parts.join('');
  for (const s of Array.isArray(resp.steps) ? resp.steps : []) {
    for (const c of Array.isArray(s && s.content) ? s.content : []) if (c && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('');
}

function seconds(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(String(v));
  return m ? Number(m[1]) : null;
}

/** word_info annotations -> [{ speaker, start, end, text }] by speaker turn. */
function segmentsOf(resp) {
  const words = [];
  for (const s of Array.isArray(resp && resp.steps) ? resp.steps : []) {
    for (const c of Array.isArray(s && s.content) ? s.content : []) {
      for (const a of Array.isArray(c && c.annotations) ? c.annotations : []) {
        if (a && (a.type === 'word_info' || a.word_info) ) {
          const w = a.word_info || a;
          if (typeof w.text === 'string') words.push({ text: w.text, speaker: w.speaker || null, start: seconds(w.start_offset || w.startOffset), end: seconds(w.end_offset || w.endOffset) });
        }
      }
    }
  }
  const segs = [];
  for (const w of words) {
    const last = segs[segs.length - 1];
    if (last && last.speaker === w.speaker) { last.text += (/^[,.;:!?)]/.test(w.text) ? '' : ' ') + w.text; if (w.end != null) last.end = w.end; }
    else segs.push({ speaker: w.speaker, start: w.start, end: w.end, text: w.text });
  }
  return segs;
}

/** Token counts from the response, under whichever names it uses. */
function usageOf(resp) {
  const u = (resp && (resp.usage || resp.usage_metadata || resp.usageMetadata)) || {};
  const pick = (...k) => { for (const x of k) if (Number.isFinite(Number(u[x])) && u[x] != null) return Number(u[x]); return null; };
  return {
    inTokens: pick('total_input_tokens', 'input_tokens', 'prompt_token_count', 'promptTokenCount'),
    outTokens: pick('total_output_tokens', 'output_tokens', 'candidates_token_count', 'candidatesTokenCount'),
  };
}

/**
 * Transcribe audio. Returns { text, segments, raw, model, ms }.
 * options: contentType, language ('uz' | 'ru' | 'en' | 'auto'), diarize,
 * mode ('verbatim' | 'smart'), durationSec (for the cost estimate).
 */
async function transcribeDetailed(buffer, options = {}) {
  if (!hasKey()) throw new Error('GEMINI_API_KEY is not set');
  const model = MODEL();
  const bound = { usd: null, reason: 'audio length known only after decoding; ~ $0.005 a minute' };
  return usageLedger.track({ provider: 'gemini', model, stage: 'stt', bound, retryTransient: 1 }, async (call) => {
    const started = Date.now();
    const mime = String(options.contentType || 'audio/ogg').split(';')[0];
    const file = await uploadFile(buffer, mime, { fetchImpl: options.fetchImpl });
    try {
      const lang = langCode(options.language || process.env.GEMINI_STT_LANGUAGE || 'uz');
      const tc = {};
      if (lang) tc.language_codes = [lang];
      if (options.mode === 'smart') tc.mode = 'smart';
      else if (options.diarize) tc.mode = { type: 'verbatim', diarization_mode: 'speaker' };
      const body = { model, input: [{ type: 'audio', uri: file.uri, mime_type: mime }] };
      if (Object.keys(tc).length) body.generation_config = { transcription_config: tc };
      const res = await (options.fetchImpl || fetch)(`${BASE}/v1beta/interactions`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.GEMINI_STT_TIMEOUT_MS) || 180000),
      });
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''), 'transcribe');
      const raw = await res.json();
      const text = textOf(raw).trim();
      const u = usageOf(raw);
      const audioMs = Number.isFinite(Number(options.durationSec)) && options.durationSec > 0 ? Math.round(options.durationSec * 1000) : null;
      if (u.inTokens != null || u.outTokens != null) {
        call.usage({ inTokens: u.inTokens || 0, outTokens: u.outTokens || 0, audioMs });
      } else if (audioMs) {
        // no token counts in the response: estimate from the audio length
        call.usage({ inTokens: Math.round(audioMs / 1000 * EST_AUDIO_TOKENS_PER_SEC), outTokens: Math.ceil(text.length / 4), audioMs, estimated: true });
      }
      return { text, segments: segmentsOf(raw), raw, model, ms: Date.now() - started };
    } finally {
      deleteFile(file.name, options.fetchImpl);
    }
  });
}

async function transcribe(buffer, options = {}) {
  return (await transcribeDetailed(buffer, options)).text;
}

module.exports = { hasKey, transcribe, transcribeDetailed, textOf, segmentsOf, usageOf, langCode, MODEL };
