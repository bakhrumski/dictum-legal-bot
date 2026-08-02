'use strict';

/**
 * Tests for section selection inside a resolved lex.uz act
 * (extractRelevantSections in src/rag/lex-live-search.js).
 *
 * Why this matters: the search query that FINDS an act is its document number,
 * and that number only ever appears in the act's preamble. Scoring sections by
 * the query therefore returned the title page of every act — so a report
 * relying on "55 va 69-modda" got an opinion grounded on the cover sheet.
 * Callers now pass scoreText (the claims), and explicitly cited articles
 * outrank keyword overlap.
 *
 *   node tests/lex-excerpt.test.js
 */

const assert = require('assert');
const Module = require('module');

// extractRelevantSections is module-private; load the module and reach it via
// searchLexUz's excerpt path would need network, so pull it out directly.
const path = require.resolve('../src/rag/lex-live-search');
const src = require('fs').readFileSync(path, 'utf8');
const m = new Module(path);
m.filename = path;
m.paths = Module._nodeModulePaths(require('path').dirname(path));
m._compile(src + '\nmodule.exports.__extractRelevantSections = extractRelevantSections;', path);
const { __extractRelevantSections: extract } = m.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const ACT = [
  'DAVLAT XARIDLARI TO‘G‘RISIDA',
  'O‘zbekiston Respublikasi Qonuni, 2021-yil 22-apreldagi O‘RQ-684-son',
  'Ushbu Qonun davlat xaridlari sohasidagi munosabatlarni tartibga soladi.',
  '',
  '1-modda. Ushbu Qonunning maqsadi',
  'Ushbu Qonunning maqsadi davlat xaridlari sohasidagi munosabatlarni tartibga solishdan iborat.',
  '',
  '2-modda. Davlat xaridlari to‘g‘risidagi qonunchilik',
  'Davlat xaridlari to‘g‘risidagi qonunchilik ushbu Qonun va boshqa hujjatlardan iborat.',
  '',
  '55-modda. Tender komissiyasi',
  'Tender komissiyasi takliflarni ko‘rib chiqadi va g‘olibni aniqlaydi.',
  '',
  '69-modda. Yagona taklif',
  'Yagona taklif bo‘lganda xarid tartib-taomili yakunlanmagan deb e’tirof etiladi.',
  '',
  '80-modda. Yakuniy qoidalar',
  'Ushbu Qonun rasmiy e’lon qilingan kundan e’tiboran kuchga kiradi.',
].join('\n');

console.log('\nlex excerpt targeting\n');

test('an explicitly cited article is selected over the preamble', () => {
  const out = extract(ACT, '69-modda yagona taklif', 400);
  assert.ok(/69-modda/.test(out), `69-modda missing:\n${out}`);
  assert.ok(!/^DAVLAT XARIDLARI TO/.test(out.trim()), 'returned the title page instead');
});

test('a multi-article citation pulls BOTH articles', () => {
  const out = extract(ACT, '55 va 69-moddalariga ko‘ra yagona taklif bo‘lganda tender yakunlanmaydi', 800);
  assert.ok(/55-modda/.test(out), `55-modda missing:\n${out}`);
  assert.ok(/69-modda/.test(out), `69-modda missing:\n${out}`);
});

test('a bare document number no longer decides the excerpt', () => {
  // The old behaviour: query = "684-сон" → keywords miss every article →
  // preamble. The number is still harmless, but claims must win when present.
  const withClaims = extract(ACT, '684-son 69-modda yagona taklif', 400);
  assert.ok(/69-modda/.test(withClaims), `claims did not win:\n${withClaims}`);
});

test('Russian "статья N" form is recognised', () => {
  const RU = '\nСтатья 12. Общие положения\nТекст статьи двенадцать.\n\nСтатья 40. Заключение\nТекст статьи сорок.';
  const out = extract(RU, 'статья 40', 200);
  assert.ok(/Статья 40/.test(out), `статья 40 missing:\n${out}`);
});

test('falls back to keyword scoring when no article is named', () => {
  const out = extract(ACT, 'tender komissiyasi g‘olibni aniqlaydi', 400);
  assert.ok(/Tender komissiyasi/.test(out), out);
});

test('empty query returns the head of the document, not nothing', () => {
  const out = extract(ACT, '', 120);
  assert.strictEqual(out.length, 120);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
