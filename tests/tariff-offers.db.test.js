'use strict';

/**
 * Individual discount offers and the margin report on a real Postgres
 * (2026-10-05). Needs TEST_DATABASE_URL (throwaway); skips without it,
 * refuses a hosted one; applies migrations/20261004_013 itself.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/tariff-offers.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('tariff offers (db): skipped, TEST_DATABASE_URL not set');
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
const offers = require('../src/rag/tariff-offers');
// the floors assume the Gemini-only OCR route (costed per page); see tests/tariff-offers.test.js
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'assumed-for-this-test';
process.env.OCR_IMAGE_PROVIDER = 'gemini';
process.env.OCR_FALLBACK = 'off';
const pricing = require('../src/rag/tariff-pricing');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/20261004_013_tariff_periods.sql'), 'utf8'));
  await require('../src/rag/llm-spend-log').initSpendLog();
}
async function makeUser(role = 'user', extra = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_starts_at, tariff_expires_at)
     VALUES ($1, 'x', 'Offer Test', $2, $3, $4, $5) RETURNING id`,
    [`of_${Date.now()}_${rnd()}`, role, extra.plan || null, extra.startsAt || null, extra.expiresAt || null]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}

(async () => {
  console.log('tariff offers (db)');
  await ensureSchema();
  const master = await makeUser('master');

  await test('only a master creates an offer (checked in the database, not only by the route)', async () => {
    const user = await makeUser();
    for (const role of ['user', 'lawyer', 'student']) {
      const who = await makeUser(role);
      const out = await offers.createOffer({ createdBy: who, userId: user, plan: 'silver', discountPercent: '4', reason: 'test' });
      assert.deepStrictEqual([out.ok, out.reason], [false, 'master_only'], role);
    }
    const staff = await makeUser('lawyer');
    const notUser = await offers.createOffer({ createdBy: master, userId: staff, plan: 'silver', discountPercent: '4', reason: 'test' });
    assert.strictEqual(notUser.reason, 'not_an_ordinary_user');
  });

  await test('an offer at the minimum price is created; one below it is refused with the largest allowed discount', async () => {
    const user = await makeUser();
    const ok = await offers.createOffer({ createdBy: master, userId: user, plan: 'gold', discountUzs: 30000, reason: 'pilot mijoz', validDays: 5 });
    assert.strictEqual(ok.ok, true);
    assert.deepStrictEqual([ok.offer.status, ok.offer.final_price_uzs, ok.offer.min_price_uzs, ok.offer.list_price_uzs], ['active', 569000, 569000, 599000]);
    assert.ok(ok.offer.cost_model_version && ok.offer.quota_version && ok.offer.cost_estimate.totalCostUzs === 454686);
    const no = await offers.createOffer({ createdBy: master, userId: user, plan: 'gold', discountUzs: 30001, reason: 'pilot mijoz' });
    assert.deepStrictEqual([no.ok, no.reason, no.quote.maxDiscountUzs], [false, 'below_minimum', 30000]);
    // creating an offer activates nothing
    const b = await ledger.balance({ adminId: user });
    assert.notStrictEqual(b.kind, 'paid');
  });

  await test('redeemed with the payment: the offer\'s server price, the full quota, linked to the paymentRef; once only', async () => {
    const user = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: user, plan: 'silver', discountPercent: '4', reason: 'test' });
    // a client-sent amount that is not the offer's price is refused
    await assert.rejects(ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `pay-${offer.id}-x`, offerId: offer.id, amountUzs: 1000 }), /amount_mismatch: due 191040/u);
    const g = await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `pay-${offer.id}`, offerId: offer.id, amountUzs: 191040 });
    assert.deepStrictEqual([g.period.price_uzs, g.period.list_price_uzs, g.period.discount_uzs, g.period.offer_id], [191040, 199000, 7960, offer.id]);
    assert.deepStrictEqual(g.period.limits, ledger.PLAN_CATALOG.silver.quotas, 'a discount does not cut the quota');
    const b = await ledger.balance({ adminId: user });
    assert.strictEqual(b.services.chat.limit, 150);
    const o = (await pool.query('SELECT * FROM tariff_offers WHERE id = $1', [offer.id])).rows[0];
    assert.deepStrictEqual([o.status, o.payment_ref, String(o.period_id)], ['redeemed', `pay-${offer.id}`, String(g.period.id)]);
    // the same payment again: nothing new
    const again = await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `pay-${offer.id}`, offerId: offer.id });
    assert.strictEqual(again.duplicate, true);
    // another payment cannot reuse the offer
    await assert.rejects(ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `pay-${offer.id}-2`, offerId: offer.id }), /offer_redeemed/u);
    // the next renewal is at the catalogue price: the discount does not repeat
    const renewal = await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `pay-${offer.id}-renew` });
    assert.deepStrictEqual([renewal.change, renewal.period.price_uzs, renewal.period.discount_uzs], ['renewal', 199000, 0]);
  });

  await test('parallel redeem with two payments: exactly one wins', async () => {
    const user = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: user, plan: 'silver', discountPercent: '4', reason: 'test' });
    const out = await Promise.allSettled([1, 2, 3].map(i => ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `par-${offer.id}-${i}`, offerId: offer.id })));
    assert.strictEqual(out.filter(r => r.status === 'fulfilled').length, 1);
    const n = await pool.query(`SELECT count(*)::int AS n FROM tariff_periods WHERE offer_id = $1`, [offer.id]);
    assert.strictEqual(n.rows[0].n, 1);
  });

  await test('another user or another plan cannot use the offer; an expired or revoked one cannot be redeemed', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: user, plan: 'gold', discountPercent: '5', reason: 'test' });
    await assert.rejects(ledger.grantPaidPeriod({ adminId: other, plan: 'gold', paymentRef: `w-${offer.id}`, offerId: offer.id }), /offer_for_another_user/u);
    await assert.rejects(ledger.grantPaidPeriod({ adminId: user, plan: 'platinum', paymentRef: `w2-${offer.id}`, offerId: offer.id }), /offer_for_another_plan/u);
    await pool.query(`UPDATE tariff_offers SET created_at = now() - interval '10 days', expires_at = now() - interval '1 minute' WHERE id = $1`, [offer.id]);
    await assert.rejects(ledger.grantPaidPeriod({ adminId: user, plan: 'gold', paymentRef: `w3-${offer.id}`, offerId: offer.id }), /offer_expired/u);
    assert.strictEqual((await pool.query('SELECT status FROM tariff_offers WHERE id = $1', [offer.id])).rows[0].status, 'expired');
    const chk = await offers.checkOffer({ offerId: offer.id });
    assert.deepStrictEqual([chk.ok, chk.reason], [false, 'offer_expired']);
    const second = (await offers.createOffer({ createdBy: master, userId: user, plan: 'gold', discountPercent: '5', reason: 'test' })).offer;
    const rv = await offers.revokeOffer({ offerId: second.id, revokedBy: master, reason: 'xato' });
    assert.strictEqual(rv.ok, true);
    await assert.rejects(ledger.grantPaidPeriod({ adminId: user, plan: 'gold', paymentRef: `w4-${second.id}`, offerId: second.id }), /offer_revoked/u);
  });

  await test('revoking a redeemed offer is refused and never cancels the period it paid for', async () => {
    const user = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: user, plan: 'silver', discountPercent: '4', reason: 'test' });
    const g = await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `rv-${offer.id}`, offerId: offer.id });
    const rv = await offers.revokeOffer({ offerId: offer.id, revokedBy: master, reason: 'kech' });
    assert.deepStrictEqual([rv.ok, rv.reason], [false, 'offer_redeemed']);
    const p = (await pool.query('SELECT status FROM tariff_periods WHERE id = $1', [g.period.id])).rows[0];
    assert.strictEqual(p.status, 'active');
  });

  await test('upgrade with an offer: the unused value of the superseded periods is credited (not cash); economics recorded', async () => {
    const user = await makeUser();
    await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `up-a-${user}` });
    await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `up-b-${user}` }); // a renewal, queued and paid
    const { offer } = await offers.createOffer({ createdBy: master, userId: user, plan: 'platinum', discountUzs: 51000, reason: 'upgrade' });
    const quote = await ledger.quotePlanChange(user, 'platinum', { priceUzs: offer.final_price_uzs });
    // nearly all of the running period plus the whole queued one
    assert.ok(quote.creditUzs >= 396000 && quote.creditUzs <= 398000, String(quote.creditUzs));
    const g = await ledger.grantPaidPeriod({ adminId: user, plan: 'platinum', paymentRef: `up-c-${user}`, offerId: offer.id });
    assert.strictEqual(g.change, 'upgrade');
    assert.strictEqual(g.period.credit_uzs + g.period.price_uzs, offer.final_price_uzs, 'cash + credit = the offer price');
    assert.ok(g.period.credit_uzs <= 398000);
    assert.strictEqual(g.economics.estimatedServiceCostUzs, 757810, 'the new quota is costed in full');
    assert.strictEqual(g.economics.belowCurrentMinimum, false);
  });

  await test('an offer quoted with no payment fee (no provider) is not applied through a provider, under a new fee or a new cost model', async () => {
    const u = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: u, plan: 'silver', discountUzs: 9000, reason: 'fee scope test' });
    assert.deepStrictEqual(offer.cost_estimate.feeScope.providers, ['manual']);
    assert.strictEqual(offer.cost_estimate.measured, false, 'stored as unmeasured');
    // a provider connected: refused, and the offer stays active for a master to re-check
    await assert.rejects(ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `fs-${offer.id}`, provider: 'payme', offerId: offer.id }), /offer_fee_scope_changed/u);
    const viaProvider = await offers.checkOffer({ offerId: offer.id, provider: 'payme' });
    assert.deepStrictEqual([viaProvider.ok, viaProvider.reason], [false, 'offer_fee_scope_changed']);
    // the fee in the model changed (a provider's 2.5%): refused even by hand
    const base = pricing.defaultCostModel();
    process.env.TARIFF_COST_MODEL = JSON.stringify({ ...base, version: base.version, paymentFeeBp: 250 });
    try {
      const chk = await offers.checkOffer({ offerId: offer.id });
      assert.deepStrictEqual([chk.ok, chk.reason], [false, 'offer_fee_scope_changed']);
      await assert.rejects(ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `fs2-${offer.id}`, offerId: offer.id }), /offer_fee_scope_changed/u);
      process.env.TARIFF_COST_MODEL = JSON.stringify({ ...base, version: 'cm-test-revised' });
      await assert.rejects(ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `fs3-${offer.id}`, offerId: offer.id }), /offer_cost_model_changed/u);
    } finally { delete process.env.TARIFF_COST_MODEL; }
    const still = await pool.query('SELECT status FROM tariff_offers WHERE id = $1', [offer.id]);
    assert.strictEqual(still.rows[0].status, 'active', 'nothing was redeemed');
    // under the scope it was quoted in, it works
    const g = await ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `fs4-${offer.id}`, provider: 'manual', offerId: offer.id });
    assert.strictEqual(g.cashUzs, 190000);
  });

  await test('OCR cost unknown (VoiceLab vision route): no new offer, but a grant without an offer, a bought period and its services are untouched', async () => {
    const u = await makeUser();
    const bought = await ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `ocru-a-${u}` });
    const before = (await pool.query('SELECT plan, price_uzs, limits, starts_at, ends_at FROM tariff_periods WHERE id = $1', [bought.period.id])).rows[0];
    const keep = { ...process.env };
    try {
      Object.assign(process.env, { LLM_PROVIDER: 'voicelab', VOICELAB_API_KEY: 'vl', GPT_API_KEY: 'g' });
      delete process.env.OCR_IMAGE_PROVIDER; delete process.env.OCR_FALLBACK; delete process.env.VOICELAB_LANES;
      const refused = await offers.createOffer({ createdBy: master, userId: u, plan: 'gold', discountUzs: 1000, reason: 'ocr unknown' });
      assert.deepStrictEqual([refused.ok, refused.reason], [false, 'unknown_cost_without_reserve']);
      assert.match(refused.message || (refused.quote && refused.quote.message) || '', /OCR xarajati noma'lum/u);
      // an ordinary service still runs on the bought period
      const r = await ledger.reserve({ adminId: u, service: 'chat', units: 1, endpoint: '/api/legal-chat', channel: 'web', actorId: u });
      assert.strictEqual(r.allowed, true);
      await ledger.commit(r.jobKey);
      // a payment without an offer is still granted (a renewal at the catalogue price)
      const renewal = await ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `ocru-b-${u}` });
      assert.deepStrictEqual([renewal.cashUzs, renewal.duplicate], [199000, false]);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
    const after = (await pool.query('SELECT plan, price_uzs, limits, starts_at, ends_at FROM tariff_periods WHERE id = $1', [bought.period.id])).rows[0];
    assert.deepStrictEqual(after, before, 'the bought period is not changed');
  });

  await test('feature flag TARIFF_OFFERS=off: no new offer, no redemption; a period already bought is untouched', async () => {
    const u = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: u, plan: 'silver', discountUzs: 9000, reason: 'flag test' });
    process.env.TARIFF_OFFERS = 'off';
    try {
      assert.strictEqual((await offers.createOffer({ createdBy: master, userId: u, plan: 'gold', discountUzs: 30000, reason: 'flag test' })).reason, 'offers_disabled');
      assert.strictEqual((await offers.quoteOffer({ userId: u, plan: 'gold', discountUzs: 30000 })).reason, 'offers_disabled');
      await assert.rejects(ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `ff-${offer.id}`, offerId: offer.id }), /offers_disabled/u);
      const plain = await ledger.grantPaidPeriod({ adminId: u, plan: 'silver', paymentRef: `ff-plain-${u}` });
      assert.strictEqual(plain.cashUzs, 199000, 'a grant without an offer still works, at the catalogue price');
    } finally { delete process.env.TARIFF_OFFERS; }
  });

  await test('the margin report counts the actual sale price: discount and credit apart, legacy unknown, never the catalogue', async () => {
    const disc = await makeUser();
    const { offer } = await offers.createOffer({ createdBy: master, userId: disc, plan: 'gold', discountUzs: 30000, reason: 'test' });
    await ledger.grantPaidPeriod({ adminId: disc, plan: 'gold', paymentRef: `mr-${offer.id}`, offerId: offer.id, now: new Date(Date.now() - 15 * 864e5) });
    const legacy = await makeUser('user', { plan: 'gold', startsAt: new Date(Date.now() - 10 * 864e5), expiresAt: new Date(Date.now() + 20 * 864e5) });
    await tiers.getUserPlan(legacy); // adopts the legacy grant (price not recorded)
    const r = await tiers.marginReport({});
    const d = r.rows.find(x => x.adminId === disc);
    assert.strictEqual(d.cashReceivedUzs, 569000, 'the discounted price, not 599 000');
    assert.strictEqual(d.listPriceUzs, 599000);
    assert.strictEqual(d.discountUzs, 30000);
    assert.ok(Math.abs(d.recognizedRevenueUzs - 284500) <= 1000, `half the period recognised: ${d.recognizedRevenueUzs}`);
    assert.strictEqual(d.recognizedRevenueUzs + d.deferredRevenueUzs, 569000);
    const l = r.rows.find(x => x.adminId === legacy);
    assert.deepStrictEqual([l.revenueKnown, l.cashReceivedUzs, l.recognizedRevenueUzs, l.margin], [false, 0, 0, null], 'legacy revenue is unknown, not the catalogue price');
    assert.ok(l.unknownRevenueListUzs > 0 && l.unknownRevenueListUzs <= 399000, 'the v1 list price only as a reference');
    assert.deepStrictEqual([r.totals.refundsUzs, r.totals.refundsStatus], [null, 'not_tracked'], 'refunds are unknown, not a confirmed 0');
  });

  await test('chat with a document: a question costs 1 chat unit; an analysis is confirmed first and costs analysis units only', async () => {
    const r = await pool.query(
      `INSERT INTO admins (username, password, full_name, role, telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since)
       VALUES ($1, 'x', 'Doc Chat', 'user', $2, now(), now(), now()) RETURNING id`, [`dc_${Date.now()}_${rnd()}`, 500000000 + rnd() % 1e8]);
    const user = r.rows[0].id;
    made.push(user);
    await ledger.grantPaidPeriod({ adminId: user, plan: 'silver', paymentRef: `dc-${user}` });
    const mw = tiers.enforceChatQuota('/api/legal-chat');
    const res = () => { const l = {}; return { statusCode: 200, locals: {}, headersSent: false, writableFinished: false, listeners: l,
      status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; this.writableFinished = true; if (l.finish) l.finish(); return this; }, on(e, f) { l[e] = f; return this; } }; };
    const doc = 'Shartnoma bandi matni. '.repeat(2500); // ~57 500 chars -> 2 units
    const run = async (body) => { const out = res(); let next = false; await mw({ session: { adminId: user, role: 'user' }, body, params: {} }, out, () => { next = true; }); return { out, next }; };

    const q = await run({ message: '7-band qonuniymi?', documentText: doc });
    assert.ok(q.next);
    q.out.json({ reply: 'ok' });
    const ask = await run({ message: 'Ushbu hujjatni tahlil qiling', documentText: doc });
    assert.deepStrictEqual([ask.next, ask.out.statusCode, ask.out.body.code, ask.out.body.quote.units], [false, 409, 'DOC_COST_CONFIRM', 2]);
    const wrong = await run({ message: 'Ushbu hujjatni tahlil qiling', documentText: doc, confirmedUnits: 1 });
    assert.strictEqual(wrong.out.statusCode, 409, 'a confirmation for other units is not accepted');
    const go = await run({ message: 'Ushbu hujjatni tahlil qiling', documentText: doc, confirmedUnits: 2 });
    assert.ok(go.next);
    go.out.json({ reply: 'ok' });
    await new Promise(r2 => setTimeout(r2, 50));
    const b = await ledger.balance({ adminId: user });
    assert.deepStrictEqual([b.services.chat.used, b.services.analysis.used], [1, 2], 'one chat for the question, two analysis units for the analysis, nothing else');
  });

  // cleanup
  try {
    await pool.query(`DELETE FROM tariff_offers WHERE user_id = ANY($1)`, [made]);
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR period_id IN (SELECT id FROM tariff_periods WHERE subject = ANY($2))`, [made, subjects]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
