'use strict';
// Gemini 3.5 Transcribe adapter and the STT engine choice (no network: fake fetch).
const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
function resp(status, body, headers = {}) {
  return { ok: status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, json: async () => body, text: async () => JSON.stringify(body) };
}

(async () => {
  console.log('gemini transcribe');
  process.env.GEMINI_API_KEY = 'test-key';
  const g = require(path.join(__dirname, '..', 'src', 'ai', 'gemini-transcribe'));
  const calls = [];
  const fake = async (url, opt) => {
    calls.push({ method: opt.method || 'GET', url, body: typeof opt.body === 'string' ? JSON.parse(opt.body) : null, headers: opt.headers || {} });
    if (url.includes('/upload/v1beta/files')) return resp(200, {}, { 'x-goog-upload-url': 'https://upload.example/s1' });
    if (url === 'https://upload.example/s1') return resp(200, { file: { name: 'files/abc', uri: 'https://files.example/abc', state: 'ACTIVE' } });
    if (url.endsWith('/v1beta/interactions')) return resp(200, { steps: [{ content: [{ type: 'text', text: 'Salom dunyo. Yaxshimisiz?', annotations: [
      { type: 'word_info', text: 'Salom', speaker: 'spk_1', start_offset: '0.1s', end_offset: '0.5s' },
      { type: 'word_info', text: 'dunyo.', speaker: 'spk_1', start_offset: '0.5s', end_offset: '0.9s' },
      { type: 'word_info', text: 'Yaxshimisiz?', speaker: 'spk_2', start_offset: '1.2s', end_offset: '2.0s' }] }] }],
      usage: { total_input_tokens: 1500, total_output_tokens: 12 } });
    return resp(200, {});
  };

  await test('uploads through the Files API, transcribes through /v1beta/interactions, deletes the file', async () => {
    const r = await g.transcribeDetailed(Buffer.from('audio'), { contentType: 'audio/ogg', language: 'uz', diarize: true, fetchImpl: fake });
    assert.strictEqual(r.text, 'Salom dunyo. Yaxshimisiz?');
    assert.deepStrictEqual(calls.map(c => c.method + ' ' + c.url.replace(/\?.*/, '')), [
      'POST https://generativelanguage.googleapis.com/upload/v1beta/files', 'POST https://upload.example/s1',
      'POST https://generativelanguage.googleapis.com/v1beta/interactions', 'DELETE https://generativelanguage.googleapis.com/v1beta/files/abc']);
    assert.strictEqual(calls[0].headers['x-goog-api-key'], 'test-key', 'key in a header, never in the url');
    assert.ok(!calls.some(c => /key=/.test(c.url)));
  });
  await test('request: model, audio by uri, uz-UZ, verbatim with speaker diarization', () => {
    const body = calls.find(c => c.url.endsWith('/interactions')).body;
    assert.strictEqual(body.model, 'gemini-3.5-transcribe');
    assert.deepStrictEqual(body.input, [{ type: 'audio', uri: 'https://files.example/abc', mime_type: 'audio/ogg' }]);
    assert.deepStrictEqual(body.generation_config.transcription_config, { language_codes: ['uz-UZ'], mode: { type: 'verbatim', diarization_mode: 'speaker' } });
  });
  await test('word_info annotations become speaker turns', async () => {
    const r = await g.transcribeDetailed(Buffer.from('a'), { diarize: true, fetchImpl: fake });
    assert.deepStrictEqual(r.segments, [{ speaker: 'spk_1', start: 0.1, end: 0.9, text: 'Salom dunyo.' }, { speaker: 'spk_2', start: 1.2, end: 2, text: 'Yaxshimisiz?' }]);
  });
  await test('text and usage are read from any documented shape', () => {
    assert.strictEqual(g.textOf({ output_text: 'a' }), 'a');
    assert.strictEqual(g.textOf({ outputs: [{ type: 'text', text: 'b' }] }), 'b');
    assert.deepStrictEqual(g.usageOf({ usage: { input_tokens: 5, output_tokens: 2 } }), { inTokens: 5, outTokens: 2 });
    assert.strictEqual(g.langCode('auto'), null);
    assert.strictEqual(g.langCode('ru'), 'ru-RU');
  });
  await test('priced at $2 / $12 per 1M tokens with its source', () => {
    const c = require(path.join(__dirname, '..', 'src', 'ai', 'model-pricing')).costForUsage('gemini-3.5-transcribe', { inTokens: 1500, outTokens: 170 });
    assert.ok(Math.abs(c.costUsd - 0.00504) < 1e-9);
    assert.strictEqual(c.snapshot.checkedAt, '2026-10-14');
  });

  console.log('stt engine choice');
  const stt = require(path.join(__dirname, '..', 'src', 'ai', 'stt'));
  await test('STT_PROVIDER unset: VoiceLab alone, as before (no new fallback)', () => {
    delete process.env.STT_PROVIDER; delete process.env.STT_FALLBACK;
    process.env.VOICELAB_API_KEY = 'vl'; delete process.env.VOICELAB_STT;
    assert.deepStrictEqual(stt.chain(), ['voicelab']);
    delete process.env.VOICELAB_API_KEY;
    assert.deepStrictEqual(stt.chain(), [], 'no VoiceLab key: off, even with a Gemini key');
  });
  await test('STT_PROVIDER=gemini: Gemini first, VoiceLab as fallback unless STT_FALLBACK=off', () => {
    process.env.STT_PROVIDER = 'gemini'; process.env.VOICELAB_API_KEY = 'vl';
    assert.deepStrictEqual(stt.chain(), ['gemini', 'voicelab']);
    process.env.STT_FALLBACK = 'off';
    assert.deepStrictEqual(stt.chain(), ['gemini']);
    delete process.env.STT_FALLBACK; delete process.env.STT_PROVIDER; delete process.env.VOICELAB_API_KEY;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
