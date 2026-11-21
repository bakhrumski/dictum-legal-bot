'use strict';

/**
 * A filled document reads as one orderly document (2026-11-03,
 * src/drafting/doc-layout.js, no AI): one script, written-out dates, no
 * repeated template words, captions on their own line's place, justified
 * body paragraphs with a 1 cm first-line indent in the Word file.
 *
 *   node tests/doc-layout.test.js
 */

const assert = require('assert');
const JSZip = require('jszip');
const L = require('../src/drafting/doc-layout');
const { htmlToDocx } = require('../src/drafting/html-to-docx');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); }
}
const plain = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// the owner's sample, "Olib qo'yish bayonnomasi" (2026-11-03), as the template importer read it
const BODY = `<h2 style="text-align:center">Олиб қўйиш</h2><h2 style="text-align:center">Б А Ё Н Н О М А С И</h2>
<p>{{sana}}</p><p style="text-align:center">(кун, ой)</p><p>{{hudud}}</p><p style="text-align:center">(ҳудуд)</p>
<p>{{tergovchi}}, {{qaror_sana}}даги олиб қўйиш ҳақидаги қарорга асосан, холислар: {{xolis1}} ва {{xolis2}}лар иштирокида ўтказдим.</p>
<p>1. ________ {{xolis1}}</p><p>2. ________ {{xolis2}}</p><p style="text-align:center">(имзо)</p><p style="text-align:center">(имзо)</p>
<p>– {{ashyo}}, IMEI рақами {{imei}}, {{sim}} рақамли «Ucell» SIM-картаси солинган.</p>
<p>Холислар:</p><p style="text-align:center">(имзо)</p><p>{{xolis1}}</p><p style="text-align:center">(имзо)</p><p>{{xolis2}}</p>
<p>Жабрланувчи:</p><p>______ (имзо)</p><p>{{jab}}</p>`;
const FIELDS = [{ key: 'sana', type: 'date' }, { key: 'qaror_sana', type: 'date' }];
const VALUES = {
  sana: '2026-09-30', qaror_sana: '2026-09-30', hudud: 'Mirobod', tergovchi: 'Katta tergovchi B. Bekjonov',
  xolis1: "Xoliqov Jasur Baxtiyor o'g'li", xolis2: 'Usmonova Madina Shavkat qizi ', jab: 'Umidillayev N.B.',
  ashyo: "Telefon, xotira kartasi yo'q.", imei: 'IMEI raqami 356789012345678', sim: '+998 90 679 97 69 raqamli «Ucell» SIM-kartasi solingan',
};

(async () => {
  console.log('doc layout');
  await test('Cyrillic <-> Latin, Uzbek letters and capitals', async () => {
    assert.strictEqual(L.cyrToLat('Олиб қўйиш, Ўзбекистон, ЖПКнинг, ер, маълумот, милиция'), 'Olib qo‘yish, O‘zbekiston, JPKning, yer, ma’lumot, militsiya');
    assert.strictEqual(L.cyrToLat('Б А Ё Н Н О М А С И'), 'B A YO N N O M A S I');
    assert.strictEqual(L.latToCyr('Xoliqov o‘g‘li ko‘chasi, shox, choy, yer'), 'Холиқов ўғли кўчаси, шох, чой, ер');
    assert.strictEqual(L.latToCyr('IMEI, iPhone, Telecom'), 'IMEI, iPhone, Telecom', 'brand-like words stay');
  });
  await test('the filled sample is in ONE script (the one the values were typed in)', async () => {
    const h = L.renderOrderly({ body: BODY, fields: FIELDS, lang: 'uz' }, VALUES);
    assert.ok(!/[Ѐ-ӿ]/u.test(plain(h)), 'no Cyrillic left: ' + (plain(h).match(/\S*[Ѐ-ӿ]\S*/u) || [])[0]);
    assert.ok(plain(h).includes('Olib qo‘yish'));
    assert.ok(plain(h).includes('Xoliqov Jasur Baxtiyor o‘g‘li'), 'apostrophes made one form');
    const cyr = L.renderOrderly({ body: '<p>Ҳудуд: {{h}}</p>', fields: [], lang: 'uz' }, { h: 'Миробод' });
    assert.strictEqual(plain(cyr), 'Ҳудуд: Миробод', 'Cyrillic values keep a Cyrillic template');
    const ru = L.renderOrderly({ body: '<p>Истец: {{h}}</p>', fields: [], lang: 'ru' }, { h: 'Ivanov' });
    assert.strictEqual(plain(ru), 'Истец: Ivanov', 'a Russian document is never transliterated');
  });
  await test('dates written out, values trimmed, template words not repeated', async () => {
    const h = plain(L.renderOrderly({ body: BODY, fields: FIELDS, lang: 'uz' }, VALUES));
    assert.ok(h.includes('2026 yil 30 sentyabrdagi'), h.slice(0, 200));
    assert.ok(!h.includes('2026-09-30'));
    assert.ok(h.includes('qizilar ishtirokida'), 'a trailing space does not split a suffix');
    assert.ok(h.includes('IMEI raqami 356789012345678') && !/IMEI raqami IMEI/i.test(h));
    assert.ok(/\+998 90 679 97 69 raqamli «Ucell» SIM-kartasi solingan\./.test(h) && !/solingan raqamli/.test(h));
    assert.ok(h.includes('yo‘q, IMEI'), 'value full stop before the template comma dropped');
    assert.strictEqual(L.formatDate('2026-01-05', { script: 'cyr' }), '2026 йил 5 январь');
    assert.strictEqual(L.formatDate('2026-01-05', { script: 'cyr', lang: 'ru' }), '05.01.2026');
    assert.strictEqual(L.cleanValue('Toshkent , Mirobod '), 'Toshkent, Mirobod');
  });
  await test('captions sit on their line: under the blank, or between role and name', async () => {
    const laid = L.layoutCaptions(L.renderOrderly({ body: BODY, fields: FIELDS, lang: 'uz' }, VALUES));
    const tables = laid.match(/<table class="jai-sign"[\s\S]*?<\/table>/g) || [];
    assert.strictEqual(tables.length, 3, tables.map(plain).join(' || '));
    assert.strictEqual(plain(tables[0]), '2026 yil 30 sentyabr (kun, oy) Mirobod (hudud)');
    assert.strictEqual(plain(tables[1]), '1. ________ Xoliqov Jasur Baxtiyor o‘g‘li (imzo) 2. ________ Usmonova Madina Shavkat qizi (imzo)');
    assert.ok(/<tr>.*Xolislar:.*\(imzo\).*Xoliqov.*<\/tr><tr>.*\(imzo\).*Usmonova.*<\/tr>/.test(tables[2]));
    assert.ok(/<tr>.*Jabrlanuvchi:.*______ \(imzo\).*Umidillayev N\.B\..*<\/tr><\/table>$/.test(tables[2]), 'the next role joins the same signature table');
    assert.ok(!/<p[^>]*>\s*\((imzo|kun, oy|hudud)\)\s*<\/p>\s*(?!<\/td>)/.test(laid.replace(/<td[\s\S]*?<\/td>/g, '')), 'no caption left on a line of its own');
  });
  await test('text with no captions is left exactly as it was', async () => {
    const h = '<p>Birinchi band.</p><p>(1) ikkinchi band matni, uzunroq jumla bilan davom etadi va tugaydi.</p><ul><li>a</li></ul>';
    assert.strictEqual(L.layoutCaptions(h), h);
  });
  await test('Word: body justified with a 1 cm first-line indent, signature rows without borders', async () => {
    const laid = L.layoutCaptions(L.renderOrderly({ body: BODY, fields: FIELDS, lang: 'uz' }, VALUES));
    const buf = await htmlToDocx(laid, { title: 'Bayonnoma', legal: true });
    const doc = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
    const body = doc.match(/<w:p><w:pPr>(?:(?!<\/w:p>).)*?tergovchi B\. Bekjonov/)[0];
    assert.ok(/<w:ind w:firstLine="567"\/><w:jc w:val="both"\/>/.test(body), body.slice(0, 200));
    assert.ok(/<w:pStyle w:val="Heading2"\/><w:jc w:val="center"\/>/.test(doc), 'headings keep their centring');
    assert.ok(doc.includes('<w:top w:val="none"'), 'signature table has no borders');
    assert.ok(!/<w:tc>(?:(?!<\/w:tc>).)*w:firstLine/.test(doc), 'no indent inside a table cell');
    const plainDoc = await htmlToDocx('<p>Oddiy matn.</p>', {});
    const d2 = await (await JSZip.loadAsync(plainDoc)).file('word/document.xml').async('string');
    assert.ok(!d2.includes('firstLine') && !d2.includes('w:val="both"'), 'without legal: unchanged (the editor export)');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
