'use strict';

/**
 * Tabular review (2026-10-22): input limits, quotes checked word for word with
 * their page, a failed document as a failed row while the others go on, long
 * documents read by matching clauses (never cut silently), and the route's
 * per-row charging. Stub AI - no network.
 *
 *   node tests/tabular-review.test.js
 */

const assert = require('assert');
const { runWorkflow } = require('../src/agents/harness');
const tr = require('../src/agents/workflows/tabular-review');
const { mountTabularRoute } = require('../src/agents/agent-routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const DOC_A = "[Sahifa 1]\nYETKAZIB BERISH SHARTNOMASI\n1.1. Sotuvchi «Alfa» MChJ, Xaridor «Beta» AJ.\n[Sahifa 2]\n3.1. Shartnoma summasi 120 000 000 so‘m.\n7.2. Nizolar Toshkent shahar iqtisodiy sudida hal qilinadi.";
const DOC_B = "IJARA SHARTNOMASI\n1. Ijaraga beruvchi Karimov A., ijarachi Saidov B.\n2. Oylik ijara haqi 3 000 000 so'm.\n5. Nizolar muzokara yo'li bilan hal qilinadi.";
const COLS = [{ label: 'Shartnoma summasi', type: 'amount' }, { label: 'Nizolar qayerda hal qilinadi?', type: 'text' }, { label: 'Maxfiylik bandi bormi?', type: 'yesno' }];

function stubAI({ failFor = null } = {}) {
  const calls = [];
  return { calls, callAI: async (messages) => {
    const user = messages[1].text;
    calls.push(user);
    if (failFor && user.includes(failFor)) throw new Error('provider down');
    if (user.includes('YETKAZIB')) return { text: JSON.stringify({ answers: [
      { id: 'c1', answer: "120 000 000 so'm", quote: "Shartnoma summasi 120 000 000 so'm." },
      { id: 'c2', answer: 'Toshkent shahar iqtisodiy sudi', quote: 'Nizolar Toshkent shahar iqtisodiy sudida hal qilinadi.' },
      { id: 'c3', answer: 'Topilmadi', quote: '' },
    ] }) };
    return { text: '```json\n' + JSON.stringify({ answers: [
      { id: 'c1', answer: "3 000 000 so'm oyiga", quote: "Oylik ijara haqi 3 000 000 so'm." },
      { id: 'c2', answer: 'Muzokara', quote: 'Nizolar sudda hal qilinadi.' },
      { id: 'c3', answer: "Yo'q", quote: '' },
    ] }) + '\n```' };
  } };
}

(async () => {
  await test('input: at most 100 documents and 10 questions; empty ones dropped; missing input asks what is needed; a choice needs 2 options', () => {
    const many = tr.readInput({ documents: Array.from({ length: 105 }, (_, i) => ({ name: `d${i}`, text: DOC_B })), columns: Array.from({ length: 12 }, (_, i) => ({ label: `Savol ${i}` })) });
    assert.strictEqual(tr.LIMITS.docs, 100);
    assert.strictEqual(many.docs.length, 100);
    const ch = tr.readInput({ documents: [{ text: DOC_B }], columns: [{ label: 'Shartnoma turi', type: 'choice', options: ['Ijara', 'Oldi-sotdi', 'Ijara', ' '] }, { label: 'Yagona variant', type: 'choice', options: ['Faqat'] }] });
    assert.deepStrictEqual(ch.columns.map(c => [c.type, c.options]), [['choice', ['Ijara', 'Oldi-sotdi']], ['text', undefined]]);
    assert.strictEqual(many.columns.length, 10);
    assert.strictEqual(many.columns[0].type, 'text');
    const none = tr.readInput({ documents: [{ name: 'bo\'sh', text: '  ' }], columns: [{ label: 'x' }] });
    assert.deepStrictEqual(none.missing.map(m => m.field), ['documents', 'columns']);
  });

  await test('quote check: found word for word (apostrophe forms, quotes and spaces aside) with its page; a paraphrase is not found', () => {
    const at = tr.findQuote(DOC_A, "Shartnoma summasi 120 000 000 so'm.");
    assert.ok(at > 0);
    assert.strictEqual(tr.pageAt(DOC_A, at), 2);
    assert.strictEqual(tr.pageAt(DOC_A, tr.findQuote(DOC_A, 'Sotuvchi Alfa MChJ, Xaridor Beta AJ')), 1);
    assert.strictEqual(tr.findQuote(DOC_A, 'Shartnoma bahosi 120 mln so‘m'), -1);
    assert.strictEqual(tr.findQuote(DOC_A, 'qisqa'), -1, 'too short to prove anything');
  });

  await test('workflow: every cell carries answer, quote, verified and page; "Topilmadi" is not counted as unverified', async () => {
    const ai = stubAI();
    const r = await runWorkflow(tr.createTabularReviewWorkflow(), { documents: [{ name: 'A.pdf', text: DOC_A }, { name: 'B.docx', text: DOC_B }], columns: COLS }, { deps: ai });
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(ai.calls.length, 2, 'one call per document');
    const [a, b] = r.state.steps.verify.rows;
    assert.deepStrictEqual([a.cells.c1.verified, a.cells.c1.page], [true, 2]);
    assert.strictEqual(a.cells.c3.notFound, true);
    assert.strictEqual(b.cells.c1.verified, true);
    assert.strictEqual(b.cells.c2.verified, false, 'the quote is not in document B');
    assert.strictEqual(b.cells.c2.answer, 'Muzokara', 'the answer stays, marked unverified');
    assert.deepStrictEqual([r.state.steps.verify.verified, r.state.steps.verify.unverified], [3, 2]);
  });

  await test('workflow: a failed document is a failed row and the others go on; all failed stops the run', async () => {
    const r = await runWorkflow(tr.createTabularReviewWorkflow(), { documents: [{ name: 'A', text: DOC_A }, { name: 'B', text: DOC_B }], columns: COLS }, { deps: stubAI({ failFor: 'IJARA' }) });
    assert.strictEqual(r.status, 'done');
    assert.deepStrictEqual(r.state.steps.verify.rows.map(x => x.status), ['ok', 'failed']);
    const all = await runWorkflow(tr.createTabularReviewWorkflow(), { documents: [{ name: 'B', text: DOC_B }], columns: COLS }, { deps: stubAI({ failFor: 'IJARA' }) });
    assert.deepStrictEqual([all.status, all.stoppedAt], ['failed', 'extract']);
  });

  await test('workflow: a long document is read by the clauses matching the questions, and the row says so', async () => {
    const filler = Array.from({ length: 400 }, (_, i) => `${i + 10}. Boshqa band matni ${'lorem ipsum '.repeat(6)}`).join('\n');
    const long = `SHARTNOMA\n${filler}\n500. Shartnoma summasi 9 000 000 so'm.`;
    const ai = stubAI();
    const r = await runWorkflow(tr.createTabularReviewWorkflow(), { documents: [{ name: 'uzun', text: long }], columns: COLS }, { deps: ai });
    const part = r.state.steps.excerpt.parts[0];
    assert.strictEqual(part.excerpt, true);
    assert.ok(part.text.length <= tr.LIMITS.excerptChars + 200);
    assert.match(part.text, /Shartnoma summasi 9 000 000/u);
    assert.strictEqual(r.state.steps.verify.rows[0].excerpt, true);
  });

  await test('large table: prepared input keeps excerpts once (not in checkpoints); one extract step per 10 documents; a choice outside its options is "Topilmadi"', async () => {
    const docs = Array.from({ length: 23 }, (_, i) => ({ name: `B${i}.docx`, text: DOC_B }));
    const cols = [...COLS.slice(0, 2), { label: 'Nizolar qanday hal qilinadi?', type: 'choice', options: ['Sud', 'Hakamlik'] }];
    const prep = tr.prepareInput({ documents: docs, columns: cols });
    assert.strictEqual(prep.docCount, 23);
    const wf = tr.createTabularReviewWorkflow({ docCount: prep.docCount });
    assert.deepStrictEqual(wf.steps.map(s => s.id), ['validate', 'excerpt', 'extract_1', 'extract_2', 'extract_3', 'verify']);
    const ai = { calls: 0, callAI: async () => { ai.calls++; return { text: JSON.stringify({ answers: [
      { id: 'c1', answer: "3 000 000 so'm", quote: "Oylik ijara haqi 3 000 000 so'm." }, { id: 'c2', answer: 'Muzokara', quote: "Nizolar muzokara yo'li bilan hal qilinadi." }, { id: 'c3', answer: 'Muzokara', quote: '' }] }) }; } };
    const r = await runWorkflow(wf, { prepared: prep.prepared }, { deps: ai });
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(ai.calls, 23);
    assert.strictEqual(r.state.steps.verify.rows.length, 23);
    assert.ok(r.state.steps.verify.rows.every(x => x.cells.c1.verified && x.cells.c2.verified));
    assert.strictEqual(r.state.steps.verify.rows[0].cells.c3.answer, 'Topilmadi');
    assert.ok(!JSON.stringify(r.state.steps.validate).includes('IJARA') && !JSON.stringify(r.state.steps.excerpt).includes('IJARA'), 'no document text in those checkpoints');
  });

  function route({ allowed = true, failFor = null, budget = {} } = {}) {
    let handler; const calls = [];
    const app = { post: (p, ...fns) => { if (p === '/api/agent/tabular-review') handler = fns[fns.length - 1]; } };
    const ai = stubAI({ failFor });
    mountTabularRoute(app, { requireAuth: () => {}, requireSameOrigin: () => {}, callAI: ai.callAI, budget, ledger: {
      reserveMany: async (o) => { calls.push(['reserveMany', o.jobs.map(j => `${j.service}:${j.units}`)]); return allowed ? { allowed: true, kind: 'paid', jobs: o.jobs.map((j, i) => ({ jobKey: `k${i}` })) } : { allowed: false, remaining: 1 }; },
      commit: async (k) => calls.push(['commit', k]), release: async (k, why) => calls.push(['release', k, why]) } });
    const call = async (body) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ body, session: { adminId: 5 } }, res); return res; };
    return { call, calls, ai };
  }
  const BODY = { documents: [{ name: 'A', text: DOC_A }, { name: 'B', text: DOC_B }], columns: COLS };

  await test('route: one question unit per document, reserved together; committed per row read, released per row failed', async () => {
    let h = route();
    let res = await h.call(BODY);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(h.calls, [['reserveMany', ['chat:1', 'chat:1']], ['commit', 'k0'], ['commit', 'k1']]);
    assert.strictEqual(res.body.charged, 2);
    assert.strictEqual(res.body.rows.length, 2);
    h = route({ failFor: 'IJARA' });
    res = await h.call(BODY);
    assert.deepStrictEqual(h.calls.slice(1), [['commit', 'k0'], ['release', 'k1', 'tabular_row_failed']]);
    assert.strictEqual(res.body.charged, 1);
  });

  await test('route: a table stopped by its limits shows and charges the rows it read, releases the rest', async () => {
    const h = route({ budget: { maxSteps: 3 } });
    const res = await h.call({ documents: Array.from({ length: 23 }, (_, i) => ({ name: `B${i}`, text: DOC_B })), columns: COLS });
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual([res.body.status, res.body.partial, res.body.rows.length, res.body.charged], ['budget', true, 10, 10]);
    assert.match(res.body.message, /23 hujjatdan 10 tasi/u);
    assert.strictEqual(h.calls.filter(c => c[0] === 'release').length, 13);
    assert.strictEqual(h.ai.calls.length, 10);
  });

  await test('route: missing input 422 and no units 402 - both before any AI call', async () => {
    let h = route();
    let res = await h.call({ documents: [], columns: COLS });
    assert.strictEqual(res.code, 422);
    assert.deepStrictEqual(h.calls, []);
    h = route({ allowed: false });
    res = await h.call(BODY);
    assert.strictEqual(res.code, 402);
    assert.strictEqual(res.body.needed, 2);
    assert.strictEqual(h.ai.calls.length, 0);
  });

  await test('scans: a scanId brings the OCR text of this account only; OCR page marks give the page', async () => {
    const SCAN = '11111111-2222-3333-4444-555555555555';
    const ocrText = "=== PAGE 1 ===\nIJARA SHARTNOMASI\n=== PAGE 2 ===\n2. Oylik ijara haqi 3 000 000 so'm.\n5. Nizolar sudda hal qilinadi.\n" + 'Qo‘shimcha. '.repeat(10);
    assert.strictEqual(tr.pageAt(ocrText, tr.findQuote(ocrText, "Oylik ijara haqi 3 000 000 so'm.")), 2);
    let handler; const app = { post: (p, ...fns) => { if (p === '/api/agent/tabular-review') handler = fns[fns.length - 1]; } };
    const pool = { async query(sql, p) { return { rows: /document_scans/u.test(sql) && p[0] === SCAN && p[1] === 5 ? [{ id: SCAN, text: ocrText, pages: 2, file_hash: 'h' }] : [] }; } };
    const ai = stubAI();
    mountTabularRoute(app, { requireAuth: () => {}, requireSameOrigin: () => {}, callAI: ai.callAI, pool, ledger: {
      reserveMany: async (o) => ({ allowed: true, kind: 'paid', jobs: o.jobs.map((j, i) => ({ jobKey: `k${i}` })) }), commit: async () => {}, release: async () => {} } });
    const call = async (body, adminId = 5) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ body, session: { adminId } }, res); return res; };
    let res = await call({ documents: [{ name: 'skan.pdf', scanId: SCAN }], columns: COLS });
    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.rows[0].cells.c1.page, 2);
    res = await call({ documents: [{ name: 'skan.pdf', scanId: SCAN }], columns: COLS }, 6);
    assert.strictEqual(res.code, 404, "another account's scan is not found");
  });

  await test('Excel: a Jadval, Iqtiboslar and Izoh sheet; tags in their column; a cell starting with "=" stays text', () => {
    const XLSX = require('xlsx');
    const ex = require('../src/agents/workflows/tabular-export');
    const rows = [
      { docId: 'd1', name: 'A.pdf', status: 'ok', excerpt: true, cells: { c1: { answer: '=HYPERLINK("x")', quote: "Shartnoma summasi 120 000 000 so'm.", verified: true, page: 2 }, c2: { answer: 'Topilmadi', quote: '', notFound: true } } },
      { docId: 'd2', name: 'B.docx', status: 'failed', error: 'provider down' },
    ];
    const buf = ex.buildWorkbook({ columns: [{ id: 'c1', label: 'Summa' }, { id: 'c2', label: 'Sud' }], rows, tags: { d1: ['muhim', 'muhim', ' '], bad: ['x'] } });
    const wb = XLSX.read(buf, { type: 'buffer' });
    assert.deepStrictEqual(wb.SheetNames, ['Jadval', 'Iqtiboslar', 'Izoh']);
    const t = XLSX.utils.sheet_to_json(wb.Sheets.Jadval, { header: 1 });
    assert.deepStrictEqual(t[0], ['№', 'Hujjat', 'Teglar', 'Holat', 'Summa', 'Sud']);
    assert.deepStrictEqual(t[1].slice(1, 5), ['A.pdf', 'muhim', "o'qildi (mos qismlar)", '=HYPERLINK("x")']);
    assert.strictEqual(wb.Sheets.Jadval.E2.f, undefined, 'not a formula');
    assert.match(t[2][3], /xato/u);
    const q = XLSX.utils.sheet_to_json(wb.Sheets.Iqtiboslar, { header: 1 });
    assert.strictEqual(q.length, 2, 'the "Topilmadi" cell has no quote row');
    assert.deepStrictEqual(q[1].slice(4), ['2', 'iqtibos hujjatda bor']);
    assert.deepStrictEqual(ex.normTags({ d1: ['a', 'a', 'b'], d2: 'x', x9: ['y'], d3: Array.from({ length: 12 }, (_, i) => `t${i}`) }), { d1: ['a', 'b'], d3: ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
