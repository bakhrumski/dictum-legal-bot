'use strict';

/**
 * 2026-10-21 audit fixes: Telegram linking for paid accounts, plan messages
 * in the bot, the admin page's order and Hermes bugs, and voice (dictation,
 * the recordings page saying why it cannot transcribe, VoiceLab language).
 * Source checks plus fake-database units - no network.
 *
 *   node tests/linking-voice-fixes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
  const bot = read('src/bot/bot.js');
  const server = read('src/api/server.js');

  await test('website status: a paid account linked to Telegram shows as linked (columns read directly)', () => {
    assert.match(server, /SELECT \(telegram_user_id IS NOT NULL OR telegram_chat_id IS NOT NULL\) AS linked FROM admins WHERE id = \$1/u);
    assert.match(server, /telegramLinked: !!\(link && link\.linked\) \|\| !!acc\.telegramLinked/u);
  });

  await test('ulink_: a Telegram held by another account by either column is refused with the way out; the old chat is detached; paid plan named', () => {
    assert.match(bot, /WHERE \(telegram_user_id = \$1 OR telegram_chat_id = \$1\) AND id <> \$2/u);
    assert.match(bot, /shu chatda \/unlink yuboring/u);
    assert.match(bot, /telegram_chat_id = CASE WHEN \$4 THEN \$1::bigint ELSE NULL END/u);
    assert.match(bot, /Telegram akkauntingizga ulandi\. Tarif:/u);
  });

  await test('/unlink: private chat only, clears both columns', () => {
    assert.match(bot, /SET telegram_chat_id = NULL, telegram_user_id = NULL\s+WHERE telegram_chat_id = \$1 OR telegram_user_id = \$2/u);
    assert.match(bot, /\/unlink[\s\S]{0,200}msg\.chat\.type !== 'private'/u);
  });

  await test('/link: private only, one reply for wrong login or password, 5 tries per 15 minutes, both columns checked', () => {
    assert.match(bot, /parolni guruhga yozmang/u);
    assert.match(bot, /if \(tries\.n >= 5\)/u);
    assert.match(bot, /❌ Login yoki parol noto'g'ri\./u);
    assert.doesNotMatch(bot, /Username topilmadi/u);
    assert.match(bot, /\(telegram_chat_id = \$1 OR telegram_user_id = \$3\) AND id != \$2/u);
  });

  await test('bot linking instructions: sign in with the account\'s own login, never via Telegram (which would open a new account)', async () => {
    const tools = require('../src/agents/account-tools');
    const r = await tools.runAccountTool('link_account', { chatId: 1, who: {} });
    assert.match(r.reply, /o'z login va parolingiz \(yoki Google\) bilan kiring/u);
    assert.match(r.reply, /\/unlink/u);
  });

  const { createPlanNotifier, grantedText, expiringText } = require('../src/services/plan-notify');
  const catalog = require('../src/rag/tariff-ledger').PLAN_CATALOG;

  await test('plan messages: granted, and 3 days / 1 day before the end, once each, only to a linked ordinary account', async () => {
    const sent = [], notices = new Set();
    const now = new Date('2026-10-21T06:00:00Z');
    const db = { async query(sql, p = []) {
      if (/FROM admins WHERE id = \$1 AND role = 'user'/.test(sql)) return { rows: p[0] === 5 ? [{ chat: 555 }] : [] };
      if (/FROM tariff_periods p/.test(sql)) return { rows: [
        { id: 10, admin_id: 5, plan: 'gold', ends_at: new Date(now.getTime() + 20 * 3600e3) },
        { id: 11, admin_id: 6, plan: 'silver', ends_at: new Date(now.getTime() + 60 * 3600e3) },
      ] };
      if (/INSERT INTO tariff_expiry_notices/.test(sql)) { const k = `${p[0]}:${p[1]}`; if (notices.has(k)) return { rows: [] }; notices.add(k); return { rows: [{ period_id: p[0] }] }; }
      return { rows: [] };
    } };
    const n = createPlanNotifier({ db, send: async (chat, text) => sent.push({ chat, text }), catalog });
    assert.strictEqual(await n.granted({ adminId: 5, plan: 'gold', startsAt: now, endsAt: new Date(now.getTime() + 30 * 864e5) }), true);
    assert.match(sent[0].text, /Gold tarifi faollashtirildi/u);
    assert.match(sent[0].text, /450 ta savol/u);
    assert.strictEqual(await n.granted({ adminId: 6, plan: 'silver', startsAt: now, endsAt: now }), false, 'not linked: no message');
    assert.strictEqual(await n.sweep(now), 1, 'period 11 belongs to an unlinked account');
    assert.match(sent[1].text, /ertaga/u);
    assert.match(sent[1].text, /Avtomatik to'lov olinmaydi/u);
    assert.strictEqual(await n.sweep(now), 0, 'once');
    process.env.PLAN_NOTIFY = 'off';
    assert.strictEqual(await n.sweep(now), 0);
    delete process.env.PLAN_NOTIFY;
    assert.match(expiringText({ plan: 'silver', endsAt: now, days: 3, catalog }), /3 kundan keyin/u);
    assert.match(grantedText({ plan: 'silver', startsAt: now, endsAt: now, catalog }), /150 ta savol, 8 ta tahlil/u);
    assert.match(server, /planNotifier\.granted\(\{ adminId: Number\(adminId\), plan/u);
    assert.match(server, /planNotifier\.start\(\);/u);
  });

  await test('admin: changing an order without a lawyer field keeps the lawyer; price changes save; Hermes rate is not multiplied twice', () => {
    assert.match(server, /const keepLawyer = !Object\.prototype\.hasOwnProperty\.call\(req\.body \|\| \{\}, 'assigned_lawyer_id'\)/u);
    assert.match(server, /assigned_lawyer_id = CASE WHEN \$8 THEN assigned_lawyer_id ELSE \$3 END/u);
    const admin = read('public/app/admin.js');
    assert.match(admin, /\$\$\('\.so-p', box\)\.forEach\(function \(i\) \{ i\.onchange/u);
    assert.match(admin, /Math\.round\(Number\(s\.agreement_rate\)\) \+ '%'/u);
    assert.doesNotMatch(admin, /agreement_rate \* 100/u);
  });

  await test('voice: dictation endpoint (2 min, measured, rate-limited), mic button in chat, the page says why it cannot transcribe, VoiceLab gets a real language', () => {
    assert.match(server, /app\.post\('\/api\/voice\/dictate', require\('\.\.\/auth\/same-origin'\)\.requireSameOrigin, requireAuth/u);
    assert.match(server, /measured > VOICE_DICTATE_MAX_SEC \+ 5/u);
    assert.match(server, /'\/api\/voice\/dictate'\], aiLimiter\)/u);
    assert.match(server, /reason: !stt \? 'stt_not_configured' : !notes \? 'voice_notes_disabled' : !forUser \? 'staff_only' : null/u);
    const chat = read('public/app/chat.js');
    assert.match(chat, /data-a="mic" hidden/u);
    assert.match(chat, /J\.api\('\/api\/voice\/dictate'/u);
    assert.doesNotMatch(chat, /dictate[\s\S]{0,400}opts\.onSend\(/u, 'the text is never sent by itself');
    assert.match(read('public/app/voice.js'), /'vc\.off\.notes'/u);
    assert.match(read('src/ai/voicelab-speech.js'), /\(language && language !== 'auto'\) \? language/u);
    const i18n = read('public/app/i18n.js');
    for (const k of ['cmp.mic', 'vc.off.notes', 'vc.off.staff', 'vc.off.stt']) assert.strictEqual((i18n.match(new RegExp(`"${k.replace('.', '\\.')}":`, 'gu')) || []).length, 3, k);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
