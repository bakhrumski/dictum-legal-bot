'use strict';

/**
 * Test entitlement for the pilot through the running server and Postgres
 * (2026-10-06): the master grants it over HTTP, an ordinary user cannot,
 * the test account sees its quotas, a repeat adds nothing, the master sees
 * the budget standing, ending it returns the account to what it was. No
 * payment and no AI call.
 *
 *   BASE_URL=http://localhost:3300 TEST_DATABASE_URL=postgresql://... PGSSL=disable node tests/test-entitlement.e2e.test.js
 */

const assert = require('assert');

const BASE = process.env.BASE_URL;
if (!BASE || !process.env.TEST_DATABASE_URL) {
  console.log('test entitlement (e2e): skipped, BASE_URL and TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\.|juristai\.uz/i.test(process.env.TEST_DATABASE_URL + BASE)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const bcrypt = require('bcryptjs');
const { pool } = require('../src/database/db');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const tag = `te${Date.now().toString(36)}`;
const made = [];
async function account(role) {
  const username = `${tag}_${role}_${made.length}`;
  const password = `Pw-${tag}-${made.length}-x9!`;
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, $2, $3, $4, now(), now(), now()) RETURNING id`, [username, await bcrypt.hash(password, 10), `E2E ${role}`, role]);
  made.push(r.rows[0].id);
  return { id: r.rows[0].id, username, password };
}
async function login({ username, password }) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.strictEqual(r.status, 200);
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ');
  return (path, { method = 'GET', body = null } = {}) => fetch(`${BASE}${path}`, {
    method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }).then(async res => ({ status: res.status, body: await res.json().catch(() => ({})) }));
}

(async () => {
  console.log('test entitlement (e2e, real server)');
  const masterAcc = await account('master');
  const pilotAcc = await account('user');
  const M = await login(masterAcc);
  const P = await login(pilotAcc);

  await test('an ordinary user cannot grant, list or end test entitlements', async () => {
    for (const [path, method, body] of [
      ['/api/admin/tariff/test-entitlements', 'POST', { userId: pilotAcc.id, reason: 'self' }],
      ['/api/admin/tariff/test-entitlements', 'GET'],
      [`/api/admin/tariff/test-entitlements/${pilotAcc.id}/end`, 'POST', {}],
    ]) {
      const r = await P(path, { method, body });
      assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`);
    }
  });

  await test('master grants: pilot quotas, $5 budget, the production per-request limit; no payment, no plan written', async () => {
    const before = (await P('/api/tariff/me')).body;
    const g = await M('/api/admin/tariff/test-entitlements', { method: 'POST', body: { userId: pilotAcc.id, reason: 'Pilot 2026-10: tahlil/xulosa/draft o\'lchovi', hours: 48, plan: 'gold' } });
    assert.strictEqual(g.status, 200, JSON.stringify(g.body));
    const p = g.body.period;
    assert.deepStrictEqual([p.source, p.price_uzs, p.payment_ref, p.economics.budgetUsd, p.economics.perRequestUsd], ['test', null, null, 5, null]);
    const me = (await P('/api/tariff/me')).body;
    assert.deepStrictEqual([me.kind, me.balance.kind, me.balance.services.analysis.limit, me.balance.services.opinion.limit], ['test', 'test', 8, 6]);
    const a = (await pool.query('SELECT tariff_plan FROM admins WHERE id = $1', [pilotAcc.id])).rows[0];
    assert.strictEqual(a.tariff_plan, null);
    assert.notStrictEqual(before.kind, 'test');
  });

  await test('a repeat adds nothing; the master sees the budget standing (spent / held)', async () => {
    const again = await M('/api/admin/tariff/test-entitlements', { method: 'POST', body: { userId: pilotAcc.id, reason: 'again', quotas: { analysis: 100 } } });
    assert.deepStrictEqual([again.status, again.body.duplicate], [200, true]);
    assert.strictEqual((await P('/api/tariff/me')).body.balance.services.analysis.limit, 8);
    const list = await M('/api/admin/tariff/test-entitlements');
    const row = list.body.entitlements.find(x => x.admin_id === pilotAcc.id && x.status === 'active');
    assert.deepStrictEqual([row.budget.budgetUsd, row.budget.spent, row.budget.held, row.budget.unknownCallUsd], [5, 0, 0, 0.05]);
    const m = await M('/api/admin/margin-report');
    assert.ok(!m.body.rows.some(r => r.adminId === pilotAcc.id), 'no revenue row for a test account');
    assert.ok(m.body.totals.testEntitlements, 'test spend has its own total');
  });

  await test('ending it returns the account to what it was', async () => {
    const e = await M(`/api/admin/tariff/test-entitlements/${pilotAcc.id}/end`, { method: 'POST', body: {} });
    assert.strictEqual(e.status, 200);
    const me = (await P('/api/tariff/me')).body;
    assert.deepStrictEqual([me.balance.kind, me.balance.trialAvailable], ['none', true]);
  });

  try {
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM test_budget_holds WHERE period_id IN (SELECT id FROM tariff_periods WHERE subject = ANY($1))`, [subjects]);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
