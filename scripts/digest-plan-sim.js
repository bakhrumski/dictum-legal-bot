#!/usr/bin/env node
'use strict';

/**
 * Whole-service dry run of a document explanation - NO AI CALL (2026-10-10).
 *
 * Runs the real pipeline (buildDigest + explainDocument) with a stub model,
 * so the parts, pre-splits, re-reads, the final prompt (system rules, digest,
 * key lines with their source ids, contradiction candidates) and the answer
 * are counted as the service builds them. Old plan (#425): 8 000-character
 * parts, re-reads in document order. New plan: parts sized by the predicted
 * digest output, re-reads by priority. Same limits in both (cap 1 600
 * output tokens, 13 parts, 4 extra calls, 75 s).
 *
 * MEASURED (one live run, 2026-10-09, one 51 398-char DOCX, aisha-comet):
 *   input tokens per character of a prompt   0.345 (digest calls and the final call alike)
 *   digest output characters per token       2.82
 *   final answer                             1 737 output tokens, 37.5 s
 *   digest calls                             about 52 output tokens/s
 * SIMULATED (scenarios, uncalibrated - never a forecast or a guaranteed maximum):
 *   what each digest part needs = the density model's prediction x 0.88 /
 *   1.00 / 1.15 / 1.30 (the spread of that one run); the final answer at the
 *   measured 1 737 tokens and at its 3 000-token cap; every source id the
 *   prompt lists copied once by the model (about 6 tokens each).
 * Cost is at the cheap lane's list price (src/ai/model-pricing.js). A partial
 * result releases the user's units: its AI cost stays ours.
 *
 *   node scripts/digest-plan-sim.js                    # the evaluation fixtures + synthetic density cases
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
const MEASURED = { inPerChar: 0.345, digestCharsPerOut: 2.82, finalOut: 1737, finalTokPerS: 1737 / 37.5, digestTokPerS: 52 };
const ID_TOKENS = 6;
const price = (() => { try { const p = pricing.priceFor && pricing.priceFor('voicelab/aisha-comet'); return p && p.in != null ? p : null; } catch { return null; } })() || { in: 0.45, out: 0.70 };

const filler = tokens => '- band | Taraf → harakat | muddat: 10 kun\n'.repeat(Math.max(1, Math.ceil(tokens * MEASURED.digestCharsPerOut / 41))).slice(0, Math.round(tokens * MEASURED.digestCharsPerOut));

async function service(text, factor, { old, finalOut }) {
  const calls = [];
  const ai = async (messages, opts = {}) => {
    const inChars = messages.reduce((n, m) => n + String(m.text || '').length, 0);
    const user = String(messages[1].text || '');
    if (/^Excerpt /u.test(user)) {
      const part = user.replace(/^Excerpt [^\n]*\n\n/u, '');
      const needTok = Math.round(ex.predictDigestTokens(part) * factor);
      const out = Math.min(CAP, needTok);
      calls.push({ kind: 'digest', label: opts.detail && opts.detail.part, half: /[ab]$/u.test((opts.detail && opts.detail.part) || ''), inTok: inChars * MEASURED.inPerChar, out });
      return needTok >= CAP ? { text: filler(CAP), truncated: true, provider: 'stub' } : { text: filler(out), provider: 'stub' };
    }
    const ids = [...new Set(user.match(/\[S\d+·[0-9a-f]{4}\]/gu) || [])];
    const out = finalOut + ids.length * ID_TOKENS;
    calls.push({ kind: 'final', inTok: inChars * MEASURED.inPerChar, out, ids: ids.length });
    return { text: `Izoh.${ids.length ? ` ${ids.join(' ')}` : ''}`, provider: 'stub' };
  };
  const compare = old ? { chunk: ex.chunkSizeFor(text.length), rereadOrder: 'document' } : null;
  const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: t => ex.buildDigest(t, { callAI: ai, compare }) });
  const dg = calls.filter(c => c.kind === 'digest'), fin = calls.find(c => c.kind === 'final');
  const wave = list => { let s = 0; for (let i = 0; i < list.length; i += ex.DIGEST_LIMITS.concurrency) s += Math.max(0, ...list.slice(i, i + ex.DIGEST_LIMITS.concurrency).map(c => c.out)) / MEASURED.digestTokPerS; return s; };
  const first = dg.filter(c => !r.coverage.reread || !(r.coverage.reread || []).some(x => x.decision === 'reread' && c.half && c.label.startsWith(x.part)));
  const second = dg.filter(c => !first.includes(c));
  const seconds = wave(first) + wave(second) + (fin ? fin.out / MEASURED.finalTokPerS : 0);
  const sum = (list, k) => list.reduce((n, c) => n + c[k], 0);
  const usd = list => (sum(list, 'inTok') * price.in + sum(list, 'out') * price.out) / 1e6;
  return {
    parts: r.coverage.chunks, digestCalls: dg.length, cut: (r.coverage.parts || []).filter(p => p.status === 'cut').length,
    unread: r.coverage.unread || [], coverage: r.coverage.status, finalRun: !!fin, ids: fin ? fin.ids : 0,
    digestIn: Math.round(sum(dg, 'inTok')), digestOut: sum(dg, 'out'), finalIn: fin ? Math.round(fin.inTok) : 0, finalOut: fin ? fin.out : 0,
    usd: usd(dg) + (fin ? usd([fin]) : 0), seconds: Math.round(seconds), unitsReleased: !r.coverage.documentFullyRead,
    density: r.coverage.plan && r.coverage.plan.density ? r.coverage.plan.density.fit : null,
  };
}

async function main() {
  const docs = [];
  if (arg('--source')) docs.push(['--source', fs.readFileSync(arg('--source'), 'utf8')]);
  else {
    for (const f of loadAll()) docs.push([f.id, f.pages.join('\n\n')]);
    // synthetic density cases (no real text): a clause list, a table-like annex, a document too dense for 13 parts
    const clause = i => `${i}.1. Ijrochi ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))} ishini ${5 + (i % 9)} kun ichida bajaradi, kechiksa ${i % 5 + 1} foiz jarima to'laydi va buyurtmachiga yozma xabar beradi.`;
    docs.push(['synthetic-clauses-47k', Array.from({ length: 400 }, (_, i) => clause(i + 1)).join('\n').slice(0, 50000)]);
    docs.push(['synthetic-annex-table-24k', ['2-ilova. Ko\'rsatkichlar', ...Array.from({ length: 1400 }, (_, i) => `${i + 1}\n${10 + (i % 80)} foiz\n${(i % 12) + 1} oy`)].join('\n').slice(0, 40000)]);
    docs.push(['synthetic-dense-120k', Array.from({ length: 1200 }, (_, i) => clause(i + 1)).join('\n').slice(0, 120000)]);
  }
  const out = [];
  for (const [name, text] of docs) {
    const rows = [];
    for (const factor of FACTORS) {
      for (const finalOut of [MEASURED.finalOut, ex.EXPLAIN_MAX_TOKENS]) {
        rows.push({ factor, finalOut, old: await service(text, factor, { old: true, finalOut }), new: await service(text, factor, { old: false, finalOut }) });
      }
    }
    out.push({ name, chars: text.length, contentChars: ex.contentChars(text), rows });
  }
  if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('Whole explanation service, old plan vs new: digest parts + re-reads + final call (+ source ids). NO AI.');
  console.log('Measured: token/char ratios, one final answer (1 737 tokens). Simulated: part needs x0.88-1.30, the answer at 1 737 and at the 3 000 cap - uncalibrated scenarios, never a guaranteed maximum.\n');
  const f = x => `${x.parts}p/${x.digestCalls}dc ${x.unread.length ? `unread ${x.unread.join(',')}` : 'all read'}${x.finalRun ? '' : ' NO FINAL'} | digest ${x.digestIn}+${x.digestOut} final ${x.finalIn}+${x.finalOut}${x.ids ? ` (${x.ids} ids)` : ''} tok | $${x.usd.toFixed(4)} ~${x.seconds}s${x.unitsReleased ? ' | units released' : ''}`;
  for (const d of out) {
    if (d.contentChars <= ex.EXPLAIN_FULL_TEXT_MAX) {
      const [a, b] = d.rows.slice(0, 2).map(r => r.new);
      console.log(`${d.name}: ${d.chars} chars, full text (no digest, both plans the same): final ${a.finalIn}+${a.finalOut}${a.ids ? ` (${a.ids} ids)` : ''} tok $${a.usd.toFixed(4)} ~${a.seconds}s; answer at the cap ${b.finalOut} tok $${b.usd.toFixed(4)} ~${b.seconds}s`);
      continue;
    }
    console.log(`${d.name}: ${d.chars} chars`);
    for (const r of d.rows) console.log(`  x${r.factor.toFixed(2)} answer ${r.finalOut}  old: ${f(r.old)}\n                    new: ${f(r.new)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
