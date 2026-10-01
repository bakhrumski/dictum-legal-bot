'use strict';

/**
 * Repealed acts are named to the user (2026-10-01: a Russian LLC question
 * was answered from O'RQ-310, which is no longer in force; the current law
 * is O'RQ-1137, https://lex.uz/docs/-8151376).
 *
 *   node tests/superseded-acts.test.js
 */

const assert = require('assert');
const { findSupersededMentions, appendRepealedNotice, buildRepealedNotice, identifierFor } = require('../src/rag/superseded-acts');
const { hydrateMentionedOfficialActChunks } = require('../src/rag/official-citation-hydrator');
const { expandLegalQueryAliases } = require('../src/rag/query-aliases');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const RU_ANSWER = 'Согласно **Закону Республики Узбекистан "Об обществах с ограниченной и дополнительной ответственностью" (O\'RQ-310), 20-модда**, участник вправе уступить долю.';

(async () => {
  console.log('superseded acts');

  await test('the production answer: O\'RQ-310 found by number or by its Russian or Uzbek title', () => {
    assert.strictEqual(findSupersededMentions(RU_ANSWER).length, 1);
    assert.strictEqual(findSupersededMentions('ЗРУ-310 гласит').length, 1);
    assert.strictEqual(findSupersededMentions("Mas'uliyati cheklangan hamda qo'shimcha mas'uliyatli jamiyatlar to'g'risidagi qonun").length, 1);
    assert.strictEqual(findSupersededMentions("Mas'uliyati cheklangan jamiyatlar to'g'risida (O'RQ-1137), 20-modda").length, 0);
    assert.strictEqual(findSupersededMentions("Mehnat kodeksi (O'RQ-798)").length, 0);
  });

  await test('a Russian answer gets a Russian notice with the current law and its link', () => {
    const out = appendRepealedNotice(RU_ANSWER, {}, 'ru');
    assert.ok(out.startsWith(RU_ANSWER), 'the answer itself is kept');
    assert.match(out, /Статус документа/u);
    assert.match(out, /\(ЗРУ-310\) \*\*утратил силу\*\*/u);
    assert.match(out, /Действует Закон «Об обществах с ограниченной ответственностью» \(ЗРУ-1137\): \[lex\.uz\]\(https:\/\/lex\.uz\/docs\/-8151376\)/u);
    assert.ok(!/O'RQ|kuchini/u.test(out.slice(RU_ANSWER.length)), 'no Uzbek in the Russian notice');
  });

  await test('an Uzbek answer gets an Uzbek notice', () => {
    const out = appendRepealedNotice("Qonun (O'RQ-310), 20-modda bo'yicha ulush o'tkaziladi.", {}, 'uz');
    assert.match(out, /Hujjat holati/u);
    assert.match(out, /\(O'RQ-310\) \*\*kuchini yo'qotgan\*\*\. Amaldagisi: «Mas'uliyati cheklangan jamiyatlar to'g'risida» qonun \(O'RQ-1137\)/u);
  });

  await test('acts the hydrator found repealed on lex.uz are named too, once, and only once per answer', () => {
    const repealed = [{ identifier: 'PQ-4000', title: 'Eski qaror', url: 'https://lex.uz/docs/-111' },
      { identifier: "O'RQ-310", title: 'listed already', url: 'x' }];
    const out = appendRepealedNotice(RU_ANSWER, { repealed }, 'ru');
    assert.match(out, /«Eski qaror» \(ПП-4000\) по данным lex\.uz \*\*утратил силу\*\*/u);
    assert.strictEqual((out.match(/ЗРУ-310/gu) || []).length, 1, 'a listed act is not repeated');
    assert.strictEqual(appendRepealedNotice(out, { repealed }, 'ru'), out, 'a second pass adds nothing');
  });

  await test('nothing to say, nothing added', () => {
    assert.strictEqual(buildRepealedNotice({}, 'uz'), '');
    assert.strictEqual(appendRepealedNotice('Oddiy javob.', {}, 'uz'), 'Oddiy javob.');
  });

  await test('identifiers in Russian use ЗРУ / ПП / УП / ПКМ', () => {
    assert.deepStrictEqual(["O'RQ-310", 'PQ-1', 'PF-2', 'VMQ-3'].map(id => identifierFor(id, 'ru')), ['ЗРУ-310', 'ПП-1', 'УП-2', 'ПКМ-3']);
    assert.strictEqual(identifierFor("O'RQ-310", 'uz'), "O'RQ-310");
  });

  await test('the hydrator reports a mention whose lex.uz match is not in force, instead of dropping it', async () => {
    const search = async () => [{
      url: 'https://lex.uz/docs/-82294', title: "Mas'uliyati cheklangan hamda qo'shimcha mas'uliyatli jamiyatlar to'g'risida",
      lawName: "Mas'uliyati cheklangan hamda qo'shimcha mas'uliyatli jamiyatlar to'g'risida",
      ownDocumentNumber: "O'RQ-310",
      metadata: { is_active: false, status_label: "Hujjat kuchini yo'qotgan", adoption_date: '2001-12-06', document_number: "O'RQ-310" },
    }];
    const r = await hydrateMentionedOfficialActChunks("Mas'uliyati cheklangan hamda qo'shimcha mas'uliyatli jamiyatlar to'g'risidagi qonun (O'RQ-310) 2001 yil", [], { search });
    assert.strictEqual(r.added.length, 0, 'a repealed act is never admitted as a source');
    assert.deepStrictEqual(r.repealed.map(x => x.identifier), ["O'RQ-310"]);
    assert.strictEqual(r.unresolved.length, 0);
  });

  await test('a Russian LLC question now searches the Uzbek LLC terms', () => {
    const q = 'Возможно ли провести безвозмездное отчуждение доли в уставном фонде ООО другому участнику?';
    assert.match(expandLegalQueryAliases(q), /mas'uliyati cheklangan jamiyat/u);
    assert.match(expandLegalQueryAliases('ООО может ли выйти участник?'), /mas'uliyati cheklangan jamiyat/u);
    assert.strictEqual(expandLegalQueryAliases('Какая доля наследства положена супруге?'), 'Какая доля наследства положена супруге?');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
