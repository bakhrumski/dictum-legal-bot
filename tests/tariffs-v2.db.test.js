'use strict';

/**
 * Tariffs v2 on a real Postgres: the one-time Sinov, linked Telegram and web
 * accounts sharing it, 100% of a paid period usable and not one unit more,
 * Gold 3x / Platinum 5x, 30-day periods with no weekly reset, renewal /
 * upgrade / downgrade, a repeated payment callback, parallel jobs on one
 * personal limit, reserve / commit / release and their idempotency, legacy
 * subscriptions carried over, Telegram answers and Stars credits.
 *
 * Needs TEST_DATABASE_URL pointing at a THROWAWAY database (CI boot-smoke,
 * or a local one); skips without it, refuses a hosted one. Applies
 * migrations/20261004_013_tariff_periods.sql itself when the runner has not.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/tariffs-v2.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('tariffs v2 (db): skipped, TEST_DATABASE_URL not set');
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
const economy = require('../src/services/telegram-economy');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const made = { admins: [], subjects: [] };
const rnd = () => Math.floor(Math.random() * 1e9);

async function ensureSchema() {
  // the app's admins table in CI; a minimal one on a bare local database
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz', 'telegram_user_id bigint', 'telegram_chat_id bigint',
    'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  // the migration is idempotent: applying it again on a migrated database changes nothing
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/20261004_013_tariff_periods.sql'), 'utf8'));
}

async function makeUser({ plan = null, expiresInDays = null, startedDaysAgo = 1, telegramUserId = null, role = 'user' } = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_starts_at, tariff_expires_at,
                         telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, 'x', 'V2 Test', $2, $3, $4, $5, $6, NOW(), NOW(), NOW()) RETURNING id`,
    [`v2_${Date.now()}_${rnd()}`, role, plan,
      plan ? new Date(Date.now() - startedDaysAgo * 864e5) : null,
      expiresInDays == null ? null : new Date(Date.now() + expiresInDays * 864e5),
      telegramUserId]);
  made.admins.push(r.rows[0].id);
  return r.rows[0].id;
}

async function useUp(identity, service, n, extra = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await ledger.reserve({ ...identity, service, units: 1, ...extra }));
  for (const r of out) if (r.allowed && r.jobKey) await ledger.commit(r.jobKey);
  return out;
}

(async () => {
  console.log('tariffs v2 (db)');
  await ensureSchema();

  await test('Sinov: 5 chat + 1 analysis + 1 opinion, then refused; given once - a second grant attempt changes nothing', async () => {
    const id = await makeUser();
    const me = { adminId: id };
    const chat = await useUp(me, 'chat', 6);
    assert.deepStrictEqual(chat.map(r => r.allowed), [true, true, true, true, true, false]);
    assert.strictEqual(chat[5].kind, 'trial');
    assert.strictEqual((await ledger.reserve({ ...me, service: 'analysis', units: 1 })).allowed, true);
    assert.strictEqual((await ledger.reserve({ ...me, service: 'opinion', units: 1 })).allowed, true);
    assert.strictEqual((await ledger.reserve({ ...me, service: 'opinion', units: 1 })).allowed, false);
    const draft = await ledger.reserve({ ...me, service: 'draft', units: 1 });
    assert.deepStrictEqual([draft.allowed, draft.reason], [false, 'not_in_plan']);
    // analysis and opinion did not take from chat
    const b = await ledger.balance(me);
    assert.deepStrictEqual([b.services.chat.used, b.services.analysis.used, b.services.opinion.used], [5, 1, 1]);
    // selecting it again or resolving again does not grant another
    const again = await tiers.selectPlan(id, 'sinov');
    assert.strictEqual(again.plan, 'sinov');
    const trials = await pool.query(`SELECT count(*)::int AS n FROM tariff_periods WHERE subject = $1 AND source = 'trial'`, [`a:${id}`]);
    assert.strictEqual(trials.rows[0].n, 1);
  });

  await test('linked Telegram and web accounts share one Sinov; an unlinked Telegram user has their own', async () => {
    const tg = 700000000 + rnd() % 1e8;
    const tgOnly = { telegramUserId: tg };
    await useUp(tgOnly, 'chat', 3);              // asked in Telegram before linking
    const id = await makeUser({ telegramUserId: tg });   // then registered / linked
    const b = await ledger.balance({ adminId: id });
    assert.deepStrictEqual([b.kind, b.services.chat.used, b.services.chat.remaining], ['trial', 3, 2]);
    const more = await useUp({ adminId: id, telegramUserId: tg }, 'chat', 3);
    assert.deepStrictEqual(more.map(r => r.allowed), [true, true, false], 'one Sinov between them');
    const other = await ledger.balance({ telegramUserId: tg + 1 });
    assert.strictEqual(other.kind, 'none', 'a different person is not merged (no IP or name matching)');
  });

  await test('Silver: 100% of each quota is usable, the next unit is refused; Gold is 3x and Platinum 5x', async () => {
    for (const [plan, mult] of [['silver', 1], ['gold', 3], ['platinum', 5]]) {
      const id = await makeUser();
      await ledger.grantPaidPeriod({ adminId: id, plan, paymentRef: `test:${plan}:${id}` });
      const me = { adminId: id };
      const chat = await ledger.reserve({ ...me, service: 'chat', units: 150 * mult });
      assert.strictEqual(chat.allowed, true, `${plan}: the whole chat quota in one go`);
      assert.strictEqual((await ledger.reserve({ ...me, service: 'chat', units: 1 })).allowed, false, `${plan}: one more`);
      for (const [svc, n] of [['analysis', 8], ['opinion', 8], ['draft', 10]]) {
        assert.strictEqual((await ledger.reserve({ ...me, service: svc, units: n * mult })).allowed, true, `${plan} ${svc}`);
        assert.strictEqual((await ledger.reserve({ ...me, service: svc, units: 1 })).allowed, false, `${plan} ${svc} + 1`);
      }
    }
  });

  await test('a period is 30 days with no weekly reset: usage from 8 days ago still counts', async () => {
    const id = await makeUser();
    const { period } = await ledger.grantPaidPeriod({ adminId: id, plan: 'silver', paymentRef: `test:week:${id}` });
    assert.strictEqual(Math.round((new Date(period.ends_at) - new Date(period.starts_at)) / 864e5), 30);
    await pool.query(
      `INSERT INTO tariff_usage (admin_id, endpoint, credits, service, status, period_id, subject, ts)
       VALUES ($1, '/api/legal-chat', 149, 'chat', 'committed', $2, $3, now() - interval '8 days')`, [id, period.id, `a:${id}`]);
    const b = await ledger.balance({ adminId: id });
    assert.strictEqual(b.services.chat.remaining, 1);
  });

  await test('renewal queues after the running period; upgrade starts now and supersedes; downgrade waits; a repeated callback grants once', async () => {
    const id = await makeUser();
    const first = await ledger.grantPaidPeriod({ adminId: id, plan: 'silver', paymentRef: `test:r1:${id}` });
    const renewal = await ledger.grantPaidPeriod({ adminId: id, plan: 'silver', paymentRef: `test:r2:${id}` });
    assert.strictEqual(renewal.change, 'renewal');
    assert.strictEqual(new Date(renewal.period.starts_at).getTime(), new Date(first.period.ends_at).getTime());
    const again = await ledger.grantPaidPeriod({ adminId: id, plan: 'silver', paymentRef: `test:r2:${id}` });
    assert.strictEqual(again.duplicate, true);
    const n = await pool.query(`SELECT count(*)::int AS n FROM tariff_periods WHERE subject = $1`, [`a:${id}`]);
    assert.strictEqual(n.rows[0].n, 2, 'the repeated callback granted nothing');
    const acc = await pool.query(`SELECT tariff_plan, tariff_expires_at FROM admins WHERE id = $1`, [id]);
    assert.strictEqual(acc.rows[0].tariff_plan, 'silver');
    assert.strictEqual(new Date(acc.rows[0].tariff_expires_at).getTime(), new Date(renewal.period.ends_at).getTime(), 'the expiry covers the queued renewal');

    const quote = await ledger.quotePlanChange(id, 'gold');
    assert.strictEqual(quote.change, 'upgrade');
    assert.ok(quote.creditUzs > 0 && quote.dueUzs < 599000, 'the unused days of the running period are credited');
    const up = await ledger.grantPaidPeriod({ adminId: id, plan: 'gold', paymentRef: `test:up:${id}`, amountUzs: quote.dueUzs });
    assert.strictEqual(up.change, 'upgrade');
    const b = await ledger.balance({ adminId: id });
    assert.deepStrictEqual([b.plan, b.services.chat.limit], ['gold', 450]);
    const old = await pool.query(`SELECT status FROM tariff_periods WHERE subject = $1 AND plan = 'silver'`, [`a:${id}`]);
    assert.ok(old.rows.every(r => r.status === 'superseded'), 'the running and queued Silver periods give way');

    const down = await ledger.grantPaidPeriod({ adminId: id, plan: 'silver', paymentRef: `test:down:${id}` });
    assert.strictEqual(down.change, 'downgrade');
    assert.strictEqual(new Date(down.period.starts_at).getTime(), new Date(up.period.ends_at).getTime());
    assert.strictEqual((await ledger.balance({ adminId: id })).plan, 'gold', 'Gold until its period ends');
  });

  await test('parallel jobs from Telegram, web and Workspace draw on one personal limit: exactly 5 of 12 Sinov answers pass', async () => {
    const tg = 800000000 + rnd() % 1e8;
    const id = await makeUser({ telegramUserId: tg });
    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => ledger.reserve({
      adminId: id, telegramUserId: tg, service: 'chat', units: 1,
      channel: ['web', 'telegram', 'workspace'][i % 3], workspaceId: i % 3 === 2 ? '11111111-2222-4333-8444-555555555555' : null,
    })));
    assert.strictEqual(outcomes.filter(r => r.allowed).length, 5);
  });

  await test('reserve is idempotent by job key; commit and release are idempotent; a committed job is never released', async () => {
    const id = await makeUser();
    const key = `job-${id}-${rnd()}`;
    const a = await ledger.reserve({ adminId: id, service: 'chat', units: 1, jobKey: key });
    const b = await ledger.reserve({ adminId: id, service: 'chat', units: 1, jobKey: key });
    assert.deepStrictEqual([a.allowed, b.allowed, b.duplicate], [true, true, true]);
    assert.strictEqual((await ledger.balance({ adminId: id })).services.chat.used, 1, 'one reservation for two calls');
    assert.strictEqual(await ledger.commit(key), true);
    assert.strictEqual(await ledger.commit(key), false);
    assert.strictEqual(await ledger.release(key), false, 'delivered work is not refunded');
    const k2 = `job-${id}-${rnd()}`;
    await ledger.reserve({ adminId: id, service: 'chat', units: 1, jobKey: k2 });
    assert.strictEqual(await ledger.release(k2, 'failed'), true);
    assert.strictEqual(await ledger.release(k2, 'failed'), false);
    assert.strictEqual((await ledger.balance({ adminId: id })).services.chat.used, 1, 'the failed job gave its unit back');
  });

  await test('an abandoned reservation stops counting after its time-to-live', async () => {
    const id = await makeUser();
    const r = await ledger.reserve({ adminId: id, service: 'chat', units: 1 });
    await pool.query(`UPDATE tariff_usage SET ts = now() - interval '${ledger.RESERVATION_TTL_MIN + 1} minutes' WHERE job_key = $1`, [r.jobKey]);
    assert.strictEqual((await ledger.balance({ adminId: id })).services.chat.used, 0);
  });

  await test('a running subscription sold under v1 keeps its rules until it ends; then the account starts on the Sinov', async () => {
    const id = await makeUser({ plan: 'gold', expiresInDays: 10, startedDaysAgo: 20 });
    // the migration adopts it (or the first read does, for a grant written after the migration)
    const u = await tiers.getUserPlan(id);
    assert.deepStrictEqual([u.plan, u.kind, u.rules], ['gold', 'paid', 'legacy_v1']);
    const r = await ledger.reserve({ adminId: id, service: 'chat', units: 1, endpoint: '/api/legal-chat' });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.unlimited, true, 'v1 Gold chat is unlimited under fair-use');
    // expired: no free-forever plan any more
    const old = await makeUser({ plan: 'silver', expiresInDays: -2, startedDaysAgo: 32 });
    const o = await tiers.getUserPlan(old);
    assert.deepStrictEqual([o.plan, o.kind, o.trialAvailable], [null, 'none', true]);
  });

  await test('Telegram: the tariff allowance first, then Stars credits bought earlier, one answer at a time', async () => {
    const tg = 900000000 + rnd() % 1e8;
    const first = await economy.claimTelegramAnswer(tg, { telegramUserId: tg });
    assert.deepStrictEqual([first.allowed, first.source, first.kind], [true, 'tariff', 'trial']);
    const second = await economy.claimTelegramAnswer(tg, { telegramUserId: tg });
    assert.strictEqual(second.pending, true, 'one answer at a time');
    await economy.finalizeAnswerEntitlement(tg, first);
    for (let i = 0; i < 4; i++) {
      const r = await economy.claimTelegramAnswer(tg, { telegramUserId: tg });
      await economy.finalizeAnswerEntitlement(tg, r);
    }
    const out = await economy.claimTelegramAnswer(tg, { telegramUserId: tg });
    assert.strictEqual(out.allowed, false, 'the Sinov is used up');
    await pool.query(`INSERT INTO tg_answer_wallets (chat_id, credits) VALUES ($1, 2) ON CONFLICT (chat_id) DO UPDATE SET credits = 2`, [tg]);
    const paid = await economy.claimTelegramAnswer(tg, { telegramUserId: tg });
    assert.deepStrictEqual([paid.allowed, paid.source], [true, 'paid']);
    await economy.releaseAnswerEntitlement(tg, paid);
    const w = await pool.query(`SELECT credits FROM tg_answer_wallets WHERE chat_id = $1`, [tg]);
    assert.strictEqual(w.rows[0].credits, 2, 'a failed answer gives the Stars credit back');
    const st = await economy.getTelegramAnswerStatus(tg, { telegramUserId: tg });
    assert.deepStrictEqual([st.allowed, st.tariffRemaining, st.paidCredits], [true, 0, 2]);
    await pool.query(`DELETE FROM tg_answer_wallets WHERE chat_id = $1`, [tg]);
    await pool.query(`DELETE FROM tg_answer_reservations WHERE chat_id = $1`, [tg]);
    made.subjects.push(`t:${tg}`);
  });

  await test('a document: units from size; a Sinov document over 1 unit is refused before any unit is taken', async () => {
    // a Sinov user who passed the free-access gate (linked Telegram, channel checked)
    const id = await makeUser({ telegramUserId: 600000000 + rnd() % 1e8 });
    const res = { statusCode: 200, locals: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, on() { return this; } };
    const text = 'Shartnoma bandi. '.repeat(3000); // ~51 000 characters = 2 units
    const r = await tiers.meterDocument({ session: { adminId: id, role: 'user' } }, res, { service: 'analysis', text, endpoint: '/api/analyze' });
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(res.statusCode, 413);
    assert.match(res.body.message, /Hujjat qisqartirilmaydi/u);
    const b = await ledger.balance({ adminId: id });
    assert.ok(b.kind === 'none' || b.services.analysis.used === 0, 'nothing reserved (the Sinov has not even started)');
    const q = await tiers.quoteDocument(id, { service: 'analysis', text: 'Qisqa shartnoma matni. '.repeat(100) });
    assert.deepStrictEqual([q.units, q.fits, q.remaining, q.remainingAfter], [1, true, 1, 0]);
  });

  await test('measured cost per service: a delivered job joined to its AI calls, known and unknown kept apart', async () => {
    const usage = require('../src/ai/usage-ledger');
    const spend = require('../src/rag/llm-spend-log');
    await spend.initSpendLog();
    usage.configure({ write: spend.writeLedgerRow, writeRequest: spend.writeRequestRow });
    const id = await makeUser();
    let reqId;
    await usage.runWithRequest({ service: 'web' }, async (st) => {
      reqId = st.requestId;
      const r = await ledger.reserve({ adminId: id, service: 'chat', units: 1 });
      await usage.record({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', status: 'success', usage: { inTokens: 1e6, outTokens: 0 } });
      await usage.record({ provider: 'voicelab', model: 'voicelab/no-price', endpoint: '/rag/classify-topic', status: 'error', usage: {} });
      await ledger.commit(r.jobKey);
    });
    const row = await pool.query(`SELECT request_id FROM tariff_usage WHERE admin_id = $1 AND service = 'chat'`, [id]);
    assert.strictEqual(row.rows[0].request_id, reqId, 'the job carries its AI request');
    const m = (await ledger.measuredServiceCost({ days: 1 })).find(x => x.service === 'chat');
    assert.ok(m && m.known_usd >= 0.1 - 1e-9, JSON.stringify(m));
    assert.ok(m.unknown_calls >= 1);
    assert.strictEqual(m.complete, false, 'not complete while a call has an unknown cost');
    await pool.query(`DELETE FROM llm_spend_log WHERE request_id = $1`, [reqId]);
    await pool.query(`DELETE FROM ai_requests WHERE request_id = $1`, [reqId]).catch(() => {});
  });

  // cleanup
  try {
    // the Telegram-only subjects these tests created (t:7…, t:8…, t:9… ids)
    const tgSubjects = (await pool.query(
      `SELECT subject FROM tariff_periods WHERE admin_id IS NULL AND subject ~ '^t:[789][0-9]{8}$' AND created_at > now() - interval '1 hour'`)).rows.map(r => r.subject);
    const subjects = [...made.admins.map(a => `a:${a}`), ...made.subjects, ...tgSubjects];
    await pool.query(`DELETE FROM tariff_usage WHERE subject = ANY($1) OR admin_id = ANY($2)
                         OR period_id IN (SELECT id FROM tariff_periods WHERE subject = ANY($1))`, [subjects, made.admins]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made.admins]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
