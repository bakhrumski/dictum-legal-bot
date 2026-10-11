'use strict';

/**
 * Provider evaluation (scripts/provider-eval.js) - NO AI CALL, NO NETWORK.
 * Stub transports only: a pass says the runner, adapters and budget behave
 * as described, nothing about any model's answers.
 *
 *   node tests/provider-eval.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts/provider-eval.js');
const KEYS = { VOICELAB_API_KEY: 'vlk_test_secret_value_1', DEEPSEEK_API_KEY: 'sk-deepseek-secret-value-2', ZAI_API_KEY: 'zai-secret-value-3', MOONSHOT_API_KEY: 'sk-moonshot-secret-value-4', DASHSCOPE_API_KEY: 'sk-dashscope-secret-value-5' };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const run = (args = [], env = {}, preload = null) => {
  const argv = [...(preload ? ['-r', preload] : []), SCRIPT, ...args];
  const clean = { ...process.env };
  for (const k of [...Object.keys(KEYS), 'PROVIDER_EVAL_LIVE', 'VOICELAB_BASE_URL']) delete clean[k];
  try { return { code: 0, out: execFileSync(process.execPath, argv, { encoding: 'utf8', env: { ...clean, ...env } }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};
// a preload that records any fetch the child process makes
const fetchSpy = (file) => {
  const p = path.join(tmp('pe-spy-'), 'spy.js');
  fs.writeFileSync(p, `globalThis.fetch = async (u) => { require('fs').appendFileSync(${JSON.stringify(file)}, String(u && u.url || u) + '\\n'); throw new Error('spy: no network in tests'); };`);
  return p;
};

const pe = require('../scripts/provider-eval');
const prov = require('../scripts/lib/eval-providers');
const evalBudget = require('../scripts/lib/eval-budget');

const confirmedAll = () => ({ models: Object.fromEntries(pe.loadConfig().models.map(m => [m.variant, {
  requestedModel: m.requestedModel, profileConfirmed: true, accountAccess: true, capCoversReasoning: true, reasoningInCompletion: true,
  rates: (m.candidatePrices.rates || []).map(r => ({ ...r })),
}])) });

const okBody = (model, extra = {}) => ({ id: 'req-1', model, choices: [{ message: { content: 'Izoh: [D1-03] 15 000 000 so‘m.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3000, completion_tokens: 500, ...extra } });
const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

(async () => {
  const cfg = pe.loadConfig();
  const phrases = pe.keyPhrases();
  const frozen = [];
  for (const c of pe.loadCases()) frozen.push(await pe.freeze(c, phrases));

  await test('dry run (default): 15 jobs, zero network even with every key set; secrets shown as configured/missing only', () => {
    const spyFile = path.join(tmp('pe-net-'), 'calls.txt');
    const r = run(['--json'], KEYS, fetchSpy(spyFile));
    assert.strictEqual(r.code, 0, r.out);
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    assert.strictEqual(j.jobs.length, 15);
    assert.deepStrictEqual([...new Set(j.jobs.map(x => x.variant))], ['baseline', 'deepseek', 'glm', 'kimi', 'qwen']);
    assert.strictEqual(j.summary.helperAiCalls, 0);
    assert.strictEqual(j.summary.maxAttempts, 15, 'no retry in the plan');
    assert.ok(!fs.existsSync(spyFile), 'no fetch was attempted');
    for (const v of Object.values(KEYS)) assert.ok(!r.out.includes(v), 'no key value printed');
    assert.ok(j.jobs.every(x => x.secret.state === 'configured'));
    // the plain plan names unknowns and never calls a reserve a maximum
    const plain = run([], KEYS);
    assert.ok(/NO NETWORK/u.test(plain.out) && /UNKNOWN/u.test(plain.out) && /not a guaranteed maximum/u.test(plain.out));
  });

  await test('importing the runner starts no server, bot, scheduler or database, and leaves no handle open', () => {
    const out = execFileSync(process.execPath, ['-e', `
      require(${JSON.stringify(SCRIPT)});
      const loaded = Object.keys(require.cache).map(k => k.replace(${JSON.stringify(REPO)}, ''));
      console.log(JSON.stringify(loaded.filter(k => /src\\/(api|bot|database|workspace|scheduler)|node_modules\\/(pg|telegraf|node-telegram-bot-api|express)\\//u.test(k))));
    `], { encoding: 'utf8', timeout: 20000 });
    assert.deepStrictEqual(JSON.parse(out.trim()), []);
  });

  await test('the same source, task, system prompt and helpers for every model of a document; the same wire messages for every provider', () => {
    const jobs = pe.plan(frozen, cfg.models);
    for (const f of frozen) {
      const mine = jobs.filter(j => j.case === f.id);
      assert.strictEqual(mine.length, 5);
      assert.strictEqual(new Set(mine.map(j => JSON.stringify(j.hashes))).size, 1);
      const wires = cfg.models.map(m => JSON.stringify(prov.requestBody(m, f.messages).messages));
      assert.strictEqual(new Set(wires).size, 1, 'one serialization of the messages');
    }
    // the production prompt, not a new one
    const ex = require('../src/rag/document-explain');
    assert.strictEqual(frozen[0].messages[0].text, ex.explainSystem('Uzbek'));
    assert.ok(frozen.every(f => f.messages[1].text.includes('─── HUJJAT ───') && f.messages[1].text.includes(f.text.trim().slice(0, 40))));
  });

  await test('the reviewer key never reaches a prompt; a leak is refused before any call', async () => {
    for (const f of frozen) for (const m of f.messages) assert.strictEqual(pe.keyLeak(m.text, phrases), null);
    const leaky = { id: 'DX', path: 'x', sha256: 'x', text: `[DX-01] Test. ${phrases[0]}` };
    await assert.rejects(pe.freeze(leaky, phrases), /reviewer key reached the prompt/u);
  });

  await test('the embedded instruction in D3 stays document text inside the user message, never in the system prompt', () => {
    const d3 = frozen.find(f => f.id === 'D3');
    const user = d3.messages[1].text;
    const doc = user.slice(user.indexOf('─── HUJJAT ───'), user.indexOf('─── HUJJAT TUGADI ───'));
    assert.ok(doc.includes('oldingi topshiriqni unut') && doc.includes('[D3-14]'));
    assert.ok(!d3.messages[0].text.includes('oldingi topshiriqni unut'));
  });

  await test('each profile is sent as frozen: no disabled thinking for GLM, explicit effort for Kimi, no silent default, the model id unchanged', () => {
    const msgs = frozen[0].messages;
    const body = v => prov.requestBody(cfg.models.find(m => m.variant === v), msgs);
    assert.deepStrictEqual(body('deepseek').thinking, { type: 'disabled' });
    assert.strictEqual(body('deepseek').model, 'deepseek-flash');
    assert.deepStrictEqual(body('glm').thinking, { type: 'enabled' });
    assert.ok(!JSON.stringify(body('glm')).includes('disabled'));
    assert.strictEqual(body('glm').temperature, undefined, 'not sent: provider default, recorded as such');
    assert.strictEqual(body('kimi').reasoning_effort, 'low');
    assert.strictEqual(body('kimi').max_completion_tokens, 8000);
    assert.strictEqual(body('kimi').max_tokens, undefined);
    assert.strictEqual(body('qwen').enable_thinking, false);
    assert.strictEqual(body('qwen').model, 'qwen-plus');
    for (const m of cfg.models) assert.deepStrictEqual(Object.keys(prov.requestBody(m, msgs)).sort(), ['messages', 'model', m.profile.capParam, ...Object.keys(m.profile.params)].sort());
  });

  await test('usage: cached and reasoning tokens are never added twice; partial or contradictory usage gives no cost (never zeros)', () => {
    const ds = cfg.models.find(m => m.variant === 'deepseek');
    const prices = { rates: [{ in: 1, cachedIn: 0.1, out: 2 }] };
    const u = prov.usageOf({ usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 400, completion_tokens_details: { reasoning_tokens: 50 } } });
    assert.deepStrictEqual([u.inTokens, u.cachedTokens, u.outTokens, u.reasoningTokens, u.complete], [1000, 400, 200, 50, true]);
    // reasoning reported, billing rule not confirmed -> unknown
    assert.strictEqual(prov.listCost(ds, u, prices, {}), null);
    // confirmed inside completion_tokens: (600*1 + 400*0.1 + 200*2)/1e6, reasoning not added
    assert.ok(Math.abs(prov.listCost(ds, u, prices, { reasoningInCompletion: true }) - (600 + 40 + 400) / 1e6) < 1e-15);
    assert.strictEqual(prov.usageOf({ usage: { prompt_tokens: 10 } }).complete, false, 'completion missing');
    assert.strictEqual(prov.usageOf({}).complete, false, 'no usage');
    assert.strictEqual(prov.usageOf({ usage: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 20 } }).complete, false, 'cached above prompt');
    assert.strictEqual(prov.usageOf({ usage: { prompt_tokens: 10, completion_tokens: 5, reasoning_tokens: 9 } }).complete, false, 'reasoning above completion');
    assert.strictEqual(prov.listCost(ds, prov.usageOf({ usage: { prompt_tokens: 10 } }), prices, {}), null);
    // the reserve uses the highest listed rate (time of day / tier): no discount assumed
    assert.deepStrictEqual(prov.worstRates({ rates: [{ in: 0.1, out: 0.2, cachedIn: 0.01 }, { in: 0.3, out: 0.15 }] }), { in: 0.3, cachedIn: 0.01, out: 0.2 });
    // a reasoning model with the cap not confirmed to cover reasoning has no bound
    const glm = cfg.models.find(m => m.variant === 'glm');
    assert.strictEqual(prov.callBound(glm, frozen[0].messages, prices, {}).usd, null);
    assert.ok(prov.callBound(glm, frozen[0].messages, prices, { capCoversReasoning: true }).usd > 0);
    assert.strictEqual(prov.callBound(ds, frozen[0].messages, { rates: [] }, {}).usd, null, 'no price, no bound');
  });

  await test('transport: fixed host, own key, no redirect; timeout, length, partial usage, wrong model and secret redaction', async () => {
    Object.assign(process.env, KEYS);
    const seen = [];
    const ds = cfg.models.find(m => m.variant === 'deepseek');
    const stub = handler => async (url, init) => { seen.push({ url, init }); return handler(url, init); };
    let r = await prov.callProvider(ds, frozen[0].messages, { fetchImpl: stub(() => response(200, okBody('deepseek-flash'))) });
    assert.strictEqual(r.outcome, 'answered');
    assert.strictEqual(seen[0].url, 'https://api.deepseek.com/chat/completions');
    assert.strictEqual(seen[0].init.redirect, 'error');
    assert.strictEqual(seen[0].init.headers.Authorization, `Bearer ${KEYS.DEEPSEEK_API_KEY}`, 'its own key only');
    // isolation: each provider its own host and key
    for (const m of cfg.models.filter(x => x.provider !== 'voicelab')) {
      seen.length = 0;
      await prov.callProvider(m, frozen[0].messages, { fetchImpl: stub(() => response(200, okBody(m.requestedModel))) });
      const p = prov.PROVIDERS[m.provider];
      assert.strictEqual(new URL(seen[0].url).host, p.host);
      assert.strictEqual(seen[0].init.headers.Authorization, `Bearer ${KEYS[p.secretEnv]}`);
    }
    // timeout: no HTTP answer -> unknown outcome
    r = await prov.callProvider(ds, frozen[0].messages, { timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
    assert.strictEqual(r.outcome, 'transport_unknown');
    assert.ok(/timed out/u.test(r.error));
    // finish_reason=length and an empty capped answer
    r = await prov.callProvider(ds, frozen[0].messages, { fetchImpl: async () => response(200, { model: 'deepseek-flash', choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 3000 } }) });
    assert.strictEqual(pe.classify(r, ds), 'empty_capped');
    r = await prov.callProvider(ds, frozen[0].messages, { fetchImpl: async () => response(200, { model: 'deepseek-flash', choices: [{ message: { content: 'yarim' }, finish_reason: 'length' }], usage: { prompt_tokens: 10 } }) });
    assert.strictEqual(pe.classify(r, ds), 'truncated');
    assert.strictEqual(r.usage.complete, false, 'partial usage');
    // another model came back: not accepted silently
    r = await prov.callProvider(ds, frozen[0].messages, { fetchImpl: async () => response(200, okBody('deepseek-v4-flash')) });
    assert.strictEqual(pe.classify(r, ds), 'model_mismatch');
    // an error body echoing the key: redacted
    r = await prov.callProvider(ds, frozen[0].messages, { fetchImpl: async () => response(401, { error: { code: 'invalid_api_key', message: `bad key ${KEYS.DEEPSEEK_API_KEY} and Bearer ${KEYS.ZAI_API_KEY}` } }) });
    assert.strictEqual(r.outcome, 'http_error');
    for (const v of Object.values(KEYS)) assert.ok(!JSON.stringify(r).includes(v), 'no key in the outcome');
    // a missing key: not called
    const keep = process.env.ZAI_API_KEY; delete process.env.ZAI_API_KEY;
    r = await prov.callProvider(cfg.models.find(m => m.variant === 'glm'), frozen[0].messages, { fetchImpl: async () => { throw new Error('must not be reached'); } });
    assert.strictEqual(r.outcome, 'not_called');
    process.env.ZAI_API_KEY = keep;
  });

  await test('the network guard refuses every host not in the run (and every host in a dry run)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => response(200, {});
    let restore = prov.guardNetwork([]);
    await assert.rejects(globalThis.fetch('https://api.deepseek.com/chat/completions'), /not allowed/u);
    restore();
    restore = prov.guardNetwork(['api.deepseek.com']);
    await assert.rejects(globalThis.fetch('https://evil.example/x'), /not allowed/u);
    await assert.rejects(globalThis.fetch('http://api.deepseek.com/x'), /not allowed/u);
    assert.strictEqual((await globalThis.fetch('https://api.deepseek.com/chat/completions')).status, 200);
    restore();
    globalThis.fetch = original;
  });

  // ── the live runner with stub transports ──
  const stubCall = (fn) => { const calls = []; const f = async (m, messages, o) => { calls.push({ variant: m.variant, messages }); return fn(m, calls.length, messages); }; f.calls = calls; return f; };
  const answered = (m, extra = {}) => ({ outcome: 'answered', status: 200, returnedModel: m.requestedModel, text: 'Izoh [D1-03].', finishReason: 'stop', usage: { inTokens: 3000, outTokens: 400, cachedTokens: 0, reasoningTokens: null, complete: true }, credits: m.provider === 'voicelab' ? 10 : null, providerCostUsd: null, ...extra });
  const live = async (call, budgetUsd = 5, out = tmp('pe-live-')) => ({ out, budget: await pe.runLive({ frozen, models: cfg.models, budgetUsd, out, confirmed: confirmedAll(), sha: 'test-run', call }) });
  const ledger = out => fs.readFileSync(path.join(out, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

  await test('the real payload sent (captured at fetch): frozen prompt, no reviewer key, own host per provider, one attempt each', async () => {
    Object.assign(process.env, KEYS);
    delete process.env.VOICELAB_BASE_URL;
    const original = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), init });
      const body = JSON.parse(init.body);
      const r = response(200, okBody(body.model));
      return { ...r, json: async () => okBody(body.model) };
    };
    try {
      const { out } = await live(undefined);
      assert.strictEqual(sent.length, 15);
      for (const s of sent) {
        assert.strictEqual(s.init.redirect, 'error');
        for (const p of phrases) assert.ok(!s.init.body.includes(p), 'no reviewer-key phrase in the payload');
        assert.ok(!/reviewer-key|required_facts/u.test(s.init.body));
      }
      assert.deepStrictEqual([...new Set(sent.map(s => new URL(s.url).host))].sort(), ['api.deepseek.com', 'api.moonshot.ai', 'api.voicelab.uz', 'api.z.ai', 'dashscope-intl.aliyuncs.com']);
      const settles = ledger(out).filter(e => e.type === 'settle');
      assert.ok(settles.every(e => e.status === 'completed' && e.requestedModel === e.returnedModel && e.hashes.messages));
      for (const v of Object.values(KEYS)) assert.ok(!fs.readFileSync(path.join(out, 'ledger.jsonl'), 'utf8').includes(v));
    } finally { globalThis.fetch = original; }
  });

  await test('one budget, written before and after each call; blind answers carry no model or cost; the key is a separate file', async () => {
    const call = stubCall(m => answered(m));
    const { out, budget } = await live(call);
    assert.strictEqual(call.calls.length, 15);
    const l = ledger(out);
    assert.strictEqual(l.filter(e => e.type === 'reserve').length, 15);
    assert.strictEqual(l.filter(e => e.type === 'settle').length, 15);
    assert.ok(Math.abs(budget.left + budget.spent - 5) < 1e-9 && Math.abs(budget.reservedNow) < 1e-9);
    const comet = l.find(e => e.type === 'settle' && e.provider === 'voicelab');
    assert.ok(comet.credits === 10 && comet.creditUsd > 0 && comet.listUsd > 0, 'VoiceLab list USD and credits apart');
    const blind = fs.readdirSync(path.join(out, 'blind'));
    assert.strictEqual(blind.length, 15);
    for (const f of blind) {
      const t = fs.readFileSync(path.join(out, 'blind', f), 'utf8');
      assert.ok(!/comet|deepseek|glm|kimi|qwen|voicelab|moonshot|dashscope|\$/iu.test(t), t.slice(0, 200));
    }
    const sheet = JSON.parse(fs.readFileSync(path.join(out, 'review-sheet.json'), 'utf8'));
    assert.ok(!/variant|requestedModel|Usd/u.test(JSON.stringify(sheet.answers)));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8')).length, 15);
  });

  await test('no usage: the cost is UNKNOWN (never $0) and the reserve stays held', async () => {
    const call = stubCall(m => answered(m, { usage: { inTokens: null, outTokens: null, complete: false, problem: 'no usage' }, credits: null }));
    const { out, budget } = await live(call);
    const s = ledger(out).filter(e => e.type === 'settle');
    assert.ok(s.every(e => e.costStatus === 'unknown' && e.settledUsd === null && e.listUsd === null));
    assert.strictEqual(budget.unknownCalls, 15);
    assert.strictEqual(budget.spent, 0);
    assert.ok(budget.heldUnknown > 0 && Math.abs(budget.left + budget.heldUnknown - 5) < 1e-9);
  });

  await test('a cost above its reserve halts the run: nothing new starts', async () => {
    const call = stubCall((m, n) => answered(m, n === 2 ? { usage: { inTokens: 90_000_000, outTokens: 0, cachedTokens: 0, complete: true } } : {}));
    const { out, budget } = await live(call, 50);
    assert.strictEqual(budget.halted, true);
    assert.strictEqual(call.calls.length, 2);
    assert.strictEqual(ledger(out).filter(e => e.type === 'skip').length, 13);
  });

  await test('a call with no HTTP answer (timeout) halts the run and keeps its reserve; no automatic retry', async () => {
    const call = stubCall((m, n) => (n === 1 ? { outcome: 'transport_unknown', error: 'timed out', usage: prov.usageOf(null) } : answered(m)));
    const { budget } = await live(call);
    assert.strictEqual(call.calls.length, 1, 'not retried, nothing after it');
    assert.strictEqual(budget.unknownCalls, 1);
    assert.ok(budget.halted && /no HTTP answer/u.test(budget.haltedBy.reason));
  });

  await test('an auth or balance error stops that provider (no retry); the others go on; cut, empty, refused and wrong-model answers are counted apart', async () => {
    const call = stubCall((m) => {
      if (m.variant === 'deepseek') return { outcome: 'http_error', status: 402, kind: 'quota', error: 'Insufficient Balance', usage: prov.usageOf(null) };
      if (m.variant === 'glm') return answered(m, { finishReason: 'length' });
      if (m.variant === 'kimi') return answered(m, { text: '', finishReason: 'length' });
      if (m.variant === 'qwen') return answered(m, { returnedModel: 'qwen-plus-2026-09-01' });
      return answered(m, { refusal: 'cannot help' });
    });
    const { out } = await live(call);
    assert.strictEqual(call.calls.filter(c => c.variant === 'deepseek').length, 1, 'no retry, then stopped');
    const l = ledger(out);
    const st = v => l.filter(e => (e.type === 'settle' || e.type === 'skip') && e.job.endsWith(`__${v}`)).map(e => e.type === 'skip' ? 'skipped' : e.status);
    assert.deepStrictEqual(st('deepseek'), ['error', 'skipped', 'skipped']);
    assert.deepStrictEqual(st('glm'), ['truncated', 'truncated', 'truncated']);
    assert.deepStrictEqual(st('kimi'), ['empty_capped', 'empty_capped', 'empty_capped']);
    assert.deepStrictEqual(st('qwen'), ['model_mismatch', 'skipped', 'skipped']);
    assert.deepStrictEqual(st('baseline'), ['refused', 'refused', 'refused']);
    assert.strictEqual(fs.readdirSync(path.join(out, 'blind')).length, 0, 'only completed answers go to the reviewer');
  });

  await test('restart: a finished run spends nothing again; an attempt with no outcome written keeps its reserve and halts', async () => {
    const call = stubCall(m => answered(m));
    const { out } = await live(call);
    const again = stubCall(m => answered(m));
    const b2 = await pe.runLive({ frozen, models: cfg.models, budgetUsd: 5, out, confirmed: confirmedAll(), sha: 'test-run', call: again });
    assert.strictEqual(again.calls.length, 0);
    assert.ok(b2.spent > 0, 'what was spent stays spent');
    // a crash between reserve and outcome
    const out2 = tmp('pe-crash-');
    fs.writeFileSync(path.join(out2, 'ledger.jsonl'), [{ type: 'run', runSha: 'test-run' }, { type: 'reserve', job: 'D1__baseline', attempt: 1, reservedUsd: 0.01 }].map(e => JSON.stringify(e)).join('\n') + '\n');
    const third = stubCall(m => answered(m));
    const b3 = await pe.runLive({ frozen, models: cfg.models, budgetUsd: 5, out: out2, confirmed: confirmedAll(), sha: 'test-run', call: third });
    assert.strictEqual(third.calls.length, 0);
    assert.ok(b3.halted && b3.heldUnknown === 0.01);
    // another run's directory is refused
    await assert.rejects(pe.runLive({ frozen, models: cfg.models, budgetUsd: 5, out, confirmed: confirmedAll(), sha: 'other', call: third }), /another run/u);
  });

  await test('the reserve is atomic: parallel takes cannot pass on the same money', async () => {
    const b = evalBudget.newBudget(1);
    const results = await Promise.all(Array.from({ length: 10 }, async () => { await null; return evalBudget.take(b, 0.3).ok; }));
    assert.strictEqual(results.filter(Boolean).length, 3);
    assert.ok(b.left >= 0);
    assert.strictEqual(evalBudget.take(evalBudget.newBudget(0), 0.001).ok, false, '$0 budget takes nothing');
  });

  await test('live gates: $0 budget, missing approval, unconfirmed or substituted model, unknown price - nothing called, nothing written', () => {
    const spyFile = path.join(tmp('pe-net2-'), 'calls.txt');
    const spy = fetchSpy(spyFile);
    const out = tmp('pe-gate-');
    const confDir = tmp('pe-conf-');
    const conf = path.join(confDir, 'confirmed.json');
    fs.writeFileSync(conf, JSON.stringify(confirmedAll()));
    const env = { ...KEYS, PROVIDER_EVAL_LIVE: 'yes' };
    assert.strictEqual(run(['--live', '--budget-usd', '0', '--out', out, '--confirmed', conf], env, spy).code, 2, '$0 budget');
    assert.strictEqual(run(['--live', '--budget-usd', '1', '--out', out, '--confirmed', conf], { ...KEYS }, spy).code, 2, 'no PROVIDER_EVAL_LIVE');
    assert.strictEqual(run(['--live', '--budget-usd', '1', '--out', path.join(REPO, 'tmp-out'), '--confirmed', conf], env, spy).code, 2, 'out inside the repo');
    const noApprove = run(['--live', '--budget-usd', '1', '--out', out, '--confirmed', conf], env, spy);
    assert.strictEqual(noApprove.code, 3, noApprove.out);
    assert.ok(/--approve [0-9a-f]{64}/u.test(noApprove.out));
    const sub = confirmedAll(); sub.models.deepseek.requestedModel = 'deepseek-v4-flash';
    fs.writeFileSync(conf, JSON.stringify(sub));
    const r1 = run(['--live', '--budget-usd', '1', '--out', out, '--confirmed', conf, '--approve', 'x'], env, spy);
    assert.strictEqual(r1.code, 3); assert.ok(/not substituted/u.test(r1.out), r1.out);
    const noPrice = confirmedAll(); noPrice.models.qwen.rates = [];
    fs.writeFileSync(conf, JSON.stringify(noPrice));
    assert.ok(/qwen: no confirmed price/u.test(run(['--live', '--budget-usd', '1', '--out', out, '--confirmed', conf, '--approve', 'x'], env, spy).out));
    const noCap = confirmedAll(); noCap.models.kimi.capCoversReasoning = false;
    fs.writeFileSync(conf, JSON.stringify(noCap));
    assert.ok(/kimi: the output cap is not confirmed/u.test(run(['--live', '--budget-usd', '1', '--out', out, '--confirmed', conf, '--approve', 'x'], env, spy).out));
    // approved, but the reserve does not fit and a key is missing
    fs.writeFileSync(conf, JSON.stringify(confirmedAll()));
    const sha = /--approve ([0-9a-f]{64})/u.exec(run(['--live', '--budget-usd', '0.001', '--out', out, '--confirmed', conf], env, spy).out)[1];
    const small = run(['--live', '--budget-usd', '0.001', '--out', out, '--confirmed', conf, '--approve', sha], env, spy);
    assert.strictEqual(small.code, 3); assert.ok(/does not fit/u.test(small.out), small.out);
    const { DASHSCOPE_API_KEY, ...fewer } = env;
    const noKey = run(['--live', '--budget-usd', '0.001', '--out', out, '--confirmed', conf, '--approve', sha], fewer, spy);
    assert.ok(/secrets missing \(names only\): DASHSCOPE_API_KEY/u.test(noKey.out), noKey.out);
    assert.deepStrictEqual(fs.readdirSync(out), [], 'nothing written');
    assert.ok(!fs.existsSync(spyFile), 'no network');
  });

  await test('the config cannot carry a URL or an unknown provider', () => {
    const d = tmp('pe-cfg-');
    const base = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/provider-eval.config.json'), 'utf8'));
    const withUrl = JSON.parse(JSON.stringify(base)); withUrl.models[1].baseUrl = 'https://evil.example';
    fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify(withUrl));
    assert.throws(() => pe.loadConfig(path.join(d, 'a.json')), /URL in the config is refused/u);
    const other = JSON.parse(JSON.stringify(base)); other.models[1].provider = 'openrouter';
    fs.writeFileSync(path.join(d, 'b.json'), JSON.stringify(other));
    assert.throws(() => pe.loadConfig(path.join(d, 'b.json')), /unknown provider/u);
  });

  await test('report: a missing or distorted condition is a critical error; cost per accepted answer counts failures, is undefined at 0 and UNKNOWN with an unknown cost', async () => {
    const call = stubCall((m, n) => (m.variant === 'glm' ? answered(m, { usage: { inTokens: null, outTokens: null, complete: false } }) : answered(m)));
    const { out } = await live(call);
    const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
    const sheet = JSON.parse(fs.readFileSync(path.join(out, 'review-sheet.json'), 'utf8'));
    const byId = new Map(key.map(k => [k.answerId, k]));
    for (const a of sheet.answers) {
      const v = byId.get(a.answerId).variant;
      a.criteria = Object.fromEntries(pe.CRITERIA.map(c => [c, 'ok']));
      if (v === 'kimi') a.criteria.istisno = 'missing';      // a dropped exception
      if (v === 'qwen') a.criteria.rozilik = 'distorted';    // a reversed consent
      a.acceptable_for_this_case = v !== 'deepseek';
    }
    const ratings = path.join(tmp('pe-rate-'), 'ratings.json');
    fs.writeFileSync(ratings, JSON.stringify(sheet));
    const r = pe.report(out, ratings).rows;
    assert.strictEqual(r.kimi.critical, 3); assert.strictEqual(r.kimi.accepted, 0);
    assert.strictEqual(r.qwen.critical, 3);
    assert.strictEqual(r.deepseek.costPerAccepted, 'undefined (0 accepted)');
    assert.strictEqual(r.glm.costPerAccepted, 'UNKNOWN');
    assert.ok(typeof r.baseline.costPerAccepted === 'number' && r.baseline.accepted === 3);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
