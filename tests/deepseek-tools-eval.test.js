'use strict';

/**
 * The DeepSeek Search / Fetch evaluation behind Boshqaruv's "DeepSeek qidiruv
 * sinovi" (2026-10-27, owner). Evaluation only: nothing in the answer
 * pipeline uses it. Stubbed DeepSeek and lex.uz - no network, no key.
 *
 *   node tests/deepseek-tools-eval.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ev = require('../src/services/deepseek-tools-eval');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const KEY = 'sk-test-0123456789abcdef';
function stubs({ searchFails = false, fetchFails = false } = {}) {
  const calls = [], tracked = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    if (url.endsWith('/search')) {
      if (searchFails) return { ok: false, status: 402, text: async () => JSON.stringify({ error: { message: 'Insufficient Balance' } }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [
        { title: 'Boshqa qaror', url: 'https://lex.uz/docs/-999', rerank_score: 1.1 },
        { title: 'Fuqarolik kodeksi (ikkinchi qism)', url: 'https://lex.uz/uz/docs/-180552#-188841', rerank_score: 2.2 },
      ] }) };
    }
    if (fetchFails) return { ok: false, status: 413, text: async () => JSON.stringify({ error: { message: 'too large' } }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ title: 'Akt', content: body.url.includes('4422250') ? 'tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish' : '642-modda. ...' }) };
  };
  const track = async (meta, fn) => { const row = { meta, usage: null }; tracked.push(row); try { return await fn({ usage(u) { row.usage = u; } }); } catch (e) { row.error = e.message; throw e; } };
  const plan = async () => [{ kind: 'legal-concept', query: 'pudratchi ishni bajarmaslik' }, { kind: 'code-search', query: 'pudratchi ishni bajarmaslik', actForm: 'code' }];
  const lexSearchPage = async (q, { actForm } = {}) => actForm === 'code' ? ['https://lex.uz/docs/-111', 'https://lex.uz/docs/-180552'] : ['https://lex.uz/docs/-222'];
  return { calls, tracked, deps: { apiKey: KEY, fetchImpl, track, plan, lexSearchPage } };
}
const ONE = [{ id: 'pudrat', question: 'Pudratchi ishni bajarmadi, avansni qaytarmayapti', topic: 'fuqarolik', expect: { label: 'Fuqarolik kodeksi (ikkinchi qism)', docId: '180552' } }];

(async () => {
  await test('helpers: lex.uz document ids, ranks, and a site:lex.uz query within 128 characters', () => {
    assert.strictEqual(ev.lexDocId('https://lex.uz/uz/docs/-180552#-188841'), '180552');
    assert.strictEqual(ev.lexDocId('https://lex.uz/docs/8458324'), '8458324');
    assert.strictEqual(ev.rankOf(['https://lex.uz/docs/-1', 'https://lex.uz/docs/-180552'], '180552'), 2);
    assert.strictEqual(ev.rankOf([], '1'), null);
    const q = ev.siteQuery('so’z '.repeat(60));
    assert.ok(q.length <= 128 && q.endsWith(' site:lex.uz'));
  });

  await test('a run: ours and DeepSeek ranked against the expected act, fetch checked for the deciding line; the key never in the report', async () => {
    const s = stubs();
    const r = await ev.createDeepseekToolsEval({ ...s.deps, cases: ONE, fetches: [ev.FETCHES[0]] }).run();
    assert.deepStrictEqual(r.search[0].ours, { rank: 3, how: 'search', queries: ['pudratchi ishni bajarmaslik', 'pudratchi ishni bajarmaslik (code)'], seen: 3 });
    assert.deepStrictEqual(r.search[0].deepseek.map(d => d.rank), [2, 2]);
    assert.ok(s.calls.filter(c => c.url.endsWith('/search')).every(c => / site:lex\.uz$/u.test(c.body.query) && c.body.count === 10));
    assert.strictEqual(r.fetch[0].found, true);
    assert.deepStrictEqual(r.summary, { cases: 1, oursFound: 1, deepseekFound: 1, deepseekTop3: 1, fetchWhole: 1, requests: 3, maxUsd: 0.00225 });
    assert.ok(!JSON.stringify(r).includes(KEY), 'the API key is never in the report');
    assert.ok(s.calls.every(c => c.auth === `Bearer ${KEY}`));
  });

  await test('every request is a ledger row priced per successful request; a failure is recorded and named, not counted', async () => {
    const s = stubs({ searchFails: true, fetchFails: true });
    const r = await ev.createDeepseekToolsEval({ ...s.deps, cases: ONE, fetches: [ev.FETCHES[1]] }).run();
    assert.strictEqual(s.tracked.length, 3);
    assert.ok(s.tracked.every(t => t.meta.provider === 'deepseek' && /^deepseek\/tools-(search|fetch)$/u.test(t.meta.model) && t.meta.bound.usd === 0.00075));
    assert.ok(s.tracked.every(t => t.error), 'all three failed');
    assert.match(r.search[0].deepseek[0].error, /402: Insufficient Balance/u);
    assert.match(r.fetch[0].error, /413/u);
    assert.strictEqual(r.summary.deepseekFound, 0);
    const m = require('../src/ai/model-pricing');
    assert.strictEqual(m.costForUsage('deepseek/tools-search', { billedRequests: 1 }).costUsd, 0.00075);
    assert.strictEqual(m.costForUsage('deepseek/tools-fetch', {}).costUsd, 0, 'a failed or empty request is not billed');
  });

  await test('a pinned act counts as found by address; no key: the call fails before any request', async () => {
    const s = stubs();
    s.deps.plan = async () => [{ kind: 'status-act-pinned', query: 'x', pinnedDocs: [{ url: 'https://lex.uz/docs/-4422250' }] }];
    const r = await ev.createDeepseekToolsEval({ ...s.deps, cases: [{ ...ONE[0], expect: { label: 'VMQ-589', docId: '4422250' } }], fetches: [] }).run();
    assert.strictEqual(r.search[0].ours.how, 'pinned');
    const n = stubs();
    const r2 = await ev.createDeepseekToolsEval({ ...n.deps, apiKey: '', cases: ONE, fetches: [] }).run();
    assert.strictEqual(n.calls.length, 0);
    assert.match(r2.search[0].deepseek[0].error, /DEEPSEEK_API_KEY sozlanmagan/u);
  });

  await test('the routes: master only, no-store, one run at a time, no key -> 503; Boshqaruv has the button', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /app\.get\('\/api\/admin\/deepseek-tools-eval', requireMasterAdmin,/u);
    assert.match(server, /app\.post\('\/api\/admin\/deepseek-tools-eval', requireMasterAdmin, async \(req, res\) => \{\n\s+res\.set\('Cache-Control', 'no-store'\);\n\s+if \(toolsEvalRunning\) return res\.status\(409\)/u);
    assert.match(server, /if \(!process\.env\.DEEPSEEK_API_KEY\) return res\.status\(503\)/u);
    assert.match(server, /httpGet\(lex\.buildLexSearchUrl\(q, \{ actForm \}\), 5, null, 2048 \* 1024\)/u, 'search pages only, size-capped');
    const admin = fs.readFileSync(path.join(__dirname, '../public/app/admin.js'), 'utf8');
    assert.match(admin, /\['sinov', 'spark', 'adm\.lab', 'tech'\]/u);
    assert.match(admin, /J\.api\('\/api\/admin\/deepseek-tools-eval', \{ method: 'POST' \}\)/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
})();
