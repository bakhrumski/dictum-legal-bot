#!/usr/bin/env node
'use strict';

/**
 * The planner agent's evaluation (2026-10-28, roadmap PR-G,
 * docs/quality/agent-eval.md). Never loaded by the server.
 *
 * Dry run (default, no network): checks the case file and prints the run
 * sha and the most it may cost.
 *
 *   node scripts/agent-eval.js [--cases docs/quality/agent-eval/cases.json] [--only A01,A05] [--max-cases N]
 *
 * Live: runs each case through a RUNNING server's own API as a master
 * account - POST /api/agent/plan, /approve, follow /api/agent/runs/:id, and
 * for a case that expects a question, /input with the case's answer - so
 * every AI call is metered, limited and recorded by the server as for any
 * user (each run under its $1 / 15 min / 60 calls limit, AGENT_RUN_MAX_*).
 * It needs AGENT_EVAL_LIVE=yes, --live and --approve <the sha the dry run
 * printed>: the sha covers the cases, the base URL and the case count, so an
 * approval holds for exactly that run.
 *
 *   AGENT_EVAL_LIVE=yes AGENT_EVAL_COOKIE='<session cookie>' \
 *     node scripts/agent-eval.js --live --base https://juristai.uz --approve <sha> --out <dir>
 *
 * The report (<out>/agent-eval-<date>.json and .md) holds the scores, the
 * plans, the sources and the answers - kept outside the repository.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scoreRun, summarize } = require('./lib/agent-eval-score');

const RUN_MAX_USD = Number(process.env.AGENT_RUN_MAX_COST_USD) || 1;

function args(argv = process.argv.slice(2)) {
  const a = { cases: path.join(__dirname, '../docs/quality/agent-eval/cases.json'), live: false, base: 'http://localhost:3000', out: null, only: null, maxCases: null, approve: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--cases') a.cases = argv[++i];
    else if (k === '--base') a.base = String(argv[++i]).replace(/\/+$/u, '');
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--only') a.only = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--max-cases') a.maxCases = Number(argv[++i]);
    else if (k === '--approve') a.approve = argv[++i];
  }
  return a;
}

/** The case file as the runner uses it; throws on a bad file. */
function loadCases(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set();
  for (const c of data.cases || []) {
    if (!/^[A-Z]\d{2}$/u.test(c.id || '') || ids.has(c.id)) throw new Error(`bad or repeated id: ${c.id}`);
    ids.add(c.id);
    if (String(c.task || '').trim().length < 10) throw new Error(`${c.id}: task too short`);
    if (!c.expect || !Array.isArray(c.expect.acts)) throw new Error(`${c.id}: expect.acts missing`);
    if (c.expect.askUser && !String(c.answer || '').trim()) throw new Error(`${c.id}: askUser needs an answer`);
    if (typeof c.reviewed !== 'boolean') throw new Error(`${c.id}: reviewed must be true or false`);
    for (const p of [...(c.expect.mustSay || []), ...(c.expect.mustNotSay || [])]) new RegExp(p, 'u');
  }
  return data.cases;
}

function pick(cases, a) {
  let list = a.only ? cases.filter(c => a.only.includes(c.id)) : cases.slice();
  if (Number.isFinite(a.maxCases) && a.maxCases > 0) list = list.slice(0, a.maxCases);
  return list;
}

const runSha = (cases, base) => crypto.createHash('sha256').update(JSON.stringify({ base, cases: cases.map(c => ({ id: c.id, task: c.task, answer: c.answer || null })) })).digest('hex').slice(0, 16);

async function api(base, cookie, method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (_) { data = null; }
  return { status: r.status, data };
}

/** One case through the server: plan, approve, follow, answer a question once. */
async function runCase(c, { base, cookie, pollMs = 2000, maxMs = 20 * 60 * 1000 }) {
  const plan = await api(base, cookie, 'POST', '/api/agent/plan', { task: c.task });
  if (plan.status !== 201) return { status: 'plan_failed', error: plan.data && plan.data.message, asked: false };
  const runId = plan.data.runId;
  const ok = await api(base, cookie, 'POST', `/api/agent/runs/${runId}/approve`);
  if (ok.status !== 200) return { runId, status: 'approve_failed', error: ok.data && ok.data.message, asked: false, plan: plan.data.plan };
  let asked = false;
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise(r => setTimeout(r, pollMs));
    const r = await api(base, cookie, 'GET', `/api/agent/runs/${runId}`);
    const run = r.data || {};
    if (run.status === 'needs_input') {
      if (asked || !c.answer) return { runId, status: 'needs_input', asked: true, plan: plan.data.plan, body: run.result && run.result.body };
      asked = true;
      await api(base, cookie, 'POST', `/api/agent/runs/${runId}/input`, { answer: c.answer });
      continue;
    }
    if (['done', 'failed', 'cancelled', 'budget'].includes(run.status)) {
      return { runId, status: run.status, asked, plan: plan.data.plan, body: run.result && run.result.body, spent: run.spent || null, steps: run.steps };
    }
  }
  return { runId, status: 'timeout', asked, plan: plan.data.plan };
}

function markdown(rows, sum) {
  const lines = ['# Agent baholash hisoboti', '', `Holatlar: ${rows.length} (ko'rib chiqilgan: ${sum.reviewed.cases}, ko'rib chiqilmagan: ${sum.unreviewed.cases}). Faqat yurist ko'rib chiqqan holatlar sifat haqida gapiradi.`, '',
    '| Holat | Ko\'rib chiqilgan | Holat (run) | O\'tdi | Xato | Ogohlantirish | Xato bo\'lgan tekshiruvlar |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.id} | ${r.reviewed ? 'ha' : "yo'q"} | ${r.run.status} | ${r.score.passed} | ${r.score.failed} | ${r.score.warned} | ${r.score.checks.filter(x => x.result === 'fail').map(x => `${x.id}${x.note ? ` (${x.note})` : ''}`).join('; ')} |`);
  return lines.join('\n') + '\n';
}

async function main() {
  const a = args();
  const cases = pick(loadCases(a.cases), a);
  const sha = runSha(cases, a.base);
  if (!a.live) {
    console.log(JSON.stringify({ mode: 'dry', cases: cases.length, reviewed: cases.filter(c => c.reviewed).length, base: a.base, runSha: sha,
      maxUsd: Number((cases.length * RUN_MAX_USD * 2).toFixed(2)), note: "each case is at most two runs' worth (a question re-runs the rest); live needs AGENT_EVAL_LIVE=yes, --live and --approve <runSha>" }, null, 2));
    return 0;
  }
  if (process.env.AGENT_EVAL_LIVE !== 'yes') { console.error('live refused: AGENT_EVAL_LIVE=yes is not set'); return 2; }
  if (a.approve !== sha) { console.error(`live refused: --approve must be this run's sha ${sha}`); return 2; }
  const cookie = process.env.AGENT_EVAL_COOKIE;
  if (!cookie) { console.error('live refused: AGENT_EVAL_COOKIE (a master session) is not set'); return 2; }
  const out = a.out || fs.mkdtempSync(path.join(require('os').tmpdir(), 'agent-eval-'));
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const c of cases) {
    const run = await runCase(c, { base: a.base, cookie });
    rows.push({ id: c.id, reviewed: c.reviewed, run, score: scoreRun(c, run) });
    console.log(`${c.id} ${run.status} pass ${rows[rows.length - 1].score.passed} fail ${rows[rows.length - 1].score.failed}`);
  }
  const sum = summarize(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(out, `agent-eval-${stamp}.json`), JSON.stringify({ runSha: sha, base: a.base, summary: sum, rows }, null, 2));
  fs.writeFileSync(path.join(out, `agent-eval-${stamp}.md`), markdown(rows, sum));
  console.log(`report: ${out}`);
  return 0;
}

if (require.main === module) main().then(code => process.exit(code || 0), (e) => { console.error(e.message); process.exit(1); });

module.exports = { loadCases, pick, runSha, runCase, markdown, args };
