'use strict';

/**
 * One-time services (2026-10-21): the catalogue and its prices, the signed
 * Stars invoice, units bought one at a time in the tariff ledger (used after
 * the plan's own, idempotent by payment, released on failure), the bot's sale
 * flow, the offers after an answer and when the Sinov is spent, and the
 * lawyer's price split. In-memory database and bot - no network, no AI.
 *
 *   node tests/one-time-services.test.js
 */

const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ── an in-memory ledger database: one Telegram-only Sinov user ──────────────
const db = { usage: [], credits: [], trial: { id: 1, subject: 't:77', plan: 'sinov', source: 'trial', starts_at: new Date(),
  limits: { chat: 5, analysis: 1, opinion: 1, draft: 0, ocr: 10 } } };
const live = (u) => u.status !== 'released';
async function q(sql, p = []) {
  if (/^(BEGIN|COMMIT|ROLLBACK)$|pg_advisory_xact_lock/.test(sql)) return { rows: [] };
  if (/SELECT \* FROM tariff_usage WHERE job_key/.test(sql)) return { rows: db.usage.filter(u => u.job_key === p[0]) };
  if (/FROM tariff_periods WHERE subject = ANY\(\$1\) AND source = 'trial'/.test(sql)) return { rows: p[0].includes(db.trial.subject) ? [db.trial] : [] };
  if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
  if (/FROM service_credits\s+WHERE subject = ANY/.test(sql)) {
    const [subjects, service] = p;
    const bought = db.credits.filter(c => subjects.includes(c.subject) && c.service === service && !c.refunded_at).reduce((s, c) => s + c.units, 0);
    const used = db.usage.filter(u => subjects.includes(u.subject) && u.service === service && u.period_id === null && live(u)).reduce((s, u) => s + u.credits, 0);
    return { rows: [{ bought, used }] };
  }
  if (/SUM\(COALESCE\(u\.credits, 1\)\)/.test(sql) && /period_id = ANY/.test(sql)) {
    const [ids, service] = p;
    return { rows: [{ n: db.usage.filter(u => ids.includes(u.period_id) && u.service === service && live(u)).reduce((s, u) => s + u.credits, 0) }] };
  }
  if (/INSERT INTO tariff_usage/.test(sql)) {
    if (/'reserved', NULL/.test(sql)) db.usage.push({ service: p[3], credits: p[2], subject: p[4], job_key: p[5], period_id: null, status: 'reserved', meta: JSON.parse(p[9]) });
    else db.usage.push({ service: p[3], credits: p[2], period_id: p[4], subject: p[5], job_key: p[6], status: 'reserved' });
    return { rows: [] };
  }
  if (/INSERT INTO service_credits/.test(sql)) {
    if (db.credits.some(c => c.payment_ref === p[9])) return { rows: [] };
    const row = { id: db.credits.length + 1, subject: p[0], service: p[3], units: p[4], product: p[5], price_uzs: p[6], stars: p[7], provider: p[8], payment_ref: p[9] };
    db.credits.push(row); return { rows: [row] };
  }
  if (/SELECT \* FROM service_credits WHERE payment_ref/.test(sql)) return { rows: db.credits.filter(c => c.payment_ref === p[0]) };
  if (/UPDATE tariff_usage SET status = 'committed'/.test(sql)) { const u = db.usage.find(x => x.job_key === p[0] && x.status === 'reserved'); if (u) u.status = 'committed'; return { rows: u ? [u] : [], rowCount: u ? 1 : 0 }; }
  if (/UPDATE tariff_usage SET status = 'released'/.test(sql) && /WHERE job_key/.test(sql)) { const u = db.usage.find(x => x.job_key === p[0] && x.status === 'reserved'); if (u) u.status = 'released'; return { rows: u ? [u] : [], rowCount: u ? 1 : 0 }; }
  return { rows: [] };
}
const fakePool = { query: q, async connect() { return { query: q, release() {} }; } };
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  return orig.apply(this, arguments);
};
for (const rel of ['../src/rag/tariff-ledger', '../src/rag/one-time-products']) delete require.cache[require.resolve(rel)];
const ledger = require('../src/rag/tariff-ledger');
const products = require('../src/rag/one-time-products');
Module.prototype.require = orig;
const starsInvoice = require('../src/bot/stars-invoice');
const { createOneTimeSales } = require('../src/bot/one-time-sales');
const commission = require('../src/services/lawyer-commission');

(async () => {
  await test("catalogue: the owner's prices; Stars cover the so'm price at the payout rate; every price above cost / 0.80", () => {
    const P = products.PRODUCTS;
    assert.deepStrictEqual([P.chat5.priceUzs, P.draft.priceUzs, P.analysis.priceUzs, P.opinion.priceUzs], [15000, 29000, 39000, 49000]);
    assert.deepStrictEqual([P.chat5.service, P.chat5.units], ['chat', 5]);
    for (const k of Object.keys(P)) {
      const e = products.economics(k);
      assert.ok(e.aboveFloor && e.starsAboveFloor, k);
      assert.ok(e.starsPayoutUzs >= e.priceUzs, `${k}: Stars bring in at least the so'm price`);
      assert.strictEqual(e.stars % 10, 0);
    }
    assert.deepStrictEqual(Object.keys(P).map(k => products.starsFor(k)), [100, 190, 250, 320]);
    process.env.ONE_TIME_STARS_DRAFT = '150';
    assert.strictEqual(products.starsFor('draft'), 150);
    delete process.env.ONE_TIME_STARS_DRAFT;
    assert.strictEqual(products.formatUzs(29000), "29 000 so'm");
  });

  await test('invoice: product, quantity and price are signed; another user, a changed price or a wrong total is refused', () => {
    const payload = starsInvoice.buildServiceInvoicePayload({ telegramUserId: 77, product: 'analysis', qty: 2, stars: 250, secret: 's', nonce: 'abc' });
    assert.ok(payload.length <= 128);
    const offer = starsInvoice.parseServiceInvoicePayload(payload, 77, { secret: 's' });
    assert.deepStrictEqual(offer, { product: 'analysis', qty: 2, stars: 250, total: 500 });
    assert.strictEqual(starsInvoice.parseServiceInvoicePayload(payload, 78, { secret: 's' }), null);
    assert.strictEqual(starsInvoice.parseServiceInvoicePayload(payload.replace(':250:', ':25:'), 77, { secret: 's' }), null);
    assert.ok(starsInvoice.matchesServiceOffer(offer, 'XTR', 500));
    assert.ok(!starsInvoice.matchesServiceOffer(offer, 'XTR', 250));
    assert.ok(!starsInvoice.matchesServiceOffer(offer, 'USD', 500));
  });

  const who = { adminId: null, telegramUserId: 77 };

  await test('ledger: Sinov has no draft; a bought draft unit is used after the plan, once', async () => {
    let r = await ledger.reserve({ ...who, service: 'draft', units: 1, channel: 'telegram' });
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.oneTimeRemaining, 0);
    const g = await ledger.grantOneTimeCredit({ ...who, service: 'draft', units: 1, product: 'draft', priceUzs: 29000, stars: 190, provider: 'telegram_stars', paymentRef: 'tg:c1' });
    assert.strictEqual(g.duplicate, false);
    r = await ledger.reserve({ ...who, service: 'draft', units: 1, channel: 'telegram' });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.oneTime, true);
    assert.strictEqual(r.remaining, 0);
    assert.strictEqual(await ledger.commit(r.jobKey), true);
    r = await ledger.reserve({ ...who, service: 'draft', units: 1, channel: 'telegram' });
    assert.strictEqual(r.allowed, false, 'one bought unit, one draft');
  });

  await test('ledger: a repeated payment notice adds nothing; a failed job gives the unit back', async () => {
    const again = await ledger.grantOneTimeCredit({ ...who, service: 'draft', units: 1, product: 'draft', priceUzs: 29000, stars: 190, provider: 'telegram_stars', paymentRef: 'tg:c1' });
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(db.credits.filter(c => c.payment_ref === 'tg:c1').length, 1);
    await ledger.grantOneTimeCredit({ ...who, service: 'draft', units: 1, product: 'draft', provider: 'telegram_stars', paymentRef: 'tg:c2' });
    const r = await ledger.reserve({ ...who, service: 'draft', units: 1, channel: 'telegram' });
    assert.ok(r.allowed && r.oneTime);
    await ledger.release(r.jobKey, 'failed');
    assert.strictEqual(await ledger.oneTimeRemaining(fakePool, ['t:77'], 'draft'), 1, 'released: still there');
  });

  await test("ledger: the plan's own allowance is used first; bought questions only after it", async () => {
    await ledger.grantOneTimeCredit({ ...who, service: 'chat', units: 5, product: 'chat5', provider: 'telegram_stars', paymentRef: 'tg:c3' });
    const first = await ledger.reserve({ ...who, service: 'chat', units: 1, channel: 'telegram' });
    assert.ok(first.allowed && !first.oneTime, 'Sinov questions first');
    for (let i = 0; i < 4; i++) await ledger.commit((await ledger.reserve({ ...who, service: 'chat', units: 1, channel: 'telegram' })).jobKey);
    await ledger.commit(first.jobKey);
    const sixth = await ledger.reserve({ ...who, service: 'chat', units: 1, channel: 'telegram' });
    assert.ok(sixth.allowed && sixth.oneTime);
    assert.strictEqual(sixth.remaining, 4);
    const b = await ledger.balance(who);
    assert.strictEqual(b.oneTime.chat, 4);
  });

  function salesHarness({ creditFails = false } = {}) {
    const sent = [], invoices = [], refunds = [];
    const bot = {
      sendMessage: async (chat, text, opts) => sent.push({ chat, text, opts }),
      sendInvoice: async (...a) => invoices.push(a),
      answerCallbackQuery: async () => {},
    };
    const fakeLedger = { grants: [],
      grantOneTimeCredit: async (o) => { if (creditFails) throw new Error('db'); fakeLedger.grants.push(o); return { duplicate: fakeLedger.grants.filter(g => g.paymentRef === o.paymentRef).length > 1, credit: {} }; } };
    const sales = createOneTimeSales({ bot, ledger: fakeLedger, identityOf: async () => ({ telegramUserId: 77, adminId: 5 }), secret: 's',
      refundStars: async (uid, charge) => { refunds.push(charge); return true; } });
    return { sales, sent, invoices, refunds, fakeLedger };
  }
  const payMsg = (payload, total, charge = 'ch1') => ({ chat: { id: 77 }, from: { id: 77 },
    successful_payment: { invoice_payload: payload, currency: 'XTR', total_amount: total, telegram_payment_charge_id: charge } });

  await test('bot sale: the button opens a Stars invoice; payment adds the units and runs the job it was bought for', async () => {
    const h = salesHarness();
    assert.deepStrictEqual(h.sales.button('draft'), { text: 'AI hujjat loyihasi — 190 ⭐', callback_data: 'ots_draft_1' });
    assert.strictEqual(await h.sales.onCallback({ id: 'q', data: 'ots_draft_1', from: { id: 77 }, message: { chat: { id: 77 } } }), true);
    const [chat, , , payload, , currency, prices] = h.invoices[0];
    assert.strictEqual(chat, 77);
    assert.strictEqual(currency, 'XTR');
    assert.deepStrictEqual(prices.map(x => x.amount), [190]);
    assert.strictEqual(h.sales.checkPreCheckout({ invoice_payload: payload, from: { id: 77 }, currency: 'XTR', total_amount: 190 }), true);
    assert.strictEqual(h.sales.checkPreCheckout({ invoice_payload: payload, from: { id: 77 }, currency: 'XTR', total_amount: 1 }), false);
    assert.strictEqual(h.sales.checkPreCheckout({ invoice_payload: 'juristai_answers_v2:77:1:4:n:s', from: { id: 77 } }), null, 'not ours');
    let ran = 0;
    h.sales.setResume(77, 'draft', async () => { ran++; });
    assert.strictEqual(await h.sales.onPayment(payMsg(payload, 190)), true);
    assert.deepStrictEqual(h.fakeLedger.grants[0], { adminId: 5, telegramUserId: 77, service: 'draft', units: 1, product: 'draft', priceUzs: 29000, stars: 190, provider: 'telegram_stars', paymentRef: 'tg:ch1' });
    assert.strictEqual(ran, 1);
    assert.match(h.sent.at(-1).text, /To'lov qabul qilindi: AI hujjat loyihasi\. Hozir bajaraman/u);
  });

  await test('bot sale: a repeated notice runs nothing twice; a failed credit or a wrong amount gives the Stars back', async () => {
    const h = salesHarness();
    const payload = starsInvoice.buildServiceInvoicePayload({ telegramUserId: 77, product: 'chat5', qty: 1, stars: 100, secret: 's' });
    await h.sales.onPayment(payMsg(payload, 100));
    const before = h.sent.length;
    await h.sales.onPayment(payMsg(payload, 100));
    assert.strictEqual(h.sent.length, before, 'duplicate: silent');
    assert.match(h.sent[0].text, /Huquqiy savolingizni yozing/u);

    const bad = salesHarness();
    await bad.sales.onPayment(payMsg(payload, 50, 'ch9'));
    assert.deepStrictEqual(bad.refunds, ['ch9']);
    assert.strictEqual(bad.fakeLedger.grants.length, 0);

    const down = salesHarness({ creditFails: true });
    await down.sales.onPayment(payMsg(payload, 100, 'ch10'));
    assert.deepStrictEqual(down.refunds, ['ch10']);
    assert.match(down.sent[0].text, /Stars hisobingizga qaytarildi/u);
    assert.strictEqual(await down.sales.onPayment({ chat: { id: 1 }, from: { id: 1 }, successful_payment: { invoice_payload: 'juristai_answers_v2:1:1:4:n:s' } }), false, 'the old pack is not handled here');
  });

  await test('bot wiring: question pack replaces the 1-Star pack; offers after the last Sinov answer, when the limit is spent, for a draft and an analysis', () => {
    const bot = read('src/bot/bot.js');
    assert.match(bot, /oneTimeSales\.button\('chat5'/u);
    assert.doesNotMatch(bot, /callback_data: 'buy_ai_answers'/u, 'the 1-Star button is no longer offered');
    assert.match(bot, /readAnswerOffer\(query\.invoice_payload/u, 'old invoices are still honoured');
    assert.match(bot, /agentResult\.action === 'quota_exceeded' \? await quotaKeyboard\(chatId\)/u);
    assert.match(bot, /if \(agentResult\.meta\.trialSpent\) rows\.push/u);
    assert.match(bot, /oneTimeSales\.setResume\(chatId, 'draft'/u);
    assert.match(bot, /if \(await oneTimeSales\.onPayment\(msg\)\) return;/u);
    assert.match(bot, /callback_data: 'tgdraft_review'/u);
    assert.match(read('src/bot/telegram-documents.js'), /deps\.sales\.setResume\(chatId, 'analysis'/u);
    const agent = read('src/agents/telegram-agent.js');
    assert.match(agent, /trialSpent: !quota\.oneTime/u);
    assert.match(agent, /Sotib olingan paketdan: yana/u);
  });

  await test("lawyer price: the platform's share is recorded with the quote; unknown until the percentage is set", () => {
    delete process.env.LAWYER_COMMISSION_PCT;
    assert.deepStrictEqual(commission.split(200000), { pct: null, feeMinor: null, payoutMinor: null });
    process.env.LAWYER_COMMISSION_PCT = '20';
    assert.deepStrictEqual(commission.split(200000), { pct: 20, feeMinor: 40000, payoutMinor: 160000 });
    process.env.LAWYER_COMMISSION_PCT = '90';
    assert.strictEqual(commission.split(200000).pct, null, 'over 50%: refused');
    delete process.env.LAWYER_COMMISSION_PCT;
    const msg = commission.quoteMessage({ id: 4, quoted_price_minor: 150000, intake_data: { kind: 'lawyer_review' } }, { formatUzs: products.formatUzs });
    assert.match(msg, /Yurist tekshiruvi \(#4\): yurist narxni belgiladi — 150 000 so'm/u);
    assert.match(msg, /ish boshlanmaydi/u);
    const server = read('src/api/server.js');
    assert.match(server, /platform_fee_pct = CASE/u);
    assert.match(server, /status === 'approved_awaiting_payment' && before\.status !== status && order\.telegram_chat_id/u);
  });

  await test('migration: one row per payment, unique charge id, a down file', () => {
    const sql = read('migrations/20261021_017_one_time_credits.sql');
    assert.match(sql, /payment_ref\s+text\s+NOT NULL UNIQUE/u);
    assert.match(sql, /CHECK \(units > 0\)/u);
    assert.ok(fs.existsSync(path.join(__dirname, '../migrations/down/20261021_017_one_time_credits.down.sql')));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
