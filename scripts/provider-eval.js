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
 * Facts a live call needs (endpoint, model id and account access, price,
 * the cap covering every billed output token, the thinking switch, reasoning
 * billing) come ONLY from the owner's confirmation file (--confirmed). The
 * config's prices are a dry-run scenario (search snippets are never a
 * confirmation); without a confirmed fact a job is BLOCKED and its reserve
 * UNKNOWN. Each job's state, blockers, price source and date, estimate and
 * reserve are printed.
 *
 *   node scripts/provider-eval.js                       # dry run, 15 jobs
 *   node scripts/provider-eval.js --json
 *   node scripts/provider-eval.js --variants deepseek,glm          # a subset of the models (3 x 2 = 6 jobs)
 *   node scripts/provider-eval.js --budget-usd N --confirmed <file>   # also prints the run sha
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
// ESTIMATE only, never a bound: comet's request R2 (504b2e59-..., one
// 54 260-char DOCX) gave 0.367 input tokens per character and a 1 947-token
// answer. Not measured for any other model; the reserve never uses it.
const SCENARIO = Object.freeze({ inPerChar: 0.367, answerTokens: 1947, source: 'comet request 504b2e59-5fe4-4727-a88e-7fd000f77b1d (one document); an estimate for the others, not measured for them and never used as a maximum' });
// a criterion marked distorted or missing makes the answer a critical error
const CRITERIA = ['summa', 'subyekt', 'muddat_boshlanishi', 'inkor', 'rozilik', 'istisno', 'barcha_oqibatlar', 'iqtibos_tegishliligi'];
const COMPLETED = 'completed';
// every service outcome a job can end in; only `completed` is rated for quality
const STATUSES = ['completed', 'truncated', 'empty', 'empty_capped', 'refused', 'error', 'model_mismatch', 'model_not_reported', 'finish_unknown', 'skipped', 'not_run'];

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

/**
 * The models of this run: all five by default, or the variants named in
 * --variants (comma list, e.g. deepseek,glm). An unknown or repeated name
 * is refused, never ignored; the order stays the config's. The selection is
 * part of the run sha (runSha hashes the models), so approving a small run
 * does not approve the full one.
 */
function selectModels(models, list) {
  if (list == null) return models;
  const names = String(list).split(',').map(x => x.trim()).filter(Boolean);
  if (!names.length) throw Object.assign(new Error('--variants is empty'), { exit: 2 });
  const known = new Set(models.map(m => m.variant));
  const unknown = names.filter(n => !known.has(n));
  if (unknown.length) throw Object.assign(new Error(`--variants: unknown ${unknown.join(', ')} (known: ${[...known].join(', ')})`), { exit: 2 });
  if (new Set(names).size !== names.length) throw Object.assign(new Error('--variants: a name is repeated'), { exit: 2 });
  return models.filter(m => names.includes(m.variant));
}

/** The cases, each read and checked against its manifest hash. */
function loadCases(dir = FIXTURES) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  return manifest.cases.map((c) => {
    const raw = fs.readFileSync(path.join(dir, c.path));
    if (crypto.createHash('sha256').update(raw).digest('hex') !== c.sha256) throw new Error(`${c.id}: source hash does not match the manifest`);
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

/**
 * What one model still lacks for a live call, from the owner's confirmation
 * entry (none = everything). Provider facts only: the secret's variable name
 * is this runner's choice and its presence is checked apart.
 */
function missingFacts(m, e) {
  const out = e ? [] : ['no entry in the confirmation file'];
  e = e || {};
  if (e.requestedModel == null) out.push(`model id ${m.requestedModel} not confirmed`);
  else if (e.requestedModel !== m.requestedModel) out.push(`model id: confirmed ${e.requestedModel}, config asks ${m.requestedModel} - not substituted`);
  const ep = prov.endpointFor(m.provider, e);
  if (ep.error) out.push(`endpoint: ${ep.error}`);
  else if (e.endpoint !== ep.url) out.push(`endpoint: confirm exactly ${ep.url} (${ep.selected})`);
  if (e.accountAccess !== true) out.push('account access to the model not confirmed');
  if (e.profileConfirmed !== true) out.push('generation profile (thinking switch, parameters, cap name) not confirmed');
  if (!prov.priceFor(m, e).rates) out.push('price (rates[].in/out with source and checkedAt) not confirmed');
  if (!prov.factAccepted(e.capCoversBilledOutput)) out.push(`not confirmed that ${m.profile.capParam} limits every billed output token (visible + reasoning)`);
  const basisProblem = prov.inputBasisProblem(e.inputTokenBasis);
  if (basisProblem) out.push(basisProblem);
  if (m.profile.reasoning !== 'off' && m.provider !== 'voicelab' && !prov.factAccepted(e.reasoningBilledInCompletion)) out.push('reasoning billing inside completion_tokens not confirmed');
  if (e.acceptedReturnedModels != null && !(Array.isArray(e.acceptedReturnedModels) && e.acceptedReturnedModels.every(x => typeof x === 'string' && x.trim()))) out.push('acceptedReturnedModels must be a list of exact model ids');
  return out;
}
function checkConfirmed(models, conf) {
  return models.flatMap(m => missingFacts(m, conf && conf.models && conf.models[m.variant]).map(p => `${m.variant}: ${p}`));
}

/** The run's identity: what the owner approves. Any change gives another sha. */
function runSha(frozen, models, budgetUsd, confirmedSha) {
  return sha({
    cases: frozen.map(f => ({ id: f.id, hashes: f.hashes })),
    models: models.map(m => ({ variant: m.variant, provider: m.provider, requestedModel: m.requestedModel, profile: { params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap, reasoning: m.profile.reasoning } })),
    controls: CONTROLS, budgetUsd: Number(budgetUsd) || 0, confirmedSha: confirmedSha || null,
  });
}

/**
 * The dry-run plan, one row per job: state READY / BLOCKED with the exact
 * missing facts, the price used and its source and date, an ESTIMATE (comet
 * ratio, a scenario) and the RESERVE (confirmed input basis x price + cap,
 * or UNKNOWN), and their difference.
 */
function plan(frozen, models, confirmed = null) {
  const jobs = [];
  for (const f of frozen) {
    for (const m of models) {
      const e = confirmed && confirmed.models ? confirmed.models[m.variant] : null;
      const secret = prov.PROVIDERS[m.provider].secretEnv;
      const blockers = missingFacts(m, e);
      const auth = prov.authFor(m.provider, e);
      if (auth.mode === 'missing') blockers.push(`secret: ${auth.reason} (variable name chosen by this runner)`);
      const confirmedPrice = prov.priceFor(m, e && e.rates ? e : null);
      // the estimate uses a confirmed price when there is one, else the scenario price
      const scen = m.scenarioPrices || {};
      const est = confirmedPrice.rates && confirmedPrice.status === 'owner_confirmed'
        ? { rates: confirmedPrice.rates, status: confirmedPrice.status, source: confirmedPrice.source, date: confirmedPrice.checkedAt }
        : { rates: prov.worstRates(scen), status: scen.status || 'UNKNOWN', source: scen.source || null, date: scen.seenAt || null };
      const inTok = Math.round(f.promptChars * SCENARIO.inPerChar);
      const visible = Math.min(m.profile.cap, SCENARIO.answerTokens);
      const at = out => (est.rates ? (inTok * est.rates.in + out * est.rates.out) / 1e6 : null);
      const factGaps = blockers.filter(x => !/^secret: /u.test(x));
      const b = factGaps.length ? { usd: null, reason: `${factGaps.length} provider fact(s) not confirmed` } : prov.callBound(m, f.messages, prov.priceFor(m, e), e);
      const estimateVisibleUsd = at(visible);
      jobs.push({
        job: `${f.id}__${m.variant}`, case: f.id, variant: m.variant, provider: m.provider, requestedModel: m.requestedModel,
        state: blockers.length ? 'BLOCKED' : 'READY', blockers,
        secret: { name: secret, state: prov.secretState(secret), auth: auth.mode },
        endpoint: (({ url, selected, error }) => ({ url: url || null, selected: selected || null, error: error || null }))(prov.endpointFor(m.provider, e)),
        profile: { reasoning: m.profile.reasoning, params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap },
        hashes: f.hashes, promptChars: f.promptChars,
        estimate: { inTokens: inTok, inMethod: `${SCENARIO.inPerChar} tokens/char (comet, one request) - an estimate`, visibleTokens: visible, visibleUsd: estimateVisibleUsd, atCapUsd: at(m.profile.cap), reasoningTokens: m.profile.reasoning === 'off' ? 'off if the switch works (unconfirmed)' : 'UNKNOWN', priceStatus: est.status, priceSource: est.source, priceDate: est.date },
        reserve: { usd: b.usd, reason: b.usd == null ? b.reason : null, basis: b.basis || null, textBytes: f.messages.reduce((n, x) => n + Buffer.byteLength(x.text, 'utf8'), 0) },
        reserveMinusEstimateUsd: b.usd != null && estimateVisibleUsd != null ? b.usd - estimateVisibleUsd : null,
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
  const stopped = new Map();
  for (const e of entries) {
    if (e.type === 'reserve') { evalBudget.take(budget, e.reservedUsd); open.set(`${e.job}#${e.attempt}`, e); done.add(e.job); }
    else if (e.type === 'settle') {
      open.delete(`${e.job}#${e.attempt}`);
      if (e.costStatus === 'not_called') { evalBudget.release(budget, e.reservedUsd); continue; }
      evalBudget.settle(budget, e.reservedUsd, { listUsd: e.listUsd, providerUsd: e.providerUsd, creditUsd: e.creditUsd, credits: e.credits }, { job: e.job });
      if (e.halt) evalBudget.halt(budget, { job: e.job, reason: e.halt });
      if (e.usageCheck && e.usageCheck.result === 'failed') stopped.set(e.job.split('__')[1], `usage check failed: ${e.usageCheck.problems.join('; ')}`);
    } else if (e.type === 'skip') done.add(e.job);
  }
  for (const e of open.values()) {
    evalBudget.settle(budget, e.reservedUsd, {}, {});
    evalBudget.halt(budget, { job: e.job, reason: 'an earlier attempt has no outcome written (interrupted): its cost is unknown' });
  }
  return { done, interrupted: [...open.keys()], stopped };
}

/**
 * The owner accepted a billing fact 'verify_by_usage': each answered call of
 * that model is checked against its own usage. It fails when the usage is
 * missing or incomplete, or completion_tokens pass the cap sent (the cap did
 * not limit the billed output); a failure stops that provider. What usage
 * cannot show is said, not passed: a provider that reports no
 * reasoning_tokens (GLM) cannot show whether reasoning is billed inside
 * completion_tokens - that is reconciled with its billing console.
 */
function usageCheck(m, e, r) {
  const facts = ['capCoversBilledOutput', 'reasoningBilledInCompletion'].filter(k => e && e[k] === 'verify_by_usage');
  if (!facts.length || r.outcome !== 'answered') return null;
  const u = r.usage || {};
  const problems = [];
  if (!u.complete) problems.push(`usage missing or incomplete (${u.problem || 'no counts'})`);
  else if (u.outTokens > m.profile.cap) problems.push(`completion_tokens ${u.outTokens} above the cap ${m.profile.cap}`);
  const notShown = facts.includes('reasoningBilledInCompletion') && u.reasoningTokens == null && m.profile.reasoning !== 'off'
    ? 'reasoning_tokens not reported: whether reasoning is billed inside completion_tokens is not visible in usage - reconcile with the billing console' : null;
  return { facts, result: problems.length ? 'failed' : 'passed', problems, ...(notShown ? { notShown } : {}), outTokens: u.outTokens == null ? null : u.outTokens, cap: m.profile.cap, reasoningTokens: u.reasoningTokens == null ? null : u.reasoningTokens, reasoningChars: r.reasoningChars || 0 };
}

/** One call's service outcome; the model check comes first (prov.modelMatch). */
function classify(r, m, accepted = []) {
  if (r.outcome === 'not_called') return 'skipped';
  if (r.outcome === 'transport_unknown' || r.outcome === 'http_error') return 'error';
  const mm = prov.modelMatch(m.requestedModel, r.returnedModel, accepted);
  if (mm.match === 'mismatch') return 'model_mismatch';
  if (mm.match === 'not_reported') return 'model_not_reported';
  // GLM reports a blocked answer as finish_reason "sensitive" (docs.z.ai chat-completion)
  if (r.refusal || r.finishReason === 'content_filter' || r.finishReason === 'sensitive') return 'refused';
  if (!String(r.text || '').trim()) return r.finishReason === 'length' ? 'empty_capped' : 'empty';
  if (r.finishReason === 'length') return 'truncated';
  if (r.finishReason === 'stop') return COMPLETED;
  return 'finish_unknown';
}

/** A random id per planned job, made once per --out and kept across restarts. */
function answerIds(out, frozen, models) {
  const file = path.join(out, 'answer-ids.json');
  if (fs.existsSync(file)) return readJson(file);
  const ids = {};
  const used = new Set();
  for (const f of frozen) for (const m of models) {
    let id; do { id = crypto.randomBytes(5).toString('hex'); } while (used.has(id));
    used.add(id); ids[`${f.id}__${m.variant}`] = { answerId: id, case: f.id, variant: m.variant };
  }
  fs.writeFileSync(file, JSON.stringify(ids, null, 2));
  return ids;
}

/**
 * Runs the 15 jobs (or what is left of them) under one budget. `call`
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
  const ids = answerIds(out, frozen, models);
  const budget = evalBudget.newBudget(budgetUsd);
  const { done, stopped } = replay(entries, budget);
  const disabled = new Map(stopped);
  const saveAnswer = (job, f, m, status, res, reason = null) => fs.writeFileSync(path.join(out, 'answers', `${job}.json`), JSON.stringify({ job, answerId: ids[job].answerId, case: f.id, variant: m.variant, status, reason, reply: res ? res.reply : '', raw: res && res.trace ? res.trace.answer : null, check: res ? res.check : null }, null, 2));
  const restore = prov.guardNetwork([...new Set(models.map(m => prov.endpointFor(m.provider, confirmed.models[m.variant]).host).filter(Boolean))]);
  try {
    for (const f of frozen) {
      for (const m of models) {
        const job = `${f.id}__${m.variant}`;
        if (done.has(job)) { log(`${job}: already attempted in this run - not repeated`); continue; }
        const skip = (reason) => { append({ type: 'skip', job, reason }); saveAnswer(job, f, m, 'skipped', null, reason); log(`${job}: skipped (${reason})`); };
        if (budget.halted) { skip(`budget halted: ${budget.haltedBy && budget.haltedBy.reason}`); continue; }
        if (disabled.has(m.variant)) { skip(`provider stopped after ${disabled.get(m.variant)}`); continue; }
        const e = confirmed.models[m.variant];
        const priceInfo = prov.priceFor(m, e);
        const accepted = (e && e.acceptedReturnedModels) || [];
        let attempt = null;
        let lastText = '';
        const callAI = async (messages) => {
          // the very prompt that was frozen and approved, or no call
          if (sha(messages.map(x => ({ role: x.role, text: x.text }))) !== f.hashes.messages) throw new Error('the prompt differs from the frozen one - not called');
          const b = prov.callBound(m, messages, priceInfo, e);
          if (b.usd == null) throw new Error(`no cost bound (${b.reason}) - not called`);
          const taken = evalBudget.take(budget, b.usd);
          if (!taken.ok) throw new Error(`budget ${taken.reason} - not called`);
          append({ type: 'reserve', job, attempt: 1, reservedUsd: b.usd });
          const t0 = Date.now();
          const r = await call(m, messages, { timeoutMs: TIMEOUT_MS, entry: e });
          const durationMs = Date.now() - t0;
          const listUsd = r.usage ? prov.listCost(m, r.usage, priceInfo, e) : null;
          const rate = pricing.voicelabCreditUsd();
          const creditUsd = r.credits == null ? null : r.credits * rate.usdPerCredit;
          if (r.outcome === 'not_called') evalBudget.release(budget, b.usd);
          const st = r.outcome === 'not_called' ? null : evalBudget.settle(budget, b.usd, { listUsd, providerUsd: r.providerCostUsd == null ? null : r.providerCostUsd, creditUsd, credits: r.credits }, { job });
          const status = classify(r, m, accepted);
          const match = r.outcome === 'answered' ? prov.modelMatch(m.requestedModel, r.returnedModel, accepted).match : null;
          let halt = null;
          if (r.outcome === 'transport_unknown') { halt = 'a call ended with no HTTP answer: whether it was billed is unknown'; evalBudget.halt(budget, { job, reason: halt }); }
          if (st && st.costStatus === 'over_reserve') halt = 'a cost went above its reserve';
          if (r.outcome === 'http_error' && (['auth', 'quota', 'permanent', 'not_found'].includes(r.kind) || [401, 402, 403, 404].includes(r.status))) disabled.set(m.variant, `${r.status} ${r.kind || ''}`.trim());
          if (status === 'model_mismatch') disabled.set(m.variant, 'an unexpected model came back');
          const check = usageCheck(m, e, r);
          if (check && check.result === 'failed') disabled.set(m.variant, `usage check failed: ${check.problems.join('; ')}`);
          attempt = {
            type: 'settle', job, attempt: 1, status, outcome: r.outcome, reservedUsd: b.usd, reserveBasis: b.basis, costStatus: st ? st.costStatus : 'not_called', settledUsd: st ? st.settledUsd : null,
            listUsd, providerUsd: r.providerCostUsd == null ? null : r.providerCostUsd, credits: r.credits == null ? null : r.credits, creditUsd,
            provider: m.provider, endpoint: prov.endpointFor(m.provider, e).url, auth: prov.authFor(m.provider, e).mode, billingStatus: r.billingStatus || null, requestedModel: m.requestedModel, returnedModel: r.returnedModel || null, modelMatch: match, requestId: r.requestId || null,
            profile: { reasoning: m.profile.reasoning, params: m.profile.params, capParam: m.profile.capParam, cap: m.profile.cap },
            usage: r.usage || null, reasoningChars: r.reasoningChars || 0, finishReason: r.finishReason || null, durationMs, httpStatus: r.status || null,
            error: r.error || null, halt, usageCheck: check, hashes: f.hashes, runSha: runId,
          };
          append(attempt);
          lastText = r.text || '';
          if (status === COMPLETED || status === 'truncated') return { text: r.text, truncated: status === 'truncated', provider: `${m.provider}/${m.requestedModel}` };
          throw Object.assign(new Error(`${status}${r.error ? `: ${r.error}` : ''}`), { attempt });
        };
        let res = null, err = null;
        try {
          res = await ex.explainDocument({ documentText: f.text, langName: 'Uzbek', callAI, inputMode: CONTROLS.inputMode, sameHelpers: CONTROLS.sameHelpers, digest: async () => { throw new Error('no digest'); } });
        } catch (e2) { err = e2; }
        if (!attempt) { skip(prov.redact(err ? err.message : 'not called')); continue; }
        // a rejected answer keeps its text for the private record only
        saveAnswer(job, f, m, attempt.status, res || (lastText ? { reply: lastText } : null));
        log(`${job}: ${attempt.status}, ${attempt.costStatus}${attempt.settledUsd != null ? ` $${attempt.settledUsd.toFixed(5)}` : ''}${attempt.halt ? ` - HALT: ${attempt.halt}` : ''}`);
      }
    }
  } finally { restore(); }
  writeBlind(out);
  return budget;
}

/**
 * Blind set: ALL planned jobs, each under its random id with its service
 * status (no model name, no cost, no error text). Only a completed answer
 * is rated for quality; a cut answer is shown but not rated as finished.
 * The key (id -> job, model) is its own file.
 */
function writeBlind(out) {
  const ids = readJson(path.join(out, 'answer-ids.json'));
  const dir = path.join(out, 'answers');
  const rows = Object.entries(ids).map(([job, x]) => {
    const file = path.join(dir, `${job}.json`);
    const a = fs.existsSync(file) ? readJson(file) : null;
    return { job, ...x, status: a ? a.status : 'not_run', reply: a && (a.status === COMPLETED || a.status === 'truncated') ? a.reply : '' };
  }).sort((a, b) => a.answerId.localeCompare(b.answerId));
  fs.mkdirSync(path.join(out, 'blind'), { recursive: true });
  for (const a of rows) {
    const body = a.status === COMPLETED ? a.reply
      : a.status === 'truncated' ? `(Javob kesilgan - yakunlangan javob sifatida baholanmaydi.)\n\n${a.reply}`
        : "(Javob matni yo'q.)";
    fs.writeFileSync(path.join(out, 'blind', `${a.answerId}.md`), `# Javob ${a.answerId} - hujjat ${a.case} (tests/fixtures/provider-eval)\n\nXizmat holati: ${a.status}\n\n${body}\n`);
  }
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(rows.map(a => ({ answerId: a.answerId, job: a.job, case: a.case, variant: a.variant, status: a.status })), null, 2));
  fs.writeFileSync(path.join(out, 'review-sheet.json'), JSON.stringify({
    instructions: "Model nomi va xarajat ko'rsatilmaydi. Barcha rejalashtirilgan vazifalar shu yerda. Faqat serviceStatus=completed javob sifat bo'yicha baholanadi; qolganlari xizmat yakunlanmagani sifatida hisobotda qoladi. Har mezon: ok | distorted | missing | na. distorted yoki missing = critical_error. Comet javobi ground truth emas.",
    criteria: CRITERIA, scores: ['factual_accuracy 0-4', 'source_support 0-4', 'completeness 0-4', 'uncertainty_handling 0-4', 'uzbek_clarity 0-4'],
    answers: rows.map(a => ({ answerId: a.answerId, case: a.case, serviceStatus: a.status, ratable: a.status === COMPLETED,
      criteria: Object.fromEntries(CRITERIA.map(k => [k, null])), critical_error: null, acceptable_for_this_case: null, reviewer_note: '' })),
  }, null, 2));
}

/**
 * Offline summary of a run (+ the reviewer's ratings, when given), per model:
 * SERVICE (every planned job and how it ended - none left out) and QUALITY
 * (completed answers only) apart. Cost per accepted answer counts every
 * attempt of that model (failures too); with no accepted answer it is
 * undefined, and with any unknown cost it is UNKNOWN.
 */
function report(out, ratingsFile = null) {
  const ledger = readLedger(path.join(out, 'ledger.jsonl'));
  const key = readJson(path.join(out, 'key.json'));
  const ratings = ratingsFile ? readJson(ratingsFile) : null;
  const rated = new Map(((ratings && ratings.answers) || []).map(a => [a.answerId, a]));
  const rows = {};
  const row = v => rows[v] || (rows[v] = { service: { planned: 0, ...Object.fromEntries(STATUSES.map(s => [s, 0])) }, quality: { ratable: 0, rated: 0, accepted: 0, critical: 0, notAccepted: 0, notRated: 0 }, cost: { listUsd: 0, providerUsd: 0, credits: 0, creditUsd: 0, settledUsd: 0, unknownCostCalls: 0 } });
  for (const k of key) {
    const r = row(k.variant);
    r.service.planned++;
    r.service[k.status] = (r.service[k.status] || 0) + 1;
    if (k.status !== COMPLETED) continue;
    r.quality.ratable++;
    const a = rated.get(k.answerId);
    if (!a) { r.quality.notRated++; continue; }
    r.quality.rated++;
    const critical = a.critical_error === true || Object.values(a.criteria || {}).some(v => v === 'distorted' || v === 'missing');
    if (critical) r.quality.critical++;
    else if (a.acceptable_for_this_case === true) r.quality.accepted++;
    else r.quality.notAccepted++;
  }
  for (const e of ledger) {
    if (e.type !== 'settle') continue;
    const c = row(e.job.split('__')[1]).cost;
    c.listUsd += e.listUsd || 0; c.providerUsd += e.providerUsd || 0; c.credits += e.credits || 0; c.creditUsd += e.creditUsd || 0;
    if (e.costStatus === 'unknown') c.unknownCostCalls++; else c.settledUsd += e.settledUsd || 0;
  }
  for (const r of Object.values(rows)) {
    r.service.completion = `${r.service.completed}/${r.service.planned}`;
    r.costPerAccepted = r.cost.unknownCostCalls ? 'UNKNOWN' : !ratings ? 'not rated' : r.quality.accepted === 0 ? 'undefined (0 accepted)' : r.cost.settledUsd / r.quality.accepted;
  }
  return { out, rows, note: 'service = every planned job and how it ended; quality = completed answers only, rated blind. Settled = the larger known of list USD, provider-reported USD and credits at their rate; the three are shown apart. 3 synthetic documents: screening only, no ranking or savings claim.' };
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
    const models = selectModels(cfg.models, has('--variants') ? arg('--variants', '') : null);
    const phrases = keyPhrases();
    const frozen = [];
    for (const c of loadCases()) frozen.push(await freeze(c, phrases));
    const budgetUsd = Number(arg('--budget-usd', 0)) || 0;
    const confFile = arg('--confirmed');
    if (confFile && inside(confFile)) { console.error('--confirmed must be outside the repository (owner file)'); return 2; }
    const confirmed = confFile ? readJson(confFile) : null;
    const jobs = plan(frozen, models, confirmed);
    const id = runSha(frozen, models, budgetUsd, confFile ? sha(fs.readFileSync(confFile, 'utf8')) : null);
    const sum = f => jobs.reduce((n, j) => (f(j) == null ? n : n + f(j)), 0);
    const summary = {
      mode: live ? 'live' : 'dry-run (no network)', jobs: jobs.length, ready: jobs.filter(j => j.state === 'READY').length, blocked: jobs.filter(j => j.state === 'BLOCKED').length,
      finalAnswerCalls: jobs.length, helperAiCalls: 0, digestCalls: 0, paidPreflight: 0, maxAttempts: jobs.length * (1 + CONTROLS.autoRetry),
      controls: CONTROLS, scenario: SCENARIO, inputBoundMethod: prov.INPUT_BOUND_METHOD,
      estimateVisibleUsd: sum(j => j.estimate.visibleUsd), estimateAtCapUsd: sum(j => j.estimate.atCapUsd), estimateUnpriced: jobs.filter(j => j.estimate.visibleUsd == null).map(j => j.job),
      reserveUsd: jobs.every(j => j.reserve.usd != null) ? sum(j => j.reserve.usd) : null, reserveUnknownFor: jobs.filter(j => j.reserve.usd == null).map(j => j.job),
      runSha: id, runShaCovers: budgetUsd && confFile ? `budget $${budgetUsd} + ${path.basename(confFile)}` : 'NOT approvable: needs --budget-usd and --confirmed',
    };
    const subset = models.length < cfg.models.length ? ` --variants ${models.map(m => m.variant).join(',')}` : '';
    summary.variants = models.map(m => m.variant);
    summary.liveCommand = `PROVIDER_EVAL_LIVE=yes node scripts/provider-eval.js --live${subset} --budget-usd ${budgetUsd || 'N'} --out <dir outside the repo> --confirmed ${confFile || '<owner file>'} --approve ${budgetUsd && confFile ? id : '<run sha>'}`;
    if (has('--json')) console.log(JSON.stringify({ summary, officialDocsReadAttempts: cfg.officialDocsReadAttempts, cases: frozen.map(f => ({ id: f.id, chars: f.chars, promptChars: f.promptChars, hashes: f.hashes, keyLines: f.helpers.keyLines.length, conflicts: f.helpers.conflicts.length })), models: models.map(m => ({ variant: m.variant, label: m.label, why: m.why, profile: m.profile, facts: m.facts, scenarioPrices: m.scenarioPrices })), jobs }, null, 2));
    else printPlan(frozen, models, jobs, summary, cfg);
    if (!live) return 0;

    // ── live gates: every one is needed ──
    const out = arg('--out');
    if (process.env.PROVIDER_EVAL_LIVE !== 'yes' || !(budgetUsd > 0) || !out || !confirmed) { console.error('live needs PROVIDER_EVAL_LIVE=yes, --budget-usd N (> 0), --out <dir outside the repo> and --confirmed <owner file>'); return 2; }
    if (inside(out)) { console.error('--out must be outside the repository (answers, keys and logs stay private)'); return 2; }
    const problems = checkConfirmed(models, confirmed);
    if (problems.length) { console.error(`not confirmed - BLOCKED, nothing called:\n  ${problems.join('\n  ')}`); return 3; }
    if (arg('--approve') !== id) { console.error(`the owner's approval must name this run: --approve ${id} (any change of prompt, model, profile, budget or confirmation file changes it)`); return 3; }
    // a key in the environment, or a network secret the owner confirmed for that host; never a placeholder key
    const missing = models.map(m => [m, prov.authFor(m.provider, confirmed.models[m.variant])]).filter(([, a]) => a.mode === 'missing').map(([m]) => prov.PROVIDERS[m.provider].secretEnv);
    if (missing.length) { console.error(`secrets missing (names only): ${[...new Set(missing)].join(', ')} - nothing called`); return 3; }
    // a network secret is added by the cloud proxy only on requests that go
    // through it; Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1
    // (2026-10-12: without it both providers answered 401, the key never sent)
    const viaProxy = models.filter(m => prov.authFor(m.provider, confirmed.models[m.variant]).mode === 'network_secret').map(m => m.variant);
    if (viaProxy.length && (process.env.NODE_USE_ENV_PROXY !== '1' || !(process.env.HTTPS_PROXY || process.env.https_proxy))) { console.error(`${viaProxy.join(', ')}: a network secret needs the request to go through the proxy - run with NODE_USE_ENV_PROXY=1 (and HTTPS_PROXY set); nothing called`); return 3; }
    // the whole remaining reserve must fit before the first call (an earlier
    // run in this --out counts: spent stays spent, unknown stays held)
    const prior = evalBudget.newBudget(budgetUsd);
    const { done } = replay(readLedger(path.join(out, 'ledger.jsonl')), prior);
    const bounds = frozen.flatMap(f => models.filter(m => !done.has(`${f.id}__${m.variant}`)).map(m => prov.callBound(m, f.messages, prov.priceFor(m, confirmed.models[m.variant]), confirmed.models[m.variant])));
    if (bounds.some(b => b.usd == null)) { console.error('a call has no cost bound with the confirmed facts - nothing called'); return 3; }
    const need = bounds.reduce((n, b) => n + b.usd, 0);
    if (need > prior.left + 1e-12) { console.error(`the reserve $${need.toFixed(4)} does not fit what is left of the budget ($${prior.left.toFixed(4)} of $${budgetUsd}) - nothing called`); return 3; }
    restore();
    const b = await runLive({ frozen, models, budgetUsd, out, confirmed, sha: id, log: s => console.log(s) });
    console.log(`live: known cost $${b.spent.toFixed(5)} (list USD $${b.listUsd.toFixed(5)}, provider-reported $${b.providerUsd.toFixed(5)}, VoiceLab credits ${b.credits} - shown apart); ${b.unknownCalls} call(s) with cost UNKNOWN, reserve $${b.heldUnknown.toFixed(5)} held; ${b.halted ? `HALTED: ${b.haltedBy && b.haltedBy.reason}` : 'not halted'}. Outputs: ${out} (blind/ for the reviewer, key.json apart).`);
    return 0;
  } finally { restore(); }
}

function printPlan(frozen, models, jobs, s, cfg) {
  const usd = x => (x == null ? 'UNKNOWN' : `$${x.toFixed(5)}`);
  console.log(`Provider evaluation - ${s.mode}. NO AI CALL, NO NETWORK. 3 synthetic documents x ${models.length} models = ${s.jobs} final answers; helper AI calls 0, digest calls 0, paid preflight 0; concurrency 1, auto-retry 0, fallback off.`);
  console.log(`Jobs READY ${s.ready}, BLOCKED ${s.blocked}. Prompt: production explainDocument (full text, sameHelpers), frozen per document.`);
  console.log(`ESTIMATE: ${s.scenario.inPerChar} tokens/char and a ${s.scenario.answerTokens}-token answer from ${s.scenario.source}.`);
  console.log(`RESERVE: input = ${s.inputBoundMethod}; output = the profile cap, only once the owner confirms it limits every billed output token; price = the owner-confirmed rate (highest listed). Without them: UNKNOWN, live BLOCKED.\n`);
  for (const a of cfg.officialDocsReadAttempts || []) console.log(`Official page ${a.url}: ${a.result} (${a.at})`);
  console.log('');
  for (const f of frozen) console.log(`${f.id} ${f.path}: ${f.chars} chars, prompt ${f.promptChars} chars, ${f.helpers.keyLines.length} key lines, ${f.helpers.conflicts.length} conflict candidates | source ${f.hashes.source.slice(0, 12)} messages ${f.hashes.messages.slice(0, 12)} helpers ${f.hashes.helpers.slice(0, 12)}`);
  console.log('\nModels (one per provider):');
  for (const m of models) {
    const unknown = Object.entries(m.facts).filter(([, v]) => !['REPO_CONSOLE', 'REPO_ADAPTER', 'OWNER_PACKAGE', 'OFFICIAL_DOCS', 'ACCOUNT_LIST'].includes(v.status)).map(([k, v]) => `${k}=${v.status}`);
    const j0 = jobs.find(j => j.variant === m.variant);
    console.log(`  ${m.variant.padEnd(8)} ${m.label.padEnd(30)} secret ${prov.PROVIDERS[m.provider].secretEnv} (env ${prov.secretState(prov.PROVIDERS[m.provider].secretEnv)}, auth ${j0.secret.auth}) | endpoint ${j0.endpoint.url || j0.endpoint.error} | reasoning ${m.profile.reasoning} | sent ${JSON.stringify(m.profile.params)} ${m.profile.capParam}=${m.profile.cap}`);
    console.log(`           provider facts not established: ${unknown.join(', ') || '-'}`);
  }
  console.log('\nJobs (estimate = scenario, not a forecast; a reserve is a planning bound, not a guaranteed maximum):');
  for (const j of jobs) {
    console.log(`  ${j.job.padEnd(14)} ${j.state.padEnd(7)} ${j.provider}/${j.requestedModel} [${j.profile.reasoning}; ${j.profile.capParam}=${j.profile.cap}]`);
    console.log(`      estimate: ~${j.estimate.inTokens} in tok, visible ${usd(j.estimate.visibleUsd)}, at cap ${usd(j.estimate.atCapUsd)}, reasoning ${j.estimate.reasoningTokens} | price ${j.estimate.priceStatus}${j.estimate.priceDate ? ` ${j.estimate.priceDate}` : ''}`);
    console.log(`      reserve: ${usd(j.reserve.usd)}${j.reserve.usd == null ? ` (${j.reserve.reason})` : ` = ${j.reserve.basis.input.tokensMax} in tok (${j.reserve.basis.input.basis.method}) + ${j.reserve.basis.output.tokensMax} out at ${j.reserve.basis.priceStatus} ${j.reserve.basis.checkedAt || ''}`} | reserve - estimate: ${usd(j.reserveMinusEstimateUsd)}`);
    if (j.blockers.length) console.log(`      missing: ${j.blockers.join('; ')}`);
  }
  console.log(`\nTotal ${s.jobs} jobs: estimate ${usd(s.estimateVisibleUsd)} (visible answer only, reasoning not included) to ${usd(s.estimateAtCapUsd)} (every cap)${s.estimateUnpriced.length ? `, ${s.estimateUnpriced.length} unpriced` : ''}; reserve ${s.reserveUsd == null ? `UNKNOWN (${s.reserveUnknownFor.length} jobs without a reliable bound)` : usd(s.reserveUsd)}.`);
  console.log(`Run sha: ${s.runSha} (${s.runShaCovers}). Live stays BLOCKED until every job is READY and the owner approves this sha.`);
  console.log(`Variants: ${s.variants.join(', ')}. Live command (only after the owner's approval of this sha): ${s.liveCommand}`);
}

// exitCode, not process.exit(): a large --json plan piped to another
// program must be written out whole before the process ends
if (require.main === module) main().then((code) => { process.exitCode = code || 0; }).catch((e) => { console.error(prov.redact(e.message)); process.exitCode = e.exit || 1; });
module.exports = { CONTROLS, CRITERIA, STATUSES, SCENARIO, selectModels, usageCheck, loadConfig, loadCases, keyPhrases, keyLeak, freeze, missingFacts, checkConfirmed, runSha, plan, replay, classify, answerIds, runLive, writeBlind, report, main };
