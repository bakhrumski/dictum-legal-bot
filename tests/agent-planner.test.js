'use strict';

/**
 * The planner agent (2026-10-28, roadmap PR-D): the server's mechanical
 * check of a plan (unknown tool, a step after a later one, no verify last,
 * two answers, too many steps or searches, a document not in the matter,
 * the matter context without a matter), the one retry and the fixed plan,
 * the price, and a planned run end to end through the harness (stub AI and
 * retrieval - no network): the answer is verified, the unit committed only
 * then, released otherwise.
 *
 *   node tests/agent-planner.test.js
 */

const assert = require('assert');
const { createToolRegistry } = require('../src/agents/tools');
const { validatePlan, fallbackPlan, makePlan, MAX_NODES } = require('../src/agents/planner');
const { plannedExecutor } = require('../src/agents/planner-routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const reg = createToolRegistry();
const SCAN = '11111111-2222-3333-4444-555555555555';
const good = { goal: 'avans', nodes: [
  { id: 'n1', tool: 'lex_search', args: { query: 'pudrat shartnomasi avans qaytarish' }, after: [] },
  { id: 'n2', tool: 'answer', args: { question: 'Pudratchi avansni qaytarishi shartmi?' }, after: ['n1'] },
  { id: 'n3', tool: 'verify', args: {}, after: ['n2'] },
] };
const errs = (plan, ctx) => validatePlan(plan, reg, ctx || {}).errors.join(' | ');

(async () => {
  console.log('agent planner');

  await test('a good plan passes, its price is one chat unit', () => {
    const v = validatePlan(good, reg, {});
    assert.ok(v.ok, v.errors.join('; '));
    assert.deepStrictEqual(v.price, { chat: 1 });
    assert.deepStrictEqual(v.plan.nodes.map(n => n.tool), ['lex_search', 'answer', 'verify']);
  });

  await test('the mechanical check refuses: unknown tool, a later step in after, no verify last, two answers, too many searches or steps', () => {
    assert.match(errs({ nodes: [...good.nodes.slice(0, 2), { id: 'n3', tool: 'send_email', args: {}, after: [] }] }), /noma'lum vosita send_email/u);
    assert.match(errs({ nodes: [{ id: 'n1', tool: 'lex_search', args: { query: 'avans' }, after: ['n2'] }, ...good.nodes.slice(1)] }), /after n2 oldingi qadam emas/u);
    assert.match(errs({ nodes: good.nodes.slice(0, 2) }), /oxirgi qadam answer'dan keyingi verify/u);
    assert.match(errs({ nodes: [good.nodes[0], good.nodes[1], { ...good.nodes[1], id: 'n4' }, { ...good.nodes[2], after: ['n4'] }] }), /aynan bitta answer/u);
    const searches = Array.from({ length: 5 }, (_, i) => ({ id: `n${i + 1}`, tool: 'lex_search', args: { query: `so'rov ${i} matni` }, after: [] }));
    assert.match(errs({ nodes: [...searches, { id: 'n6', tool: 'answer', args: { question: 'savol matni bor' }, after: [] }, { id: 'n7', tool: 'verify', args: {}, after: ['n6'] }] }), /lex_search 4 tadan ko'p/u);
    const many = Array.from({ length: MAX_NODES + 2 }, (_, i) => ({ id: `n${i + 1}`, tool: 'matter_context', args: {}, after: [] }));
    assert.match(errs({ nodes: many }, { matterId: 'x' }), /qadamlar 12 tadan ko'p/u);
    assert.match(errs({ nodes: [{ id: 'n1', tool: 'n1', after: [] }] }), /noma'lum vosita/u);
    assert.match(errs({ nodes: [{ id: 'x1', tool: 'verify', args: {} }] }), /id noto'g'ri/u);
  });

  await test('documents only from this matter; the matter context only with a matter', () => {
    const withDoc = { nodes: [{ id: 'n1', tool: 'doc_excerpt', args: { scanId: SCAN, question: 'muddat bandi qaysi?' }, after: [] }, ...good.nodes.slice(1).map((n, i) => ({ ...n, id: `n${i + 2}`, after: [`n${i + 1}`] }))] };
    assert.match(errs(withDoc, { matterId: 'm', matterScans: [] }), /hujjat shu ishga bog'lanmagan/u);
    assert.ok(validatePlan(withDoc, reg, { matterId: 'm', matterScans: [SCAN] }).ok);
    const ctxPlan = { nodes: [{ id: 'n1', tool: 'matter_context', args: {}, after: [] }, ...good.nodes.map((n, i) => ({ ...n, id: `n${i + 2}`, after: i ? [`n${i + 1}`] : [] }))] };
    assert.match(errs(ctxPlan, {}), /faqat ish ichida/u);
  });

  await test('the fixed plan: matter context first when there is one, then search, answer, verify; it passes the check', () => {
    const p = fallbackPlan('Pudratchi avansni qaytarmayapti, nima qilay?', { matterId: 'm' });
    assert.deepStrictEqual(p.nodes.map(n => n.tool), ['matter_context', 'lex_search', 'answer', 'verify']);
    assert.ok(validatePlan(p, reg, { matterId: 'm' }).ok);
  });

  await test('makePlan: a bad plan is asked again once with its errors; two bad plans take the fixed plan', async () => {
    const asks = [];
    const one = await makePlan('Avans qaytarilmayapti', reg, { callCheapAI: async (m) => { asks.push(m); return { text: JSON.stringify(asks.length === 1 ? { nodes: good.nodes.slice(0, 2) } : good) }; } }, {});
    assert.deepStrictEqual([one.source, asks.length], ['model_retry', 2]);
    assert.match(asks[1][asks[1].length - 1].text, /oxirgi qadam/u, 'the retry names the error');
    const two = await makePlan('Avans qaytarilmayapti', reg, { callCheapAI: async () => ({ text: 'kechirasiz' }) }, {});
    assert.strictEqual(two.source, 'fallback');
    assert.ok(validatePlan(two.plan, reg, {}).ok);
    const fine = await makePlan('Avans qaytarilmayapti', reg, { callCheapAI: async () => ({ text: '```json\n' + JSON.stringify(good) + '\n```' }) }, {});
    assert.strictEqual(fine.source, 'model');
  });

  const CHUNK = { id: 'c1', law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi", article_number_display: '642', source_url: 'https://lex.uz/docs/-180552#-642',
    chunk_text: "Pudratchi ishni shartnomada belgilangan muddatda boshlamasa, buyurtmachi shartnomani bajarishdan voz kechishga va zararni to'lashni talab qilishga haqli." };
  function deps(answerText) {
    const calls = { ai: 0, cheap: 0, retrieve: 0 };
    return { calls, deps: {
      retrieve: async () => { calls.retrieve++; return { chunks: [CHUNK] }; },
      callAI: async (messages) => { calls.ai++; assert.match(messages[1].text, /KONTEKST:\n\[1\] O'zbekiston Respublikasining Fuqarolik kodeksi, 642-modda/u); return { text: answerText }; },
      callCheapAI: async () => { calls.cheap++; return { text: '{"verdicts":[]}' }; },
    } };
  }
  function ledgerStub() {
    const log = [];
    return { log, commit: async (k) => log.push(['commit', k]), release: async (k, r) => log.push(['release', k, r]) };
  }
  const run = (plan) => ({ id: 'r1', admin_id: 7, matter_id: null, plan, input: { task: 'Avans' }, jobs: [{ jobKey: 'j1', service: 'chat' }] });
  const ANSWER = "**Tahlil**\n\nPudratchi ishni boshlamasa, buyurtmachi shartnomadan voz kechishi mumkin ([Fuqarolik kodeksi, 642-modda](https://lex.uz/docs/-180552#-642)).\n\n**Xulosa**\n\nBuyurtmachi shartnomadan voz kechib, zararni talab qila oladi.";

  await test('a planned run: steps in order, the answer verified, the unit committed; the reply has the answer and its sources', async () => {
    const d = deps(ANSWER), l = ledgerStub();
    const ex = plannedExecutor({ registry: reg, deps: d.deps, ledger: l });
    const plan = validatePlan(good, reg, {}).plan;
    const saved = [];
    const out = await ex.execute(run(plan), { onCheckpoint: async (e) => saved.push(e.id) });
    assert.strictEqual(out.status, 'done', JSON.stringify(out.body.trace));
    assert.strictEqual(out.httpStatus, 200);
    assert.match(out.body.answer, /Tahlil[\s\S]*Xulosa/u);
    assert.deepStrictEqual(saved, ['n1', 'n2', 'n3'], 'each step checkpointed');
    assert.deepStrictEqual(l.log, [['commit', 'j1']]);
    assert.strictEqual(out.body.sources[0].article, '642');
    assert.deepStrictEqual([d.calls.retrieve, d.calls.ai], [1, 1]);
  });

  await test('a planned run that fails (no answer) releases the unit; a resumed run does not search again', async () => {
    const d = deps(''), l = ledgerStub();
    const ex = plannedExecutor({ registry: reg, deps: d.deps, ledger: l });
    const plan = validatePlan(good, reg, {}).plan;
    const out = await ex.execute(run(plan), {});
    assert.strictEqual(out.status, 'failed');
    assert.deepStrictEqual(l.log, [['release', 'j1', 'planned_failed']]);

    const d2 = deps(ANSWER), l2 = ledgerStub();
    const ex2 = plannedExecutor({ registry: reg, deps: d2.deps, ledger: l2 });
    const resumed = await ex2.execute(run(plan), { resume: { n1: { chunks: [CHUNK], note: '1 ta manba' } } });
    assert.strictEqual(resumed.status, 'done');
    assert.strictEqual(d2.calls.retrieve, 0, 'the search step came from its checkpoint');
  });

  await test('abort and cancel release the units', async () => {
    const l = ledgerStub();
    const ex = plannedExecutor({ registry: reg, deps: deps(ANSWER).deps, ledger: l });
    const r = await ex.abort(run(validatePlan(good, reg, {}).plan), 'cancelled');
    assert.strictEqual(r.httpStatus, 502);
    assert.deepStrictEqual(l.log, [['release', 'j1', 'planned_cancelled']]);
  });

  const { runWorkflow } = require('../src/agents/harness');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await test('graph: independent steps run together up to the limit; a step waits for its after', async () => {
    let now = 0, peak = 0;
    const order = [];
    const step = (id, after, ms = 30) => ({ id, label: id, after, run: async (state) => { now++; peak = Math.max(peak, now); order.push(`start ${id}`); await sleep(ms); now--; order.push(`end ${id}`); return { id, saw: Object.keys(state.steps).sort() }; } });
    const wf = { id: 'g', parallel: 2, steps: [step('a', []), step('b', []), step('c', []), step('d', ['a', 'b', 'c'], 5)] };
    const out = await runWorkflow(wf, null, {});
    assert.strictEqual(out.status, 'done');
    assert.strictEqual(peak, 2, 'never more than the limit at once');
    assert.deepStrictEqual(out.state.steps.d.saw, ['a', 'b', 'c'], 'd ran after a, b and c');
    assert.ok(order.indexOf('start d') > order.indexOf('end c'));
  });

  await test('graph: a failed required step starts nothing new; the steps already running finish and are recorded', async () => {
    const saved = [];
    const wf = { id: 'g', parallel: 3, steps: [
      { id: 'a', label: 'a', after: [], run: async () => { await sleep(5); throw new Error('a buzildi'); } },
      { id: 'b', label: 'b', after: [], run: async () => { await sleep(30); return { ok: 1 }; } },
      { id: 'c', label: 'c', after: ['a'], run: async () => ({ never: 1 }) },
    ] };
    const out = await runWorkflow(wf, null, { onCheckpoint: async (e) => saved.push(`${e.id}:${e.status}`) });
    assert.deepStrictEqual([out.status, out.stoppedAt], ['failed', 'a']);
    assert.deepStrictEqual(saved.sort(), ['a:failed', 'b:ok']);
    assert.strictEqual(out.state.steps.c, undefined);
  });

  await test('plans: the answer waits for every step before it, verify for everything; ask_user at most once and before the answer', () => {
    const p = validatePlan({ nodes: [
      { id: 'n1', tool: 'lex_search', args: { query: 'pudrat avans qaytarish' }, after: [] },
      { id: 'n2', tool: 'lex_search', args: { query: 'shartnomadan voz kechish' }, after: [] },
      { id: 'n3', tool: 'answer', args: { question: 'Avansni qaytarish mumkinmi?' }, after: ['n1'] },
      { id: 'n4', tool: 'verify', args: {}, after: [] },
    ] }, reg, {});
    assert.ok(p.ok, p.errors.join('; '));
    assert.deepStrictEqual(p.plan.nodes[2].after, ['n1', 'n2']);
    assert.deepStrictEqual(p.plan.nodes[3].after, ['n1', 'n2', 'n3']);
    const ask = { id: 'n9', tool: 'ask_user', args: { question: 'Shartnoma qachon tuzilgan?' }, after: [] };
    assert.match(errs({ nodes: [good.nodes[0], good.nodes[1], { ...ask, id: 'n3' }, { ...good.nodes[2], id: 'n4' }] }), /ask_user answer'dan oldin/u);
    assert.match(errs({ nodes: [{ ...ask, id: 'n1' }, { ...ask, id: 'n2' }, ...good.nodes.map((n, i) => ({ ...n, id: `n${i + 3}` }))] }), /ask_user ko'pi bilan bir marta/u);
  });

  await test('ask_user: the run stops for the answer (units released, the question in the reply); with the answer it resumes without searching again', async () => {
    const plan = validatePlan({ nodes: [
      { id: 'n1', tool: 'lex_search', args: { query: 'pudrat shartnomasi avans qaytarish' }, after: [] },
      { id: 'n2', tool: 'ask_user', args: { question: 'Avans qachon va qancha to\'langan?' }, after: [] },
      { id: 'n3', tool: 'answer', args: { question: 'Avansni qaytarish mumkinmi?' }, after: [] },
      { id: 'n4', tool: 'verify', args: {}, after: [] },
    ] }, reg, {}).plan;
    const d = deps(ANSWER), l = ledgerStub();
    const ex = plannedExecutor({ registry: reg, deps: d.deps, ledger: l });
    const saved = {};
    const first = await ex.execute({ ...run(plan) }, { onCheckpoint: async (e, o) => { if (e.status === 'ok' && o) saved[e.id] = o; } });
    assert.deepStrictEqual([first.status, first.httpStatus, first.body.stoppedAt], ['needs_input', 202, 'n2']);
    assert.match(first.body.question, /Avans qachon/u);
    assert.deepStrictEqual(l.log, [['release', 'j1', 'planned_needs_input']]);
    assert.strictEqual(d.calls.ai, 0, 'no answer written before the person answers');
    assert.ok(saved.n1 && !saved.n2, 'the search is a checkpoint, the question is not');

    const l2 = ledgerStub();
    const ex2 = plannedExecutor({ registry: reg, deps: d.deps, ledger: l2 });
    let userText = '';
    d.deps.callAI = async (m) => { userText = m[1].text; return { text: ANSWER }; };
    const again = await ex2.execute({ ...run(plan), input: { task: 'Avans', answers: { n2: '2026-yil mart, 12 mln so\'m' } }, jobs: [{ jobKey: 'j2', service: 'chat' }] }, { resume: saved });
    assert.strictEqual(again.status, 'done');
    assert.strictEqual(d.calls.retrieve, 1, 'the search came from its checkpoint');
    assert.match(userText, /Foydalanuvchi javobi: 2026-yil mart, 12 mln so'm/u, 'the answer reaches the answer step');
    assert.deepStrictEqual(l2.log, [['commit', 'j2']]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
