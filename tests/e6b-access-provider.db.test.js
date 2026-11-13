'use strict';

/**
 * Data protection E6b (2026-10-29, migration 034, docs/design/shifrlash-1-bosqich.md
 * §5, §6, §9 answer 4): a staff account opening another person's sealed data
 * leaves one row per person (who, whose, where, how many - never the text);
 * one's own data, an ordinary account and ACCESS_LOG=off leave none; the
 * master's list names both sides. "Not to DeepSeek" is the person's choice
 * on the Moslashish page: off by default, read once per request, kept by
 * "clear", and the document explanation's DeepSeek route is skipped for it.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/e6b-access-provider.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('E6b access log / provider choice (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const accessLog = require('../src/privacy/access-log');
const choice = require('../src/privacy/provider-choice');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user') {
  return (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', $2, $3) RETURNING id`,
    [`e6b_${Date.now()}_${rnd()}`, `Sinov ${role}`, role])).rows[0].id;
}
const req = (adminId, role) => ({ session: { adminId, role }, method: 'GET', route: { path: '/api/requests' } });
const rowsFor = async viewer => (await pool.query('SELECT * FROM data_access_log WHERE viewer_id = $1 ORDER BY id', [viewer])).rows;

(async () => {
  console.log('E6b access log / provider choice (db)');
  const master = await makeUser('master');
  const student = await makeUser('student');
  const client = await makeUser('user');
  const tgUser = (await pool.query(`INSERT INTO users (telegram_id, first_name) VALUES ($1, 'Mijoz') RETURNING id`, [700000000 + rnd() % 1e8])).rows[0].id;

  await test('staff opening other people\'s data: one row per person, repeats counted, never the text', async () => {
    const n = await accessLog.record(pool, req(student, 'student'), { table: 'requests', ownerKind: 'telegram_user', owners: [tgUser, tgUser, null] });
    assert.strictEqual(n, 1);
    const rows = await rowsFor(student);
    assert.deepStrictEqual([rows[0].owner_kind, Number(rows[0].owner_id), rows[0].rows_seen, rows[0].table_name, rows[0].route], ['telegram_user', tgUser, 2, 'requests', 'GET /api/requests']);
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['created_at', 'id', 'owner_id', 'owner_kind', 'route', 'rows_seen', 'table_name', 'viewer_id', 'viewer_role']);
  });

  await test('one\'s own data, an ordinary account and ACCESS_LOG=off leave nothing', async () => {
    assert.strictEqual(await accessLog.record(pool, req(master, 'master'), { table: 'interview_recordings', owners: [master] }), 0);
    assert.strictEqual(await accessLog.record(pool, req(client, 'user'), { table: 'requests', ownerKind: 'telegram_user', owners: [tgUser] }), 0);
    assert.strictEqual(await accessLog.record(pool, req(master, 'master'), { table: 'requests', ownerKind: 'telegram_user', owners: [tgUser] }, { ACCESS_LOG: 'off' }), 0);
    assert.strictEqual((await rowsFor(master)).length, 0);
    assert.strictEqual((await rowsFor(client)).length, 0);
  });

  await test('the master\'s list names who looked and whose, filtered by owner', async () => {
    await accessLog.record(pool, req(master, 'master'), { table: 'interview_recordings', owners: [student] });
    const list = await accessLog.list(pool, { days: 1, ownerKind: 'account', ownerId: student });
    assert.ok(list.length >= 1);
    assert.deepStrictEqual([list[0].viewer_id, list[0].viewer_role, list[0].owner_name], [master, 'master', 'Sinov student']);
    const tg = await accessLog.list(pool, { days: 1, ownerKind: 'telegram_user', ownerId: tgUser });
    assert.strictEqual(tg[0].owner_name, 'Mijoz');
  });

  const profile = require('../src/adaptive/profile');
  const store = profile.createProfileStore({ db: pool });
  choice.setLoader(choice.dbLoader(pool));

  await test('"not to DeepSeek": off by default; on once the person sets it; read once per request', async () => {
    const st = () => ({ userIdOf: () => client, shared: {} });
    assert.strictEqual(await choice.deepseekAllowed(st()), true);
    await store.setManual(client, { noDeepseek: true, answerLength: 'qisqa', noDeepseekJunk: 1 });
    const one = st();
    assert.strictEqual(await choice.deepseekAllowed(one), false);
    assert.strictEqual(one.shared.noDeepseek, true, 'kept for the request');
    // a Telegram request names its linked account apart from the ledger's user
    assert.strictEqual(await choice.deepseekAllowed({ userIdOf: () => null, shared: { accountId: client } }), false);
    assert.strictEqual(await choice.deepseekAllowed({ userIdOf: () => null, shared: {} }), true, 'no account: as before');
    assert.strictEqual(await choice.deepseekAllowed(null), true);
    assert.deepStrictEqual(profile.cleanManual({ noDeepseek: 'yes' }), {}, 'only true');
  });

  await test('"clear" keeps the provider choice; everything else it set goes', async () => {
    await store.clear(client);
    const got = await store.get(client);
    assert.deepStrictEqual(got.manual, { noDeepseek: true });
    await store.setManual(client, {});
    assert.strictEqual(await choice.deepseekAllowed({ userIdOf: () => client, shared: {} }), true, 'turned off again');
  });

  await test('the document explanation: its DeepSeek route is skipped for the person, the default route answers', async () => {
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
    const { createExplainAI } = require('../src/ai/explain-router');
    let route = null;
    const ai = createExplainAI({
      usageLedger: { withChain: fn => fn(), track: async () => { route = 'deepseek'; return { text: 'ds' }; } },
      modelPricing: { callCostBound: () => ({ usd: 0 }), inputTokenBound: () => 1 }, deepseek: { chatCompletion: async () => ({ text: 'ds' }) },
      callOpenAI: async () => ({ text: 'x' }), paidAllowed: async () => true, lastResort: async () => ({ text: 'last' }),
      callDefault: async () => { route = 'default'; return { text: 'default' }; },
      deepseekAllowed: async () => false,
    });
    const out = await ai([{ role: 'user', text: 'x' }], {});
    assert.deepStrictEqual([route, out.text], ['default', 'default']);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
