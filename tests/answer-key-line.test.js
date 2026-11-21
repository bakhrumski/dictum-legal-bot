'use strict';

/**
 * The line that decides a status question (2026-10-27, owner): an IT Park
 * answer cited band 5 of VMQ-589 (the Ministry shall issue confirmations) and
 * said no exemption exists, while band 17 of its regulation lets a Texnopark
 * resident hire foreign specialists without the labour-activity
 * confirmation. The live excerpt held band 17, deep among the tax
 * privileges. Now (a) an act the server identified itself (pinned for a
 * named status, or the number asked) opens with its best-answering line and
 * that line's unit; (b) every legal-answer prompt says an exception or a
 * right in the sources comes first. Measured live on VMQ-589 with two
 * phrasings: band 17 both times. On general questions the line can mislead
 * (Labour Code: pay withheld during a strike, for unpaid wages), so it is
 * not added there. No network, no AI.
 *
 *   node tests/answer-key-line.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const BODY = [
  "5. Oʻzbekiston Respublikasi Bandlik va mehnat munosabatlari vazirligi Direksiyaning buyurtmanomalari boʻyicha Texnopark faoliyatini tashkil etishda ishtirok etuvchi yuqori malakali xorijiy mutaxassislarga mehnat faoliyatini amalga oshirish huquqiga tasdiqnomalar berilishini taʼminlasin.",
  '17. Texnopark rezidenti:',
  "tovarlar (ishlar, xizmatlar) eksportidan tushumlar doirasida xorijiy taʼsischilar va chet ellik mutaxassislariga dividendlar va ish haqi toʻlovlarini amalga oshirish;",
  "Oʻzbekiston Respublikasi hududida mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish;",
  '25. Quyidagi imtiyozlar taqdim etiladi:',
  "oʻz ehtiyojlari uchun olib kirilayotgan uskunalar uchun bojxona toʻlovlari toʻlashdan ozod etish;",
].join('\n');
const Q = 'Men IT park rezidentiman. Chet eldan ishchi olib kelish uchun tasdiqnoma kerakmi?';

(async () => {
  const ls = require('../src/rag/lex-live-search');

  await test('the key line: band 17 (an exception, read with its unit heading), not band 5 or the customs line', () => {
    const k = ls.findKeyLine(BODY, Q);
    assert.strictEqual(k.unit, '17-band');
    assert.match(k.line, /tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish/u);
    assert.strictEqual(ls.findKeyLine(BODY, 'kerakmi?'), null, 'fewer than two question roots: none');
  });

  await test('the excerpt opens with the line only when asked (keyLine), word for word, within maxChars', () => {
    assert.ok(!/SAVOLGA ENG YAQIN QATOR/u.test(ls.extractRelevantSections(BODY, Q, 4000)));
    const ex = ls.extractRelevantSections(BODY, Q, 4000, { keyLine: true });
    assert.match(ex, /^SAVOLGA ENG YAQIN QATOR \(17-band\) \[server so'zlar bo'yicha tanlagan - o'qing va tekshiring\]: Oʻzbekiston Respublikasi hududida mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish;\n\n/u);
    assert.ok(ls.extractRelevantSections(BODY, Q, 400, { keyLine: true }).length <= 400);
  });

  await test('search: a pinned act gets the line, an ordinary search result does not', async () => {
    const fl = require.resolve('../src/rag/fetch-lex');
    const lsPath = require.resolve('../src/rag/lex-live-search');
    delete require.cache[lsPath];
    const title = "Dasturiy mahsulotlar va axborot texnologiyalari texnologik parki faoliyatini tashkil etish chora-tadbirlari to'g'risida";
    require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
      httpGet: async () => `<table><tbody><tr><td><a href="/docs/-9">${title}</a></td></tr></tbody></table>`,
      fetchLexDocument: async (url) => ({ title, body: BODY, metadata: { source_url: url, is_active: true } }),
    } };
    const mod = require(lsPath);
    const pinned = await mod.searchLexUz(title, { pinnedDocs: [{ url: 'https://lex.uz/docs/-4422250', expectedTitle: title, expectedTitles: [title] }], maxDocs: 1, scoreText: Q });
    assert.match(pinned[0].content, /^SAVOLGA ENG YAQIN QATOR \(17-band\)/u);
    mod.clearLexDocumentCache();
    const plain = await mod.searchLexUz('texnopark rezidenti', { maxDocs: 1, scoreText: Q });
    assert.ok(plain.length && !/SAVOLGA ENG YAQIN QATOR/u.test(plain[0].content));
    delete require.cache[fl]; delete require.cache[lsPath];
  });

  await test('every legal-answer prompt says: an exception or a right in the sources comes first', () => {
    const s = require('../src/rag/answer-structure');
    assert.match(s.promptRules('uz'), /- Istisno birinchi: KONTEKSTda savoldagi talabdan istisno/u);
    assert.match(s.promptRules('ru'), /- Сначала исключение/u);
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.strictEqual((server.match(/require\('\.\.\/rag\/answer-structure'\)\.exceptionRule\('uz'\)/gu) || []).length, 2, 'search prompt and Gemini fallback');
    assert.match(server, /require\('\.\.\/rag\/answer-structure'\)\.promptRules\(lexLangForText\(userQuestion\)\)/u, 'chat and Telegram');
    assert.match(require('../src/rag/system-prompt').buildAdvancedPrompt({ userQuestion: Q }), /Istisno birinchi/u, 'advanced RAG');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
})();
