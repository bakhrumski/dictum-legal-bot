'use strict';

/**
 * OCR as a step of a document service (2026-10-06), without a database:
 * size checks, the per-page cost estimate and what it does to the plans'
 * economics, scan tickets, the Gemini request (thinking off, output cap),
 * and what the user is shown (tariff page, bot balance, /api/tariff/me,
 * dashboard). The routes on a real Postgres: tests/scan-ocr.db.test.js.
 * No provider is called: fetch is stubbed.
 *
 *   node tests/scan-ocr.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'assumed-for-this-test';
delete process.env.OCR_FALLBACK;

const scanLimits = require('../src/ocr/scan-limits');
const ledger = require('../src/rag/tariff-ledger');
const { pngHeader, jpegHeader, webpVp8xHeader } = require('./helpers/make-pdf');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));

(async () => {
  console.log('size before any provider call');

  await test('a scanned PDF is counted locally; over the plan, encrypted, unreadable and text PDFs are refused with a message', async () => {
    assert.deepStrictEqual(await scanLimits.measureScan(fx('scan-3p.pdf'), { planMaxPages: 10 }), { kind: 'pdf', pages: 3, bytes: fx('scan-3p.pdf').length });
    const over = await scanLimits.measureScan(fx('scan-11p.pdf'), { planMaxPages: 10 });
    assert.deepStrictEqual([over.error, over.pages, over.maxPages], ['too_many_pages', 11, 10]);
    assert.match(over.message, /qisqartirilmaydi/u);
    assert.strictEqual((await scanLimits.measureScan(fx('scan-11p.pdf'), { planMaxPages: 30 })).pages, 11);
    assert.strictEqual((await scanLimits.measureScan(fx('scan-31p.pdf'), { planMaxPages: 30 })).error, 'too_many_pages');
    assert.strictEqual((await scanLimits.measureScan(fx('text-2p.pdf'), { planMaxPages: 10 })).error, 'text_pdf');
    const enc = Buffer.concat([fx('scan-3p.pdf'), Buffer.from('\ntrailer << /Encrypt 5 0 R >>\n%%EOF\n')]);
    assert.strictEqual((await scanLimits.measureScan(enc, { planMaxPages: 10 })).error, 'encrypted');
    assert.strictEqual((await scanLimits.measureScan(Buffer.from('%PDF-1.4\nnot really a pdf'), { planMaxPages: 10 })).error, 'unreadable');
    const big = Buffer.alloc(scanLimits.MAX_PDF_BYTES + 1); big.write('%PDF-1.4');
    assert.strictEqual((await scanLimits.measureScan(big, { planMaxPages: 30 })).error, 'too_large_bytes');
  });

  await test('an image is one page only within pixel, byte and type limits (PNG, JPEG, WebP headers)', async () => {
    assert.deepStrictEqual((await scanLimits.measureScan(pngHeader(1200, 1600), { mimetype: 'image/png' })).pages, 1);
    assert.deepStrictEqual(scanLimits.imageInfo(jpegHeader(800, 600)), { type: 'image/jpeg', width: 800, height: 600 });
    assert.deepStrictEqual(scanLimits.imageInfo(webpVp8xHeader(1024, 768)), { type: 'image/webp', width: 1024, height: 768 });
    assert.strictEqual((await scanLimits.measureScan(pngHeader(4097, 100))).error, 'image_too_large', 'side');
    assert.strictEqual((await scanLimits.measureScan(pngHeader(4096, 4096))).error, 'image_too_large', '16.7 MP');
    assert.strictEqual((await scanLimits.measureScan(pngHeader(4000, 4000))).pages, 1, '16 MP');
    const huge = Buffer.concat([pngHeader(1000, 1000), Buffer.alloc(scanLimits.MAX_IMAGE_BYTES)]);
    assert.strictEqual((await scanLimits.measureScan(huge)).error, 'too_large_bytes');
    assert.strictEqual((await scanLimits.measureScan(Buffer.from('GIF89a........................'))).error, 'unsupported_image');
  });

  console.log('cost of an OCR page (estimate, with its source)');

  await test('$0.010956 a page: (4 x 1 290 + 300) input and 1 536 output tokens at $0.30 / $2.50 per 1M, x2 attempts', () => {
    const e = scanLimits.OCR_PAGE_ESTIMATE;
    assert.deepStrictEqual([e.inputTokens, e.outputTokens, e.inPerM, e.outPerM, e.attempts], [5460, 1536, 0.30, 2.50, 2]);
    assert.strictEqual(Number(scanLimits.ocrPageUsd().toFixed(6)), 0.010956);
    assert.match(e.source, /Vertex AI .*pricing.*2026-10-06/u);
    assert.strictEqual(e.status, 'estimated');
    // the same prices as the single price table
    const p = require('../src/ai/model-pricing').MODEL_PRICING['gemini-2.5-flash'];
    assert.deepStrictEqual([p.in, p.out], [e.inPerM, e.outPerM]);
  });

  await test('OCR cost basis: estimated on the Gemini path; unknown with no key or with the unbounded fallback on', () => {
    assert.strictEqual(scanLimits.ocrCostBasis({ GEMINI_API_KEY: 'k' }).status, 'estimated');
    assert.strictEqual(scanLimits.ocrCostBasis({}).status, 'unknown');
    assert.strictEqual(scanLimits.ocrCostBasis({ GEMINI_API_KEY: 'k', OCR_FALLBACK: 'on' }).status, 'unknown');
  });

  await test('OCR pages a period can use at 100%: (analysis + opinion) x 10 + the chat-scan pool', () => {
    assert.deepStrictEqual(['sinov', 'silver', 'gold', 'platinum'].map(ledger.maxOcrPages), [30, 240, 720, 1200]);
    const silver = ledger.planEconomics('silver');
    assert.deepStrictEqual([silver.ocr.pages, silver.ocr.status, silver.costComplete], [240, 'estimated', true]);
    assert.strictEqual(Math.round(silver.ocr.usd * 1e6), Math.round(240 * scanLimits.ocrPageUsd() * 1e6));
    assert.ok(silver.aiUsd > silver.textAiUsd, 'OCR is in the AI budget');
    const keep = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const u = ledger.planEconomics('silver');
      assert.deepStrictEqual([u.ocr.usd, u.ocr.status, u.costComplete], [null, 'unknown', false], 'unknown is never 0');
    } finally { process.env.GEMINI_API_KEY = keep; }
  });

  console.log('scan tickets');

  await test('a ticket binds file, account, service, size and expiry; tampering, another account and expiry are refused', () => {
    const t = ledger.signScanTicket({ fileHash: 'a'.repeat(64), adminId: 7, service: 'analysis', pages: 3, bytes: 999, kind: 'pdf', units: 1 });
    assert.deepStrictEqual((({ fileHash, service, pages, units }) => ({ fileHash, service, pages, units }))(ledger.readScanTicket(t, { adminId: 7 })),
      { fileHash: 'a'.repeat(64), service: 'analysis', pages: 3, units: 1 });
    assert.strictEqual(ledger.readScanTicket(t, { adminId: 8 }).error, 'scan_ticket_other_account');
    assert.strictEqual(ledger.readScanTicket(t, { adminId: 7, now: Date.now() + (ledger.SCAN_TICKET_MIN + 1) * 60e3 }).error, 'scan_ticket_expired');
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: 'chat' })).toString('base64url');
    assert.strictEqual(ledger.readScanTicket(`${forged}.${sig}`, { adminId: 7 }).error, 'scan_ticket_invalid');
    assert.strictEqual(ledger.readScanTicket(null, { adminId: 7 }).error, 'scan_ticket_missing');
    // a document ticket is not a scan ticket, and the other way round
    assert.strictEqual(ledger.readScanTicket(ledger.signDocTicket({ text: 'x', pages: 1 }), { adminId: 7 }).error, 'scan_ticket_invalid');
    assert.strictEqual(ledger.readDocTicket(t, 'x'), null);
  });

  console.log('the Gemini request');

  await test('thinking off and an output cap of 1 536 tokens a page; a cut text is refused, not passed on; no fallback by default', async () => {
    const { callVisionOCR } = require('../src/ocr/routes');
    const realFetch = global.fetch;
    const bodies = [];
    let reply = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking...', thought: true }, { text: 'SAHIFA MATNI' }] } }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 10 } };
    global.fetch = async (url, init) => { bodies.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => reply }; };
    try {
      const out = await callVisionOCR(Buffer.from('%PDF-1.4'), 'application/pdf', 'uzb', { pages: 3 });
      assert.deepStrictEqual(out, { text: 'SAHIFA MATNI', provider: 'Gemini Vision' }, 'thought parts are never the text');
      const g = bodies[0].body.generationConfig;
      assert.deepStrictEqual([g.maxOutputTokens, g.thinkingConfig], [3 * 1536, { thinkingBudget: 0 }]);
      assert.match(bodies[0].url, /gemini-2\.5-flash:generateContent/u);
      reply = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut' }] } }], usageMetadata: {} };
      await assert.rejects(callVisionOCR(Buffer.from('x'), 'image/png', 'uzb', { pages: 1 }), e => e.code === 'OCR_TRUNCATED');
      reply = null;
      global.fetch = async (url, init) => { bodies.push({ url: String(url) }); return { ok: false, status: 503, text: async () => 'busy' }; };
      const n = bodies.length;
      await assert.rejects(callVisionOCR(Buffer.from('x'), 'image/png', 'uzb', { pages: 1 }));
      assert.ok(bodies.slice(n).every(b => /generativelanguage/u.test(b.url)), 'no VoiceLab / OpenAI vision call without OCR_FALLBACK=on');
    } finally { global.fetch = realFetch; }
  });

  console.log('what the user is shown');

  await test('the internal page limit is not sold as a service: tariff page, bot balance, /api/tariff/me', () => {
    const html = read('public/tariff.html');
    assert.match(html, /<b>Skan hujjat \(PDF yoki rasm\):<\/b> alohida xizmat emas/u);
    assert.doesNotMatch(html, /\b10 ta OCR\b|OCR — 10/u);
    const texts = require('../src/bot/tariff-texts');
    const fake = { kind: 'period', plan: 'silver', startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 864e5),
      services: { chat: { limit: 150, used: 0, remaining: 150 }, analysis: { limit: 8, used: 0, remaining: 8 }, ocr: { limit: 80, used: 0, remaining: 80 } } };
    const t = texts.balanceText({ balance: fake });
    assert.match(t, /150 \/ 150 qoldi/u);
    assert.doesNotMatch(t, /OCR|skan|80 \/ 80/iu, 'no OCR line in the balance');
    const server = read('src/api/server.js');
    assert.match(server, /delete balance\.services\.ocr/u);
    assert.match(server, /res\.json\(\{ \.\.\.userPlan, quota, balance, usage, scanLimits \}\)/u);
  });

  await test('the dashboard quotes, confirms and then reads a scan by id; it never takes OCR text from the reply', () => {
    const html = read('public/dashboard.html');
    assert.match(html, /async function scanFile\(file, service, retried\)/u);
    assert.match(html, /\/api\/analyze\/scan-quote/u);
    assert.match(html, /renderScanConfirm\(/u);
    assert.doesNotMatch(html, /function ocrFile\(/u);
    const fn = html.slice(html.indexOf('async function scanFile('), html.indexOf('function renderScanConfirm('));
    assert.doesNotMatch(fn, /\.text\b/u, 'scanFile never reads text');
    assert.match(html, /scanIds/u);
  });

  await test('Sinov: 10 pages a document; paid: 30', () => {
    assert.strictEqual(ledger.PLAN_CATALOG.sinov.job.maxPages, 10);
    for (const p of ['silver', 'gold', 'platinum']) assert.strictEqual(ledger.PLAN_CATALOG[p].job.maxPages, 30, p);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
