'use strict';

/**
 * X8 of the 2026-11-10 audit on a real Postgres. G6: a da'vo arizasi ordered
 * in the bot by a linked account is an agent run (`claim_draft`, channel
 * telegram) - queued with its held unit, worked by the worker, taken over
 * after a worker that died without running finished steps again, delivered
 * by the Telegram notifier, its unit committed only when a draft came out.
 * G7: the run metrics count statuses, stop reasons, times and known cost and
 * never return a run's text. Stub AI, real tariff ledger. Needs
 * TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/agent-x8.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { summarize, reasonOf } = require('../src/agents/runs/metrics');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const T = s => new Date(Date.UTC(2026, 10, 11, 9, 0, s)).toISOString();
const R = (id, o) => ({ id, workflow: 'claim_draft', channel: 'telegram', status: 'done', attempts: 1, error: null, spent: { calls: 4, costUsd: 0.02, unknownCostCalls: 0 }, created_at: T(0), started_at: T(0), finished_at: T(60), ...o });

async function pure() {
  await test('metrics: success is done over ended runs; a cancel or a waiting run is not a failure; reasons are codes', () => {
    const { groups } = summarize([
      R('1'), R('2', { finished_at: T(40), spent: { calls: 6, costUsd: 0.04, unknownCostCalls: 1 } }),
      R('3', { status: 'failed', error: 'Pudratchi Aliyev: provider said no', spent: { calls: 2, costUsd: 0.01, unknownCostCalls: 0 }, finished_at: T(20), attempts: 2 }),
      R('4', { status: 'failed', error: 'attempts 3 of 3', spent: null }),
      R('5', { status: 'cancelled', error: 'cancelled', spent: null }),
      R('6', { status: 'budget', spent: { calls: 60, costUsd: 1, unknownCostCalls: 0 }, finished_at: T(59) }),
      R('7', { status: 'needs_input', spent: null, finished_at: null }),
      R('8', { status: 'queued', spent: null, started_at: null, finished_at: null }),
      R('9', { workflow: 'planned', channel: 'web', status: 'awaiting_approval', spent: null, started_at: null, finished_at: null }),
    ], [
      { run_id: '1', step_id: 'research', status: 'ok', ms: 900 }, { run_id: '2', step_id: 'research', status: 'ok', ms: 1100 },
      { run_id: '3', step_id: 'research', status: 'ok', ms: 1000 }, { run_id: '3', step_id: 'basis', status: 'failed', ms: 50 },
      { run_id: '1', step_id: 'extract_1', status: 'ok', ms: 10 }, { run_id: '1', step_id: 'extract_2', status: 'ok', ms: 30 },
      { run_id: 'x', step_id: 'ghost', status: 'ok', ms: 1 },
    ]);
    const g = groups[0];
    assert.deepStrictEqual([g.workflow, g.channel, g.runs, g.done, g.failed, g.cancelled, g.budget, g.needsInput, g.live, g.resumed], ['claim_draft', 'telegram', 8, 2, 2, 1, 1, 1, 1, 1]);
    assert.strictEqual(g.successPct, 40, 'done 2 of ended 5 (2 done, 2 failed, 1 limit)');
    assert.strictEqual(g.needsInputPct, 12.5);
    assert.deepStrictEqual(g.reasons, { error: 1, attempts: 1, cancelled: 1, limit: 1 });
    assert.deepStrictEqual(g.stoppedAt, { basis: 1 });
    assert.deepStrictEqual([g.costRuns, g.unknownCostRuns, g.avgKnownCostUsd, g.avgCalls], [4, 1, 0.2675, 18]);
    assert.deepStrictEqual([g.medianSec, g.p90Sec], [59, 60]);
    const research = g.steps.find(s => s.id === 'research'), extract = g.steps.find(s => s.id === 'extract');
    assert.deepStrictEqual([research.runs, research.failed, research.medianMs, extract.runs], [3, 0, 1000, 2], 'numbered parts of one step are one row');
    assert.ok(!JSON.stringify(groups).includes('Aliyev'), 'a stored error message never leaves');
    assert.deepStrictEqual([groups[1].workflow, groups[1].awaitingApproval, groups[1].successPct, groups[1].avgKnownCostUsd], ['planned', 1, null, null], 'no ended run: no share, no cost - never 0');
    assert.deepStrictEqual([reasonOf({ status: 'failed', error: '' }), reasonOf({ status: 'failed', error: 'Request timed out' }), reasonOf({ status: 'done' })], ['step_failed', 'timeout', null]);
  });

  await test('the bot: a linked account\'s claim is queued with a held unit; unlinked, test mode or a refused queue run in the bot as before', () => {
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /const queueClaim = o\.slug === 'claim' && !!claimAgent && !!claimRuns && !!who\.adminId;/u);
    assert.match(bot, /queueClaim \? \{ requestId: claimRequestId, meta: \{ holdUntil:/u, 'the unit is held past a deploy');
    assert.match(bot, /queueClaim && job\.jobKey \? \{ adminId: who\.adminId, requestId: claimRequestId \} : null/u, 'no job key (test mode, unlimited) is not queued');
    assert.match(bot, /workflow: 'claim_draft', channel: 'telegram', requestId: queue\.requestId/u);
    assert.match(bot, /not queued, running in the bot[\s\S]{0,200}r = await claimAgent\.runFacts\(prep\.facts, \{ onStep \}\)/u, 'a refused queue falls back, the fields are not read twice');
    const done = bot.slice(bot.indexOf('async function claimRunDone'), bot.indexOf("/** The person's answer to the agent's questions"));
    assert.ok(!/ledger\.(commit|release)/u.test(done), 'the worker settles a queued run; the notifier only delivers');
    assert.match(done, /Loyiha tayyor, lekin faylni bu yerga yuborib bo'lmadi\. U saqlangan/u);
    assert.match(bot, /progress: run => \(isClaimRun\(run\) \? claimRunProgress\(run\) : plannerRunNotifier\.progress\(run\)\)/u);
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /setClaimRuns\(\{ store: runStore, kick: runs\.kick \}\)/u);
    assert.match(server, /mountRunMetrics\(app, \{ requireMasterAdmin, pool \}\)/u);
  });
}

async function withDb() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const express = require('express');
  const { pool } = require('../src/database/db');
  const ledger = require('../src/rag/tariff-ledger');
  const { createRunStore } = require('../src/agents/runs/store');
  const { createRunWorker } = require('../src/agents/runs/worker');
  const notify = require('../src/agents/runs/notify');
  const { claimService, executorFor } = require('../src/agents/agent-routes');
  const tc = require('../src/agents/telegram-claim');
  const { mountRunMetrics } = require('../src/agents/runs/metrics');
  const rnd = () => Math.floor(Math.random() * 1e9);
  const users = [];
  const SOURCE = "Agar pudratchi ishni shartnomada belgilangan muddatda boshlamasa yoki bajarmasa, buyurtmachi shartnomani bajarishdan voz kechishga va zararni to'lashni talab qilishga haqli.";
  const STORY = "Da'vogar: Aliyev Vali, Toshkent. Javobgar: \"Qurilish Servis\" MChJ. 2026-yil 10-martda pudrat shartnomasi tuzildi, avans 12 000 000 so'm to'landi, ish boshlanmadi. Avansni undirishni so'rayman.";
  const FACTS = { plaintiff: { name: 'Aliyev Vali', details: 'Toshkent' }, defendant: { name: '"Qurilish Servis" MChJ' }, circumstances: STORY, demands: "12 000 000 so'm avansni undirish", amount: '12 000 000' };
  const calls = { research: 0, draft: 0 };
  let failDraft = false, hangDraft = false;
  const deps = {
    callCheapAI: async (m) => (/maydonlarini ajrating/u.test(m[0].text) ? { text: JSON.stringify(FACTS) } : { text: '{"caseType":"iqtisodiy","queries":["pudrat avans qaytarish"]}' }),
    callAI: async () => ({ text: JSON.stringify({ basis: [{ demand: 'avans', sourceId: 'S1', quote: SOURCE.slice(0, 110) }] }) }),
    retrieve: async () => { calls.research++; return { chunks: [{ law_name: 'Fuqarolik kodeksi', article_number_display: '637', chunk_text: SOURCE, source_url: 'https://lex.uz/docs/111181' }] }; },
    generateDraftHtml: async () => {
      calls.draft++;
      if (hangDraft) return new Promise(() => {});
      if (failDraft) throw new Error('generator down');
      return { html: "<p>Toshkent shahar iqtisodiy sudiga</p><p>Da'vogar: Aliyev Vali</p><p>Javobgar: Qurilish Servis</p><p>FK 637-moddasiga asosan 12 000 000 so'm undirilsin. SO'RAYMAN: avansni undirish. Ilovalar: shartnoma.</p>" };
    },
  };
  const makeUser = async () => {
    const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'X8 Test', 'user') RETURNING id`, [`x8_${Date.now()}_${rnd()}`]);
    users.push(r.rows[0].id);
    await ledger.grantPaidPeriod({ adminId: r.rows[0].id, plan: 'silver', paymentRef: `x8-${r.rows[0].id}-${rnd()}` });
    return r.rows[0].id;
  };
  const usage = async jobKey => (await pool.query('SELECT status, release_reason FROM tariff_usage WHERE job_key = $1', [jobKey])).rows[0];
  const store = createRunStore({ db: pool });
  const executors = { claim_draft: executorFor(claimService({ ...deps, ledger })) };
  const told = [];
  notify.setTelegramNotifier({ progress: async run => told.push(['progress', run.id]), done: async (run, status, result) => told.push(['done', run.id, status, result.body, run.input.telegram]) });

  /** What the bot does for a linked account: reserve with a hold, read the fields, queue. */
  async function order(adminId) {
    const requestId = require('crypto').randomUUID();
    const job = await ledger.reserve({ adminId, service: 'draft', units: 1, channel: 'telegram', endpoint: '/tg/draft', requestId, meta: { holdUntil: new Date(Date.now() + 45 * 60e3).toISOString() } });
    assert.ok(job.allowed && job.jobKey);
    const prep = await tc.createTelegramClaimAgent(deps).prepare(STORY);
    assert.deepStrictEqual(prep.missing, []);
    const run = await store.create({ adminId, workflow: 'claim_draft', channel: 'telegram', requestId, jobs: [{ jobKey: job.jobKey, service: 'draft' }],
      input: { input: prep.facts, ctx: {}, telegram: { chatId: 777000 + adminId, messageId: 5, kind: 'claim', docType: "Da'vo arizasi", details: STORY } } });
    return { run, job };
  }

  try {
    await test('a queued claim: the worker drafts it, commits the unit and the notifier gets the draft, the basis and where to send it', async () => {
      const u = await makeUser();
      const { run, job } = await order(u);
      assert.strictEqual((await usage(job.jobKey)).status, 'reserved');
      await createRunWorker({ store, executors, log: { warn() {} } }).drain();
      const end = await store.get(run.id, u);
      assert.strictEqual(end.status, 'done');
      assert.strictEqual((await usage(job.jobKey)).status, 'committed');
      const d = told.find(x => x[0] === 'done' && x[1] === run.id);
      assert.deepStrictEqual([d[2], d[4].chatId, d[4].kind, d[4].docType], ['done', 777000 + u, 'claim', "Da'vo arizasi"]);
      assert.match(d[3].draftHtml, /637-moddasiga/u);
      assert.strictEqual(d[3].basis[0].article, '637');
      assert.match(tc.resultText({ basis: d[3].basis, warnings: d[3].warnings, dropped: d[3].droppedQuotes }), /Fuqarolik kodeksi, 637-modda/u);
      assert.ok(told.some(x => x[0] === 'progress' && x[1] === run.id), 'the status message is updated as steps finish');
      const row = (await pool.query('SELECT input, channel FROM agent_runs WHERE id = $1', [run.id])).rows[0];
      assert.strictEqual(row.channel, 'telegram');
      assert.ok(!JSON.stringify(row.input || {}).includes('Aliyev'), 'the story and the chat are emptied when the run ends');
      const labels = (await pool.query('SELECT label FROM agent_run_steps WHERE run_id = $1 ORDER BY started_at', [run.id])).rows.map(r => r.label);
      assert.ok(labels.length >= 4 && labels.every(Boolean), 'the steps carry the labels the bot shows');
    });

    await test('a worker that died in the drafting step: another takes the run over, the search is not run again, the person still gets the file', async () => {
      const u = await makeUser();
      const { run, job } = await order(u);
      const before = calls.research;
      hangDraft = true;
      const dead = createRunWorker({ store, executors, log: { warn() {} }, leaseSec: 1, heartbeatMs: 60000 });
      dead.drain().catch(() => {});                      // never ends: the process "died" mid-draft
      for (let i = 0; i < 100 && !(await pool.query(`SELECT 1 FROM agent_run_steps WHERE run_id = $1 AND step_id = 'basis' AND status = 'ok'`, [run.id])).rows.length; i++) await new Promise(r => setTimeout(r, 50));
      assert.strictEqual(calls.research, before + 1);
      hangDraft = false;
      await new Promise(r => setTimeout(r, 1300));       // the lease runs out
      await createRunWorker({ store, executors, log: { warn() {} } }).drain();
      const end = await store.get(run.id, u);
      assert.deepStrictEqual([end.status, end.attempts >= 2], ['done', true]);
      assert.strictEqual(calls.research, before + 1, 'the finished search is a checkpoint');
      assert.strictEqual((await usage(job.jobKey)).status, 'committed');
      assert.ok(told.some(x => x[0] === 'done' && x[1] === run.id && x[2] === 'done'));
    });

    await test('a draft that did not come out: the unit goes back and the notifier is told it failed', async () => {
      const u = await makeUser();
      failDraft = true;
      const { run, job } = await order(u);
      await createRunWorker({ store, executors, log: { warn() {} } }).drain();
      failDraft = false;
      const end = await store.get(run.id, u);
      assert.notStrictEqual(end.status, 'done');
      assert.strictEqual((await usage(job.jobKey)).status, 'released');
      const d = told.find(x => x[0] === 'done' && x[1] === run.id);
      assert.ok(d && d[2] !== 'done' && !d[3].draftHtml);
    });

    await test('the metrics route: master only by its guard, groups by workflow and channel, no text of a run', async () => {
      const app = express();
      let allowed = false;
      mountRunMetrics(app, { requireMasterAdmin: (q, r, n) => (allowed ? n() : r.status(403).json({ error: 'forbidden' })), pool });
      const server = app.listen(0);
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        assert.strictEqual((await fetch(`${base}/api/admin/agent-runs/metrics`)).status, 403);
        allowed = true;
        const r = await fetch(`${base}/api/admin/agent-runs/metrics?days=1`);
        assert.strictEqual(r.headers.get('cache-control'), 'no-store');
        const data = await r.json();
        const g = data.groups.find(x => x.workflow === 'claim_draft' && x.channel === 'telegram');
        assert.ok(g && g.done >= 2 && g.failed + g.budget >= 1 && g.resumed >= 1, JSON.stringify(g));
        assert.ok(g.successPct > 0 && g.successPct < 100);
        assert.ok(g.steps.some(s => s.id === 'draft' && s.failed >= 1) && g.stoppedAt.draft >= 1, 'where runs stop is named');
        assert.ok(!/Aliyev|Qurilish|generator down/u.test(JSON.stringify(data)));
      } finally { server.close(); }
    });
  } finally {
    notify.setTelegramNotifier(null);
    for (const id of users) {
      await pool.query('DELETE FROM agent_runs WHERE admin_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM tariff_usage WHERE admin_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM tariff_periods WHERE admin_id = $1', [id]).catch(() => {});
      await pool.query('DELETE FROM admins WHERE id = $1', [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
}

(async () => {
  console.log('agent X8 (claim run in Telegram, run metrics)');
  await pure();
  if (!process.env.TEST_DATABASE_URL) console.log('  (db part skipped, TEST_DATABASE_URL not set)');
  else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like a hosted database'); process.exit(1); }
  else await withDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
