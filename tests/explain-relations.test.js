'use strict';

/**
 * Relations inside a clause (2026-10-08, the #422 live run kept a clause's
 * words but tied its period, condition or status to another act): who ->
 * act -> condition -> when -> exception -> consequence, checked with no AI
 * on the synthetic memorandum (tests/fixtures/explain-eval/09-*). Each
 * general confusion the owner listed has a wrong sentence that must be
 * flagged and a faithful one that must not; every flag is a reason to check
 * by hand (warning mode), never a removal or a verdict. Stub AI only.
 *
 *   node tests/explain-relations.test.js
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ex = require('../src/rag/document-explain');
const rel = require('../src/rag/clause-relations');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const fixtures = loadAll();
const fx = fixtures.find(f => f.id === 'relations-memorandum');
const doc = fx.pages.join('\n\n');
const src = rel.analyseText(doc);
const kinds = text => ex.finishExplanation({ reply: text, source: doc }).check;

(async () => {
  console.log('relations inside a clause (no AI, warning mode):');

  await test('the synthetic memorandum is long (digest path), synthetic, and every key clause is in it once', () => {
    assert.strictEqual(fx.synthetic, true);
    assert.ok(ex.contentChars(doc) > ex.EXPLAIN_FULL_TEXT_MAX);
    for (const k of fx.keyPoints) assert.strictEqual(doc.split(k.anchor).length, 2, k.id);
  });

  await test('each general confusion is flagged for a manual check, with its kind: filing vs registration, a date or a reply period on another act, "not found" read as financial health, reversed order, "or" for "and", possible damage as caused, a definition threshold as a penalty, a dropped criterion', () => {
    for (const w of fx.relationAnswers.wrong) {
      const check = kinds(w.text);
      if (w.kind.startsWith('phrase:')) {
        assert.ok(check.phrases.some(p => p.label === 'moliyaviy holat barqaror'), `${w.trap}: ${JSON.stringify(check.phrases)}`);
      } else {
        assert.ok(check.relations.some(r => r.kind === w.kind), `${w.trap}: ${JSON.stringify(check.relations)}`);
      }
      assert.strictEqual(check.verified, false);
      assert.strictEqual(check.mode, 'flag_for_manual_review');
    }
  });

  await test('the faithful explanation of the same clauses gets no relation flag', () => {
    const check = kinds(fx.relationAnswers.faithful);
    assert.deepStrictEqual(check.relations, []);
    assert.deepStrictEqual(check.phrases, []);
  });

  await test('no false flag where the source itself is repeated: every evaluation document against its own text', () => {
    for (const f of fixtures) {
      const t = f.pages.join('\n\n');
      assert.deepStrictEqual(rel.relationFlags(t, rel.analyseText(t)), [], f.id);
    }
  });

  await test('a denied, doubted or conditional mention is not flagged; the right act with its own period is not flagged', () => {
    for (const ok of [
      "«Oqtosh-Lux» belgisi ro'yxatdan o'tmagan deb xulosa chiqarib bo'lmaydi: hujjatda faqat ariza topshirilmagani aytilgan.",
      "Investor 10 ish kuni ichida javob beradi.",
      "Bitim 60 kalendar kun ichida tuziladi; undan oldin Investor 10 ish kuni ichida javob beradi.",
      "To'lov dalolatnoma imzolanganidan keyin amalga oshiriladi.",
      "Zarar yetkazilishi mumkin.",
      "Yirik bitim — 1 000 000 000 so'mdan ortiq bitim yoki asosiy vositalarni garovga qo'yish bitimi.",
    ]) assert.deepStrictEqual(kinds(ok).relations, [], ok);
  });

  await test('warning mode: nothing is removed; the note says "check by hand", never "wrong"; the AI note is held to the same criteria', () => {
    const text = 'Asosiy bitim 10 ish kuni ichida tuzilishi kerak.';
    const done = ex.finishExplanation({ reply: text, source: doc });
    assert.ok(done.reply.startsWith(text));
    assert.ok(done.reply.includes("Asosiy matn — manba bilan qo'lda tekshirish kerak: hujjatdagidan boshqacha bog'langan bo'lishi mumkin: «10 ish kuni» javobda «bitim tuzish» bilan, hujjatda «javob berish» bilan (bog'lanish)"), done.reply);
    assert.ok(!/noto'g'ri\b(?! degani)|olib tashlandi/u.test(done.notes.join(' ')));
    const inNote = ex.finishExplanation({ reply: `Matn.\n\n**AI izohi:** ${text}`, source: doc }).check.sections.aiNote;
    const inBody = ex.finishExplanation({ reply: `**Izoh**\n${text}`, source: doc }).check.sections.body;
    assert.deepStrictEqual(inNote.relations, inBody.relations);
    assert.ok(done.reply.includes("muddat/sana qaysi harakatga bog'langani"), 'the check says what it compared');
  });

  await test('the digest: each key clause\'s who / act / status / condition / period / exception / consequence / criteria, found word for word or not, per stage', () => {
    // a digest that keeps every line but drops relations
    const lossy = doc.split('\n').filter(l => /^\d+\.\d+\./u.test(l)).map(l => `- ${l
      .replace(/, sud yoki .*bundan mustasno/u, '')
      .replace(/imzolanganidan keyin /u, '')
      .replace(/ yoki direktorni tayinlash huquqiga ega bo'lgan shaxs/u, '')
      .replace(/hali ro'yxatdan o'tkazilmagan/u, "ro'yxat jarayonida")}`).join('\n');
    const rows = Object.fromEntries(rel.relationTrace({ source: doc, digest: lossy, answer: fx.relationAnswers.faithful }).map(r => [r.ref, r]));
    assert.deepStrictEqual(rows['5.3'].notFound.digest, { exception: ['istisno'] });
    assert.deepStrictEqual(rows['3.1'].notFound.digest.condition, ['keyin']);
    assert.ok(rows['4.2'].notFound.digest.criteria[0].startsWith('direktorni tayinlash'));
    assert.deepStrictEqual(rows['1.1'].notFound.digest.status, ["ro'yxatdan o'tkazish: inkor"]);
    for (const id of ['5.3', '3.1', '4.2', '1.1']) assert.strictEqual(rows[id].firstNotFoundAt, 'digest', id);
    assert.ok(Object.values(rows).every(r => r.kind === 'relation_slots'));
    // the same digest with its lines intact: nothing of those slots is lost there
    const faithful = doc.split('\n').filter(l => /^\d+\.\d+\./u.test(l)).map(l => `- ${l}`).join('\n');
    const kept = Object.fromEntries(rel.relationTrace({ source: doc, digest: faithful, answer: faithful }).map(r => [r.ref, r]));
    for (const id of ['5.3', '3.1', '4.2', '1.1']) assert.deepStrictEqual(kept[id].notFound.digest, {}, id);
    // a digest in the new line format that ties a period to another act is flagged like an answer
    const flags = rel.relationFlags('- 2.1 | Investor → bitim tuzish | muddat: 10 ish kuni', src, { stage: 'dayjest' });
    assert.deepStrictEqual(flags.map(f => f.note), ['«10 ish kuni» dayjestda «bitim tuzish» bilan, hujjatda «javob berish» bilan']);
    assert.deepStrictEqual(rel.relationFlags("- 3.1 | Investor → to'lov | shart: dalolatnoma imzolanganidan keyin | muddat: 5 bank kuni", src, { stage: 'dayjest' }), []);
  });

  await test('the key-line list: every key clause of the memorandum is a candidate (status, period, order, and/or, possibility, threshold, criteria - not only scope words)', () => {
    const sel = ex.scopeSelection(doc);
    for (const k of fx.keyPoints) assert.ok(sel.full.some(l => l.includes(k.anchor)), k.id);
    // a ";" no longer splits a finding from its status
    assert.ok(sel.full.some(l => l.includes("ariza topshirgan; tovar belgisi hali ro'yxatdan o'tkazilmagan")));
    assert.ok(sel.candidates <= sel.limits.max, JSON.stringify(sel.limits));
  });

  await test('repetition: a line the model already has word for word is a reference, not a repeat; a digest line that lost a part keeps the source line whole', () => {
    // full text: every line is in it
    const short = fixtures.find(f => f.id === 'contract-supply').pages.join('\n\n');
    const full = ex.scopeSelection(short);
    const ref = ex.scopeSelection(short, { given: short });
    assert.strictEqual(ref.referenced, ref.selected);
    assert.ok(ref.chars < full.chars && ref.savedChars > 0, `${ref.chars} vs ${full.chars}`);
    assert.ok(ref.lines.every(l => / \[matnda\]$/u.test(l) && l.length <= 100), ref.lines.join('\n'));
    // digest: a line carried whole by the digest is a reference; a lossy one stays whole
    const clauseLines = doc.split('\n').filter(l => /^\d+\.\d+\./u.test(l));
    const faithful = clauseLines.map(l => `- ${l}`).join('\n');
    const lossy = clauseLines.map(l => `- ${l.replace(/, sud yoki .*bundan mustasno/u, '').replace(/ va Jamiyat direktori/u, '')}`).join('\n');
    const a = ex.scopeSelection(doc, { given: faithful });
    const b = ex.scopeSelection(doc, { given: lossy });
    assert.ok(a.lines.filter(l => / \[(?:matnda|dayjestda)\]$/u.test(l)).length === a.selected, a.lines.join('\n'));
    const line53 = b.lines.find(l => l.startsWith('5.3.'));
    assert.ok(line53 && line53.includes('bundan mustasno') && !/\[(?:matnda|dayjestda)\]$/u.test(line53), line53);
    const line32 = b.lines.find(l => l.startsWith('3.2.'));
    assert.ok(line32 && line32.includes('Investor va Jamiyat direktori'), line32);
  });

  await test('the prompts carry the general relation rules, with no word of the synthetic documents', () => {
    const p = ex.DIGEST_SYSTEM + '\n' + ex.explainSystem('Uzbek');
    for (const rule of ['<who> → <act> | shart: <condition> | muddat: <period or date> | istisno: <exception> | oqibat: <consequence>',
      'goes on the line of the act the excerpt attaches it to', 'a deadline to reply is not a deadline to conclude',
      'says nothing about financial health', 'damage that "may" occur is not damage caused', 'a threshold inside a definition is not a penalty',
      'Keep each period, date, condition, exception and consequence on the act the document attaches it to']) assert.ok(p.includes(rule), rule);
    for (const w of ['Oqtosh', 'Qorasuv', 'Lux', 'memorandum', 'kafolat', 'Investor']) assert.ok(!p.toLowerCase().includes(w.toLowerCase()), w);
  });

  await test('the trace script reports relations per stage - mechanical, never a verdict - from a dashboard bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
    const sel = ex.scopeSelection(doc);
    const bundle = { source: doc, response: { reply: 'x', trace: {
      digest: '- 2.1 | Investor → bitim tuzish | muddat: 10 ish kuni', scopeLines: sel.full, scopeSent: sel.lines, scopeDropped: ['99.1. Sig\'magan qator'],
      scopeCounts: { candidates: sel.candidates + 1, selected: sel.selected, dropped: 1, shortened: 0, referenced: 0 },
      answer: fx.relationAnswers.wrong.map(w => w.text).join(' ') } } };
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(bundle));
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-trace.js'), '--bundle', path.join(dir, 'b.json')], { encoding: 'utf8' });
    assert.ok(out.includes('RELATIONS - MECHANICAL, word for word'), out);
    assert.ok(/Tied differently than in the source - digest \(1\):\n  \[bog'lanish\] «10 ish kuni» dayjestda «bitim tuzish» bilan/u.test(out), out);
    assert.ok(/Tied differently than in the source - answer \((\d+)\)/u.test(out) && Number(out.match(/answer \((\d+)\)/u)[1]) >= 8, out);
    assert.ok(out.includes('not fitted: 99.1. Sig\'magan qator'));
    assert.ok(!/meaning (was )?(kept|lost)|LOST|is wrong/iu.test(out.replace(/never a verdict on meaning|not a judgement of meaning|A lawyer compares the meaning/gu, '')));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
