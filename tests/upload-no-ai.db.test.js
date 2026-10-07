'use strict';

/**
 * Attaching or reading a file never calls AI (2026-10-07, production report:
 * a document-stage AI call near a text PDF attached to the chat). Through
 * the real routes over HTTP on a real Postgres: extract (PDF, DOCX), scan
 * quote and cancel make no provider call and use no quota; a document
 * service runs only when confirmed; a question runs AI and takes its chat
 * unit as usual. Every AI request carries its user, endpoint, stage and why
 * it ran (ai_requests.trigger). The AI and OCR providers are stubs and any
 * outbound request is counted: no paid call is made.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/upload-no-ai.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('upload no AI (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const express = require('express');
const { pool } = require('../src/database/db');
const tiers = require('../src/rag/subscription-tiers');
const ledger = require('../src/rag/tariff-ledger');
const usage = require('../src/ai/usage-ledger');
const spendLog = require('../src/rag/llm-spend-log');
const { mountAnalyzerRoutes } = require('../src/ocr/routes');
const { markTrigger, requireServiceConfirm } = require('../src/ai/ai-trigger');
const { mountExplainDocument } = require('../src/rag/document-explain-route');
const explain = require('../src/rag/document-explain');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const rnd = () => Math.floor(Math.random() * 1e9);
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));
const made = [];

// every provider is a stub that counts; any outbound request is counted too
const calls = { ai: 0, ocr: 0, outbound: [] };
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (!/^http:\/\/127\.0\.0\.1:/u.test(String(url))) { calls.outbound.push(String(url)); throw new Error('outbound blocked in test'); }
  return realFetch(url, init);
};
async function callAI(messages, opts = {}) {
  return usage.track({ provider: 'stub', model: 'stub-model', endpoint: opts.endpoint || null, bound: { usd: 0, reason: 'stub' } }, async (call) => {
    calls.ai += 1;
    call.usage({ inTokens: 100, outTokens: 20 });
    return { text: JSON.stringify({ docType: 'Shartnoma', summary: 'ok', riskItems: [], missingClauses: [], complianceIssues: [], strengths: [] }), provider: 'stub' };
  });
}
// the explanation's AI (digest parts and the answer) is a stub that records its prompts
let explainAnswer = () => 'Bu hujjat 2 sahifadan iborat. Unda shartnoma shartlari bor.';
let explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' });
const explainPrompts = [];
async function explainAI(messages, opts = {}) {
  return usage.track({ provider: 'stub', model: 'stub-model', endpoint: opts.endpoint || null, bound: { usd: 0, reason: 'stub' } }, async (call) => {
    calls.ai += 1;
    explainPrompts.push(messages);
    call.usage({ inTokens: 100, outTokens: 20 });
    if (/^Excerpt /u.test(messages[1].text)) return explainDigestPart(messages[1].text);
    const a = explainAnswer(messages);
    return typeof a === 'object' ? { provider: 'stub', ...a } : { text: a, provider: 'stub' };
  });
}
async function ocrStub() { calls.ocr += 1; return { text: 'x'.repeat(500), provider: 'stub' }; }

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  await spendLog.initSpendLog();
  for (const f of ['20261004_013_tariff_periods.sql', '20261006_014_test_budget_risk.sql', '20261006_015_document_scans.sql']) {
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', f), 'utf8'));
  }
  usage.configure({ write: spendLog.writeLedgerRow, writeRequest: spendLog.writeRequestRow });
}
async function makeUser() {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, 'x', 'Upload Test', 'user', $2, now(), now(), now()) RETURNING id`, [`up_${Date.now()}_${rnd()}`, 7100000000 + rnd()]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}

let base;
async function startApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    const id = req.get('x-user');
    req.session = id ? { adminId: Number(id), role: 'user', isAuthenticated: true } : {};
    next();
  });
  app.use('/api/', usage.expressScope('web'));
  const requireAuth = (req, res, next) => (req.session.isAuthenticated ? next() : res.status(401).json({ error: 'Unauthorized' }));
  mountAnalyzerRoutes(app, { requireAuth, callAI, tariffModule: tiers, digestLongDocument: async t => t, pool, ocr: ocrStub });
  // the explanation as server.js mounts it, with the shared digest uncached
  mountExplainDocument(app, { requireAuth, requireServiceConfirm, resolveScanDocs: (q, r, n) => n(), tariffModule: tiers,
    callAI: explainAI, digest: t => explain.buildDigest(t, { callAI: explainAI }), lexLangForText: () => 'uz', logAudit: null });
  // the chat's middleware chain as server.js mounts it (question -> trigger
  // -> chat quota); the answer pipeline itself is a stub AI call
  app.post('/api/legal-chat', requireAuth,
    (req, res, next) => { if (String((req.body && req.body.message) || '').trim()) markTrigger('user_question'); next(); },
    tiers.enforceChatQuota('/api/legal-chat'),
    async (req, res) => { await callAI([{ role: 'user', content: req.body.message }], { endpoint: '/api/legal-chat' }); res.json({ reply: 'javob' }); });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}
async function post(p, user, { file = null, name = 'f.pdf', type = 'application/pdf', fields = {}, json = null } = {}) {
  let body; const headers = { 'x-user': String(user) };
  if (json) { body = JSON.stringify(json); headers['content-type'] = 'application/json'; }
  else { body = new FormData(); if (file) body.append('file', new Blob([file], { type }), name); for (const [k, v] of Object.entries(fields)) body.append(k, String(v)); }
  const r = await realFetch(base + p, { method: 'POST', headers, body });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const snapshot = async (u) => ({
  balance: JSON.stringify(await ledger.balance({ adminId: u })),
  usageRows: (await pool.query('SELECT count(*)::int AS n FROM tariff_usage WHERE admin_id = $1', [u])).rows[0].n,
  aiRequests: (await pool.query('SELECT count(*)::int AS n FROM ai_requests WHERE user_id = $1', [u])).rows[0].n,
  spendRows: (await pool.query('SELECT count(*)::int AS n FROM llm_spend_log WHERE user_id = $1', [u])).rows[0].n,
});
async function docxOf(text) {
  const JSZip = require('jszip');
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

(async () => {
  console.log('file upload never calls AI (db, real routes over HTTP, stub providers)');
  await ensureSchema();
  const server = await startApp();
  try {
    await test('attaching a text PDF and a DOCX (extract): 0 provider calls, no quota, no AI ledger row', async () => {
      const u = await makeUser();
      const before = await snapshot(u);
      const c0 = { ...calls, outbound: calls.outbound.length };
      const pdf = await post('/api/analyze/extract', u, { file: fx('text-2p.pdf') });
      assert.deepStrictEqual([pdf.status, pdf.body.scanned, pdf.body.pageCount], [200, false, 2]);
      assert.ok(pdf.body.text.length > 1000);
      const docx = await post('/api/analyze/extract', u, { file: await docxOf('Shartnoma matni. '.repeat(40)), name: 'shartnoma.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      assert.deepStrictEqual([docx.status, docx.body.scanned], [200, false]);
      await settle();
      assert.deepStrictEqual([calls.ai, calls.ocr, calls.outbound.length], [c0.ai, c0.ocr, c0.outbound], 'no provider call');
      assert.deepStrictEqual(await snapshot(u), before, 'quota and ledger unchanged');
    });

    await test('a scan: quote, then cancel (no ocr-image): 0 provider calls, no quota', async () => {
      const u = await makeUser();
      const before = await snapshot(u);
      const c0 = { ...calls, outbound: calls.outbound.length };
      for (const service of ['chat', 'analysis']) {
        const q = await post('/api/analyze/scan-quote', u, { file: fx('scan-3p.pdf'), fields: { service } });
        assert.deepStrictEqual([q.status, q.body.pages], [200, 3]);
      }
      await settle();
      assert.deepStrictEqual([calls.ai, calls.ocr, calls.outbound.length], [c0.ai, c0.ocr, c0.outbound], 'no OCR before the confirm');
      assert.deepStrictEqual(await snapshot(u), before);
    });

    await test('a document service without the confirm: 409, no AI, no quota; with it: one AI call, one unit, trigger "service_confirmed"', async () => {
      const u = await makeUser();
      const text = 'Ijara shartnomasi. '.repeat(200);
      const before = await snapshot(u);
      const c0 = calls.ai;
      const no = await post('/api/analyze', u, { json: { text } });
      assert.deepStrictEqual([no.status, no.body.code], [409, 'SERVICE_CONFIRM']);
      await settle();
      assert.strictEqual(calls.ai, c0);
      assert.deepStrictEqual(await snapshot(u), before);
      const yes = await post('/api/analyze', u, { json: { text, confirmed: true } });
      assert.strictEqual(yes.status, 200, JSON.stringify(yes.body));
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1);
      const b = await ledger.balance({ adminId: u });
      assert.strictEqual(b.services.analysis.used, 1);
      const req = (await pool.query('SELECT user_id, kind, trigger FROM ai_requests WHERE user_id = $1', [u])).rows;
      assert.deepStrictEqual(req.map(r => [r.user_id, r.kind, r.trigger]), [[u, 'POST /api/analyze', 'service_confirmed']]);
      const rows = (await pool.query('SELECT user_id, endpoint, stage FROM llm_spend_log WHERE user_id = $1', [u])).rows;
      assert.ok(rows.length >= 1 && rows.every(r => r.user_id === u && r.stage), JSON.stringify(rows));
    });

    await test('a question: AI runs and the chat unit is taken as usual; trigger "user_question"', async () => {
      const u = await makeUser();
      const c0 = calls.ai;
      const r = await post('/api/legal-chat', u, { json: { message: 'Ijara shartnomasini muddatidan oldin bekor qilsa bo\'ladimi?' } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.chat.used, 1);
      const req = (await pool.query('SELECT kind, trigger FROM ai_requests WHERE user_id = $1', [u])).rows;
      assert.deepStrictEqual(req.map(x => [x.kind, x.trigger]), [['POST /api/legal-chat', 'user_question']]);
    });

    await test('confirmed: true is consent only: no quota left or a document too large for the plan is still refused, with no AI', async () => {
      const u = await makeUser(); // Sinov: one analysis unit, one unit per job
      const c0 = calls.ai;
      const ok = await post('/api/analyze', u, { json: { text: 'Ijara shartnomasi. '.repeat(200), confirmed: true } });
      assert.strictEqual(ok.status, 200);
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1);
      const again = await post('/api/analyze', u, { json: { text: 'Boshqa shartnoma. '.repeat(200), confirmed: true } });
      assert.ok([402, 429].includes(again.status), `quota still applies: ${again.status}`);
      // the units are counted on the server from the text, not from the client
      const v = await makeUser();
      const big = await post('/api/analyze', v, { json: { text: 'Katta hujjat matni. '.repeat(3000), confirmed: true, units: 1, pages: 1 } });
      assert.deepStrictEqual([big.status, big.body.code], [413, 'DOCUMENT_TOO_LARGE']);
      await settle();
      assert.strictEqual(calls.ai, c0 + 1, 'no AI for either refusal');
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
    });

    await test('chat with a document: a question takes one chat unit and runs AI; asking for an analysis still goes to the cost card (409), no AI', async () => {
      const u = await makeUser();
      const doc = 'Shartnoma 5-bandi: ijarachi har oy to\'laydi. '.repeat(60);
      const c0 = calls.ai;
      const q = await post('/api/legal-chat', u, { json: { message: '5-bandda to\'lov qachon?', documentText: doc } });
      assert.strictEqual(q.status, 200, JSON.stringify(q.body));
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.chat.used, 1);
      const svc = await post('/api/legal-chat', u, { json: { message: 'Ushbu hujjatni tahlil qilib bering', documentText: doc } });
      assert.deepStrictEqual([svc.status, svc.body.code], [409, 'DOC_COST_CONFIRM']);
      await settle();
      assert.strictEqual(calls.ai, c0 + 1, 'no AI before the confirm');
    });

    await test('explanation: no confirm -> 409 and no AI; confirmed -> the page-marked text reaches the model whole, one analysis unit, trigger "service_confirmed"', async () => {
      const u = await makeUser();
      const pdf = await post('/api/analyze/extract', u, { file: fx('text-2p.pdf') });
      assert.deepStrictEqual(explain.pagesIn(pdf.body.text), [1, 2]);
      const before = await snapshot(u);
      const c0 = calls.ai;
      const no = await post('/api/draft/explain-document', u, { json: { documentText: pdf.body.text, docTicket: pdf.body.docTicket } });
      assert.deepStrictEqual([no.status, no.body.code], [409, 'SERVICE_CONFIRM']);
      await settle();
      assert.strictEqual(calls.ai, c0);
      assert.deepStrictEqual(await snapshot(u), before);
      explainPrompts.length = 0;
      const yes = await post('/api/draft/explain-document', u, { json: { documentText: pdf.body.text, docTicket: pdf.body.docTicket, confirmed: true } });
      assert.strictEqual(yes.status, 200, JSON.stringify(yes.body));
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1, 'one explanation call (no extra verifier call)');
      assert.ok(explainPrompts[0][1].text.includes(pdf.body.text), 'the whole extracted text, with its page marks');
      assert.deepStrictEqual([yes.body.coverage.mode, yes.body.coverage.pages, yes.body.check.flagged, yes.body.check.verified], ['full_text', 2, 0, false]);
      const b = await ledger.balance({ adminId: u });
      assert.strictEqual(b.services.analysis.used, pdf.body.units, 'units as quoted at extract (page marks not billed)');
      const req = (await pool.query('SELECT kind, trigger FROM ai_requests WHERE user_id = $1', [u])).rows;
      assert.deepStrictEqual(req.map(r => [r.kind, r.trigger]), [['POST /api/draft/explain-document', 'service_confirmed']]);
    });

    await test('explanation of a long document: every part digested, the last page reaches the model, still one unit; an empty answer releases it', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const text = explain.markPages(f.pages);
      const u = await makeUser();
      const c0 = calls.ai;
      explainPrompts.length = 0;
      const r = await post('/api/draft/explain-document', u, { json: { documentText: text, confirmed: true } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      await settle(250);
      const parts = explain.digestChunks(text).chunks.length;
      assert.strictEqual(calls.ai, c0 + parts + 1, 'the digest calls as before, plus one answer');
      assert.ok(explainPrompts.some(m => m[1].text.includes('6 oylik ijara haqi miqdorida kompensatsiya')), 'the last page was read');
      assert.deepStrictEqual([r.body.coverage.mode, r.body.coverage.chunks], ['digest', parts]);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
      const v = await makeUser();
      explainAnswer = () => '';
      try {
        const e = await post('/api/draft/explain-document', v, { json: { documentText: explain.markPages(loadAll()[0].pages), confirmed: true } });
        assert.strictEqual(e.status, 500);
      } finally { explainAnswer = () => 'Izoh.'; }
      await settle(250);
      assert.strictEqual((await ledger.balance({ adminId: v })).services.analysis.used, 0, 'no answer, no charge');
    });

    await test('a long document with a digest part not read: the explanation says "Qisman natija" first and the analysis unit is released', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const u = await makeUser();
      explainDigestPart = user => { if (/^Excerpt 2\//u.test(user)) throw new Error('provider down'); return { text: '- band', provider: 'stub' }; };
      let r;
      try {
        r = await post('/api/draft/explain-document', u, { json: { documentText: explain.markPages(f.pages), confirmed: true } });
      } finally { explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' }); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.partial, r.body.quotaRefunded, r.body.coverage.documentFullyRead], [true, true, false]);
      assert.ok(/^⚠️ \*\*Qisman natija — to'liq tahlil emas:\*\* hujjatning 2-qism/u.test(r.body.reply), r.body.reply.slice(0, 160));
      await settle(300);
      const b = await ledger.balance({ adminId: u });
      assert.strictEqual(b.services.analysis.used, 0, 'released: the document was not read whole');
      const rows = (await pool.query("SELECT status FROM tariff_usage WHERE admin_id = $1 AND status IS NOT NULL", [u])).rows.map(x => x.status);
      assert.deepStrictEqual(rows, ['released']);
    });

    await test('a document read whole whose answer was cut: marked partial at the top, the unit is committed (delivered, as a cut chat answer)', async () => {
      const u = await makeUser();
      explainAnswer = () => ({ text: "Birinchi gap to'liq yozilgan. Ikkinchi gap ham to'liq yozilgan. Uchinchi gap kes", truncated: true });
      let r;
      try {
        r = await post('/api/draft/explain-document', u, { json: { documentText: explain.markPages(loadAll()[0].pages), confirmed: true } });
      } finally { explainAnswer = () => 'Izoh.'; }
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.partial, r.body.quotaRefunded, r.body.coverage.documentFullyRead, r.body.coverage.answerTruncated], [true, undefined, true, true]);
      assert.ok(r.body.reply.startsWith("⚠️ **Qisman natija — to'liq tahlil emas:** javob uzunlik chegarasida to'xtadi"));
      assert.ok(!r.body.reply.includes('Uchinchi gap kes'));
      await settle(300);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
    });

    await test('the master\'s AI usage list and request view show the user, the endpoint and why the AI ran', () => {
      const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
      assert.ok(/<th>Kim · endpoint · sabab<\/th>/u.test(page));
      assert.ok(/'#' \+ r\.user_id[\s\S]{0,120}r\.kind[\s\S]{0,120}AU_TRIGGER\[r\.trigger\]/u.test(page));
      assert.ok(/'Foydalanuvchi #' \+ d\.request\.user_id[\s\S]{0,200}d\.request\.kind[\s\S]{0,120}AU_TRIGGER\[d\.request\.trigger\]/u.test(page));
      const report = fs.readFileSync(path.join(__dirname, '../src/ai/usage-report.js'), 'utf8');
      assert.ok(/r\.user_id, r\.trigger/u.test(report));
    });

    await test('server and page: explain/opinion need the confirm; the cost card never runs AI by itself; attaching calls only extract / scan-quote', () => {
      const server_ = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
      assert.ok(server_.includes("app.post('/api/draft/legal-opinion', requireAuth, require('../ai/ai-trigger').requireServiceConfirm,"));
      assert.ok(server_.includes("mountExplainDocument(app, {\n  requireAuth, requireServiceConfirm: require('../ai/ai-trigger').requireServiceConfirm, resolveScanDocs, tariffModule,"));
      const route = fs.readFileSync(path.join(__dirname, '../src/rag/document-explain-route.js'), 'utf8');
      assert.ok(route.includes("app.post('/api/draft/explain-document', requireAuth, requireServiceConfirm, resolveScanDocs, async"));
      const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
      const card = page.slice(page.indexOf('function renderDocCostCard('), page.indexOf('// ── Yuridik xulosa: upload a document'));
      assert.ok(!/return true;/u.test(card.slice(0, card.indexOf('var id = '))), 'no path that runs the service without the card');
      assert.ok(/quotes\.some\(function \(x\) \{ return !x; \}\)\) \{[\s\S]*?return false;/u.test(card), 'no quote: no AI');
      assert.ok(/Cheklovsiz hisob: limit yechilmaydi\. AI faqat «Davom etish»dan keyin ishlaydi\./u.test(card), 'staff see the card too');
      assert.ok(/fetch\('\/api\/draft\/explain-document'[\s\S]{0,300}confirmed: true/u.test(page));
      assert.ok(/fetch\('\/api\/draft\/legal-opinion', \{[\s\S]{0,400}confirmed: true/u.test(page));
      const attach = page.slice(page.indexOf('async function extractAttachment('), page.indexOf('async function scanFile('));
      assert.deepStrictEqual([...attach.matchAll(/fetch\('([^']+)'/gu)].map(m => m[1]), ['/api/analyze/extract'], 'attaching calls extract only (a scan goes through scanFile: quote, then the card)');
      const suggest = page.slice(page.indexOf('function renderAttachChips('), page.indexOf('async function explainFromAttachment('));
      assert.ok(!/fetch\(/u.test(suggest), 'the suggestion buttons are static');
    });
  } finally {
    await pool.query('DELETE FROM llm_spend_log WHERE user_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM ai_requests WHERE user_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM tariff_usage WHERE admin_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM tariff_periods WHERE admin_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1)', [made]).catch(() => {});
    server.close();
    await pool.end().catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
