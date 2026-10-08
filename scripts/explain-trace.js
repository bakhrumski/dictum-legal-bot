#!/usr/bin/env node
'use strict';

/**
 * Where did meaning get lost: source -> digest -> answer. No AI call.
 *
 * Give it the three texts and the checks (terms that must survive):
 *
 *   node scripts/explain-trace.js --source doc.txt --response trace.json --checks checks.json
 *   node scripts/explain-trace.js --source doc.txt --digest digest.txt --answer answer.txt --checks checks.json
 *   node scripts/explain-trace.js --fixture investment-agreement --digest digest.txt --answer answer.txt
 *
 * trace.json: the JSON a master gets back from /api/draft/explain-document
 * (its `trace` holds the digest, the scope lines and the raw answer; nothing
 * of it is stored on the server). checks.json: [{ "id": "...", "terms": ["word",
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
if (!source || !answer || !checks) {
  console.error('need --source (or --fixture), --answer (or --response) and --checks (or a fixture with traceChecks)');
  process.exit(2);
}

const rows = ex.traceStages({ source, digest, answer, checks });
const where = { null: 'kept', digest: 'LOST IN DIGEST', final: 'LOST IN FINAL ANSWER', not_in_source: 'not in source (check the term)' };
console.log(`digest: ${digest == null ? 'none (full text)' : `${digest.length} chars`}; answer: ${answer.length} chars\n`);
for (const r of rows) {
  const miss = r.lostAt === 'digest' ? r.missing.digest : r.lostAt === 'final' ? r.missing.answer : r.lostAt ? r.missing.source : [];
  console.log(`${r.id.padEnd(28)} ${where[r.lostAt]}${miss.length ? `  (missing: ${miss.join('; ')})` : ''}`);
}
console.log('\nMechanical: a term present is not proof the meaning is right - a lawyer reviews that.');
