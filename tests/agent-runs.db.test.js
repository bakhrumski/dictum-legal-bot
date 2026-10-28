'use strict';

/**
 * Agent runs on a real Postgres (2026-10-28, PR-B: migration 020,
 * src/agents/runs/, the harness checkpoints). A run is queued, taken under
 * a lease, checkpointed per step; a run whose worker died is taken over
 * and resumes without running its finished steps again; a run tried too
 * often fails and its units go back; a cancel stops it; one account runs
 * one at a time; the input and step outputs are emptied at the end; the
 * playbook route answers through a run in its old shape. Stub AI, real
 * tariff ledger. Needs TEST_DATABASE_URL (throwaway) with the migrations
 * applied - CI runs it after the boot smoke.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/agent-runs.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('agent runs (db): skipped, TEST_DATABASE_URL not set');
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
const usageLedger = require('../src/ai/usage-ledger');
const { runWorkflow } = require('../src/agents/harness');
const { createRunStore } = require('../src/agents/runs/store');
const { createRunWorker } = require('../src/agents/runs/worker');
const { mountRunRoutes } = require('../src/agents/runs/routes');
const { mountPlaybookRoutes } = require('../src/agents/agent-routes');
const pb = require('../src/agents/workflows/playbook-review');
const { createMatterStore } = require('../src/matters/store');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const users = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function makeUser(plan = 'silver') {
  const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Run Test', 'user') RETURNING id`, [`rt_${Date.now()}_${rnd()}`]);
  const id = r.rows[0].id;
  users.push(id);
  if (plan) await ledger.grantPaidPeriod({ adminId: id, plan, paymentRef: `rt-${id}-${rnd()}` });
  return id;
}
const usageRow = async (jobKey) => (await pool.query('SELECT status, release_reason, meta FROM tariff_usage WHERE job_key = $1', [jobKey])).rows[0];

/** A three-step workflow whose steps count their runs; `hang` makes a step never end (a worker that died). */
function countingService(counts, { hang = null, fail = null } = {}) {
  const wf = {
    id: 'test_flow',
    steps: ['a', 'b', 'c'].map(id => ({
      id, label: `Qadam ${id}`,
      run: async (state) => {
        counts[id] = (counts[id] || 0) + 1;
        if (hang === id) return new Promise(() => {});
        if (fail === id) throw new Error(`${id} buzildi`);
        return { value: `${id}:${state.input.x}`, prev: id === 'a' ? null : state.steps[id === 'b' ? 'a' : 'b'].value };
      },
    })),
  };
  return {
    async execute(run, opts) {
      const out = await runWorkflow(wf, run.input.input, { budget: { maxSteps: 5, maxMs: 60000 }, ...opts });
      for (const j of run.jobs) {
        if (out.status === 'done') await ledger.commit(j.jobKey); else await ledger.release(j.jobKey, `test_${out.status}`);
      }
      return { status: out.status, httpStatus: out.status === 'done' ? 200 : 502, body: { status: out.status, last: out.state.steps.c || null, trace: out.trace } };
    },
    async abort(run, reason) {
      for (const j of run.jobs) await ledger.release(j.jobKey, `test_${reason}`);
      return { httpStatus: 502, body: { status: 'failed', reason } };
    },
  };
}

async function queueRun(store, adminId, x = 1) {
  const requestId = require('crypto').randomUUID();
  const job = await ledger.reserve({ adminId, service: 'chat', units: 1, endpoint: '/test', meta: { holdUntil: new Date(Date.now() + 45 * 60e3).toISOString() }, requestId });
  assert.ok(job.allowed && job.jobKey);
  return store.create({ adminId, workflow: 'test_flow', input: { input: { x }, ctx: {} }, jobs: [{ jobKey: job.jobKey }], requestId });
}

(async () => {
  console.log('agent runs (db)');
  const store = createRunStore({ db: pool });

  await test('a run is queued, worked, checkpointed, settled; input and step outputs are emptied at the end', async () => {
    const user = await makeUser();
    const counts = {};
    const run = await queueRun(store, user, 7);
    const w = createRunWorker({ store, executors: { test_flow: countingService(counts) } });
    await w.drain();
    const got = await store.get(run.id, user);
    assert.strictEqual(got.status, 'done');
    assert.deepStrictEqual(got.result.body.last, { value: 'c:7', prev: 'b:7' });
    assert.deepStrictEqual(got.steps.map(s => [s.id, s.status]), [['a', 'ok'], ['b', 'ok'], ['c', 'ok']]);
    const raw = (await pool.query('SELECT input, attempts, lease_owner FROM agent_runs WHERE id = $1', [run.id])).rows[0];
    assert.deepStrictEqual([raw.input, raw.attempts, raw.lease_owner], [null, 1, null]);
    const outs = (await pool.query('SELECT count(*)::int AS n FROM agent_run_steps WHERE run_id = $1 AND output IS NOT NULL', [run.id])).rows[0].n;
    assert.strictEqual(outs, 0, 'no document text left in the checkpoints');
    assert.strictEqual((await usageRow(run.jobs[0].jobKey)).status, 'committed');
    assert.ok((await usageRow(run.jobs[0].jobKey)).meta.holdUntil, 'the reservation was held for the run');
    assert.strictEqual(await store.get(run.id, await makeUser(null)), null, "another account's run is not found");
  });

  await test('a deploy mid-run: the dead worker\'s run is taken over after its lease and finished steps are not run again', async () => {
    const user = await makeUser();
    const counts = {};
    const run = await queueRun(store, user, 3);
    const dead = createRunWorker({ store, executors: { test_flow: countingService(counts, { hang: 'b' }) }, workerId: 'dead-worker' });
    dead.start();
    for (let i = 0; i < 50 && !counts.b; i++) await sleep(20);
    assert.deepStrictEqual(counts, { a: 1, b: 1 }, 'step a done, b hanging');
    await dead.stop();
    // the lease runs out (the process is gone)
    await pool.query(`UPDATE agent_runs SET lease_until = now() - interval '1 second' WHERE id = $1`, [run.id]);
    const next = createRunWorker({ store, executors: { test_flow: countingService(counts) }, workerId: 'next-worker' });
    await next.drain();
    const got = await store.get(run.id, user);
    assert.strictEqual(got.status, 'done');
    assert.strictEqual(counts.a, 1, 'step a was resumed from its checkpoint, not run again');
    assert.strictEqual(counts.b, 2, 'the interrupted step runs again');
    assert.deepStrictEqual(got.result.body.last, { value: 'c:3', prev: 'b:3' });
    assert.ok(got.result.body.trace.find(t => t.id === 'a').resumed);
    assert.strictEqual((await pool.query('SELECT attempts FROM agent_runs WHERE id = $1', [run.id])).rows[0].attempts, 2);
    assert.strictEqual(await store.heartbeat(run.id, 'dead-worker'), false, 'the old worker no longer holds it');
  });

  await test('a run tried more than 3 times fails and its units go back', async () => {
    const user = await makeUser();
    const run = await queueRun(store, user);
    await pool.query(`UPDATE agent_runs SET status = 'running', attempts = 3, lease_until = now() - interval '1 second' WHERE id = $1`, [run.id]);
    const counts = {};
    await createRunWorker({ store, executors: { test_flow: countingService(counts) } }).drain();
    const got = await store.get(run.id, user);
    assert.strictEqual(got.status, 'failed');
    assert.match(got.error, /attempts 3 of 3/u);
    assert.deepStrictEqual(counts, {}, 'nothing ran');
    const u = await usageRow(run.jobs[0].jobKey);
    assert.deepStrictEqual([u.status, u.release_reason], ['released', 'test_attempts 3 of 3']);
  });

  await test('cancel: a queued run ends with its units released; a running one stops before its next step', async () => {
    const user = await makeUser();
    const queued = await queueRun(store, user);
    await store.requestCancel(queued.id, user);
    const w = createRunWorker({ store, executors: { test_flow: countingService({}) } });
    await w.drain();
    assert.strictEqual((await store.get(queued.id, user)).status, 'cancelled');
    assert.strictEqual((await usageRow(queued.jobs[0].jobKey)).status, 'released');

    const user2 = await makeUser();
    const running = await queueRun(store, user2);
    const counts = {};
    const svc = countingService(counts);
    const slow = { ...svc, execute: (run, opts) => svc.execute(run, { ...opts, onCheckpoint: async (e, o) => { await opts.onCheckpoint(e, o); if (e.id === 'a') await store.requestCancel(run.id, user2); } }) };
    await createRunWorker({ store, executors: { test_flow: slow } }).drain();
    const got = await store.get(running.id, user2);
    assert.strictEqual(got.status, 'cancelled');
    assert.deepStrictEqual(counts, { a: 1 }, 'b and c never started');
    assert.strictEqual((await usageRow(running.jobs[0].jobKey)).status, 'released');
    assert.strictEqual(await store.requestCancel(running.id, user), null, "another account cannot cancel it");
  });

  await test('one account runs one at a time; another account is not held up', async () => {
    const a = await makeUser(), b = await makeUser();
    const r1 = await queueRun(store, a), r2 = await queueRun(store, a), r3 = await queueRun(store, b);
    const c1 = await store.claim('w1');
    const c2 = await store.claim('w2');
    const c3 = await store.claim('w3');
    const mine = [c1, c2, c3].filter(Boolean).map(r => r.id);
    assert.ok(mine.includes(r1.id) && mine.includes(r3.id), 'the first of a and the one of b');
    assert.ok(!mine.includes(r2.id), "a's second run waits for its first");
    for (const id of mine) await store.finish(id, { status: 'failed', force: true });
    await store.finish(r2.id, { status: 'failed', force: true });
  });

  await test('a run works in its own usage request with the run budget (60 calls, 15 min, $1)', async () => {
    const user = await makeUser();
    const run = await queueRun(store, user);
    let seen = null;
    const ex = { execute: async (r) => { const st = usageLedger.current(); seen = { requestId: st.requestId, budget: st.budget }; await ledger.commit(r.jobs[0].jobKey); return { status: 'done', httpStatus: 200, body: {} }; }, abort: async () => ({}) };
    await createRunWorker({ store, executors: { test_flow: ex } }).drain();
    assert.strictEqual(seen.requestId, run.request_id);
    assert.deepStrictEqual([seen.budget.maxCalls, seen.budget.maxMs, seen.budget.maxCostUsd], [60, 900000, 1]);
  });

  await test('the playbook route answers through a run in its old shape (+ runId); async gives 202 and the run can be followed', async () => {
    const user = await makeUser();
    const other = await makeUser(null);
    let who = user;
    const AI = [
      { id: 'r1', status: 'farq', quote: "Narx yetkazib beruvchi tomonidan bir tomonlama o'zgartirilishi mumkin.", note: 'x', suggestion: 'y' },
      { id: 'r2', status: 'mos', quote: 'Tovar shartnoma imzolangan kundan boshlab 30 kalendar kun ichida yetkazib beriladi.', note: 'x', suggestion: '' },
    ];
    const CONTRACT = "[Sahifa 1]\nYETKAZIB BERISH SHARTNOMASI\n2.1. Narx yetkazib beruvchi tomonidan bir tomonlama o'zgartirilishi mumkin.\n[Sahifa 2]\n3.1. Tovar shartnoma imzolangan kundan boshlab 30 kalendar kun ichida yetkazib beriladi.\n" + 'Qo‘shimcha shartlar. '.repeat(20);
    const app = express();
    app.use(express.json());
    app.use((req, _r, next) => { req.session = { adminId: who }; next(); });
    let worker = null;
    const runs = { store, kick: () => worker && worker.tick(), pollMs: 100 };
    const { executor } = mountPlaybookRoutes(app, { requireAuth: (_q, _s, n) => n(), requireSameOrigin: (_q, _s, n) => n(), callAI: async () => ({ text: JSON.stringify({ results: AI }) }), ledger, pool, runs });
    mountRunRoutes(app, { requireAuth: (_q, _s, n) => n(), requireSameOrigin: (_q, _s, n) => n(), store, pollMs: 100 });
    worker = createRunWorker({ store, executors: { playbook_review: executor }, pollMs: 100 });
    worker.start();
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    try {
      const sync = await call('POST', '/api/agent/playbook-review', { text: CONTRACT, name: 'Shartnoma', builtin: 'supply_buyer' });
      assert.strictEqual(sync.status, 200);
      assert.ok(sync.body.runId);
      assert.strictEqual(sync.body.status, 'done');
      assert.ok(Array.isArray(sync.body.results) && sync.body.results.find(r => r.id === 'r1').verified);
      assert.strictEqual(sync.body.charged, true);
      assert.strictEqual(sync.body.units, 1);
      const used = await ledger.balance({ adminId: user });
      assert.strictEqual(used.services.analysis.used, 1, 'one analysis unit committed');

      const queued = await call('POST', '/api/agent/playbook-review', { text: CONTRACT, builtin: 'supply_buyer', async: true });
      assert.strictEqual(queued.status, 202);
      let followed = null;
      for (let i = 0; i < 100; i++) {
        followed = await call('GET', `/api/agent/runs/${queued.body.runId}`);
        if (followed.body && followed.body.status === 'done') break;
        await sleep(50);
      }
      assert.strictEqual(followed.body.status, 'done');
      assert.strictEqual(followed.body.result.httpStatus, 200);
      assert.deepStrictEqual(followed.body.steps.map(s => s.id), ['validate', 'excerpt', 'review', 'verify']);
      assert.strictEqual(followed.body.input, undefined, 'the input is never returned');

      // a matter links the run's result
      const matters = createMatterStore({ db: pool, resolveEntitlement: ledger.resolveEntitlement });
      const m = await matters.create(user, { title: 'Yetkazib berish' });
      const item = await matters.addItem(m.id, user, { kind: 'agent_run', ref: queued.body.runId });
      assert.strictEqual(item.title, 'Playbook tekshiruvi');
      const linked = (await matters.get(m.id, user)).items.find(i => i.kind === 'agent_run');
      assert.deepStrictEqual([linked.available, linked.workflow, linked.status], [true, 'playbook_review', 'done']);

      who = other;
      assert.strictEqual((await call('GET', `/api/agent/runs/${queued.body.runId}`)).status, 404);
      assert.strictEqual((await call('POST', `/api/agent/runs/${queued.body.runId}/cancel`)).status, 404);
      await assert.rejects(matters.addItem(m.id, user, { kind: 'agent_run', ref: '00000000-0000-0000-0000-000000000000' }), e => e.status === 404);
    } finally {
      server.close();
      await worker.stop();
    }
  });

  await test('AGENT_RUNS=off: the route runs in the request (no run row)', async () => {
    const user = await makeUser();
    process.env.AGENT_RUNS = 'off';
    try {
      const app = express();
      app.use(express.json());
      app.use((req, _r, next) => { req.session = { adminId: user }; next(); });
      mountPlaybookRoutes(app, { requireAuth: (_q, _s, n) => n(), requireSameOrigin: (_q, _s, n) => n(), callAI: async () => ({ text: JSON.stringify({ results: [] }) }), ledger, pool, runs: { store } });
      const server = app.listen(0);
      try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/agent/playbook-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Shartnoma matni. '.repeat(40), builtin: 'nda' }) });
        const body = await r.json();
        assert.strictEqual(body.runId, undefined);
        assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM agent_runs WHERE admin_id = $1', [user])).rows[0].n, 0);
      } finally { server.close(); }
    } finally { delete process.env.AGENT_RUNS; }
  });

  await test('results past 90 days are emptied unless a matter links the run', async () => {
    const user = await makeUser();
    const a = await queueRun(store, user), b = await queueRun(store, user);
    for (const r of [a, b]) await store.finish(r.id, { status: 'done', result: { httpStatus: 200, body: { x: 1 } }, force: true });
    await pool.query(`UPDATE agent_runs SET expires_at = now() - interval '1 day' WHERE id = ANY($1)`, [[a.id, b.id]]);
    const matters = createMatterStore({ db: pool, resolveEntitlement: ledger.resolveEntitlement });
    const m = await matters.create(user, { title: 'Saqlanadigan' });
    await matters.addItem(m.id, user, { kind: 'agent_run', ref: a.id });
    await store.sweep();
    assert.ok((await store.get(a.id, user)).result, 'kept: a matter links it');
    assert.strictEqual((await store.get(b.id, user)).result, null, 'emptied');
  });

  for (const id of users) {
    await pool.query('DELETE FROM matter_items WHERE added_by = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM matters WHERE owner_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM agent_runs WHERE admin_id = $1', [id]).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})();
