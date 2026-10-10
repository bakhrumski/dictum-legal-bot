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
const { mountExplainDocument, createVerifyMaster } = require('../src/rag/document-explain-route');
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
// a mammoth reading for one test (the table reader's fallback over HTTP)
let docxMammoth = null;
// priced like the cheap lane, so the ledger shows a calculated cost; it
// reports finish_reason and truncated as the real adapters do
async function explainAI(messages, opts = {}) {
  return usage.track({ provider: 'stub', model: 'gpt-6-luna', endpoint: opts.endpoint || null, detail: opts.detail || null, bound: { usd: 0.01, reason: 'stub' } }, async (call) => {
    calls.ai += 1;
    explainPrompts.push(messages);
    const r = /^Excerpt /u.test(messages[1].text) ? explainDigestPart(messages[1].text) : explainAnswer(messages);
    const out = typeof r === 'object' ? { provider: 'stub', ...r } : { text: r, provider: 'stub' };
    call.usage({ inTokens: 3000, outTokens: out.truncated ? 1600 : 200, finishReason: out.truncated ? 'length' : 'stop', truncated: !!out.truncated });
    return out;
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
    req.session = id ? { adminId: Number(id), role: req.get('x-role') || 'user', isAuthenticated: true } : {};
    next();
  });
  app.use('/api/', usage.expressScope('web'));
  const requireAuth = (req, res, next) => (req.session.isAuthenticated ? next() : res.status(401).json({ error: 'Unauthorized' }));
  mountAnalyzerRoutes(app, { requireAuth, callAI, tariffModule: tiers, digestLongDocument: async t => t, pool, ocr: ocrStub,
    readDocx: buf => require('../src/ocr/docx-text').docxText(buf, docxMammoth ? { mammoth: docxMammoth } : {}) });
  // the explanation as server.js mounts it, with the shared digest uncached
  mountExplainDocument(app, { requireAuth, requireServiceConfirm, resolveScanDocs: (q, r, n) => n(), tariffModule: tiers,
    callAI: explainAI, digest: t => explain.buildDigest(t, { callAI: explainAI }), lexLangForText: () => 'uz', logAudit: null,
    // the server's own database check (server.js uses this same function)
    verifyMaster: createVerifyMaster(pool) });
  // the master's request view (no master check in this test app)
  require('../src/ai/usage-report').mountUsageReportRoutes(app, { requireMasterAdmin: (q, r, n) => n(), pool });
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
async function post(p, user, { file = null, name = 'f.pdf', type = 'application/pdf', fields = {}, json = null, role = null } = {}) {
  let body; const headers = { 'x-user': String(user), ...(role ? { 'x-role': role } : {}) };
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

    await test('the size ticket is bound to the exact text: a small document\'s ticket sent with a large text is not used - the server re-measures the text it got (refused as too large here), no AI', async () => {
      const md = require('./helpers/mini-docx');
      const u = await makeUser(); // Sinov: one unit per job
      const small = await post('/api/analyze/extract', u, { file: await md.docx(md.p('Kichik shartnoma: 1.1. Narx 5 000 000 so\'m.')), name: 'kichik.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      assert.strictEqual(small.status, 200, JSON.stringify(small.body));
      assert.ok(small.body.docTicket && small.body.units === 1);
      const big = 'Katta hujjat bandi, boshqa matn. '.repeat(2500); // ~80 000 chars: 2 units
      assert.strictEqual(ledger.readDocTicket(small.body.docTicket, big), null, 'the ticket does not fit another text');
      const c0 = calls.ai;
      const r = await post('/api/draft/explain-document', u, { json: { documentText: big, docTicket: small.body.docTicket, confirmed: true } });
      assert.deepStrictEqual([r.status, r.body.code], [413, 'DOCUMENT_TOO_LARGE'], JSON.stringify(r.body));
      assert.ok(r.body.size.chars >= big.trim().length, `sized from the text sent: ${r.body.size.chars}`);
      // the small text with its own ticket runs, at the size the server signed
      const ok = await post('/api/draft/explain-document', u, { json: { documentText: small.body.text, docTicket: small.body.docTicket, confirmed: true } });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      await settle(250);
      assert.strictEqual(calls.ai, c0 + 1, 'no AI for the refused one');
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
    });

    await test('DOCX tables over HTTP: the extract signs how the tables were read; the explanation reports it in coverage and under the answer - "rows" with its limit, "lost" when they were not kept', async () => {
      const md = require('./helpers/mini-docx');
      const docxBuf = await md.docx(md.p('Ilova.') + md.table([
        md.row([md.cell('Ish'), md.cell('Muddat')], { header: true }),
        md.row([md.cell('Hisobot topshirish'), md.cell('mart oyi')]),
        md.row([md.cell('Audit o\'tkazish'), md.cell('iyun oyi')]),
      ]));
      const u = await makeUser();
      const x = await post('/api/analyze/extract', u, { file: docxBuf, name: 'ilova.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      assert.deepStrictEqual([x.status, x.body.tables, x.body.tableStructure], [200, 1, 'rows'], JSON.stringify(x.body));
      const r = await post('/api/draft/explain-document', u, { json: { documentText: x.body.text, docTicket: x.body.docTicket, confirmed: true } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.coverage.tables, { count: 1, structure: 'rows', meaning: 'technical' });
      assert.ok(r.body.reply.includes("qatorlab, ustun sarlavhalari bilan o'qildi (mexanik; kataklar to'liq va to'g'ri o'qilgani tasdiqlanmagan)"));
      // a reading that lost the table structure (the server's own signed record)
      const v = await makeUser();
      const flat = 'Ilova.\n\nIsh\n\nMuddat\n\nHisobot topshirish\n\nmart oyi\n\nAudit o\'tkazish\n\niyun oyi';
      const lostTicket = ledger.signDocTicket({ text: flat, chars: flat.length, tables: { count: 1, structure: 'lost' } });
      const l = await post('/api/draft/explain-document', v, { json: { documentText: flat, docTicket: lostTicket, confirmed: true } });
      assert.strictEqual(l.status, 200, JSON.stringify(l.body));
      assert.deepStrictEqual(l.body.coverage.tables, { count: 1, structure: 'lost', meaning: 'technical' });
      assert.ok(l.body.reply.includes("qator va ustun tuzilishi saqlanmadi"));
      // without a ticket nothing is claimed about tables
      const n = await post('/api/draft/explain-document', await makeUser(), { json: { documentText: flat, confirmed: true } });
      assert.strictEqual(n.body.coverage.tables, null);
    });

    await test('DOCX fallback over HTTP (no AI): the cause codes reach the ticket and the explanation\'s coverage; the missing words and where they stand go to a master in the database only, no-store', async () => {
      const md = require('./helpers/mini-docx');
      const buf = await md.docx(md.p('Ilova.') + md.table([md.row([md.cell('Ish'), md.cell('Muddat')], { header: true }),
        `<w:tr><w:sdt><w:sdtContent>${md.cell('Hisobot topshirish')}</w:sdtContent></w:sdt>${md.cell('mart oyi')}</w:tr>`]));
      // mammoth reads the content-control cell's word twice (a stand-in for a structure the reader misses)
      docxMammoth = { extractRawText: async () => ({ value: 'Ilova.\n\nIsh\n\nMuddat\n\nHisobot topshirish\n\nHisobot\n\nmart oyi' }) };
      const type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      try {
        const u = await makeUser();
        const c0 = calls.ai;
        const x = await post('/api/analyze/extract', u, { file: buf, name: 'a.docx', type });
        assert.deepStrictEqual([x.status, x.body.tableStructure, x.body.tableCauses], [200, 'lost', ['sdt_cell']], JSON.stringify(x.body));
        assert.strictEqual(x.body.tableCheck, undefined, 'an ordinary user gets the codes, not the words');
        const r = await post('/api/draft/explain-document', u, { json: { documentText: x.body.text, docTicket: x.body.docTicket, confirmed: true } });
        assert.deepStrictEqual(r.body.coverage.tables, { count: 1, structure: 'lost', causes: ['sdt_cell'], meaning: 'technical' });
        // a master in the database: the words and their places, in this response only
        const m = await makeUser();
        const forged = await post('/api/analyze/extract', m, { file: buf, name: 'a.docx', type, role: 'master' });
        assert.strictEqual(forged.body.tableCheck, undefined, 'a session role alone is not enough');
        await pool.query("UPDATE admins SET role = 'master' WHERE id = $1", [m]);
        const fd = new FormData();
        fd.append('file', new Blob([buf], { type }), 'a.docx');
        const res = await realFetch(base + '/api/analyze/extract', { method: 'POST', headers: { 'x-user': String(m), 'x-role': 'master' }, body: fd });
        const body = await res.json();
        assert.strictEqual(res.headers.get('cache-control'), 'no-store');
        assert.deepStrictEqual(body.tableCheck.missingWords.map(w => [w.word, w.structures, w.places.length > 0]), [['hisobot', ['sdt_cell'], true]]);
        assert.ok(/mechanical/u.test(body.tableCheck.meaning));
        assert.strictEqual(calls.ai - c0 - 1, 0, 'no AI for the extracts (one call: the explanation)');
      } finally { docxMammoth = null; }
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

    await test('partial result for an ordinary user over HTTP (2026-10-09 run): parts cut, two re-read by priority, one left out -> 200 partial; the unit released once (never twice, never below what was spent before), every AI call kept in the ledger with its cost', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const text = explain.markPages(f.pages);
      const u = await makeUser();
      // a paid period (Sinov has one analysis): room for two explanations
      await ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `test-partial-${u}-${rnd()}` });
      // first a whole reading: delivered, one unit spent
      const ok = await post('/api/draft/explain-document', u, { json: { documentText: text, confirmed: true } });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      await settle(300);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
      // then the run: parts 1, 2 and 3 cut at the cap; halves read whole
      const n = explain.digestChunks(text).chunks.length;
      assert.ok(n >= 3);
      const s0 = (await pool.query('SELECT count(*)::int AS n FROM llm_spend_log WHERE user_id = $1', [u])).rows[0].n;
      explainDigestPart = user => (/^Excerpt [123]\//u.test(user) ? { text: '- band, kesilgan', truncated: true } : { text: '- band', provider: 'stub' });
      let r;
      try {
        r = await post('/api/draft/explain-document', u, { json: { documentText: text, confirmed: true } });
      } finally { explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' }); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.partial, r.body.quotaRefunded, r.body.coverage.documentFullyRead], [true, true, false]);
      // each cut part: re-read or left out, and why
      const rr = r.body.coverage.reread;
      assert.deepStrictEqual(rr.map(x => x.decision).sort(), ['excluded', 'reread', 'reread']);
      assert.strictEqual(rr.find(x => x.decision === 'excluded').why, 'extra_call_limit');
      assert.strictEqual(r.body.coverage.summary.rereadPolicy, 'priority_uncalibrated');
      await settle(400);
      // released once: the earlier delivered unit stays spent, this one is back
      const rows = (await pool.query("SELECT job_key, status, release_reason FROM tariff_usage WHERE admin_id = $1 AND status IS NOT NULL ORDER BY id", [u])).rows;
      assert.deepStrictEqual(rows.map(x => [x.status, x.release_reason || null]), [['committed', null], ['released', 'explain_partial_read']]);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
      // a second release or a late commit of the same job changes nothing
      assert.strictEqual(await ledger.release(rows[1].job_key, 'again'), false);
      assert.strictEqual(await ledger.commit(rows[1].job_key), false);
      assert.strictEqual((await pool.query('SELECT status FROM tariff_usage WHERE job_key = $1', [rows[1].job_key])).rows[0].status, 'released');
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
      // the provider calls stay in the ledger with their cost: n parts, 4 re-read halves, the final call
      const spent = (await pool.query(`SELECT stage, cost_usd::float AS cost, cost_source, call_detail FROM llm_spend_log WHERE user_id = $1 ORDER BY seq OFFSET $2`, [u, s0])).rows;
      assert.strictEqual(spent.length, n + explain.DIGEST_LIMITS.maxExtraCalls + 1);
      assert.ok(spent.every(x => x.cost > 0 && x.cost_source === 'calculated'), JSON.stringify(spent[0]));
      assert.ok(spent.every(x => Number.isInteger(x.call_detail.predictedTokens) || x.call_detail.phase === 'final'));
      const req = (await pool.query('SELECT doc_coverage FROM ai_requests WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1', [u])).rows[0];
      assert.deepStrictEqual([req.doc_coverage.fullyRead, req.doc_coverage.reread.length], [false, 3]);
    });

    await test('a long document none of whose parts is read whole (an ordinary user): no final call, 422, the unit released, every digest call kept in the ledger with its part, finish_reason and cost', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const text = explain.markPages(f.pages);
      const u = await makeUser();
      const c0 = calls.ai;
      explainPrompts.length = 0;
      explainDigestPart = () => ({ text: '- band, kesilgan', truncated: true });
      let r;
      try {
        r = await post('/api/draft/explain-document', u, { json: { documentText: text, confirmed: true } });
      } finally { explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' }); }
      assert.strictEqual(r.status, 422, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.code, r.body.quotaRefunded, r.body.coverage.finalRun], ['DOCUMENT_NOT_READ', true, false]);
      const n = explain.digestChunks(text).chunks.length;
      assert.strictEqual(calls.ai - c0, n + explain.DIGEST_LIMITS.maxExtraCalls, 'the parts and the bounded re-reads only');
      assert.ok(explainPrompts.every(m => /^Excerpt /u.test(m[1].text)), 'no explanation generated');
      await settle(400);
      // the service is not delivered: its unit is released
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 0);
      assert.deepStrictEqual((await pool.query('SELECT status FROM tariff_usage WHERE admin_id = $1 AND status IS NOT NULL', [u])).rows.map(x => x.status), ['released']);
      // the provider's calls are kept with their cost, stage, part and why they stopped
      const rows = (await pool.query(`SELECT stage, finish_reason, truncated, call_detail, cost_usd::float AS cost, cost_source, status
                                        FROM llm_spend_log WHERE user_id = $1 ORDER BY seq`, [u])).rows;
      assert.strictEqual(rows.length, n + explain.DIGEST_LIMITS.maxExtraCalls);
      assert.ok(rows.every(x => x.stage === 'document_digest' && x.finish_reason === 'length' && x.truncated === true && x.call_detail.phase === 'digest'), JSON.stringify(rows[0]));
      assert.ok(rows.every(x => x.cost > 0 && x.cost_source === 'calculated'), 'the cost stays in the ledger');
      assert.deepStrictEqual(rows.slice(0, n).map(x => x.call_detail.part), Array.from({ length: n }, (_, i) => String(i + 1)));
      assert.ok(rows.slice(n).every(x => /^[0-9]+[ab]$/u.test(x.call_detail.part)));
      const req = (await pool.query('SELECT doc_coverage, outcome FROM ai_requests WHERE user_id = $1', [u])).rows[0];
      assert.deepStrictEqual([req.doc_coverage.read, req.doc_coverage.finalRun, req.doc_coverage.fullyRead, req.outcome], [0, false, false, 'http_422']);
    });

    await test('a long document read whole: digest rows and the final row are separate stages; the request records what was read', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const u = await makeUser();
      const r = await post('/api/draft/explain-document', u, { json: { documentText: explain.markPages(f.pages), confirmed: true } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      await settle(400);
      const rows = (await pool.query('SELECT stage, finish_reason, truncated, call_detail FROM llm_spend_log WHERE user_id = $1 ORDER BY seq', [u])).rows;
      const final = rows[rows.length - 1];
      assert.deepStrictEqual([final.stage, final.call_detail.phase, final.finish_reason, final.truncated], ['document', 'final', 'stop', false]);
      assert.ok(rows.slice(0, -1).every(x => x.stage === 'document_digest' && x.truncated === false));
      const req = (await pool.query('SELECT doc_coverage FROM ai_requests WHERE user_id = $1', [u])).rows[0];
      assert.deepStrictEqual([req.doc_coverage.fullyRead, req.doc_coverage.finalRun, req.doc_coverage.read], [true, true, rows.length - 1]);
      assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 1);
    });

    await test('the request view: coverage is technical and says which of all / some / none was read; a missing doc_coverage column reads "not recorded", and no row is lost', async () => {
      const f = loadAll().find(x => x.id === 'long-lease');
      const text = explain.markPages(f.pages);
      const viewOf = async (u) => {
        const id = (await pool.query('SELECT request_id FROM ai_requests WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1', [u])).rows[0].request_id;
        const r = await realFetch(`${base}/api/admin/ai-usage/requests/${id}`);
        return r.json();
      };
      // all read
      const a = await makeUser();
      assert.strictEqual((await post('/api/draft/explain-document', a, { json: { documentText: text, confirmed: true } })).status, 200);
      await settle(400);
      const va = await viewOf(a);
      assert.deepStrictEqual([va.summary.service_coverage.status, va.summary.service_coverage.meaning], ['all_read', 'technical']);
      // some parts left out
      const b = await makeUser();
      explainDigestPart = user => (/^Excerpt 2[ab]?\//u.test(user) ? { text: "x", truncated: true } : { text: "- band", provider: "stub" });
      try { assert.strictEqual((await post('/api/draft/explain-document', b, { json: { documentText: text, confirmed: true } })).status, 200); }
      finally { explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' }); }
      await settle(400);
      assert.strictEqual((await viewOf(b)).summary.service_coverage.status, 'some_excluded');
      // none read
      const c = await makeUser();
      explainDigestPart = () => ({ text: 'x', truncated: true });
      try { assert.strictEqual((await post('/api/draft/explain-document', c, { json: { documentText: text, confirmed: true } })).status, 422); }
      finally { explainDigestPart = () => ({ text: '- band (1-sahifa)', provider: 'stub' }); }
      await settle(400);
      assert.strictEqual((await viewOf(c)).summary.service_coverage.status, 'none_read');

      // the 2026-10-07 columns could not be added: rows are still written, coverage reads "not recorded"
      await pool.query('ALTER TABLE ai_requests DROP COLUMN doc_coverage');
      await pool.query('ALTER TABLE llm_spend_log DROP COLUMN finish_reason, DROP COLUMN truncated, DROP COLUMN call_detail');
      try {
        const g = await makeUser();
        const r = await post('/api/draft/explain-document', g, { json: { documentText: text, confirmed: true } });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.coverage.status, 'all_read', 'the user\'s own answer does not depend on the column');
        await settle(400);
        const n = explain.digestChunks(text).chunks.length;
        assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM llm_spend_log WHERE user_id = $1', [g])).rows[0].n, n + 1, 'no ledger row lost');
        const vg = await viewOf(g);
        assert.strictEqual(vg.summary.service_coverage.status, 'not_recorded');
        assert.ok(/to'liq o'qilgan deb hisoblanmaydi/u.test(vg.summary.service_coverage.note));
        assert.strictEqual(vg.calls.length, n + 1);
        assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM tariff_usage WHERE admin_id = $1 AND status = $2', [g, 'committed'])).rows[0].n, 1);
      } finally {
        await pool.query('ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS doc_coverage JSONB');
        await pool.query('ALTER TABLE llm_spend_log ADD COLUMN IF NOT EXISTS finish_reason VARCHAR(30), ADD COLUMN IF NOT EXISTS truncated BOOLEAN, ADD COLUMN IF NOT EXISTS call_detail JSONB');
        spendLog.schemaGaps.callColumns = false;
        spendLog.schemaGaps.docCoverage = false;
      }
    });

    await test('the stage trace: only on explicit request (trace: true), only to an account that is master in the database, only for this request, not stored', async () => {
      const f = loadAll().find(x => x.id === 'investment-agreement');
      const text = f.pages.join('\n\n');
      const u = await makeUser();
      const call = async (opts) => post('/api/draft/explain-document', u, opts);
      // an ordinary user asking for it: none
      const asUser = await call({ json: { documentText: text, confirmed: true, trace: true } });
      assert.strictEqual(asUser.status, 200, JSON.stringify(asUser.body));
      assert.strictEqual(asUser.body.trace, undefined);
      // a session that says "master" for an account that is not master in the database: none
      const forged = await call({ role: 'master', json: { documentText: text, confirmed: true, trace: true } });
      assert.strictEqual(forged.body.trace, undefined, 'the database role decides, not the session alone');
      await pool.query("UPDATE admins SET role = 'master' WHERE id = $1", [u]);
      try {
        // a master who did not ask: none
        const noOptIn = await call({ role: 'master', json: { documentText: text, confirmed: true } });
        assert.strictEqual(noOptIn.status, 200);
        assert.strictEqual(noOptIn.body.trace, undefined);
        // a master who asked: this request's trace, not cacheable
        const tag = 'tr-test-0001abcd';
        const r = await realFetch(base + '/api/draft/explain-document', { method: 'POST', headers: { 'x-user': String(u), 'x-role': 'master', 'content-type': 'application/json' },
          body: JSON.stringify({ documentText: text, confirmed: true, trace: true, traceTag: tag }) });
        const body = await r.json();
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.headers.get('cache-control'), 'no-store');
        // bound to this request: the page's tag, this request's id, this document's hash
        assert.strictEqual(body.trace.tag, tag);
        assert.strictEqual(body.trace.documentSha256, require('crypto').createHash('sha256').update(text).digest('hex'));
        assert.ok(body.trace.requestId && !Number.isNaN(Date.parse(body.trace.createdAt)));
        await settle(200);
        assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM ai_requests WHERE request_id = $1 AND user_id = $2', [body.trace.requestId, u])).rows[0].n, 1, 'the trace names the request row of this call');
        // a tag that is not ours is dropped, never echoed
        const odd = await call({ role: 'master', json: { documentText: text, confirmed: true, trace: true, traceTag: '<img src=x>' } });
        assert.strictEqual(odd.body.trace.tag, null);
        // two requests, two traces: the second never carries the first one's tag
        const second = await call({ role: 'master', json: { documentText: text, confirmed: true, trace: true, traceTag: 'tr-test-0002abcd' } });
        assert.strictEqual(second.body.trace.tag, 'tr-test-0002abcd');
        assert.notStrictEqual(second.body.trace.requestId, body.trace.requestId);
        assert.ok(/^HUJJAT DAYJESTI/u.test(body.trace.digest));
        assert.ok(body.trace.scopeLines.some(l => l.includes('jumladan Investor')));
        assert.deepStrictEqual(Object.keys(body.trace.scopeCounts).sort(), ['candidates', 'dropped', 'referenced', 'savedChars', 'selected', 'shortened']);
        assert.ok(Array.isArray(body.trace.scopeSent) && Array.isArray(body.trace.scopeDropped));
        assert.strictEqual(body.trace.conflictCandidates.length, 1);
        await settle(300);
        // nothing of the text reaches the ledger or the request row
        const rows = (await pool.query('SELECT call_detail::text AS d, error_message FROM llm_spend_log WHERE user_id = $1', [u])).rows;
        assert.ok(rows.every(x => !/jumladan|Investor/u.test(`${x.d || ''} ${x.error_message || ''}`)));
        const reqRows = (await pool.query('SELECT doc_coverage::text AS c, legal_check::text AS l FROM ai_requests WHERE user_id = $1', [u])).rows;
        assert.ok(reqRows.every(x => !/HUJJAT DAYJESTI|jumladan|Investor/u.test(`${x.c || ''} ${x.l || ''}`)));
      } finally {
        await pool.query("UPDATE admins SET role = 'user' WHERE id = $1", [u]);
      }
      // the page asks for it only on a master's opt-in ("Diagnostika" or the console flag),
      // keeps it in memory and offers it as a JSON download
      const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
      assert.ok(page.includes('var wantTrace = isMasterUi() && (explainDiagnostics === true || window.__JAI_TRACE === true);'));
      assert.ok(page.includes('confirmed: true, trace: wantTrace, traceTag: traceTag })'));
      assert.ok(page.includes('var traceOk = !!(wantTrace && d && d.trace && d.trace.tag === traceTag && traceEpoch === diagEpoch);'));
      assert.ok(page.includes('lastExplainTrace = { tag: traceTag, epoch: diagEpoch, source: text || null, response: d, extract: extract };'));
      assert.ok(page.includes("if (isMasterUi()) {\n                    html += '<label class=\"ai-diag-toggle'"));
      assert.ok(page.includes(`onclick="downloadExplainTrace(\\'' + escapeHtml(tag) + '\\')">JSON yuklab olish</button>`));
      // switching on, downloading and clearing call nothing (no server, no AI)
      for (const fn of ['toggleExplainDiagnostics', 'downloadExplainTrace', 'clearExplainTrace', 'invalidateExplainTrace', 'newTraceTag']) {
        const start = page.indexOf(`function ${fn}(`);
        const end = page.indexOf('\n        }\n', start);
        assert.ok(start > 0 && end > start, fn);
        assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|callAI/u.test(page.slice(start, end)), `${fn} makes no request`);
      }
      // a new chat, another session, a new or removed file drop the old trace
      for (const at of ['function createNewAiChat()', 'aiAttachments.push(att);', 'function removeSessionDoc(i)', 'currentAiSessionId = session.id;']) {
        const i = page.indexOf(at);
        assert.ok(i > 0 && page.slice(i, i + 700).includes('invalidateExplainTrace()'), at);
      }
      assert.ok(!/localStorage[^\n]*(?:lastExplainTrace|explainDiagnostics)|sessionStorage[^\n]*(?:lastExplainTrace|explainDiagnostics)/u.test(page), 'never stored in the browser');
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
      assert.ok(/fetch\('\/api\/draft\/explain-document'[\s\S]{0,600}confirmed: true/u.test(page));
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
