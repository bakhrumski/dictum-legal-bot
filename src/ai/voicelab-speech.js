'use strict';

/**
 * VoiceLab speech for the Telegram bot: voice notes in (STT), voice notes out
 * (TTS, optionally in a custom cloned voice).
 *
 * Uses the official @voicelab/sdk (POST /v1/stt, POST /v1/tts). Each half is
 * a separate switch, both off unless configured, so the bot behaves exactly as
 * before until the environment says otherwise:
 *
 *   VOICELAB_API_KEY         required for either half
 *   VOICELAB_STT             'off' to stop transcribing (default on with a key)
 *   VOICELAB_STT_LANGUAGE    default 'uz'
 *   VOICELAB_TTS_VOICE_ID    the voice to answer in; TTS is off without it
 *   VOICELAB_TTS             'off' to stop voice replies while keeping the id
 *   VOICELAB_TTS_LANGUAGE    default 'uz'
 *   VOICELAB_TTS_SPEED       optional, e.g. 1.0
 *   VOICELAB_TTS_MAX_CHARS   longest text spoken, default 2500
 *
 * TTS returns WAV. Telegram only shows OGG/Opus as a voice note (the waveform
 * bubble), so the audio is transcoded with the ffmpeg binary that
 * ffmpeg-static ships. If ffmpeg is unavailable the WAV is returned as is and
 * the caller sends it as an audio file instead — degraded, never lost.
 */

const { spawn } = require('child_process');

let _client = null;
function client() {
  if (_client) return _client;
  const { VoiceLab } = require('@voicelab/sdk');
  _client = new VoiceLab({
    apiKey: String(process.env.VOICELAB_API_KEY || '').trim(),
    baseUrl: process.env.VOICELAB_BASE_URL || undefined,
  });
  return _client;
}

/** For tests: inject a fake SDK client. */
function _setClient(c) { _client = c; }

function hasKey() {
  return String(process.env.VOICELAB_API_KEY || '').trim().length > 0;
}

function off(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'off';
}

function sttEnabled() {
  return hasKey() && !off('VOICELAB_STT');
}

function ttsVoiceId() {
  return String(process.env.VOICELAB_TTS_VOICE_ID || '').trim();
}

function ttsEnabled() {
  return hasKey() && !off('VOICELAB_TTS') && ttsVoiceId().length > 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Transcribe a voice note. Resolves to the transcript text ('' when nothing
 * was recognised). A queued transcription is polled until it finishes.
 *
 * Telegram voice notes are OGG/Opus, which not every STT engine accepts. The
 * audio is first transcoded to 16 kHz mono WAV — the format speech engines
 * take universally and the rate they are trained on — and sent as is only if
 * ffmpeg is unavailable.
 */
async function transcribe(buffer, { filename = 'voice.ogg', contentType = 'audio/ogg', language, pollMs = 1500, maxWaitMs = 60000 } = {}) {
  const lang = language || process.env.VOICELAB_STT_LANGUAGE || 'uz';
  let upload = { data: buffer, filename, contentType };
  try {
    upload = { data: await toSpeechWav(buffer), filename: 'voice.wav', contentType: 'audio/wav' };
  } catch (e) {
    console.warn('[VOICELAB-STT] WAV transcode failed, sending the original audio:', e.message);
  }
  const vl = client();
  const result = await vl.stt.transcribe({
    audio: upload,
    language: lang,
  });
  if (result && typeof result.transcript === 'string') return result.transcript.trim();

  // Queued: poll the transcription until it carries text or fails.
  const id = result && result.id;
  if (!id) throw new Error('VoiceLab STT returned neither a transcript nor an id');
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const detail = await vl.stt.getTranscription(id);
    if (detail && typeof detail.transcript === 'string' && detail.transcript.trim()) return detail.transcript.trim();
    const status = String((detail && detail.status) || '').toLowerCase();
    if (/fail|error|cancel/.test(status)) throw new Error(`VoiceLab STT ${id} ${status}`);
  }
  throw new Error(`VoiceLab STT ${id} still queued after ${maxWaitMs}ms`);
}

/**
 * Legal answers carry Markdown and citation formatting that reads badly
 * aloud. Strip the markup, keep the words.
 */
function textForSpeech(text) {
  const max = Number(process.env.VOICELAB_TTS_MAX_CHARS) || 2500;
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, '$1')   // [label](url) → label
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
    t = (end > max * 0.6 ? cut.slice(0, end + 1) : cut).trim();
  }
  return t;
}

function ffmpegPath() {
  try { return require('ffmpeg-static') || null; } catch (_) { return null; }
}

/** Pipe audio through ffmpeg with the given output arguments. */
function ffmpegPipe(input, outputArgs, { timeoutMs = 30000 } = {}) {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(new Error('ffmpeg not available'));
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...outputArgs, 'pipe:1']);
    const out = [];
    let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 200)}`));
    });
    p.stdin.on('error', () => { /* reported through close */ });
    p.stdin.end(Buffer.from(input));
  });
}

/** WAV → OGG/Opus mono 48 kHz, the format Telegram shows as a voice note. */
function wavToOggOpus(wav, opts) {
  return ffmpegPipe(wav, ['-c:a', 'libopus', '-b:a', '32k', '-ac', '1', '-ar', '48000',
    '-application', 'voip', '-f', 'ogg'], opts);
}

/**
 * Any audio (a Telegram OGG/Opus voice note) → 16 kHz mono 16-bit WAV.
 *
 * ffmpeg writing WAV to a pipe cannot seek back to fill in the lengths, so it
 * leaves both RIFF and data sizes at 0xFFFFFFFF — a header claiming 4 GB,
 * which strict decoders reject. The real sizes are known once the buffer is
 * complete, so they are written in here.
 */
async function toSpeechWav(audio, opts) {
  const wav = await ffmpegPipe(audio, ['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav'], opts);
  return fixWavSizes(wav);
}

function fixWavSizes(wav) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  wav.writeUInt32LE(wav.length - 8, 4);
  // Walk the chunks to the 'data' chunk; its payload runs to the end.
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4);
    if (id === 'data') { wav.writeUInt32LE(wav.length - off - 8, off + 4); break; }
    off += 8 + wav.readUInt32LE(off + 4);
  }
  return wav;
}

/**
 * Speak a reply. Resolves to { audio, format: 'ogg' | 'wav', durationMs,
 * creditsUsed } or null when there is nothing to say.
 */
async function synthesize(text, { language, voiceId, speed } = {}) {
  const spoken = textForSpeech(text);
  if (!spoken) return null;
  const params = {
    text: spoken,
    language: language || process.env.VOICELAB_TTS_LANGUAGE || 'uz',
    voiceId: voiceId || ttsVoiceId(),
  };
  const s = speed != null ? speed : Number(process.env.VOICELAB_TTS_SPEED);
  if (Number.isFinite(s) && s > 0) params.speed = s;

  const speech = await client().tts.synthesize(params);
  const wav = Buffer.from(speech.audio);
  try {
    const ogg = await wavToOggOpus(wav);
    return { audio: ogg, format: 'ogg', durationMs: speech.durationMs, creditsUsed: speech.creditsUsed };
  } catch (e) {
    console.warn('[VOICELAB-TTS] OGG transcode failed, sending WAV:', e.message);
    return { audio: wav, format: 'wav', durationMs: speech.durationMs, creditsUsed: speech.creditsUsed };
  }
}

/** Voices available for a language — used to find the custom voice's id. */
async function listVoices(language = 'uz') {
  const r = await client().voices.list({ language });
  return (r && r.data) || [];
}

module.exports = {
  sttEnabled,
  ttsEnabled,
  transcribe,
  synthesize,
  listVoices,
  textForSpeech,
  wavToOggOpus,
  toSpeechWav,
  _setClient,
};
