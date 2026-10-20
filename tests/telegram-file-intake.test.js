'use strict';

/**
 * Files in Telegram (tariffs v2 review, 2026-10-06; AI path 2026-10-20): a
 * file on the lawyer path never reaches AI and uses no quota, and the user is
 * told so; a lawyer's review is not part of the plan and not promised free.
 * Since 2026-10-20 a PDF/DOCX may instead be analysed by AI, only after the
 * person presses the button that names the units (src/bot/telegram-documents.js,
 * covered by tests/landing-promises.test.js); scans, photos and video stay
 * with the lawyer queue and the website.
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

  await test('a file is never given to the AI agent; AI analysis only behind its own button, which names the units', () => {
    assert.match(bot, /if \(requestData\.request_type === 'text' \|\| requestData\.voiceTranscribed\) \{/u, 'only text (or a transcribed voice note) reaches the agent');
    assert.ok(!/meterDocument|meterJob|service: 'analysis'|service: 'opinion'/u.test(bot), 'the bot itself meters no document service');
    assert.ok((bot.match(/ledger\.reserve\(/gu) || []).length === 1 && /service: 'draft', units: 1/u.test(bot), 'the bot reserves only the AI draft unit, after its button');
    const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'telegram-documents.js'), 'utf8');
    assert.match(flow, /callback_data: 'tgdoc_ai'/u);
    assert.match(flow, /service: 'analysis'/u);
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
    assert.match(held, /Bu yo'lda fayl AI bilan tahlil qilinmaydi: murojaatingiz yurist navbatiga yuboriladi/u);
    assert.match(held, /kamida 20 belgi/u);
    assert.ok(!FREE.test(held));
    assert.match(bot, /tariffTexts\.fileHeldText\(\{ tooShortNote, minChars: MIN_FILE_DESC \}\)/u);
    const start = texts.startFileLine({ voiceToText: true });
    assert.match(start, /PDF yoki DOCX hujjat \(5 MB gacha\) yuborsangiz, AI tahlilni taklif qilaman — tarifingizdagi tahlil birligi bilan/u);
    assert.match(start, /fayl yurist navbatiga yuboriladi \(limitdan yechilmaydi\)/u);
    assert.match(start, /juristai\.uz saytida/u);
    assert.ok(!FREE.test(start));
    assert.match(bot, /tariffTexts\.startFileLine\(\{ voiceToText: voiceToTextEnabled\(\) \}\)/u);
    assert.ok(!/bunday murojaatlarni yurist ko'rib chiqadi/u.test(bot), 'the old line that lumped voice with files is gone');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
