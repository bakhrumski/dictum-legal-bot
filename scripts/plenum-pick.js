#!/usr/bin/env node
'use strict';

/**
 * S2: which Plenum bands the answer would get, for the synthetic questions in
 * docs/quality/plenum-eval/cases.json. No AI, no network - reads the local
 * plenum tables (DATABASE_URL) the same way the answer does. Mechanical only:
 * it lists the picks with the pairs and words that chose them; whether a pick
 * fits the question is for a lawyer to read.
 *
 *   node scripts/plenum-pick.js [--cases <file>] [--out <file.json>]
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const A = require('../src/plenum/answer');
const C = require('../src/rag/citation-utils');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

(async () => {
  const file = arg('--cases') || path.join(__dirname, '../docs/quality/plenum-eval/cases.json');
  const set = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'disable' ? false : undefined;
  const db = new Pool({ connectionString: process.env.DATABASE_URL, ...(ssl === false ? { ssl: false } : {}) });
  const out = [];
  for (const c of set.cases) {
    const chunks = c.norms.map(([law_name, article_numbers]) => ({ law_name, article_numbers, language: c.lang }));
    const t = Date.now();
    const bands = await A.findPlenumBands(db, { chunks, question: c.q, language: c.lang, getRefs: C.getChunkArticleRefs });
    const ms = Date.now() - t;
    out.push({ id: c.id, ms, picks: bands.map(b => ({ name: b.name, band: b.n, url: b.url, pairs: b.pairs, rare: b.rare, opening: b.text.slice(0, 160) })) });
    console.log(`\n${c.id} (${ms} ms) ${c.q}`);
    if (!bands.length) console.log('  - none');
    bands.forEach(b => console.log(`  - ${b.name}, ${b.n}-band [${b.pairs.join(', ')}; ${b.rare.join(' ')}]\n    ${b.text.slice(0, 160).replace(/\s+/g, ' ')}`));
  }
  const picked = out.filter(x => x.picks.length).length;
  console.log(`\n${picked} of ${out.length} questions got a band; ${out.reduce((n, x) => n + x.picks.length, 0)} bands; reviewed: ${set.reviewed}`);
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify({ reviewed: set.reviewed, results: out }, null, 2));
  await db.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
