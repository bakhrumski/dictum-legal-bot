'use strict';

/**
 * The test account's hard $5 budget on the website (2026-10-06, for the
 * paid pilot): the account linked to TG_TEST_ACCOUNT_USER_ID spends one
 * total budget across its Telegram chat AND its web requests (analysis,
 * opinion, drafts); once it is reached the usage ledger refuses new AI
 * calls (a 'skipped' row, no call). Every other account is untouched.
 * Unit part runs without a database; the ledger part needs
 * TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/test-account-web-budget.test.js
 */

const assert = require('assert');
const t = require('../src/bot/test-account');
const ledger = require('../src/ai/usage-ledger');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const TG = String(980000000 + Math.floor(Math.random() * 9999));
const env = (extra = {}) => ({ TG_TEST_ACCOUNT_USER_ID: TG, TG_TEST_ACCOUNT_SINCE: new Date(Date.now() - 3600e3).toISOString(), ...extra });
function fakeDb(admins, spend = { known_usd: 0, unknown_calls: 0, calls: 0, requests: 0 }) {
  const seen = [];
  return { seen, async query(text, params) {
    seen.push({ text, params });
    if (/FROM admins WHERE telegram_user_id/u.test(text)) return { rows: admins.filter(a => String(a.telegram_user_id) === String(params[0])) };
    if (/FROM llm_spend_log/u.test(text)) return { rows: [spend] };
    return { rows: [] };
  } };
}

(async () => {
  console.log('test account budget on the web');

  await test('only the linked ordinary account gets the test budget on the web; its spend is read by chat OR account', async () => {
    const db = fakeDb([{ id: 77, role: 'user', telegram_user_id: TG }]);
    const acc = await t.resolveWebTestAccount(db, 77, env());
    assert.ok(acc && acc.channel === 'web' && acc.budgetUsd === 5);
    const q = db.seen.find(x => /FROM llm_spend_log/u.test(x.text));
    assert.match(q.text, /chat_id = \$1::bigint OR \(\$4::int IS NOT NULL AND user_id = \$4::int\)/u);
    assert.strictEqual(q.params[3], 77);
    assert.strictEqual(await t.resolveWebTestAccount(db, 78, env()), null, 'another account: untouched');
    assert.strictEqual(await t.resolveWebTestAccount(fakeDb([{ id: 77, role: 'master', telegram_user_id: TG }]), 77, env()), null, 'a staff account: refused');
    assert.strictEqual(await t.resolveWebTestAccount(db, 77, env({ TG_TEST_ACCOUNT: 'off' })), null, 'off: no test budget');
    assert.strictEqual(await t.resolveWebTestAccount(db, 77, {}), null, 'not configured: nothing');
  });

  await test('the web middleware puts that account under the shared pool, and only when the mode is active', () => {
    const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.match(server, /app\.use\('\/api\/', usageLedger\.expressScope\('web'\)\);\s*\/\/[\s\S]*?app\.use\('\/api\/', async \(req, res, next\) => \{[\s\S]*?req\.session\.role === 'user' && webTestAccounts\.testAccountConfig\(\)\.active[\s\S]*?usageLedger\.useSharedBudget\(webTestAccounts\.ledgerPool\(account\)\)/u);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database cases skipped: TEST_DATABASE_URL not set)');
  } else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('refusing to run against what looks like a hosted database');
    process.exit(1);
  } else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool } = require('../src/database/db');
    const spendLog = require('../src/rag/llm-spend-log');
    let adminId = null;
    try {
      await test('database: web spend of the account reaches $5 -> the next AI call is not made (skipped), in either channel', async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
        await pool.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_user_id bigint');
        const r = await pool.query(`INSERT INTO admins (username, password, full_name, role, telegram_user_id) VALUES ($1, 'x', 'Pilot', 'user', $2) RETURNING id`, [`pilot_${TG}`, TG]);
        adminId = r.rows[0].id;
        await spendLog.initSpendLog();
        ledger.configure({ write: spendLog.writeLedgerRow, writeRequest: spendLog.writeRequestRow });
        const at = new Date();
        // a web analysis: 50M input tokens of gpt-6-luna at the list price = $5.00
        await ledger.runWithRequest({ service: 'web', userId: adminId }, async () => {
          await ledger.record({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer', status: 'success', startedAt: at, finishedAt: at, usage: { inTokens: 5e7, outTokens: 0 } });
        });
        await new Promise(res => setTimeout(res, 100));
        const acc = await t.resolveWebTestAccount(pool, adminId, env());
        assert.ok(Math.abs(acc.spend.knownUsd - 5) < 1e-6, String(acc.spend.knownUsd));
        assert.strictEqual(acc.exhausted, true);
        // the next web request: the provider function is never called
        let called = false;
        await ledger.runWithRequest({ service: 'web', userId: adminId }, async () => {
          ledger.useSharedBudget(t.ledgerPool(acc));
          await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer' }, async () => { called = true; return {}; }),
            /not called: telegram test account budget \$5 reached/u);
        });
        assert.strictEqual(called, false);
        await new Promise(res => setTimeout(res, 100));
        const skipped = await pool.query(`SELECT status, error_code FROM llm_spend_log WHERE user_id = $1 AND status = 'skipped'`, [adminId]);
        assert.deepStrictEqual(skipped.rows.map(x => x.error_code), ['REQUEST_BUDGET'], 'one skipped row, no call');
        // the Telegram side of the same account sees the same spend
        const tg = await t.resolveTestAccount(pool, { chatId: TG, fromUserId: TG, chatType: 'private' }, env());
        assert.strictEqual(tg.exhausted, true, 'one budget for both channels');
      });
    } finally {
      if (adminId) {
        await pool.query('DELETE FROM llm_spend_log WHERE user_id = $1', [adminId]).catch(() => {});
        await pool.query('DELETE FROM admins WHERE id = $1', [adminId]).catch(() => {});
      }
      await pool.end();
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
