'use strict';

/**
 * Account actions of the Telegram agent (src/agents/account-tools.js): fixed,
 * read-only tools on the caller's own data or links. Fake database and
 * services - no network, no AI.
 *
 *   node tests/account-tools.test.js
 */

const assert = require('assert');
const t = require('../src/agents/account-tools');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  await test('detection: account phrases (uz/ru, as voice transcripts read) find their tool; legal stories and login problems do not', () => {
    for (const [q, tool] of [['Limitim qancha?', 'balance'], ['nechta savol qoldi', 'balance'], ['Сколько вопросов осталось?', 'balance'],
      ["Tariflarni ko'rsat", 'plans'], ['Gold tarifi qancha turadi?', 'plans'], ['тарифы', 'plans'],
      ['oxirgi savollarim', 'recent'], ['мои последние вопросы', 'recent'],
      ['Saytdagi akkauntimni telegramga ulash', 'link_account'], ['ilovani och', 'open_app'], ['nima qila olasan?', 'commands']]) {
      assert.strictEqual(t.detectAccountAction(q), tool, q);
    }
    for (const q of ['Elektr tarifi oshdi, nima qilaman?', 'Bank kredit limitini kamaytirdi, qonuniymi?', 'Saytga kira olmayapman', 'Parolni unutdim',
      'Ish beruvchi tarif stavkasi bo\'yicha kam haq to\'ladi', 'Mehnat shartnomasi bo\'yicha savolim bor, limit bormi?']) {
      assert.strictEqual(t.detectAccountAction(q), null, q);
    }
    assert.strictEqual(t.detectAccountAction('limit ' + 'x'.repeat(100)), null, 'a long message is not a balance request');
  });

  await test('the model\'s action is kept only when it is a tool', () => {
    assert.strictEqual(t.toolFromIntent({ action: 'Balance' }), 'balance');
    // delete_account only asks for a confirmation button (src/bot/bot.js); nothing is deleted by the tool
    assert.strictEqual(t.toolFromIntent({ action: 'delete_account' }), 'delete_account');
    for (const a of ['grant_plan', 'pay', '', null]) assert.strictEqual(t.toolFromIntent({ action: a }), null, String(a));
  });

  await test('balance reads the caller\'s own allowance (the /balance text)', async () => {
    const seen = {};
    const r = await t.runAccountTool('balance', { chatId: 5, who: { telegramUserId: 5, adminId: 9 }, deps: {
      economy: { getTelegramAnswerStatus: async (chat, who) => { seen.chat = chat; seen.who = who; return { paidCredits: 2, pending: false }; } },
      ledger: { balance: async (who) => { seen.ledgerWho = who; return { plan: 'silver' }; } },
      texts: { balanceText: (o) => `BAL ${o.balance.plan} ${o.paidCredits}` },
    } });
    assert.deepStrictEqual([r.action, r.reply, seen.chat, seen.ledgerWho.adminId], ['tool_balance', 'BAL silver 2', 5, 9]);
  });

  await test('recent: only this Telegram user\'s questions, newest first, 5 at most, from a read query', async () => {
    let q;
    const db = { query: async (sql, p) => { q = { sql, p }; return { rows: [{ request_text: 'Ish haqi kechiktirilsa nima qilaman?', created_at: '2026-10-20T05:00:00Z' }] }; } };
    const r = await t.runAccountTool('recent', { chatId: 77, who: { telegramUserId: 77 }, deps: { db } });
    assert.ok(/^\s*SELECT/iu.test(q.sql) && /u\.telegram_id = \$1/u.test(q.sql) && /LIMIT 5/u.test(q.sql));
    assert.deepStrictEqual(q.p, [77]);
    assert.ok(/1\. 20\.10 10:00 — Ish haqi kechiktirilsa/u.test(r.reply), r.reply);
    const empty = await t.runAccountTool('recent', { chatId: 1, lang: 'ru', deps: { db: { query: async () => ({ rows: [] }) } } });
    assert.ok(/нет вопросов/u.test(empty.reply));
  });

  await test('link and app: links only; plans: the catalogue and the tariff page (payment is confirmed on the site, never here)', async () => {
    assert.ok(/allaqachon ulangan/u.test((await t.runAccountTool('link_account', { chatId: 1, who: { adminId: 3 } })).reply));
    assert.ok(/Telegram'ni ulash/u.test((await t.runAccountTool('link_account', { chatId: 1, who: {} })).reply));
    const plans = await t.runAccountTool('plans', { chatId: 1 });
    assert.ok(/Sinov/u.test(plans.reply) && /tariff\.html/u.test(plans.reply) && /avtomatik yechib olinmaydi/u.test(plans.reply));
    assert.ok(/\/app\//u.test((await t.runAccountTool('open_app', { chatId: 1 })).reply));
  });

  await test('no tool writes: the module has no INSERT, UPDATE or DELETE', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/agents/account-tools.js'), 'utf8');
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/u.test(src));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
