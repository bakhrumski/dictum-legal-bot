'use strict';

/**
 * Regression of a production diagnostics run (2026-10-08), on ANONYMOUS
 * SYNTHETIC text only - the error types, never the document's names, sums or
 * wording. Stub AI, no paid call. A pass shows the mechanical checks see these
 * error types; it is not a measure of model quality.
 *
 *   node tests/explain-regression.test.js
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ex = require('../src/rag/document-explain');
const rel = require('../src/rag/clause-relations');
const { docxText, withoutMarkup } = require('../src/ocr/docx-text');
const ledger = require('../src/rag/tariff-ledger');
const { docx, p, cell, row, table } = require('./helpers/mini-docx');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const fx = loadAll().find(f => f.id === 'regression-digest-answer');
const src = fx.pages.join('\n\n');
const digest = { text: fx.digest, chunks: 2, failed: [], truncated: [], covered: true, splits: [] };
const finish = reply => ex.finishExplanation({ reply, source: src, digest });

// a KPI-like annex: section rows across the table, a two-row header, a merged
// deadline, an empty cell, and the last row's deadline different from the rows above
async function kpiDocx({ longRow = 0 } = {}) {
  return docx(p('2-ilova. Ko\'rsatkichlar') + table([
    row([cell('№'), cell('Ish'), cell('Talab', { span: 2 }), cell('Muddat')], { header: true }),
    row([cell(''), cell(''), cell('Miqdor'), cell('Birlik'), cell('')], { header: true }),
    row([cell('Texnik bosqich', { span: 5 })]),
    row([cell('1'), cell('Sinov muhitini joriy etish'), cell('1'), cell('muhit'), cell('2031-yil, I chorak', { vmerge: 'restart' })]),
    row([cell('2'), cell('Xavfsizlik nazoratini kuchaytirish'), cell(''), cell(''), cell('', { vmerge: 'continue' })]),
    row([cell('Sotuv bosqichi', { span: 5 })]),
    row([cell('3'), cell('Foydalanuvchilar bazasini kengaytirish'), cell('kamida 70 000'), cell('nafar'), cell('2031-yil, III chorak (9-oy yakuni)')]),
    row([cell('4'), cell(`Oylik takrorlanuvchi tushum${longRow ? ` ${'izoh '.repeat(longRow)}` : ''}`), cell('kamida 6 200'), cell('dollar'), cell('2031-yil, avgust (1 oy)')]),
  ]) + p('Yakuniy qoidalar.'));
}

(async () => {
  console.log('production regression, synthetic text (mechanical; stub AI):');

  await test('the fixture is synthetic: only its own invented parties, error types not wording', () => {
    assert.strictEqual(fx.synthetic, true);
    const quoted = [...new Set([...fx.pages.join('\n').matchAll(/"([^"]+)" (?:MChJ|AJ)/gu)].map(m => m[1]))].sort();
    assert.deepStrictEqual(quoted, ['Nurli Texnologiya', 'Sarvar Kapital']);
  });

  await test('[Qism n/m] and [Qism na/m] are the system\'s labels, never "a figure not in the document"; a real fraction still is checked', () => {
    const v = ex.verifyExplanation("Haq 9 000 000 so'm [Qism 3/7 · 1-sahifa]. Shart (Qism 2/7, Qism 7a/7, qism 10b/13). Ulushning 2/3 qismi.", "[Sahifa 1]\n1.1. Haq 9 000 000 so'm.");
    assert.deepStrictEqual(v.numbers, ['2/3']);
    // the production case: one label was flagged; now none
    assert.deepStrictEqual(finish(fx.answerWrong).check.numbers, []);
    // a fraction the document has is fine
    assert.deepStrictEqual(ex.verifyExplanation('Ulushning 2/3 qismi.', 'Ulushning 2/3 qismi sotiladi.').numbers, []);
  });

  await test('contradiction candidates compare object, act, stage and calculation base - a different figure alone is not one, and a 100% sum alone does not exclude one', () => {
    // a sanction and a definition threshold over the same money: different roles
    assert.deepStrictEqual(ex.conflictCandidates("Jamiyat Investorga ajratilgan mablag'larning 30 foizi miqdorida jarima to'laydi.\nJiddiy buzilish deganda zarari ajratilgan mablag'lar miqdorining 15 foizidan ortiq bo'lgan buzilish tushuniladi."), []);
    // two tranches (different stage) that add up to 100%
    assert.deepStrictEqual(ex.conflictCandidates("Investor 1-transhda jami mablag'larning 60 foizini ajratadi.\nInvestor 2-transhda jami mablag'larning 40 foizini ajratadi."), []);
    // a penalty and a fine (different object)
    assert.deepStrictEqual(ex.conflictCandidates("Ijarachi kechiktirilgan har bir kun uchun kechiktirilgan summaning 0,1 foizi miqdorida penya to'laydi.\nIjarachi kechiktirilgan har bir kun uchun kechiktirilgan summaning 0,5 foizi miqdorida jarima to'laydi."), []);
    // the same stage, base and role with another value: a candidate, even if the two add up to 100%
    assert.strictEqual(ex.conflictCandidates("Avans shartnoma qiymatining 30 foizi miqdorida imzolangandan keyin to'lanadi.\nAvans shartnoma qiymatining 70 foizi miqdorida imzolangandan keyin to'lanadi.").length, 1);
    // two periods for one matter (a duty and a right): a candidate
    assert.strictEqual(ex.conflictCandidates(src).length, 1);
    // the evaluation set keeps its designed contradictions only
    const byId = id => loadAll().find(f => f.id === id).pages.join('\n\n');
    assert.strictEqual(ex.conflictCandidates(byId('investment-agreement')).length, 1);
    assert.deepStrictEqual(ex.conflictCandidates(byId('long-lease')), []);
  });

  await test('two periods for one matter: an answer that states one, or blends them, is flagged; one that states both is not', () => {
    assert.strictEqual(finish(fx.answerWrong).check.periodChoices.length, 1);
    assert.ok(finish(fx.answerWrong).reply.includes("Muddatlar — qo'lda tekshirish kerak: hujjatda shu masala bo'yicha ikki xil muddat bor"));
    assert.deepStrictEqual(finish(fx.answerFaithful).check.periodChoices, []);
  });

  await test('digest -> answer: what the digest kept and the answer does not hold word for word is a signal to check by hand - never a verdict, nothing removed', () => {
    const done = finish(fx.answerWrong);
    assert.ok(done.reply.startsWith(fx.answerWrong), 'the answer is shown as written');
    const sig = Object.fromEntries(done.check.digestSignals.map(x => [x.topic, x.lost.map(l => `${l.part}: ${l.value}`)]));
    assert.ok(sig['Tugatish imtiyozi summasi (ta\'rif)'].includes("qamrov so'zi: e'lon qilingan"), JSON.stringify(sig));
    assert.ok(sig['Taqsimlanadigan summa'].includes("qamrov so'zi: jumladan") && sig['Taqsimlanadigan summa'].includes("qamrov so'zi: barcha"));
    assert.ok(sig['Ustuvor huquq javobi'].some(x => x.startsWith('muddat boshlanishi: dayjestda «yuborilgan')));
    assert.ok(sig['Maqsadli foydalanish buzilishi'].includes('oqibat: barcha xarajatlarni qoplash') && sig['Maqsadli foydalanish buzilishi'].includes("qamrov so'zi: alohida"));
    const note = done.notes.find(n => n.startsWith('Dayjest → javob'));
    assert.ok(note.startsWith("Dayjest → javob (mexanik, so'z bo'yicha; ma'no hukmi emas) — qo'lda tekshirish kerak:") && note.endsWith("Javobda boshqa so'z bilan aytilgan bo'lishi ham mumkin."));
    assert.ok(!/noto'g'ri\b(?! degani)|yo'qotilgan|xato/iu.test(note), 'no verdict');
    assert.strictEqual(done.check.verified, false);
    // the faithful answer: no such signal
    assert.deepStrictEqual(finish(fx.answerFaithful).check.digestSignals, []);
    // "may" in the source stated as "must"
    assert.ok(done.check.relations.some(r => r.kind === 'majburiyat' && r.note.includes('javob berishlari kerak')));
    assert.ok(!finish(fx.answerFaithful).check.relations.some(r => r.kind === 'majburiyat'));
  });

  await test('DOCX tables keep row, column and header: merged cells, a two-row header, an empty cell, a value merged down - and no text is lost to the reader', async () => {
    const buf = await kpiDocx();
    const r = await docxText(buf);
    assert.strictEqual(r.reader, 'tables');
    const lines = r.text.split('\n');
    assert.ok(lines.includes("⟦Jadval 1 · sarlavha⟧ № ¦ Ish ¦ Talab ¦ Muddat ⟨/⟩ ⟨bo'sh⟩ ¦ ⟨bo'sh⟩ ¦ Miqdor ¦ Birlik ¦ ⟨bo'sh⟩"), r.text);
    assert.ok(lines.includes("⟦Jadval 1 · bo'lim⟧ Texnik bosqich"));
    const row4 = lines.find(l => l.startsWith('⟦Jadval 1 · 4-qator'));
    assert.strictEqual(row4, '⟦Jadval 1 · 4-qator · Sotuv bosqichi⟧ ⟨№⟩ 4 ¦ ⟨Ish⟩ Oylik takrorlanuvchi tushum ¦ ⟨Talab / Miqdor⟩ kamida 6 200 ¦ ⟨Talab / Birlik⟩ dollar ¦ ⟨Muddat⟩ 2031-yil, avgust (1 oy)');
    const row2 = lines.find(l => l.startsWith('⟦Jadval 1 · 2-qator'));
    assert.ok(row2.includes("⟨Talab / Miqdor⟩ ⟨bo'sh⟩") && row2.includes('⟨Muddat⟩ ⟨↑ 2031-yil, I chorak⟩'), row2);
    // every character of the document's own text is there (mammoth sees the same words)
    const mam = (await require('mammoth').extractRawText({ buffer: buf })).value.replace(/\s+/gu, '');
    assert.ok(withoutMarkup(r.text).replace(/\s+/gu, '').length >= mam.length * 0.97);
    // a document without a table reads exactly as before
    const plain = await docxText(await docx(p('1.1. Oddiy band.') + p('1.2. Ikkinchi band.')));
    assert.deepStrictEqual([plain.reader, plain.text], ['mammoth', '1.1. Oddiy band.\n\n1.2. Ikkinchi band.']);
  });

  await test('the billable size is the document\'s own text, measured on the server and signed - the table markup is never billed, and a client-sent size is never trusted', async () => {
    const r = await docxText(await kpiDocx());
    const own = ex.contentChars(r.text);
    assert.ok(own < r.text.length, 'markup excluded');
    assert.strictEqual(own, withoutMarkup(r.text).length);
    const ticket = ledger.readDocTicket(ledger.signDocTicket({ text: r.text, chars: own }), r.text);
    assert.strictEqual(ex.billableChars(r.text, ticket), own);
    // the same text without a valid ticket: the markup is counted (never below what was sent)
    assert.strictEqual(ex.billableChars(r.text, null), r.text.length);
    assert.strictEqual(ledger.readDocTicket(ledger.signDocTicket({ text: r.text, chars: own }), `${r.text}x`), null, 'another text: no ticket');
    // a client wrapping its whole text in the markup gains nothing without the server's ticket
    const wrapped = '⟨' + 'x'.repeat(5000) + '⟩';
    assert.strictEqual(ex.billableChars(wrapped, null), 5002);
    // the route signs its own measure
    const routes = fs.readFileSync(path.join(__dirname, '../src/ocr/routes.js'), 'utf8');
    assert.ok(routes.includes("const chars = contentChars(text);") && routes.includes('ledger.signDocTicket({ text, chars })'));
    const tiers = fs.readFileSync(path.join(__dirname, '../src/rag/subscription-tiers.js'), 'utf8');
    assert.ok((tiers.match(/billableChars\(clean, ticket\)/gu) || []).length >= 2);
  });

  await test('the real extract route over HTTP: a DOCX with a table comes back row by row, the ticket carries the server-measured size, no AI call', async () => {
    const express = require('express');
    const http = require('http');
    const app = express();
    let ai = 0;
    require('../src/ocr/routes').mountAnalyzerRoutes(app, { requireAuth: (q, s, n) => n(), callAI: async () => { ai++; return { text: '{}' }; },
      tariffModule: require('../src/rag/subscription-tiers'), pool: { query: async () => ({ rows: [] }) } });
    const server = http.createServer(app).listen(0);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([await kpiDocx()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'ilova.docx');
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze/extract`, { method: 'POST', body: fd });
      const d = await r.json();
      assert.strictEqual(r.status, 200, JSON.stringify(d));
      assert.ok(d.text.includes('⟦Jadval 1 · 4-qator · Sotuv bosqichi⟧'), d.text.slice(0, 300));
      assert.strictEqual(d.tables, 1);
      assert.strictEqual(d.charCount, ex.contentChars(d.text));
      assert.ok(d.charCount < d.text.length, 'the markup is not counted');
      assert.strictEqual(ledger.readDocTicket(d.docTicket, d.text).chars, d.charCount);
      assert.strictEqual(ai, 0);
    } finally { server.close(); }
  });

  await test('a table value stated with another row is flagged (digest or answer); the right row is not', async () => {
    const r = await docxText(await kpiDocx());
    const wrong = rel.tableFlags('- Oylik takrorlanuvchi tushum | Jamiyat → yetkazish | shart: kamida 6 200 dollar | muddat: 2031-yil, III chorak (9-oy yakuni)', r.text, { stage: 'dayjest' });
    assert.strictEqual(wrong.length, 1);
    assert.ok(wrong[0].note.startsWith('dayjestda «Oylik takrorlanuvchi tushum» qatori bilan «2031-yil, III chorak (9-oy yakuni)» (Muddat) — hujjatda bu qiymat «Foydalanuvchilar bazasini kengaytirish» qatorida'), wrong[0].note);
    assert.deepStrictEqual(rel.tableFlags('Oylik takrorlanuvchi tushum kamida 6 200 dollar, 2031-yil, avgust (1 oy).', r.text), []);
    // the digest and final prompts carry the general table rule
    assert.ok(ex.DIGEST_SYSTEM.includes('keep every value, criterion and deadline with its own row and column - never move one to another row'));
    assert.ok(ex.explainSystem('Uzbek').includes('A value, criterion or deadline from a table row stays with that row'));
  });

  await test('a table row longer than a part: no character lost, the next part gets the row id again, and coverage says the row was split (never all_read)', async () => {
    const r = await docxText(await kpiDocx({ longRow: 2500 }));
    const plan = ex.digestChunks(r.text);
    const seen = new Uint8Array(r.text.length);
    for (const c of plan.chunks) seen.fill(1, c.start, c.end);
    assert.strictEqual(seen.reduce((t, x) => t + x, 0), r.text.length, 'every character is in a part');
    const cut = plan.chunks.find(c => c.splitAtEnd);
    assert.ok(cut && /^Jadval 1 · 4-qator/u.test(cut.splitRow), JSON.stringify(plan.chunks.map(c => [c.splitAtEnd, c.splitRow])));
    const calls = [];
    const d = await ex.buildDigest(r.text, { callAI: async (m) => { calls.push(m[1].text); return { text: '- band', provider: 'stub' }; } });
    assert.ok(calls.some(t => t.includes('⟦Jadval 1 · 4-qator · Sotuv bosqichi⟧ (qator davomi — qiymatlar shu qatorga tegishli)')), 'the next part names the row');
    assert.strictEqual(ex.coverageStatus(d), 'read_with_splits');
    assert.ok(d.text.includes('«Jadval 1 · 4-qator · Sotuv bosqichi» jadval qatori'), d.text.slice(-300));
  });

  await test('the key-line list counts a reference only when it is sent (a counted reference never exceeds the lines selected)', () => {
    const sel = ex.scopeSelection(src, { given: src, maxChars: 300 });
    assert.ok(sel.referenced <= sel.selected, JSON.stringify({ r: sel.referenced, s: sel.selected }));
  });

  await test('the trace script prints the digest -> answer signals and the table flags, as mechanical signals', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ source: src, response: { reply: fx.answerWrong, trace: { digest: fx.digest, scopeLines: [], answer: fx.answerWrong } } }));
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/explain-trace.js'), '--bundle', path.join(dir, 'b.json')], { encoding: 'utf8' });
    assert.ok(out.includes('DIGEST -> ANSWER - MECHANICAL'), out.slice(-1500));
    assert.ok(out.includes("«Tugatish imtiyozi summasi (ta'rif)»: qamrov so'zi — e'lon qilingan"), out.slice(-1500));
    assert.ok(out.includes('Two periods for one matter'), out.slice(-800));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
