'use strict';

/**
 * Spoken answers through ElevenLabs (2026-11-11, owner: ElevenLabs instead
 * of VoiceLab for voice messages).
 *
 *   endpoint  POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128
 *   auth      xi-api-key
 *   body      { text, model_id, language_code? }
 *   reply     the audio bytes (MP3), transcoded here to OGG/Opus so Telegram
 *             shows a voice bubble; without ffmpeg the MP3 goes as audio
 *
 *   ELEVENLABS_API_KEY        the key (never logged)
 *   ELEVENLABS_VOICE_ID       the voice; without it TTS is off
 *   ELEVENLABS_TTS_MODEL      default eleven_v3 - whether a model speaks
 *                             Uzbek was not checked from here (the docs host
 *                             is not reachable from this environment); the
 *                             owner picks the model and voice by ear with
 *                             /api/admin/tts/preview before the bot uses it
 *   ELEVENLABS_TTS_LANGUAGE   optional language_code (e.g. uz); not sent
 *                             unless set - a model that does not take the
 *                             field refuses the request
 *   ELEVENLABS_TTS_MAX_CHARS  default 2500
 *   ELEVENLABS_TTS=off        stops it
 *
 * The text of the answer leaves for api.elevenlabs.io. Billing is in the
 * account's credits per character, so the ledger row carries the characters
 * and an unknown dollar cost (never $0).
 */

const usageLedger = require('./usage-ledger');
const voicelab = require('./voicelab-speech'); // the shared text clean-up and the ffmpeg pipe

const BASE = () => String(process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/+$/u, '');
const apiKey = () => String(process.env.ELEVENLABS_API_KEY || '').trim();
const hasKey = () => apiKey().length > 0;
const voiceId = () => String(process.env.ELEVENLABS_VOICE_ID || '').trim();
const model = () => String(process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3').trim();
const off = () => String(process.env.ELEVENLABS_TTS || '').trim().toLowerCase() === 'off';

function ttsEnabled() { return hasKey() && !off() && voiceId().length > 0; }

/** A provider error without the key in it. */
function httpError(status, text) {
  const key = apiKey();
  let msg = String(text || '').slice(0, 300);
  if (key) msg = msg.split(key).join('[key]');
  const e = new Error(`ElevenLabs TTS ${status}: ${msg}`);
  e.status = status;
  return e;
}

/**
 * Speak a reply. Resolves to { audio, format: 'ogg' | 'mp3', characters,
 * provider: 'elevenlabs', model } or null when there is nothing to say.
 */
async function synthesize(text, { voiceId: voice, language, modelId, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const max = Number(process.env.ELEVENLABS_TTS_MAX_CHARS) || 2500;
  let spoken = voicelab.textForSpeech(text);
  if (spoken.length > max) spoken = spoken.slice(0, max);
  if (!spoken) return null;
  const v = String(voice || voiceId());
  if (!/^[A-Za-z0-9_-]{6,64}$/u.test(v)) throw new Error('ElevenLabs voice id is missing or malformed');
  const m = String(modelId || model());
  const lang = String(language || process.env.ELEVENLABS_TTS_LANGUAGE || '').trim();
  const body = { text: spoken, model_id: m, ...(lang ? { language_code: lang } : {}) };

  const out = await usageLedger.track({ provider: 'elevenlabs', model: `elevenlabs/${m}`, stage: 'tts', bound: { usd: null, reason: 'speech is billed in the account\'s credits per character; no dollar bound here' } }, async (call) => {
    const r = await fetchImpl(`${BASE()}/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw httpError(r.status, await r.text().catch(() => ''));
    const audio = Buffer.from(await r.arrayBuffer());
    if (audio.length < 200) throw new Error('ElevenLabs TTS returned no audio');
    // the provider's own count when it sends one, else what we sent
    const billed = Number(r.headers.get('character-cost') || r.headers.get('x-character-count'));
    call.usage({ characters: Number.isFinite(billed) && billed > 0 ? billed : spoken.length, credits: null, audioMs: null });
    return { audio, characters: Number.isFinite(billed) && billed > 0 ? billed : spoken.length };
  });

  try {
    // any input -> OGG/Opus mono 48 kHz (the pipe is format-agnostic)
    const ogg = await voicelab.wavToOggOpus(out.audio);
    return { audio: ogg, format: 'ogg', characters: out.characters, provider: 'elevenlabs', model: m };
  } catch (e) {
    console.warn('[ELEVENLABS-TTS] OGG transcode failed, sending MP3:', e.message);
    return { audio: out.audio, format: 'mp3', characters: out.characters, provider: 'elevenlabs', model: m };
  }
}

module.exports = { ttsEnabled, synthesize, hasKey, voiceId, model };
