'use strict';
// Word / Google Docs panels: review reply parsing, quote search needles, edit proposals.
const assert = require('assert');
const S = require('../public/word/shared.js');
let failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.stack); } }
console.log('\nword-shared\n');

const REPLY = `Hujjat bo'yicha asosiy xavflar quyidagilar.

### IZOH 1
IQTIBOS: «Kechikkan har bir kun uchun 5% penya to'lanadi»
MUAMMO: Penya miqdori haddan tashqari yuqori.
ASOS: [FK 326-modda](https://lex.uz/docs/111189#326)
TAVSIYA: Penyani kamaytiring
va yuqori chegara qo'ying.
YANGI MATN: Kechikkan har bir kun uchun 0,1% penya to'lanadi

### **IZOH 2**
**IQTIBOS:** —
**MUAMMO:** Nizolarni hal qilish tartibi yo'q.
**ASOS:** —
**TAVSIYA:** Sud yoki arbitraj bandini qo'shing.
**YANGI MATN:** —

### XULOSA
Shartnomani imzolashdan oldin ikki bandni tuzatish kerak.`;

test('review reply splits into items and a summary', () => {
  const r = S.parseReview(REPLY);
  assert.strictEqual(r.items.length, 2);
  assert.strictEqual(r.items[0].quote, "Kechikkan har bir kun uchun 5% penya to'lanadi");
  assert.strictEqual(r.items[0].newText, "Kechikkan har bir kun uchun 0,1% penya to'lanadi");
  assert.match(r.items[0].advice, /yuqori chegara/);
  assert.strictEqual(r.items[1].quote, '', 'missing term has no quote');
  assert.strictEqual(r.items[1].newText, '');
  assert.match(r.summary, /ikki bandni/);
});
test('a reply without the format gives no items', () => {
  assert.strictEqual(S.parseReview('Oddiy javob, izohsiz.').items.length, 0);
});
test('comment text is plain, with the basis link kept readable', () => {
  const t = S.commentText(S.parseReview(REPLY).items[0]);
  assert.ok(t.startsWith('JuristAI: Penya miqdori'));
  assert.match(t, /FK 326-modda \(https:\/\/lex\.uz\/docs\/111189#326\)/);
  assert.ok(!/\*\*/.test(t));
});
test('search needles: whole quote first, then shorter word-bounded starts', () => {
  const q = 'Ijarachi ijara haqini har oyning 30-sanasigacha to‘laydi, kechiktirilgan har bir kun uchun to‘lanmagan summaning 0,1 foizi miqdorida penya to‘lanadi va bu summa umumiy qarzning 50 foizidan oshmasligi kerak, aks holda shartnoma bekor qilinadi.';
  const q2 = q.slice(0, 200).replace(/\s\S*$/, ''); const n = S.needles(q2);
  assert.strictEqual(n[0], q2);
  assert.ok(n.length > 1 && n.slice(1).every(x => q2.startsWith(x) && x.length <= 120));
  assert.ok(n.every(x => !/\s$/.test(x)));
  assert.deepStrictEqual(S.needles('ab'), []);
  assert.ok(S.needles('x'.repeat(300))[0].length <= 120, 'longer than Word search allows: no whole-quote needle');
});
test('Word search escapes its own control character', () => {
  assert.strictEqual(S.wordSearchText('a^b'), 'a^^b');
});
test('edit proposal markers are split out and stripped from plain text', () => {
  const p = S.splitProposal('Izoh [FK](https://lex.uz/x).\n<<<YANGI_MATN\nYangi band.\nYANGI_MATN>>>');
  assert.strictEqual(p.text, 'Yangi band.');
  assert.strictEqual(S.plainOf('a\n<<<YANGI_MATN\nb\nYANGI_MATN>>>'), 'a\n\nb');
});
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
