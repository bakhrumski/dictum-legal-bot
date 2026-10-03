'use strict';

/**
 * Several acts in an answer are shown from the strongest down, and the one
 * that prevails is named (owner, 2026-10-03: the order of the Law
 * "Normativ-huquqiy hujjatlar to'g'risida").
 *
 *   node tests/legal-force.test.js
 */

const assert = require('assert');
const { legalForceOf, legalForceLabel, sortByLegalForce } = require('../src/rag/legal-force');
const { formatLexSearchResults } = require('../src/rag/lex-live-search');
const { getCoreLegalConstitution } = require('../src/rag/legal-prompt-policy');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const key = (item, id) => (legalForceOf(item, id) || { key: null }).key;

console.log('legal force');

test('the act\'s own number decides first', () => {
  assert.strictEqual(key({ law_name: "Mas'uliyati cheklangan jamiyatlar to'g'risida", document_number: "O'RQ-1137" }), 'qonun');
  assert.strictEqual(key({ title: 'Tadbirkorlikni qo‘llab-quvvatlash to‘g‘risida' }, 'PQ-4000'), 'prezident');
  assert.strictEqual(key({ title: 'X' }, 'PF-60'), 'prezident');
  assert.strictEqual(key({ title: 'X' }, 'VMQ-824'), 'vazirlar-mahkamasi');
  assert.strictEqual(key({ title: 'X' }, 'ЗРУ-798'), 'qonun');
  assert.strictEqual(key({ title: 'X', document_number: '310-II' }), 'qonun', 'a law before 2017: number with its convocation');
});

test('codes and the Constitution', () => {
  assert.strictEqual(key({ law_name: "O'zbekiston Respublikasining Mehnat kodeksi" }), 'qonun');
  assert.strictEqual(key({ law_name: "O'zbekiston Respublikasi Konstitutsiyasi" }), 'konstitutsiya');
  assert.strictEqual(key({ law_name: 'Конституция Республики Узбекистан' }), 'konstitutsiya');
  assert.strictEqual(key({ law_name: "Mehnat kodeksi", chunk_text: 'Konstitutsiyaga muvofiq' }), 'qonun', 'quoting the Constitution does not make an act one');
});

test('the act-form line beats a title that quotes a law', () => {
  assert.strictEqual(key({ title: "Mehnat to'g'risidagi qonunni amalga oshirish chora-tadbirlari to'g'risida",
    metadata: { act_form: 'VAZIRLAR MAHKAMASINING QARORI 23.09.2021' } }), 'vazirlar-mahkamasi');
  assert.strictEqual(key({ title: "Qonunni amalga oshirish to'g'risida Prezidentning qarori" }), 'prezident');
  assert.strictEqual(key({ title: 'Положение', metadata: { act_form: 'ПОСТАНОВЛЕНИЕ КАБИНЕТА МИНИСТРОВ' } }), 'vazirlar-mahkamasi');
});

test('the lower levels', () => {
  assert.strictEqual(key({ title: "Senatning qarori" }), 'palata');
  assert.strictEqual(key({ title: 'Qonunchilik palatasining qarori' }), 'palata');
  assert.strictEqual(key({ title: 'Prezident Administratsiyasi Rahbarining farmoyishi' }), 'administratsiya');
  assert.strictEqual(key({ title: 'Nizom', metadata: { act_form: "ADLIYA VAZIRLIGINING BUYRUG'I" } }), 'idoraviy');
  assert.strictEqual(key({ title: "Markaziy bankning nizomi" }), 'idoraviy');
  assert.strictEqual(key({ title: 'Toshkent shahar hokimining qarori' }), 'hokim');
});

test('an act whose form cannot be read gets no level, not a guess', () => {
  assert.strictEqual(key({ title: 'Nimadir' }), null);
  assert.strictEqual(legalForceLabel({ title: 'Nimadir' }), '');
});

test('labels in the answer\'s language', () => {
  assert.strictEqual(legalForceLabel({ title: 'X' }, 'uz', 'VMQ-1'), 'Yuridik kuchi: Vazirlar Mahkamasi qarori');
  assert.strictEqual(legalForceLabel({ title: 'X' }, 'ru', 'PQ-1'), 'Юридическая сила: Акт Президента');
});

test('sorting: strongest first, the rest keep their order', () => {
  const items = [
    { title: 'hokim', metadata: { act_form: 'Toshkent shahar hokimining qarori' } },
    { title: 'vm', document_number: 'VMQ-1' },
    { title: 'unknown' },
    { title: 'law', document_number: "O'RQ-1" },
    { title: 'pq', document_number: 'PQ-1' },
  ];
  assert.deepStrictEqual(sortByLegalForce(items).map(i => i.title), ['law', 'pq', 'vm', 'hokim', 'unknown']);
});

test('lex.uz live results carry their level into the prompt', () => {
  const out = formatLexSearchResults([{ title: "Tartib to'g'risida nizom", ownDocumentNumber: 'VMQ-824', content: '1. Band.', url: 'https://lex.uz/docs/-1' }], 'uz');
  assert.match(out, /\[LEX-1\] Tartib to'g'risida nizom\n {2}Yuridik kuchi: Vazirlar Mahkamasi qarori\n1\. Band\./u);
});

test('the constitution tells the answer to show every act and say which prevails', () => {
  const c = getCoreLegalConstitution();
  assert.match(c, /javob bittasi bilan cheklanmaydi/u);
  assert.match(c, /Prezident Administratsiyasi Rahbarining farmoyishlari/u);
  assert.match(c, /qaysi hujjat ustun ekani va nima uchun ochiq aytiladi/u);
  assert.match(c, /Prezidentning farmoni va qarori bir xil yuridik kuchga ega/u);
  assert.match(c, /Bir xil yuridik kuchga ega hujjatlar zid bo'lsa, eng keyingi sanada qabul qilingan hujjat ustun/u);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
