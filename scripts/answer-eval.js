#!/usr/bin/env node
'use strict';

/**
 * The legal answer's evaluation set (2026-11-10, audit X7,
 * docs/quality/answer-eval.md). Never loaded by the server.
 *
 * Dry run (default, no network): checks the case file and prints the run
 * sha and the most it may cost.
 *
 *   node scripts/answer-eval.js [--cases docs/quality/answer-eval/cases.json] [--only M01,F03] [--topic mehnat] [--reviewed] [--max-cases N]
 *
 * Live: asks each question through a RUNNING server's own POST
 * /api/legal-chat as a master session, exactly as the app does (lex.uz,
 * topic detected by the server, no history, no stream) - so every AI call is
 * metered, limited and recorded by the server as for any user. It needs
 * ANSWER_EVAL_LIVE=yes, --live and --approve <the sha the dry run printed>:
 * the sha covers the questions, the base URL and the options, so an approval
 * holds for exactly that run.
 *
 *   ANSWER_EVAL_LIVE=yes ANSWER_EVAL_COOKIE='<session cookie>' \
 *     node scripts/answer-eval.js --live --base https://juristai.uz --approve <sha> --out <dir>
 *
 * A cached answer is what a person would get, and the report marks it; to
 * measure a change, ask afresh with --redact on|off (the master's
 * X-JAI-Redact header: that request neither reads nor writes the cache).
 *
 * The report (<out>/answer-eval-<date>.json and .md) holds the scores, the
 * answers and their checks - kept outside the repository.
 *
 * Two reports side by side (no network):
 *
 *   node scripts/answer-eval.js --compare <before.json> <after.json>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scoreRun, summarize, compare } = require('./lib/answer-eval-score');

const REQUEST_MAX_USD = Number(process.env.AI_REQUEST_MAX_COST_USD) || 0.25;

function args(argv = process.argv.slice(2)) {
  const a = { cases: path.join(__dirname, '../docs/quality/answer-eval/cases.json'), live: false, base: 'http://localhost:3000', out: null, only: null, topic: null,
    reviewedOnly: false, maxCases: null, approve: null, redact: null, pauseMs: 8000, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--cases') a.cases = argv[++i];
    else if (k === '--base') a.base = String(argv[++i]).replace(/\/+$/u, '');
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--only') a.only = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--topic') a.topic = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--reviewed') a.reviewedOnly = true;
    else if (k === '--max-cases') a.maxCases = Number(argv[++i]);
    else if (k === '--approve') a.approve = argv[++i];
    else if (k === '--redact') a.redact = argv[++i];
    else if (k === '--pause-ms') a.pauseMs = Math.max(0, Number(argv[++i]) || 0);
    else if (k === '--compare') { a.compare = [argv[++i], argv[++i]]; }
  }
  return a;
}

/** The case list as the runner uses it; throws on a bad case. */
function checkCases(list) {
  const ids = new Set();
  for (const c of list || []) {
    if (!/^[A-Z]\d{2}$/u.test(c.id || '') || ids.has(c.id)) throw new Error(`bad or repeated id: ${c.id}`);
    ids.add(c.id);
    if (String(c.question || '').trim().length < 10) throw new Error(`${c.id}: question too short`);
    if (!['uz', 'cyr', 'ru'].includes(c.lang)) throw new Error(`${c.id}: lang must be uz, cyr or ru`);
    if (!c.topic) throw new Error(`${c.id}: topic missing`);
    const e = c.expect;
    if (!e || !Array.isArray(e.acts)) throw new Error(`${c.id}: expect.acts missing`);
    for (const a of e.acts) if (!a.label || !Array.isArray(a.match) || !a.match.length) throw new Error(`${c.id}: an act needs a label and match words`);
    if (!Array.isArray(e.articles || [])) throw new Error(`${c.id}: expect.articles must be a list`);
    if (typeof c.reviewed !== 'boolean') throw new Error(`${c.id}: reviewed must be true or false`);
    // a reviewed case is a lawyer's word: it names who, when and what the right answer holds
    if (c.reviewed && !(String(c.reviewer || '').trim() && /^\d{4}-\d{2}-\d{2}$/u.test(c.reviewedAt || '') && String(c.gold || '').trim())) {
      throw new Error(`${c.id}: reviewed needs reviewer, reviewedAt (YYYY-MM-DD) and gold`);
    }
    for (const p of [...(e.mustSay || []), ...(e.mustNotSay || [])]) new RegExp(p, 'u');
  }
  return list || [];
}
const loadCases = file => checkCases(JSON.parse(fs.readFileSync(file, 'utf8')).cases);

function pick(cases, a) {
  let list = a.only ? cases.filter(c => a.only.includes(c.id)) : cases.slice();
  if (a.topic) list = list.filter(c => a.topic.includes(c.topic));
  if (a.reviewedOnly) list = list.filter(c => c.reviewed);
  if (Number.isFinite(a.maxCases) && a.maxCases > 0) list = list.slice(0, a.maxCases);
  return list;
}

const runSha = (cases, a) => crypto.createHash('sha256').update(JSON.stringify({ base: a.base, redact: a.redact || null, cases: cases.map(c => ({ id: c.id, question: c.question })) })).digest('hex').slice(0, 16);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One question through the server, as the app asks it (no history, no stream). A 429 waits once and asks again. */
async function runCase(c, { base, cookie, redact = null, timeoutMs = 300000, retryWaitMs = 65000 }) {
  const headers = { 'Content-Type': 'application/json', Cookie: cookie, Origin: base };
  if (redact === 'on' || redact === 'off') headers['X-JAI-Redact'] = redact;
  const body = JSON.stringify({ message: c.question, history: [], databases: ['lex.uz'], topic: null, topics: null, autoDetect: true, stream: false });
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const r = await fetch(base + '/api/legal-chat', { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 && attempt === 0) { await sleep(retryWaitMs); continue; }
      let data = null; try { data = await r.json(); } catch (_) { data = null; }
      const ok = r.status === 200 && data;
      return { http: r.status, ms: Date.now() - started, error: ok ? null : String((data && (data.error || data.message || data.code)) || '').slice(0, 200) || null,
        body: ok ? { reply: data.reply, provider: data.provider, cached: data.cached === true, notSubstantive: data.notSubstantive === true, citator: data.citator || [],
          rag: data.rag ? { claimGuard: data.rag.claimGuard || null, quotes: data.rag.quotes || null, lexLive: data.rag.lexLive || null, sources: data.rag.sources || [], chunks: data.rag.chunks,
            lexCrossCheck: data.rag.lexCrossCheck || null, strategy: data.rag.strategy || null } : null } : null };
    } catch (e) {
      return { http: 0, ms: Date.now() - started, error: String(e && e.message || e).slice(0, 200), body: null };
    }
  }
}

const pctOf = (g) => (g.cases ? `${g.allPassed} / ${g.cases}` : '—');

function markdown(rows, sum) {
  const lines = ['# Huquqiy javob baholash hisoboti', '',
    `Savollar: ${rows.length} (yurist ko'rib chiqqan: ${sum.reviewed.cases}, ko'rib chiqilmagan: ${sum.unreviewed.cases}). Faqat yurist ko'rib chiqqan savollar sifat haqida gapiradi; qolganlari texnik signal.`,
    `Hamma tekshiruvdan o'tgan: ko'rib chiqilgan ${pctOf(sum.reviewed)}, ko'rib chiqilmagan ${pctOf(sum.unreviewed)}. Keshdan kelgan javoblar: ${sum.reviewed.cached + sum.unreviewed.cached}.`,
    "Topilgan akt, modda yoki ibora so'zlar borligini bildiradi, javob huquqan to'g'riligini emas.", '',
    '| Savol | Mavzu | Yurist | HTTP | Sek. | O\'tdi | Xato | Ogoh. | Xato va ogohlantirishlar |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    const bad = r.score.checks.filter(x => x.result === 'fail' || x.result === 'warn').map(x => `${x.result === 'warn' ? '⚠ ' : ''}${x.id}${x.note ? ` (${x.note})` : ''}`).join('; ');
    lines.push(`| ${r.id} | ${r.topic} | ${r.reviewed ? 'ha' : "yo'q"} | ${r.run.http} | ${Math.round((r.run.ms || 0) / 1000)} | ${r.score.passed} | ${r.score.failed} | ${r.score.warned} | ${bad.replace(/\|/gu, '/')} |`);
  }
  return lines.join('\n') + '\n';
}

function compareText(d) {
  const line = x => `  ${x.id}${x.reviewed ? '' : " (ko'rib chiqilmagan)"} ${x.check}: ${x.from} -> ${x.to}`;
  return [`Yomonlashgan: ${d.worse.length}`, ...d.worse.map(line), `Yaxshilangan: ${d.better.length}`, ...d.better.map(line),
    d.onlyBefore.length ? `Faqat avvalgisida: ${d.onlyBefore.join(', ')}` : '', d.onlyAfter.length ? `Faqat keyingisida: ${d.onlyAfter.join(', ')}` : ''].filter(Boolean).join('\n');
}

async function main() {
  const a = args();
  if (a.compare) {
    if (!a.compare[0] || !a.compare[1]) { console.error('--compare needs two report files'); return 2; }
    const [b, f] = a.compare.map(p => JSON.parse(fs.readFileSync(p, 'utf8')).rows);
    const d = compare(b, f);
    console.log(compareText(d));
    return d.worse.some(x => x.reviewed) ? 3 : 0;
  }
  if (a.redact != null && !['on', 'off'].includes(a.redact)) { console.error('--redact takes on or off'); return 2; }
  const cases = pick(loadCases(a.cases), a);
  const sha = runSha(cases, a);
  if (!a.live) {
    console.log(JSON.stringify({ mode: 'dry', cases: cases.length, reviewed: cases.filter(c => c.reviewed).length, base: a.base, redact: a.redact, runSha: sha,
      maxUsd: Number((cases.length * REQUEST_MAX_USD).toFixed(2)),
      note: "one question is one request under the server's per-request limits (AI_REQUEST_MAX_COST_USD, a planning figure, not a hard dollar cap); live needs ANSWER_EVAL_LIVE=yes, --live and --approve <runSha>" }, null, 2));
    return 0;
  }
  if (process.env.ANSWER_EVAL_LIVE !== 'yes') { console.error('live refused: ANSWER_EVAL_LIVE=yes is not set'); return 2; }
  if (a.approve !== sha) { console.error(`live refused: --approve must be this run's sha ${sha}`); return 2; }
  const cookie = process.env.ANSWER_EVAL_COOKIE;
  if (!cookie) { console.error('live refused: ANSWER_EVAL_COOKIE (a master session) is not set'); return 2; }
  if (!cases.length) { console.error('no cases picked'); return 2; }
  const out = a.out || fs.mkdtempSync(path.join(require('os').tmpdir(), 'answer-eval-'));
  fs.mkdirSync(out, { recursive: true });
  const rows = [];
  for (const [i, c] of cases.entries()) {
    if (i && a.pauseMs) await sleep(a.pauseMs);
    const run = await runCase(c, { base: a.base, cookie, redact: a.redact });
    const row = { id: c.id, topic: c.topic, lang: c.lang, reviewed: c.reviewed, question: c.question, run, score: scoreRun(c, run) };
    rows.push(row);
    console.log(`${c.id} http ${run.http} ${Math.round(run.ms / 1000)}s pass ${row.score.passed} fail ${row.score.failed} warn ${row.score.warned}`);
    // a session that ended or lost its role: every further question would only fail the same way
    if (run.http === 401 || run.http === 403) { console.error(`stopped: http ${run.http} - the session is not signed in or not allowed`); break; }
  }
  const sum = summarize(rows);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/gu, '-');
  fs.writeFileSync(path.join(out, `answer-eval-${stamp}.json`), JSON.stringify({ runSha: sha, base: a.base, redact: a.redact, at: new Date().toISOString(), summary: sum, rows }, null, 2));
  fs.writeFileSync(path.join(out, `answer-eval-${stamp}.md`), markdown(rows, sum));
  console.log(`report: ${out}`);
  return 0;
}

if (require.main === module) main().then(code => process.exit(code || 0), (e) => { console.error(e.message); process.exit(1); });

module.exports = { loadCases, checkCases, pick, runSha, runCase, markdown, compareText, args };
