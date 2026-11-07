#!/usr/bin/env node
'use strict';

/**
 * Data protection E4: the before/after the owner asked for before the web
 * chat is redacted (docs/design/shifrlash-1-bosqich.md §9.3). 20 synthetic
 * questions with invented personal data (docs/quality/redaction-eval/cases.json).
 *
 * Dry run (default, no network, no AI): each question through
 * src/privacy/redact.js - is every listed identifier hidden, does every
 * amount, date and act code reach the provider unchanged, and does
 * restoring give the question back word for word.
 *
 *   node scripts/redaction-eval.js
 *
 * Live: each question asked twice through a running server's
 * /api/legal-chat as a master session - X-JAI-Redact: off, then on (the
 * server applies the header for a database master only and skips the
 * answer cache for it) - and the two answers compared with no AI: the
 * articles cited, the acts named, placeholders left in the answer, the
 * identifiers the answer repeats, length and provider. It costs two legal
 * answers per question, so it needs REDACTION_EVAL_LIVE=yes, --live and
 * --approve <the sha the dry run prints>.
 *
 *   REDACTION_EVAL_LIVE=yes REDACTION_EVAL_COOKIE='<master session cookie>' \
 *     node scripts/redaction-eval.js --live --base https://juristai.uz --approve <sha> --out <dir>
 *
 * The comparison is mechanical: the same articles are not proof that the
 * answers are equally right, and different ones are not proof of harm - a
 * lawyer reads the pairs (the report keeps both answers, outside the repository).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const redact = require('../src/privacy/redact');

function args(argv = process.argv.slice(2)) {
  const a = { cases: path.join(__dirname, '../docs/quality/redaction-eval/cases.json'), live: false, base: 'http://localhost:3000', out: null, approve: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--live') a.live = true;
    else if (k === '--cases') a.cases = argv[++i];
    else if (k === '--base') a.base = String(argv[++i]).replace(/\/+$/u, '');
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--approve') a.approve = argv[++i];
    else if (k === '--only') a.only = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
  }
  return a;
}

function loadCases(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set();
  for (const c of data.cases || []) {
    if (!/^R\d{2}$/u.test(c.id || '') || ids.has(c.id)) throw new Error(`bad or repeated id: ${c.id}`);
    ids.add(c.id);
    if (String(c.question || '').trim().length < 20) throw new Error(`${c.id}: question too short`);
    if (!Array.isArray(c.pii) || !Array.isArray(c.keep)) throw new Error(`${c.id}: pii / keep missing`);
    for (const v of [...c.pii, ...c.keep]) if (!c.question.includes(v)) throw new Error(`${c.id}: "${v}" is not in the question`);
  }
  return data.cases;
}

/** One question through the redaction rules (what the provider would see). */
function dryCase(c) {
  const map = redact.createMap();
  const sent = redact.redact(c.question, map, { names: c.names || [] });
  const leaked = c.pii.filter(v => sent.includes(v));
  const lost = c.keep.filter(v => !sent.includes(v));
  const roundTrip = redact.restore(sent, map) === c.question;
  return { id: c.id, sent, hidden: redact.countsOf(map) || {}, leaked, lost, roundTrip, ok: !leaked.length && !lost.length && roundTrip };
}

const ARTICLE = /(\d+)\s*[-‐–]?\s*(?:modda|моддa|статья|статьи)/giu;
const ACT = /\b(?:O['‘ʻ’]?RQ|PQ|PF|VMQ|ЎРҚ|ПҚ|ПФ)[-‐–\s]?\d+/gu;
const PLACEHOLDER = /\[?(?:PASPORT|JSHSHIR|STIR|TELEFON|KARTA|HISOB|EMAIL|AVTO|SHAXS)_\d+\]?/gu;

/** What can be compared without reading for meaning. */
function features(answer, c) {
  const text = String(answer || '');
  const articles = [...new Set([...text.matchAll(ARTICLE)].map(m => `${m[1]}-modda`))].sort();
  const acts = [...new Set((text.match(ACT) || []).map(s => s.replace(/[‐–\s]/gu, '-').toUpperCase()))].sort();
  return { length: text.length, articles, acts, placeholders: [...new Set(text.match(PLACEHOLDER) || [])], repeatsPii: c.pii.filter(v => text.includes(v)) };
}

const overlap = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const both = [...A].filter(x => B.has(x)).length;
  const any = new Set([...A, ...B]).size;
  return any ? Number((both / any).toFixed(2)) : 1;
};

function compare(c, off, on) {
  const f0 = features(off.reply, c), f1 = features(on.reply, c);
  return {
    id: c.id,
    off: { ...f0, provider: off.provider, status: off.status },
    on: { ...f1, provider: on.provider, status: on.status, redactHeader: on.redactHeader },
    articlesJaccard: overlap(f0.articles, f1.articles),
    actsJaccard: overlap(f0.acts, f1.acts),
    lengthRatio: f0.length ? Number((f1.length / f0.length).toFixed(2)) : null,
    placeholderLeak: f1.placeholders.length > 0,
  };
}

async function ask(base, cookie, question, mode) {
  const r = await fetch(`${base}/api/legal-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base, 'X-JAI-Redact': mode },
    body: JSON.stringify({ message: question, history: [] }),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, reply: data.reply || '', provider: data.provider || null, redactHeader: r.headers.get('x-jai-redact') };
}

function summary(rows) {
  const n = rows.length || 1;
  const avg = k => Number((rows.reduce((s, r) => s + (r[k] == null ? 0 : r[k]), 0) / n).toFixed(2));
  return {
    questions: rows.length,
    avgArticlesJaccard: avg('articlesJaccard'),
    avgActsJaccard: avg('actsJaccard'),
    avgLengthRatio: avg('lengthRatio'),
    placeholderLeaks: rows.filter(r => r.placeholderLeak).map(r => r.id),
    sameArticles: rows.filter(r => r.articlesJaccard === 1).length,
    headerNotApplied: rows.filter(r => r.on.redactHeader !== 'on').map(r => r.id),
    failed: rows.filter(r => r.off.status !== 200 || r.on.status !== 200).map(r => r.id),
  };
}

async function main() {
  const a = args();
  let cases = loadCases(a.cases);
  if (a.only) cases = cases.filter(c => a.only.includes(c.id));
  const dry = cases.map(dryCase);
  const rulesSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/privacy/redact.js'))).digest('hex');
  const sha = crypto.createHash('sha256').update(JSON.stringify({ cases, base: a.base, rulesSha })).digest('hex').slice(0, 16);
  if (!a.live) {
    for (const d of dry) console.log(`${d.ok ? '✓' : '✗'} ${d.id} ${JSON.stringify(d.hidden)}${d.leaked.length ? ` LEAKED ${d.leaked.join(', ')}` : ''}${d.lost.length ? ` LOST ${d.lost.join(', ')}` : ''}${d.roundTrip ? '' : ' ROUND-TRIP DIFFERS'}`);
    const bad = dry.filter(d => !d.ok).length;
    console.log(JSON.stringify({ dryRun: true, questions: dry.length, ok: dry.length - bad, runSha: sha, liveCalls: dry.length * 2,
      note: 'live asks each question twice (X-JAI-Redact off / on): REDACTION_EVAL_LIVE=yes, REDACTION_EVAL_COOKIE, --live and --approve <runSha>' }, null, 2));
    return bad ? 1 : 0;
  }
  if (process.env.REDACTION_EVAL_LIVE !== 'yes') { console.error('live refused: REDACTION_EVAL_LIVE=yes is not set'); return 2; }
  if (a.approve !== sha) { console.error(`live refused: --approve must be this run's sha ${sha}`); return 2; }
  const cookie = process.env.REDACTION_EVAL_COOKIE;
  if (!cookie) { console.error('live refused: REDACTION_EVAL_COOKIE (a master session) is not set'); return 2; }
  if (!a.out) { console.error('live refused: --out <dir> (outside the repository) is needed for the answers'); return 2; }
  const rows = [], pairs = [];
  for (const c of cases) {
    const off = await ask(a.base, cookie, c.question, 'off');
    const on = await ask(a.base, cookie, c.question, 'on');
    const row = compare(c, off, on);
    rows.push(row);
    pairs.push({ id: c.id, question: c.question, off: off.reply, on: on.reply });
    console.log(`${c.id} articles ${row.articlesJaccard} acts ${row.actsJaccard} length ${row.lengthRatio}${row.placeholderLeak ? ' PLACEHOLDER LEFT' : ''}${row.on.redactHeader !== 'on' ? ' (header not applied: not a master?)' : ''}`);
  }
  const report = { date: new Date().toISOString(), runSha: sha, summary: summary(rows), rows, dry, pairs };
  fs.mkdirSync(a.out, { recursive: true });
  const file = path.join(a.out, `redaction-eval-${report.date.slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`report: ${file}`);
  return 0;
}

if (require.main === module) main().then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });

module.exports = { loadCases, dryCase, features, compare, summary };
