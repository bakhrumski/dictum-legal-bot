'use strict';

/**
 * The planner agent's routes on a real Postgres (2026-10-28, roadmap PR-D):
 * only a database master may plan (AGENT_PLANNER default); a plan waits for
 * approval with nothing reserved; approval reserves the price and queues the
 * run, the worker runs it, the unit is committed with the verified answer;
 * no units -> 402 and the plan keeps waiting; cancel ends a waiting plan;
 * another account cannot approve; with a matter the run is linked to it.
 * Stub AI and retrieval, real tariff ledger. Needs TEST_DATABASE_URL.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/agent-planner.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('agent planner (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const express = require('express');
const { pool } = require('../src/database/db');
const ledger = require('../src/rag/tariff-ledger');
const { createRunStore } = require('../src/agents/runs/store');
const { createRunWorker } = require('../src/agents/runs/worker');
const { mountRunRoutes } = require('../src/agents/runs/routes');
const { mountPlannerRoutes } = require('../src/agents/planner-routes');
const { createMatterStore } = require('../src/matters/store');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const users = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function makeUser({ role = 'user', plan = 'silver' } = {}) {
  const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Plan Test', $2) RETURNING id`, [`pt_${Date.now()}_${rnd()}`, role]);
  const id = r.rows[0].id;
  users.push(id);
  if (plan) await ledger.grantPaidPeriod({ adminId: id, plan, paymentRef: `pt-${id}-${rnd()}` });
  return id;
}

const PLAN = { goal: 'avans', nodes: [
  { id: 'n1', tool: 'lex_search', args: { query: 'pudrat shartnomasi avans qaytarish' }, after: [] },
  { id: 'n2', tool: 'answer', args: { question: 'Pudratchi avansni qaytarishi shartmi?' }, after: ['n1'] },
  { id: 'n3', tool: 'verify', args: {}, after: ['n2'] },
] };
const CHUNK = { id: 'c1', law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi", article_number_display: '642', source_url: 'https://lex.uz/docs/-180552#-642',
  chunk_text: "Pudratchi ishni shartnomada belgilangan muddatda boshlamasa, buyurtmachi shartnomani bajarishdan voz kechishga haqli." };
const ANSWER = "**Tahlil**\n\nPudratchi ishni boshlamasa, buyurtmachi shartnomadan voz kechishi mumkin ([Fuqarolik kodeksi, 642-modda](https://lex.uz/docs/-180552#-642)).\n\n**Xulosa**\n\nShartnomadan voz kechib, zararni talab qiling.";

(async () => {
  console.log('agent planner (db)');
  const store = createRunStore({ db: pool });
  const matters = createMatterStore({ db: pool, resolveEntitlement: ledger.resolveEntitlement });
  const calls = { plan: 0, answer: 0 };
  const callCheapAI = async (messages) => {
    if (/reja/u.test(messages[0].text)) { calls.plan++; return { text: JSON.stringify(PLAN) }; }
    return { text: '{"verdicts":[]}' };
  };
  const callAI = async () => { calls.answer++; return { text: ANSWER }; };
  let who = null, worker = null;
  const app = express();
  app.use(express.json());
  app.use((req, _r, next) => { req.session = { adminId: who }; next(); });
  const pass = (_q, _s, n) => n();
  const runs = { store, kick: () => worker && worker.tick() };
  const { executor } = mountPlannerRoutes(app, { requireAuth: pass, requireSameOrigin: pass, pool, ledger, runs, matters, callCheapAI,
    deps: { callAI, callCheapAI, retrieve: async () => ({ chunks: [CHUNK] }) } });
  mountRunRoutes(app, { requireAuth: pass, requireSameOrigin: pass, store, pollMs: 100 });
  worker = createRunWorker({ store, executors: { planned: executor }, pollMs: 100 });
  worker.start();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const waitDone = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = await call('GET', `/api/agent/runs/${id}`);
      if (r.body && ['done', 'failed', 'cancelled'].includes(r.body.status)) return r.body;
      await sleep(60);
    }
    return null;
  };

  try {
    await test('only a database master may plan by default', async () => {
      who = await makeUser();
      const r = await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?' });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(calls.plan, 0, 'no AI call for someone not allowed');
    });

    await test('plan -> waits with nothing reserved -> approve reserves and queues -> the worker answers -> the unit is committed', async () => {
      who = await makeUser({ role: 'master', plan: null });
      // a master is staff (unlimited): the test also covers a paid account below
      const m = await matters.create(who, { title: 'Pudrat nizosi' });
      const p = await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?', matterId: m.id });
      assert.strictEqual(p.status, 201, JSON.stringify(p.body));
      assert.deepStrictEqual([p.body.status, p.body.source, p.body.price], ['awaiting_approval', 'model', { chat: 1 }]);
      assert.deepStrictEqual(p.body.plan.nodes.map(n => n.label), ['Qonunchilikni qidirish (lex.uz)', 'Javob yozish (Tahlil va Xulosa)', "Javobni manbalar bilan tekshirish"]);
      await sleep(300);
      assert.strictEqual((await call('GET', `/api/agent/runs/${p.body.runId}`)).body.status, 'awaiting_approval', 'not started before approval');
      assert.strictEqual(calls.answer, 0);
      const linked = (await matters.get(m.id, who)).items.find(i => i.kind === 'agent_run');
      assert.ok(linked && linked.ref === p.body.runId, 'linked to the matter at once');
      const a = await call('POST', `/api/agent/runs/${p.body.runId}/approve`);
      assert.strictEqual(a.status, 200);
      const done = await waitDone(p.body.runId);
      assert.strictEqual(done.status, 'done', JSON.stringify(done && done.result));
      assert.match(done.result.body.answer, /Tahlil[\s\S]*Xulosa/u);
      assert.strictEqual(calls.answer, 1);
      assert.strictEqual((await call('POST', `/api/agent/runs/${p.body.runId}/approve`)).status, 409, 'approved once');
    });

    await test('a paid account (AGENT_PLANNER=gold excludes Silver; all lets it): the chat unit is reserved on approval and committed with the answer', async () => {
      who = await makeUser({ plan: 'silver' });
      process.env.AGENT_PLANNER = 'gold';
      assert.strictEqual((await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?' })).status, 403, 'Silver is not Gold');
      process.env.AGENT_PLANNER = 'all';
      const p = await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?' });
      const before = (await ledger.balance({ adminId: who })).services.chat.used;
      assert.strictEqual(before, 0, 'nothing reserved while waiting');
      assert.strictEqual((await call('POST', `/api/agent/runs/${p.body.runId}/approve`)).status, 200);
      const done = await waitDone(p.body.runId);
      assert.strictEqual(done.status, 'done');
      const row = (await pool.query(`SELECT status, meta FROM tariff_usage WHERE meta->>'runId' = $1`, [p.body.runId])).rows;
      assert.deepStrictEqual(row.map(x => x.status), ['committed']);
      assert.ok(row[0].meta.holdUntil, 'held for the run');
      assert.strictEqual((await ledger.balance({ adminId: who })).services.chat.used, 1);
    });

    await test('no units: 402 and the plan keeps waiting; cancel ends it; another account cannot approve or see it', async () => {
      who = await makeUser({ plan: null });
      await pool.query(`UPDATE tariff_periods SET limits = '{"chat":0,"analysis":0,"opinion":0,"draft":0}'::jsonb WHERE admin_id = $1`, [who]).catch(() => {});
      const p = await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?' });
      assert.strictEqual(p.status, 201);
      const own = who;
      who = await makeUser();
      assert.strictEqual((await call('POST', `/api/agent/runs/${p.body.runId}/approve`)).status, 404);
      assert.strictEqual((await call('GET', `/api/agent/runs/${p.body.runId}`)).status, 404);
      who = own;
      // spend the trial's chat units first
      for (let i = 0; i < 10; i++) {
        const j = await ledger.reserve({ adminId: who, service: 'chat', units: 1, endpoint: '/test' });
        if (!j.allowed) break;
        await ledger.commit(j.jobKey);
      }
      const a = await call('POST', `/api/agent/runs/${p.body.runId}/approve`);
      assert.strictEqual(a.status, 402);
      assert.strictEqual((await call('GET', `/api/agent/runs/${p.body.runId}`)).body.status, 'awaiting_approval');
      const c = await call('POST', `/api/agent/runs/${p.body.runId}/cancel`);
      assert.strictEqual(c.body.status, 'cancelled');
      assert.strictEqual((await call('POST', `/api/agent/runs/${p.body.runId}/approve`)).status, 409);
    });

    await test('a plan nobody approves in 24 hours ends', async () => {
      who = await makeUser();
      const p = await call('POST', '/api/agent/plan', { task: 'Pudratchi avansni qaytarmayapti, nima qilay?' });
      await pool.query(`UPDATE agent_runs SET created_at = now() - interval '25 hours' WHERE id = $1`, [p.body.runId]);
      await store.sweep();
      const r = await call('GET', `/api/agent/runs/${p.body.runId}`);
      assert.deepStrictEqual([r.body.status, r.body.error], ['cancelled', 'approval_expired']);
    });
  } finally {
    delete process.env.AGENT_PLANNER;
    server.close();
    await worker.stop();
  }

  for (const id of users) {
    await pool.query('DELETE FROM matter_items WHERE added_by = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM matters WHERE owner_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM agent_runs WHERE admin_id = $1', [id]).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})();
