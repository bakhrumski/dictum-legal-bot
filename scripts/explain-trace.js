#!/usr/bin/env node
'use strict';

/**
 * Which terms are found word for word in each stage: source -> digest ->
 * answer; and, for the source's key clauses, which of their relations (who,
 * act, status, condition, period, exception, consequence, criteria) each
 * stage keeps word for word, and where a stage ties a period, status,
 * order, "and/or", possibility or threshold differently
 * (src/rag/clause-relations.js). MECHANICAL, no AI call: it does not say whether meaning was kept or
 * lost (a synonym reads as "not found"; a negated sentence or "or" written
 * for "and" that repeats the words reads as "found"). A lawyer compares the
 * meaning.
 *
 * Give it the three texts and the checks (terms that must survive):
 *
 *   node scripts/explain-trace.js --bundle explain-trace.json --checks checks.json
 *   node scripts/explain-trace.js --source doc.txt --response trace.json --checks checks.json
 *   node scripts/explain-trace.js --source doc.txt --digest digest.txt --answer answer.txt --checks checks.json
 *   node scripts/explain-trace.js --fixture investment-agreement --digest digest.txt --answer answer.txt
 *
 * explain-trace.json: what the dashboard's "Diagnostika" download saves for
 * a master who switched it on (or window.__JAI_TRACE = true): { source,
 * response }. trace.json: the
 * response alone. Nothing of either is stored on the server. checks.json: [{ "id": "...", "terms": ["word",
 * ["alternative", "alternative"]] }] - a term group passes when one of its
 * alternatives is present. Keep real client documents out of the repository.
 */

const fs = require('fs');
const ex = require('../src/rag/document-explain');
const rel = require('../src/rag/clause-relations');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const read = f => (f ? fs.readFileSync(f, 'utf8') : null);

let source = read(arg('--source'));
let digest = read(arg('--digest'));
let answer = read(arg('--answer'));
let checks = arg('--checks') ? JSON.parse(read(arg('--checks'))) : null;
let bundleTrace = null;

if (arg('--bundle')) {
  const b = JSON.parse(read(arg('--bundle')));
  source = source || b.source || null;
  const t = (b.response && b.response.trace) || {};
  bundleTrace = t;
  // the bundle must be one request's: its document hash against the source it carries
  if (t.documentSha256 && b.source) {
    const h = require('crypto').createHash('sha256').update(String(b.source).replace(/\u0000/gu, '').trim()).digest('hex'); // as the server reads it
    if (h !== t.documentSha256) { console.error('The bundle\'s source is not the document this trace was made for (sha256 differs). Stop.'); process.exit(3); }
  }
  if (t.requestId) console.log(`trace of request ${t.requestId}${t.tag ? ` (tag ${t.tag})` : ''}${t.createdAt ? `, ${t.createdAt}` : ''}`);
  digest = digest || t.digest || null;
  answer = answer || t.answer || (b.response && b.response.reply) || '';
}
if (arg('--response')) {
  const r = JSON.parse(read(arg('--response')));
  const t = r.trace || {};
  digest = digest || t.digest || null;
  answer = answer || t.answer || r.reply || '';
}
if (arg('--fixture')) {
  const { loadAll } = require('../tests/fixtures/explain-eval/load');
  const f = loadAll().find(x => x.id === arg('--fixture'));
  if (!f) { console.error(`no fixture ${arg('--fixture')}`); process.exit(2); }
  source = source || f.pages.join('\n\n');
  checks = checks || f.traceChecks;
}
// no checks given: one per scope line the trace picked from the document -
// its scope words and figures, each to be found word for word
if (!checks && arg('--bundle')) {
  const b = JSON.parse(read(arg('--bundle')));
  const lines = (b.response && b.response.trace && b.response.trace.scopeLines) || [];
  checks = lines.map((l, i) => {
    const words = ex.SCOPE_GROUPS.map(g => (l.toLowerCase().replace(/[ʻʼ‘’`]/gu, "'").match(g.re) || [])[0]).filter(Boolean);
    const figures = (l.replace(/^\s*\d+(?:\.\d+)*\.?\s*/u, '').match(/\d[\d\s.,]*\d|\d+/gu) || []).map(x => x.trim()).filter(x => x.length >= 2);
    const ref = (l.match(/^\s*(\d+(?:\.\d+)*)\./u) || [])[1];
    return { id: ref ? `band ${ref}` : `qator ${i + 1}`, terms: [...new Set([...words, ...figures])] };
  }).filter(c => c.terms.length);
}
if (!source || !answer || !checks) {
  console.error('need --source (or --fixture / --bundle), --answer (or --response / --bundle) and --checks (or a fixture with traceChecks, or a --bundle whose trace has scope lines)');
  process.exit(2);
}

const rows = ex.traceStages({ source, digest, answer, checks });
const label = {
  null: 'found verbatim in every stage',
  digest: 'NOT FOUND VERBATIM first in: digest',
  answer: 'NOT FOUND VERBATIM first in: answer',
  source: 'not found verbatim in the source (check the term)',
};
console.log('MECHANICAL check: word-for-word presence only - not a judgement of meaning.');
console.log(`digest: ${digest == null ? 'none (full text)' : `${digest.length} chars`}; answer: ${answer.length} chars\n`);
for (const r of rows) {
  const miss = r.firstNotFoundAt ? r.notFoundVerbatim[r.firstNotFoundAt] : [];
  console.log(`${r.id.padEnd(28)} ${label[r.firstNotFoundAt]}${miss.length ? `  (not found: ${miss.join('; ')})` : ''}`);
}
console.log('\nA synonym reads as "not found"; a negated sentence or "or" written for "and" that repeats the words reads as "found". A lawyer compares the meaning.');

// ── Relations inside the key clauses: who -> act -> condition -> when -> exception -> consequence ──
const list = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ');
console.log('\nRELATIONS - MECHANICAL, word for word (an act by its word, a period by its figure, a condition or an exception by its marker); a reason to check by hand, never a verdict on meaning.');
console.log('Key clauses of the source and the slots not found word for word in each stage:');
for (const r of rel.relationTrace({ source, digest, answer })) {
  const d = r.notFound.digest == null ? 'no digest (full text)' : (list(r.notFound.digest) || 'all found');
  console.log(`${(r.ref ? `band ${r.ref}` : r.clause.slice(0, 24)).padEnd(28)} digest: ${d} | answer: ${list(r.notFound.answer) || 'all found'}`);
}
const src = rel.analyseText(source);
for (const [stage, text] of [['dayjest', digest], ['javob', answer]]) {
  if (text == null) continue;
  const flags = rel.relationFlags(text, src, { stage });
  console.log(`\nTied differently than in the source - ${stage === 'dayjest' ? 'digest' : 'answer'} (${flags.length}):`);
  for (const f of flags) console.log(`  [${f.kind}] ${f.note}`);
}
if (bundleTrace && bundleTrace.scopeCounts) {
  const c = bundleTrace.scopeCounts;
  console.log(`\nKey-line list given to the final model: ${c.candidates} candidates, ${c.selected} selected (${c.referenced || 0} as references to text the model already had), ${c.dropped} not fitted, ${c.shortened} shortened.`);
  for (const l of bundleTrace.scopeDropped || []) console.log(`  not fitted: ${l}`);
}
