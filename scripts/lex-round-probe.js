'use strict';

/**
 * One lex.uz round of the answer pipeline, run locally against live lex.uz
 * (no AI, no database): the plan for a question, every search with its
 * deadline, read slots and read budget, and what it cost - time, the longest
 * event-loop block, peak memory, pages read and documents kept. Used on
 * 2026-10-24 to find why the Render instance (512 MB) went down
 * (docs/lessons/2026-10-lexuz-va-javob-zanjiri.md).
 *
 * Never loaded by the server. Reads lex.uz only.
 *
 *   node scripts/lex-round-probe.js "Pudratchi ishni bajarmadi, avansni qaytarmayapti" fuqarolik
 *   node --max-old-space-size=320 scripts/lex-round-probe.js "..." fuqarolik
 *   LEX_PROBE_TERMS="pudratchining javobgarligi|avans to'lovi" node scripts/lex-round-probe.js "..."
 *
 * LEX_PROBE_TERMS stands in for the AI planner's terms (| separated); without
 * it only the deterministic plan runs. LEX_ROUND_MAX_READS, LEX_FETCH_CONCURRENCY
 * and LEX_PROBE_SECONDS (round deadline, 50) apply as in the server.
 */

const pb = require('../src/rag/legal-research-playbook');
const ls = require('../src/rag/lex-live-search');

const question = process.argv[2];
const topic = process.argv[3] || '';
if (!question) {
  console.error('usage: node scripts/lex-round-probe.js "<question>" [topic]');
  process.exit(2);
}

const terms = String(process.env.LEX_PROBE_TERMS || '').split('|').map(s => s.trim()).filter(Boolean);
const ai = terms.length ? pb.parseLexQueryPlannerResponse(JSON.stringify(terms.map(query => ({ query, kind: 'official-concept' })))) : [];
const plan = pb.mergeLexResearchPlans(ai, pb.buildLexResearchPlan(question, topic));

let pagesRead = 0;
const origLog = console.log;
console.log = (...a) => { if (/^\[FETCH-LEX\] Downloaded/u.test(String(a[0]))) pagesRead++; if (process.env.LEX_PROBE_VERBOSE) origLog(...a); };
console.warn = (...a) => { if (process.env.LEX_PROBE_VERBOSE) origLog(...a); };

let lag = 0, last = Date.now(), peak = 0;
const base = process.memoryUsage().rss;
const tick = setInterval(() => {
  const d = Date.now() - last - 200;
  if (d > lag) lag = d;
  last = Date.now();
  peak = Math.max(peak, process.memoryUsage().rss);
}, 200);

const t0 = Date.now();
const deadline = Date.now() + (Number(process.env.LEX_PROBE_SECONDS) || 50) * 1000;
const readBudget = { left: Math.max(1, Number(process.env.LEX_ROUND_MAX_READS) || 48) };

Promise.all(plan.map(async (st) => {
  const s = Date.now();
  const r = await ls.searchLexUz(st.query, {
    topic, scoreText: question, includeRegistry: st.includeRegistry, preferredPrefixes: st.preferredPrefixes,
    pinnedDocs: st.pinnedDocs, actForm: st.actForm, maxDocs: st.maxDocs, maxChars: 4000, deadline, readBudget,
  }).catch(e => e);
  return { kind: st.kind, form: st.actForm || '', query: st.query, kept: Array.isArray(r) ? r.length : `error: ${r && r.message}`, ms: Date.now() - s, titles: Array.isArray(r) ? r.map(x => x.title) : [] };
})).then((rows) => {
  clearInterval(tick);
  for (const r of rows) origLog(`${String(r.kept).padStart(2)} kept  ${String(r.ms).padStart(6)} ms  ${r.kind}${r.form ? ` (${r.form})` : ''}: ${r.query}${r.titles.length ? `\n      ${r.titles.map(t => String(t).slice(0, 80)).join('\n      ')}` : ''}`);
  const kept = rows.reduce((n, r) => n + (Number(r.kept) || 0), 0);
  origLog(`\n${plan.length} searches, ${pagesRead} pages read, ${kept} documents kept, ${Date.now() - t0} ms, longest event-loop block ${lag} ms, rss ${Math.round(base / 1048576)} -> peak ${Math.round(peak / 1048576)} MB`);
  process.exit(0);
});
