'use strict';

/**
 * Which lex.uz acts reach the answer (2026-10-24, owner: quality first). Live
 * on four questions that day, most kept acts only mentioned a word of the
 * question: a Cabinet decision got +110 for being a Cabinet decision
 * ("Foydali qazilmalarni maydalash..." 234 vs the Civil Code 72 on a
 * contractor's advance), and one shared word kept an act. Now the act-form
 * bonuses count only for an act whose title is about the question, an act
 * whose title is not needs 5 of the question's words (a code or law found by
 * its form, 2), roots meet by their start ("pudratchi" / "pudrat"), and one
 * cheap call keeps the acts that govern the question. No network, no AI.
 *
 *   node tests/lex-relevance.test.js
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

const Q = 'Pudratchi ishni bajarmadi, avansni qaytarmayapti';
const vmq = (title, content, extra = {}) => ({ url: `https://lex.uz/docs/-${title.length}`, title, lawName: title, content, ownDocumentNumber: { prefix: 'VMQ' }, searchRankScore: 100, ...extra });

test("an act form's bonus and lex.uz's row rank count only for an act about the question", () => {
  const off = pb.scoreLexResearchResult({ ...vmq('Foydali qazilmalarni maydalash va boyitish', 'pudratchi ishni bajarish javobgarlik'), researchKind: 'cabinet-decision', researchPreferredPrefixes: ['VMQ'] }, Q);
  const on = pb.scoreLexResearchResult({ ...vmq('Pudrat shartnomalarini tuzish tartibi', 'pudratchi ishni bajarish javobgarlik'), researchKind: 'cabinet-decision', researchPreferredPrefixes: ['VMQ'] }, Q);
  const code = pb.scoreLexResearchResult({ url: 'u', title: 'Fuqarolik kodeksi (ikkinchi qism)', content: "pudratchi ishni bajarmasa buyurtmachi avansni qaytarishni talab qilishga haqli", researchKind: 'code-search' }, Q);
  assert.ok(off < code, `off-topic decision ${off} must rank below the code ${code}`);
  assert.ok(on - off >= 110 + 35, 'about it: form bonuses, row rank and title words');
});

test('roots meet by their start: pudratchi / pudrat, avansni / avans, qarzga / qarz; a 4-letter stub of another word does not', () => {
  const s = (q, content) => pb.scoreLexResearchResult({ url: 'u', title: 'x', content }, q);
  assert.ok(s('pudratchi', 'pudrat') > 0 && s('avansni', 'avans') > 0 && s('qarzga', 'qarz shartnomasi') > 0);
  assert.strictEqual(s('pudratchi', 'pudi'), 0);
});

test('selection drops an act not about the question that uses few of its words; keeps codes found by form, pinned and exact acts', () => {
  const groups = [
    { step: { kind: 'cabinet-decision', preferredPrefixes: ['VMQ'] }, results: [vmq('Foydali qazilmalarni maydalash', 'pudratchi ishni bajarish')] },
    { step: { kind: 'natural-language' }, results: [{ url: 'a', title: 'Atom energiyasidan foydalanish', content: 'pudratchi bajarish' }] },
    { step: { kind: 'code-search' }, results: [{ url: 'fk', title: 'Fuqarolik kodeksi (ikkinchi qism)', content: 'pudratchi avansni qaytarish' }] },
    { step: { kind: 'status-act-pinned' }, results: [{ url: 'p', title: 'Boshqa', content: '', source: 'lex.uz-pinned' }] },
    { step: { kind: 'official-concept' }, results: [{ url: 'm', title: 'Kapital qurilish', content: 'pudratchi ishni bajarmasa avansni qaytarish majburiyati va javobgarligi' }] },
  ];
  const kept = pb.selectLexResearchResults(groups, Q, 8).map(r => r.url);
  assert.ok(kept.includes('fk') && kept.includes('p'));
  assert.ok(kept.includes('m'), 'five question words in the text: kept for the judge');
  assert.ok(!kept.includes('a') && !kept.some(u => /docs\/-/u.test(u)), 'one or three shared words are not enough');
});

test('the judge: titles, form and openings go in as data; only readable numbers come out', () => {
  const prompt = pb.buildLexRelevancePrompt('Savol <b>', [{ title: 'Fuqarolik kodeksi', content: 'x'.repeat(500), researchKind: 'code-search' }, { title: 'Ish beruvchining javobgarligini sugʻurta qilish', content: '', ownDocumentNumber: { prefix: 'VMQ' } }]);
  assert.match(prompt, /<user_question_data>Savol &lt;b&gt;<\/user_question_data>/u);
  assert.match(prompt, /1\. \[kodeks\] Fuqarolik kodeksi/u);
  assert.match(prompt, /2\. \[VMQ\] Ish beruvchining/u);
  assert.match(prompt, /Huquqiy javob BERMANG/u);
  assert.ok(!/x{281}/u.test(prompt), 'opening only');
  assert.deepStrictEqual(pb.parseLexRelevanceResponse('```json\n{"keep":[2,1,2,9,"x"]}\n```', 3), [0, 1]);
  assert.deepStrictEqual(pb.parseLexRelevanceResponse('{"keep":[]}', 3), []);
  assert.strictEqual(pb.parseLexRelevanceResponse('hammasi mos', 3), null);
  assert.strictEqual(pb.parseLexRelevanceResponse('{"ok":true}', 3), null);
});

test('the pipeline runs the judge once on the final list, keeps the list on any failure, LEX_RELEVANCE_JUDGE=off stops it', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.match(server, /if \(lexLiveResults\.length > 1 && String\(process\.env\.LEX_RELEVANCE_JUDGE \|\| ''\)\.toLowerCase\(\) !== 'off'\)/u);
  assert.match(server, /endpoint: '\/rag\/lex-relevance'/u);
  assert.match(server, /if \(keep\) \{\n\s+const dropped[^\n]+\n\s+lexLiveResults = keep\.map\(i => lexLiveResults\[i\]\);/u);
  assert.match(server, /\[LEX-RELEVANCE\] failed; acts kept as found/u);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/ai/usage-ledger.js'), 'utf8'), /\[\/lex-relevance\/u, 'source_relevance'\]/u);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
