'use strict';

/**
 * The 2026 Latin alphabet (OʻRQ-1184 of 21.10.2026: Oʻ → Ö, Gʻ → Ğ, Sh → Ş,
 * Ch → Ç). Text is shown in the new alphabet by default and in the old one
 * on request; inside, everything stays in the old one (lex.uz is written in
 * it), so a question typed in the new letters is read in the old ones. No
 * network.
 *
 *   node tests/uz-alphabet.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/js/uz-alphabet');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('uz alphabet');

  await test('old → new: oʻ gʻ sh ch in every apostrophe form and case', () => {
    assert.strictEqual(A.toNew("Oʻzbekiston: ish haqi oʻz vaqtida toʻlanadi, g'alaba, yo‘q, SHARTNOMA, Chorshanba"),
      'Özbekiston: iş haqi öz vaqtida tölanadi, ğalaba, yöq, ŞARTNOMA, Çorşanba');
  });

  await test('left alone: links, code, mixed-case names, act codes, separated s\'h, Cyrillic, a protected sample', () => {
    const t = "[Mehnat kodeksi](https://lex.uz/docs/-6257288#-shart) `chat_id` ash@mail.uz MChJ JuristAI PowerPoint OʻRQ-1184 Is'hoq Иш ҳақи";
    assert.strictEqual(A.toNew(t), t);
    assert.strictEqual(A.toNew('Eski: o‌ʻ s‌h'), 'Eski: o‌ʻ s‌h');
  });

  await test('new → old for search and checks; fold makes both the same', () => {
    assert.strictEqual(A.toOld('Iş haqi öz vaqtida tölanmadi, ŞARTNOMA, Çorşanba, ğalaba'), 'Ish haqi oʻz vaqtida toʻlanmadi, SHARTNOMA, Chorshanba, gʻalaba');
    assert.strictEqual(A.fold('Öz vaqtida ŞARTNOMA'), A.fold("Oʻz vaqtida SHARTNOMA"));
    assert.strictEqual(A.toOld('Иш ҳақи'), 'Иш ҳақи');
  });

  await test('the server reads a new-alphabet question in the old one: search, document clauses, matter commands', () => {
    const { normalizeUzbekForSearch } = require('../src/rag/search-utils');
    assert.strictEqual(normalizeUzbekForSearch('Ötgan ŞARTNOMA böyiça'), normalizeUzbekForSearch("O'tgan SHARTNOMA bo'yicha"));
    const { selectExcerpt } = require('../src/rag/document-job');
    const doc = 'IJARA SHARTNOMASI\n' + Array.from({ length: 300 }, (_, i) => `${i + 1}. Boshqa band matni ${'lorem ipsum '.repeat(8)}`).join('\n') + "\n301. Shartnoma muddati tugagach, ijarachi binoni qaytaradi.\n";
    assert.match(selectExcerpt(doc, 'Şartnoma muddati tugagaç nima böladi?', 4000).text, /Shartnoma muddati tugagach/u, 'a new-alphabet question finds an old-alphabet clause');
    const c = require('../src/matters/commands');
    assert.deepStrictEqual(c.parseCommand('Yangi iş oç: Pudratçi bilan nizo'), { action: 'create', title: 'Pudratchi bilan nizo' });
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /req\.body\.message = require\('\.\.\/\.\.\/public\/js\/uz-alphabet'\)\.toOld\(req\.body\.message\)/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8'), /const question = require\('\.\.\/\.\.\/public\/js\/uz-alphabet'\)\.toOld\(/u);
  });

  await test('the bot writes the new alphabet by default, offers the old one once, keeps a chat\'s choice; links and callback data untouched', async () => {
    const al = require('../src/bot/alphabet');
    const sent = [];
    const bot = { sendMessage: async (id, text, opts) => { sent.push({ id, text, opts }); return {}; }, editMessageText: async (text, opts) => { sent.push({ text, opts }); return {}; } };
    const store = new Map([['20', 'old']]);
    al.wrapBot(bot, { get: async (id) => store.get(String(id)) || null });
    await bot.sendMessage(10, 'Ish haqi [Mehnat kodeksi](https://lex.uz/docs/-1#-shart)');
    assert.strictEqual(sent[0].text, 'Iş haqi [Mehnat kodeksi](https://lex.uz/docs/-1#-shart)');
    assert.strictEqual(sent[0].opts.reply_markup.inline_keyboard[0][0].callback_data, 'alpha_old', 'the old alphabet offered once');
    await bot.sendMessage(10, 'Yana bir shart');
    assert.strictEqual(sent[1].opts, undefined, 'offered only once');
    await bot.sendMessage(10, 'Tanlang', { reply_markup: { inline_keyboard: [[{ text: 'Shartnoma', callback_data: 'doc_shartnoma' }]] } });
    assert.deepStrictEqual(sent[2].opts.reply_markup.inline_keyboard[0][0], { text: 'Şartnoma', callback_data: 'doc_shartnoma' });
    await bot.sendMessage(20, 'Ish haqi');
    assert.strictEqual(sent[3].text, 'Ish haqi', 'a chat that chose the old alphabet');
    await bot.editMessageText('Ish holati', { chat_id: 10, message_id: 1 });
    assert.strictEqual(sent[4].text, 'Iş holati');
    assert.match(A.toNew(al.TEXT.ask), /Eski alifbo: O‌ʻ o‌ʻ, G‌ʻ g‌ʻ, S‌h s‌h, C‌h c‌h/u, 'the old letters are shown as they are');
  });

  await test('the profile keeps the alphabet choice (new by default)', () => {
    const p = require('../src/adaptive/profile');
    assert.deepStrictEqual(p.cleanManual({ alphabet: 'old', x: 1 }), { alphabet: 'old' });
    assert.deepStrictEqual(p.cleanManual({ alphabet: 'kirill' }), {});
    assert.strictEqual(p.effectiveOf({}, {}).alphabet, 'new');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
