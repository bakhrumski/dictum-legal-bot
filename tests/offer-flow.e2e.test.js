'use strict';

/**
 * Individual discount, end to end through the real server and Postgres
 * (tariffs v2 review, 2026-10-06): a master quotes, creates and checks an
 * offer; an ordinary user is refused every admin endpoint; the offer
 * activates nothing until the master grants it with a paymentRef; the user
 * then sees the full plan quota; a repeat or a reuse grants nothing. No
 * external payment and no AI call.
 *
 * Needs a running server (BASE_URL) and its database (TEST_DATABASE_URL,
 * throwaway, the same one the server uses). Accounts are created here with
 * real passwords and log in through /api/login.
 *
 *   BASE_URL=http://localhost:3300 TEST_DATABASE_URL=postgresql://... PGSSL=disable node tests/offer-flow.e2e.test.js
 */

const assert = require('assert');

const BASE = process.env.BASE_URL;
if (!BASE || !process.env.TEST_DATABASE_URL) {
  console.log('offer flow (e2e): skipped, BASE_URL and TEST_DATABASE_URL not set');
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
const tag = `e2e${Date.now().toString(36)}`;
const made = [];

async function account(role) {
  const username = `${tag}_${role}_${made.length}`;
  const password = `Pw-${tag}-${made.length}-x9!`;
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, $2, $3, $4, now(), now(), now()) RETURNING id`,
    [username, await bcrypt.hash(password, 10), `E2E ${role}`, role]);
  made.push(r.rows[0].id);
  return { id: r.rows[0].id, username, password };
}
async function login({ username, password }) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const body = await r.json();
  assert.strictEqual(r.status, 200, JSON.stringify(body));
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ');
  return (path, { method = 'GET', body = null } = {}) => fetch(`${BASE}${path}`, {
    method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }).then(async res => ({ status: res.status, body: await res.json().catch(() => ({})) }));
}

(async () => {
  console.log('offer flow (e2e, real server)');
  const masterAcc = await account('master');
  const userAcc = await account('user');
  const otherAcc = await account('user');
  const M = await login(masterAcc);
  const U = await login(userAcc);
  let offer = null;

  await test('an ordinary user is refused every admin endpoint of offers, grants and finance', async () => {
    const calls = [
      ['/api/admin/tariff/offers/quote', 'POST', { userId: userAcc.id, plan: 'gold', discountPercent: '20' }],
      ['/api/admin/tariff/offers', 'POST', { userId: userAcc.id, plan: 'gold', discountPercent: '20', reason: 'self' }],
      ['/api/admin/tariff/offers', 'GET'],
      ['/api/admin/tariff/offers/00000000-0000-4000-8000-000000000000/check', 'GET'],
      ['/api/admin/tariff/offers/00000000-0000-4000-8000-000000000000/revoke', 'POST', { reason: 'x' }],
      ['/api/admin/tariff/users?q=e2e', 'GET'],
      ['/api/admin/tariff/grant', 'POST', { adminId: userAcc.id, plan: 'gold', paymentRef: 'self-grant-1' }],
      ['/api/admin/margin-report', 'GET'],
    ];
    for (const [path, method, body] of calls) {
      const r = await U(path, { method, body });
      assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`);
    }
    const anon = await fetch(`${BASE}/api/admin/tariff/offers`).then(r => r.status);
    assert.ok([401, 403].includes(anon));
    const me = await U('/api/tariff/me');
    assert.notStrictEqual(me.body.balance.plan, 'gold', 'nothing was granted by trying');
  });

  await test('master: find the user, quote - over the floor refused with the largest discount, within it accepted', async () => {
    const found = await M(`/api/admin/tariff/users?q=${encodeURIComponent(userAcc.username)}`);
    assert.strictEqual(found.status, 200);
    assert.ok(found.body.users.some(u => u.id === userAcc.id));
    const no = await M('/api/admin/tariff/offers/quote', { method: 'POST', body: { userId: userAcc.id, plan: 'gold', discountPercent: '30' } });
    assert.deepStrictEqual([no.body.ok, no.body.reason, no.body.minPriceUzs, no.body.maxDiscountUzs], [false, 'below_minimum', 450000, 149000]);
    assert.match(no.body.message, /Eng katta ruxsat etilgan chegirma: 149 000 so'm/u);
    const ok = await M('/api/admin/tariff/offers/quote', { method: 'POST', body: { userId: userAcc.id, plan: 'gold', discountPercent: '20' } });
    assert.deepStrictEqual([ok.body.ok, ok.body.finalPriceUzs, ok.body.discountUzs, ok.body.costMeasured, ok.body.feeScope.providers], [true, 479200, 119800, false, ['manual']]);
  });

  await test('master: create the offer - a price sent by the client is ignored; nothing is activated', async () => {
    const r = await M('/api/admin/tariff/offers', { method: 'POST', body: { userId: userAcc.id, plan: 'gold', discountPercent: '20', reason: 'e2e pilot mijoz', validDays: 7, finalPriceUzs: 1000, final_price_uzs: 1000 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    offer = r.body.offer;
    assert.deepStrictEqual([offer.status, offer.final_price_uzs, offer.list_price_uzs, offer.discount_uzs], ['active', 479200, 599000, 119800]);
    const chk = await M(`/api/admin/tariff/offers/${offer.id}/check`);
    assert.deepStrictEqual([chk.body.ok, chk.body.stale], [true, false]);
    const viaProvider = await M(`/api/admin/tariff/offers/${offer.id}/check?provider=payme`);
    assert.deepStrictEqual([viaProvider.body.ok, viaProvider.body.reason], [false, 'offer_fee_scope_changed']);
    const me = await U('/api/tariff/me');
    assert.notStrictEqual(me.body.balance.plan, 'gold', 'an offer activates nothing');
  });

  await test('master: activation needs the right amount and user; then the full Gold quota; a repeat or reuse grants nothing', async () => {
    const wrongAmount = await M('/api/admin/tariff/grant', { method: 'POST', body: { adminId: userAcc.id, plan: 'gold', paymentRef: `${tag}-pay-1`, amountUzs: 100, offerId: offer.id } });
    assert.deepStrictEqual([wrongAmount.status, wrongAmount.body.error], [400, 'amount_mismatch: due 479200']);
    const wrongUser = await M('/api/admin/tariff/grant', { method: 'POST', body: { adminId: otherAcc.id, plan: 'gold', paymentRef: `${tag}-pay-2`, offerId: offer.id } });
    assert.deepStrictEqual([wrongUser.status, wrongUser.body.error], [400, 'offer_for_another_user']);
    const g = await M('/api/admin/tariff/grant', { method: 'POST', body: { adminId: userAcc.id, plan: 'gold', paymentRef: `${tag}-pay-1`, amountUzs: 479200, offerId: offer.id } });
    assert.strictEqual(g.status, 200, JSON.stringify(g.body));
    assert.deepStrictEqual([g.body.cashUzs, g.body.creditUzs, g.body.duplicate], [479200, 0, false]);
    const again = await M('/api/admin/tariff/grant', { method: 'POST', body: { adminId: userAcc.id, plan: 'gold', paymentRef: `${tag}-pay-1`, offerId: offer.id } });
    assert.deepStrictEqual([again.status, again.body.duplicate], [200, true], 'the same payment grants nothing more');
    const reuse = await M('/api/admin/tariff/grant', { method: 'POST', body: { adminId: userAcc.id, plan: 'gold', paymentRef: `${tag}-pay-3`, offerId: offer.id } });
    assert.deepStrictEqual([reuse.status, reuse.body.error], [400, 'offer_redeemed']);
    assert.match(reuse.body.message, /allaqachon ishlatilgan/u);

    const me = await U('/api/tariff/me');
    const b = me.body.balance;
    assert.deepStrictEqual([b.plan, b.services.chat.limit, b.services.analysis.limit, b.services.opinion.limit, b.services.draft.limit], ['gold', 450, 24, 24, 30],
      'the discount does not reduce the quota');
    assert.strictEqual(b.services.chat.used, 0);
  });

  await test('master: the offer is redeemed with its payment and period; the finance report shows the actual sale', async () => {
    const list = await M(`/api/admin/tariff/offers`);
    const o = list.body.offers.find(x => x.id === offer.id);
    assert.deepStrictEqual([o.status, o.payment_ref, !!o.period_id], ['redeemed', `manual:${tag}-pay-1`, true]);
    const m = await M('/api/admin/margin-report');
    const row = m.body.rows.find(r => r.adminId === userAcc.id);
    assert.deepStrictEqual([row.cashReceivedUzs, row.listPriceUzs, row.discountUzs], [479200, 599000, 119800]);
    assert.deepStrictEqual([m.body.totals.refundsUzs, m.body.totals.refundsStatus], [null, 'not_tracked']);
    const revoke = await M(`/api/admin/tariff/offers/${offer.id}/revoke`, { method: 'POST', body: { reason: 'late' } });
    assert.strictEqual(revoke.status >= 400, true, 'a redeemed offer cannot be revoked');
    const me = await U('/api/tariff/me');
    assert.strictEqual(me.body.balance.plan, 'gold', 'and the period stays');
  });

  try {
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM tariff_offers WHERE user_id = ANY($1)`, [made]);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM audit_log WHERE actor_id = ANY($1)`, [made]).catch(() => {});
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
