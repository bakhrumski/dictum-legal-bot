'use strict';

/**
 * Fixes from the 2026-10-20 code review of staging. No network, no database.
 *
 *   node tests/audit-fixes-2026-10-20.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

(async () => {
  await test('Word pairing: the link never carries the code; the connect page never reads it from the URL', () => {
    const addin = read('src/addin/word-addin.js');
    assert.ok(/connectUrl: `\$\{baseUrlOf\(req\)\}\/word\/ulash\.html` \}/u.test(addin));
    const page = read('public/word/ulash.js');
    assert.ok(!/URLSearchParams|params\.get\('code'\)/u.test(page) && !/\$\('#code'\)\.value = /u.test(page));
    assert.ok(/kimdir sizga xabar yoki havola orqali yuborgan bo'lsa, kiritmang/u.test(read('public/word/ulash.html')));
  });

  await test('add-in tokens: revoked with the account\'s other sessions and forgotten from every cache at once', async () => {
    const w = require('../src/addin/word-addin');
    const seen = [];
    const db = { query: async (sql, p) => { seen.push([sql, p]); if (/UPDATE addin_tokens/u.test(sql)) return { rowCount: 2 }; if (/FROM addin_tokens t JOIN admins/u.test(sql)) return { rows: [{ token_id: 9, id: 7, role: 'user', username: 'u', full_name: 'U' }] }; return { rows: [] }; } };
    const bearer = w.createBearerAuth(db);
    const call = () => new Promise((resolve) => {
      const req = { headers: { authorization: 'Bearer jai_' + 'a'.repeat(30) }, method: 'GET', path: '/api/user-info' };
      const res = { locals: {}, status: (c) => ({ json: (b) => resolve({ code: c, b }) }) };
      bearer(req, res, () => resolve({ code: 200, req }));
    });
    assert.strictEqual((await call()).code, 200);
    const loads = () => seen.filter(([s]) => /JOIN admins/u.test(s)).length;
    const before = loads();
    await call();
    assert.strictEqual(loads(), before, 'cached');
    assert.strictEqual(await w.revokeAllForAdmin(db, 7), 2);
    await call();
    assert.strictEqual(loads(), before + 1, 'the cache was dropped: the token is checked again at once');
    // a database without the table is not an error
    assert.strictEqual(await w.revokeAllForAdmin({ query: async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); } }, 7), 0);
    assert.ok(/await wordAddin\.revokeAllForAdmin\(pool, adminId\)/u.test(read('src/api/server.js')), 'revokeSessionsFor');
    assert.ok(/revokeAllForAdmin\(pool, target\.id\)/u.test(read('src/auth/recovery.js')), 'password reset link');
    assert.ok(/revokeAllForAdmin\(client, adminId\)/u.test(read('src/auth/credentials.js')), 'login/password set');
  });

  await test('OCR comparison: the model is scoped to the request, never written to process.env', async () => {
    const r = require('../src/ocr/routes');
    const seen = [];
    const keepFetch = global.fetch, keepKey = process.env.GEMINI_API_KEY;
    global.fetch = async (u) => { seen.push(String(u).match(/models\/([^:]+)/u)[1]); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }], usageMetadata: {} }) }; };
    process.env.GEMINI_API_KEY = 'k';
    try {
      const args = { data: Buffer.from('a'), mimeType: 'image/png', prompt: 'p', cap: 10 };
      await Promise.all([r.withOcrModel('gemini-3.6-flash', () => r.readers.gemini(args)), r.readers.gemini(args)]);
    } finally { global.fetch = keepFetch; if (keepKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = keepKey; }
    assert.deepStrictEqual(seen.sort(), ['gemini-2.5-flash', 'gemini-3.6-flash'], 'the concurrent customer call keeps the production model');
    assert.ok(!/process\.env\.GEMINI_OCR_MODEL = /u.test(read('src/api/server.js')));
  });

  await test('voice: the length is measured on the server (container or decoded WebM); unreadable audio is refused; the route is rate-limited', async () => {
    const { probeAudioSeconds, ffmpegPath } = require('../src/ai/audio-duration');
    const ff = ffmpegPath();
    if (ff) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jai-audio-'));
      const live = path.join(dir, 'live.webm');
      fs.writeFileSync(live, execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libopus', '-f', 'webm', 'pipe:1']));
      const sec = await probeAudioSeconds(fs.readFileSync(live));
      assert.ok(sec > 3.5 && sec < 4.5, String(sec));
      assert.strictEqual(await probeAudioSeconds(Buffer.from('not audio')), null);
    } else console.log('      (ffmpeg not available: probe skipped)');
    const server = read('src/api/server.js');
    const route = server.slice(server.indexOf("app.post('/api/voice/transcribe'"), server.indexOf("app.post('/api/admin/stt/compare'"));
    assert.ok(/probeAudioSeconds\(req\.file\.buffer\)/u.test(route) && !/req\.body\.durationSec/u.test(route));
    assert.ok(/audio_unreadable/u.test(route));
    assert.ok(/'\/api\/voice\/transcribe'(, '[^']+')*\], aiLimiter\)/u.test(server));
    assert.ok(/fd\.append\('lang', 'auto'\)/u.test(read('public/app/voice.js')), 'the speech language is detected, not the interface language');
  });

  await test('prices: gemini-3.6-flash doubles from 2027-01-01; Flash models name their own source', () => {
    const p = require('../src/ai/model-pricing');
    assert.strictEqual(p.priceAt('gemini-3.6-flash', Date.parse('2026-12-31T23:59:00Z')).in, 0.75);
    assert.strictEqual(p.priceAt('gemini-3.6-flash', Date.parse('2027-01-01T00:00:00Z')).out, 7.50);
    assert.ok(/3\.5 Flash-Lite and 3\.6 Flash/u.test(p.pricingSnapshot('gemini-3.5-flash-lite').source));
    assert.strictEqual(p.priceAt('gpt-6-luna').in, p.MODEL_PRICING['gpt-6-luna'].in, 'unscheduled models unchanged');
  });

  await test('OCR cost: a 3.x OCR model makes the route unknown (offers blocked), 2.5 Flash keeps its estimate', () => {
    const sl = require('../src/ocr/scan-limits');
    const env = { GEMINI_API_KEY: 'k', OCR_IMAGE_PROVIDER: 'gemini', OCR_FALLBACK: 'off' };
    assert.strictEqual(sl.ocrCostBasis(env).status, 'estimated');
    const b = sl.ocrCostBasis({ ...env, GEMINI_OCR_MODEL: 'gemini-3.5-flash-lite' });
    assert.strictEqual(b.status, 'unknown');
    assert.ok(/thinking/u.test(b.reason));
    assert.strictEqual(sl.ocrPageBudget({ ...env, GEMINI_OCR_MODEL: 'gemini-2.5-flash' }).model, 'gemini-2.5-flash');
  });

  await test('Word: each right-click run updates its own comment; the pane counts UTF-8 bytes against the 2 MB body limit', () => {
    const cmd = read('public/word/commands.js');
    assert.ok(/var wait = WAIT \+ ' \[' \+ Math\.random\(\)/u.test(cmd) && /sel\.wait && c\.content === sel\.wait/u.test(cmd));
    const pane = read('public/word/taskpane.js');
    assert.ok(/jsonBytes\(body\) > TOO_BIG_BYTES/u.test(pane) && /res\.status === 413/u.test(pane));
  });

  await test('fonts: no page loads Golos Text from Google Fonts; they link the self-hosted /app/fonts.css', () => {
    const files = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.html$/u.test(f.name)) files.push(p); } };
    walk(path.join(__dirname, '../public'));
    const google = files.filter(f => /fonts\.googleapis\.com\/css2\?family=Golos/u.test(fs.readFileSync(f, 'utf8')));
    assert.deepStrictEqual(google, []);
    assert.ok(/\/app\/fonts\.css/u.test(read('public/index.html')) && /\/app\/fonts\.css/u.test(read('public/ru/index.html')));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
