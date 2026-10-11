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
    assert.ok(done.reply.includes("Asosiy matn — manba bilan qo'lda tekshirish kerak: hujjatdagidan boshqacha bog'langan bo'lishi mumkin: «10 ish kuni» javobda «bitim tuzish» bilan; hujjatning shu bandida «bitim tuzish» uchun «60 kalendar kun», «10 ish kuni» esa «javob berish» uchun (bog'lanish)"), done.reply);
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
    assert.deepStrictEqual(flags.map(f => f.note), ['«10 ish kuni» dayjestda «bitim tuzish» bilan, hujjatning shu bandida «javob berish» bilan']);
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

  await test('negation and conditions count only for the claim they are about: a wrong period, amount or act inside an "if" is still flagged; a denial in another clause does not hide a claim', () => {
    const rels = t => kinds(t).relations.map(r => r.kind);
    // a conditional sentence still makes claims about periods, amounts and acts
    assert.deepStrictEqual(rels('Agar asosiy bitim 10 ish kuni ichida tuzilmasa, Investor taklifdan voz kechadi.'), ["bog'lanish"]);
    assert.deepStrictEqual(rels("Agar Investor to'lovni kechiktirsa, 1 000 000 000 so'm jarima to'laydi."), ["ta'rif"]);
    // the consequence of an "if" is a claim; only the condition itself is hypothetical
    assert.deepStrictEqual(rels("Agar ma'lumot oshkor qilinsa, Jamiyatga 300 000 000 so'm zarar yetkaziladi."), ['ehtimollik']);
    assert.deepStrictEqual(rels("Agar zarar yetkazilsa, Jamiyat talab qilishi mumkin."), []);
    assert.deepStrictEqual(rels("Agar «Oqtosh-Lux» ro'yxatdan o'tmagan bo'lsa, uni ro'yxatdan o'tkazish kerak."), [], 'a status inside the condition is not stated');
    // a denial of THIS claim takes it out; a denial of another claim does not
    assert.deepStrictEqual(rels("10 ish kuni bitim tuzish muddati emas, balki javob muddati."), []);
    assert.deepStrictEqual(rels("«Oqtosh-Lux» belgisi ro'yxatdan o'tmagan, lekin bu noqonuniy degani emas."), ['holat']);
    // the same scoping for the phrase check (status, consequence)
    const dd = ex.markPages(fixtures.find(f => f.id === 'due-diligence').pages);
    const phr = t => ex.finishExplanation({ reply: t, source: dd }).check.phrases.map(p => p.label);
    assert.deepStrictEqual(phr('Agar shartnoma buzilsa, Jamiyat jinoiy javobgarlikka tortiladi.'), ['javobgarlikka tortish', 'jinoiy']);
    assert.deepStrictEqual(phr("Belgi ro'yxatdan o'tmagan, lekin bu noqonuniy degani emas."), ["ro'yxatdan o'tmagan"]);
    assert.deepStrictEqual(phr("Agar belgi ro'yxatdan o'tmagan bo'lsa, boshqalar undan foydalanishi mumkin."), []);
  });

  await test('the evaluation set (correct paraphrases that do not repeat the source, wrong sentences in the source\'s own words): results for THIS set only, as documented', () => {
    const r = require('../scripts/explain-relations-eval').evaluate();
    assert.strictEqual(r.scope, 'synthetic evaluation set only - not a semantic accuracy guarantee');
    assert.deepStrictEqual([r.correct.noFlag, r.correct.total], [9, 12], JSON.stringify(r.correct.falseFlags));
    assert.deepStrictEqual(r.correct.falseFlags.map(c => c.id).sort(), ['c-conclude-sign', 'c-control', 'c-not-found']);
    assert.deepStrictEqual([r.wrong.flagged, r.wrong.expectedKind, r.wrong.total], [12, 11, 12]);
    assert.deepStrictEqual(r.wrong.otherKind.map(w => w.id), ['w-financial']);
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-relations-eval.js')], { encoding: 'utf8' });
    assert.ok(out.includes('For this set only - not a semantic accuracy guarantee.'), out);
  });

  await test('digest fit: a part is cut at a clause start, the overlap with the previous part is marked as context, and a part predicted over the cap (no AI) is read as halves from the start within the same extra-call limit', async () => {
    // clause boundary: no paragraph break in the window, the cut falls before a numbered clause
    const clauses = Array.from({ length: 120 }, (_, i) => `${i + 1}.1. Tomon ${'abcdefghijklmnopqrst'[i % 20]}${'uvwxyz'[Math.floor(i / 20)]}lik majburiyatini ${10 + i} kun ichida bajaradi, bundan tashqari xabar beradi.`).join('\n');
    const chunks = ex.digestChunks(clauses).chunks;
    for (const c of chunks.slice(0, -1)) assert.ok(/\n$/u.test(c.text) && /^\d+\.1\. /u.test(clauses.slice(c.end)), clauses.slice(c.end - 20, c.end + 20));
    // overlap marked; every call records its predicted size for calibration
    const calls = [];
    const ai = async (m, o) => { calls.push({ text: m[1].text, detail: o.detail }); return { text: '- band', provider: 'stub' }; };
    const lease = ex.markPages(fixtures.find(f => f.id === 'long-lease').pages);
    const d = await ex.buildDigest(lease, { callAI: ai });
    assert.ok(calls.slice(1).every(c => /\n\n\[KONTEKST\]\n[\s\S]+\n\[QISM\]\n/u.test(c.text)), calls[1].text.slice(0, 200));
    assert.ok(!calls[0].text.includes('[KONTEKST]'));
    assert.ok(calls.every(c => Number.isInteger(c.detail.predictedTokens)));
    assert.ok(ex.DIGEST_SYSTEM.includes('Text under "[KONTEKST]" was digested with the previous excerpt'));
    // these parts are under the cap: no pre-split
    assert.strictEqual(d.preSplits, 0);
    // a document too dense for 13 parts at the target (2026-10-09): cut into
    // 13 equal parts, reported 'over' (never 'fits'); a part predicted over
    // the cap -> halves from the start, one extra call each, never past maxExtraCalls
    const dense = Array.from({ length: 2700 }, (_, i) => `${i + 1}.1. Tomon ${i.toString(26).split('').map(x => String.fromCharCode(97 + parseInt(x, 26))).join('')}lik majburiyatini bajaradi.`).join('\n');
    const densePlan = ex.digestChunks(dense);
    assert.ok(dense.length <= 120000 && densePlan.covered && densePlan.chunks.length === ex.MAX_CHUNKS, String(densePlan.chunks.length));
    assert.strictEqual(densePlan.density.fit, 'over');
    assert.ok(densePlan.density.overCap > 0 && densePlan.density.calibrated === false);
    const calls2 = [];
    const d2 = await ex.buildDigest(dense, { callAI: async (m, o) => { calls2.push(o.detail); return { text: '- band', provider: 'stub' }; } });
    const n = ex.digestChunks(dense).chunks.length;
    const eligible = ex.digestChunks(dense).chunks.filter(c => ex.predictDigestTokens(c.text) >= ex.DIGEST_MAX_TOKENS && c.text.length >= 2 * ex.DIGEST_LIMITS.minSplitChars).length;
    assert.ok(eligible >= 2, String(eligible));
    assert.strictEqual(d2.preSplits, Math.min(eligible, ex.DIGEST_LIMITS.maxExtraCalls));
    assert.strictEqual(d2.calls, n + d2.preSplits);
    assert.ok(d2.extraCalls <= ex.DIGEST_LIMITS.maxExtraCalls);
    assert.strictEqual(calls2.filter(x => x.preSplit).length, 2 * d2.preSplits);
    assert.ok(d2.parts.filter(p => p.preSplit).every(p => /^\d+[ab]$/u.test(p.part)));
    assert.strictEqual(d2.plan.density.fit, 'over');
  });

  await test('the trace script refuses a bundle whose source is not the document the trace was made for', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
    const crypto = require('crypto');
    const trace = { digest: null, scopeLines: [], answer: 'x', requestId: 'req-1', tag: 'tr-a', documentSha256: crypto.createHash('sha256').update(doc).digest('hex') };
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ source: `  ${doc}\n`, response: { trace } }));
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ source: `${doc} (boshqa)`, response: { trace } }));
    const ok = execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-trace.js'), '--bundle', path.join(dir, 'ok.json'), '--fixture', 'relations-memorandum'], { encoding: 'utf8' });
    assert.ok(ok.includes('trace of request req-1 (tag tr-a)'), ok.slice(0, 300));
    let code = 0;
    try { execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-trace.js'), '--bundle', path.join(dir, 'bad.json')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
    assert.strictEqual(code, 3);
  });

  await test('repeated clauses are joined only when nothing but their list number differs: an amount, date, percentage, period, name or clause reference keeps them apart', () => {
    const base = "Ijarachi oylik haqni 9 000 000 so'm miqdorida har oyning 5-sanasigacha to'laydi, kechiksa 0,1 foiz penya va 10 kun ichida xabar, 4.2-bandga muvofiq «Alfa» MChJga.";
    const variants = {
      same: base,
      amount: base.replace('9 000 000', '12 000 000'),
      date: base.replace('5-sanasigacha', '10-sanasigacha'),
      percent: base.replace('0,1 foiz', '0,2 foiz'),
      period: base.replace('10 kun', '15 kun'),
      reference: base.replace('4.2-bandga', '4.3-bandga'),
      name: base.replace('«Alfa»', '«Beta»'),
    };
    const text = Object.values(variants).map((v, i) => `${i + 1}.1. ${v}`).join('\n') + `\n9.1. ${base}`;
    const sel = ex.scopeSelection(text);
    // 8 lines: 1.1 and 9.1 differ only in their number -> one; the six others stay
    assert.strictEqual(sel.candidates, 7, sel.full.join('\n'));
    for (const k of ['12 000 000', '10-sanasigacha', '0,2 foiz', '15 kun', '4.3-bandga', '«Beta»']) assert.ok(sel.full.some(l => l.includes(k)), k);
    assert.strictEqual(ex.repeatKey('1.1. Tomon 5 kun ichida.'), ex.repeatKey('27.4. Tomon 5 kun ichida.'));
    assert.notStrictEqual(ex.repeatKey('1.1. Tomon 5 kun ichida.'), ex.repeatKey('1.1. Tomon 6 kun ichida.'));
    // the digest size estimate counts them the same way: the repeat adds nothing
    assert.strictEqual(ex.predictDigestTokens(text), ex.predictDigestTokens(text.split('\n').slice(0, -1).join('\n')));
    // the trace keeps both clauses of a pair that differs in a figure
    const refs = rel.relationTrace({ source: text, answer: 'x' }).map(r => r.ref);
    assert.ok(refs.includes('1.1') && refs.includes('2.1') && !refs.includes('9.1'), refs.join(','));
    // the digest prompt says the same
    assert.ok(ex.DIGEST_SYSTEM.includes('word for word except its own clause number is one line naming all its clause numbers; if any amount, date, percentage, period, name or clause reference differs, they stay separate lines'));
    assert.ok(!ex.DIGEST_SYSTEM.includes('or a name changed'));
  });

  await test('one clause longer than a part: no character lost, and the reading is reported as split - never as a whole reading', async () => {
    const words = Array.from({ length: 3000 }, (_, i) => `soz${i}`).join(' ');
    const long = `1.1. Ijarachi ${words} bundan mustasno.\n2.1. Oxirgi band 5 kun ichida bajariladi.`;
    const plan = ex.digestChunks(long);
    assert.ok(plan.covered);
    const seen = new Uint8Array(long.length);
    for (const c of plan.chunks) { assert.strictEqual(c.text, long.slice(c.start, c.end)); seen.fill(1, c.start, c.end); }
    assert.strictEqual(seen.reduce((a, b) => a + b, 0), long.length, 'every character is in some part');
    const cuts = plan.chunks.filter(c => c.splitAtEnd);
    assert.ok(cuts.length >= 1 && cuts.every(c => c.splitRef === '1.1'), JSON.stringify(cuts.map(c => [c.index, c.splitRef])));
    // the digest, the coverage and the answer say so
    const ai = async (m) => (/^Excerpt /u.test(m[1].text) ? { text: '- band', provider: 'stub' } : { text: 'Izoh.', provider: 'stub' });
    const d = await ex.buildDigest(long, { callAI: ai });
    assert.ok(d.splits.length >= 1 && d.splits.every(x => x.ref === '1.1'));
    assert.strictEqual(ex.coverageStatus(d), 'read_with_splits');
    assert.strictEqual(ex.coverageSummary(d, { finalRun: true }).clauseSplits, d.splits.length);
    const calls = [];
    const r = await ex.explainDocument({ documentText: long, langName: 'Uzbek', callAI: async (m, o) => { calls.push(m); return ai(m, o); }, digest: t => ex.buildDigest(t, { callAI: ai }) });
    assert.strictEqual(r.coverage.status, 'read_with_splits');
    assert.notStrictEqual(r.coverage.status, 'all_read');
    assert.ok(calls[calls.length - 1][1].text.includes("1.1-band ikki qism chegarasida bo'lingan"), 'the final model is told');
    assert.ok(r.reply.includes("Qamrov — qo'lda tekshirish kerak: 1.1-band hujjat qismlari chegarasida bo'lingan"), r.reply.slice(-500));
    // every part was read whole: nothing unread, so not a partial service
    assert.deepStrictEqual(r.coverage.unread, []);
    // a normal document whose lines fit: no split, all_read as before
    const lease = ex.markPages(fixtures.find(f => f.id === 'long-lease').pages);
    assert.ok(ex.digestChunks(lease).chunks.every(c => !c.splitAtEnd));
    // the dashboard names the state and never as complete
    const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    assert.ok(page.includes("read_with_splits: 'qismlar o\\'qildi, lekin band(lar) qismlar chegarasida bo\\'lingan — to\\'liq deb hisoblanmaydi'"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
