'use strict';

/**
 * Spoken answers (2026-11-11, owner: ElevenLabs instead of VoiceLab): the
 * engine choice, the ElevenLabs request as sent (key in the header only,
 * voice in the path, no language unless set), the audio handed on as a
 * Telegram voice note, a failure that names no key, and the bot / preview
 * wiring. A stub fetch only - no network, no paid call.
 *
 *   node tests/tts.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const ENV = ['TTS_PROVIDER', 'TTS_FALLBACK', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_TTS_MODEL', 'ELEVENLABS_TTS_LANGUAGE', 'ELEVENLABS_TTS', 'ELEVENLABS_TTS_MAX_CHARS', 'VOICELAB_API_KEY', 'VOICELAB_TTS_VOICE_ID', 'VOICELAB_TTS'];
const clear = () => { for (const k of ENV) delete process.env[k]; };

const tts = require('../src/ai/tts');
const eleven = require('../src/ai/elevenlabs-speech');
const voicelab = require('../src/ai/voicelab-speech');
const health = require('../src/ai/provider-health');

/** A real, tiny WAV (0.2 s of silence) so ffmpeg has something to transcode when it is installed. */
function wav() {
  const n = 3200, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
function stubFetch({ status = 200, body = wav(), headers = {}, text = '' } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), text: async () => text };
  };
  f.calls = calls;
  return f;
}

(async () => {
  console.log('tts');

  await test('engine choice: ElevenLabs once its key and voice are set, VoiceLab until then and behind it; TTS_PROVIDER and TTS_FALLBACK are obeyed', () => {
    clear();
    assert.deepStrictEqual([tts.chain(), tts.ttsEnabled()], [[], false]);
    process.env.VOICELAB_API_KEY = 'vl'; process.env.VOICELAB_TTS_VOICE_ID = 'v1';
    assert.deepStrictEqual(tts.chain(), ['voicelab'], 'nothing changes until ElevenLabs is configured');
    process.env.ELEVENLABS_API_KEY = 'el-secret-key';
    assert.deepStrictEqual(tts.chain(), ['voicelab'], 'a key without a voice is not enough');
    process.env.ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
    assert.deepStrictEqual(tts.chain(), ['elevenlabs', 'voicelab']);
    process.env.TTS_FALLBACK = 'off';
    assert.deepStrictEqual(tts.chain(), ['elevenlabs']);
    delete process.env.TTS_FALLBACK; process.env.TTS_PROVIDER = 'voicelab';
    assert.deepStrictEqual(tts.chain(), ['voicelab', 'elevenlabs']);
    delete process.env.TTS_PROVIDER; process.env.ELEVENLABS_TTS = 'off';
    assert.deepStrictEqual(tts.chain(), ['voicelab']);
    clear();
  });

  await test('the request: voice in the path, the key only in its header, the cleaned text, the model, no language unless set', async () => {
    clear();
    process.env.ELEVENLABS_API_KEY = 'el-secret-key'; process.env.ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
    const f = stubFetch({ headers: { 'character-cost': '41' } });
    const out = await eleven.synthesize('**Tahlil**\n\nIsh beruvchi [MK 161-modda](https://lex.uz/docs/-6257288) bo‘yicha ogohlantirishi shart.', { fetchImpl: f });
    const c = f.calls[0];
    assert.strictEqual(c.url, 'https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128');
    assert.strictEqual(c.init.headers['xi-api-key'], 'el-secret-key');
    assert.ok(!c.url.includes('el-secret-key') && !c.init.body.includes('el-secret-key'));
    const body = JSON.parse(c.init.body);
    assert.deepStrictEqual(Object.keys(body).sort(), ['model_id', 'text']);
    assert.strictEqual(body.model_id, 'eleven_v3');
    assert.ok(!/[*[\]]|https?:/u.test(body.text) && /MK 161-modda/u.test(body.text), 'markup and links are not read aloud');
    assert.deepStrictEqual([out.provider, out.model, out.characters], ['elevenlabs', 'eleven_v3', 41]);
    assert.ok(['ogg', 'mp3'].includes(out.format) && out.audio.length > 40, 'a voice note, or the provider\'s audio when ffmpeg is missing');
    process.env.ELEVENLABS_TTS_LANGUAGE = 'uz'; process.env.ELEVENLABS_TTS_MODEL = 'eleven_v4';
    const f2 = stubFetch();
    const o2 = await eleven.synthesize('Salom', { fetchImpl: f2 });
    assert.deepStrictEqual(JSON.parse(f2.calls[0].init.body), { text: 'Salom', model_id: 'eleven_v4', language_code: 'uz' });
    assert.strictEqual(o2.characters, 5, 'no count from the provider: the characters sent');
    assert.strictEqual(await eleven.synthesize('  ** ', { fetchImpl: stubFetch() }), null, 'nothing to say: no call');
    clear();
  });

  await test('limits and failures: the text is cut to the cap, a bad voice id never reaches the URL, an error carries no key', async () => {
    clear();
    process.env.ELEVENLABS_API_KEY = 'el-secret-key'; process.env.ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; process.env.ELEVENLABS_TTS_MAX_CHARS = '50';
    const f = stubFetch();
    await eleven.synthesize('so‘z '.repeat(100), { fetchImpl: f });
    assert.ok(JSON.parse(f.calls[0].init.body).text.length <= 50);
    const none = stubFetch();
    await assert.rejects(() => eleven.synthesize('Salom', { voiceId: '../v1/user', fetchImpl: none }), /voice id/u);
    assert.strictEqual(none.calls.length, 0);
    const bad = stubFetch({ status: 401, text: '{"detail":"invalid key el-secret-key"}' });
    await assert.rejects(() => eleven.synthesize('Salom', { fetchImpl: bad }), (e) => e.status === 401 && !e.message.includes('el-secret-key') && /\[key\]/u.test(e.message));
    // a refused key opens the provider's breaker: the next call is not even made (no hammering a dead key)
    const after = stubFetch();
    await assert.rejects(() => eleven.synthesize('Salom', { fetchImpl: after }), /not called/u);
    assert.strictEqual(after.calls.length, 0);
    health.reset();
    await assert.rejects(() => eleven.synthesize('Salom', { fetchImpl: stubFetch({ body: Buffer.alloc(10) }) }), /no audio/u);
    health.reset();
    clear();
  });

  await test('fallback: ElevenLabs failing hands the answer to VoiceLab; with TTS_FALLBACK=off the failure is the result', async () => {
    clear();
    process.env.ELEVENLABS_API_KEY = 'k'; process.env.ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; process.env.VOICELAB_API_KEY = 'vl'; process.env.VOICELAB_TTS_VOICE_ID = 'v1';
    health.reset();
    voicelab._setClient({ tts: { synthesize: async () => ({ audio: wav(), durationMs: 200, creditsUsed: 3, charactersUsed: 5 }) } });
    const down = stubFetch({ status: 500, text: 'down' });
    const out = await tts.synthesize('Salom', { fetchImpl: down });
    assert.strictEqual(out.provider, 'voicelab');
    assert.ok(down.calls.length >= 1, 'ElevenLabs was tried first (a transient error may be retried once)');
    process.env.TTS_FALLBACK = 'off'; health.reset();
    await assert.rejects(() => tts.synthesize('Salom', { fetchImpl: stubFetch({ status: 500 }) }), /ElevenLabs TTS 500/u);
    health.reset();
    voicelab._setClient(null);
    clear();
    await assert.rejects(() => tts.synthesize('Salom'), /No text-to-speech engine/u);
  });

  await test('wiring: the bot speaks through the chooser, a master can hear the engine before the bot uses it, the pages name where the voice goes', () => {
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    const fn = bot.slice(bot.indexOf('async function sendVoiceReply'), bot.indexOf('// Each Telegram message is one usage-ledger request'));
    assert.match(fn, /require\('\.\.\/ai\/tts'\)/u);
    assert.ok(!/voicelab-speech/u.test(fn));
    assert.match(fn, /speech\.MIME\[spoken\.format\]/u, 'an MP3 is not sent as a WAV');
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /app\.get\('\/api\/admin\/tts\/preview', requireMasterAdmin/u);
    const page = fs.readFileSync(path.join(__dirname, '../public/app/adaptive.js'), 'utf8');
    assert.match(page, /Google’ga \(AQSh\), ovozli javob matni ElevenLabs’ga \(AQSh\)/u);
    assert.match(page, /в Google \(США\), текст голосового ответа — в ElevenLabs \(США\)/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/interviews/store.js'), 'utf8'), /Google yoki VoiceLab, DeepSeek/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
