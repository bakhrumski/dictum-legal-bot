'use strict';

/**
 * A claim that a rule does not apply, and its notice (2026-10-27, owner): an
 * IT Park answer said no labour-activity confirmation is required, and the
 * guard printed "Manbada tasdiqlanmadi: IT park rezidentlariga tasdiqnoma
 * talabi ... aniq qiymat keltirilmaydi". VMQ-589, whose band 17 says exactly
 * that, came after 14 000 characters of other sources and never reached the
 * verifier. Now an absence claim puts the sources holding an exception first,
 * and its notice speaks of the claim, not of a missing figure. No AI.
 *
 *   node tests/claim-guard-exception.test.js
 */

const assert = require('assert');
const g = require('../src/rag/legal-claim-guard');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const filler = (i) => ({ id: `c${i}`, law_name: `Boshqa qaror ${i}`, source_type: 'lex_live', source_url: `https://lex.uz/docs/-${i}`, is_active: true, chunk_text: `${i}. ${'mehnat faoliyati tartibi '.repeat(160)}` });
const VMQ = { id: 'vmq589', law_name: 'Dasturiy mahsulotlar va axborot texnologiyalari texnologik parki (VMQ-589)', source_type: 'lex_live', source_url: 'https://lex.uz/docs/-4422250', is_active: true,
  chunk_text: "SAVOLGA ENG YAQIN QATOR (17-band) [server so'zlar bo'yicha tanlagan - o'qing va tekshiring]: Oʻzbekiston Respublikasi hududida mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish;" };

test('an absence claim: the source with the exception goes first, inside the 14 000-character limit', () => {
  const chunks = [...Array.from({ length: 6 }, (_, i) => filler(i + 1)), VMQ];
  const claims = [{ text: "IT park rezidentiga tasdiqnoma talab qilinmaydi.", kind: 'absence', facts: [], articles: [] }];
  const ev = g.buildEvidence(claims, chunks);
  assert.ok(ev.length <= g.DEFAULTS.maxEvidenceChars + 10);
  assert.match(ev, /^\[MANBA-1\] [^\n]*VMQ-589/u, 'first');
  assert.match(ev, /tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish/u);
  const plain = g.buildEvidence([{ text: '5 kun ichida', kind: 'term', facts: ['5D'], articles: [] }], chunks);
  assert.ok(!/^\[MANBA-1\] [^\n]*VMQ-589/u.test(plain), 'other claims keep the order as found');
});

test('the notice: an absence claim is named as a claim, not as a missing figure; "not found" is not "not in the law"', () => {
  const uz = g.unverifiedBlock([{ kind: 'absence', topic: 'IT park rezidentlariga tasdiqnoma talabi', verdict: 'not_found', normFound: false }], 'uz');
  assert.match(uz, /Javobdagi «bunday norma yo'q yoki qo'llanmaydi» degan gap \(IT park rezidentlariga tasdiqnoma talabi\) ko'rib chiqilgan manbalarda tasdiqlanmadi — manbada topilmagani bu qonunda yo'q degani emas/u);
  assert.ok(!/aniq qiymat/u.test(uz) && !/Manbada tasdiqlanmadi:/u.test(uz));
  const term = g.unverifiedBlock([{ kind: 'term', topic: 'murojaat muddati', verdict: 'not_found', normFound: false }], 'uz');
  assert.match(term, /Manbada tasdiqlanmadi: murojaat muddati\. .*aniq qiymat keltirilmaydi/u, 'a figure keeps the old notice');
  assert.match(g.unverifiedBlock([{ kind: 'absence', topic: 'норма', verdict: 'not_found', normFound: false }], 'ru'), /не подтверждено - это не значит, что в законе её нет/u);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
