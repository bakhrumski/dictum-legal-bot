'use strict';

/**
 * Scope words, conditions precedent, criteria, cumulative remedies and
 * clauses that contradict each other across digest parts (2026-10-08, the
 * #421 live run kept every part but lost these between the document and the
 * answer). Mechanical, stub AI: proves what reaches the final model and what
 * is flagged, not the quality of a real answer.
 *
 *   node tests/explain-scope.test.js
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ex = require('../src/rag/document-explain');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const fx = loadAll().find(f => f.id === 'investment-agreement');
const doc = fx.pages.join('\n\n');

function recorder(answer) {
  const calls = [];
  const fn = async (messages, opts) => { calls.push({ messages, opts }); return answer(messages, opts); };
  fn.calls = calls;
  return fn;
}
// a "lossy" digest: one compressed line per numbered clause, the way a
// too-short line drops scope words, conditions and criteria
const lossyLine = l => l
  .replace(/barcha ishtirokchilar, jumladan Investor,/u, 'ishtirokchilar')
  .replace(/e'lon qilingan, lekin to'lanmagan/u, "to'lanmagan")
  .replace(/ deganda .*$/u, ' - muhim aktiv.')
  .replace(/ birinchi transh oldidan/u, '')
  .replace(/qaytarishni, .*$/u, "qaytarishni va jarimani talab qiladi.");
const lossyDigest = (m) => ({ text: m[1].text.split('\n').filter(l => /^\d+\.\d+\./u.test(l)).map(l => `- ${lossyLine(l)}`).join('\n') || '- band', provider: 'stub' });
const faithfulDigest = (m) => ({ text: m[1].text.split('\n').filter(l => /^\d+\.\d+\./u.test(l)).map(l => `- ${l}`).join('\n') || '- band', provider: 'stub' });

(async () => {
  console.log('scope words, conditions, criteria, remedies, contradictions (stub AI):');

  await test('the synthetic agreement: a long document; each key clause reaches a digest part; the two contradictory clauses are in different parts', () => {
    assert.strictEqual(fx.synthetic, true);
    assert.ok(ex.contentChars(doc) > ex.EXPLAIN_FULL_TEXT_MAX);
    const parts = ex.digestChunks(doc).chunks;
    const partOf = anchor => parts.findIndex(c => c.text.includes(anchor));
    for (const k of fx.keyPoints) assert.ok(partOf(k.anchor) >= 0, k.id);
    assert.notStrictEqual(partOf('30 kalendar kun ichida taqdim etadi'), partOf('45 kalendar kun ichida Investorga'));
  });

  await test('the scope lines are picked from the DOCUMENT with no AI: a lossy digest cannot drop "jumladan", "e\'lon qilingan", the criteria, the condition precedent or the added penalty from what the final model gets', async () => {
    const ai = recorder((m) => (/^Excerpt /u.test(m[1].text) ? lossyDigest(m) : { text: 'Izoh.', provider: 'stub' }));
    const r = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: t => ex.buildDigest(t, { callAI: ai }) });
    const final = ai.calls[ai.calls.length - 1].messages[1].text;
    const block = final.slice(final.indexOf('SAQLANADIGAN SHARTLAR'));
    assert.ok(final.indexOf('SAQLANADIGAN SHARTLAR') > final.indexOf('HUJJAT TUGADI'));
    for (const must of ['barcha ishtirokchilar, jumladan Investor', "e'lon qilingan, lekin to'lanmagan dividendlar", 'Sezilarli aktiv deganda', 'birinchi transh oldidan', 'bundan tashqari investitsiya summasining 25 foizi miqdorida alohida jarima']) {
      assert.ok(block.includes(must), must);
    }
    // the digest itself lost them: the trace says where
    const lost = Object.fromEntries(ex.traceStages({ source: doc, digest: r.trace.digest, answer: final, checks: fx.traceChecks }).map(x => [x.id, x.lostAt]));
    assert.strictEqual(lost['distribution-including'], 'digest');
    assert.strictEqual(lost['declared-unpaid'], 'digest');
    assert.strictEqual(lost['condition-precedent'], 'digest');
  });

  await test('contradictions across parts are found on the whole document with no AI and named to the final model as candidates', async () => {
    const pairs = ex.conflictCandidates(doc);
    assert.strictEqual(pairs.length, 1);
    assert.ok(/^4\.2\./u.test(pairs[0][0]) && /^12\.3\./u.test(pairs[0][1]));
    const ai = recorder((m) => (/^Excerpt /u.test(m[1].text) ? faithfulDigest(m) : { text: 'Izoh.', provider: 'stub' }));
    await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: t => ex.buildDigest(t, { callAI: ai }) });
    const final = ai.calls[ai.calls.length - 1].messages[1].text;
    assert.ok(/EHTIMOLIY ZIDDIYATLAR \(AI'siz topildi: [^)]*\):\n- «4\.2\. [^»]*30 kalendar kun[^»]*»  ↔  «12\.3\. [^»]*45 kalendar kun/u.test(final), final.slice(final.indexOf('EHTIMOLIY')));
    // no candidates in a document without such a pair; boilerplate repeats are not candidates
    assert.deepStrictEqual(ex.conflictCandidates(loadAll().find(f => f.id === 'long-lease').pages.join('\n\n')), []);
    assert.deepStrictEqual(ex.conflictCandidates("1.1. Narx 5 000 000 so'm.\n2.1. Narx 5 000 000 so'm bo'lib qoladi."), []);
  });

  await test('the prompts carry the general rules (no document-specific words)', () => {
    const p = ex.explainSystem('Uzbek') + '\n' + ex.DIGEST_SYSTEM;
    for (const rule of ['"including" (jumladan', '"only" (faqat)', '"except"', '"in addition" / "separately" (alohida', 'and" versus "or"', 'conditions precedent', 'every criterion that defines a term', 'every remedy of one breach together',
      'compare items from different parts', 'SAQLANADIGAN SHARTLAR', 'never drop a condition, criterion, exception, remedy or contradiction',
      'never the criteria of a defined term', 'name that reference, so a contradiction with another excerpt can be found']) {
      assert.ok(p.includes(rule), rule);
    }
    for (const word of ['Investor', 'transh', 'dividend', 'Sezilarli', 'Shamol', 'Bahor']) assert.ok(!p.includes(word), word);
  });

  await test('the answer: scope words the document\'s key lines use but the answer never does are named for a manual check (not removed, not called wrong)', () => {
    const scope = ex.scopeLines(doc);
    const lossy = "Qolgan summa ishtirokchilar o'rtasida taqsimlanadi. To'lanmagan dividendlar to'lanadi. Buzilsa qaytarish va jarima.";
    const done = ex.finishExplanation({ reply: lossy, source: doc, scope });
    assert.ok(done.reply.startsWith(lossy));
    assert.ok(done.check.scopeWordsMissing.includes('jumladan') && done.check.scopeWordsMissing.includes("e'lon qilingan") && done.check.scopeWordsMissing.includes("alohida / qo'shimcha"), JSON.stringify(done.check.scopeWordsMissing));
    assert.ok(done.reply.includes("Qamrov so'zlari — manba bilan qo'lda tekshirish kerak: hujjatning saqlanadigan shartlarida bor, javobda uchramadi:"));
    assert.ok(!done.check.scopeWordsMissing.includes("ta'rif"), 'a definition marker is picked, never demanded in the answer');
    const kept = "Qolgan summa barcha ishtirokchilar, jumladan Investor, o'rtasida taqsimlanadi (5.4). E'lon qilingan, lekin to'lanmagan dividendlar ham to'lanadi (5.5). Davlat ro'yxatidan o'tkazish birinchi transh oldidan (8.2). Bundan tashqari alohida 25 foiz jarima (11.2). Aktivlarning 25 foizi yoki 2 000 000 000 so'm mezoni (7.1). Faqat yozma kelishuv bilan; qonunda nazarda tutilgan hollar bundan mustasno.";
    assert.deepStrictEqual(ex.finishExplanation({ reply: kept, source: doc, scope }).check.scopeWordsMissing, []);
  });

  await test('the trace tells digest losses from final-answer losses, as a function and as a script', () => {
    const faithful = doc;
    const answerLossy = "Qolgan summa ishtirokchilar o'rtasida taqsimlanadi; muddat 30 kun.";
    const rows = ex.traceStages({ source: doc, digest: faithful, answer: answerLossy, checks: fx.traceChecks });
    const by = Object.fromEntries(rows.map(r => [r.id, r]));
    assert.strictEqual(by['distribution-including'].lostAt, 'final');
    assert.deepStrictEqual(by['distribution-including'].missing.answer, ['barcha ishtirokchi', 'jumladan', 'investor']);
    assert.strictEqual(by.contradiction.lostAt, 'final');
    const full = ex.traceStages({ source: doc, digest: null, answer: doc, checks: fx.traceChecks });
    assert.ok(full.every(r => r.lostAt === null));
    // the script, on files (synthetic texts only)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
    fs.writeFileSync(path.join(dir, 'digest.txt'), doc.replace(/, jumladan Investor,/u, ''));
    fs.writeFileSync(path.join(dir, 'answer.txt'), 'Izoh.');
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-trace.js'), '--fixture', 'investment-agreement',
      '--digest', path.join(dir, 'digest.txt'), '--answer', path.join(dir, 'answer.txt')], { encoding: 'utf8' });
    assert.ok(/distribution-including\s+LOST IN DIGEST/u.test(out), out);
    assert.ok(/declared-unpaid\s+LOST IN FINAL ANSWER/u.test(out), out);
  });

  await test('cost of the change: the two blocks add input only, no call and no output cap', async () => {
    const ai = recorder((m) => (/^Excerpt /u.test(m[1].text) ? faithfulDigest(m) : { text: 'Izoh.', provider: 'stub' }));
    await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: t => ex.buildDigest(t, { callAI: ai }) });
    const final = ai.calls[ai.calls.length - 1];
    const extra = final.messages[1].text.slice(final.messages[1].text.indexOf('─── HUJJAT TUGADI ───'));
    assert.ok(Buffer.byteLength(extra) < 12000, `${Buffer.byteLength(extra)} bytes`);
    assert.strictEqual(final.opts.maxTokens, ex.EXPLAIN_MAX_TOKENS);
    assert.strictEqual(ex.EXPLAIN_MAX_TOKENS, 3000);
    assert.strictEqual(ai.calls.filter(c => !/^Excerpt /u.test(c.messages[1].text)).length, 1, 'one final call, as before');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
