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
let bundleCoverage = null, bundleExtract = null;

if (arg('--bundle')) {
  const b = JSON.parse(read(arg('--bundle')));
  source = source || b.source || null;
  const t = (b.response && b.response.trace) || {};
  bundleTrace = t;
  bundleCoverage = (b.response && b.response.coverage) || null;
  bundleExtract = b.extract || null;
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
// ── Digest -> answer: what a digest line kept that the answer's sentence on it does not hold ──
if (digest != null) {
  const sig = rel.digestAnswerSignals(digest, answer, { max: 40 });
  console.log(`\nDIGEST -> ANSWER - MECHANICAL, word for word (a reason to check by hand, never a verdict; the answer may say it in other words) (${sig.length}):`);
  for (const x of sig.filter(y => y.match !== 'uncertain')) console.log(`  «${x.topic}»: ${x.lost.map(l => `${l.part} — ${l.value}`).join('; ')}`);
  const unc = sig.filter(y => y.match === 'uncertain');
  if (unc.length) console.log(`  no matching clause found in the answer (not compared, not a change): ${unc.map(x => `«${x.topic}»`).join(', ')}`);
  const tf = rel.tableFlags(digest, source, { stage: 'dayjest' });
  if (tf.length) { console.log('\nTable rows - digest:'); for (const f of tf) console.log(`  [${f.kind}] ${f.note}`); }
}
const tfa = rel.tableFlags(answer, source);
if (tfa.length) { console.log('\nTable rows - answer:'); for (const f of tfa) console.log(`  [${f.kind}] ${f.note}`); }
const periods = ex.silentPeriodChoice(source, answer);
console.log(`\nTwo periods for one matter, the answer states one or a blend (${periods.length}):`);
for (const x of periods) console.log(`  ${x.note}`);
if (bundleTrace && bundleTrace.scopeCounts) {
  const c = bundleTrace.scopeCounts;
  console.log(`\nKey-line list given to the final model: ${c.candidates} candidates, ${c.selected} selected (${c.referenced || 0} as references to text the model already had), ${c.dropped} not fitted, ${c.shortened} shortened.`);
  for (const l of bundleTrace.scopeDropped || []) console.log(`  not fitted: ${l}`);
}
// ── How parts were sized and re-read, and why DOCX tables were lost (no AI) ──
if (bundleCoverage && bundleCoverage.plan && bundleCoverage.plan.density) {
  const d = bundleCoverage.plan.density;
  console.log(`\nParts: ${bundleCoverage.chunks}, sized by predicted digest output (uncalibrated): ${d.fit === 'over' ? `too dense for ${bundleCoverage.chunks} parts at the target, ${d.overCap} predicted at or over the cap` : `each predicted under the cap (max ${d.predictedMax})`}.`);
  for (const p of bundleCoverage.plan.predicted || []) console.log(`  part ${p.part}: ${p.chars} chars, predicted ${p.predictedTokens} output tokens`);
}
if (bundleCoverage && (bundleCoverage.reread || []).length) {
  console.log('\nCut parts - re-read or left out (priority uncalibrated: an ordering, not a measure of legal weight):');
  for (const r of bundleCoverage.reread) console.log(`  part ${r.part}: ${r.decision}${r.why ? ` (${r.why})` : ''}, score ${r.score}${r.reasons.length ? ` - ${r.reasons.join('; ')}` : ''}`);
}
if (bundleExtract && bundleExtract.tableStructure === 'lost') {
  console.log(`\nDOCX tables read as loose lines - causes (structures around the missing words; likely, not proven): ${(bundleExtract.tableCauses || []).join(', ') || 'not recorded'}`);
  const tc = bundleExtract.tableCheck;
  if (tc) {
    console.log(`  ${tc.wordCheck.missing} of ${tc.wordCheck.words} words missing; structures in the document: ${JSON.stringify(tc.census)}`);
    for (const m of tc.missingWords) console.log(`  «${m.word}» expected ${m.expected}, found ${m.found}${m.inTable ? ', in a table' : ''} - ${m.structures.join(', ')}${m.places.length ? `\n      … ${m.places.join(' …\n      … ')} …` : ''}`);
  } else console.log('  (the missing words are given to a master only: re-attach the file with the master account to see them)');
}
