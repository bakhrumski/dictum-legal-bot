'use strict';

// VoiceLab STT/TTS for the Telegram bot. The SDK client is replaced with a
// fake, so this runs offline; the ffmpeg transcode runs for real.

const assert = require('assert');
const { spawnSync } = require('child_process');
const speech = require('../src/ai/voicelab-speech');

const KEYS = ['VOICELAB_API_KEY', 'VOICELAB_STT', 'VOICELAB_TTS', 'VOICELAB_TTS_VOICE_ID',
  'VOICELAB_STT_LANGUAGE', 'VOICELAB_TTS_LANGUAGE', 'VOICELAB_TTS_SPEED', 'VOICELAB_TTS_MAX_CHARS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function env(o = {}) { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, o); }

// One second of a 440 Hz tone as 24 kHz mono WAV, made by the same ffmpeg.
function sineWav() {
  const bin = require('ffmpeg-static');
  const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ar', '24000', '-ac', '1', '-f', 'wav', 'pipe:1'], { maxBuffer: 1 << 24 });
  assert.strictEqual(r.status, 0, String(r.stderr));
  return r.stdout;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); }
}

(async () => {
  console.log('\nvoicelab-speech — Telegram STT / TTS\n');

  await test('both halves are off until configured; TTS needs a voice id', () => {
    env();
    assert.strictEqual(speech.sttEnabled(), false);
    assert.strictEqual(speech.ttsEnabled(), false);
    env({ VOICELAB_API_KEY: 'vlk_x' });
    assert.strictEqual(speech.sttEnabled(), true, 'STT is on with just a key');
    assert.strictEqual(speech.ttsEnabled(), false, 'no voice id, no voice replies');
    env({ VOICELAB_API_KEY: 'vlk_x', VOICELAB_TTS_VOICE_ID: 'voice_me', VOICELAB_STT: 'off' });
    assert.strictEqual(speech.sttEnabled(), false);
    assert.strictEqual(speech.ttsEnabled(), true);
    process.env.VOICELAB_TTS = 'off';
    assert.strictEqual(speech.ttsEnabled(), false);
  });

  await test('transcribe sends the voice note in Uzbek and returns the text', async () => {
    env({ VOICELAB_API_KEY: 'vlk_x' });
    let sent;
    speech._setClient({ stt: { transcribe: async (p) => { sent = p; return { id: 't1', transcript: '  Ish haqim kechikyapti  ' }; } } });
    const text = await speech.transcribe(Buffer.from('ogg'), { contentType: 'audio/ogg' });
    assert.strictEqual(text, 'Ish haqim kechikyapti');
    assert.strictEqual(sent.language, 'uz');
    assert.strictEqual(sent.audio.filename, 'voice.ogg');
    assert.strictEqual(sent.audio.contentType, 'audio/ogg');
  });

  await test('a queued transcription is polled until it has text', async () => {
    env({ VOICELAB_API_KEY: 'vlk_x', VOICELAB_STT_LANGUAGE: 'ru' });
    let polls = 0; let lang;
    speech._setClient({ stt: {
      transcribe: async (p) => { lang = p.language; return { id: 't2', status: 'queued' }; },
      getTranscription: async () => (++polls < 3 ? { status: 'processing', segments: [] } : { status: 'completed', transcript: 'Готово' }),
    } });
    assert.strictEqual(await speech.transcribe(Buffer.from('x'), { pollMs: 1 }), 'Готово');
    assert.strictEqual(polls, 3);
    assert.strictEqual(lang, 'ru', 'VOICELAB_STT_LANGUAGE is honoured');
  });

  await test('a failed or endless transcription rejects instead of hanging', async () => {
    speech._setClient({ stt: { transcribe: async () => ({ id: 't3', status: 'queued' }), getTranscription: async () => ({ status: 'failed' }) } });
    await assert.rejects(speech.transcribe(Buffer.from('x'), { pollMs: 1 }), /failed/);
    speech._setClient({ stt: { transcribe: async () => ({ id: 't4', status: 'queued' }), getTranscription: async () => ({ status: 'processing' }) } });
    await assert.rejects(speech.transcribe(Buffer.from('x'), { pollMs: 1, maxWaitMs: 20 }), /still queued/);
  });

  await test('answers are cleaned of Markdown, links and bullets before speaking', () => {
    env();
    const t = speech.textForSpeech('**Mehnat kodeksi**, 100-modda.\n- birinchi\n• ikkinchi\n[Lex.uz](https://lex.uz/docs/1) va https://lex.uz/x `kod`');
    assert.strictEqual(t, 'Mehnat kodeksi, 100-modda.\nbirinchi\nikkinchi\nLex.uz va kod');
  });

  await test('long answers are cut at a sentence end', () => {
    env({ VOICELAB_TTS_MAX_CHARS: '60' });
    const t = speech.textForSpeech('Birinchi gap juda uzun emas. Ikkinchi gap ham bor. Uchinchi gap esa limitdan oshadi va kesiladi.');
    assert.strictEqual(t, 'Birinchi gap juda uzun emas. Ikkinchi gap ham bor.');
  });

  await test('synthesize speaks in the configured voice and returns an OGG/Opus voice note', async () => {
    env({ VOICELAB_API_KEY: 'vlk_x', VOICELAB_TTS_VOICE_ID: 'voice_owner', VOICELAB_TTS_SPEED: '1.1' });
    const wav = sineWav();
    let sent;
    speech._setClient({ tts: { synthesize: async (p) => { sent = p; return { audio: wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length), durationMs: 1000, creditsUsed: 12 }; } } });
    const out = await speech.synthesize('**Javob:** 100-modda.');
    assert.deepStrictEqual(sent, { text: 'Javob: 100-modda.', language: 'uz', voiceId: 'voice_owner', speed: 1.1 });
    assert.strictEqual(out.format, 'ogg');
    assert.strictEqual(out.audio.slice(0, 4).toString(), 'OggS', 'a real Ogg container');
    assert.ok(out.audio.includes(Buffer.from('OpusHead')), 'carrying Opus');
    assert.ok(out.audio.length < wav.length, 'smaller than the WAV');
    assert.strictEqual(out.creditsUsed, 12);
  });

  await test('if the transcode fails the WAV is returned, not lost', async () => {
    env({ VOICELAB_API_KEY: 'vlk_x', VOICELAB_TTS_VOICE_ID: 'v' });
    speech._setClient({ tts: { synthesize: async () => ({ audio: new TextEncoder().encode('not audio').buffer }) } });
    const warn = console.warn; console.warn = () => {};
    try {
      const out = await speech.synthesize('Salom');
      assert.strictEqual(out.format, 'wav');
      assert.strictEqual(out.audio.toString(), 'not audio');
    } finally { console.warn = warn; }
    assert.strictEqual(await speech.synthesize('   '), null, 'nothing to say → null');
  });

  env(saved);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
