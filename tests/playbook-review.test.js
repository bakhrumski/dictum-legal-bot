'use strict';

/**
 * Playbook review (2026-10-22): rules normalised, built-ins phrased as one
 * side's preferences, "mos" never claimed without the contract's own words,
 * pages from the marks, own playbooks only, charging by the contract's size
 * in analysis units. Fake database and stub AI - no network.
 *
 *   node tests/playbook-review.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runWorkflow } = require('../src/agents/harness');
const pb = require('../src/agents/workflows/playbook-review');
const { mountPlaybookRoutes } = require('../src/agents/agent-routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CONTRACT = "[Sahifa 1]\nYETKAZIB BERISH SHARTNOMASI\n1.1. Yetkazib beruvchi tovarni yetkazib beradi, xaridor qabul qiladi va haqini to'laydi.\n2.1. Narx yetkazib beruvchi tomonidan bir tomonlama o'zgartirilishi mumkin.\n[Sahifa 2]\n3.1. Tovar shartnoma imzolangan kundan boshlab 30 kalendar kun ichida yetkazib beriladi.\n6.1. Nizolar yetkazib beruvchi joylashgan joydagi sudda ko'riladi.\n" + 'Qo‘shimcha shartlar. '.repeat(20);
const RULES = pb.BUILTIN.supply_buyer.rules;

function stub(results) {
  const calls = [];
  return { calls, callAI: async (m) => { calls.push(m); return { text: JSON.stringify({ results }) }; } };
}
const AI_RESULTS = [
  { id: 'r1', status: 'farq', quote: "Narx yetkazib beruvchi tomonidan bir tomonlama o'zgartirilishi mumkin.", note: 'Narxni bir tomon o‘zgartira oladi.', suggestion: "Shartnoma narxi faqat tomonlarning yozma qo'shimcha kelishuvi bilan o'zgartiriladi." },
  { id: 'r2', status: 'mos', quote: 'Tovar shartnoma imzolangan kundan boshlab 30 kalendar kun ichida yetkazib beriladi.', note: 'Muddat aniq.', suggestion: '' },
  { id: 'r3', status: 'yoq', quote: '', note: 'Penya bandi yo‘q.', suggestion: 'Penya bandini qo‘shing.' },
  { id: 'r4', status: 'mos', quote: 'Kafolat muddati 12 oy.', note: 'Kafolat bor.', suggestion: '' },
];

(async () => {
  await test('rules: normalised (title, requirement, severity), at most 20; built-ins are preferences of one side, not statements of law', () => {
    const r = pb.normRules([{ title: 'ab', requirement: 'qisqa' }, { title: 'Narx', requirement: "Narx o'zgarmaydi deb yozilgan", severity: 'x' }]);
    assert.deepStrictEqual(r.map(x => [x.id, x.severity]), [['r1', 'medium']]);
    assert.strictEqual(pb.normRules(Array.from({ length: 25 }, () => ({ title: 'Qoida', requirement: 'Talab matni uzunroq' }))).length, 20);
    const list = pb.builtinList();
    assert.deepStrictEqual(list.map(x => x.key), ['supply_buyer', 'lease_tenant', 'employment_employer', 'nda']);
    const all = JSON.stringify(pb.BUILTIN);
    assert.doesNotMatch(all, /qonunga ko'ra|qonun talab|majburiy hisoblanadi|kodeksining/iu, 'no claims about the law');
    for (const p of list) assert.ok(p.rules.length >= 5 && p.rules.every(r => r.requirement.length >= 10), p.key);
  });

  await test('review: a found quote keeps its status and page; "mos" without the contract\'s own words becomes "noaniq"', async () => {
    const ai = stub(AI_RESULTS);
    const r = await runWorkflow(pb.createPlaybookReviewWorkflow(), { text: CONTRACT, name: 'Shartnoma', rules: RULES }, { deps: ai });
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(ai.calls.length, 1, 'one AI call for all rules');
    const res = new Map(r.state.steps.verify.results.map(x => [x.id, x]));
    assert.deepStrictEqual([res.get('r1').status, res.get('r1').verified, res.get('r1').page], ['farq', true, 1]);
    assert.deepStrictEqual([res.get('r2').status, res.get('r2').page], ['mos', 2]);
    assert.strictEqual(res.get('r3').status, 'yoq');
    assert.strictEqual(res.get('r4').status, 'noaniq', 'a quote not in the contract cannot prove "mos"');
    assert.match(res.get('r4').note, /topilmadi/u);
    assert.strictEqual(res.get('r5').status, 'noaniq', 'a rule the model skipped is noaniq');
    assert.strictEqual(r.state.steps.verify.downgraded, 1);
    assert.deepStrictEqual(r.state.steps.verify.counts, { mos: 1, farq: 1, yoq: 1, noaniq: 5 });
  });

  await test('review: missing contract or rules halt before AI; non-JSON from the model fails the run', async () => {
    const ai = stub(AI_RESULTS);
    const r = await runWorkflow(pb.createPlaybookReviewWorkflow(), { text: 'qisqa', rules: [] }, { deps: ai });
    assert.strictEqual(r.status, 'needs_input');
    assert.strictEqual(ai.calls.length, 0);
    const bad = await runWorkflow(pb.createPlaybookReviewWorkflow(), { text: CONTRACT, rules: RULES }, { deps: { callAI: async () => ({ text: 'kechirasiz' }) } });
    assert.deepStrictEqual([bad.status, bad.stoppedAt], ['failed', 'review']);
  });

  function harness({ allowed = true, own = [] } = {}) {
    const routes = {}, ledgerCalls = [], dbCalls = [];
    const app = {}; for (const m of ['get', 'post', 'put', 'delete']) app[m] = (p, ...fns) => { routes[`${m} ${p}`] = fns[fns.length - 1]; };
    const pool = { async query(sql, p) { dbCalls.push([sql, p]);
      if (/SELECT rules FROM playbooks WHERE id = \$1 AND admin_id = \$2/u.test(sql)) return { rows: own.filter(x => x.id === p[0] && x.admin_id === p[1]) };
      if (/SELECT id, name, description, rules, updated_at FROM playbooks WHERE admin_id/u.test(sql)) return { rows: own.filter(x => x.admin_id === p[0]) };
      if (/COUNT\(\*\)/u.test(sql)) return { rows: [{ n: 0 }] };
      if (/INSERT INTO playbooks/u.test(sql)) return { rows: [{ id: 9, name: p[1], rules: JSON.parse(p[3]) }] };
      return { rows: [], rowCount: 0 }; } };
    const ai = stub(AI_RESULTS);
    mountPlaybookRoutes(app, { requireAuth: () => {}, requireSameOrigin: () => {}, callAI: ai.callAI, pool, ledger: {
      docUnits: ({ chars }) => ({ units: Math.max(1, Math.ceil(chars / 40000)) }),
      reserve: async (o) => { ledgerCalls.push(['reserve', o.service, o.units]); return allowed ? { allowed: true, jobKey: 'j' } : { allowed: false }; },
      commit: async (k) => ledgerCalls.push(['commit', k]), release: async (k, w) => ledgerCalls.push(['release', k, w]) } });
    const call = async (key, body, params = {}) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } }; await routes[key]({ body, params, session: { adminId: 5 } }, res); return res; };
    return { call, ledgerCalls, dbCalls, ai };
  }

  await test('route: built-in or the caller\'s own playbook only; another account\'s playbook is not found', async () => {
    let h = harness({ own: [{ id: 3, admin_id: 7, rules: RULES }] });
    let res = await h.call('post /api/agent/playbook-review', { text: CONTRACT, playbookId: 3 });
    assert.strictEqual(res.code, 404);
    assert.deepStrictEqual(h.ledgerCalls, []);
    h = harness({ own: [{ id: 3, admin_id: 5, rules: RULES }] });
    res = await h.call('post /api/agent/playbook-review', { text: CONTRACT, playbookId: 3 });
    assert.strictEqual(res.code, 200);
    res = await h.call('post /api/agent/playbook-review', { text: CONTRACT, builtin: 'nope' });
    assert.strictEqual(res.code, 404);
    const list = await h.call('get /api/playbooks', {});
    assert.strictEqual(list.body.builtin.length, 4);
    assert.strictEqual(list.body.mine.length, 1);
  });

  await test('route: analysis units by the contract\'s size (page marks not counted), committed on a result; 402 and 422 before any AI', async () => {
    let h = harness();
    let res = await h.call('post /api/agent/playbook-review', { text: CONTRACT, builtin: 'supply_buyer' });
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(h.ledgerCalls, [['reserve', 'analysis', 1], ['commit', 'j']]);
    assert.strictEqual(res.body.results.length, RULES.length);
    const big = '[Sahifa 1]\n' + 'Matn bandi. '.repeat(7000);
    h = harness();
    await h.call('post /api/agent/playbook-review', { text: big, builtin: 'nda' });
    assert.deepStrictEqual(h.ledgerCalls[0], ['reserve', 'analysis', 3]);
    h = harness({ allowed: false });
    res = await h.call('post /api/agent/playbook-review', { text: CONTRACT, builtin: 'supply_buyer' });
    assert.strictEqual(res.code, 402);
    assert.strictEqual(h.ai.calls.length, 0);
    h = harness();
    res = await h.call('post /api/agent/playbook-review', { text: CONTRACT });
    assert.strictEqual(res.code, 422);
    assert.deepStrictEqual(h.ledgerCalls, []);
  });

  await test('own playbooks: created with normalised rules; update and delete only by owner (admin_id in the WHERE)', async () => {
    const h = harness();
    const res = await h.call('post /api/playbooks', { name: 'Firma qoidalari', rules: [{ title: 'Narx', requirement: "Narx o'zgarmaydi deb yozilgan", severity: 'high' }] });
    assert.strictEqual(res.code, 201);
    assert.deepStrictEqual(res.body.rules, [{ title: 'Narx', requirement: "Narx o'zgarmaydi deb yozilgan", severity: 'high', preferred: '' }]);
    assert.strictEqual((await h.call('post /api/playbooks', { name: 'x', rules: [] })).code, 400);
    await h.call('put /api/playbooks/:id', { name: 'Yangi nom', rules: [{ title: 'Narx', requirement: "Narx o'zgarmaydi deb yozilgan" }] }, { id: '9' });
    await h.call('delete /api/playbooks/:id', {}, { id: '9' });
    const writes = h.dbCalls.filter(([sql]) => /^(UPDATE|DELETE)/u.test(sql.trim()));
    assert.ok(writes.length === 2 && writes.every(([sql]) => /admin_id = \$2/u.test(sql)));
    assert.ok(fs.existsSync(path.join(__dirname, '../migrations/down/20261022_018_playbooks.down.sql')));
  });

  await test('scans: a scanned contract uses the analysis units its OCR step held (no second charge)', async () => {
    const SCAN = '11111111-2222-3333-4444-555555555555';
    const routes = {}, calls = [];
    const app = {}; for (const m of ['get', 'post', 'put', 'delete']) app[m] = (p, ...fns) => { routes[`${m} ${p}`] = fns[fns.length - 1]; };
    const pool = { async query(sql, p) { return { rows: /document_scans/u.test(sql) && p[0] === SCAN && p[1] === 5 ? [{ id: SCAN, text: CONTRACT.replace('[Sahifa 1]', '=== PAGE 1 ===').replace('[Sahifa 2]', '=== PAGE 2 ==='), pages: 2, file_hash: 'fh' }] : [] }; } };
    mountPlaybookRoutes(app, { requireAuth: () => {}, requireSameOrigin: () => {}, callAI: stub(AI_RESULTS).callAI, pool, ledger: {
      docUnits: () => ({ units: 1 }),
      heldScanJob: async (o) => { calls.push(['held', o.fileHash, o.service]); return { job_key: 'held1', units: 1 }; },
      reserve: async () => { calls.push(['reserve']); return { allowed: true, jobKey: 'new' }; },
      commit: async (k) => calls.push(['commit', k]), release: async (k) => calls.push(['release', k]) } });
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes['post /api/agent/playbook-review']({ body: { scanId: SCAN, builtin: 'supply_buyer' }, params: {}, session: { adminId: 5 } }, res);
    assert.strictEqual(res.code, 200);
    assert.deepStrictEqual(calls, [['held', 'fh', 'analysis'], ['commit', 'held1']]);
    const r2 = res.body.results.find(x => x.id === 'r2');
    assert.strictEqual(r2.page, 2, 'page from the OCR marks');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
