'use strict';

/**
 * The second, bounded lex.uz round (legal-research-playbook): when it runs,
 * what the model is asked (no answer, lex.uz terms only), what is accepted
 * from it (no number-only query, no URL, no repeat, at most 4-6), and how
 * the server wires it (time limit, round one kept on any failure, ledger
 * stage retrieval_plan). No network, no AI.
 *
 *   node tests/lex-followup.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pb = require('../src/rag/legal-research-playbook');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const three = [{ url: 'a' }, { url: 'b' }, { url: 'c' }];

test('mode: weak by default; off and always from LEX_FOLLOWUP', () => {
  assert.strictEqual(pb.lexFollowUpMode({}), 'weak');
  assert.strictEqual(pb.lexFollowUpMode({ LEX_FOLLOWUP: 'OFF' }), 'off');
  assert.strictEqual(pb.lexFollowUpMode({ LEX_FOLLOWUP: 'always' }), 'always');
  assert.strictEqual(pb.lexFollowUpMode({ LEX_FOLLOWUP: 'yes' }), 'weak');
});

test('weak: runs on a weak corpus grade, a thin first round or a special status; not on a well-covered ordinary question', () => {
  const q = 'Mehnat shartnomasini bekor qilish tartibi qanday?';
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'weak', firstRound: three, question: q }), false);
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'weak', needsWebSearch: true, firstRound: three, question: q }), true);
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'weak', firstRound: three.slice(0, 2), question: q }), true);
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'weak', firstRound: three, question: "IT-park rezidentiman. Chet eldan mutaxassis jalb qilmoqchiman, tasdiqnoma kerakmi?" }), true);
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'off', needsWebSearch: true, firstRound: [], question: q }), false);
  assert.strictEqual(pb.shouldRunLexFollowUp({ mode: 'always', firstRound: three, question: q }), true);
});

test('prompt: no answer asked, found titles listed, numbers-only and other sites forbidden, user text escaped', () => {
  const p = pb.buildLexFollowUpPrompt('Savol <b>', [{ title: 'Texnologik park nizomi', content: 'Rezident chet ellik mutaxassislarni jalb etish' }]);
  assert.ok(/Huquqiy javob BERMANG/u.test(p) && /1\. Texnologik park nizomi/u.test(p));
  assert.ok(/faqat raqam/u.test(p) && /Boshqa sayt, URL/u.test(p));
  assert.ok(p.includes('Savol &lt;b&gt;'));
});

test('parse: titles and terms kept; a number alone, a URL, a repeat or an over-limit query dropped', () => {
  const text = '```json\n' + JSON.stringify({ enough: false, queries: [
    { query: "Mehnat faoliyatini amalga oshirish huquqini beruvchi tasdiqnoma berish davlat xizmati ma'muriy reglamenti", why: 'istisnolar' },
    { query: 'VMQ-86', why: 'raqam' },
    { query: 'VMQ-86 son qarori', why: 'raqam' },
    { query: 'https://lex.uz/docs/-123', why: 'url' },
    { query: 'texnopark rezidenti chet ellik', why: 'takror' },
    { query: "Chet el fuqarolarining mehnat migratsiyasi to'g'risida", why: 'b' },
    { query: "Xorijiy mutaxassislarni jalb qilish nizomi", why: 'c' },
    { query: "IT-viza berish tartibi to'g'risidagi nizom", why: 'd' },
    { query: "Beshinchisi ortiqcha so'rov", why: 'e' },
  ] }) + '\n```';
  const r = pb.parseLexFollowUpResponse(text, { already: ['Texnopark rezidenti chet ellik'] });
  assert.deepStrictEqual(r.steps.map(s => s.query), [
    "Mehnat faoliyatini amalga oshirish huquqini beruvchi tasdiqnoma berish davlat xizmati ma'muriy reglamenti",
    "Chet el fuqarolarining mehnat migratsiyasi to'g'risida",
    'Xorijiy mutaxassislarni jalb qilish nizomi',
    "IT-viza berish tartibi to'g'risidagi nizom",
  ]);
  assert.ok(r.steps.every(s => s.kind === 'follow-up' && s.maxDocs === 2 && s.includeRegistry === false));
  assert.strictEqual(r.enough, false);
  assert.deepStrictEqual(pb.parseLexFollowUpResponse('{"enough": true, "queries": []}'), { enough: true, steps: [] });
  assert.deepStrictEqual(pb.parseLexFollowUpResponse('bu JSON emas'), { enough: false, steps: [] });
  assert.strictEqual(pb.parseLexFollowUpResponse(text, { max: 99 }).steps.length, 6, 'never over 6');
});

test('server: after round one, bounded by time, round one kept on failure, ranked with round one, ledger stage retrieval_plan', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  const at = src.indexOf('const followUpMode = lexFollowUpMode();');
  assert.ok(at > src.indexOf('lexLiveResults = selectLexResearchResults(lexGroups, originalQuestion, 6);'));
  const body = src.slice(at, at + 2600);
  assert.ok(/LEX_FOLLOWUP_MAX_MS/u.test(body) && /Promise\.race/u.test(body), 'time limit');
  assert.ok(/selectLexResearchResults\(\[\.\.\.lexGroups, \.\.\.groups2\], originalQuestion, 8\)/u.test(body));
  assert.ok(/round one kept/u.test(body));
  assert.ok(/endpoint: '\/rag\/lex-plan-followup'/u.test(body));
  // the answer and its claim check keep their time (2026-10-13)
  const pre = src.slice(at, at + 1400);
  assert.ok(/usageLedger\.current\(\)/u.test(pre) && /LEX_FOLLOWUP_RESERVE_MS\) \|\| 60000/u.test(pre) && /leftMs - reserveMs < 5000/u.test(pre));
  assert.ok(/Math\.min\(leftMs - reserveMs,/u.test(pre), 'the round never runs past the reserve');
  const ledger = fs.readFileSync(path.join(__dirname, '../src/ai/usage-ledger.js'), 'utf8');
  assert.ok(/\[\/query-plan\|lex-plan\/u, 'retrieval_plan'\]/u.test(ledger));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
