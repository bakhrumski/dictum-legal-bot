'use strict';

/**
 * The editor's check (D5, docs/design/hujjat-muharriri.md §6): part A, the
 * free rules (public/js/doc-check.js, no AI) find each kind with an exact fix
 * or flag it with none; part B's guard (src/editor/spell.js vet) drops an AI
 * fix that touches a digit, a capitalised word or quoted text.
 *
 *   node tests/doc-check.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const D = require('../public/js/doc-check.js');
const spell = require('../src/editor/spell');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); } }
const kinds = list => list.map(i => i.kind);
const one = (blocks, kind) => D.run(blocks).filter(i => i.kind === kind);
/** apply the fixes of the issues to the blocks (as the page does, from the end) */
function fix(blocks, issues) {
  const out = blocks.slice(), edits = [];
  issues.forEach(i => edits.push(...i.edits));
  edits.sort((a, b) => b.block - a.block || b.from - a.from).forEach(e => { out[e.block] = out[e.block].slice(0, e.from) + e.text + out[e.block].slice(e.to); });
  return out;
}

console.log('doc check');
test('a word with both scripts: a lookalike letter is swapped to the word\'s main script', () => {
  const i = one(['«Аlоqabank» ATB, Тоshkent'], 'mixed_script');
  assert.deepStrictEqual(i.map(x => x.edits[0].text), ['Aloqabank', 'Toshkent']);
  assert.strictEqual(one(['Ташкент шаҳри, Toshkent shahri'], 'mixed_script').length, 0, 'whole words of one script are fine');
});
test('old and new Latin alphabet mixed: the fewer side is moved to the main one', () => {
  const i = one(['O‘zbekiston Respublikasi qonuni bo‘yicha', 'Şartnoma va o‘zgartirish'], 'alphabet_mix');
  assert.deepStrictEqual(i.map(x => [x.found, x.edits[0].text]), [['Şartnoma', 'Shartnoma']]);
});
test('spaces: double space and a space before punctuation, fixed', () => {
  const b = ['Ijara  haqi to‘lanadi , oyiga .', '  Boshidagi chekinish tegilmaydi.'];
  assert.deepStrictEqual(fix(b, D.run(b)), ['Ijara haqi to‘lanadi, oyiga.', '  Boshidagi chekinish tegilmaydi.']);
  assert.strictEqual(one(['narx 0 .5 emas, 3 ... 4'], 'space_punct').length, 0, 'decimals and ellipses stay');
});
test('unpaired quotes and brackets are flagged, enumerators "1)" "a)" are not', () => {
  assert.deepStrictEqual(one(['«Ijarachi tomonidan (kechiktirmasdan.'], 'unpaired').map(x => x.found), ['«', '(']);
  assert.strictEqual(one(['Majburiyatlar: 1) to‘lash; 2) qaytarish; a) boshqa (ilova bilan).'], 'unpaired').length, 0);
  assert.strictEqual(one(['"Ijarachi'], 'unpaired').length, 1);
});
test('numbering: the break is found and the run renumbered from it in one fix', () => {
  const b = ['1. Birinchi', '2. Ikkinchi', '4. To‘rtinchi', 'Matn', '5. Beshinchi', '1. Yangi ro‘yxat', '2. Ikkinchi'];
  const i = one(b, 'numbering');
  assert.strictEqual(i.length, 1);
  assert.deepStrictEqual(i[0].params, { prev: 2, n: 4, want: 3 });
  assert.deepStrictEqual(fix(b, i).slice(0, 5), ['1. Birinchi', '2. Ikkinchi', '3. To‘rtinchi', 'Matn', '4. Beshinchi']);
  assert.strictEqual(one(['1.1. band', '1.3. band'], 'numbering').length, 0, 'sub-clauses are not this rule');
});
test('a repeated word goes, a single letter or a hyphen pair stays', () => {
  const b = ['ijarachi to‘lovni to‘lovni o‘z vaqtida', 'a a b', 'bir-bir'];
  assert.deepStrictEqual(fix(b, one(b, 'repeat_word')), ['ijarachi to‘lovni o‘z vaqtida', 'a a b', 'bir-bir']);
});
test('dates: the fewer formats move to the main one', () => {
  const b = ['01.10.2026 dan 2026-10-30 gacha', '15.11.2026 va 2026 yil 5 dekabrdagi'];
  const i = one(b, 'date_format');
  assert.deepStrictEqual(fix(b, i), ['01.10.2026 dan 30.10.2026 gacha', '15.11.2026 va 05.12.2026 yildagi']);
});
test('amount in digits and words: a mismatch is fixed to the digits, a match or other words left', () => {
  const b = ['Ijara haqi 5 000 000 (besh yuz ming) so‘m.'];
  assert.deepStrictEqual(fix(b, one(b, 'amount_words')), ['Ijara haqi 5 000 000 (besh million) so‘m.']);
  assert.strictEqual(one(['5 200 450 (besh million ikki yuz ming to‘rt yuz ellik) so‘m'], 'amount_words').length, 0);
  assert.strictEqual(one(['Muddat 2026 (ilova bilan) yil'], 'amount_words').length, 0, 'words that are not a number are not checked');
  assert.strictEqual(D.uzWords(1012000), 'bir million o‘n ikki ming');
  assert.strictEqual(D.parseWords('o‘ttiz besh ming so‘m').value, 35000);
});
test('a defined term written in another case is fixed to its definition', () => {
  const b = ['Karimov A. (keyingi o‘rinlarda – «Ijarachi») shartnoma tuzdi.', 'ijarachining majburiyatlari, Ijarachi huquqlari.'];
  const i = one(b, 'term_case');
  assert.deepStrictEqual(i.map(x => x.found), ['ijarachi']);
  assert.deepStrictEqual(fix(b, i)[1], 'Ijarachining majburiyatlari, Ijarachi huquqlari.');
});
test('a clean document has no findings; the kinds come in the list order', () => {
  assert.deepStrictEqual(D.run(['IJARA SHARTNOMASI', '1. Ijara haqi oyiga 5 000 000 (besh million) so‘m.', '2. Muddat 12 oy.']), []);
  const order = kinds(D.run(['Ijara  haqi , ', '«Аlоqa']));
  assert.deepStrictEqual(order, ['mixed_script', 'unpaired', 'double_space', 'space_punct']);
});
test('word diff gives the changed spans on the original text', () => {
  const a = 'Ijarachi tolovni oz vaqtida qiladi .', b = 'Ijarachi to‘lovni o‘z vaqtida qiladi.';
  const ch = D.diffWords(a, b);
  let out = a; ch.slice().reverse().forEach(c => { out = out.slice(0, c.from) + c.text + out.slice(c.to); });
  assert.strictEqual(out, b);
});
test('AI spelling guard: digits, capitals and quotes stay, else the fix is dropped', () => {
  assert.ok(spell.vet('Ijarachi tolovni oz vaqtida qiladi .', 'Ijarachi to‘lovni o‘z vaqtida qiladi.').ok);
  assert.strictEqual(spell.vet('Karimov 5 000 000 so‘m to‘laydi', 'Karimova 5 000 000 so‘m to‘laydi').why, 'protected');
  assert.strictEqual(spell.vet('164-moddaga ko‘ra', '165-moddaga ko‘ra').why, 'protected');
  assert.strictEqual(spell.vet('«Ucell» kompaniyasi', '«Ucel» kompaniyasi').why, 'protected');
  assert.strictEqual(spell.vet('qisqa matn bu yerda', 'qisqa matn bu yerda va yana juda uzun qo‘shimcha jumla qo‘shildi').why, 'length');
  assert.deepStrictEqual(spell.parseJsonArray('```json\n[{"i":0,"t":"x"}]\n```'), [{ i: 0, t: 'x' }]);
  assert.strictEqual(spell.parseJsonArray('no json'), null);
});
test('wiring: confirmed, metered in chat units, editors only; the page loads the rules', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/editor/spell.js'), 'utf8');
  assert.ok(/'\/api\/editor\/docs\/:id\/spell', requireSameOrigin, requireAuth, requireServiceConfirm/.test(src));
  assert.ok(/meterJob\(req, res, \{ service: 'chat', units: d\.units/.test(src));
  assert.ok(/access\.load\(pool, req\.params\.id, me\(req\), 'write'\)/.test(src));
  const html = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
  assert.ok(html.indexOf('/js/uz-alphabet.js') < html.indexOf('/js/doc-check.js') && html.includes('/app/editor-check.js'));
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.ok(server.includes("require('../editor/spell').mountEditorSpell(app"));
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
