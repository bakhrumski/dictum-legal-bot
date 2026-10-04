'use strict';

/**
 * Tariffs v2 (2026-10-04, docs/tariffs-v2.md): the catalogue, service units,
 * planning economics, refusals, the reserve / commit / release lifecycle of
 * an HTTP job, the legacy rules kept for subscriptions sold under v1, and
 * that every page and the bot show the numbers the backend enforces.
 * The database behaviour (atomic reservations, periods, renewals, the
 * shared Sinov) is in tests/tariffs-v2.db.test.js.
 *
 *   node tests/tariffs-v2.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

const state = { failQueries: false, plan: 'silver', role: 'user', used: 0 };
const fakePool = {
  query: async (sql) => {
    if (state.failQueries) throw new Error('db down');
    if (/FROM admins WHERE id/i.test(sql)) {
      return { rows: [{ id: 7, role: state.role, tariff_plan: state.plan, tariff_starts_at: new Date(), tariff_expires_at: new Date(Date.now() + 5 * 864e5),
        telegram_user_id: 1, telegram_username: 'u', channel_verified_at: new Date(), survey_completed_at: new Date(), free_gate_since: new Date(), created_at: new Date() }] };
    }
    if (/COUNT\(\*\)|SUM\(/i.test(sql)) return { rows: [{ used: state.used, n: state.used }] };
    return { rows: [] };
  },
  async connect() {
    if (state.failQueries) throw new Error('db down');
    return { query: (sql, p) => (/^(BEGIN|COMMIT|ROLLBACK)$|pg_advisory_xact_lock/.test(sql) ? Promise.resolve({ rows: [] }) : fakePool.query(sql, p)), release() {} };
  },
};

// load subscription-tiers (and the ledger it requires) on the fake pool
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  return orig.apply(this, arguments);
};
for (const rel of ['../src/rag/tariff-ledger', '../src/rag/subscription-tiers']) delete require.cache[require.resolve(rel)];
const tiers = require('../src/rag/subscription-tiers');
Module.prototype.require = orig;
const ledger = tiers.ledger;

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
function fakeRes() {
  const listeners = {};
  return {
    statusCode: 200, body: null, headersSent: false, writableFinished: false, locals: {}, listeners,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; this.writableFinished = true; if (listeners.finish) listeners.finish(); return this; },
    on(ev, fn) { listeners[ev] = fn; return this; },
  };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  console.log('tariffs v2 — catalogue');

  await test('prices and periods: Sinov free once; 199 000 / 599 000 / 999 000 for 30 days', () => {
    const c = ledger.PLAN_CATALOG;
    assert.deepStrictEqual(['sinov', 'silver', 'gold', 'platinum'].map(k => [c[k].priceUzs, c[k].periodDays]),
      [[0, null], [199000, 30], [599000, 30], [999000, 30]]);
    assert.strictEqual(c.sinov.oneTime, true);
    assert.deepStrictEqual(Object.keys(tiers.PLANS), ['sinov', 'silver', 'gold', 'platinum'], 'the free-forever plan is gone');
  });

  await test('limits: Sinov 5 + 1 + 1 (7 separate services), Silver 150/8/8/10, Gold 3x, Platinum 5x', () => {
    const q = k => ledger.PLAN_CATALOG[k].quotas;
    assert.deepStrictEqual([q('sinov').chat, q('sinov').analysis, q('sinov').opinion, q('sinov').draft], [5, 1, 1, 0]);
    assert.deepStrictEqual([q('silver').chat, q('silver').analysis, q('silver').opinion, q('silver').draft], [150, 8, 8, 10]);
    for (const k of ['chat', 'analysis', 'opinion', 'draft', 'ocr']) {
      assert.strictEqual(q('gold')[k], 3 * q('silver')[k], `gold ${k}`);
      assert.strictEqual(q('platinum')[k], 5 * q('silver')[k], `platinum ${k}`);
    }
  });

  await test('Workspace: create only on Platinum, join from Silver; Sinov neither', () => {
    const w = k => ledger.PLAN_CATALOG[k].workspace;
    assert.deepStrictEqual(['sinov', 'silver', 'gold', 'platinum'].map(k => [w(k).create, w(k).join]),
      [[false, false], [false, true], [false, true], [true, true]]);
  });

  console.log('tariffs v2 — units');

  await test('document units: max(ceil(pages / 10), ceil(chars / 40 000)); 25 pages is 3 units', () => {
    assert.strictEqual(ledger.docUnits({ pages: 25, chars: 30000 }).units, 3);
    assert.strictEqual(ledger.docUnits({ pages: 3, chars: 90000 }).units, 3, 'small font cannot shrink the bill');
    assert.strictEqual(ledger.docUnits({ pages: 10, chars: 40000 }).units, 1);
    assert.strictEqual(ledger.docUnits({ pages: 11, chars: 1000 }).units, 2);
    assert.strictEqual(ledger.docUnits({ chars: 40001 }).units, 2, 'DOCX/text: standard paging of the characters');
    assert.strictEqual(ledger.docUnits({ chars: 0 }).units, 0, 'an empty file costs nothing');
  });

  await test('a Sinov document is at most 1 unit; a paid job at most 30 pages / 120 000 characters - too large is refused, not cut', () => {
    assert.strictEqual(ledger.jobFits('sinov', { pages: 10, chars: 40000 }).ok, true);
    const big = ledger.jobFits('sinov', { pages: 11, chars: 1000 });
    assert.deepStrictEqual([big.ok, big.reason, big.units], [false, 'document_too_large', 2]);
    assert.strictEqual(ledger.jobFits('silver', { pages: 30, chars: 120000 }).ok, true);
    assert.strictEqual(ledger.jobFits('gold', { pages: 31, chars: 1000 }).ok, false);
    assert.strictEqual(ledger.jobFits('platinum', { chars: 120001 }).ok, false);
    assert.strictEqual(ledger.jobFits('silver', { chars: 0 }).reason, 'empty_document');
  });

  await test('draft units: 1 up to 20 000 characters of output (5 standard pages), then per 20 000', () => {
    assert.strictEqual(ledger.draftUnits({ chars: 20000 }), 1);
    assert.strictEqual(ledger.draftUnits({ chars: 20001 }), 2);
  });

  await test('a document ticket carries the PDF page count only for exactly that text', () => {
    const text = 'Shartnoma matni '.repeat(200);
    const t = ledger.signDocTicket({ text, pages: 25 });
    assert.deepStrictEqual(ledger.readDocTicket(t, text), { pages: 25, scanned: false });
    assert.strictEqual(ledger.readDocTicket(t, text + ' boshqa'), null, 'another text');
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), p: 1 })).toString('base64url');
    assert.strictEqual(ledger.readDocTicket(`${forged}.${sig}`, text), null, 'a lowered page count is rejected');
  });

  console.log('tariffs v2 — planning economics (budgets, not measured cost)');

  await test('Silver / Gold / Platinum: AI budget, operations, service budget, margin and the 80% ceiling', () => {
    const e = k => ledger.planEconomics(k);
    assert.deepStrictEqual(['silver', 'gold', 'platinum'].map(k => [e(k).aiUzs, e(k).opsUzs, e(k).serviceUzs, e(k).leftUzs, e(k).ceilingUzs]), [
      [109800, 10200, 120000, 79000, 159200],
      [329400, 30600, 360000, 239000, 479200],
      [549000, 51000, 600000, 399000, 799200],
    ]);
    assert.deepStrictEqual(['silver', 'gold', 'platinum'].map(k => (e(k).serviceMargin * 100).toFixed(2)), ['39.70', '39.90', '39.94']);
    assert.ok(['silver', 'gold', 'platinum'].every(k => e(k).withinCeiling), '100% use stays under 80% of the price on the planning budgets');
    assert.match(e('silver').basis, /not measured/u);
  });

  await test('one Sinov: $0.725 on the planning budgets (~8 700 so\'m)', () => {
    const q = ledger.PLAN_CATALOG.sinov.quotas;
    const u = ledger.PLANNING.unitUsd;
    const usd = q.chat * u.chat + q.analysis * u.analysis + q.opinion * u.opinion;
    assert.strictEqual(usd.toFixed(3), '0.725');
    assert.strictEqual(Math.round(usd * ledger.PLANNING.uzsPerUsd), 8700);
  });

  console.log('tariffs v2 — services and refusals');

  await test('endpoints map to services; exports call no model and are not metered', () => {
    assert.deepStrictEqual(['/api/legal-chat', '/api/workspace-ai', '/api/enterprise-chat', '/api/analyze', '/api/draft/explain-document',
      '/api/draft/legal-opinion', '/api/draft/ai-generate', '/api/analyze/ocr', '/api/draft/export', '/api/templates/import'].map(tiers.serviceFor),
    ['chat', 'chat', 'chat', 'analysis', 'analysis', 'opinion', 'draft', 'ocr', null, null]);
  });

  await test('refusals say what is missing, offer plans, promise no auto-payment and no weekly reset', () => {
    const [st1, none] = tiers.refusal({ kind: 'none', reason: 'no_plan' }, 'chat');
    assert.strictEqual(st1, 402);
    assert.match(none.message, /avtomatik to'lov olinmaydi/u);
    const [, trial] = tiers.refusal({ kind: 'trial', plan: 'sinov', allowed: false, used: 5, limit: 5, units: 1, reason: 'limit_reached' }, 'chat');
    assert.match(trial.message, /Sinov: huquqiy chat limiti yetarli emas \(5\/5\)\. Sinov bir martalik va yangilanmaydi/u);
    const [, paid] = tiers.refusal({ kind: 'paid', plan: 'silver', used: 7, limit: 8, units: 3, reason: 'limit_reached', endsAt: '2026-11-03T05:00:00Z' }, 'opinion');
    assert.match(paid.message, /Silver: AI yuridik xulosa limiti yetarli emas \(7\/8, bu ish 3 birlik talab qiladi\)\. Limit 03\.11\.2026 da yangi 30 kunlik davr bilan/u);
    const [, notIn] = tiers.refusal({ kind: 'trial', plan: 'sinov', limit: 0, reason: 'not_in_plan' }, 'draft');
    assert.match(notIn.message, /Sinov tarifiga kirmaydi/u);
    for (const b of [none, trial, paid, notIn]) assert.ok(!/dushanba|haftalik|kunlik limit|ertaga|00:00/u.test(b.message), b.message);
  });

  console.log('tariffs v2 — HTTP job lifecycle');

  const calls = [];
  const realReserve = ledger.reserve, realCommit = ledger.commit, realRelease = ledger.release;
  ledger.commit = async (k) => { calls.push(['commit', k]); return true; };
  ledger.release = async (k, r) => { calls.push(['release', k, r]); return true; };

  await test('a job is reserved with the session\'s own account as payer; success commits it', async () => {
    calls.length = 0; state.failQueries = false;
    let got = null;
    ledger.reserve = async (args) => { got = args; return { allowed: true, kind: 'paid', plan: 'silver', jobKey: 'job-1', units: 1, used: 1, limit: 150, remaining: 149 }; };
    const res = fakeRes();
    let nexted = false;
    await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 7, role: 'user' }, body: { adminId: 999, payerId: 999 }, params: {} }, res, () => { nexted = true; });
    assert.ok(nexted);
    assert.deepStrictEqual([got.adminId, got.actorId, got.service, got.channel], [7, 7, 'chat', 'web'], 'payer from the session, never from the body');
    res.json({ reply: 'ok' });
    await tick();
    assert.deepStrictEqual(calls, [['commit', 'job-1']]);
  });

  await test('a failed job is released once and says so; the AI cost stays in the usage ledger', async () => {
    calls.length = 0;
    ledger.reserve = async () => ({ allowed: true, kind: 'trial', plan: 'sinov', jobKey: 'job-2', units: 1 });
    const res = fakeRes();
    await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 7, role: 'user' }, params: {} }, res, () => {});
    const first = tiers.refundUsage(res, 'stream_error');
    const again = tiers.refundUsage(res, 'again');
    res.status(500).json({ error: 'x' });
    await tick();
    assert.strictEqual(first.quotaRefunded, true);
    assert.deepStrictEqual(again, {});
    assert.deepStrictEqual(calls, [['release', 'job-2', 'stream_error']]);
  });

  await test('a client that leaves after the answer started is charged; one that leaves before is not', async () => {
    calls.length = 0;
    ledger.reserve = async () => ({ allowed: true, kind: 'paid', plan: 'gold', jobKey: 'job-3', units: 1 });
    const started = fakeRes();
    await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 7, role: 'user' }, params: {} }, started, () => {});
    started.headersSent = true;
    started.listeners.close();
    ledger.reserve = async () => ({ allowed: true, kind: 'paid', plan: 'gold', jobKey: 'job-4', units: 1 });
    const early = fakeRes();
    await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 7, role: 'user' }, params: {} }, early, () => {});
    early.listeners.close();
    await tick();
    assert.deepStrictEqual(calls, [['commit', 'job-3'], ['release', 'job-4', 'client_closed']]);
  });

  await test('Workspace AI records the Workspace and the asking member, paid from their own allowance', async () => {
    let got = null;
    ledger.reserve = async (args) => { got = args; return { allowed: true, kind: 'paid', plan: 'silver', jobKey: 'job-5', units: 1 }; };
    const ws = '11111111-2222-4333-8444-555555555555';
    await tiers.enforceQuota('/api/workspace-ai')({ session: { adminId: 9, role: 'user' }, originalUrl: `/api/workspaces/${ws}/assistant/ask`, params: { id: ws }, body: { payerId: 1 } }, fakeRes(), () => {});
    assert.deepStrictEqual([got.adminId, got.actorId, got.workspaceId, got.channel, got.service], [9, 9, ws, 'workspace', 'chat']);
  });

  await test('D-5: chat still passes when the database is down; expensive paths answer 503', async () => {
    ledger.reserve = realReserve;
    state.failQueries = true;
    let nexted = false;
    const res = fakeRes();
    await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 7, role: 'user' }, params: {} }, res, () => { nexted = true; });
    assert.ok(nexted);
    const r2 = fakeRes();
    let n2 = false;
    await tiers.enforceQuota('/api/analyze/ocr', { failClosed: true, service: 'ocr' })({ session: { adminId: 7, role: 'user' }, params: {} }, r2, () => { n2 = true; });
    assert.ok(!n2);
    assert.strictEqual(r2.statusCode, 503);
    state.failQueries = false;
  });

  await test('staff and master are not metered', async () => {
    let reserved = false;
    ledger.reserve = async () => { reserved = true; return { allowed: true }; };
    for (const role of ['master', 'lawyer', 'student']) {
      let nexted = false;
      await tiers.enforceQuota('/api/legal-chat')({ session: { adminId: 1, role }, params: {} }, fakeRes(), () => { nexted = true; });
      assert.ok(nexted, role);
    }
    assert.strictEqual(reserved, false);
  });
  ledger.reserve = realReserve; ledger.commit = realCommit; ledger.release = realRelease;

  console.log('tariffs v2 — legacy subscriptions keep what they were sold');

  await test('a legacy_v1 period is checked with its v1 rules: chat under the daily fair-use ceiling', async () => {
    state.used = 14;
    const ok = await tiers.legacyCheck(fakePool, { adminId: 7, plan: 'silver', service: 'chat', units: 1 });
    assert.strictEqual(ok.allowed, true);
    state.used = 15;
    const hit = await tiers.legacyCheck(fakePool, { adminId: 7, plan: 'silver', service: 'chat', units: 1 });
    assert.deepStrictEqual([hit.allowed, hit.fairUseHit], [false, true]);
  });

  await test('legacy opinions and drafts keep their weekly allowance (9 / 22 on Silver)', async () => {
    state.used = 8;
    assert.strictEqual((await tiers.legacyCheck(fakePool, { adminId: 7, plan: 'silver', service: 'opinion', units: 1 })).allowed, true);
    assert.strictEqual((await tiers.legacyCheck(fakePool, { adminId: 7, plan: 'silver', service: 'opinion', units: 2 })).allowed, false);
    state.used = 21;
    assert.strictEqual((await tiers.legacyCheck(fakePool, { adminId: 7, plan: 'silver', service: 'draft', units: 1 })).allowed, true);
    assert.deepStrictEqual([tiers.LEGACY_PLANS.silver.weeklyOpinionCredits, tiers.LEGACY_PLANS.silver.weeklyDrafts], [9, 22]);
    state.used = 0;
  });

  await test('the migration carries running paid subscriptions over as legacy_v1, idempotently', () => {
    const sql = read('migrations/20261004_013_tariff_periods.sql');
    assert.match(sql, /'legacy_v1', 'migration'/u);
    assert.match(sql, /a\.tariff_expires_at > now\(\)/u);
    assert.match(sql, /ON CONFLICT DO NOTHING/u);
    assert.match(sql, /tariff_periods_one_trial_uidx[\s\S]*WHERE source = 'trial'/u);
    assert.match(sql, /tariff_periods_payment_ref_uidx[\s\S]*WHERE payment_ref IS NOT NULL/u);
    assert.ok(fs.existsSync(path.join(__dirname, '../migrations/down/20261004_013_tariff_periods.down.sql')));
  });

  console.log('tariffs v2 — routes');

  await test('analysis, explanation and opinion are sized from the whole document; nothing is silently cut', () => {
    const server = read('src/api/server.js');
    const ocr = read('src/ocr/routes.js');
    assert.ok(/meterDocument\(req, res, \{ service: 'analysis', text, docTicket, endpoint: '\/api\/analyze' \}\)/.test(ocr));
    assert.ok(!/text\.trim\(\)\.slice\(0, MAX_ANALYSIS_CHARS\);/.test(ocr), 'analysis no longer cuts at 9 000 characters');
    assert.ok(/digestLongDocument\(full, req\.session && req\.session\.adminId\)/.test(ocr));
    assert.ok(!/documentText\.replace\(\/\\u0000\/g, ''\)\.trim\(\)\.slice\(0, 120000\)/.test(server), 'opinion and explain no longer cut at 120 000');
    assert.ok(/const CHUNK = 12000, OVERLAP = 400, MAX_CHUNKS = 11;/.test(server), 'the digest covers the whole 120 000 characters');
    assert.ok(/docTicket: ledger \? ledger\.signDocTicket\(\{ text \}\) : null/.test(ocr) && /signDocTicket\(\{ text, pages \}\)/.test(ocr));
  });

  await test('a paid plan is never granted by the user\'s own request; a master grant is idempotent by payment reference', () => {
    const server = read('src/api/server.js');
    assert.match(server, /error: 'checkout_unavailable'/u);
    assert.match(server, /app\.post\('\/api\/admin\/tariff\/grant', requireMasterAdmin,/u);
    assert.match(server, /paymentRef: `\$\{String\(provider\)\.slice\(0, 20\)\}:\$\{ref\}`/u);
    assert.match(server, /app\.post\('\/api\/tariff\/quote', requireAuth,/u);
    assert.match(read('src/rag/tariff-ledger.js'), /const dup = await db\.query\('SELECT \* FROM tariff_periods WHERE payment_ref = \$1'/u);
  });

  console.log('tariffs v2 — one source for every number the user sees');

  await test('landing and tariff pages show the catalogue\'s prices and limits', () => {
    const html = read('public/index.html') + read('public/tariff.html');
    const c = ledger.PLAN_CATALOG;
    for (const k of ['silver', 'gold', 'platinum']) {
      const price = c[k].priceUzs.toLocaleString('ru-RU').replace(/ /gu, ' ');
      assert.ok(html.includes(price), `${k} price ${price}`);
      for (const [svc, word] of [['chat', 'huquqiy savol'], ['analysis', 'birlik hujjat tahlili'], ['opinion', 'birlik']]) {
        assert.ok(new RegExp(`(>|")${c[k].quotas[svc]}(<\\/b>)? (ta )?${word.split(' ')[0]}`, 'u').test(html) || html.includes(`data-quota="${k}.${svc}">${c[k].quotas[svc]}<`), `${k} ${svc}`);
      }
    }
    const tariff = read('public/tariff.html');
    for (const k of ['sinov', 'silver', 'gold', 'platinum']) {
      for (const [svc, n] of Object.entries(c[k].quotas)) {
        const m = new RegExp(`data-quota="${k}\\.${svc}">([0-9 ]+)<`, 'u').exec(tariff);
        if (m) assert.strictEqual(Number(m[1].replace(/ /gu, '')), n, `${k}.${svc}`);
      }
    }
  });

  await test('no superseded promise remains: free forever, daily or weekly limits, unlimited chat, old prices, rebate', () => {
    const pages = ['public/index.html', 'public/tariff.html'].map(read).join('\n');
    for (const re of [/Kuniga 10 ta savol/u, /kuniga 3 ta/iu, /muddatsiz/iu, /Doimo bepul/u, /Cheksiz AI chat/u, /Безлимитный/u, /399[ ,]000/u,
      /har dushanba/iu, /Kam ishlatdingizmi/u, /konsierj/iu, /API orqali integratsiya/u, /to'g'ridan-to'g'ri aktivatsiya/u]) {
      assert.ok(!re.test(pages), `still shown: ${re}`);
    }
    const bot = read('src/bot/bot.js');
    assert.ok(!/Har kuni \$\{|Bugungi bepul AI huquqiy javoblar/u.test(bot));
  });

  await test('the bot\'s plan lines are built from the catalogue', () => {
    const texts = require('../src/bot/tariff-texts');
    const lines = texts.planLines().join('\n');
    assert.match(lines, /Sinov — bepul, bir martalik: 5 huquqiy savol \+ 1 hujjat tahlili \+ 1 yuridik xulosa \(yangilanmaydi\)/u);
    assert.match(lines, /Silver — 199 000 so'm \/ 30 kun: 150 savol, 8 tahlil, 8 xulosa, 10 hujjat/u);
    assert.match(lines, /Gold — 599 000 so'm \/ 30 kun: 450 savol, 24 tahlil, 24 xulosa, 30 hujjat/u);
    assert.match(lines, /Platinum — 999 000 so'm \/ 30 kun: 750 savol, 40 tahlil, 40 xulosa, 50 hujjat, Workspace yaratish/u);
  });

  await test('/balance shows each service left, the period, and Stars credits apart', () => {
    const texts = require('../src/bot/tariff-texts');
    const t = texts.balanceText({
      balance: { kind: 'paid', plan: 'gold', startsAt: '2026-10-04T05:00:00Z', endsAt: '2026-11-03T05:00:00Z',
        services: { chat: { limit: 450, used: 10, remaining: 440 }, analysis: { limit: 24, used: 0, remaining: 24 }, opinion: { limit: 24, used: 3, remaining: 21 }, draft: { limit: 30, used: 0, remaining: 30 }, ocr: { limit: 240, used: 0, remaining: 240 } } },
      paidCredits: 3,
    });
    assert.match(t, /Tarif: Gold, davr 04\.10\.2026 — 03\.11\.2026/u);
    assert.match(t, /huquqiy savol: 440 \/ 450 qoldi/u);
    assert.match(t, /Telegram Stars bilan sotib olingan javob kreditlari: 3 \(alohida hisob/u);
    assert.match(t, /avtomatik qayta sotib olinmaydi/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
