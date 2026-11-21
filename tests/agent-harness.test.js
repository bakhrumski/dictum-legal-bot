'use strict';

/**
 * Agentic harness and the claim-draft workflow (2026-10-21): limits, trace,
 * halting for missing facts, failure handling, quotes kept only when found
 * word for word, the mechanical checks of the draft, and the route's
 * charge-only-on-delivery. Stub AI and retrieval - no network.
 *
 *   node tests/agent-harness.test.js
 */

const assert = require('assert');
const { runWorkflow, parseJson } = require('../src/agents/harness');
const wf = require('../src/agents/workflows/claim-draft');
const { mountAgentRoutes } = require('../src/agents/agent-routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const FACTS = {
  plaintiff: { name: 'Aliyev Vali', details: 'Toshkent sh., +998901234567' },
  defendant: { name: '"Qurilish Servis" MChJ', details: 'Toshkent sh., Chilonzor' },
  circumstances: "2026-yil 10-martda pudrat shartnomasi tuzildi, avans 12 000 000 so'm to'landi, ish muddatida bajarilmadi va pul qaytarilmadi.",
  demands: "12 000 000 so'm avansni va kechiktirilgan har bir kun uchun penyani undirish",
  amount: "12 000 000 so'm",
};
const SOURCE_TEXT = "Agar pudratchi ishni shartnomada belgilangan muddatda boshlamasa yoki bajarmasa, buyurtmachi shartnomani bajarishdan voz kechishga va zararni to'lashni talab qilishga haqli.";

function deps({ basisQuote = SOURCE_TEXT.slice(0, 120), draftHtml = null, failDraft = false } = {}) {
  const calls = { cheap: 0, main: 0, retrieve: 0, draft: 0 };
  return {
    calls,
    callCheapAI: async () => { calls.cheap++; return { text: '{"caseType":"iqtisodiy","queries":["pudrat shartnomasi bajarilmaganda avansni qaytarish"]}' }; },
    callAI: async () => { calls.main++; return { text: JSON.stringify({ basis: [
      { demand: 'avansni undirish', sourceId: 'S1', quote: basisQuote },
      { demand: 'penya', sourceId: 'S9', quote: 'yo\'q manba' },
    ] }) }; },
    retrieve: async () => { calls.retrieve++; return { chunks: [{ law_name: 'Fuqarolik kodeksi', article_number_display: '637', chunk_text: SOURCE_TEXT, source_url: 'https://lex.uz/docs/111181' }] }; },
    generateDraftHtml: async () => {
      calls.draft++;
      if (failDraft) throw new Error('provider down');
      return { html: draftHtml || "<p>Toshkent shahar iqtisodiy sudiga</p><p>Da'vogar: Aliyev Vali</p><p>Javobgar: \"Qurilish Servis\" MChJ</p><p>FK 637-moddasi va 999-moddasiga asosan 12 000 000 so'm hamda 5 500 000 so'm undirishni so'rayman.</p><p>Ilovalar: shartnoma nusxasi.</p>", provider: 'stub' };
    },
  };
}

(async () => {
  await test('harness: steps run in order with a trace; a halt stops the run; limits are enforced', async () => {
    const steps = [
      { id: 'a', label: 'A', run: () => 1, note: (o) => `a=${o}` },
      { id: 'b', label: 'B', when: () => false, run: () => { throw new Error('never'); } },
      { id: 'c', label: 'C', run: (s) => ({ halt: 'needs_input', got: s.steps.a }) },
      { id: 'd', label: 'D', run: () => { throw new Error('never'); } },
    ];
    const r = await runWorkflow({ id: 't', steps }, {});
    assert.strictEqual(r.status, 'needs_input');
    assert.deepStrictEqual(r.trace.map(t => `${t.id}:${t.status}`), ['a:ok', 'b:skipped', 'c:ok']);
    assert.strictEqual(r.trace[0].note, 'a=1');
    const many = await runWorkflow({ id: 'm', steps: [1, 2, 3].map(i => ({ id: `s${i}`, run: () => i })) }, {}, { budget: { maxSteps: 2 } });
    assert.deepStrictEqual([many.status, many.reason, many.stoppedAt], ['budget', 'max_steps', 's3']);
    let t = 0;
    const slow = await runWorkflow({ id: 'x', steps: [{ id: 'one', run: () => { t += 5000; } }, { id: 'two', run: () => 2 }] }, {}, { budget: { maxMs: 1000 }, clock: () => t });
    assert.deepStrictEqual([slow.status, slow.reason], ['budget', 'max_time']);
  });

  await test('harness: a failed required step stops with the error (no keys); an optional one is skipped', async () => {
    const r = await runWorkflow({ id: 'f', steps: [
      { id: 'opt', optional: true, run: () => { throw new Error('soft'); } },
      { id: 'req', run: () => { throw new Error('bad key sk-abcdefghijklmnop'); } },
      { id: 'after', run: () => 1 },
    ] }, {});
    assert.strictEqual(r.status, 'failed');
    assert.strictEqual(r.stoppedAt, 'req');
    assert.deepStrictEqual(r.trace.map(x => x.status), ['skipped_error', 'failed']);
    assert.doesNotMatch(r.trace[1].error, /abcdefghijklmnop/u);
    assert.deepStrictEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepStrictEqual(parseJson('matn {"b":[2]} oxiri'), { b: [2] });
    assert.strictEqual(parseJson('yo\'q'), null);
  });

  await test('claim draft: missing facts halt before any AI call, with the questions to ask', async () => {
    const d = deps();
    const r = await runWorkflow(wf.createClaimDraftWorkflow(), { plaintiff: { name: 'A' }, circumstances: 'qisqa' }, { deps: d });
    assert.strictEqual(r.status, 'needs_input');
    assert.deepStrictEqual(r.state.steps.intake.missing.map(m => m.field), ['defendant.name', 'circumstances', 'demands']);
    assert.deepStrictEqual(d.calls, { cheap: 0, main: 0, retrieve: 0, draft: 0 });
  });

  await test('claim draft: a quote not found word for word, or from an unknown source, is dropped; the draft cites only the checked basis', async () => {
    const d = deps();
    const r = await runWorkflow(wf.createClaimDraftWorkflow(), FACTS, { deps: d });
    assert.strictEqual(r.status, 'done');
    const basis = r.state.steps.basis;
    assert.strictEqual(basis.basis.length, 1);
    assert.strictEqual(basis.dropped, 1);
    assert.strictEqual(basis.basis[0].article, '637');
    const changed = await runWorkflow(wf.createClaimDraftWorkflow(), FACTS, { deps: deps({ basisQuote: 'buyurtmachi har doim pulni qaytarib olishga haqli va bu modda shuni aytadi' }) });
    assert.strictEqual(changed.state.steps.basis.basis.length, 0, 'a paraphrase is not a quote');
  });

  await test('claim draft: the check flags an article outside the basis and a figure not in the facts, never rewrites', async () => {
    const r = await runWorkflow(wf.createClaimDraftWorkflow(), FACTS, { deps: deps() });
    const codes = r.state.steps.verify.warnings.map(w => w.code);
    assert.ok(codes.includes('unchecked_article'));
    assert.ok(r.state.steps.verify.warnings.some(w => /999-modda/u.test(w.text)));
    assert.ok(!r.state.steps.verify.warnings.some(w => /637-modda/u.test(w.text)), 'the checked article is fine');
    assert.ok(r.state.steps.verify.warnings.some(w => w.code === 'unknown_figure' && /5500000/u.test(w.text)));
    assert.ok(!r.state.steps.verify.warnings.some(w => w.code === 'unknown_figure' && /12000000/u.test(w.text)));
    assert.ok(codes.includes('manual'));
    assert.match(r.state.steps.draft.html, /999-moddasiga/u, 'the draft text is left as written');
    assert.deepStrictEqual([...wf.citedArticles('FK 12-moddasi, статья 45')].sort(), ['12', '45']);
  });

  // ── the route: charge only when a draft came out ─────────────────────────
  function routeHarness(depOpts = {}, { allowed = true } = {}) {
    const ledgerCalls = [];
    let handler;
    const app = { post: (path, ...fns) => { handler = fns[fns.length - 1]; } };
    const d = deps(depOpts);
    mountAgentRoutes(app, { requireAuth: () => {}, requireSameOrigin: () => {}, ...d,
      ledger: {
        reserve: async (o) => { ledgerCalls.push(['reserve', o.service, o.units]); return allowed ? { allowed: true, jobKey: 'j1' } : { allowed: false, plan: 'sinov' }; },
        commit: async (k) => ledgerCalls.push(['commit', k]),
        release: async (k, why) => ledgerCalls.push(['release', k, why]),
      } });
    const call = async (body) => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await handler({ body, session: { adminId: 5 } }, res);
      return res;
    };
    return { call, ledgerCalls, d };
  }

  await test('route: missing facts -> 422, nothing reserved; no unit -> 402; a draft -> committed; a failure -> released (502)', async () => {
    let h = routeHarness();
    let res = await h.call({ plaintiff: { name: 'A' } });
    assert.strictEqual(res.code, 422);
    assert.deepStrictEqual(h.ledgerCalls, []);

    h = routeHarness({}, { allowed: false });
    res = await h.call(FACTS);
    assert.strictEqual(res.code, 402);
    assert.strictEqual(h.d.calls.cheap, 0, 'no AI without a unit');

    h = routeHarness();
    res = await h.call(FACTS);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(h.ledgerCalls, [['reserve', 'draft', 1], ['commit', 'j1']]);
    assert.ok(res.body.draftHtml && res.body.basis.length === 1 && res.body.trace.length === 6);
    assert.ok(res.body.sources[0].url.includes('lex.uz'));
    assert.ok(!JSON.stringify(res.body.trace).includes('system'), 'no prompts in the trace');

    h = routeHarness({ failDraft: true });
    res = await h.call(FACTS);
    assert.strictEqual(res.code, 502);
    assert.deepStrictEqual(h.ledgerCalls, [['reserve', 'draft', 1], ['release', 'j1', 'agent_failed']]);
    assert.strictEqual(res.body.stoppedAt, 'draft');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
