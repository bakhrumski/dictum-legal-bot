'use strict';

/**
 * Telegram test account (src/bot/test-account.js): permission by Telegram
 * user id linked in the database, ordinary role only, its own $5 budget
 * where unknown cost is never $0, off by config, ends after 48 hours.
 *
 * Providers are stubs; no number here is a real provider cost.
 *
 *   node tests/telegram-test-account.test.js
 *   TEST_DATABASE_URL=postgresql://… node tests/telegram-test-account.test.js   (also the database part)
 */

const assert = require('assert');
if (process.env.TEST_DATABASE_URL && !/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const t = require('../src/bot/test-account');
const ledger = require('../src/ai/usage-ledger');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const ID = '700100200';
const NOW = Date.parse('2026-10-04T12:00:00Z');
const ENV = { TG_TEST_ACCOUNT_USER_ID: ID, TG_TEST_ACCOUNT_SINCE: '2026-10-04T10:00:00Z' };

/** A fake database: admins rows by telegram_user_id, and a spend row. Records every statement. */
function fakeDb({ admins = [], spend = { known_usd: 0, unknown_calls: 0, calls: 0, requests: 0 }, fail = false } = {}) {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      sql.push(text);
      if (fail) throw new Error('db down');
      if (/FROM admins WHERE telegram_user_id/u.test(text)) return { rows: admins.filter(a => String(a.telegram_user_id) === String(params[0])) };
      if (/FROM llm_spend_log/u.test(text)) return { rows: [spend] };
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('telegram test account');

  await test('config: off unless set; active in its window; ends after 48 h; never longer; off switch', () => {
    assert.strictEqual(t.testAccountConfig({}, NOW).active, false);
    const on = t.testAccountConfig(ENV, NOW);
    assert.strictEqual(on.active, true);
    assert.strictEqual(on.until, '2026-10-06T10:00:00.000Z');
    assert.strictEqual(on.budgetUsd, 5);
    assert.strictEqual(t.testAccountConfig(ENV, Date.parse('2026-10-06T10:00:00Z')).active, false, 'ends exactly 48 h after the start');
    assert.strictEqual(t.testAccountConfig({ ...ENV, TG_TEST_ACCOUNT_HOURS: '500' }, NOW).hours, 48, 'cannot be configured longer');
    assert.strictEqual(t.testAccountConfig({ ...ENV, TG_TEST_ACCOUNT: 'off' }, NOW).active, false);
    assert.strictEqual(t.testAccountConfig({ TG_TEST_ACCOUNT_USER_ID: ID }, NOW).reason, 'TG_TEST_ACCOUNT_SINCE is not set');
    assert.strictEqual(t.testAccountConfig({ ...ENV, TG_TEST_ACCOUNT_USER_ID: '@bakhrom_abdimuminov' }, NOW).active, false, 'a username is not an id');
    assert.strictEqual(t.testAccountConfig({ ...ENV, TG_TEST_ACCOUNT_SINCE: '2026-10-05T10:00:00Z' }, NOW).active, false, 'a future start is refused');
  });

  await test('permission is the linked Telegram user id; other users are not even looked up', async () => {
    const db = fakeDb({ admins: [{ id: 42, role: 'user', telegram_user_id: ID }] });
    assert.strictEqual(await t.resolveTestAccount(db, { chatId: 555, fromUserId: 555 }, ENV, NOW), null);
    assert.strictEqual(db.sql.length, 0, 'no query for anyone else');
    const account = await t.resolveTestAccount(db, { chatId: Number(ID), fromUserId: Number(ID) }, ENV, NOW);
    assert.ok(account);
    assert.strictEqual(account.adminId, 42);
    // the same id in a group chat is not the test account
    assert.strictEqual(await t.resolveTestAccount(db, { chatId: -100123, fromUserId: Number(ID), chatType: 'supergroup' }, ENV, NOW), null);
  });

  await test('not linked, linked twice, or linked to a staff account: no test mode, and no role is given', async () => {
    assert.strictEqual(await t.resolveTestAccount(fakeDb(), { chatId: ID, fromUserId: ID }, ENV, NOW), null);
    assert.strictEqual(await t.resolveTestAccount(fakeDb({ admins: [{ id: 1, role: 'user', telegram_user_id: ID }, { id: 2, role: 'user', telegram_user_id: ID }] }), { chatId: ID, fromUserId: ID }, ENV, NOW), null);
    for (const role of ['master', 'lawyer', 'student']) {
      const db = fakeDb({ admins: [{ id: 3, role, telegram_user_id: ID }] });
      assert.strictEqual(await t.resolveTestAccount(db, { chatId: ID, fromUserId: ID }, ENV, NOW), null, role);
    }
    const db = fakeDb({ admins: [{ id: 42, role: 'user', telegram_user_id: ID }] });
    await t.resolveTestAccount(db, { chatId: ID, fromUserId: ID }, ENV, NOW);
    assert.ok(db.sql.every(q => /^\s*SELECT/iu.test(q)), 'the test mode only reads; it never writes a role');
    assert.strictEqual(await t.resolveTestAccount(fakeDb({ fail: true }), { chatId: ID, fromUserId: ID }, ENV, NOW), null, 'a database error means ordinary limits');
  });

  await test('budget: unknown-cost calls are priced at the assumed price, not $0, and the result says it is not strict', async () => {
    const cfg = t.testAccountConfig(ENV, NOW);
    const s = await t.testAccountSpend(fakeDb({ spend: { known_usd: 4.8, unknown_calls: 4, calls: 60, requests: 9 } }), cfg);
    assert.ok(Math.abs(s.committedUsd - 5.0) < 1e-9, String(s.committedUsd));
    assert.strictEqual(s.exhausted, true, '4.80 known + 4 unknown x 0.05 = 5.00');
    assert.strictEqual(s.strict, false);
    const clean = await t.testAccountSpend(fakeDb({ spend: { known_usd: 1, unknown_calls: 0, calls: 10, requests: 2 } }), cfg);
    assert.deepStrictEqual([clean.exhausted, clean.strict, clean.remainingUsd], [false, true, 4]);
  });

  await test('the ledger stops new paid calls at the shared budget - essential stages too - and counts unknown cost', async () => {
    const rows = [];
    ledger.configure({ write: async (row) => { rows.push(row); }, writeRequest: async () => {} });
    await ledger.runWithRequest({ service: 'telegram', chatId: Number(ID) }, async (store) => {
      ledger.useSharedBudget({ label: 'telegram test account', limitUsd: 5, spentUsd: 4.9, unknownCallUsd: 0.05 });
      await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/intent' }, async (c) => { c.usage({ inTokens: 100, outTokens: 10 }); });
      // an unknown-cost call: 4.9 + 0.05 = 4.95
      await ledger.track({ provider: 'voicelab', model: 'voicelab/no-price', endpoint: '/rag/classify-topic' }, async (c) => { c.usage({ inTokens: 10, outTokens: 10 }); });
      assert.strictEqual(store.shared.unknownCostCalls, 1);
      await ledger.track({ provider: 'voicelab', model: 'voicelab/no-price', endpoint: '/rag/classify-topic' }, async (c) => { c.usage({ inTokens: 10, outTokens: 10 }); });
      // 5.00 committed: nothing new is called, the answer included
      let reached = false;
      await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async () => { reached = true; }),
        e => e.code === 'REQUEST_BUDGET' && /telegram test account budget \$5 reached/u.test(e.message));
      assert.strictEqual(reached, false);
    });
    await new Promise(r => setTimeout(r, 20));
    assert.ok(rows.every(r => r.chatId === Number(ID)), 'every call is recorded on the test chat');
    assert.strictEqual(rows[rows.length - 1].status, 'skipped');
    // a request without the shared budget is not affected
    await ledger.runWithRequest({ service: 'telegram', chatId: 555 }, async () => {
      assert.strictEqual(await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async () => 'ok'), 'ok');
    });
  });

  await test('the user-facing note shows spend, the unknown part and the end time', () => {
    const account = { until: '2026-10-06T10:00:00Z', budgetUsd: 5, spend: { committedUsd: 1.2, unknownCalls: 2, assumedUnknownUsd: 0.1 } };
    const note = t.testModeNote(account, 1.25);
    assert.match(note, /\$1\.2500 \/ \$5/u);
    assert.match(note, /2 ta narxi noma'lum/u);
    assert.match(note, /qat'iy emas/u);
  });

  // ── database ─────────────────────────────────────────────────────────
  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('telegram test account: refusing to run against a hosted database');
    process.exit(1);
  }
  const { pool } = require('../src/database/db');
  const economy = require('../src/services/telegram-economy');
  const spendLog = require('../src/rag/llm-spend-log');
  const CHAT = 990000000 + Math.floor(Math.random() * 9999);
  const other = CHAT + 1;
  const cleanup = async () => {
    await pool.query('DELETE FROM tg_answer_reservations WHERE chat_id = ANY($1::bigint[])', [[CHAT, other]]).catch(() => {});
    await pool.query('DELETE FROM tg_agent_daily_free_usage WHERE chat_id = ANY($1::bigint[])', [[CHAT, other]]).catch(() => {});
    await pool.query('DELETE FROM tg_answer_wallets WHERE chat_id = ANY($1::bigint[])', [[CHAT, other]]).catch(() => {});
    await pool.query('DELETE FROM llm_spend_log WHERE chat_id = $1', [CHAT]).catch(() => {});
  };
  try {
    await test('database: a test reservation takes no free answer or credit, keeps one answer at a time, and its release refunds nothing', async () => {
      await cleanup();
      await pool.query('INSERT INTO tg_answer_wallets (chat_id, credits) VALUES ($1, 2)', [CHAT]).catch(async () => { await economy.getPaidAnswerCredits(CHAT); await pool.query('INSERT INTO tg_answer_wallets (chat_id, credits) VALUES ($1, 2)', [CHAT]); });
      const first = await economy.claimTestAnswer(CHAT);
      assert.strictEqual(first.allowed, true);
      assert.strictEqual(first.source, 'test');
      const second = await economy.claimTestAnswer(CHAT);
      assert.deepStrictEqual([second.allowed, second.pending], [false, true]);
      assert.strictEqual(await economy.releaseAnswerEntitlement(CHAT, first), true);
      const { rows: free } = await pool.query('SELECT COALESCE(SUM(free_answers), 0)::int AS n FROM tg_agent_daily_free_usage WHERE chat_id = $1', [CHAT]);
      const { rows: wallet } = await pool.query('SELECT credits FROM tg_answer_wallets WHERE chat_id = $1', [CHAT]);
      assert.strictEqual(free[0].n, 0);
      assert.strictEqual(wallet[0].credits, 2, 'credits untouched');
      // another chat's ordinary limit is unchanged
      for (let i = 0; i < 3; i++) {
        const r = await economy.claimAnswerEntitlement(other, 3);
        assert.strictEqual(r.source, 'free');
        await economy.finalizeAnswerEntitlement(other, r);
      }
      assert.strictEqual((await economy.claimAnswerEntitlement(other, 3)).allowed, false);
    });

    await test('database: the test spend is read from the ledger rows of that chat in the window', async () => {
      await spendLog.initSpendLog();
      ledger.configure({ write: spendLog.writeLedgerRow, writeRequest: spendLog.writeRequestRow });
      const at = new Date();
      await ledger.runWithRequest({ service: 'telegram', chatId: CHAT }, async () => {
        await ledger.record({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer', status: 'success', startedAt: at, finishedAt: at, usage: { inTokens: 1e6, outTokens: 0 } });
        await ledger.record({ provider: 'voicelab', model: 'voicelab/no-price', endpoint: '/tg-agent/answer', status: 'error', startedAt: at, finishedAt: at, usage: {} });
        await ledger.record({ provider: 'huggingface', model: 'x', stage: 'rerank', status: 'skipped', startedAt: at, finishedAt: at, usage: {} });
      });
      const cfg = t.testAccountConfig({ TG_TEST_ACCOUNT_USER_ID: String(CHAT), TG_TEST_ACCOUNT_SINCE: new Date(Date.now() - 3600e3).toISOString() });
      const s = await t.testAccountSpend(pool, cfg);
      assert.ok(Math.abs(s.knownUsd - 0.1) < 1e-9, String(s.knownUsd), '1M input tokens of gpt-6-luna at the list price in model-pricing.js');
      assert.strictEqual(s.unknownCalls, 1, 'the failed call is unknown, the skipped one is not a call');
      assert.strictEqual(s.calls, 2);
      assert.strictEqual(s.strict, false);
    });
  } finally {
    await cleanup();
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
