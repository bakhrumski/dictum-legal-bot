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
    const note = finish(fx.answerWrong).notes.find(n => n.startsWith('Muddatlar'));
    assert.ok(note.startsWith("Muddatlar — qo'lda tekshirish kerak: nomuvofiqlik nomzodi (tasdiqlangan ziddiyat emas): hujjatda shu masala bo'yicha ikki xil muddat bor"), note);
    assert.ok(note.includes("ular turli bandlar (masalan, bir tomonning majburiyati va boshqasining huquqi) bo'lishi mumkin"));
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
    assert.ok(routes.includes("const chars = contentChars(text);") && routes.includes('ledger.signDocTicket({ text, chars, tables })'));
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

  await test('prevention, not only flags: the final prompt requires keeping what the digest kept (subject, start event, may/must, conditions joined by "and", exceptions, every consequence, both periods, table rows, partial lists said to be partial)', () => {
    const p = ex.explainSystem('Uzbek');
    for (const rule of [
      'Keep, as the digest or the document gives them: who acts',
      '"all participants, including X" is not "the other participants"',
      'the event a period runs from (sent is not received)',
      '"may" versus "must"',
      'every condition joined by "and", every exception and every consequence of one breach',
      'If you list only some items of a list or a table, say that the list is partial and where the whole is',
      'state both with whose they are; never choose one silently or blend them into one',
      'A value, criterion or deadline from a table row stays with that row',
    ]) assert.ok(p.includes(rule), rule);
    const d = ex.DIGEST_SYSTEM;
    for (const rule of ['keep who does each act and the exact event a period runs from (sent or received, signed or registered)', 'whether something "may" or "must" be done', 'never move one to another row, never merge rows']) assert.ok(d.includes(rule), rule);
    // general words only: nothing of the production document or of this fixture
    for (const w of ['Sarvar', 'Nurli', 'KPI', 'MRR', 'transh']) assert.ok(!(p + d).includes(w), w);
  });

  await test('mammoth fallback: when the table reader misses words, the text is kept but the table structure is reported as LOST - in the extract result, the ticket, the coverage and under the answer; a row reading is never called proof of correct cells', async () => {
    const buf = await kpiDocx();
    // a reading where mammoth sees a word the table reader does not
    const realMammoth = require('mammoth');
    const stub = { extractRawText: async (o) => ({ value: `${(await realMammoth.extractRawText(o)).value}\nqo'shimchaso'z` }) };
    const lost = await docxText(buf, { mammoth: stub });
    assert.deepStrictEqual([lost.reader, lost.structure, lost.tables], ['mammoth', 'lost', 1]);
    assert.ok(lost.wordCheck.missing >= 1 && /rows and columns are not kept/u.test(lost.fallbackReason));
    assert.ok(!lost.text.includes('⟦Jadval'), 'no row markup claimed');
    // equal length is not enough: a word missing while the length matches still falls back
    const swapped = { extractRawText: async (o) => ({ value: (await realMammoth.extractRawText(o)).value.replace('Sinov', 'Sinoq') }) };
    assert.strictEqual((await docxText(buf, { mammoth: swapped })).structure, 'lost');
    // the ticket carries it; the explanation reports it
    const t = ledger.readDocTicket(ledger.signDocTicket({ text: lost.text, chars: ex.contentChars(lost.text), tables: { count: 1, structure: 'lost' } }), lost.text);
    assert.deepStrictEqual(t.tables, { count: 1, structure: 'lost' });
    const r = await ex.explainDocument({ documentText: lost.text, langName: 'Uzbek', callAI: async () => ({ text: 'Izoh.', provider: 'stub' }), digest: async () => null, tables: t.tables });
    assert.deepStrictEqual(r.coverage.tables, { count: 1, structure: 'lost', meaning: 'technical' });
    assert.ok(r.reply.includes("Jadvallar — qo'lda tekshirish kerak: hujjatda 1 ta jadval bor, lekin ularning qator va ustun tuzilishi saqlanmadi"), r.reply.slice(-600));
    assert.ok(!r.reply.includes('belgilanadigan joy topilmadi'));
    // a row reading: said, with its limit
    const ok = await ex.explainDocument({ documentText: 'Matn. '.repeat(20), langName: 'Uzbek', callAI: async () => ({ text: 'Izoh.', provider: 'stub' }), digest: async () => null, tables: { count: 1, structure: 'rows' } });
    assert.ok(ok.reply.includes("kataklar to'liq va to'g'ri o'qilgani tasdiqlanmagan"));
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

  // ── 2026-10-09 run (second live diagnostics; anonymous synthetic text) ──

  await test('DOCX: content controls around rows or cells, tracked insertions, special hyphens and symbols no longer drop the tables to loose lines', async () => {
    const r = x => `<w:p><w:r>${x}</w:r></w:p>`;
    const head = row([cell('Ish'), cell('Muddat')], { header: true });
    const cases = {
      sdt_row: table([head, `<w:sdt><w:sdtContent>${row([cell('Hisobot'), cell('5 kun')])}</w:sdtContent></w:sdt>`]),
      sdt_cell: table([head, `<w:tr><w:sdt><w:sdtContent>${cell('Hisobot')}</w:sdtContent></w:sdt>${cell('5 kun')}</w:tr>`]),
      tracked_insert: `<w:ins w:id="1" w:author="a"><w:p><w:r><w:t>Qo'shilgan band.</w:t></w:r></w:p></w:ins>${table([head, row([cell('Hisobot'), cell('5 kun')])])}`,
      no_break_hyphen: table([head, row([cell('Hisobot'), `<w:tc>${r('<w:t>2027</w:t><w:noBreakHyphen/><w:t>yil mart</w:t>')}</w:tc>`])]),
      soft_hyphen: table([head, row([`<w:tc>${r('<w:t>Hiso</w:t><w:softHyphen/><w:t>bot</w:t>')}</w:tc>`, cell('5 kun')])]),
      symbol_char: table([head, row([`<w:tc>${r('<w:t>Hisobot</w:t><w:sym w:font="Symbol" w:char="F0B7"/><w:t>tahlil</w:t>')}</w:tc>`, cell('5 kun')])]),
    };
    for (const [k, xml] of Object.entries(cases)) {
      const d = await docxText(await docx(p('Kirish.') + xml));
      assert.deepStrictEqual([k, d.structure, d.wordCheck.missing], [k, 'rows', 0], d.text);
    }
  });

  await test('DOCX fallback: the cause is read from the XML (structures around each missing word), codes go to the ticket, the words only to a master', async () => {
    // a reading mammoth has and the table reader does not (a stub, so the
    // diagnosis has something to find): the word sits in a content-control cell
    const xml = p('Kirish.') + table([row([cell('Ish'), cell('Muddat')], { header: true }), `<w:tr><w:sdt><w:sdtContent>${cell('Hisobot')}</w:sdtContent></w:sdt>${cell('5 kun')}</w:tr>`]);
    const stub = { extractRawText: async () => ({ value: 'Kirish.\nIsh\nMuddat\nHisobot\nHisobot\n5 kun' }) };
    const d = await docxText(await docx(xml), { mammoth: stub });
    assert.strictEqual(d.structure, 'lost');
    assert.deepStrictEqual(d.diagnosis.missingWords.map(m => [m.word, m.expected, m.found, m.inTable, m.structures]), [['hisobot', 2, 1, true, ['sdt_cell']]]);
    assert.deepStrictEqual(d.causes, ['sdt_cell']);
    assert.strictEqual(d.diagnosis.census.sdt_cell, 1);
    assert.ok(!d.fallbackReason.includes('hisobot'), 'the log line carries codes, never the words');
    // a word in no structure: 'unknown', never a guessed cause
    const none = await docxText(await docx(p('Kirish.') + table([row([cell('Ish'), cell('Muddat')], { header: true }), row([cell('Hisobot'), cell('5 kun')])])),
      { mammoth: { extractRawText: async () => ({ value: 'Kirish Ish Muddat Hisobot 5 kun Izoh' }) } });
    assert.deepStrictEqual(none.causes, ['unknown']);
    // the ticket carries the codes only, bound to the text
    const t = ledger.signDocTicket({ text: d.text, chars: 40, tables: { count: 1, structure: 'lost', causes: d.causes } });
    assert.deepStrictEqual(ledger.readDocTicket(t, d.text).tables, { count: 1, structure: 'lost', causes: ['sdt_cell'] });
    const body = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString());
    assert.ok(!JSON.stringify(body).includes('hisobot'));
    // the local check script names the cause, and prints no words with --codes
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dx-'));
    fs.writeFileSync(path.join(dir, 'a.docx'), await docx(xml));
    const out = execFileSync(process.execPath, [path.join(__dirname, '../scripts/docx-table-check.js'), path.join(dir, 'a.docx'), '--codes'], { encoding: 'utf8' });
    assert.ok(out.includes("tuzilish: rows"), out);
  });

  await test('parts are sized by predicted digest output: under the target when 13 parts allow it; a denser document is cut into 13 and reported "over", never as fitting', () => {
    const clause = i => `${i}.1. Ijrochi ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))} ishini ${5 + (i % 9)} kun ichida bajaradi, kechiksa ${i % 5 + 1} foiz jarima to'laydi va buyurtmachiga yozma xabar beradi.`;
    const doc = Array.from({ length: 250 }, (_, i) => clause(i + 1)).join('\n');
    const plan = ex.digestChunks(doc);
    assert.strictEqual(plan.density.fit, 'fits');
    assert.ok(plan.chunks.every(c => ex.predictDigestTokens(c.text) <= ex.DIGEST_TARGET * ex.DIGEST_MAX_TOKENS * 1.06), JSON.stringify(plan.density));
    assert.ok(plan.chunks.length > Math.ceil(doc.length / ex.CHUNK), 'smaller parts than the old 8 000-char cut');
    assert.strictEqual(plan.density.calibrated, false);
    const dense = Array.from({ length: 1200 }, (_, i) => clause(i + 1)).join('\n').slice(0, 120000);
    const over = ex.digestChunks(dense);
    assert.ok(over.covered && over.chunks.length === ex.MAX_CHUNKS);
    assert.strictEqual(over.density.fit, 'over');
    assert.ok(over.density.overCap > 0);
    // the limits never grow to make it fit
    assert.deepStrictEqual([ex.DIGEST_MAX_TOKENS, ex.MAX_CHUNKS, ex.DIGEST_LIMITS.maxExtraCalls, ex.DIGEST_LIMITS.timeMs], [1600, 13, 4, 75000]);
  });

  await test('a sparse document keeps the old plan\'s economy: where 8 000-char parts are predicted under the target, the density plan cuts no more parts than the old one (repeated clauses counted once, as predicted)', () => {
    for (const id of ['long-lease', 'long-service-docx', 'investment-agreement', 'relations-memorandum']) {
      const text = loadAll().find(f => f.id === id).pages.join('\n\n');
      const old = ex.digestChunks(text, { chunk: ex.chunkSizeFor(text.length) });
      const now = ex.digestChunks(text);
      assert.ok(old.chunks.every(c => ex.predictDigestTokens(c.text) <= ex.DIGEST_TARGET * ex.DIGEST_MAX_TOKENS), id);
      assert.strictEqual(now.chunks.length, old.chunks.length, `${id}: ${now.chunks.length} vs ${old.chunks.length}`);
    }
  });

  await test('re-reads go to the most important cut parts (an annex the rest refers to before earlier parts); every cut part has its decision and reasons', async () => {
    const body = i => `${i}.1. Ijrochi ishni bajaradi va natijani topshiradi, 2-ilovadagi ko'rsatkichlarga muvofiq.`;
    const annex = ["2-ilova. Ko'rsatkichlar", ...Array.from({ length: 160 }, (_, i) => `${i + 1}-ko'rsatkich ${10 + i} foiz ${i + 2} oy`)].join('\n');
    const text = [...Array.from({ length: 200 }, (_, i) => body(i + 1)), annex].join('\n');
    const n = ex.digestChunks(text).chunks.length;
    // every part comes back cut: only two can be re-read (4 extra calls)
    const calls = [];
    const d = await ex.buildDigest(text, { callAI: async (m, o) => { calls.push(o.detail.part); return { text: '- band', truncated: !/[ab]$/u.test(o.detail.part), provider: 'stub' }; } });
    assert.strictEqual(d.reread.length, n);
    const chosen = d.reread.filter(r => r.decision === 'reread').map(r => r.part);
    assert.strictEqual(chosen.length, 2);
    // the annex parts win over the earlier body parts (document order took the budget before)
    const annexParts = ex.digestChunks(text).chunks.filter(c => /\d+-ko'rsatkich \d+ foiz/u.test(c.text)).map(c => String(c.index + 1));
    // no annex part is left out for the budget while a body part is re-read
    // (an annex part too short to halve is left out for that reason, said)
    assert.ok(d.reread.filter(r => annexParts.includes(r.part)).every(r => r.decision === 'reread' || r.why === 'too_short_to_split'), JSON.stringify(d.reread));
    assert.ok(d.reread.some(r => r.decision === 'reread' && r.reasons.some(x => x.includes('2-ilova'))), JSON.stringify(d.reread));
    assert.ok(d.reread.filter(r => r.decision === 'excluded').every(r => ['extra_call_limit', 'too_short_to_split'].includes(r.why)), JSON.stringify(d.reread));
    assert.ok(d.reread.some(r => r.why === 'extra_call_limit'));
    assert.strictEqual(d.rereadPolicy, 'priority_uncalibrated');
    const summary = ex.coverageSummary(d, { finalRun: true });
    assert.ok(summary.reread.every(r => !('reasons' in r)), 'the ledger summary keeps decisions, not text');
  });

  await test('digest -> answer: a line is compared only with the answer sentence on the same clause - another clause\'s period is not "changed", a weak match is "mos band aniqlanmadi"', () => {
    const dg = [
      "- Ortiqcha mablag' | Ijrochi → ortiqcha mablag'ni buyurtmachiga qaytaradi | muddat: talab olingan kundan boshlab 10 ish kuni ichida | oqibat: barcha ishtirokchilar solidar javob beradi",
      "- Xabarnoma | har bir Taraf → javob xabarnomasini yuboradi | muddat: xabarnoma yuborilgan sanadan boshlab 30 kun ichida",
    ].join('\n');
    // the answer: one bullet on assets ("ortiq" in another sense), the next on
    // the notice period - the first line's period must not be compared with it
    const answer = "Aktivlar: Ijrochi balans qiymatining 50 foizidan ortiq mol-mulkni o'tkazsa, buyurtmachi roziligi kerak.\nXabarnoma: har bir Taraf xabarnoma yuborilgan sanadan boshlab 30 kun ichida javob xabarnomasini yuboradi.";
    const sig = rel.digestAnswerSignals(dg, answer);
    assert.ok(!sig.some(x => x.lost.some(l => l.part === 'boshqa qiymat' || l.part === 'muddat boshlanishi')), JSON.stringify(sig));
    // a real change on the same clause is still named
    const wrong = rel.digestAnswerSignals(dg, "Xabarnoma: har bir Taraf xabarnomani olgan sanadan boshlab 30 kun ichida javob xabarnomasini yuboradi.");
    assert.ok(wrong.some(x => x.match === 'same_clause' && x.lost.some(l => l.part === 'muddat boshlanishi')), JSON.stringify(wrong));
    // a weak match (party words and one shared word) is not compared: no claimed change
    const weak = rel.digestAnswerSignals(dg, "Ijrochi buyurtmachiga mablag' bo'yicha hisobot beradi, Taraflar 5 kun ichida kelishadi.");
    assert.ok(weak.every(x => x.match === 'uncertain' ? x.lost.length === 0 && x.note === 'mos band aniqlanmadi' : true), JSON.stringify(weak));
    const done = ex.finishExplanation({ reply: "Ijrochi buyurtmachiga mablag' bo'yicha hisobot beradi, Taraflar 5 kun ichida kelishadi.", source: dg, digest: { text: dg, chunks: 1, failed: [], truncated: [], covered: true, splits: [] } });
    assert.ok(done.check.digestSignals.every(x => x.match === 'same_clause'));
    if (done.check.digestUnmatched.length) assert.ok(done.reply.includes("mos band aniqlanmadi (taqqoslanmadi, o'zgarish deb hisoblanmaydi)"), done.reply);
  });

  await test('an act joined by "va" to an event a period runs from is a precondition, not a status ("signed and registered, then paid within 3 days")', () => {
    const source = "4.1. Birinchi to'lov Taraflar Shartnomani imzolagandan so'ng hamda ishtirokchi davlat ro'yxatidan o'tkazilgan paytdan boshlab 3 bank kuni ichida to'lanadi.";
    const flags = rel.relationFlags("Birinchi to'lov Shartnoma imzolangan va ishtirokchi ro'yxatdan o'tkazilganidan keyin 3 bank kuni ichida to'lanadi.", rel.analyseText(source));
    assert.deepStrictEqual(flags.filter(f => f.kind === 'holat'), []);
    // a plain status claim is still compared
    assert.ok(rel.relationFlags("4.1. Birinchi to'lov to'langan.", rel.analyseText("4.1. Birinchi to'lov to'lanmagan.")).some(f => f.kind === 'holat'));
  });

  await test('a period is compared with the clause on the same matter only: the same figure in another clause is named as another act\'s period, a clause with no match is not compared', () => {
    const source = "2.1. Ijrochi taklifga taklif olingan kundan boshlab 10 ish kuni ichida javob beradi.\n2.2. Asosiy bitim taklif qabul qilingan kundan boshlab 60 kalendar kun ichida tuziladi.\n2.3. Ijrochi hisobotni 10 ish kuni ichida topshiradi.";
    const s2 = rel.analyseText(source);
    // the clause on concluding states 60 days: 10 days on concluding is named
    const f = rel.relationFlags('Asosiy bitim 10 ish kuni ichida tuzilishi kerak.', s2);
    assert.ok(f.some(x => x.kind === "bog'lanish" && x.note.includes('«60 kalendar kun»')), JSON.stringify(f));
    // the report clause states 10 days on its own act: no flag from the reply clause
    assert.deepStrictEqual(rel.relationFlags('Ijrochi hisobotni 10 ish kuni ichida topshiradi.', s2).filter(x => x.kind === "bog'lanish"), []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
