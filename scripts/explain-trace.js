#!/usr/bin/env node
'use strict';

/**
 * Which terms are found word for word in each stage: source -> digest ->
 * answer. MECHANICAL, no AI call: it does not say whether meaning was kept or
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
 * explain-trace.json: what the dashboard saves for a master who asked for a
 * trace (window.__JAI_TRACE = true): { source, response }. trace.json: the
 * response alone. Nothing of either is stored on the server. checks.json: [{ "id": "...", "terms": ["word",
 * ["alternative", "alternative"]] }] - a term group passes when one of its
 * alternatives is present. Keep real client documents out of the repository.
 */

const fs = require('fs');
const ex = require('../src/rag/document-explain');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const read = f => (f ? fs.readFileSync(f, 'utf8') : null);

let source = read(arg('--source'));
let digest = read(arg('--digest'));
let answer = read(arg('--answer'));
let checks = arg('--checks') ? JSON.parse(read(arg('--checks'))) : null;

if (arg('--bundle')) {
  const b = JSON.parse(read(arg('--bundle')));
  source = source || b.source || null;
  const t = (b.response && b.response.trace) || {};
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
