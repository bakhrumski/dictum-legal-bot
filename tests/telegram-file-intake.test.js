'use strict';

/**
 * Files in Telegram (tariffs v2 review, 2026-10-06): the bot does not run AI
 * on a file - it goes to the lawyer queue - and the user is told so: no
 * analysis or opinion quota is used, a lawyer's review is not part of the
 * plan and not promised free, and the AI document services are on the
 * website (with a button to it).
 *
 *   node tests/telegram-file-intake.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const texts = require('../src/bot/tariff-texts');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const bot = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'bot.js'), 'utf8');
const FREE = /bepul|tekin|tarifga kiritilgan|tarifingizga kiradi|бесплатн/iu;

(async () => {
  console.log('Telegram files');

  await test('a file is never given to the AI agent and never reserves a document quota', () => {
    assert.match(bot, /if \(requestData\.request_type === 'text' \|\| requestData\.voiceTranscribed\) \{/u, 'only text (or a transcribed voice note) reaches the agent');
    assert.ok(!/ledger\.reserve|meterDocument|meterJob|service: 'analysis'|service: 'opinion'/u.test(bot), 'the bot itself meters no document service');
  });

  await test('after a file is queued: "not AI", no quota used, review not promised free or included, the website offered', () => {
    const t = texts.fileQueuedText({ typeLabel: 'Fayl' });
    assert.match(t, /yurist navbatiga yuborildi/u);
    assert.match(t, /Bu AI tahlili emas/u);
    assert.match(t, /tahlil yoki xulosa limitidan hech narsa yechilmadi/u);
    assert.match(t, /Yurist ko'rigi tarif limitlariga kirmaydi; uning shartlari, agar pullik bo'lsa, yurist bilan alohida kelishiladi/u);
    assert.ok(!FREE.test(t), 'no promise that a lawyer review is free or included');
    assert.match(t, /AI yuridik xulosa olish — saytda: hujjat birligida, sarf ish boshlanishidan oldin ko'rsatiladi/u);
    const kb = texts.fileQueuedKeyboard('https://juristai.uz/dashboard.html');
    assert.deepStrictEqual(kb.inline_keyboard[0][0], { text: '💻 Saytda AI tahlil yoki xulosa', url: 'https://juristai.uz/dashboard.html' });
    assert.strictEqual(texts.fileQueuedKeyboard('not a url'), null);
  });

  await test('the bot sends that text, with the button, for documents, photos and videos', () => {
    assert.deepStrictEqual([...texts.FILE_TYPES].sort(), ['document', 'photo', 'video', 'video_note']);
    assert.match(bot, /else if \(!agentDelivered && tariffTexts\.FILE_TYPES\.has\(requestData\.request_type\)\) \{[\s\S]*?tariffTexts\.fileQueuedKeyboard\(dashboardUrl\(\)\)[\s\S]*?tariffTexts\.fileQueuedText\(/u);
  });

  await test('the user is told before describing the file, and in /start', () => {
    const held = texts.fileHeldText({ tooShortNote: '', minChars: 20 });
    assert.match(held, /Telegram'da fayllar AI bilan tahlil qilinmaydi: murojaatingiz yurist navbatiga yuboriladi/u);
    assert.match(held, /kamida 20 belgi/u);
    assert.ok(!FREE.test(held));
    assert.match(bot, /tariffTexts\.fileHeldText\(\{ tooShortNote, minChars: MIN_FILE_DESC \}\)/u);
    const start = texts.startFileLine({ voiceToText: true });
    assert.match(start, /uni AI o'qimaydi — murojaat yurist navbatiga tushadi; tarif limitingizdan hech narsa yechilmaydi/u);
    assert.match(start, /juristai\.uz saytida/u);
    assert.ok(!FREE.test(start));
    assert.match(bot, /tariffTexts\.startFileLine\(\{ voiceToText: voiceToTextEnabled\(\) \}\)/u);
    assert.ok(!/bunday murojaatlarni yurist ko'rib chiqadi/u.test(bot), 'the old line that lumped voice with files is gone');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
