#!/usr/bin/env node
'use strict';

/**
 * Provider evaluation (2026-10-11): 3 synthetic documents x 5 models = 15
 * final answers - the baseline voicelab/aisha-comet and one model each from
 * DeepSeek, Z.AI (GLM), Moonshot (Kimi) and Alibaba Model Studio (Qwen).
 * DRY RUN BY DEFAULT: no network at all (fetch is replaced by a guard that
 * refuses every host), no key read beyond "configured / missing".
 * Separate from the #430 digest/full-text A/B (scripts/explain-ab.js), which
 * is unchanged; both share scripts/lib/eval-budget.js.
 *
 * Same input for every model of a document: the production explanation
 * prompt (explainDocument, full text, sameHelpers) is built ONCE per document
 * with a stub, its messages frozen and hashed (source, system, user,
 * messages, helpers); a live call whose prompt differs from the frozen hash
 * is not made. Helpers (key lines with source ids, contradiction candidates)
 * are picked by code - no helper AI call, no digest, no paid preflight. The
 * reviewer key never enters a prompt (checked before any call).
 *
 *   node scripts/provider-eval.js                       # dry run, 15 jobs
 *   node scripts/provider-eval.js --json
 *   node scripts/provider-eval.js --budget-usd N --confirmed <file>   # also prints the approval sha
 *   node scripts/provider-eval.js --report <out> [--ratings <file>]   # offline summary
 *
 * Live (only with the owner's written approval of THIS run):
 *   PROVIDER_EVAL_LIVE=yes node scripts/provider-eval.js --live \
 *     --budget-usd N --out <dir outside the repo> \
 *     --confirmed <owner file outside the repo> --approve <run sha>
 * Concurrency 1, no automatic retry, no fallback. Every call reserves its
 * bound from one run-wide budget before it starts (scripts/lib/eval-budget.js);
 * the ledger (<out>/ledger.jsonl) is written before and after each call, and
 * a restart replays it: a job with any attempt is never run again, a call
 * whose outcome was never written keeps its reserve and halts the run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ex = require('../src/rag/document-explain');
const pricing = require('../src/ai/model-pricing');
const evalBudget = require('./lib/eval-budget');
const prov = require('./lib/eval-providers');

const REPO = path.resolve(__dirname, '..');
const FIXTURES = path.join(REPO, 'tests/fixtures/provider-eval');
const CONFIG = path.join(__dirname, 'provider-eval.config.json');
const CONTROLS = Object.freeze({ concurrency: 1, autoRetry: 0, fallback: false, inputMode: 'full_text', sameHelpers: true });
const TIMEOUT_MS = 120000;
// ASSUMPTION for the dry-run scenario, not a measurement of these models:
// comet's request R2 (504b2e59-..., one 54 260-char DOCX) gave 0.367 input
// tokens per character and a 1 947-token answer. Other tokenizers differ.
const SCENARIO = Object.freeze({ inPerChar: 0.367, answerTokens: 1947, source: 'comet request 504b2e59-5fe4-4727-a88e-7fd000f77b1d (one document); not measured for any other model' });
// a criterion marked distorted or missing makes the answer a critical error
const CRITERIA = ['summa', 'subyekt', 'muddat_boshlanishi', 'inkor', 'rozilik', 'istisno', 'barcha_oqibatlar', 'iqtibos_tegishliligi'];
const COMPLETED = 'completed';

const sha = t => crypto.createHash('sha256').update(typeof t === 'string' ? t : JSON.stringify(t)).digest('hex');
const inside = p => { const r = path.resolve(p); return r === REPO || r.startsWith(REPO + path.sep); };
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadConfig(file = CONFIG) {
  const cfg = readJson(file);
  for (const m of cfg.models) {
    if (!prov.PROVIDERS[m.provider]) throw new Error(`unknown provider ${m.provider}`);
    if (!m.profile || !m.profile.capParam || !(m.profile.cap > 0)) throw new Error(`${m.variant}: no output cap`);
    if ('url' in m || 'baseUrl' in m) throw new Error(`${m.variant}: a URL in the config is refused (URLs are fixed in code)`);
  }
  return cfg;
}

/** The cases, each read and checked against its manifest hash. */
function loadCases(dir = FIXTURES) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  return manifest.cases.map((c) => {
    const raw = fs.readFileSync(path.join(dir, c.path));
    if (sha(raw.toString('utf8')) !== c.sha256 || crypto.createHash('sha256').update(raw).digest('hex') !== c.sha256) throw new Error(`${c.id}: source hash does not match the manifest`);
    return { id: c.id, path: c.path, text: raw.toString('utf8'), sha256: c.sha256 };
  });
}

/** Distinct reviewer-key phrases: none may appear in a prompt. */
function keyPhrases(dir = FIXTURES) {
  const key = readJson(path.join(dir, 'reviewer-key.json'));
  const out = new Set();
  for (const c of Object.values(key.cases || {})) {
    for (const f of c.required_facts || []) out.add(f.fact);
    for (const m of c.critical_misses || []) out.add(m);
  }
  for (const h of key.hard_fail_examples || []) out.add(h);
  return [...out].filter(s => s && s.length >= 12);
}
function keyLeak(text, phrases) {
  const t = String(text);
  return phrases.find(p => t.includes(p)) || (/reviewer-key|required_facts|critical_misses/u.test(t) ? 'reviewer key marker' : null);
}

/**
 * The production prompt for one document, built once with a stub (no AI),
 * frozen with its hashes. Every model gets exactly these messages.
 */
async function freeze(c, phrases) {
  let messages = null;
  const r = await ex.explainDocument({
    documentText: c.text, langName: 'Uzbek', inputMode: CONTROLS.inputMode, sameHelpers: CONTROLS.sameHelpers,
    digest: async () => { throw new Error('no digest in a full-text evaluation'); },
    callAI: async (m) => { messages = m.map(x => ({ role: x.role, text: x.text })); return { text: 'Izoh.', provider: 'stub' }; },
  });
  const helpers = { keyLines: r.trace.scopeSent, sources: r.trace.sources, conflicts: r.trace.conflictCandidates };
  const leak = messages.map(m => keyLeak(m.text, phrases)).find(Boolean);
  if (leak) throw new Error(`${c.id}: the reviewer key reached the prompt (${leak}) - nothing called`);
  return {
    id: c.id, path: c.path, text: c.text, messages, helpers,
    hashes: { source: c.sha256, system: sha(messages[0].text), user: sha(messages[1].text), messages: sha(messages), helpers: sha(helpers), wire: sha(prov.wireMessages(messages)) },
    chars: c.text.length, promptChars: messages.reduce((n, m) => n + m.text.length, 0),
  };
}

/** The owner's confirmation file, checked against the config: no silent substitution. */
function checkConfirmed(models, conf) {
  const problems = [];
  for (const m of models) {
    const e = conf && conf.models && conf.models[m.variant];
    if (!e) { problems.push(`${m.variant}: not in the confirmation file`); continue; }
    if (e.requestedModel !== m.requestedModel) problems.push(`${m.variant}: confirmed ${e.requestedModel}, config asks ${m.requestedModel} - not substituted`);
    if (e.profileConfirmed !== true) problems.push(`${m.variant}: generation profile not confirmed`);
    if (e.accountAccess !== true) problems.push(`${m.variant}: account access not confirmed`);
    if (m.provider !== 'voicelab' && !prov.worstRates(e)) problems.push(`${m.variant}: no confirmed price (rates[].in/out)`);
    if (m.profile.reasoning !== 'off' && m.provider !== 'voicelab') {
      if (e.capCoversReasoning !== true) problems.push(`${m.variant}: the output cap is not confirmed to cap reasoning`);
      if (e.reasoningInCompletion !== true) problems.push(`${m.variant}: reasoning billing inside completion_tokens not confirmed`);
    }
  }
  return problems;
}

/** The run's identity: what the owner approves. Any change gives another sha. */
function runSha(frozen, models, budgetUsd, confirmedSha) {
  return sha({
    cases: frozen.map(f => ({ id: f.id, hashes: f.hashes })),
    models: models.map(m => ({ variant: m.variant, provider: m.provider, requestedModel: m.requestedModel, profile: { params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap, reasoning: m.profile.reasoning } })),
    controls: CONTROLS, budgetUsd: Number(budgetUsd) || 0, confirmedSha: confirmedSha || null,
  });
}

/** The dry-run plan: 15 jobs, bounds and estimates on CANDIDATE prices (a scenario). */
function plan(frozen, models) {
  const jobs = [];
  for (const f of frozen) {
    for (const m of models) {
      const reasoningOn = m.profile.reasoning !== 'off' && m.provider !== 'voicelab';
      const b = prov.callBound(m, f.messages, m.candidatePrices, { capCoversReasoning: true });
      const rates = m.provider === 'voicelab' ? (() => { const p = pricing.pricingSnapshot(`voicelab/${m.requestedModel}`); return p && { in: p.in, out: p.out, cachedIn: null }; })() : prov.worstRates(m.candidatePrices);
      const inTok = Math.round(f.promptChars * SCENARIO.inPerChar);
      const visible = Math.min(m.profile.cap, SCENARIO.answerTokens);
      const at = out => (rates ? (inTok * rates.in + out * rates.out) / 1e6 : null);
      jobs.push({
        job: `${f.id}__${m.variant}`, case: f.id, variant: m.variant, provider: m.provider, requestedModel: m.requestedModel,
        secret: { name: prov.PROVIDERS[m.provider].secretEnv, state: prov.secretState(prov.PROVIDERS[m.provider].secretEnv) },
        profile: { reasoning: m.profile.reasoning, params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap },
        hashes: f.hashes, promptChars: f.promptChars, inTokScenario: inTok,
        estimateVisibleUsd: at(visible), estimateAtCapUsd: at(m.profile.cap),
        reasoningTokens: reasoningOn ? 'UNKNOWN' : (m.provider === 'voicelab' ? 'UNKNOWN (none sent; hidden reasoning not documented)' : 'off (switch UNVERIFIED)'),
        reserveScenarioUsd: b.usd, reserveNote: b.usd == null ? b.reason : (reasoningOn ? 'valid only IF the cap covers reasoning (UNKNOWN)' : null),
        priceStatus: m.candidatePrices && m.candidatePrices.status,
      });
    }
  }
  return jobs;
}

// ── live ─────────────────────────────────────────────────────────────────────

function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/**
 * Replays an earlier ledger into a fresh budget: what was spent stays spent,
 * an unknown cost stays held, an attempt with no outcome written is held and
 * halts the run; every job with an attempt is done (never re-run).
 */
function replay(entries, budget) {
  const done = new Set();
  const open = new Map();
  for (const e of entries) {
    if (e.type === 'reserve') { evalBudget.take(budget, e.reservedUsd); open.set(`${e.job}#${e.attempt}`, e); done.add(e.job); }
    else if (e.type === 'settle') {
      open.delete(`${e.job}#${e.attempt}`);
      if (e.costStatus === 'not_called') { evalBudget.release(budget, e.reservedUsd); continue; }
      evalBudget.settle(budget, e.reservedUsd, { listUsd: e.listUsd, providerUsd: e.providerUsd, creditUsd: e.creditUsd, credits: e.credits }, { job: e.job });
      if (e.halt) evalBudget.halt(budget, { job: e.job, reason: e.halt });
    } else if (e.type === 'skip') done.add(e.job);
  }
  for (const e of open.values()) {
    evalBudget.settle(budget, e.reservedUsd, {}, {});
    evalBudget.halt(budget, { job: e.job, reason: 'an earlier attempt has no outcome written (interrupted): its cost is unknown' });
  }
  return { done, interrupted: [...open.keys()] };
}

function classify(r, m) {
  if (r.outcome === 'not_called') return 'skipped';
  if (r.outcome === 'transport_unknown') return 'error';
  if (r.outcome === 'http_error') return 'error';
  if (r.returnedModel && String(r.returnedModel).toLowerCase() !== String(m.requestedModel).toLowerCase()) return 'model_mismatch';
  if (r.refusal || r.finishReason === 'content_filter') return 'refused';
  if (!String(r.text || '').trim()) return r.finishReason === 'length' ? 'empty_capped' : 'empty';
  if (r.finishReason === 'length') return 'truncated';
  if (r.finishReason === 'stop') return COMPLETED;
  return 'finish_unknown';
}

/**
 * Runs the 15 jobs (or what is left of them) under one budget. `opts.call`
 * replaces the provider call in tests; by default prov.callProvider.
 */
async function runLive({ frozen, models, budgetUsd, out, confirmed, sha: runId, call = prov.callProvider, log = () => {} }) {
  fs.mkdirSync(path.join(out, 'answers'), { recursive: true });
  const ledgerFile = path.join(out, 'ledger.jsonl');
  const append = e => fs.appendFileSync(ledgerFile, JSON.stringify({ ...e, at: new Date().toISOString() }) + '\n');
  const entries = readLedger(ledgerFile);
  const head = entries.find(e => e.type === 'run');
  if (head && head.runSha !== runId) throw Object.assign(new Error('this --out holds another run (other sha): nothing called'), { exit: 3 });
  if (!head) append({ type: 'run', runSha: runId, budgetUsd, controls: CONTROLS });
  const budget = evalBudget.newBudget(budgetUsd);
  const { done } = replay(entries, budget);
  const disabled = new Map();
  const restore = prov.guardNetwork([...new Set(models.map(m => prov.PROVIDERS[m.provider].host))]);
  try {
    for (const f of frozen) {
      for (const m of models) {
        const job = `${f.id}__${m.variant}`;
        if (done.has(job)) { log(`${job}: already attempted in this run - not repeated`); continue; }
        const skip = reason => { append({ type: 'skip', job, reason }); log(`${job}: skipped (${reason})`); };
        if (budget.halted) { skip(`budget halted: ${budget.haltedBy && budget.haltedBy.reason}`); continue; }
        if (disabled.has(m.variant)) { skip(`provider stopped after ${disabled.get(m.variant)}`); continue; }
        const e = confirmed.models[m.variant];
        let attempt = null;
        const callAI = async (messages) => {
          // the very prompt that was frozen and approved, or no call
          if (sha(messages.map(x => ({ role: x.role, text: x.text }))) !== f.hashes.messages) throw new Error('the prompt differs from the frozen one - not called');
          const b = prov.callBound(m, messages, e, e);
          if (b.usd == null) throw new Error(`no cost bound (${b.reason}) - not called`);
          const taken = evalBudget.take(budget, b.usd);
          if (!taken.ok) throw new Error(`budget ${taken.reason} - not called`);
          append({ type: 'reserve', job, attempt: 1, reservedUsd: b.usd });
          const t0 = Date.now();
          const r = await call(m, messages, { timeoutMs: TIMEOUT_MS });
          const durationMs = Date.now() - t0;
          const listUsd = r.usage ? prov.listCost(m, r.usage, e, e) : null;
          const rate = pricing.voicelabCreditUsd();
          const creditUsd = r.credits == null ? null : r.credits * rate.usdPerCredit;
          if (r.outcome === 'not_called') evalBudget.release(budget, b.usd);
          const st = r.outcome === 'not_called' ? null : evalBudget.settle(budget, b.usd, { listUsd, providerUsd: r.providerCostUsd == null ? null : r.providerCostUsd, creditUsd, credits: r.credits }, { job });
          const status = classify(r, m);
          let halt = null;
          if (r.outcome === 'transport_unknown') { halt = 'a call ended with no HTTP answer: whether it was billed is unknown'; evalBudget.halt(budget, { job, reason: halt }); }
          if (st && st.costStatus === 'over_reserve') halt = 'a cost went above its reserve';
          if (r.outcome === 'http_error' && (['auth', 'quota', 'permanent', 'not_found'].includes(r.kind) || [401, 402, 403, 404].includes(r.status))) disabled.set(m.variant, `${r.status} ${r.kind || ''}`.trim());
          if (status === 'model_mismatch') disabled.set(m.variant, `model mismatch (${r.returnedModel})`);
          attempt = {
            type: 'settle', job, attempt: 1, status, outcome: r.outcome, reservedUsd: b.usd, costStatus: st ? st.costStatus : 'not_called', settledUsd: st ? st.settledUsd : null,
            listUsd, providerUsd: r.providerCostUsd == null ? null : r.providerCostUsd, credits: r.credits == null ? null : r.credits, creditUsd,
            provider: m.provider, requestedModel: m.requestedModel, returnedModel: r.returnedModel || null, requestId: r.requestId || null,
            profile: { reasoning: m.profile.reasoning, params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap },
            usage: r.usage || null, reasoningChars: r.reasoningChars || 0, finishReason: r.finishReason || null, durationMs, httpStatus: r.status || null,
            error: r.error || null, halt, hashes: f.hashes, runSha: runId,
          };
          append(attempt);
          if (status === COMPLETED || status === 'truncated') return { text: r.text, truncated: status === 'truncated', provider: `${m.provider}/${m.requestedModel}` };
          throw Object.assign(new Error(`${status}${r.error ? `: ${r.error}` : ''}`), { attempt });
        };
        let res = null, err = null;
        try {
          res = await ex.explainDocument({ documentText: f.text, langName: 'Uzbek', callAI, inputMode: CONTROLS.inputMode, sameHelpers: CONTROLS.sameHelpers, digest: async () => { throw new Error('no digest'); } });
        } catch (e2) { err = e2; }
        if (!attempt) { skip(prov.redact(err ? err.message : 'not called')); continue; }
        const answerId = crypto.randomBytes(5).toString('hex');
        fs.writeFileSync(path.join(out, 'answers', `${job}.json`), JSON.stringify({ job, answerId, case: f.id, variant: m.variant, status: attempt.status, reply: res ? res.reply : '', raw: res && res.trace ? res.trace.answer : null, check: res ? res.check : null }, null, 2));
        log(`${job}: ${attempt.status}, ${attempt.costStatus}${attempt.settledUsd != null ? ` $${attempt.settledUsd.toFixed(5)}` : ''}${attempt.halt ? ` - HALT: ${attempt.halt}` : ''}`);
      }
    }
  } finally { restore(); }
  writeBlind(out);
  return budget;
}

/** Blind set: completed answers under random ids; the key in its own file. */
function writeBlind(out) {
  const dir = path.join(out, 'answers');
  const answers = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJson(path.join(dir, f))) : [];
  const ok = answers.filter(a => a.status === COMPLETED).sort((a, b) => a.answerId.localeCompare(b.answerId));
  fs.mkdirSync(path.join(out, 'blind'), { recursive: true });
  for (const a of ok) fs.writeFileSync(path.join(out, 'blind', `${a.answerId}.md`), `# Javob ${a.answerId} - hujjat ${a.case} (tests/fixtures/provider-eval)\n\n${a.reply}\n`);
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(answers.map(a => ({ answerId: a.answerId, job: a.job, case: a.case, variant: a.variant, status: a.status })), null, 2));
  fs.writeFileSync(path.join(out, 'review-sheet.json'), JSON.stringify({
    instructions: "Model nomi va xarajat ko'rsatilmaydi. Har mezon: ok | distorted | missing | na. distorted yoki missing = critical_error. Comet javobi ground truth emas.",
    criteria: CRITERIA, scores: ['factual_accuracy 0-4', 'source_support 0-4', 'completeness 0-4', 'uncertainty_handling 0-4', 'uzbek_clarity 0-4'],
    answers: ok.map(a => ({ answerId: a.answerId, case: a.case, criteria: Object.fromEntries(CRITERIA.map(k => [k, null])), critical_error: null, acceptable_for_this_case: null, reviewer_note: '' })),
  }, null, 2));
}

/**
 * Offline summary of a run (+ the reviewer's ratings, when given). Cost per
 * accepted answer counts every attempt of that model (failures too); with no
 * accepted answer it is undefined, and with any unknown cost it is UNKNOWN.
 */
function report(out, ratingsFile = null) {
  const ledger = readLedger(path.join(out, 'ledger.jsonl'));
  const key = fs.existsSync(path.join(out, 'key.json')) ? readJson(path.join(out, 'key.json')) : [];
  const ratings = ratingsFile ? readJson(ratingsFile) : null;
  const rated = new Map(((ratings && ratings.answers) || []).map(a => [a.answerId, a]));
  const rows = {};
  for (const e of ledger) {
    if (e.type !== 'settle' && e.type !== 'skip') continue;
    const variant = e.job.split('__')[1];
    const r = rows[variant] || (rows[variant] = { jobs: 0, statuses: {}, listUsd: 0, providerUsd: 0, credits: 0, creditUsd: 0, settledUsd: 0, unknownCost: 0, accepted: 0, critical: 0, rated: 0 });
    r.jobs++;
    const s = e.type === 'skip' ? 'skipped' : e.status;
    r.statuses[s] = (r.statuses[s] || 0) + 1;
    if (e.type === 'settle') {
      r.listUsd += e.listUsd || 0; r.providerUsd += e.providerUsd || 0; r.credits += e.credits || 0; r.creditUsd += e.creditUsd || 0;
      if (e.costStatus === 'unknown') r.unknownCost++; else r.settledUsd += e.settledUsd || 0;
    }
  }
  for (const k of key) {
    const a = rated.get(k.answerId);
    if (!a || !rows[k.variant]) continue;
    const critical = a.critical_error === true || Object.values(a.criteria || {}).some(v => v === 'distorted' || v === 'missing');
    rows[k.variant].rated++;
    if (critical) rows[k.variant].critical++;
    else if (a.acceptable_for_this_case === true) rows[k.variant].accepted++;
  }
  for (const r of Object.values(rows)) {
    r.costPerAccepted = r.unknownCost ? 'UNKNOWN' : !ratings ? 'not rated' : r.accepted === 0 ? 'undefined (0 accepted)' : r.settledUsd / r.accepted;
  }
  return { out, rows, note: 'Settled = the larger known of list USD, provider-reported USD and credits at their rate; the three are shown apart. 3 synthetic documents: screening only, no ranking or savings claim.' };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const has = n => argv.includes(n);
  if (has('--report')) { console.log(JSON.stringify(report(arg('--report'), arg('--ratings')), null, 2)); return 0; }
  const live = has('--live');
  // nothing leaves the process unless the live gates below all pass
  const restore = prov.guardNetwork([]);
  try {
    const cfg = loadConfig();
    const models = cfg.models;
    const phrases = keyPhrases();
    const frozen = [];
    for (const c of loadCases()) frozen.push(await freeze(c, phrases));
    const jobs = plan(frozen, models);
    const budgetUsd = Number(arg('--budget-usd', 0)) || 0;
    const confFile = arg('--confirmed');
    if (confFile && inside(confFile)) { console.error('--confirmed must be outside the repository (owner file)'); return 2; }
    const confirmed = confFile ? readJson(confFile) : null;
    const id = runSha(frozen, models, budgetUsd, confFile ? sha(fs.readFileSync(confFile, 'utf8')) : null);
    const sum = k => jobs.reduce((n, j) => (j[k] == null ? n : n + j[k]), 0);
    const unknownReserve = jobs.filter(j => j.reserveScenarioUsd == null).map(j => j.job);
    const summary = {
      mode: live ? 'live' : 'dry-run (no network)', jobs: jobs.length, finalAnswerCalls: jobs.length, helperAiCalls: 0, digestCalls: 0, paidPreflight: 0, maxAttempts: jobs.length * (1 + CONTROLS.autoRetry),
      controls: CONTROLS, scenario: SCENARIO,
      estimateVisibleUsd: sum('estimateVisibleUsd'), estimateAtCapUsd: sum('estimateAtCapUsd'), reserveScenarioUsd: sum('reserveScenarioUsd'), unknownReserve,
      reasoningUnknownFor: [...new Set(jobs.filter(j => j.reasoningTokens === 'UNKNOWN').map(j => j.variant))],
      runSha: id, runShaCovers: budgetUsd && confFile ? `budget $${budgetUsd} + ${path.basename(confFile)}` : 'NOT approvable: needs --budget-usd and --confirmed',
    };
    if (has('--json')) console.log(JSON.stringify({ summary, cases: frozen.map(f => ({ id: f.id, chars: f.chars, promptChars: f.promptChars, hashes: f.hashes, keyLines: f.helpers.keyLines.length, conflicts: f.helpers.conflicts.length })), models: models.map(m => ({ variant: m.variant, label: m.label, why: m.why, profile: m.profile, facts: m.facts, candidatePrices: m.candidatePrices })), jobs }, null, 2));
    else printPlan(frozen, models, jobs, summary);
    if (!live) return 0;

    // ── live gates: every one is needed ──
    const out = arg('--out');
    if (process.env.PROVIDER_EVAL_LIVE !== 'yes' || !(budgetUsd > 0) || !out || !confirmed) { console.error('live needs PROVIDER_EVAL_LIVE=yes, --budget-usd N (> 0), --out <dir outside the repo> and --confirmed <owner file>'); return 2; }
    if (inside(out)) { console.error('--out must be outside the repository (answers, keys and logs stay private)'); return 2; }
    const problems = checkConfirmed(models, confirmed);
    if (problems.length) { console.error(`not confirmed - nothing called:\n  ${problems.join('\n  ')}`); return 3; }
    if (arg('--approve') !== id) { console.error(`the owner's approval must name this run: --approve ${id} (any change of prompt, model, profile, budget or confirmation file changes it)`); return 3; }
    const missing = [...new Set(models.map(m => prov.PROVIDERS[m.provider].secretEnv))].filter(n => prov.secretState(n) !== 'configured');
    if (missing.length) { console.error(`secrets missing (names only): ${missing.join(', ')} - nothing called`); return 3; }
    // the whole remaining reserve must fit before the first call (an earlier
    // run in this --out counts: spent stays spent, unknown stays held)
    const prior = evalBudget.newBudget(budgetUsd);
    const { done } = replay(readLedger(path.join(out, 'ledger.jsonl')), prior);
    const bounds = frozen.flatMap(f => models.filter(m => !done.has(`${f.id}__${m.variant}`)).map(m => prov.callBound(m, f.messages, confirmed.models[m.variant], confirmed.models[m.variant])));
    if (bounds.some(b => b.usd == null)) { console.error('a call has no cost bound with the confirmed facts - nothing called'); return 3; }
    const need = bounds.reduce((n, b) => n + b.usd, 0);
    if (need > prior.left + 1e-12) { console.error(`the reserve $${need.toFixed(4)} does not fit what is left of the budget ($${prior.left.toFixed(4)} of $${budgetUsd}) - nothing called`); return 3; }
    restore();
    const b = await runLive({ frozen, models, budgetUsd, out, confirmed, sha: id, log: s => console.log(s) });
    console.log(`live: known cost $${b.spent.toFixed(5)} (list USD $${b.listUsd.toFixed(5)}, provider-reported $${b.providerUsd.toFixed(5)}, VoiceLab credits ${b.credits} - shown apart); ${b.unknownCalls} call(s) with cost UNKNOWN, reserve $${b.heldUnknown.toFixed(5)} held; ${b.halted ? `HALTED: ${b.haltedBy && b.haltedBy.reason}` : 'not halted'}. Outputs: ${out} (blind/ for the reviewer, key.json apart).`);
    return 0;
  } finally { restore(); }
}

function printPlan(frozen, models, jobs, s) {
  const usd = x => (x == null ? 'UNKNOWN' : `$${x.toFixed(5)}`);
  console.log(`Provider evaluation - ${s.mode}. NO AI CALL, NO NETWORK. 3 synthetic documents x ${models.length} models = ${s.jobs} final answers; helper AI calls 0, digest calls 0, paid preflight 0; concurrency 1, auto-retry 0, fallback off.`);
  console.log(`Prompt: production explainDocument (full text, sameHelpers), frozen per document. SCENARIO tokens: ${s.scenario.inPerChar}/char and a ${s.scenario.answerTokens}-token answer from ${s.scenario.source}.\n`);
  for (const f of frozen) console.log(`${f.id} ${f.path}: ${f.chars} chars, prompt ${f.promptChars} chars, ${f.helpers.keyLines.length} key lines, ${f.helpers.conflicts.length} conflict candidates | source ${f.hashes.source.slice(0, 12)} messages ${f.hashes.messages.slice(0, 12)} helpers ${f.hashes.helpers.slice(0, 12)}`);
  console.log('\nModels (one per provider; facts not confirmed are UNKNOWN / UNVERIFIED / CONFLICT):');
  for (const m of models) {
    const unconfirmed = Object.entries(m.facts).filter(([, v]) => /UNKNOWN|UNVERIFIED|CONFLICT|unverified/u.test(v.status)).map(([k, v]) => `${k}=${v.status.split(' ')[0]}`);
    console.log(`  ${m.variant.padEnd(8)} ${m.label.padEnd(26)} secret ${prov.PROVIDERS[m.provider].secretEnv} (${prov.secretState(prov.PROVIDERS[m.provider].secretEnv)}) | reasoning ${m.profile.reasoning} | sent ${JSON.stringify(m.profile.params)} ${m.profile.capParam}=${m.profile.cap}`);
    console.log(`           not confirmed: ${unconfirmed.join(', ') || '-'} | price: ${m.candidatePrices.status}`);
  }
  console.log('\nJobs (SCENARIO on candidate prices - not a forecast; a reserve is a planning bound, not a guaranteed maximum):');
  for (const j of jobs) console.log(`  ${j.job.padEnd(14)} ~${j.inTokScenario} in tok | visible ${usd(j.estimateVisibleUsd)}, at cap ${usd(j.estimateAtCapUsd)} | reasoning ${j.reasoningTokens} | reserve ${usd(j.reserveScenarioUsd)}${j.reserveNote ? ` (${j.reserveNote})` : ''}`);
  console.log(`\nTotal ${s.jobs} jobs: estimate ${usd(s.estimateVisibleUsd)} (visible answer only${s.reasoningUnknownFor.length ? `; reasoning UNKNOWN for ${s.reasoningUnknownFor.join(', ')}` : ''}), ${usd(s.estimateAtCapUsd)} at every cap; reserve ${usd(s.reserveScenarioUsd)}${s.unknownReserve.length ? ` + ${s.unknownReserve.length} job(s) with no bound` : ''}.`);
  console.log(`Run sha: ${s.runSha} (${s.runShaCovers}). Live stays blocked until the owner confirms every model's facts and approves this sha.`);
}

if (require.main === module) main().then(code => process.exit(code || 0)).catch((e) => { console.error(prov.redact(e.message)); process.exit(e.exit || 1); });
module.exports = { CONTROLS, CRITERIA, SCENARIO, loadConfig, loadCases, keyPhrases, keyLeak, freeze, checkConfirmed, runSha, plan, replay, classify, runLive, writeBlind, report, main };
