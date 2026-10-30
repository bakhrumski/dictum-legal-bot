'use strict';

/**
 * "Hujjatlarim" in the bot (2026-10-30, src/bot/telegram-library.js): a
 * linked account's library is listed in the chat - names, pages, dates, never
 * a document's text - with a button a document; its card names the analysis
 * units and its analysis runs the same paid flow as a file sent to the bot;
 * another account's document is "not found"; a file sent by a linked account
 * is kept in the same library.
 *
 *   node tests/telegram-library.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lib = require('../src/bot/telegram-library');
const ledger = { docUnits: ({ pages, chars }) => ({ units: Math.max(1, Math.ceil(Math.max((pages || 1) / 10, (chars || 0) / 40000))) }) };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, extra = {}) => ({ id: id(n), name: `Ijara shartnomasi ${n}.docx`, kind: 'text', pages: 3, chars: 12000, bytes: 9000, created_at: '2026-10-29T08:00:00Z', last_used_at: null, ...extra });
const listPool = rows => ({ query: async (sql) => { assert.match(sql, /FROM document_scans/u); assert.ok(!/\btext\b,/u.test(sql.split('FROM')[0]), 'the list never reads the text'); return { rows }; } });

function fakeBot() {
  const sent = [], answers = [];
  return { sent, answers, sendMessage: async (chat, text, opts) => { sent.push({ chat, text, opts }); }, answerCallbackQuery: async (qid, o) => { answers.push(o || {}); } };
}

(async () => {
  console.log('Telegram: Hujjatlarim');

  await test('the list: names, pages, dates and one button a document - never a text; empty and long lists say so', async () => {
    const out = await lib.listFor(listPool([row(1), row(2, { name: null })]), 7);
    assert.match(out.reply, /Hujjatlaringiz \(oxirgi 2 tasi\)/u);
    assert.match(out.reply, /1\. Ijara shartnomasi 1\.docx — 3 bet · 29\.10\.2026/u);
    assert.match(out.reply, /2\. Nomsiz hujjat/u);
    assert.deepStrictEqual(out.docs.map(d => d.id), [id(1), id(2)]);
    const kb = lib.listKeyboard(out.docs, out.url);
    assert.deepStrictEqual(kb.inline_keyboard[0].map(b => b.callback_data), [`tglo_${id(1)}`, `tglo_${id(2)}`]);
    assert.ok(kb.inline_keyboard.flat().every(b => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64), 'Telegram callback limit');
    assert.match(kb.inline_keyboard[1][0].url, /\/app\/#\/hujjatlarim$/u);
    assert.match((await lib.listFor(listPool([]), 7)).reply, /hali hujjat yo'q[\s\S]*PDF yoki Word faylni shu yerga yuboring/u);
    const many = await lib.listFor(listPool(Array.from({ length: 11 }, (_, i) => row(i + 1))), 7);
    assert.strictEqual(many.docs.length, lib.LIST_MAX);
    assert.match(many.reply, /yana 3 tasi saytda/u);
    assert.match((await lib.listFor(listPool([row(1)]), 7, 'ru')).reply, /Ваши документы/u);
  });

  const docPool = (owner) => ({
    calls: [],
    async query(sql, args) {
      this.calls.push(sql);
      if (/^SELECT \* FROM document_scans WHERE id = \$1 AND admin_id = \$2/u.test(sql)) {
        return { rows: args[1] === owner ? [{ ...row(1), admin_id: owner, file_hash: 'h', library: true, text: 'Ijara shartnomasi matni' }] : [] };
      }
      return { rows: [] };
    },
  });
  const q = data => ({ id: 'cb', data, from: { id: 55 }, message: { chat: { id: 55 } } });

  await test('a document\'s card names its analysis units; the analysis runs the paid flow with the text and no lawyer file', async () => {
    const bot = fakeBot(); const runs = [];
    const flow = lib.createLibraryFlow({ bot, pool: docPool(7), ledger, linkedAccount: async () => ({ id: 7, role: 'user' }),
      documentFlow: { runAnalysis: async (chatId, o) => { runs.push({ chatId, o }); } } });
    assert.strictEqual(await flow.onCallback(q(`tglo_${id(1)}`)), true);
    assert.match(bot.sent[0].text, /Ijara shartnomasi 1\.docx\n3 bet · 12\s000 belgi/u);
    assert.match(bot.sent[0].text, /Birlik faqat tahlil tayyor bo'lganda yechiladi; xatoda qaytariladi/u);
    assert.deepStrictEqual(bot.sent[0].opts.reply_markup.inline_keyboard[0][0], { text: '🤖 AI tahlil — 1 birlik', callback_data: `tgla_${id(1)}` });
    assert.strictEqual(runs.length, 0, 'the card itself runs nothing');
    await flow.onCallback(q(`tgla_${id(1)}`));
    assert.deepStrictEqual([runs[0].chatId, runs[0].o.text, runs[0].o.units, runs[0].o.file], [55, 'Ijara shartnomasi matni', 1, null]);
    assert.strictEqual(await flow.onCallback(q('something_else')), false);
  });

  await test('another account\'s document is not found; with no linked account nothing is read', async () => {
    const bot = fakeBot(); const runs = [];
    const pool = docPool(7);
    const flow = lib.createLibraryFlow({ bot, pool, ledger, linkedAccount: async () => ({ id: 8, role: 'user' }), documentFlow: { runAnalysis: async () => runs.push(1) } });
    await flow.onCallback(q(`tgla_${id(1)}`));
    assert.deepStrictEqual([runs.length, bot.sent.length, bot.answers[0].show_alert], [0, 0, true]);
    assert.match(bot.answers[0].text, /topilmadi/u);
    const none = lib.createLibraryFlow({ bot: fakeBot(), pool: docPool(7), ledger, linkedAccount: async () => null, documentFlow: { runAnalysis: async () => runs.push(1) } });
    await none.onCallback(q(`tgla_${id(1)}`));
    assert.strictEqual(runs.length, 0);
  });

  await test('the paid flow: a library document without units gets no lawyer-queue button; a sent file is kept in the library', async () => {
    const { createDocumentFlow } = require('../src/bot/telegram-documents');
    const bot = fakeBot();
    const flow = createDocumentFlow({ bot, ledger: { ...ledger, reserve: async () => ({ allowed: false }) }, identityOf: async () => ({ adminId: 7, telegramUserId: 55 }), getAnalyzer: () => async () => ({}) });
    await flow.runAnalysis(55, { text: 'x', units: 2, fileName: 'a', file: null }, q('tgla'));
    assert.ok(!JSON.stringify(bot.sent[0].opts).includes('tgdoc_lawyer'));
    assert.ok(!flow._offers.has(55), 'no stale offer');
    const src = fs.readFileSync(path.join(__dirname, '../src/bot/telegram-documents.js'), 'utf8');
    assert.match(src, /if \(deps\.saveToLibrary\) await deps\.saveToLibrary\(msg, \{ buf, read \}\)/u);
    const bot2 = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot2, /saveToLibrary: async \(msg, \{ buf, read \}\) => \{[\s\S]{0,400}scanStore\.saveScan\(pool, \{ adminId: account\.id/u);
    assert.match(bot2, /if \(await libraryFlow\.onCallback\(callbackQuery\)\) return;/u);
    assert.match(bot2, /action === 'tool_documents_list'/u);
    const agent = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(agent, /page\.action === 'documents'[\s\S]{0,900}lib\.listFor\(pool, account\.id, page\.lang\)/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
