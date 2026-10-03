'use strict';

/**
 * Critical legal claims must be backed by the source text (2026-10-03: a
 * Telegram answer on unpaid wages gave "usually one year" with no norm in
 * context; re-asked, it gave the one-year term to the wrong party and called
 * the delay compensation "10%").
 *
 * The article texts below are FIXTURES written for these tests (shaped like
 * Labour Code articles 25, 333 and 560); they are not the official text and
 * are not used anywhere but here. The verifier model is a stub that answers
 * per claim, so what is tested is the guard's own logic: a claim survives
 * only with the verifier's "supported" AND its numbers in the cited text.
 *
 *   node tests/legal-claim-guard.test.js
 */

const assert = require('assert');
const g = require('../src/rag/legal-claim-guard');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const URL = 'https://lex.uz/docs/-6257288';
const art = (n, text) => ({ id: `mk-${n}`, law_name: "O'zbekiston Respublikasining Mehnat kodeksi", source_type: 'law_text', source_url: URL, is_active: true, article_numbers: [String(n)], chunk_text: text });
// fixtures, not the official text
const A560 = art(560, "560-modda. Mehnat nizolarini hal qilish uchun murojaat qilish muddatlari. Ishdan bo'shatish to'g'risidagi nizolar bo'yicha — bir oy. Boshqa mehnat nizolari bo'yicha xodim olti oy ichida murojaat qiladi. Xodim tomonidan ish beruvchiga yetkazilgan moddiy zararni undirish to'g'risidagi nizolar bo'yicha ish beruvchi bir yil ichida murojaat qiladi.");
const A333 = art(333, "333-modda. Ish haqini to'lash muddati buzilganligi uchun javobgarlik. Ish beruvchi ish haqini kechiktirgan har bir kun uchun Markaziy bankning asosiy stavkasidan kelib chiqib kompensatsiya to'laydi.");
const A25 = art(25, '25-modda. Mehnat huquqlarini himoya qilish. Xodim o\'z huquqlarini sudda himoya qilishga haqli.');

const QUESTION = "MChJ xodimiman. Ish beruvchi oxirgi ikki oylik ish haqimni to'lamadi. Qanday choralar ko'rishim mumkin va murojaat muddati qanday?";

/** Verifier stub: maps each claim to a verdict by a predicate on its text. */
function verifier(rules, calls = []) {
  return async (messages, opts) => {
    calls.push(opts);
    const payload = JSON.parse(messages[1].text);
    return {
      text: JSON.stringify({
        claims: payload.claims.map(c => {
          const rule = rules.find(r => r.when.test(c.text)) || { verdict: 'not_found' };
          return { id: c.id, verdict: rule.verdict, topic: rule.topic || 'murojaat muddati', reason: 'stub', needs_facts: rule.needs || [] };
        }),
      }),
    };
  };
}

(async () => {
  console.log('legal claim guard');

  await test('numbers and units in Uzbek (Latin, Cyrillic) and Russian', () => {
    assert.deepStrictEqual([...g.quantityFacts("olti oylik muddat")], ['6M']);
    assert.deepStrictEqual([...g.quantityFacts('в течение шести месяцев')], ['6M']);
    assert.deepStrictEqual([...g.quantityFacts('в течение одного года')], ['1Y']);
    assert.deepStrictEqual([...g.quantityFacts("o'n besh kun ichida")], ['15D']);
    assert.deepStrictEqual([...g.quantityFacts('олти ой ичида')], ['6M']);
    assert.deepStrictEqual([...g.quantityFacts('qarzning 10% miqdorida')], ['10PCT']);
    assert.deepStrictEqual([...g.quantityFacts("har bir kun uchun")], [], '"each day" is not a term');
  });

  await test('critical claims: terms, percentages, rates; the user\'s own facts are not claims', () => {
    const claims = g.extractCriticalClaims(
      "Siz ikki oylik ish haqini undirishingiz mumkin. Murojaat muddati olti oy (560-modda). Kompensatsiya qarzning 10% miqdorida. Salom!",
      QUESTION);
    assert.deepStrictEqual(claims.map(c => [c.kind, c.facts, c.articles]), [['term', ['6M'], ['560']], ['percent', ['10PCT'], []]]);
  });

  await test('1. an employee\'s wage claim: six months, with the source, is kept', async () => {
    const answer = "Ish haqi bo'yicha nizo uchun sudga olti oy ichida murojaat qilasiz (Mehnat kodeksi, 560-modda).";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A560, A333], callAI: verifier([{ when: /olti oy/u, verdict: 'supported' }]) });
    assert.strictEqual(r.status, 'verified');
    assert.strictEqual(r.text, answer);
  });

  await test('2. the employer\'s claim for damage the employee caused: one year, parties right, is kept', async () => {
    const answer = "Xodim ish beruvchiga yetkazgan moddiy zararni undirish uchun ish beruvchi bir yil ichida murojaat qiladi (560-modda).";
    const r = await g.guardLegalAnswer({ question: 'Ish beruvchi xodimdan zararni qachongacha undira oladi?', answer, chunks: [A560], callAI: verifier([{ when: /bir yil/u, verdict: 'supported' }]) });
    assert.strictEqual(r.status, 'verified');
    assert.strictEqual(r.text, answer);
  });

  await test('3. only article 25 in context: no term is given until article 560 is found', async () => {
    const answer = "Xodim huquqini sudda himoya qiladi (25-modda). Sudga murojaat muddati odatda bir yil.";
    const calls = [];
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A25], callAI: verifier([{ when: /bir yil/u, verdict: 'supported' }], calls) });
    assert.strictEqual(r.status, 'partial');
    assert.ok(!/bir yil/u.test(r.text), r.text);
    assert.match(r.text, /25-modda/u, 'the supported part stays');
    assert.match(r.text, /Manbada tasdiqlanmadi: murojaat muddati/u);
    assert.strictEqual(r.withheld[0].deterministic, 'not_in_context', 'the verifier\'s "supported" is not enough without the text');

    // with one bounded re-retrieval that finds article 560, the six-month term holds
    const answer2 = "Xodim huquqini sudda himoya qiladi (25-modda). Ish haqi bo'yicha murojaat muddati olti oy (560-modda).";
    const asked = [];
    const r2 = await g.guardLegalAnswer({
      question: QUESTION, answer: answer2, chunks: [A25],
      callAI: verifier([{ when: /olti oy/u, verdict: 'supported' }]),
      retrieveMore: async (query, { articles }) => { asked.push({ query, articles }); return { chunks: [A560] }; },
    });
    assert.deepStrictEqual(asked.map(a => a.articles), [['560']]);
    assert.strictEqual(r2.retrievals, 1);
    assert.strictEqual(r2.status, 'verified');
    assert.match(r2.text, /olti oy/u);
  });

  await test('re-retrieval is bounded: one attempt, and a failing retriever stops it', async () => {
    let n = 0;
    const r = await g.guardLegalAnswer({
      question: QUESTION, answer: 'Murojaat muddati uch yil (560-modda).', chunks: [A25],
      callAI: verifier([]), retrieveMore: async () => { n++; return { chunks: [{ ...A25, id: `x${n}` }] }; },
    });
    assert.strictEqual(n, 1);
    assert.strictEqual(r.retrievals, 1);
    const r2 = await g.guardLegalAnswer({
      question: QUESTION, answer: 'Murojaat muddati uch yil (560-modda).', chunks: [A25],
      callAI: verifier([]), retrieveMore: async () => { throw new Error('db down'); },
    });
    assert.strictEqual(r2.status, 'partial');
  });

  await test('4. the right article with a conclusion it contradicts does not pass', async () => {
    // the one-year term IS in article 560 - but for the employer's damage claim
    const answer = "Ish haqi qarzi bo'yicha xodim sudga bir yil ichida murojaat qiladi (560-modda).";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A560], callAI: verifier([{ when: /bir yil/u, verdict: 'contradicted', topic: "ish haqi bo'yicha murojaat muddati" }]) });
    assert.strictEqual(r.status, 'partial');
    assert.ok(!/bir yil/u.test(r.text), r.text);
    assert.match(r.text, /ish haqi bo'yicha murojaat muddati/u);
    // and a verifier that wrongly says "supported" for a number the article does not have
    const r2 = await g.guardLegalAnswer({ question: QUESTION, answer: 'Muddat uch yil (560-modda).', chunks: [A560], callAI: verifier([{ when: /uch yil/u, verdict: 'supported' }]) });
    assert.strictEqual(r2.status, 'partial');
    assert.strictEqual(r2.withheld[0].deterministic, 'not_in_cited_article:3Y');
  });

  await test('5. verifier error, timeout or bad JSON: nothing counts as checked, the critical claims are withheld', async () => {
    const answer = "Kafolatlar 25-moddada. Murojaat muddati olti oy (560-modda).";
    for (const callAI of [
      async () => { throw new Error('upstream 500'); },
      async () => ({ text: 'not json' }),
      () => new Promise(() => {}),
    ]) {
      const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A560, A25], callAI, options: { verifierTimeoutMs: 50 } });
      assert.strictEqual(r.status, 'unverified');
      assert.ok(!/olti oy/u.test(r.text), r.text);
      assert.ok(r.reason, 'the reason is kept');
    }
  });

  await test('6. compensation is never "10% of the debt" without the source; the facts for it are asked for', async () => {
    const answer = "Ish haqi kechiktirilgani uchun kompensatsiya qarzning 10% miqdorida to'lanadi (333-modda).";
    const r = await g.guardLegalAnswer({
      question: QUESTION, answer, chunks: [A333],
      callAI: verifier([{ when: /10%/u, verdict: 'supported', topic: 'kechiktirish kompensatsiyasi miqdori', needs: ["ish haqi to'lanishi kerak bo'lgan sana", 'qarz summasi'] }]),
    });
    assert.strictEqual(r.status, 'partial');
    assert.ok(!/10%/u.test(r.text));
    assert.match(r.text, /kechiktirish kompensatsiyasi miqdori/u);
    assert.match(r.text, /Hisoblash uchun aniqlashtiring: ish haqi to'lanishi kerak bo'lgan sana; qarz summasi/u);
  });

  await test('a rate stated as in the source is kept', async () => {
    const answer = "Kechiktirilgan har bir kun uchun kompensatsiya Markaziy bankning asosiy stavkasidan kelib chiqib hisoblanadi (333-modda).";
    const r = await g.guardLegalAnswer({ question: QUESTION, answer, chunks: [A333], callAI: verifier([{ when: /stavka/u, verdict: 'supported' }]) });
    assert.strictEqual(r.status, 'verified');
  });

  await test('an answer with no critical claims is not sent to the verifier', async () => {
    const calls = [];
    const r = await g.guardLegalAnswer({ question: 'Salom', answer: 'Assalomu alaykum! Savolingizni yozing.', chunks: [], callAI: verifier([], calls) });
    assert.strictEqual(r.status, 'no_claims');
    assert.strictEqual(calls.length, 0);
  });

  await test('Russian answers get a Russian notice', async () => {
    const r = await g.guardLegalAnswer({ question: 'Какой срок обращения в суд?', answer: 'Срок обращения — один год (статья 560).', chunks: [A25], callAI: verifier([]), lang: 'ru' });
    assert.match(r.text, /Не подтверждено источником/u);
    assert.ok(!/один год/u.test(r.text));
  });

  await test('the verifier sees the cited article\'s text first, and the call is bounded', async () => {
    const calls = [];
    await g.guardLegalAnswer({ question: QUESTION, answer: 'Muddat olti oy (560-modda).', chunks: [A25, A333, A560], callAI: verifier([{ when: /olti/u, verdict: 'supported' }], calls) });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].temperature, 0);
    assert.ok(calls[0].maxTokens <= 1000);
    const evidence = g.buildEvidence([{ articles: ['560'] }], [A25, A333, A560]);
    assert.ok(evidence.indexOf('560-modda') < evidence.indexOf('25-modda'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
