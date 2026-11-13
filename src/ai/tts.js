'use strict';

/**
 * Which engine speaks an answer (2026-11-11, owner: ElevenLabs instead of
 * VoiceLab for voice messages).
 *
 *   TTS_PROVIDER unset      ElevenLabs when it is configured
 *                           (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID), else
 *                           VoiceLab as before - so nothing changes until the
 *                           owner sets the ElevenLabs key and voice
 *   TTS_PROVIDER=elevenlabs | voicelab   that engine first
 *   TTS_FALLBACK=off        no second engine when the first fails (default:
 *                           the other engine, when it is configured)
 *
 * Each engine's call is its own usage-ledger row.
 */

const eleven = require('./elevenlabs-speech');
const voicelab = require('./voicelab-speech');

const ENGINES = { elevenlabs: eleven, voicelab };
const available = name => ENGINES[name].ttsEnabled();

function chain() {
  const want = String(process.env.TTS_PROVIDER || '').trim().toLowerCase();
  const first = want === 'voicelab' ? 'voicelab' : 'elevenlabs';
  const second = first === 'elevenlabs' ? 'voicelab' : 'elevenlabs';
  const fallback = String(process.env.TTS_FALLBACK || '').trim().toLowerCase() !== 'off';
  return [first, fallback ? second : null].filter(n => n && available(n));
}

function ttsEnabled() { return chain().length > 0; }

/** { audio, format: 'ogg' | 'mp3' | 'wav', provider, ... } or null when there is nothing to say. */
async function synthesize(text, options = {}) {
  const engines = options.provider && ENGINES[options.provider] ? [options.provider] : chain();
  if (!engines.length) throw new Error('No text-to-speech engine is configured');
  let lastError = null;
  for (const name of engines) {
    try {
      const out = await ENGINES[name].synthesize(text, options);
      return out ? { provider: name, ...out } : null;
    } catch (e) {
      lastError = e;
      console.warn(`[TTS] ${name} failed${engines.length > 1 ? ', trying the next engine' : ''}:`, e.message);
    }
  }
  throw lastError;
}

const MIME = { ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };

module.exports = { ttsEnabled, synthesize, chain, MIME };
