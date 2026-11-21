'use strict';

/**
 * Lex.uz search queries (2026-10-22): one Telegram question ran 18 lex.uz
 * searches and 13 found nothing. Lex.uz finds two or three words near each
 * other in the law's own word forms, not a sentence, and lists the newest
 * acts first. Measured live that day on 10 questions: the old deterministic
 * plan found acts in 0 of 110 searches, the new one in 110 of 128, with a
 * code in the top three for 7 questions (scripts are not kept: live network).
 * Here lex.uz is stubbed - no network.
 *
 *   node tests/lex-queries.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pb = require('../src/rag/legal-research-playbook');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const QUESTION = 'Pudratchi ishni bajarmadi, avansni qaytarmayapti';

(async () => {
  await test("a complaint's negative or progressive verb becomes the law's verbal noun; other words stay", () => {
    const cases = { bajarmadi: 'bajarmaslik', qaytarmayapti: 'qaytarmaslik', "to'lamayapti": "to'lamaslik", bermayapti: 'bermaslik', qaytaryapti: 'qaytarish', ishlayapti: 'ishlash', avansni: 'avansni', organ: 'organ', endi: 'endi', pudratchi: 'pudratchi' };
    for (const [w, want] of Object.entries(cases)) assert.strictEqual(pb.nominalizeVerb(w), want, w);
  });

  await test('the plan searches two or three words, never the old 12-word phrases or act-class words', () => {
    const plan = pb.buildLexResearchPlan(QUESTION, 'fuqarolik');
    for (const step of plan.filter(s => s.kind !== 'natural-language')) {
      assert.ok(step.query.split(' ').length <= 3, `${step.kind}: "${step.query}"`);
      assert.ok(!/Vazirlar Mahkamasi|Prezident|yo'riqnoma/u.test(step.query), step.query);
    }
    assert.ok(plan.some(s => s.kind === 'legal-concept' && s.query === 'pudratchi ishni bajarmaslik'));
    assert.ok(plan.some(s => s.kind === 'legal-concept' && s.query === 'avansni qaytarmaslik'), 'the later terms get their own search');
    assert.ok(plan.some(s => s.kind === 'subordinate-regulation' && s.query === 'pudratchi ishni nizom'));
    assert.ok(plan.length <= 15);
  });

  await test('codes and laws are searched by their lex.uz form (one code read, two laws)', () => {
    const plan = pb.buildLexResearchPlan(QUESTION, 'fuqarolik');
    const code = plan.find(s => s.actForm === 'code'), law = plan.find(s => s.actForm === 'law');
    assert.deepStrictEqual([code.kind, code.maxDocs, law.kind, law.maxDocs], ['code-search', 1, 'law-search', 2]);
    const ai = pb.parseLexQueryPlannerResponse(JSON.stringify(['pudratchining javobgarligi', "avans to'lovi", 'shartnomani bajarishdan voz kechish', 'zararni qoplash'].map(query => ({ query, kind: 'official-concept' }))));
    assert.deepStrictEqual(ai.filter(s => s.actForm === 'code').map(s => s.query), ['pudratchining javobgarligi', "avans to'lovi", 'shartnomani bajarishdan voz kechish'], 'the first three terms');
    assert.deepStrictEqual(ai.filter(s => s.actForm === 'law').map(s => s.query), ['pudratchining javobgarligi', "avans to'lovi"], 'the first two terms');
    assert.ok(pb.mergeLexResearchPlans(ai, plan).length <= 22);
  });

  await test("the planner is told lex.uz's rules: 2-3 words, the law's word forms, no finite verbs or connectors", () => {
    const prompt = pb.buildLexQueryPlannerPrompt(QUESTION, 'fuqarolik');
    assert.match(prompt, /2-3 so'z/u);
    assert.match(prompt, /4 va undan ko'p so'zli ibora odatda hech narsa topmaydi/u);
    assert.match(prompt, /"pudratchining javobgarligi"/u);
    assert.match(prompt, /"bajarmadi", "qaytarmayapti"/u);
  });

  await test('a code or law found by its form is ranked above the same words found elsewhere', () => {
    const base = { url: 'https://lex.uz/docs/-1', title: 'Fuqarolik kodeksi (ikkinchi qism)', content: 'pudratchi avans' };
    const viaCode = pb.scoreLexResearchResult({ ...base, researchKind: 'code-search' }, QUESTION);
    const plain = pb.scoreLexResearchResult({ ...base, researchKind: 'legal-concept' }, QUESTION);
    assert.strictEqual(viaCode - plain, 40);
  });

  await test('URL: acts in force only, the form filter, and at most 100 characters (lex.uz refuses more)', () => {
    const ls = require('../src/rag/lex-live-search');
    const u = new URL(ls.buildLexSearchUrl('pudratchining javobgarligi', { actForm: 'code' }));
    assert.deepStrictEqual([u.searchParams.get('Query'), u.searchParams.get('status'), u.searchParams.get('form_id')], ['pudratchining javobgarligi', 'Y', '3964']);
    assert.strictEqual(new URL(ls.buildLexSearchUrl('a b', { actForm: 'law' })).searchParams.get('form_id'), '3968');
    assert.strictEqual(new URL(ls.buildLexSearchUrl('a b', { actForm: 'other' })).searchParams.get('form_id'), null);
    const long = new URL(ls.buildLexSearchUrl('so'.repeat(10) + ' ' + 'qidiruv '.repeat(20)));
    assert.ok(long.searchParams.get('Query').length <= 100 && !/\s$/u.test(long.searchParams.get('Query')));
  });

  await test("relaxation: a phrase that found nothing is searched as its first and last two words, connectors dropped", () => {
    const { relaxedQueries } = require('../src/rag/lex-live-search');
    assert.deepStrictEqual(relaxedQueries("avans to'lovini qaytarish majburiyati"), ["avans to'lovini", 'qaytarish majburiyati']);
    assert.deepStrictEqual(relaxedQueries("shartnoma bo'yicha pul mablag'larini undirish"), ['shartnoma pul', "mablag'larini undirish"]);
    assert.deepStrictEqual(relaxedQueries('pudrat va avans'), ['pudrat avans']);
    assert.deepStrictEqual(relaxedQueries('avans qaytarish'), []);
  });

  await test('search: nothing for the phrase -> the shorter form is searched and its acts read; an act number is never relaxed', async () => {
    const seen = [];
    const fl = require.resolve('../src/rag/fetch-lex');
    const lsPath = require.resolve('../src/rag/lex-live-search');
    delete require.cache[lsPath];
    const row = '<table><tbody><tr><td><a href="/docs/-111">Oʻzbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)</a></td></tr></tbody></table>';
    require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
      httpGet: async (url) => { const q = new URL(url).searchParams.get('Query'); seen.push(q || `actnum=${new URL(url).searchParams.get('actnum')}`); return q === "avans to'lovini" ? row : '<html><body></body></html>'; },
      fetchLexDocument: async (url) => ({ title: 'Oʻzbekiston Respublikasining Fuqarolik kodeksi (ikkinchi qism)', body: "Pudratchi avans to'lovini qaytarish majburiyati. Buyurtmachi avansni talab qilishga haqli.", metadata: { source_url: url, is_active: true } }),
    } };
    const ls = require(lsPath);
    const out = await ls.searchLexUz("avans to'lovini qaytarish majburiyati", { scoreText: "avans to'lovini qaytarish", maxDocs: 1 });
    assert.deepStrictEqual(seen, ["avans to'lovini qaytarish majburiyati", "avans to'lovini"]);
    assert.strictEqual(out.length, 1);
    seen.length = 0;
    await ls.searchLexUz('VMQ-589', {});
    assert.deepStrictEqual(seen, ['actnum=589']);
    delete require.cache[fl]; delete require.cache[lsPath];
  });

  await test('the answer pipeline passes each step\'s act form to the search', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /pinnedDocs: step\.pinnedDocs,\n\s+actForm: step\.actForm,/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
