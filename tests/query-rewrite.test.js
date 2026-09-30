'use strict';

/**
 * Question rewrite for retrieval: the switch, the call, the cleaning, the
 * cache, and how rewrite hits merge with the original question's hits.
 *
 *   node tests/query-rewrite.test.js
 */

const assert = require('assert');
const { queryRewriteFrom, rewriteLegalQuery, cleanRewrite, mergeByBestScore, buildRewriteMessages, _cache } = require('../src/rag/query-rewrite');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const quiet = { warn: () => {} };

(async () => {
  console.log('query rewrite');

  await test('off by default; RAG_QUERY_REWRITE or a per-call override turns it on', () => {
    assert.strictEqual(queryRewriteFrom({}, {}), false);
    assert.strictEqual(queryRewriteFrom({}, { RAG_QUERY_REWRITE: '1' }), true);
    assert.strictEqual(queryRewriteFrom({ queryRewrite: false }, { RAG_QUERY_REWRITE: 'true' }), false);
    assert.strictEqual(queryRewriteFrom({ queryRewrite: true }, {}), true);
  });

  await test('one user message in the { role, text } shape callAI takes, with the question in it', () => {
    const m = buildRewriteMessages('Могу ли я оплатить часть штрафа?');
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].role, 'user');
    assert.ok(m[0].text.includes('Могу ли я оплатить часть штрафа?'));
  });

  await test('the reply is cleaned to one line; echoes and empty replies are rejected', () => {
    assert.strictEqual(cleanRewrite({ text: '  "Jarimaning bir qismini\n to\'lash muddati"  ' }, 'q'), "Jarimaning bir qismini to'lash muddati");
    assert.strictEqual(cleanRewrite({ text: '' }, 'q'), null);
    assert.strictEqual(cleanRewrite({ text: 'Aliment muddati bormi?' }, 'aliment muddati bormi?'), null);
    assert.ok(cleanRewrite({ text: 'soʻz '.repeat(200) }, 'q').length <= 400);
  });

  await test('a reply to the user instead of a rewrite is not searched (run 27, cut-off questions)', () => {
    assert.strictEqual(cleanRewrite({ text: "Sizning xabaringiz tugallanmagan. Iltimos, savolning to'liq matnini yuboring." }, 'Agar men ilgari mu'), null);
    assert.strictEqual(cleanRewrite({ text: "Sizning savolingiz to'liq emas. Iltimos, holatni batafsil bayon qiling." }, 'Могут ли меня'), null);
    assert.ok(cleanRewrite({ text: "Soliq organi tomonidan tuzilgan dalolatnoma yuzasidan e'tirozlar taqdim etish muddati" }, 'q'));
  });

  await test('the prompt forbids adding facts and asking the user back', () => {
    const t = buildRewriteMessages('x')[0].text;
    assert.ok(/qo'shma/.test(t) && /so'rama/.test(t));
  });

  await test('a rewrite is asked once per question (cached); a failure is not cached', async () => {
    _cache.clear();
    let calls = 0;
    const llm = async () => { calls++; return { text: "Mehnat shartnomasini ish beruvchining tashabbusi bilan bekor qilish" }; };
    const a = await rewriteLegalQuery('Meni ishdan haydashdi, nima qilaman?', llm, { log: quiet });
    const b = await rewriteLegalQuery('Meni ishdan haydashdi, nima qilaman?', llm, { log: quiet });
    assert.strictEqual(a, b);
    assert.strictEqual(calls, 1);

    let fails = 0;
    const bad = async () => { fails++; throw new Error('boom'); };
    assert.strictEqual(await rewriteLegalQuery('Boshqa savol?', bad, { log: quiet }), null);
    await rewriteLegalQuery('Boshqa savol?', bad, { log: quiet });
    assert.strictEqual(fails, 2);
  });

  await test('a slow model times out to null instead of holding retrieval', async () => {
    const slow = () => new Promise(r => setTimeout(() => r({ text: 'kech javob matni uzun' }), 200));
    assert.strictEqual(await rewriteLegalQuery('Sekin savol?', slow, { timeoutMs: 20, log: quiet }), null);
  });

  await test('hits merge by id keeping the higher score, best first', () => {
    const merged = mergeByBestScore(
      [{ id: 1, score: 0.66 }, { id: 2, score: 0.70 }],
      [{ id: 1, score: 0.81 }, { id: 3, score: 0.60 }]
    );
    assert.deepStrictEqual(merged.map(r => [r.id, r.score]), [[1, 0.81], [2, 0.70], [3, 0.60]]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
