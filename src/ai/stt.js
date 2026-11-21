'use strict';

/**
 * Which engine turns speech into text.
 *
 *   STT_PROVIDER unset     Gemini 3.5 Transcribe (src/ai/gemini-transcribe.js)
 *                          when GEMINI_API_KEY is set - the owner's choice of
 *                          2026-11-11 - with VoiceLab behind it; no Gemini
 *                          key: VoiceLab alone, as before
 *   STT_PROVIDER=gemini | voicelab   that engine first
 *   STT_FALLBACK=off       no second engine when the first fails (default:
 *                          the other engine, when it is configured)
 *
 * Each engine's call is its own row in the usage ledger, so both costs stay
 * visible. The audio leaves for the engine that reads it (Gemini: Google).
 */

const voicelab = require('./voicelab-speech');
const gemini = require('./gemini-transcribe');

function available(name) { return name === 'gemini' ? gemini.hasKey() : voicelab.sttEnabled(); }
function primary() {
  const want = String(process.env.STT_PROVIDER || '').trim().toLowerCase();
  if (want === 'voicelab' || want === 'gemini') return want;
  return gemini.hasKey() ? 'gemini' : 'voicelab';
}
function fallbackOn() { return String(process.env.STT_FALLBACK || '').trim().toLowerCase() !== 'off'; }

/** The engines to try, in order. */
function chain() {
  const first = primary();
  const second = first === 'gemini' ? 'voicelab' : 'gemini';
  return [first, fallbackOn() ? second : null].filter(n => n && available(n));
}

function sttEnabled() { return chain().length > 0; }

/** { text, segments, provider } — segments only from an engine that gives them. */
async function transcribeDetailed(buffer, options = {}) {
  const engines = chain();
  if (!engines.length) throw new Error('No speech-to-text engine is configured');
  let lastError = null;
  for (const name of engines) {
    try {
      if (name === 'gemini') {
        const r = await gemini.transcribeDetailed(buffer, options);
        return { text: r.text, segments: r.segments, provider: 'gemini', model: r.model };
      }
      const text = await voicelab.transcribe(buffer, options);
      return { text, segments: [], provider: 'voicelab', model: 'voicelab/stt' };
    } catch (e) {
      lastError = e;
      console.warn(`[STT] ${name} failed${engines.length > 1 ? ', trying the next engine' : ''}:`, e.message);
    }
  }
  throw lastError;
}

async function transcribe(buffer, options = {}) {
  return (await transcribeDetailed(buffer, options)).text;
}

module.exports = { sttEnabled, transcribe, transcribeDetailed, primary, chain };
