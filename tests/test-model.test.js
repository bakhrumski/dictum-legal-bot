'use strict';

/**
 * A master's own test model (src/ai/test-model.js): applied only for a
 * database-confirmed master and an allowed id, for that one request; the
 * digest keeps the production model; the explanation router and the
 * server's call functions ask for it. No network, no cost.
 *
 *   node tests/test-model.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tm = require('../src/ai/test-model');
const { createExplainAI } = require('../src/ai/explain-router');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

// runs the middleware and reports the test model seen inside next()
const through = (mw, { header, session, master = true }) => new Promise((resolve) => {
  const headers = {};
  const req = { session, get: k => (k.toLowerCase() === tm.HEADER ? header : undefined) };
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  mw(req, res, () => resolve({ seen: tm.current(), headers }));
});

(async () => {
  await test('applied only for a database master and an allowed id; ignored (never an error) for anyone else', async () => {
    let dbCalls = 0;
    const annotated = [];
    const mw = tm.createMiddleware({ verifyMaster: async (id) => { dbCalls++; return id === 7; }, onApplied: m => annotated.push(m) });
    const master = { role: 'master', adminId: 7 };
    let r = await through(mw, { header: 'zai/glm-5.3-flash', session: master });
    assert.deepStrictEqual([r.seen, r.headers['X-JAI-Test-Model'], r.headers['Cache-Control']], ['zai/glm-5.3-flash', 'zai/glm-5.3-flash', 'no-store']);
    assert.deepStrictEqual(annotated, ['zai/glm-5.3-flash']);
    r = await through(mw, { header: ' OpenAI/GPT-6-Sol ', session: master });
    assert.strictEqual(r.seen, 'openai/gpt-6-sol', 'case and spaces normalised');
    for (const [header, session, why] of [
      ['zai/glm-5.3-flash', { role: 'user', adminId: 9 }, 'a customer'],
      ['zai/glm-5.3-flash', { role: 'lawyer', adminId: 9 }, 'a lawyer'],
      ['zai/glm-5.3-flash', { role: 'master', adminId: 8 }, 'master in the session only, not in the database'],
      ['zai/glm-5.3-flash', {}, 'no session'],
      ['openai/gpt-6-astra', master, 'a model not on the list'],
      ['gpt-6-sol', master, 'an id without its provider'],
    ]) {
      r = await through(mw, { header, session });
      assert.strictEqual(r.seen, null, why);
      assert.ok(!('X-JAI-Test-Model' in r.headers), why);
    }
    const before = dbCalls;
    r = await through(mw, { header: undefined, session: master });
    assert.strictEqual(r.seen, null);
    assert.strictEqual(dbCalls, before, 'no header: no database query');
    const broken = tm.createMiddleware({ verifyMaster: async () => { throw new Error('db down'); } });
    assert.strictEqual((await through(broken, { header: 'zai/glm-5.3-flash', session: master })).seen, null, 'a failed check never applies it');
  });

  await test('apply: the request\'s model replaces the caller\'s; a digest part keeps the production model; outside a request nothing changes', async () => {
    const opts = { model: 'gpt-6-luna', lane: 'cheap' };
    assert.strictEqual(tm.apply(opts), opts);
    await new Promise(resolve => tm._als.run({ model: 'deepseek/deepseek-v4-pro' }, () => {
      const o = tm.apply(opts);
      assert.deepStrictEqual([o.model, o.lane, o.testModel], ['deepseek/deepseek-v4-pro', 'cheap', 'deepseek/deepseek-v4-pro']);
      assert.strictEqual(opts.model, 'gpt-6-luna', 'the caller\'s object is not changed');
      const d = { model: 'gpt-6-luna', detail: { phase: 'digest', part: 1 } };
      assert.strictEqual(tm.apply(d), d, 'digest');
      resolve();
    }));
  });

  await test('explanation router: a test model goes through callOpenAI at the route\'s caps (DeepSeek/GLM 6 000 after doubling, GPT-6 8 000), never straight to DeepSeek', async () => {
    const calls = [];
    const deps = (model) => ({
      usageLedger: { withChain: f => f(), track: async () => { throw new Error('must not call DeepSeek directly'); } },
      modelPricing: {}, deepseek: {}, paidAllowed: async () => true, lastResort: async () => ({ text: 'x' }), callDefault: async () => ({ text: 'x' }),
      callOpenAI: async (m, o) => { calls.push(o); return { text: 'Izoh.', provider: o.model }; }, testModel: () => model,
    });
    const keep = process.env.DEEPSEEK_API_KEY; process.env.DEEPSEEK_API_KEY = 'sk-test-not-real';
    try {
      await createExplainAI(deps('zai/glm-5.3-flash'))([{ role: 'user', text: 'x' }], { endpoint: '/api/draft/explain-document' });
      await createExplainAI(deps('openai/gpt-6-sol'))([{ role: 'user', text: 'x' }], {});
    } finally { if (keep == null) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = keep; }
    assert.deepStrictEqual(calls.map(c => [c.model, c.maxTokens, c.lane]), [['zai/glm-5.3-flash', 3000, 'cheap'], ['openai/gpt-6-sol', 8000, 'cheap']]);
  });

  await test('server: mounted after the usage-ledger scope; callOpenAI and its stream ask for the test model; the opinion names it; masters list the models', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const scope = src.indexOf("app.use('/api/', usageLedger.expressScope('web'));");
    const mount = src.indexOf("app.use('/api/', testModel.createMiddleware({");
    assert.ok(scope > 0 && mount > scope, 'inside the request scope');
    assert.ok(/createMiddleware\(\{\s*verifyMaster: require\('\.\.\/rag\/document-explain-route'\)\.createVerifyMaster\(pool\)/u.test(src), 'database check');
    for (const fn of ['callOpenAI', 'callOpenAIStream']) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf(`async function ${fn}(`) + 400);
      assert.ok(/options = testModel\.apply\(options\);/u.test(body) && body.indexOf('testModel.apply') < body.indexOf('tryZai('), fn);
    }
    assert.ok(/if \(testModel\.current\(\)\) opinionModel = testModel\.current\(\);/u.test(src));
    assert.ok(/callOpenAI, testModel: testModel\.current,/u.test(src), 'explanation router');
    assert.ok(/app\.get\('\/api\/admin\/test-models', requireMasterAdmin,/u.test(src));
    assert.ok(/const cacheable = process\.env\.ANSWER_CACHE !== 'off'\s*&& !testModel\.current\(\)/u.test(src), 'a test model neither reads nor writes the answer cache');
    assert.deepStrictEqual(tm.TEST_MODELS.map(m => m.id), ['zai/glm-5.3-flash', 'deepseek/deepseek-flash', 'deepseek/deepseek-flash-thinking', 'deepseek/deepseek-v4-pro', 'openai/gpt-6-luna', 'openai/gpt-6-sol']);
  });

  await test('dashboard: the picker script loads first and adds the header only to the page\'s own /api/ requests', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    const at = html.indexOf('<script src="/js/test-model.js"></script>');
    assert.ok(at > 0 && at < html.indexOf('</head>'), 'in the head');
    assert.ok(at < html.indexOf('/js/dashboard-chat.js'), 'before the page\'s own scripts');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/test-model.js'), 'utf8');
    assert.ok(/u\.origin === location\.origin && u\.pathname\.indexOf\('\/api\/'\) === 0/u.test(js), 'same origin, /api/ only');
    assert.ok(/sessionStorage/u.test(js) && !/localStorage/u.test(js), 'kept for the tab only');
    assert.ok(/nativeFetch\('\/api\/admin\/test-models'/u.test(js), 'shown only when the server answers as master');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
