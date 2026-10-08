#!/usr/bin/env node
'use strict';

/**
 * The mechanical check on the synthetic evaluation set
 * (tests/fixtures/explain-eval/09-relations-memorandum.json, evalSet): correct
 * paraphrases that do not repeat the source, and wrong sentences that use
 * the source's own words. No AI call. Reports, FOR THIS SET ONLY, how many
 * correct sentences got no flag and how many wrong ones got a flag (and of
 * the expected kind). It is not a measure of semantic accuracy in general:
 * the set is small, written by us, and the vocabulary was tuned on it.
 *
 *   node scripts/explain-relations-eval.js [--json]
 */

const ex = require('../src/rag/document-explain');
const { loadAll } = require('../tests/fixtures/explain-eval/load');

function evaluate() {
  const f = loadAll().find(x => x.id === 'relations-memorandum');
  const doc = f.pages.join('\n\n');
  const flagsOf = text => {
    const c = ex.finishExplanation({ reply: text, source: doc }).check;
    return [...c.relations.map(r => r.kind), ...c.phrases.map(p => `ibora:${p.label}`), ...c.numbers.map(n => `raqam:${n}`), ...c.dates.map(d => `sana:${d}`)];
  };
  const correct = f.evalSet.correct.map(x => ({ id: x.id, flags: flagsOf(x.text) }));
  const wrong = f.evalSet.wrong.map(x => { const flags = flagsOf(x.text); return { id: x.id, expect: x.expect, flags, flagged: flags.length > 0, expectedKind: flags.includes(x.expect) }; });
  return {
    scope: 'synthetic evaluation set only - not a semantic accuracy guarantee',
    correct: { total: correct.length, noFlag: correct.filter(c => !c.flags.length).length, falseFlags: correct.filter(c => c.flags.length) },
    wrong: { total: wrong.length, flagged: wrong.filter(w => w.flagged).length, expectedKind: wrong.filter(w => w.expectedKind).length, missed: wrong.filter(w => !w.flagged), otherKind: wrong.filter(w => w.flagged && !w.expectedKind) },
    rows: { correct, wrong },
  };
}

if (require.main === module) {
  const r = evaluate();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log('MECHANICAL check on the synthetic set (no AI). For this set only - not a semantic accuracy guarantee.\n');
  console.log(`Correct paraphrases (source not repeated): ${r.correct.noFlag}/${r.correct.total} with no flag`);
  for (const c of r.correct.falseFlags) console.log(`  flagged although correct: ${c.id} -> ${c.flags.join(', ')}`);
  console.log(`Wrong sentences in the source's words: ${r.wrong.flagged}/${r.wrong.total} flagged, ${r.wrong.expectedKind}/${r.wrong.total} with the expected kind`);
  for (const w of r.wrong.missed) console.log(`  missed: ${w.id} (expected ${w.expect})`);
  for (const w of r.wrong.otherKind) console.log(`  flagged, not as expected (${w.expect}): ${w.id} -> ${w.flags.join(', ')}`);
}

module.exports = { evaluate };
