'use strict';

/**
 * CustDev pilot, stage 2 (2026-10-28, migration 024, src/sales/): agent
 * codes are a master's to give; an offer link records the FIRST agent and an
 * unknown code changes nothing; a master approves a pilot with one button
 * (the 14-day pilot entitlement); an agent sees only their own clients and
 * no text, and cannot grant anything; a demo account's use is counted apart;
 * /start ref_ leaves the other start prefixes alone. Needs TEST_DATABASE_URL
 * (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/sales-agents.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
if (!process.env.TEST_DATABASE_URL) {
  console.log('sales agents (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const express = require('express');
const { pool } = require('../src/database/db');
const ledger = require('../src/rag/tariff-ledger');
const sales = require('../src/sales/agents');
const { mountSalesRoutes, refCookieMiddleware } = require('../src/sales/routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user', extra = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id, created_by_master_id)
     VALUES ($1, 'x', $2, $3, $4, $5) RETURNING id`,
    [`sa_${Date.now()}_${rnd()}`, extra.name || 'Sinov Mijoz', role, extra.tg || null, extra.byMaster || null]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}

(async () => {
  console.log('sales agents (db)');
  const master = await makeUser('master');
  const agentA = await makeUser('student', { name: 'Agent A' });
  const agentB = await makeUser('student', { name: 'Agent B' });

  let codeA, codeB;
  await test('a code is a master\'s to give, only to a staff account, random and unique', async () => {
    assert.strictEqual((await sales.assignCode(pool, { masterId: agentA, agentId: agentA })).error, 'master_only');
    const client = await makeUser();
    assert.strictEqual((await sales.assignCode(pool, { masterId: master, agentId: client })).error, 'not_staff');
    codeA = (await sales.assignCode(pool, { masterId: master, agentId: agentA })).code;
    codeB = (await sales.assignCode(pool, { masterId: master, agentId: agentB })).code;
    assert.match(codeA, /^[a-z0-9]{12}$/u);
    assert.notStrictEqual(codeA, codeB);
    assert.strictEqual(await sales.agentByCode(pool, codeA), agentA);
    assert.strictEqual(await sales.agentByCode(pool, 'nosuchcode12'), null);
  });

  let c1, c2;
  await test('registration: the cookie\'s agent is recorded once - the first agent stays; an unknown code changes nothing', async () => {
    c1 = await makeUser();
    assert.strictEqual(await sales.claimAtRegistration(pool, { adminId: c1, refCode: codeA }), true);
    assert.strictEqual(await sales.claimAtRegistration(pool, { adminId: c1, refCode: codeB }), false, 'not replaced');
    assert.strictEqual((await pool.query('SELECT referred_by_agent_id FROM admins WHERE id = $1', [c1])).rows[0].referred_by_agent_id, agentA);
    const stray = await makeUser();
    assert.strictEqual(await sales.claimAtRegistration(pool, { adminId: stray, refCode: 'zzzzzzzzzzzz' }), false);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM pilot_requests WHERE admin_id = $1', [stray])).rows[0].n, 0);
  });

  await test('Telegram: ref_ before an account is kept (first agent) and claimed when the account is made; with an account, attached at once', async () => {
    const tg = 900000000 + rnd() % 1e8;
    await sales.rememberTelegramRef(pool, { telegramUserId: tg, code: codeB });
    await sales.rememberTelegramRef(pool, { telegramUserId: tg, code: codeA });
    c2 = await makeUser('user', { tg });
    assert.strictEqual(await sales.claimAtRegistration(pool, { adminId: c2, telegramUserId: tg }), true);
    assert.strictEqual((await pool.query('SELECT referred_by_agent_id, referral_channel FROM admins WHERE id = $1', [c2])).rows[0].referred_by_agent_id, agentB);
    const tg2 = 900000000 + rnd() % 1e8;
    const c3 = await makeUser('user', { tg: tg2 });
    const r = await sales.rememberTelegramRef(pool, { telegramUserId: tg2, code: codeA });
    assert.deepStrictEqual([r.known, r.hasAccount], [true, true]);
    assert.strictEqual((await pool.query('SELECT status FROM pilot_requests WHERE admin_id = $1', [c3])).rows[0].status, 'pending');
    assert.deepStrictEqual(await sales.rememberTelegramRef(pool, { telegramUserId: tg2, code: 'bad' }), { known: false });
  });

  await test('one button: the master approves - the 14-day pilot entitlement with the pilot quotas; twice is refused; an agent cannot', async () => {
    const q = (await pool.query('SELECT id FROM pilot_requests WHERE admin_id = $1', [c1])).rows[0];
    assert.strictEqual((await sales.approve(pool, { masterId: agentA, requestId: q.id, ledger })).error, 'master_only');
    const ok = await sales.approve(pool, { masterId: master, requestId: q.id, ledger });
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.strictEqual(new Date(ok.period.ends_at) - new Date(ok.period.starts_at), 336 * 3600e3);
    assert.deepStrictEqual(ok.period.limits, { chat: 120, analysis: 8, opinion: 4, draft: 6, ocr: 20 });
    assert.strictEqual(Number(ok.period.economics.budgetUsd), 10);
    assert.strictEqual((await sales.approve(pool, { masterId: master, requestId: q.id, ledger })).error, 'already_decided');
  });

  await test('an agent sees only their own clients, with no question or answer text; units used are counted', async () => {
    const r = await ledger.reserve({ adminId: c1, service: 'chat', units: 2, endpoint: '/api/legal-chat' });
    await ledger.commit(r.jobKey);
    const a = await sales.agentPage(pool, { agentId: agentA, botUsername: 'testbot', appUrl: 'https://juristai.uz' });
    assert.ok(a.clients.some(c => c.id === c1) && !a.clients.some(c => c.id === c2), "agent B's client is not on agent A's list");
    const row = a.clients.find(c => c.id === c1);
    assert.deepStrictEqual([row.pilot_status, row.units_used], ['approved', 2]);
    assert.deepStrictEqual(Object.keys(row).sort(), ['decided_at', 'full_name', 'id', 'paid', 'pilot_ends_at', 'pilot_status', 'referral_channel', 'registered_at', 'units_used']);
    assert.deepStrictEqual(a.links, { web: `https://juristai.uz/?ref=${codeA}`, telegram: `https://t.me/testbot?start=ref_${codeA}` });
    assert.strictEqual(await sales.agentPage(pool, { agentId: c1, botUsername: 'x', appUrl: 'y' }), null, 'a client has no agent page');
  });

  await test('demo: a master-made test account linked to an agent, with the pilot entitlement; its use is counted apart from clients', async () => {
    const plain = await makeUser();
    assert.strictEqual((await sales.linkDemo(pool, { masterId: master, agentId: agentA, userId: plain, ledger })).error, 'not_a_test_user');
    const demo = await makeUser('user', { byMaster: master });
    const d = await sales.linkDemo(pool, { masterId: master, agentId: agentA, userId: demo, ledger });
    assert.ok(d.ok, JSON.stringify(d));
    const r = await ledger.reserve({ adminId: demo, service: 'chat', units: 3, endpoint: '/api/legal-chat' });
    await ledger.commit(r.jobKey);
    const ov = (await sales.agentsOverview(pool)).find(x => x.id === agentA);
    assert.deepStrictEqual([ov.registered, ov.piloted, ov.demo_units, ov.demo_id], [2, 1, 3, demo]);
    assert.strictEqual(await sales.claimAtRegistration(pool, { adminId: demo, refCode: codeB }), false, 'a demo account never becomes a client');
  });

  await test('HTTP: master routes refuse an agent session; the ?ref cookie keeps the first link; an agent gets only /api/sales/me', async () => {
    const app = express();
    app.use(express.json());
    let as = { adminId: agentA, role: 'student' };
    app.use((req, _r, next) => { req.session = { isAuthenticated: true, ...as }; next(); });
    app.use(refCookieMiddleware);
    app.get('/', (q, r) => r.send('ok'));
    const pass = (_q, _r, n) => n();
    const requireMasterAdmin = (q, r, n) => (q.session.role === 'master' ? n() : r.status(403).json({ error: 'Master admin access required' }));
    mountSalesRoutes(app, { pool, requireAuth: pass, requireMasterAdmin, requireSameOrigin: pass, ledger, botUsername: 'testbot', appUrl: 'https://juristai.uz' });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const q = (await pool.query(`SELECT id FROM pilot_requests WHERE admin_id = $1`, [c2])).rows[0];
      assert.strictEqual((await fetch(`${base}/api/admin/sales/pilot-requests/${q.id}/approve`, { method: 'POST' })).status, 403);
      assert.strictEqual((await fetch(`${base}/api/admin/sales/agents/${agentA}/code`, { method: 'POST' })).status, 403);
      assert.strictEqual((await fetch(`${base}/api/admin/sales/agents`)).status, 403);
      const mine = await (await fetch(`${base}/api/sales/me`)).json();
      assert.strictEqual(mine.code, codeA);
      const r1 = await fetch(`${base}/?ref=${codeA}`);
      assert.match(r1.headers.get('set-cookie') || '', new RegExp(`jai_ref=${codeA};.*HttpOnly`, 'u'));
      const r2 = await fetch(`${base}/?ref=${codeB}`, { headers: { cookie: `jai_ref=${codeA}` } });
      assert.strictEqual(r2.headers.get('set-cookie'), null, 'the first link stays');
      const r3 = await fetch(`${base}/?ref=<script>`);
      assert.strictEqual(r3.headers.get('set-cookie'), null, 'not a code: no cookie');
      as = { adminId: master, role: 'master' };
      assert.strictEqual((await fetch(`${base}/api/admin/sales/agents`)).status, 200);
    } finally { server.close(); }
  });

  await test('/start: ref_ is its own prefix; verify_, plink_, login_, reg_, recover_, stepup_ still go where they went', () => {
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /if \(\/\^ref_\/\.test\(param\)\) \{/u);
    assert.match(bot, /if \(\/\^\(login_\|reg_\|recover_\|legacy_recover_\|stepup_\)\/\.test\(param\)\) \{/u, 'the auth prefixes still go to the auth bot');
    for (const p of ['verify_x', 'plink_x', 'login_x', 'reg_x', 'recover_x', 'stepup_x']) assert.ok(!/^ref_/.test(p), p);
    assert.match(bot, /if \(!param && !fromRefLink && LEGAL_BOT_AUTH_FALLBACK_ENABLED\)/u, 'a ref link never triggers the bare-start sign-in fallback');
  });

  for (const id of made) {
    await pool.query('DELETE FROM pilot_requests WHERE admin_id = $1 OR agent_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM referral_pending WHERE agent_id = $1', [id]).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})();
