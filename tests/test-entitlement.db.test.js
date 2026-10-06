'use strict';

/**
 * Test entitlement for the pilot and its total AI budget, on a real
 * Postgres (2026-10-06). No paid AI call: provider functions are stubs and
 * the usage ledger rows are written by the ledger itself.
 *
 *   - master only; no payment, no paymentRef, no revenue; who, why and when
 *     are stored; admins.tariff_* untouched; when it ends the account is as
 *     before (its Sinov unused);
 *   - a repeated or parallel grant never adds quota;
 *   - its spend is reported apart from customers';
 *   - the budget: parallel requests reserve before their first AI call and
 *     cannot together pass it; unknown-cost calls count at the assumed
 *     price, never $0; a refused request makes no call; the per-request
 *     limit is the account's own, production's is unchanged.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/test-entitlement.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('test entitlement (db): skipped, TEST_DATABASE_URL not set');
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
const usage = require('../src/ai/usage-ledger');
const spendLog = require('../src/rag/llm-spend-log');
const testBudget = require('../src/ai/test-budget');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  await spendLog.initSpendLog();
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/20261004_013_tariff_periods.sql'), 'utf8'));
  usage.configure({ write: spendLog.writeLedgerRow, writeRequest: spendLog.writeRequestRow });
}
async function makeUser(role = 'user') {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, 'x', 'Test Ent', $2, now(), now(), now()) RETURNING id`, [`te_${Date.now()}_${rnd()}`, role]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}
// one priced call through the real usage ledger (no provider): gpt-6-luna input tokens
async function aiCall({ inTokens = 0, unknown = false } = {}) {
  return usage.track({ provider: unknown ? 'voicelab' : 'openai', model: unknown ? 'voicelab/no-price' : 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer' },
    async (ctx) => { if (!unknown) ctx.usage({ inTokens, outTokens: 0 }); return { text: 'ok' }; });
}

(async () => {
  console.log('test entitlement (db)');
  await ensureSchema();
  const master = await makeUser('master');

  await test('master only; no payment, paymentRef or price; who, why, when stored; admins.tariff_* untouched', async () => {
    const u = await makeUser();
    const other = await makeUser();
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: u, grantedBy: other, reason: 'pilot' })).reason, 'master_only');
    const g = await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'pilot 2026-10', hours: 48 });
    assert.ok(g.ok && !g.duplicate);
    const p = g.period;
    assert.deepStrictEqual([p.source, p.price_uzs, p.payment_ref, p.list_price_uzs, p.credit_uzs, p.created_by], ['test', null, null, null, 0, master]);
    assert.deepStrictEqual([p.economics.reason, p.economics.grantedBy, typeof p.economics.grantedAt, p.economics.budgetUsd], ['pilot 2026-10', master, 'string', 5]);
    await assert.rejects(pool.query(`UPDATE tariff_periods SET price_uzs = 1000 WHERE id = $1`, [p.id]), /tariff_periods_test_no_money/u, 'the table forbids a price on a test period');
    await assert.rejects(pool.query(`UPDATE tariff_periods SET payment_ref = 'fake' WHERE id = $1`, [p.id]), /tariff_periods_test_no_money/u);
    const a = (await pool.query('SELECT tariff_plan, tariff_expires_at FROM admins WHERE id = $1', [u])).rows[0];
    assert.deepStrictEqual([a.tariff_plan, a.tariff_expires_at], [null, null]);
    const b = await ledger.balance({ adminId: u });
    assert.deepStrictEqual([b.kind, b.services.chat.limit, b.services.analysis.limit, b.services.opinion.limit, b.services.draft.limit, b.services.ocr.limit], ['test', 12, 8, 6, 3, 10]);
    const r = await ledger.reserve({ adminId: u, service: 'analysis', units: 3, endpoint: '/api/legal-chat#analysis' });
    assert.ok(r.allowed && r.periodId === Number(p.id) || r.periodId === p.id, 'the job is charged to the test period');
    await ledger.commit(r.jobKey);
    assert.strictEqual((await ledger.balance({ adminId: u })).services.analysis.used, 3);
  });

  await test('a repeated or parallel grant never adds quota: one live test entitlement per account', async () => {
    const u = await makeUser();
    const results = await Promise.all(Array.from({ length: 6 }, () => ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'parallel', quotas: { chat: 5 } })));
    assert.strictEqual(results.filter(r => r.ok && !r.duplicate).length, 1);
    assert.strictEqual(results.filter(r => r.duplicate).length, 5);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM tariff_periods WHERE subject = $1 AND source = 'test'`, [`a:${u}`]);
    assert.strictEqual(rows.rows[0].n, 1);
    const again = await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'again', quotas: { chat: 500 } });
    assert.ok(again.duplicate);
    assert.strictEqual((await ledger.balance({ adminId: u })).services.chat.limit, 5, 'a repeat with bigger quotas changes nothing');
  });

  await test('refused for an account with a running paid period; staff refused', async () => {
    const paid = await makeUser();
    await ledger.grantPaidPeriod({ adminId: paid, plan: 'silver', paymentRef: `te-paid-${paid}` });
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: paid, grantedBy: master, reason: 'x pilot' })).reason, 'account_has_paid_period');
    const lawyer = await makeUser('lawyer');
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: lawyer, grantedBy: master, reason: 'x pilot' })).reason, 'not_an_ordinary_user');
  });

  await test('when it ends the account is as before: its Sinov still unused, no plan written, usage kept', async () => {
    const u = await makeUser();
    const past = new Date(Date.now() - 3 * 3600e3);
    const g = await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'short pilot', hours: 1, now: past });
    const r = await ledger.reserve({ adminId: u, service: 'chat', endpoint: '/api/legal-chat', now: new Date(past.getTime() + 60e3) });
    await ledger.commit(r.jobKey);
    const b = await ledger.balance({ adminId: u });
    assert.deepStrictEqual([b.kind, b.trialAvailable], ['none', true], 'the test did not use up the Sinov');
    const plan = await tiers.getUserPlan(u);
    assert.deepStrictEqual([plan.kind, plan.plan], ['none', null]);
    const kept = await pool.query(`SELECT count(*)::int AS n FROM tariff_usage WHERE period_id = $1 AND status = 'committed'`, [g.period.id]);
    assert.strictEqual(kept.rows[0].n, 1, 'what was used during the test stays recorded');
    // a master can end a live one early
    const live = await makeUser();
    await ledger.grantTestEntitlement({ adminId: live, grantedBy: master, reason: 'end early' });
    const ended = await ledger.endTestEntitlement({ adminId: live, endedBy: master });
    assert.strictEqual(ended.period.status, 'ended');
    assert.strictEqual((await ledger.balance({ adminId: live })).kind, 'none');
  });

  await test('test spend is reported apart: never in a customer row, cost or margin; pilot unit cost apart', async () => {
    const u = await makeUser();
    await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'report pilot' });
    const sum = rows => rows.reduce((t, x) => ({ jobs: t.jobs + x.jobs, usd: t.usd + x.known_usd }), { jobs: 0, usd: 0 });
    const custBefore = sum(await ledger.measuredServiceCost({ days: 1 }));
    const pilotBefore = sum(await ledger.measuredServiceCost({ days: 1, test: true }));
    const testBefore = (await tiers.marginReport({})).totals.testEntitlements;
    const r = await ledger.reserve({ adminId: u, service: 'chat', endpoint: '/api/legal-chat' });
    await usage.runWithRequest({ service: 'web', userId: u }, async (store) => {
      await pool.query('UPDATE tariff_usage SET request_id = $1 WHERE job_key = $2', [store.requestId, r.jobKey]);
      await aiCall({ inTokens: 1e6 });   // $0.10 at the gpt-6-luna list price
    });
    await ledger.commit(r.jobKey);
    await settle();
    const m = await tiers.marginReport({});
    assert.ok(!m.rows.some(x => x.adminId === u), 'no customer row: no revenue, no margin');
    assert.ok(Math.abs(m.totals.testEntitlements.costUsd - testBefore.costUsd - 0.1) < 1e-6, 'test spend in its own total');
    const custAfter = sum(await ledger.measuredServiceCost({ days: 1 }));
    const pilotAfter = sum(await ledger.measuredServiceCost({ days: 1, test: true }));
    assert.deepStrictEqual([custAfter.jobs, Number(custAfter.usd.toFixed(6))], [custBefore.jobs, Number(custBefore.usd.toFixed(6))], 'customer unit cost unchanged');
    assert.strictEqual(pilotAfter.jobs, pilotBefore.jobs + 1);
    assert.ok(Math.abs(pilotAfter.usd - pilotBefore.usd - 0.1) < 1e-6, 'the pilot measurement has it');
  });

  console.log('budget');

  await test('parallel requests reserve before their first AI call and cannot together pass the budget', async () => {
    const u = await makeUser();
    await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'budget', budgetUsd: 1, perRequestUsd: 0.25 });
    const ent = await testBudget.entitlementFor(pool, u);
    const ids = Array.from({ length: 6 }, (_, i) => `req-${u}-${i}`);
    const out = await Promise.all(ids.map(id => testBudget.admit(ent, id)));
    assert.strictEqual(out.filter(x => x.ok).length, 4, '4 x $0.25 = $1; the 5th and 6th are refused');
    assert.ok(out.filter(x => !x.ok).every(x => /leaves less than this request's \$0.25/u.test(x.reason)));
    // two finish having spent nothing: their holds free up
    await testBudget.release(ids[out.findIndex(x => x.ok)], 0);
    const st = await testBudget.standing(pool, ent);
    assert.ok(Math.abs(st.held - 0.75) < 1e-9 && st.spent === 0, JSON.stringify(st));
    assert.ok((await testBudget.admit(ent, `req-${u}-late`)).ok, 'a freed hold can be used');
    // a hold never released (the process stopped) counts in full
    await pool.query(`UPDATE test_budget_holds SET created_at = now() - interval '1 hour' WHERE request_id = $1`, [`req-${u}-late`]);
    const st2 = await testBudget.standing(pool, ent);
    assert.ok(st2.spent >= 0.25 - 1e-9, 'stale hold counted as spent');
  });

  await test('an unknown-cost call is never $0: counted at the assumed price', async () => {
    const u = await makeUser();
    await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'unknown', budgetUsd: 1, unknownCallUsd: 0.2, perRequestUsd: 0.5 });
    const ent = await testBudget.entitlementFor(pool, u);
    await usage.runWithRequest({ service: 'web', userId: u }, async () => {
      for (let i = 0; i < 3; i++) await aiCall({ unknown: true }).catch(() => {});
    });
    await settle();
    const st = await testBudget.standing(pool, ent);
    assert.ok(Math.abs(st.spent - 0.6) < 1e-9, `3 unknown calls x $0.2 = $0.6, got ${st.spent}`);
  });

  await test('through the usage ledger: admitted at the first call, stopped at the hold, refused when the budget is spent - no call made', async () => {
    const u = await makeUser();
    await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, reason: 'ledger', budgetUsd: 0.3, perRequestUsd: 0.15 });
    testBudget.resetCache();
    const productionPerRequest = usage.requestBudget().maxCostUsd;
    // request 1: $0.10 + $0.10 -> the second call is past its $0.15 hold? the check is before the call:
    // after $0.10 the next call runs (0.10 < 0.15), after $0.20 the third is refused
    let calls = 0;
    await usage.runWithRequest({ service: 'web', userId: u }, async (store) => {
      assert.ok(await testBudget.attach(u));
      for (let i = 0; i < 3; i++) {
        await usage.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer' },
          async (ctx) => { calls++; ctx.usage({ inTokens: 1e6, outTokens: 0 }); return { text: 'ok' }; }).catch(e => { store.lastErr = e.message; });
      }
      assert.strictEqual(store.budget.maxCostUsd, 0.15, 'this account\'s own per-request limit');
      await usage.finishRequest(store);
      assert.match(store.lastErr, /not called/u);
    });
    assert.strictEqual(calls, 2, 'the third call was not made');
    await settle();
    const ent = await testBudget.entitlementFor(pool, u);
    const st = await testBudget.standing(pool, ent);
    assert.ok(Math.abs(st.spent - 0.2) < 1e-9 && st.held === 0, JSON.stringify(st));
    // request 2: $0.20 spent + $0.15 hold > $0.30 -> refused before any call
    let called = false;
    await usage.runWithRequest({ service: 'web', userId: u }, async (store) => {
      await testBudget.attach(u);
      await assert.rejects(usage.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer' }, async () => { called = true; return {}; }),
        /not called: test budget \$0.3/u);
      await usage.finishRequest(store);
    });
    assert.strictEqual(called, false);
    await settle();
    const skipped = await pool.query(`SELECT error_code FROM llm_spend_log WHERE user_id = $1 AND status = 'skipped'`, [u]);
    assert.ok(skipped.rows.some(r => r.error_code === 'TEST_BUDGET'));
    // everyone else: no admission, production limit unchanged
    const other = await makeUser();
    await usage.runWithRequest({ service: 'web', userId: other }, async (store) => {
      assert.strictEqual(await testBudget.attach(other), false);
      assert.strictEqual(store.budget.maxCostUsd, productionPerRequest);
    });
  });

  await test('the web and Telegram hooks attach the budget only for a live test entitlement (cached id set)', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.match(server, /req\.session\.role === 'user' && await testBudget\.attach\(adminId\)/u);
    const bot = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'bot.js'), 'utf8');
    assert.match(bot, /if \(\(await testBudget\.accountsWithTest\(\)\)\.size\) \{[\s\S]*?testBudget\.attach\(ident\.adminId\)/u);
  });

  try {
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM test_budget_holds WHERE period_id IN (SELECT id FROM tariff_periods WHERE subject = ANY($1))`, [subjects]);
    await pool.query(`DELETE FROM llm_spend_log WHERE user_id = ANY($1)`, [made]);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
