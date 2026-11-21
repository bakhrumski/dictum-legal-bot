'use strict';

/**
 * The act an answer's number is linked to (2026-11-21, owner: an answer
 * named "Valyuta tartibga solish to'g'risida"gi Qonun and its link led to a
 * law about teachers; another read "O'RQ-Davlat xaridlari to'g'risida (684)").
 * A number the model put next to one act's title is linked only when lex.uz
 * holds THAT act under the number; a generic word shared with the sentence
 * ("Respublikasining", twice in a title) is no evidence; a registry law kept
 * with its number alone is an O'RQ number. A stub search - no network, no AI.
 *
 *   node tests/citation-hydrator.test.js
 */

const assert = require('assert');
const h = require('../src/rag/official-citation-hydrator');
const cu = require('../src/rag/citation-utils');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const TEACHERS = "Pedagog xodimlarning xizmat vazifalarini bajarishiga to'sqinlik qilganlik uchun javobgarlik kuchaytirilishi munosabati bilan O'zbekiston Respublikasining Jinoyat kodeksiga hamda O'zbekiston Respublikasining Ma'muriy javobgarlik to'g'risidagi kodeksiga qo'shimcha va o'zgartishlar kiritish haqida";
const CURRENCY = "“Valyutani tartibga solish toʻgʻrisida”gi Oʻzbekiston Respublikasi Qonuniga oʻzgartish va qoʻshimchalar kiritish haqida";
const act = (title, number, id) => ({ title, lawName: title, url: `https://lex.uz/docs/-${id}`, ownDocumentNumber: { prefix: 'ORQ', number: String(number) }, metadata: { document_number: String(number), is_active: true }, content: `${title}. Matn.` });
const SENTENCE = n => `Bu shartlar O'zbekiston Respublikasining "Valyuta tartibga solish to'g'risida"gi Qonuni (O'RQ-${n}) talablariga muvofiq chet el valyutasidagi operatsiyalar sifatida rasmiylashtirilishi va Markaziy bankning talablariga mos kelishi kerak.`;

(async () => {
  console.log('citation hydrator');

  await test('the reported case: a wrong number next to the currency law is not linked to the act lex.uz holds under it', async () => {
    const answer = SENTENCE(1010);
    const out = await h.hydrateMentionedOfficialActChunks(answer, [], { search: async () => [act(TEACHERS, 1010, 7000001)] });
    assert.deepStrictEqual([out.added.length, out.unresolved], [0, ["O'RQ-1010"]]);
    assert.strictEqual(out.mismatched.length, 1);
    assert.deepStrictEqual([out.mismatched[0].identifier, out.mismatched[0].named], ["O'RQ-1010", "Valyuta tartibga solish to'g'risida"]);
    assert.match(out.mismatched[0].found, /^Pedagog xodimlarning/u);
    const linked = cu.normalizeLegalAnswerCitations(answer, out.chunks, 'uz');
    assert.ok(!/Pedagog/u.test(linked) && !/lex\.uz/u.test(linked), 'no link to another act');
  });

  await test('the right number is linked: the title the answer names and the act\'s own title are the same act in any case form', async () => {
    const answer = SENTENCE(573);
    const out = await h.hydrateMentionedOfficialActChunks(answer, [], { search: async () => [act(TEACHERS, 573, 7000002), act(CURRENCY, 573, 4562834)] });
    assert.deepStrictEqual([out.added.length, out.added[0].source_url, out.mismatched], [1, 'https://lex.uz/docs/-4562834', []]);
    assert.match(cu.normalizeLegalAnswerCitations(answer, out.chunks, 'uz'), /lex\.uz\/docs\/-4562834/u);
  });

  await test('the title before a number is read from the same sentence only, and only when it leads up to the number', () => {
    const m = h.extractOfficialActMentions(SENTENCE(573))[0];
    assert.strictEqual(m.named, "Valyuta tartibga solish to'g'risida");
    assert.strictEqual(h.extractOfficialActMentions('«Davlat xaridlari to‘g‘risida»gi Qonun (O‘RQ-684), 20-modda.')[0].named, 'Davlat xaridlari to‘g‘risida');
    assert.strictEqual(h.extractOfficialActMentions('U "maxfiy" deb ataladi. Keyingi gapda esa boshqa hujjat, ya\'ni PQ-4008 haqida gap boradi.')[0].named, '', 'a quote of an earlier sentence is not the act\'s title');
    assert.strictEqual(h.extractOfficialActMentions('"Qisqa nom" degan ibora shartnomada bor, lekin undan ancha keyin va butunlay boshqa mavzuda VMQ-589 tilga olinadi.')[0].named, '');
  });

  await test('no title named: two DISTINCT telling words are needed; a generic word, even twice in the title, is not evidence', () => {
    const generic = { identifier: "O'RQ-1010", context: "Bu shartlar O'zbekiston Respublikasining qonunchiligi talablariga mos kelishi kerak, O'RQ-1010 ga ko'ra.", named: '' };
    assert.strictEqual(h.resultMatchesMention(act(TEACHERS, 1010, 1), generic), false, '"Respublikasining" twice in the title used to pass as two words');
    const telling = { identifier: "O'RQ-1010", context: "Pedagog xodimlarga to'sqinlik qilganlik uchun javobgarlik O'RQ-1010 bilan kuchaytirildi.", named: '' };
    assert.strictEqual(h.resultMatchesMention(act(TEACHERS, 1010, 1), telling), true);
    const withYear = { identifier: "O'RQ-1010", context: '2026-yilda qabul qilingan O\'RQ-1010.', named: '' };
    assert.strictEqual(h.resultMatchesMention({ ...act(TEACHERS, 1010, 1), metadata: { document_number: '1010', adoption_date: '2026-02-01', is_active: true } }, withYear), true, 'a matching year still identifies a restarted number');
    assert.strictEqual(h.resultMatchesMention({ ...act(TEACHERS, 1010, 1), metadata: { document_number: '1010', adoption_date: '2026-02-01', is_active: true } }, { ...withYear, named: "Valyuta tartibga solish to'g'risida" }), false, 'a named title outranks the year');
  });

  await test('a registry law kept with its number alone is an O\'RQ number: the label and the answer\'s own "O\'RQ-684" stay whole', () => {
    const ch = { law_name: "Davlat xaridlari to'g'risida", document_number: '684', source_url: 'https://lex.uz/docs/-5382974', article_numbers: ['20'], chunk_text: '20-modda. Davlat xaridlari ...' };
    assert.strictEqual(cu.getChunkDocumentIdentifier(ch), "O'RQ-684");
    const out = cu.normalizeLegalAnswerCitations("o'tkazilmagan xarid (O'RQ-684, 20-modda), bir tomonlama", [ch], 'uz');
    assert.match(out, /\(\[\*\*Davlat xaridlari to'g'risida \(O'RQ-684\), 20-modda\*\*\]\(https:\/\/lex\.uz\/docs\/-5382974/u);
    assert.ok(!/O'RQ-\[/u.test(out), 'the prefix is not left outside the link');
    assert.strictEqual(cu.getChunkDocumentIdentifier({ law_name: 'Biror qaror', document_number: '684', source_url: 'https://lex.uz/docs/-999999999' }), '684', 'an act outside the registry keeps its number as it came');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
