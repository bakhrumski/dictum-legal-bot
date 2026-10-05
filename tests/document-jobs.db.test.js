'use strict';

/**
 * Chat with a document on a real Postgres ledger (tariffs v2 review,
 * 2026-10-06): an analysis takes analysis units, a legal opinion opinion
 * units, both take both - each confirmed first, none of them a chat unit;
 * if one of two cannot run, neither is charged; a Workspace chat takes one
 * chat unit whatever it is asked. Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/document-jobs.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('document jobs (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { pool } = require('../src/database/db');
const tiers = require('../src/rag/subscription-tiers');
const ledger = require('../src/rag/tariff-ledger');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);
const settle = () => new Promise(r => setTimeout(r, 60));

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/20261004_013_tariff_periods.sql'), 'utf8'));
}
async function makeUser() {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, 'x', 'Doc Job', 'user', $2, now(), now(), now()) RETURNING id`, [`dj_${Date.now()}_${rnd()}`, 600000000 + rnd() % 1e8]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}
function fakeRes() {
  const l = {};
  return { statusCode: 200, locals: {}, headersSent: false, writableFinished: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; this.writableFinished = true; if (l.finish) l.finish(); return this; },
    on(e, f) { l[e] = f; return this; } };
}
async function run(mw, user, body, url = '/api/legal-chat') {
  const out = fakeRes();
  let next = false;
  await mw({ session: { adminId: user, role: 'user' }, body, params: {}, originalUrl: url }, out, () => { next = true; });
  if (next) out.json({ reply: 'ok' });
  await settle();
  return { out, next };
}
const used = async (user) => {
  const b = await ledger.balance({ adminId: user });
  return { chat: b.services.chat.used, analysis: b.services.analysis.used, opinion: b.services.opinion.used };
};

(async () => {
  console.log('document jobs (db)');
  await ensureSchema();
  const mw = tiers.enforceChatQuota('/api/legal-chat');
  const doc2 = 'Shartnoma bandi matni. '.repeat(2500);   // ~57 500 chars -> 2 units
  const doc1 = 'Shartnoma bandi matni. '.repeat(1000);   // ~23 000 chars -> 1 unit

  await test('web: analysis -> analysis quota, opinion -> opinion quota, both -> both; each confirmed first; never chat', async () => {
    const user = await makeUser();
    await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `dj-${user}` });

    await run(mw, user, { message: '7-band qonuniymi?', documentText: doc2 });
    assert.deepStrictEqual(await used(user), { chat: 1, analysis: 0, opinion: 0 }, 'a question is one chat unit');

    const a = await run(mw, user, { message: 'Ushbu hujjatni tahlil qiling', documentText: doc2 });
    assert.deepStrictEqual([a.next, a.out.statusCode, a.out.body.services], [false, 409, ['analysis']]);
    assert.match(a.out.body.message, /Hujjat tahlili — 2 birlik \(tahlil limitidan\)[\s\S]*Chat limiti yechilmaydi/u);
    await run(mw, user, { message: 'Ushbu hujjatni tahlil qiling', documentText: doc2, confirmedJob: { analysis: 2 } });
    assert.deepStrictEqual(await used(user), { chat: 1, analysis: 2, opinion: 0 });

    const o = await run(mw, user, { message: "Shartnoma bo'yicha yuridik xulosa yozing", documentText: doc2 });
    assert.deepStrictEqual([o.out.statusCode, o.out.body.services, o.out.body.quotes[0].service], [409, ['opinion'], 'opinion']);
    const wrongService = await run(mw, user, { message: "Shartnoma bo'yicha yuridik xulosa yozing", documentText: doc2, confirmedJob: { analysis: 2 } });
    assert.strictEqual(wrongService.out.statusCode, 409, 'a confirmation for another service does not run it');
    await run(mw, user, { message: "Shartnoma bo'yicha yuridik xulosa yozing", documentText: doc2, confirmedUnits: 2 });
    assert.deepStrictEqual(await used(user), { chat: 1, analysis: 2, opinion: 2 }, 'the opinion took opinion units, not analysis');

    const both = await run(mw, user, { message: 'Hujjatni tahlil qilib, yuridik xulosa tayyorlang', documentText: doc2 });
    assert.deepStrictEqual([both.out.statusCode, both.out.body.services, both.out.body.quotes.map(q => q.units)], [409, ['analysis', 'opinion'], [2, 2]]);
    const half = await run(mw, user, { message: 'Hujjatni tahlil qilib, yuridik xulosa tayyorlang', documentText: doc2, confirmedJob: { analysis: 2 } });
    assert.strictEqual(half.out.statusCode, 409, 'both must be confirmed');
    const one = await run(mw, user, { message: 'Hujjatni tahlil qilib, yuridik xulosa tayyorlang', documentText: doc2, confirmedUnits: 2 });
    assert.strictEqual(one.out.statusCode, 409, 'a single number does not confirm two services');
    await run(mw, user, { message: 'Hujjatni tahlil qilib, yuridik xulosa tayyorlang', documentText: doc2, confirmedJob: { analysis: 2, opinion: 2 } });
    assert.deepStrictEqual(await used(user), { chat: 1, analysis: 4, opinion: 4 }, 'each service once, from its own quota; no chat unit');
  });

  await test('web: when the second service cannot run, the first is released - nothing is charged', async () => {
    const user = await makeUser();
    // Sinov: 1 analysis + 1 opinion unit
    await run(mw, user, { message: "Shartnoma bo'yicha yuridik xulosa yozing", documentText: doc1, confirmedUnits: 1 });
    assert.deepStrictEqual(await used(user), { chat: 0, analysis: 0, opinion: 1 });
    const both = await run(mw, user, { message: 'Hujjatni tahlil qilib, yuridik xulosa tayyorlang', documentText: doc1, confirmedJob: { analysis: 1, opinion: 1 } });
    assert.deepStrictEqual([both.next, both.out.statusCode, both.out.body.service, both.out.body.quotaRefunded], [false, 429, 'opinion', true]);
    assert.deepStrictEqual(await used(user), { chat: 0, analysis: 0, opinion: 1 }, 'the analysis reserved first was released');
    const rows = await pool.query(`SELECT service, status FROM tariff_usage WHERE admin_id = $1 AND service = 'analysis'`, [user]);
    assert.deepStrictEqual(rows.rows.map(r => r.status), ['released']);
  });

  await test('Workspace: a chat asked for an analysis or an opinion takes one chat unit and no document units', async () => {
    const user = await makeUser();
    await ledger.grantPaidPeriod({ adminId: user, plan: 'platinum', paymentRef: `djw-${user}` });
    const ws = tiers.enforceQuota('/api/workspace-ai');
    const id = '00000000-0000-4000-8000-000000000001';
    for (const question of ["Shartnoma bo'yicha yuridik xulosa yozing", 'Shartnomani tahlil qiling']) {
      const out = fakeRes();
      let next = false;
      await ws({ session: { adminId: user, role: 'user' }, body: { question }, params: { id }, originalUrl: `/api/workspaces/${id}/ai` }, out, () => { next = true; });
      assert.ok(next, question);
      out.json({ reply: 'ok' });
      await settle();
    }
    assert.deepStrictEqual(await used(user), { chat: 2, analysis: 0, opinion: 0 });
  });

  try {
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
