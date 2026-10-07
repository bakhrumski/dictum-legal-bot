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

// the Gemini-only route (the one route with a per-page budget); the
// provider-choice tests below set their own environment
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'assumed-for-this-test';
process.env.OCR_IMAGE_PROVIDER = 'gemini';
process.env.OCR_FALLBACK = 'off';
delete process.env.LLM_PROVIDER;

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

  console.log('cost of an OCR page: a conservative upper budget, each part with its basis');

  await test('$0.010959 a PDF page is a planning estimate: ((5 160 page + 305 prompt allowance) x $0.30 + (1 536 output + 0 thinking) x $2.50) / 1M x 2 retry x 1', () => {
    const b = scanLimits.ocrPageBudget();
    assert.deepStrictEqual([b.kind, b.expected, b.expectedStatus, b.hardMaximum], ['planning_estimate', null, 'unmeasured', false], 'not a real cost, not a hard maximum');
    assert.deepStrictEqual([b.parts.pdfPageInputTokens.tokens, b.parts.promptTokens.tokens, b.parts.outputTokens.tokens, b.parts.thinkingTokens.tokens], [5160, 305, 1536, 0]);
    assert.deepStrictEqual([b.parts.pdfPageInputTokens.status, b.parts.promptTokens.status, b.parts.outputTokens.status, b.parts.thinkingTokens.status],
      ['planning_assumption', 'planning_allowance', 'cap_sent', 'planned_zero_unverified'], 'the 5 160 page figure is an assumption, not a proven bound');
    // the prompt is sent once per call: its bytes bound it; the allowance covers a 5-page chunk and an image
    assert.deepStrictEqual(b.promptBytes, { image: 305, pdfChunk: 463, pdfOnePage: 462 });
    assert.ok(b.promptBytes.pdfChunk / scanLimits.OCR_PDF_CHUNK_PAGES <= b.parts.promptTokens.tokens && b.promptBytes.image <= b.parts.promptTokens.tokens);
    assert.strictEqual(scanLimits.promptTokenBound(), 463);
    assert.deepStrictEqual([b.attempts, b.reserveFactor], [2, 1]);
    assert.strictEqual(b.notIncluded.length, 2, 're-readings and fallbacks are named as outside the figure');
    assert.strictEqual(Number(b.usdPerAttempt.toFixed(7)), 0.0054795);
    assert.strictEqual(Number(scanLimits.ocrPageUsd().toFixed(6)), 0.010959);
    // a separate image: its own assumption, growing with pixels
    assert.deepStrictEqual([scanLimits.imageInputTokens(1024, 1024), scanLimits.imageInputTokens(800, 600), b.image.inputTokensAtLimit], [1290, 1290, 19683]);
    assert.strictEqual(Number(b.image.usdAtLimit.toFixed(6)), 0.019673);
    // the Developer API price from the single price table, not a Vertex figure
    const p = require('../src/ai/model-pricing');
    assert.deepStrictEqual([b.inPerM, b.outPerM], [p.MODEL_PRICING['gemini-2.5-flash'].in, p.MODEL_PRICING['gemini-2.5-flash'].out]);
    assert.match(b.priceSource, /ai\.google\.dev\/gemini-api\/docs\/pricing/u);
    assert.match(b.api, /Developer API/u);
    // the retry the estimate counts is the one the ledger makes for stage 'ocr'
    assert.match(read('src/ai/usage-ledger.js'), /ESSENTIAL_STAGES = new Set\(\[[^\]]*'ocr'/u);
  });

  console.log('which provider reads a scan');

  await test('nothing is switched silently: images go to VoiceLab first when its vision lane is on, Gemini only when chosen; PDFs to Gemini', () => {
    const env = { GEMINI_API_KEY: 'k', GPT_API_KEY: 'o' };
    assert.deepStrictEqual(scanLimits.ocrProviders({ kind: 'image', env, voicelabVision: true }), { primary: 'voicelab', fallbacks: ['gemini', 'openai'], fallback: true }, 'as before #411');
    assert.deepStrictEqual(scanLimits.ocrProviders({ kind: 'image', env, voicelabVision: false }).primary, 'gemini');
    assert.deepStrictEqual(scanLimits.ocrProviders({ kind: 'image', env: { ...env, OCR_IMAGE_PROVIDER: 'gemini' }, voicelabVision: true }), { primary: 'gemini', fallbacks: ['voicelab', 'openai'], fallback: true });
    assert.deepStrictEqual(scanLimits.ocrProviders({ kind: 'image', env: { ...env, OCR_IMAGE_PROVIDER: 'gemini', OCR_FALLBACK: 'off' }, voicelabVision: true }).fallbacks, []);
    assert.deepStrictEqual(scanLimits.ocrProviders({ kind: 'pdf', env, voicelabVision: true }), { primary: 'gemini', fallbacks: [], fallback: true });
  });

  await test('the Gemini budget is applied only where every reachable provider is Gemini; VoiceLab, OpenAI and no key stay unknown', () => {
    const env = { GEMINI_API_KEY: 'k', GPT_API_KEY: 'o' };
    const def = scanLimits.ocrCostBasis(env, { voicelabVision: true });
    assert.deepStrictEqual([def.status, def.route.image], ['unknown', ['voicelab', 'gemini', 'openai']]);
    assert.match(def.reason, /VoiceLab vision/u);
    assert.strictEqual(scanLimits.ocrCostBasis({ ...env, OCR_IMAGE_PROVIDER: 'gemini' }, { voicelabVision: true }).status, 'unknown', 'fallbacks reachable');
    const g = scanLimits.ocrCostBasis({ ...env, OCR_IMAGE_PROVIDER: 'gemini', OCR_FALLBACK: 'off' }, { voicelabVision: true });
    assert.deepStrictEqual([g.status, g.route], ['estimated', { image: ['gemini'], pdf: ['gemini'] }]);
    assert.strictEqual(scanLimits.ocrCostBasis({ GEMINI_API_KEY: 'k' }, { voicelabVision: false }).status, 'estimated', 'Gemini is the only key');
    assert.strictEqual(scanLimits.ocrCostBasis({ GPT_API_KEY: 'o' }, { voicelabVision: true }).status, 'unknown');
    assert.deepStrictEqual(scanLimits.PROVIDER_COST, { gemini: 'estimated', voicelab: 'unknown', openai: 'unknown' });
  });

  await test('OCR pages a period can use at 100%: (analysis + opinion) x 10 + the chat-scan pool', () => {
    assert.deepStrictEqual(['sinov', 'silver', 'gold', 'platinum'].map(ledger.maxOcrPages), [30, 240, 720, 1200]);
    const silver = ledger.planEconomics('silver');
    assert.deepStrictEqual([silver.ocr.pages, silver.ocr.status, silver.costComplete], [240, 'estimated', true]);
    assert.strictEqual(Math.round(silver.ocr.usd * 1e6), Math.round(240 * scanLimits.ocrPageUsd() * 1e6));
    assert.ok(silver.aiUsd > silver.textAiUsd, 'OCR is in the AI budget');
    const keep = process.env.OCR_IMAGE_PROVIDER;
    delete process.env.OCR_IMAGE_PROVIDER;
    process.env.OCR_FALLBACK = 'on';
    process.env.GPT_API_KEY = 'o';
    try {
      const u = ledger.planEconomics('silver');
      assert.deepStrictEqual([u.ocr.usd, u.ocr.status, u.costComplete], [null, 'unknown', false], 'a reachable provider of unknown cost: unknown, never 0');
    } finally { process.env.OCR_IMAGE_PROVIDER = keep; process.env.OCR_FALLBACK = 'off'; delete process.env.GPT_API_KEY; }
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

  console.log('the provider requests (fetch stubbed: no paid call)');

  await test('Gemini (Developer API): thinkingBudget 0 and an output cap of 1 536 tokens a page are sent; a cut text is refused', async () => {
    const { callVisionOCR } = require('../src/ocr/routes');
    const realFetch = global.fetch;
    const bodies = [];
    const paged = '=== PAGE 1 ===\nBIR\n=== PAGE 2 ===\nIKKI\n=== PAGE 3 ===\nUCH';
    let reply = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '=== PAGE 1 ===\nthinking...', thought: true }, { text: paged }] } }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 10 } };
    global.fetch = async (url, init) => { bodies.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, json: async () => reply }; };
    try {
      const out = await callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 });
      assert.deepStrictEqual([out.text, out.provider, out.role], ['[Sahifa 1]\nBIR\n\n[Sahifa 2]\nIKKI\n\n[Sahifa 3]\nUCH', 'Gemini Vision', 'primary'], 'thought parts are never the text');
      const req = bodies[0];
      assert.match(req.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent\?key=/u, 'the Developer API, not Vertex');
      const g = req.body.generationConfig;
      assert.deepStrictEqual(g.thinkingConfig, { thinkingBudget: 0 }, 'generationConfig.thinkingConfig.thinkingBudget = 0');
      assert.strictEqual(g.maxOutputTokens, 3 * 1536);
      assert.deepStrictEqual(Object.keys(req.body.contents[0].parts[0]), ['inlineData']);
      assert.strictEqual(req.body.contents[0].parts[1].text, scanLimits.PAGED_PROMPT(scanLimits.LANG_HINTS.uzb, 3));
      assert.ok(Buffer.byteLength(req.body.contents[0].parts[1].text) <= scanLimits.promptTokenBound());
      reply = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'cut' }] } }], usageMetadata: {} };
      await assert.rejects(callVisionOCR(Buffer.from('x'), 'image/png', 'uzb', { pages: 1 }), e => e.code === 'OCR_TRUNCATED');
      global.fetch = async (url) => { bodies.push({ url: String(url) }); return { ok: false, status: 503, text: async () => 'busy' }; };
      const n = bodies.length;
      await assert.rejects(callVisionOCR(Buffer.from('x'), 'image/png', 'uzb', { pages: 1 }));
      assert.ok(bodies.slice(n).every(b => /generativelanguage/u.test(b.url)), 'OCR_FALLBACK=off: no other provider');
    } finally { global.fetch = realFetch; }
  });

  await test('default route with VoiceLab vision on: an image goes to VoiceLab first (as before #411), then the fallbacks', async () => {
    const { callVisionOCR } = require('../src/ocr/routes');
    const keep = { ...process.env };
    const realFetch = global.fetch;
    const urls = [];
    Object.assign(process.env, { LLM_PROVIDER: 'voicelab', VOICELAB_API_KEY: 'vl-test', GPT_API_KEY: 'gpt-test' });
    delete process.env.OCR_IMAGE_PROVIDER; delete process.env.OCR_FALLBACK; delete process.env.VOICELAB_LANES;
    require('../src/ai/provider-health').reset(); // the 503s above opened the Gemini breaker
    global.fetch = async (url) => { urls.push(String(url)); return { ok: false, status: 503, text: async () => 'busy', json: async () => ({}) }; };
    try {
      await assert.rejects(callVisionOCR(pngHeader(800, 600), 'image/png', 'uzb', { pages: 1 }));
      const order = [...new Set(urls.map(u => /voicelab/u.test(u) ? 'voicelab' : /generativelanguage/u.test(u) ? 'gemini' : /openai/u.test(u) ? 'openai' : u))];
      assert.deepStrictEqual(order, ['voicelab', 'gemini', 'openai']);
    } finally {
      global.fetch = realFetch;
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  });

  console.log('page coverage: a PDF is read in marked chunks; nothing cut, empty or missing is accepted');

  // a fake Gemini behind a stubbed fetch: it reads the page count of the
  // sub-PDF it is sent and answers with marked pages, unless told otherwise
  const { PDFDocument } = require('pdf-lib');
  async function fakeGemini(behave) {
    const calls = [];
    const realFetch = global.fetch;
    require('../src/ai/provider-health').reset();
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const part = body.contents[0].parts[0].inlineData;
      const pages = part.mimeType === 'application/pdf' ? (await PDFDocument.load(Buffer.from(part.data, 'base64'))).getPageCount() : 1;
      const cap = body.generationConfig.maxOutputTokens;
      const call = { pages, cap, prompt: body.contents[0].parts[1].text, n: calls.length + 1 };
      calls.push(call);
      const how = (behave && behave(call)) || {};
      const marked = Array.from({ length: pages }, (_, i) => i + 1)
        .filter(n => !(how.drop || []).includes(n))
        .map(n => `=== PAGE ${n} ===\n${(how.empty || []).includes(n) ? '[[EMPTY PAGE]]' : `Matn ${n}-sahifa. ${'Band. '.repeat(10)}`}`).join('\n');
      const reply = { candidates: [{ finishReason: how.cut ? 'MAX_TOKENS' : 'STOP', content: { parts: [{ text: how.text != null ? how.text : marked }] } }],
        usageMetadata: { promptTokenCount: 100 * pages, candidatesTokenCount: 50 * pages } };
      return { ok: true, json: async () => reply };
    };
    return { calls, restore: () => { global.fetch = realFetch; } };
  }
  const { callVisionOCR } = require('../src/ocr/routes');
  const pdf11 = fx('scan-11p.pdf');

  await test('the cap is per page: an 11-page PDF is 3 calls of 5 + 5 + 1 pages, each capped at 1 536 x its pages, all pages in order', async () => {
    const g = await fakeGemini();
    try {
      const out = await callVisionOCR(pdf11, 'application/pdf', 'uzb', { pages: 11 });
      assert.deepStrictEqual(g.calls.map(c => [c.pages, c.cap]).sort(), [[1, 1536], [5, 7680], [5, 7680]]);
      assert.ok(g.calls.every(c => c.prompt.includes(`This PDF has ${c.pages} page`)), 'each call is told its page count');
      assert.deepStrictEqual([...out.text.matchAll(/^\[Sahifa (\d+)\]$/gmu)].map(m => Number(m[1])), Array.from({ length: 11 }, (_, i) => i + 1));
      assert.deepStrictEqual([out.pagesRead, out.calls], [11, 3]);
    } finally { g.restore(); }
  });

  await test('a chunk cut at its cap (MAX_TOKENS) is read again in halves; each reading is its own call', async () => {
    const g = await fakeGemini(c => (c.pages === 5 && c.n === 1 ? { cut: true } : null));
    try {
      const out = await callVisionOCR(pdf11, 'application/pdf', 'uzb', { pages: 11 });
      assert.strictEqual(out.pagesRead, 11);
      assert.ok(g.calls.some(c => c.pages === 3 && c.cap === 3 * 1536) && g.calls.some(c => c.pages === 2 && c.cap === 2 * 1536), JSON.stringify(g.calls.map(c => [c.pages, c.cap])));
      assert.strictEqual(out.calls, g.calls.length);
    } finally { g.restore(); }
  });

  await test('a page missing from a reply is never filled in: the chunk is re-read in halves; a page still missing fails the document', async () => {
    let g = await fakeGemini(c => (c.pages === 5 ? { drop: [4] } : null));
    try {
      // every 5-page reply drops its page 4; the halves (3 + 2) answer in full
      const out = await callVisionOCR(pdf11, 'application/pdf', 'uzb', { pages: 11 });
      assert.strictEqual([...out.text.matchAll(/^\[Sahifa \d+\]$/gmu)].length, 11);
    } finally { g.restore(); }
    g = await fakeGemini(c => (c.pages === 1 ? { text: 'matn, lekin sahifa belgisi yo\'q' } : { drop: [1] }));
    try {
      await assert.rejects(callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 }), e => e.code === 'OCR_INCOMPLETE' && e.missing.length === 1);
    } finally { g.restore(); }
    g = await fakeGemini(() => ({ text: '=== PAGE 1 ===\n\n=== PAGE 2 ===\nB\n=== PAGE 3 ===\nC' }));
    try {
      await assert.rejects(callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 }), e => e.code === 'OCR_INCOMPLETE', 'a marked page with nothing under it is missing, not empty');
    } finally { g.restore(); }
  });

  await test('one page cut at 1 536 gets one reading at 4 096; still cut, the document fails (OCR_TRUNCATED)', async () => {
    let g = await fakeGemini(c => (c.pages > 1 || c.cap === 1536 ? { cut: true } : null));
    try {
      const out = await callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 });
      assert.strictEqual(out.pagesRead, 3);
      assert.ok(g.calls.some(c => c.pages === 1 && c.cap === 4096));
    } finally { g.restore(); }
    g = await fakeGemini(() => ({ cut: true }));
    try {
      await assert.rejects(callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 }), e => e.code === 'OCR_TRUNCATED');
      // 3 pages (cap 4 608) cut -> 2 pages (3 072) cut -> page 1 (1 536) cut -> page 1 once more (4 096) cut -> refused
      assert.deepStrictEqual(g.calls.map(c => [c.pages, c.cap]), [[3, 4608], [2, 3072], [1, 1536], [1, 4096]]);
      // a cut reading is the provider's answer, not its failure: the breaker stays closed
      assert.strictEqual(require('../src/ai/provider-health').openState('gemini', 'gemini-2.5-flash'), null);
    } finally { g.restore(); }
    // an image: 1 536, then once 4 096
    g = await fakeGemini(c => (c.cap === 1536 ? { cut: true, text: 'kesilgan' } : { text: 'TO\'LIQ MATN' }));
    try {
      const out = await callVisionOCR(pngHeader(800, 600), 'image/png', 'uzb', { pages: 1 });
      assert.deepStrictEqual([out.text, g.calls.map(c => c.cap)], ["TO'LIQ MATN", [1536, 4096]]);
    } finally { g.restore(); }
  });

  await test('an empty page is kept as empty (marked); a PDF with no text on any page is OCR_EMPTY; the page count must match', async () => {
    let g = await fakeGemini(() => ({ empty: [2] }));
    try {
      const out = await callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 });
      assert.match(out.text, /\[Sahifa 2\]\n\(bo'sh sahifa\)/u);
    } finally { g.restore(); }
    g = await fakeGemini(c => ({ empty: Array.from({ length: c.pages }, (_, i) => i + 1) }));
    try {
      await assert.rejects(callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 3 }), e => e.code === 'OCR_EMPTY');
    } finally { g.restore(); }
    g = await fakeGemini();
    try {
      await assert.rejects(callVisionOCR(fx('scan-3p.pdf'), 'application/pdf', 'uzb', { pages: 4 }), e => e.code === 'OCR_PAGE_COUNT');
      assert.strictEqual(g.calls.length, 0, 'no call when the count differs');
    } finally { g.restore(); }
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
