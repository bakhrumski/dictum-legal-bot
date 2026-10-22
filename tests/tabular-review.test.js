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
  await test('input: at most 20 documents and 10 questions; empty ones dropped; missing input asks what is needed', () => {
    const many = tr.readInput({ documents: Array.from({ length: 25 }, (_, i) => ({ name: `d${i}`, text: DOC_B })), columns: Array.from({ length: 12 }, (_, i) => ({ label: `Savol ${i}` })) });
    assert.strictEqual(many.docs.length, 20);
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

  function route({ allowed = true, failFor = null } = {}) {
    let handler; const calls = [];
    const app = { post: (p, ...fns) => { handler = fns[fns.length - 1]; } };
    const ai = stubAI({ failFor });
    mountTabularRoute(app, { requireAuth: () => {}, requireSameOrigin: () => {}, callAI: ai.callAI, ledger: {
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
