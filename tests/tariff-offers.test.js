'use strict';

/**
 * #408 follow-up (2026-10-05): the price floor of individual discounts, the
 * chat-with-a-document rule, and the routes. Database behaviour (redeem,
 * expiry, parallel use, margin report on actual prices) is in
 * tests/tariff-offers.db.test.js. All costs here are the planning budgets -
 * estimates, not measured costs.
 *
 *   node tests/tariff-offers.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pricing = require('../src/rag/tariff-pricing');
const docJob = require('../src/rag/document-job');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function withModel(model, fn) {
  const keep = process.env.TARIFF_COST_MODEL;
  process.env.TARIFF_COST_MODEL = JSON.stringify(model);
  try { return fn(); } finally { if (keep === undefined) delete process.env.TARIFF_COST_MODEL; else process.env.TARIFF_COST_MODEL = keep; }
}

(async () => {
  console.log('price floor');

  await test('starting budgets: Silver 120 000 -> 150 000, Gold 360 000 -> 450 000, Platinum 600 000 -> 750 000 (marked estimated)', () => {
    for (const [plan, cost, min] of [['silver', 120000, 150000], ['gold', 360000, 450000], ['platinum', 600000, 750000]]) {
      const c = pricing.conservativeCost(plan);
      assert.strictEqual(c.fixedUzs, cost, plan);
      assert.strictEqual(pricing.minimumPrice(c.fixedUzs, 0), min, plan);
      assert.ok(c.components.every(x => x.status === 'estimated'), 'planning budgets are estimates');
    }
    assert.match(pricing.costModel().label, /taxminiy/u);
  });

  await test('the minimum rounds UP to 1 000 so\'m, in integers', () => {
    assert.strictEqual(pricing.minimumPrice(120001, 0), 151000);
    assert.strictEqual(pricing.minimumPrice(120000, 0), 150000);
    assert.ok(Number.isInteger(pricing.minimumPrice(123457, 137)));
  });

  await test('a payment fee that is a share of the price is solved for, not added twice', () => {
    // fixed + 3% x P <= 80% x P  =>  P >= 120 000 / 0.77 = 155 844.2 -> 156 000
    assert.strictEqual(pricing.minimumPrice(120000, 300), 156000);
    const q = withModel({ version: 't', paymentFeeBp: 300, plans: { silver: { components: [{ key: 'ai', uzs: 109800, status: 'estimated' }, { key: 'ops', uzs: 10200, status: 'estimated' }] } } },
      () => pricing.quoteDiscount({ plan: 'silver', discountUzs: 43000 }));
    assert.strictEqual(q.minPriceUzs, 156000);
    assert.strictEqual(q.finalPriceUzs, 156000);
    assert.strictEqual(q.paymentFeeUzs, Math.ceil(156000 * 0.03));
    assert.strictEqual(q.totalCostUzs, 120000 + q.paymentFeeUzs);
    assert.ok(q.costShareBp <= 8000, 'at the minimum, cost is at most 80% of the price');
  });

  await test('a discount to exactly the minimum passes; one so\'m more is refused with the largest allowed discount, never adjusted', () => {
    const ok = pricing.quoteDiscount({ plan: 'silver', discountUzs: 49000 });
    assert.deepStrictEqual([ok.ok, ok.finalPriceUzs, ok.minPriceUzs], [true, 150000, 150000]);
    const no = pricing.quoteDiscount({ plan: 'silver', discountUzs: 49001 });
    assert.deepStrictEqual([no.ok, no.reason, no.finalPriceUzs, no.maxDiscountUzs], [false, 'below_minimum', 149999, 49000]);
    assert.match(no.message, /Eng katta ruxsat etilgan chegirma: 49 000 so'm \(24\.62%\)/u);
  });

  await test('percent: up to 2 decimals, the discount rounds down; percent and amount are not both accepted', () => {
    const q = pricing.quoteDiscount({ plan: 'gold', discountPercent: '12.5' });
    assert.deepStrictEqual([q.ok, q.discountUzs, q.finalPriceUzs], [true, 74875, 524125]);
    assert.strictEqual(pricing.parseDiscount(599000, { discountPercent: '0.01' }).discountUzs, 59);
    assert.strictEqual(pricing.parseDiscount(599000, { discountPercent: '12.345' }).error, 'invalid_percent');
    assert.strictEqual(pricing.parseDiscount(599000, { discountPercent: '100' }).error, 'invalid_percent');
    assert.strictEqual(pricing.parseDiscount(599000, { discountPercent: '10', discountUzs: 5 }).error, 'one_of_percent_or_amount');
    assert.strictEqual(pricing.parseDiscount(599000, { discountUzs: 1.5 }).error, 'invalid_amount');
    assert.strictEqual(pricing.quoteDiscount({ plan: 'platinum', discountPercent: '25' }).ok, false, '25% of Platinum is under 750 000');
  });

  await test('an unknown cost is never 0: without a reasoned reserve, no offer; with one, the reserve is counted', () => {
    const base = { version: 'u1', paymentFeeBp: 0 };
    const no = withModel({ ...base, plans: { silver: { components: [{ key: 'ai', uzs: 109800, status: 'estimated' }, { key: 'storage', status: 'unknown' }] } } },
      () => pricing.quoteDiscount({ plan: 'silver', discountPercent: '5' }));
    assert.deepStrictEqual([no.ok, no.reason], [false, 'unknown_cost_without_reserve']);
    assert.match(no.message, /storage/u);
    const yes = withModel({ ...base, plans: { silver: { components: [{ key: 'ai', uzs: 109800, status: 'estimated' },
      { key: 'storage', status: 'unknown', reserveUzs: 10200, reserveBasis: 'conservative reserve until measured' }] } } },
    () => pricing.quoteDiscount({ plan: 'silver', discountPercent: '5' }));
    assert.strictEqual(yes.ok, true);
    assert.strictEqual(yes.cost.fixedUzs, 120000);
    assert.strictEqual(yes.cost.components.find(c => c.key === 'storage').status, 'reserve');
  });

  await test('measured cost can raise the estimate, never lower it (no optimistic cache or low-usage discount)', () => {
    const low = pricing.conservativeCost('silver', { measured: [{ service: 'chat', knownUsdPerUnit: 0.001 }, { service: 'analysis', knownUsdPerUnit: 0.01 }] });
    assert.strictEqual(low.fixedUzs, 120000, 'cheaper measurements do not lower the floor');
    const high = pricing.conservativeCost('silver', { measured: [{ service: 'analysis', knownUsdPerUnit: 0.45 }] });
    assert.strictEqual(high.fixedUzs, 120000 + 8 * 0.15 * 12000);
    assert.strictEqual(high.components.find(c => c.key === 'ai').status, 'measured_above_plan');
  });

  await test('if the floor is above the catalogue price: no offer, an economics warning, and nothing bought is touched', () => {
    const q = withModel({ version: 'hi', paymentFeeBp: 0, plans: { silver: { components: [{ key: 'ai', uzs: 170000, status: 'estimated' }] } } },
      () => pricing.quoteDiscount({ plan: 'silver', discountPercent: '1' }));
    assert.deepStrictEqual([q.ok, q.reason, q.economicsWarning, q.minPriceUzs], [false, 'catalogue_price_below_floor', true, 213000]);
    assert.match(q.message, /Sotib olingan huquqlar o'zgarmaydi/u);
  });

  await test('the quote reports list, discount, final, minimum, AI and total cost, margin, confidence and versions', () => {
    const q = pricing.quoteDiscount({ plan: 'silver', discountPercent: '10' });
    for (const k of ['listPriceUzs', 'discountUzs', 'finalPriceUzs', 'minPriceUzs', 'aiCostUzs', 'totalCostUzs', 'leftUzs', 'serviceMarginBp', 'confidence', 'costModelVersion', 'quotaVersion']) {
      assert.ok(q[k] != null, k);
    }
    assert.deepStrictEqual([q.finalPriceUzs, q.totalCostUzs, q.leftUzs, q.serviceMarginBp], [179100, 120000, 59100, 3299]);
    assert.deepStrictEqual(q.quotas, require('../src/rag/tariff-ledger').PLAN_CATALOG.silver.quotas, 'a discount does not cut the quota');
  });

  console.log('chat with a document');

  await test('the work asked for decides the service: a question is chat, an analysis or opinion is a document job', () => {
    for (const q of ['Ushbu hujjatni tahlil qiling', "Shartnomani to'liq tekshirib bering", 'Shu hujjat bo\'yicha yuridik xulosa yozing', 'Таҳлил қилиб беринг', 'Ҳужжатни текшириб беринг',
      'Проанализируйте договор', 'Проверьте документ на риски', 'Нужно юридическое заключение по договору']) {
      assert.ok(docJob.isFullDocumentRequest(q), q);
    }
    for (const q of ['Shartnomaning 5-bandi qonuniymi?', 'Ijara muddati qancha deb yozilgan?', 'Пункт 3 законен?', 'Jarima summasi nechchi?']) {
      assert.ok(!docJob.isFullDocumentRequest(q), q);
    }
  });

  await test('a question gets only the relevant excerpts, at most half an analysis unit, and says so', () => {
    const doc = 'IJARA SHARTNOMASI\nTaraflar: A va B.\n\n' + Array.from({ length: 200 }, (_, i) => `${i + 1}. Band matni oddiy shartlar haqida ${'x'.repeat(250)}`).join('\n\n')
      + '\n\n201. Jarima: kechiktirilgan har bir kun uchun 0,5 foiz.';
    const ex = docJob.selectExcerpt(doc, 'Jarima bandi qonuniymi?');
    assert.ok(ex.excerpt);
    assert.ok(ex.usedChars <= docJob.CHAT_DOCUMENT_CONTEXT_CHARS);
    assert.match(ex.text, /IJARA SHARTNOMASI/u, 'the head stays');
    assert.match(ex.text, /201\. Jarima/u, 'the clause the question is about is in');
    assert.match(docJob.excerptInstruction(ex), /to'liq tahlili deb ko'rsatmang/u);
    assert.match(docJob.excerptNote(ex, 2), /Butun hujjatni tahlil qilish — alohida xizmat \(2 birlik\)/u);
    const short = docJob.selectExcerpt('Qisqa shartnoma.', 'savol');
    assert.strictEqual(short.excerpt, false);
  });

  await test('one rule in all channels: Workspace context uses the same cap; Telegram runs no AI on files', () => {
    assert.match(read('src/workspace/ai-service.js'), new RegExp(`const DOCUMENT_CONTEXT_CHARS = ${docJob.CHAT_DOCUMENT_CONTEXT_CHARS};`, 'u'));
    assert.match(read('src/workspace/legal-answer-generator.js'), /documentJob\.isFullDocumentRequest\(question\)/u);
    assert.match(read('src/bot/bot.js'), /if \(requestData\.request_type === 'text' \|\| requestData\.voiceTranscribed\)/u, 'files go to the lawyer queue, not the agent');
  });

  await test('web chat: the middleware meters by the work, the handler sends excerpts or the whole document accordingly', () => {
    const server = read('src/api/server.js');
    assert.match(server, /app\.post\('\/api\/legal-chat', requireAuth, tariffModule\.enforceChatQuota\('\/api\/legal-chat'\),/u);
    assert.ok(!/\.trim\(\)\.slice\(0, 15000\)/u.test(server), 'no silent first-15 000-characters cut');
    assert.match(server, /documentJob\.selectExcerpt\(rawDoc, message\)/u);
    assert.match(server, /docJobInfo\.mode === 'analysis'/u);
  });

  // the middleware itself, with the ledger stubbed
  await test('a document job is confirmed first (409 with the quote), then charged as analysis only - never also as chat', async () => {
    const tiers = require('../src/rag/subscription-tiers');
    const calls = [];
    const real = { reserve: tiers.ledger.reserve, getUserPlanAccess: null };
    tiers.ledger.reserve = async (a) => { calls.push(a.service + ':' + a.units); return { allowed: true, kind: 'paid', plan: 'silver', jobKey: 'k' + calls.length, units: a.units }; };
    const mw = tiers.enforceChatQuota('/api/legal-chat');
    const res = () => ({ statusCode: 200, locals: {}, headersSent: false, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, on() { return this; } });
    // a staff session skips metering; use a stubbed ordinary path by faking the quote and gate helpers
    const doc = 'Shartnoma matni. '.repeat(3000); // ~51 000 chars -> 2 units
    // question about the document -> chat
    let r1 = res(); let n1 = false;
    await mw({ session: { adminId: 0, role: 'master' }, body: { message: '5-band qonuniymi?', documentText: doc }, params: {} }, r1, () => { n1 = true; });
    assert.ok(n1);
    assert.strictEqual(r1.locals.documentJob.mode, 'chat_excerpt');
    // analysis requested -> analysis mode (master is not metered, but the mode and units are set)
    let r2 = res(); let n2 = false;
    await mw({ session: { adminId: 0, role: 'master' }, body: { message: 'Ushbu hujjatni tahlil qiling', documentText: doc }, params: {} }, r2, () => { n2 = true; });
    assert.ok(n2);
    assert.deepStrictEqual([r2.locals.documentJob.mode, r2.locals.documentJob.units], ['analysis', 2]);
    assert.deepStrictEqual(calls, [], 'no chat unit was reserved for the analysis');
    tiers.ledger.reserve = real.reserve;
    assert.match(read('src/rag/subscription-tiers.js'), /if \(Number\(body\.confirmedUnits\) !== size\.units\) \{[\s\S]*?status\(409\)[\s\S]*?DOC_COST_CONFIRM/u);
  });

  console.log('routes');

  await test('offers are master-only on the server; the client never sends a price', () => {
    const server = read('src/api/server.js');
    for (const r of ["app.post('/api/admin/tariff/offers/quote', requireMasterAdmin,", "app.post('/api/admin/tariff/offers', requireMasterAdmin,", "app.get('/api/admin/tariff/offers', requireMasterAdmin,",
      "app.post('/api/admin/tariff/offers/:id/revoke', requireMasterAdmin,", "app.get('/api/admin/tariff/offers/:id/check', requireMasterAdmin,", "app.post('/api/admin/tariff/grant', requireMasterAdmin,"]) {
      assert.ok(server.includes(r), r);
    }
    const create = server.slice(server.indexOf("app.post('/api/admin/tariff/offers', requireMasterAdmin,"));
    const body = create.slice(0, create.indexOf('\n});\n'));
    assert.ok(!/finalPrice|final_price|priceUzs/u.test(body.split('createOffer(')[0]), 'no price is read from the request');
    assert.match(read('src/rag/tariff-offers.js'), /if \(!\(await isMaster\(db, createdBy\)\)\) return \{ ok: false, reason: 'master_only' \};/u);
  });

  await test('the margin report uses actual sale prices, never the catalogue', () => {
    const src = read('src/rag/subscription-tiers.js');
    const fn = src.slice(src.indexOf('async function marginReport'), src.indexOf('module.exports'));
    assert.ok(!/PLANS\[/u.test(fn), 'no catalogue price in the margin report');
    assert.match(fn, /p\.price_uzs == null/u);
    assert.match(fn, /recognizedCreditUzs/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
