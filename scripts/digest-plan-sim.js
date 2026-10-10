#!/usr/bin/env node
'use strict';

/**
 * Digest plan comparison - NO AI CALL (2026-10-09).
 *
 * Old plan (#425): 8 000-character parts, re-reads in document order.
 * New plan: parts sized by the predicted digest output (A) and re-reads by
 * an importance order (B), both within the same limits (cap 1 600 output
 * tokens, 13 parts, 4 extra calls, 75 s).
 *
 * What a part's digest really needs is not known before a live call. The
 * simulation takes the density model's prediction times a spread factor -
 * 0.88, 1.00, 1.15, 1.30 - the range one live run showed (uncut calls
 * -4 % to +18 % of the model; the three cut ones at least +4 % to +11 %,
 * their 1 600 tokens being a lower bound only). Everything below is an
 * uncalibrated scenario, not a forecast and never a guaranteed maximum.
 *
 * Tokens and time use that run's own figures: input = 1 478 + 0.346 x chars
 * per call (the prompt plus the part), output = what the part needs, at most
 * the cap; time = per wave of 8 parallel calls, the wave's longest output at
 * 52 tokens/s (that run: 1 540 tokens in 30 s). Cost is at the cheap lane's
 * list price from src/ai/model-pricing.js. The final call is the same in both
 * plans and is left out.
 *
 *   node scripts/digest-plan-sim.js                    # the evaluation fixtures
 *   node scripts/digest-plan-sim.js --source doc.txt   # a document of your own (stays local)
 *   node scripts/digest-plan-sim.js --json
 */

const fs = require('fs');
const ex = require('../src/rag/document-explain');
const pricing = require('../src/ai/model-pricing');
const { loadAll } = require('../tests/fixtures/explain-eval/load');

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const FACTORS = [0.88, 1, 1.15, 1.3];
const CAP = ex.DIGEST_MAX_TOKENS;
const L = ex.DIGEST_LIMITS;
const IN = { perCall: 1478, perChar: 0.346 };
const TOKENS_PER_S = 52;
const price = pricing.priceFor ? pricing.priceFor('voicelab/aisha-comet') : null;
const PRICE = price && price.in != null ? price : { in: 0.45, out: 0.70 };

// time: waves of `concurrency` calls, each as long as its longest output
function waves(calls) {
  let seconds = 0;
  for (const w of [0, 1]) {
    const ws = calls.filter(c => c.wave === w);
    for (let i = 0; i < ws.length; i += L.concurrency) seconds += Math.max(0, ...ws.slice(i, i + L.concurrency).map(c => c.out)) / TOKENS_PER_S;
  }
  return seconds;
}
function need(text, factor) { return Math.round(ex.predictDigestTokens(text) * factor); }

/** One plan's run under one spread factor. */
function run(units, factor, { priority }) {
  const calls = [];
  const first = units.map(u => ({ u, out: Math.min(CAP, need(u.text, factor)), cut: need(u.text, factor) >= CAP }));
  for (const r of first) calls.push({ wave: 0, chars: r.u.text.length, out: r.out });
  let order = first.filter(r => r.cut);
  if (priority) order = order.map(r => ({ r, s: ex.rereadPriority(r.u, units.map(x => x.full).find(Boolean) || '', units).score })).sort((a, b) => b.s - a.s).map(x => x.r);
  let extra = 0;
  const unread = [];
  // re-reads start only while the time limit has not passed (as buildDigest)
  const firstSeconds = waves(calls);
  for (const r of order) {
    if (firstSeconds * 1000 >= L.timeMs || extra + 2 > L.maxExtraCalls || r.u.text.length < L.minSplitChars) { unread.push(r.u.label); continue; }
    extra += 2;
    const mid = Math.floor(r.u.text.length / 2);
    const halves = [r.u.text.slice(0, mid), r.u.text.slice(mid)];
    for (const h of halves) {
      const n = need(h, factor);
      calls.push({ wave: 1, chars: h.length, out: Math.min(CAP, n) });
      if (n >= CAP) unread.push(`${r.u.label}${h === halves[0] ? 'a' : 'b'}`);
    }
  }
  const inTok = calls.reduce((t, c) => t + IN.perCall + IN.perChar * c.chars, 0);
  const outTok = calls.reduce((t, c) => t + c.out, 0);
  const usd = (inTok * PRICE.in + outTok * PRICE.out) / 1e6;
  const seconds = waves(calls);
  return { calls: calls.length, cut: first.filter(r => r.cut).length, unread, coverage: unread.length ? 'some_excluded' : 'all_read', inTok: Math.round(inTok), outTok, usd, seconds: Math.round(seconds) };
}

function compare(name, text) {
  const oldPlan = ex.digestChunks(text, { chunk: ex.chunkSizeFor(text.length) });
  const newPlan = ex.digestChunks(text);
  const units = p => p.chunks.map(c => ({ ...c, label: String(c.index + 1), full: text }));
  const rows = FACTORS.map(f => ({ factor: f, old: run(units(oldPlan), f, { priority: false }), new: run(units(newPlan), f, { priority: true }) }));
  return { name, chars: text.length, oldParts: oldPlan.chunks.length, newParts: newPlan.chunks.length, fit: newPlan.density.fit, predictedMax: newPlan.density.predictedMax, rows };
}

const docs = [];
if (arg('--source')) docs.push(['--source', fs.readFileSync(arg('--source'), 'utf8')]);
else {
  for (const f of loadAll()) { const t = f.pages.join('\n\n'); if (ex.contentChars(t) > ex.EXPLAIN_FULL_TEXT_MAX) docs.push([f.id, t]); }
  // synthetic density cases (no real text): a clause list, a table-like annex, a document too dense for 13 parts
  const clause = i => `${i}.1. Ijrochi ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))} ishini ${5 + (i % 9)} kun ichida bajaradi, kechiksa ${i % 5 + 1} foiz jarima to'laydi va buyurtmachiga yozma xabar beradi.`;
  docs.push(['synthetic-clauses-50k', Array.from({ length: 400 }, (_, i) => clause(i + 1)).join('\n').slice(0, 50000)]);
  docs.push(['synthetic-annex-table-40k', ['2-ilova. Ko\'rsatkichlar', ...Array.from({ length: 1400 }, (_, i) => `${i + 1}\n${10 + (i % 80)} foiz\n${(i % 12) + 1} oy`)].join('\n').slice(0, 40000)]);
  docs.push(['synthetic-dense-120k', Array.from({ length: 1200 }, (_, i) => clause(i + 1)).join('\n').slice(0, 120000)]);
}

const out = docs.map(([n, t]) => compare(n, t));
if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log('Digest plan: old (8 000-char parts, re-reads in order) vs new (density parts, re-reads by priority). NO AI.');
console.log('Spread factors are scenarios from one live run - uncalibrated; never a guaranteed maximum. Final call excluded (same in both).\n');
for (const d of out) {
  console.log(`${d.name}: ${d.chars} chars; parts old ${d.oldParts} -> new ${d.newParts} (density ${d.fit}, predicted max ${d.predictedMax})`);
  for (const r of d.rows) {
    const f = x => `${String(x.calls).padStart(2)} calls, cut ${x.cut}, unread ${x.unread.length ? x.unread.join(',') : '-'} (${x.coverage}), ${x.inTok}+${x.outTok} tok, $${x.usd.toFixed(4)}, ~${x.seconds}s`;
    console.log(`  x${r.factor.toFixed(2)}  old: ${f(r.old)}\n         new: ${f(r.new)}`);
  }
}
