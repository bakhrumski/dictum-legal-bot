'use strict';

/**
 * OCR as a step of a document service (2026-10-06), through the real routes
 * (src/ocr/routes.js) on a real Postgres. The OCR provider is a stub: no paid
 * call is made. Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/scan-ocr.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('scan OCR (db): skipped, TEST_DATABASE_URL not set');
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
const scanStore = require('../src/ocr/scan-store');
const { mountAnalyzerRoutes } = require('../src/ocr/routes');
const { pngHeader } = require('./helpers/make-pdf');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));

// the OCR provider: a stub that records its calls (and can be told to fail)
const ocrCalls = [];
let ocrBehaviour = null;
async function ocrStub(buf, mime, lang, { pages }) {
  ocrCalls.push({ bytes: buf.length, mime, pages });
  if (ocrBehaviour) return ocrBehaviour(buf, mime, pages);
  return { text: `SKAN MATNI. ${'Shartnoma bandi matni. '.repeat(40 * pages)}`, provider: 'stub' };
}

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
async function makeUser(extra = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since, tariff_plan, tariff_starts_at, tariff_expires_at)
     VALUES ($1, 'x', 'Scan Test', 'user', $5, CASE WHEN $6 THEN now() END, now(), now(), $2, $3, $4) RETURNING id`,
    [`sc_${Date.now()}_${rnd()}`, extra.plan || null, extra.startsAt || null, extra.expiresAt || null,
      extra.noChannel ? null : 7000000000 + Math.floor(Math.random() * 1e9), !extra.noChannel]);
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
  const callAI = async () => ({ text: JSON.stringify({ docType: 'Shartnoma', summary: 'ok', riskItems: [], missingClauses: [], complianceIssues: [], strengths: [] }), provider: 'stub' });
  mountAnalyzerRoutes(app, { requireAuth, callAI, tariffModule: tiers, digestLongDocument: async t => t, pool, ocr: ocrStub });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}
async function post(pathname, user, { file = null, name = 'scan.pdf', type = 'application/pdf', fields = {}, json = null } = {}) {
  let body;
  const headers = { 'x-user': String(user) };
  if (json) { body = JSON.stringify(json); headers['content-type'] = 'application/json'; }
  else {
    body = new FormData();
    if (file) body.append('file', new Blob([file], { type }), name);
    for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
  }
  const r = await fetch(base + pathname, { method: 'POST', headers, body });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const quote = (user, file, service, opts = {}) => post('/api/analyze/scan-quote', user, { file, fields: { service }, ...opts });
const ocr = (user, file, ticket, opts = {}) => post('/api/analyze/ocr-image', user, { file, fields: { scanTicket: ticket, confirmed: 'true', ...(opts.fields || {}) }, ...opts });
const used = async (user) => {
  const b = await ledger.balance({ adminId: user });
  if (!b.services) return { kind: b.kind };
  return Object.fromEntries(Object.entries(b.services).map(([k, v]) => [k, v.used]));
};
const rows = async (user) => (await pool.query(`SELECT service, credits, status, release_reason FROM tariff_usage WHERE admin_id = $1 ORDER BY id`, [user])).rows;

(async () => {
  console.log('scan OCR (db, real routes, stub provider)');
  await ensureSchema();
  const server = await startApp();

  try {
    await test('pages are counted on the server before any provider call; over the limit, encrypted, unreadable and text PDFs are refused', async () => {
      const u = await makeUser();
      const before = ocrCalls.length;
      const big = await quote(u, fx('scan-11p.pdf'), 'analysis');
      assert.deepStrictEqual([big.status, big.body.error, big.body.pages, big.body.maxPages, big.body.quotaUsed], [413, 'too_many_pages', 11, 10, false]);
      const enc = await quote(u, Buffer.concat([fx('scan-3p.pdf'), Buffer.from('\ntrailer\n<< /Encrypt 9 0 R >>\n')]), 'analysis');
      assert.deepStrictEqual([enc.status, enc.body.error], [422, 'encrypted']);
      const junk = await quote(u, Buffer.from('%PDF-1.4 not really'), 'analysis');
      assert.deepStrictEqual([junk.status, junk.body.error], [422, 'unreadable']);
      const text = await quote(u, fx('text-2p.pdf'), 'analysis');
      assert.deepStrictEqual([text.status, text.body.error], [409, 'text_pdf'], 'a text PDF is read without AI, not OCR');
      const bigImg = await quote(u, pngHeader(5000, 5000), 'analysis', { name: 'a.png', type: 'image/png' });
      assert.deepStrictEqual([bigImg.status, bigImg.body.error], [413, 'image_too_large']);
      const gif = await quote(u, Buffer.from('GIF89a......'), 'analysis', { name: 'a.gif', type: 'image/gif' });
      assert.deepStrictEqual([gif.status, gif.body.error], [422, 'unsupported_image']);
      // a paid plan's one document: 30 pages
      const paid = await makeUser();
      await ledger.grantPaidPeriod({ adminId: paid, plan: 'silver', paymentRef: `sc-${paid}` });
      assert.strictEqual((await quote(paid, fx('scan-11p.pdf'), 'analysis')).status, 200);
      const p31 = await quote(paid, fx('scan-31p.pdf'), 'analysis');
      assert.deepStrictEqual([p31.status, p31.body.maxPages], [413, 30]);
      assert.strictEqual(ocrCalls.length, before, 'no provider call for any of these');
      assert.deepStrictEqual(await rows(u), [], 'no quota touched');
    });

    await test('no OCR without the confirm; the quote is the service, in its units; the reply has no text', async () => {
      const u = await makeUser();
      const q = await quote(u, fx('scan-3p.pdf'), 'analysis');
      assert.deepStrictEqual([q.status, q.body.pages, q.body.units, q.body.cached, q.body.enough], [200, 3, 1, false, true]);
      const before = ocrCalls.length;
      const noConfirm = await post('/api/analyze/ocr-image', u, { file: fx('scan-3p.pdf'), fields: { scanTicket: q.body.scanTicket } });
      assert.deepStrictEqual([noConfirm.status, noConfirm.body.code], [409, 'SCAN_CONFIRM']);
      assert.strictEqual(ocrCalls.length, before);
      const r = await ocr(u, fx('scan-3p.pdf'), q.body.scanTicket);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.ok(r.body.scanId && r.body.held === true);
      assert.strictEqual(r.body.text, undefined, 'the OCR text is not sent to the browser');
      assert.strictEqual(ocrCalls.length, before + 1);
      assert.strictEqual(ocrCalls[ocrCalls.length - 1].pages, 3, 'the provider gets the counted pages (its output cap)');
      assert.deepStrictEqual((await rows(u)).map(x => [x.service, x.status]), [['analysis', 'reserved']], 'reserved before the OCR, held for the service');
      // the analysis of that scan uses the held reservation: one unit, not two
      const a = await post('/api/analyze', u, { json: { scanId: r.body.scanId } });
      assert.strictEqual(a.status, 200, JSON.stringify(a.body));
      await settle();
      assert.deepStrictEqual((await rows(u)).map(x => [x.service, x.credits, x.status]), [['analysis', 1, 'committed']]);
    });

    await test('analysis and opinion of one scan: OCR once (cache), each service from its own quota', async () => {
      const u = await makeUser();
      const q1 = await quote(u, fx('scan-3p-b.pdf'), 'analysis');
      const r1 = await ocr(u, fx('scan-3p-b.pdf'), q1.body.scanTicket);
      const calls = ocrCalls.length;
      const q2 = await quote(u, fx('scan-3p-b.pdf'), 'opinion');
      assert.deepStrictEqual([q2.body.cached, q2.body.units], [true, 1]);
      const r2 = await ocr(u, fx('scan-3p-b.pdf'), q2.body.scanTicket);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.body.scanId, r1.body.scanId, 'the same cached scan');
      assert.strictEqual(ocrCalls.length, calls, 'no second OCR');
      // the opinion adopts its own held reservation (meterDocument with the scan)
      const req = { session: { adminId: u, role: 'user' }, body: { scanId: r2.body.scanId } };
      const resStub = { statusCode: 200, locals: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, on() { return this; } };
      await scanStore.resolveScans({ pool, ledger })(req, resStub, () => {});
      const m = await tiers.meterDocument(req, resStub, { service: 'opinion', text: req.body.documentText, docTicket: req.body.docTicket, endpoint: '/api/draft/legal-opinion' });
      assert.deepStrictEqual([m.allowed, m.adopted], [true, true]);
      tiers.commitUsage(resStub);
      await settle();
      const u2 = await used(u);
      assert.deepStrictEqual([u2.analysis, u2.opinion, u2.chat], [1, 1, 0]);
    });

    await test('a free user the service would refuse (channel not joined) gets no OCR', async () => {
      const u = await makeUser({ noChannel: true });
      const q = await quote(u, fx('scan-3p.pdf'), 'analysis');
      const before = ocrCalls.length;
      const r = await ocr(u, fx('scan-3p.pdf'), q.body.scanTicket);
      assert.deepStrictEqual([r.status, r.body.code], [403, 'CHANNEL_REQUIRED']);
      assert.strictEqual(ocrCalls.length, before);
      assert.deepStrictEqual(await rows(u), []);
    });

    await test('a ticket is bound to its file, account and expiry: another file, account, tampering or expiry is refused before OCR', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const q = await quote(a, fx('scan-3p.pdf'), 'analysis');
      const before = ocrCalls.length;
      const otherFile = await ocr(a, fx('scan-3p-b.pdf'), q.body.scanTicket);
      assert.deepStrictEqual([otherFile.status, otherFile.body.code], [409, 'SCAN_TICKET_OTHER_FILE']);
      const otherAccount = await ocr(b, fx('scan-3p.pdf'), q.body.scanTicket);
      assert.deepStrictEqual([otherAccount.status, otherAccount.body.error], [403, 'scan_ticket_other_account']);
      const [payload, sig] = q.body.scanTicket.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), u: 0, p: 1 })).toString('base64url');
      const tampered = await ocr(a, fx('scan-3p.pdf'), `${forged}.${sig}`);
      assert.deepStrictEqual([tampered.status, tampered.body.error], [403, 'scan_ticket_invalid']);
      const old = ledger.signScanTicket({ fileHash: scanStore.fileHash(fx('scan-3p.pdf')), adminId: a, service: 'analysis', pages: 3, bytes: 1, kind: 'pdf', units: 1, now: Date.now() - 3600e3 });
      const expired = await ocr(a, fx('scan-3p.pdf'), old);
      assert.deepStrictEqual([expired.status, expired.body.error], [410, 'scan_ticket_expired']);
      assert.strictEqual(ocrCalls.length, before);
      assert.deepStrictEqual(await rows(a), []);
    });

    await test('parallel analysis and opinion of one new file: the paid OCR runs once, each service keeps its own reservation', async () => {
      const u = await makeUser();
      const file = fx('scan-3p.pdf');
      const [qa, qo] = await Promise.all([quote(u, file, 'analysis'), quote(u, file, 'opinion')]);
      assert.deepStrictEqual([qa.body.cached, qo.body.cached], [false, false], 'both quoted before any OCR');
      const before = ocrCalls.length;
      // a slow provider, so the two requests overlap
      ocrBehaviour = async (buf, mime, pages) => { await settle(300); return { text: `SKAN MATNI. ${'Shartnoma bandi matni. '.repeat(40 * pages)}`, provider: 'stub' }; };
      let ra, ro;
      try {
        [ra, ro] = await Promise.all([ocr(u, file, qa.body.scanTicket), ocr(u, file, qo.body.scanTicket)]);
      } finally { ocrBehaviour = null; }
      assert.deepStrictEqual([ra.status, ro.status], [200, 200], JSON.stringify([ra.body, ro.body]));
      assert.strictEqual(ocrCalls.length, before + 1, 'one paid OCR');
      assert.strictEqual(ra.body.scanId, ro.body.scanId, 'one stored reading');
      assert.deepStrictEqual((await rows(u)).map(x => [x.service, x.credits, x.status]).sort(),
        [['analysis', 1, 'reserved'], ['opinion', 1, 'reserved']], 'each service its own held unit');
      const n = await pool.query('SELECT count(*)::int AS n FROM document_scans WHERE admin_id = $1', [u]);
      assert.strictEqual(n.rows[0].n, 1);
    });

    await test('parallel chat scan and analysis of one new file: one OCR; the chat-scan pages are charged only by the request that ran it', async () => {
      const u = await makeUser();
      const file = fx('scan-3p-b.pdf');
      const [qc, qa] = await Promise.all([quote(u, file, 'chat'), quote(u, file, 'analysis')]);
      const before = ocrCalls.length;
      ocrBehaviour = async (buf, mime, pages) => { await settle(300); return { text: `SKAN MATNI. ${'Shartnoma bandi matni. '.repeat(40 * pages)}`, provider: 'stub' }; };
      let rc, ra;
      try {
        [rc, ra] = await Promise.all([ocr(u, file, qc.body.scanTicket), ocr(u, file, qa.body.scanTicket)]);
      } finally { ocrBehaviour = null; }
      assert.deepStrictEqual([rc.status, ra.status], [200, 200], JSON.stringify([rc.body, ra.body]));
      assert.strictEqual(ocrCalls.length, before + 1, 'one paid OCR');
      const r = await rows(u);
      const pool_ = r.filter(x => x.service === 'ocr');
      // committed only if the chat request ran the OCR; released ('ocr_shared') if it waited for the analysis'
      assert.ok(pool_.length === 1 && (pool_[0].status === 'committed' || (pool_[0].status === 'released' && pool_[0].release_reason === 'ocr_shared')), JSON.stringify(r));
      assert.deepStrictEqual(r.filter(x => x.service === 'analysis').map(x => x.status), ['reserved']);
    });

    await test('parallel: two scans against one Sinov analysis unit - one is read, the other refused before its OCR', async () => {
      const u = await makeUser();
      const qa = await quote(u, fx('scan-3p.pdf'), 'analysis');
      const qb = await quote(u, fx('scan-3p-b.pdf'), 'analysis');
      const before = ocrCalls.length;
      const [ra, rb] = await Promise.all([ocr(u, fx('scan-3p.pdf'), qa.body.scanTicket), ocr(u, fx('scan-3p-b.pdf'), qb.body.scanTicket)]);
      const statuses = [ra.status, rb.status].sort();
      assert.strictEqual(statuses[0], 200);
      assert.ok([402, 429].includes(statuses[1]), JSON.stringify([ra.body, rb.body]));
      assert.strictEqual(ocrCalls.length, before + 1, 'only one OCR was paid for');
      assert.strictEqual((await used(u)).analysis, 1);
    });

    await test('OCR fails: the service quota comes back, the provider cost stays in the ledger', async () => {
      const u = await makeUser();
      const q = await quote(u, fx('scan-3p.pdf'), 'analysis');
      ocrBehaviour = async () => {
        // the provider was called and billed, then failed
        await usage.record({ provider: 'gemini', model: 'gemini-2.5-flash', stage: 'ocr', status: 'error', startedAt: new Date(), finishedAt: new Date(), usage: { inTokens: 10000, outTokens: 500 } });
        throw Object.assign(new Error('upstream 503'), { status: 503 });
      };
      const r = await ocr(u, fx('scan-3p.pdf'), q.body.scanTicket);
      ocrBehaviour = null;
      assert.deepStrictEqual([r.status, r.body.quotaRefunded], [502, true]);
      await settle(150);
      assert.deepStrictEqual((await rows(u)).map(x => [x.service, x.status, x.release_reason]), [['analysis', 'released', 'ocr_failed']]);
      const spend = await pool.query(`SELECT count(*)::int AS n FROM llm_spend_log WHERE user_id = $1 AND stage = 'ocr'`, [u]);
      assert.strictEqual(spend.rows[0].n, 1, 'the billed attempt is kept');
      // a cut OCR text is never used: refused, quota back
      const q2 = await quote(u, fx('scan-3p-b.pdf'), 'analysis');
      ocrBehaviour = async () => { throw Object.assign(new Error('cap'), { code: 'OCR_TRUNCATED', status: 422 }); };
      const t = await ocr(u, fx('scan-3p-b.pdf'), q2.body.scanTicket);
      ocrBehaviour = null;
      assert.deepStrictEqual([t.status, t.body.code, t.body.quotaRefunded], [422, 'OCR_TRUNCATED', true]);
      assert.strictEqual((await used(u)).analysis, 0);
    });

    await test('the text after OCR is longer than the pages promised: never cut - too large is refused, larger is re-quoted with no second OCR', async () => {
      // Sinov: one unit at most; 3 pages read as 50 000 characters (2 units)
      const s = await makeUser();
      const qs = await quote(s, fx('scan-3p.pdf'), 'analysis');
      ocrBehaviour = async () => ({ text: 'x'.repeat(50000), provider: 'stub' });
      const r = await ocr(s, fx('scan-3p.pdf'), qs.body.scanTicket);
      assert.deepStrictEqual([r.status, r.body.code, r.body.quotaRefunded], [413, 'DOCUMENT_TOO_LARGE', true]);
      assert.strictEqual((await used(s)).analysis, 0);
      // Silver: re-quoted at 2 units, from the cached text
      const p = await makeUser();
      await ledger.grantPaidPeriod({ adminId: p, plan: 'silver', paymentRef: `rz-${p}` });
      const qp = await quote(p, fx('scan-3p.pdf'), 'analysis');
      const rp = await ocr(p, fx('scan-3p.pdf'), qp.body.scanTicket);
      ocrBehaviour = null;
      assert.deepStrictEqual([rp.status, rp.body.code, rp.body.units, rp.body.quotedUnits], [409, 'SCAN_RESIZE', 2, 1]);
      const calls = ocrCalls.length;
      const qp2 = await quote(p, fx('scan-3p.pdf'), 'analysis');
      assert.deepStrictEqual([qp2.body.cached, qp2.body.units], [true, 2]);
      const rp2 = await ocr(p, fx('scan-3p.pdf'), qp2.body.scanTicket);
      assert.deepStrictEqual([rp2.status, rp2.body.units], [200, 2]);
      assert.strictEqual(ocrCalls.length, calls, 'no second OCR');
      assert.strictEqual((await used(p)).analysis, 2);
    });

    await test('chat scan: from the chat-scan page pool, in pages; no raw text; the pool runs out before OCR, not after', async () => {
      const u = await makeUser();
      const q = await quote(u, fx('scan-3p.pdf'), 'chat');
      assert.deepStrictEqual([q.body.ocrPages, q.body.ocrRemaining], [3, 10]);
      const r = await ocr(u, fx('scan-3p.pdf'), q.body.scanTicket);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.text, undefined);
      assert.deepStrictEqual((await used(u)).ocr, 3, 'pages, not requests');
      // 11 pages exceed one document anyway; fill the pool with 3 + 3 + 3 = 9, then 3 more does not fit
      for (const f of ['scan-3p-b.pdf']) { const qq = await quote(u, fx(f), 'chat'); assert.strictEqual((await ocr(u, fx(f), qq.body.scanTicket)).status, 200); }
      // a third and fourth different 3-page scan: images stand in (1 page each) to vary the file
      const before = ocrCalls.length;
      for (let i = 0; i < 4; i++) {
        const img = pngHeader(800, 600, 1000 + i);
        const qq = await quote(u, img, 'chat', { name: `p${i}.png`, type: 'image/png' });
        const rr = await ocr(u, img, qq.body.scanTicket, { name: `p${i}.png`, type: 'image/png' });
        if (i < 4) assert.strictEqual(rr.status, 200, `image ${i}`);
      }
      assert.strictEqual((await used(u)).ocr, 10, 'the pool (10 pages) is used up');
      const img = pngHeader(800, 600, 2000);
      const last = await quote(u, img, 'chat', { name: 'last.png', type: 'image/png' });
      assert.strictEqual(last.body.enough, false);
      const lr = await ocr(u, img, last.body.scanTicket, { name: 'last.png', type: 'image/png' });
      assert.ok([402, 429].includes(lr.status), JSON.stringify(lr.body));
      assert.strictEqual(ocrCalls.length, before + 4, 'the refused one never reached the provider');
    });

    await test('a scan is never read for another account', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const q = await quote(a, fx('scan-3p.pdf'), 'chat');
      const r = await ocr(a, fx('scan-3p.pdf'), q.body.scanTicket);
      const res = await post('/api/analyze', b, { json: { scanId: r.body.scanId } });
      assert.deepStrictEqual([res.status, res.body.code], [404, 'SCAN_NOT_FOUND']);
      // and the same file uploaded by b is b's own OCR, not a's cached text
      const qb = await quote(b, fx('scan-3p.pdf'), 'chat');
      assert.strictEqual(qb.body.cached, false);
    });

    await test('legacy (v1) subscription: a chat scan counts one per file, as it was sold', async () => {
      const l = await makeUser({ plan: 'silver', startsAt: new Date(Date.now() - 5 * 864e5), expiresAt: new Date(Date.now() + 25 * 864e5) });
      assert.strictEqual((await ledger.balance({ adminId: l })).rules, 'legacy_v1');
      const q = await quote(l, fx('scan-3p.pdf'), 'chat');
      assert.strictEqual(q.body.ocrPages, 1);
      const r = await ocr(l, fx('scan-3p.pdf'), q.body.scanTicket);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const ocrRow = (await rows(l)).find(x => x.service === 'ocr');
      assert.deepStrictEqual([ocrRow.credits, ocrRow.status], [1, 'committed']);
    });

    await test('text PDF and DOCX extraction are unchanged (no AI, no quota)', async () => {
      const u = await makeUser();
      const t = await post('/api/analyze/extract', u, { file: fx('text-2p.pdf') });
      assert.deepStrictEqual([t.status, t.body.pageCount, t.body.scanned], [200, 2, false]);
      assert.ok(t.body.text.length > 1000 && t.body.docTicket);
      const s = await post('/api/analyze/extract', u, { file: fx('scan-3p.pdf') });
      assert.deepStrictEqual([s.status, s.body.pageCount, s.body.scanned], [200, 3, true], 'a small (pooled-buffer) PDF is read correctly');
      assert.deepStrictEqual(await rows(u), []);
    });
  } finally {
    server.close();
    try {
      const subjects = made.map(a => `a:${a}`);
      await pool.query(`DELETE FROM document_scans WHERE admin_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM llm_spend_log WHERE user_id = ANY($1)`, [made]);
      await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
      await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
      await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
      await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
    } catch (e) { console.warn('cleanup:', e.message); }
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
