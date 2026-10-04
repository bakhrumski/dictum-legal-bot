'use strict';

/**
 * Legal regressions A-H from the 2026-10-04 production retest (two Telegram
 * wage-arrears questions): articles 560 and 333 not found, article 511 cited
 * for an LLC employee, an empty "Xulosa" section, and citationCheck=ok read
 * as if the content had been checked.
 *
 * The article texts are FIXTURES shaped like Labour Code articles 25, 333,
 * 347, 511 and 560; they are not the official text, used nowhere but here.
 * The verifier and the retriever are stubs, so what is tested is the code's
 * own logic: question decomposition, which claims are withheld, the notices,
 * and the structure repair. Whether a real model judges the same way is
 * checked by the owner's retest, not here.
 *
 *   node tests/legal-regressions.test.js
 */

const assert = require('assert');
const g = require('../src/rag/legal-claim-guard');
const { questionAspects, retrieveAspects } = require('../src/rag/question-aspects');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const URL = 'https://lex.uz/docs/-6257288';
const art = (n, text) => ({ id: `mk-${n}`, law_name: "O'zbekiston Respublikasining Mehnat kodeksi", source_type: 'law_text', source_url: URL, is_active: true, article_numbers: [String(n)], chunk_text: text });
// fixtures, not the official text
const A25 = art(25, "25-modda. Mehnat huquqlarini himoya qilish. Xodim o'z huquqlarini sudda himoya qilishga haqli.");
const A333 = art(333, "333-modda. Ish haqini to'lash muddati buzilganligi uchun javobgarlik. Ish beruvchi ish haqini kechiktirgan har bir kun uchun Markaziy bankning asosiy stavkasidan kelib chiqib kompensatsiya to'laydi.");
const A347 = art(347, "347-modda. Ish beruvchi xodimdan zararni undirish to'g'risidagi buyruqni zarar aniqlangan kundan e'tiboran bir oy ichida chiqaradi.");
const A511 = art(511, "511-modda. Yakka tartibdagi tadbirkor bo'lgan ish beruvchi bilan tuzilgan mehnat shartnomasini bekor qilish. Bunday shartnoma taraflarning kelishuvida nazarda tutilgan asoslar bo'yicha bekor qilinadi.");
const A560 = art(560, "560-modda. Mehnat nizolarini hal qilish uchun murojaat qilish muddatlari. Ishdan bo'shatish to'g'risidagi nizolar bo'yicha — bir oy. Boshqa mehnat nizolari bo'yicha xodim olti oy ichida murojaat qiladi. Xodim tomonidan ish beruvchiga yetkazilgan moddiy zararni undirish to'g'risidagi nizolar bo'yicha ish beruvchi bir yil ichida murojaat qiladi.");

const QUESTION = "MChJ xodimiman. Ish beruvchi oxirgi ikki oylik ish haqimni to'lamadi. Qanday choralar ko'rishim mumkin, qanday hujjatlar kerak va sudga murojaat muddati qanday?";

function verifier(rules, calls = []) {
  return async (messages, opts) => {
    calls.push({ opts, payload: JSON.parse(messages[1].text), system: messages[0].text });
    const payload = JSON.parse(messages[1].text);
    return {
      text: JSON.stringify({
        claims: payload.claims.map(c => {
          const rule = rules.find(r => r.when.test(c.text)) || { verdict: 'not_found' };
          return { id: c.id, verdict: rule.verdict, topic: rule.topic || '', reason: 'stub', needs_facts: [] };
        }),
      }),
    };
  };
}

/** A corpus stub: returns the fixture whose subject matches the query's words. */
function corpus(query) {
  const q = String(query).toLowerCase();
  const hits = [];
  if (/murojaat qilish muddat|da'vo muddati/u.test(q)) hits.push(A560);
  if (/ish haqini to'lash muddatlari buzilganligi|kechiktirganlik/u.test(q)) hits.push(A333);
  if (/organlar|sudga murojaat/u.test(q)) hits.push(A25);
  return { chunks: hits };
}

(async () => {
  console.log('legal regressions A-H');

  await test('A. the original question is decomposed and the norms of each part are retrieved (560, 333)', async () => {
    const aspects = questionAspects(QUESTION, 'mehnat').map(a => a.key);
    assert.deepStrictEqual(aspects.sort(), ['compensation', 'deadline', 'evidence', 'remedy']);
    const asked = [];
    const r = await retrieveAspects({
      question: QUESTION, topic: 'mehnat', existing: [A25],
      retrieve: async (query, topic, opts) => { asked.push(opts); return corpus(query); },
    });
    const ids = r.chunks.map(c => c.id);
    assert.ok(ids.includes('mk-560') && ids.includes('mk-333'), ids.join(','));
    assert.ok(!ids.includes('mk-25'), 'a chunk already in context is not added twice');
    assert.match(r.context, /"murojaat muddati" QISMI/u);
    assert.ok(asked.every(o => o.noWebFallback && o.queryRewrite === false && o.correctiveMode === 'off' && o.rerank === false), 'light searches: no rewrite, no grader, no live web, no cross-encoder');
    // a question that asks none of these parts adds no searches
    const none = await retrieveAspects({ question: 'Salom', topic: 'mehnat', retrieve: async () => { throw new Error('must not be called'); } });
    assert.deepStrictEqual(none.chunks, []);
  });

  await test('B. employee vs employer: six months for the employee\'s wage claim, one year only for the employer\'s damage claim', async () => {
    const employee = "Ish haqi bo'yicha xodim sudga olti oy ichida murojaat qiladi (560-modda).";
    const ok = await g.guardLegalAnswer({ question: QUESTION, answer: employee, chunks: [A560], callAI: verifier([{ when: /olti oy/u, verdict: 'supported' }]) });
    assert.strictEqual(ok.status, 'verified');
    const swapped = "Ish haqi bo'yicha xodim sudga bir yil ichida murojaat qiladi (560-modda).";
    const bad = await g.guardLegalAnswer({ question: QUESTION, answer: swapped, chunks: [A560], callAI: verifier([{ when: /bir yil/u, verdict: 'contradicted', topic: "xodimning ish haqi bo'yicha murojaat muddati" }]) });
    assert.ok(!/bir yil/u.test(bad.text));
    assert.match(bad.text, /Manba matniga mos kelmadi, javobdan olib tashlandi: xodimning ish haqi/u, 'a contradicted claim is named as wrong, not as missing');
    // no global "one year -> six months" rewrite: the guard removes, it never substitutes a number
    assert.ok(!/olti oy/u.test(bad.text));
  });

  await test('C. only article 25 in context: no deadline is stated, and "not found" is not "not in the law"', async () => {
    const answer = "Xodim huquqini sudda himoya qiladi (25-modda). Mehnat kodeksida ish haqi bo'yicha murojaat muddati nazarda tutilmagan.";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A25], callAI: verifier([{ when: /25-modda/u, verdict: 'supported' }]) });
    assert.ok(!/nazarda tutilmagan/u.test(r.text), 'an absence claim the source does not make is withheld');
    assert.match(r.text, /25-modda/u);
    assert.match(r.text, /bu qonunda yo'q degani emas/u);
    assert.strictEqual(r.claims.find(c => c.kind === 'absence').verdict, 'not_found');
  });

  await test('D. article 511 (individual-entrepreneur employer) cited for an LLC employee is withheld', async () => {
    const answer = "Ish beruvchi ish haqini to'lamasa, mehnat shartnomasini bekor qilishingiz mumkin (Mehnat kodeksi, 511-modda). Xodim huquqini sudda himoya qiladi (25-modda).";
    const calls = [];
    const r = await g.guardLegalAnswer({
      question: QUESTION, answer, chunks: [A25, A511],
      callAI: verifier([{ when: /511-modda/u, verdict: 'contradicted', topic: 'mehnat shartnomasini bekor qilish asosi' }, { when: /25-modda/u, verdict: 'supported' }], calls),
    });
    assert.ok(!/511/u.test(r.text), r.text);
    assert.match(r.text, /25-modda/u);
    assert.strictEqual(r.withheld[0].kind, 'basis');
    assert.strictEqual(calls.length, 1, 'basis and numeric claims share one verifier call');
    assert.deepStrictEqual(calls[0].payload.claims.map(c => c.kind), ['basis', 'basis']);
    assert.match(calls[0].system, /yakka tartibdagi tadbirkor/u, 'the verifier is told to check the article\'s subject against the situation');
    // an article that is not in the context at all is withheld even if the verifier says supported
    const r2 = await g.guardLegalAnswer({ question: QUESTION, answer: 'Shartnomani bekor qilish mumkin (511-modda).', chunks: [A25], callAI: verifier([{ when: /511/u, verdict: 'supported' }]) });
    assert.ok(!/511/u.test(r2.text));
    assert.strictEqual(r2.withheld[0].deterministic, 'article_not_in_context:511');
    // not confirmed but not contradicted: kept and reported, not silently "verified"
    const r3 = await g.guardLegalAnswer({ question: QUESTION, answer: 'Xodim huquqini sudda himoya qiladi (25-modda).', chunks: [A25], callAI: verifier([]) });
    assert.match(r3.text, /25-modda/u);
    assert.deepStrictEqual(r3.unconfirmed.map(c => c.articles), [['25']]);
  });

  await test('E. article 347\'s order deadline is not a court deadline', async () => {
    const answer = "Sudga murojaat qilish muddati bir oy (347-modda).";
    const calls = [];
    const r = await g.guardLegalAnswer({
      question: QUESTION, answer, chunks: [A347],
      callAI: verifier([{ when: /347/u, verdict: 'contradicted', topic: 'sudga murojaat muddati' }], calls),
    });
    assert.ok(!/bir oy/u.test(r.text));
    assert.match(calls[0].system, /buyruq chiqarishi[^\n]*murojaat qilish muddati emas/u);
    // the deterministic check alone would have let it through: "bir oy" IS in article 347
    assert.strictEqual(g.deterministicSupport(g.extractCriticalClaims(answer, QUESTION)[0], [A347]).ok, true);
  });

  await test('F. a verifier timeout: numbers withheld, the answer marked unverified, an in-context basis kept', async () => {
    const answer = "Xodim huquqini sudda himoya qiladi (25-modda). Murojaat muddati olti oy (560-modda).";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A25, A560], callAI: () => new Promise(() => {}), options: { verifierTimeoutMs: 30 } });
    assert.strictEqual(r.status, 'unverified');
    assert.strictEqual(r.reason, 'verifier_timeout');
    assert.ok(!/olti oy/u.test(r.text));
    assert.match(r.text, /25-modda/u);
  });

  await test('G. Latin, Cyrillic and Russian questions are decomposed the same way', () => {
    const keys = q => questionAspects(q, 'mehnat').map(a => a.key).sort();
    assert.deepStrictEqual(keys("Ish beruvchi ish haqimni to'lamadi, muddati qancha?"), ['compensation', 'deadline']);
    assert.deepStrictEqual(keys('Иш берувчи иш ҳақимни тўламади, қандай ҳужжатлар керак ва муддати қанча?'), ['compensation', 'deadline', 'evidence']);
    assert.deepStrictEqual(keys('Работодатель не выплачивает зарплату. Как взыскать и какой срок обращения в суд?'), ['compensation', 'deadline', 'remedy']);
    assert.deepStrictEqual(keys('Зарплату задерживают уже два месяца, что делать?'), ['compensation', 'remedy']);
    // a Russian answer's claims and notice
    const facts = [...g.quantityFacts('в течение шести месяцев')];
    assert.deepStrictEqual(facts, ['6M']);
  });

  await test('H. an empty "Xulosa", a truncated answer and a disclaimer-only husk are never sent as an answer', async () => {
    const answer = "**Huquqiy asos:** Xodim huquqini sudda himoya qiladi (25-modda).\n\n**Tahlil:** Ish beruvchiga yozma talab yuboring.\n\n**Xulosa:**";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A25], callAI: verifier([{ when: /25-modda/u, verdict: 'supported' }]) });
    assert.ok(!/Xulosa/u.test(r.text), r.text);
    assert.deepStrictEqual(r.removedHeadings, ['**Xulosa:**']);
    // a heading emptied by withholding goes too
    const answer2 = "**Tahlil:** Ish beruvchiga yozma talab yuboring (25-modda).\n\n**Xulosa:** Muddat bir yil.";
    const r2 = await g.guardLegalAnswer({ question: QUESTION, answer: answer2, chunks: [A25], callAI: verifier([{ when: /25-modda/u, verdict: 'supported' }]) });
    assert.ok(!/bir yil/u.test(r2.text));
    assert.ok(!/Xulosa/u.test(r2.text), r2.text);
    // the provider said the output limit was hit: cut to the last full sentence, marked, low confidence upstream
    const cut = await g.guardLegalAnswer({ question: QUESTION, answer: "Ish beruvchiga yozma talab yuboring. Keyin mehnat inspeksiyasiga murojaat qilib, quyidagi", chunks: [], callAI: verifier([]), truncated: true });
    assert.strictEqual(cut.truncated, true);
    assert.ok(!/quyidagi$/u.test(cut.text));
    assert.match(cut.text, /Javob uzilib qoldi/u);
    // ending on a comma is cut even without the provider's flag
    assert.strictEqual(g.repairStructure('Birinchi gap. Ikkinchi gap,').truncated, true);
    assert.strictEqual(g.repairStructure('Birinchi gap. Pasport nusxasi').truncated, false, 'a list-like last line is not cut');
    // only notices left: not substantive
    const husk = await g.guardLegalAnswer({ question: QUESTION, answer: 'Muddat bir yil (560-modda).', chunks: [A25], callAI: verifier([]) });
    assert.strictEqual(husk.substantive, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
