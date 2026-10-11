#!/usr/bin/env node
'use strict';

/**
 * Checks the digest size prediction against a run that already happened -
 * NO AI CALL, nothing sent anywhere (2026-10-10).
 *
 * Inputs, both from the master's own tools, kept on your machine:
 *   --bundle  the Diagnostika JSON of the run ("JSON yuklab olish": the document text)
 *   --ledger  that request's AI calls: GET /api/admin/ai-usage/requests/<requestId> saved as JSON
 *
 * The parts of that run are rebuilt with the same code (old 8 000-char plan
 * or the new one, whichever matches the ledger's part sizes), each part's
 * digest is predicted (predictDigestTokens) and set beside the output tokens
 * the provider returned. A call cut at the cap gave a LOWER BOUND only: its
 * real need is "at least" that, never equal to it.
 *
 *   node scripts/digest-calibration.js --bundle trace.json --ledger request.json
 *
 * The figures printed are about that document and that model only. A
 * document used to fit the model (2026-10-09, 51 398-char DOCX) checks
 * nothing new; say which runs were used.
 */

const fs = require('fs');
const ex = require('../src/rag/document-explain');

const args = process.argv.slice(2);
const arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function rebuild(text, ledgerParts, compare) {
  const seen = new Map();
  const truncatedLabels = new Set(ledgerParts.filter(p => p.truncated).map(p => p.part));
  await ex.buildDigest(text, {
    compare,
    callAI: async (messages, opts) => {
      const label = opts.detail.part;
      const part = String(messages[1].text).replace(/^Excerpt [^\n]*\n\n/u, '').replace(/^\[KONTEKST\]\n[\s\S]*?\n\[QISM\]\n/u, '');
      seen.set(label, { chars: opts.detail.chars, text: part, full: String(messages[1].text).replace(/^Excerpt [^\n]*\n\n/u, '') });
      return truncatedLabels.has(label) ? { text: 'x', truncated: true } : { text: '- band' };
    },
  });
  return seen;
}

async function main() {
  if (!arg('--bundle') || !arg('--ledger')) { console.error('usage: node scripts/digest-calibration.js --bundle trace.json --ledger request.json'); process.exit(2); }
  const bundle = JSON.parse(fs.readFileSync(arg('--bundle'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(arg('--ledger'), 'utf8'));
  const text = String(bundle.source || '').replace(/\u0000/gu, '').trim();
  const calls = (ledger.calls || []).filter(c => c.stage === 'document_digest' && c.call_detail && c.call_detail.part);
  if (!calls.length) { console.error('no digest calls with part details in the ledger file'); process.exit(2); }
  const parts = calls.map(c => ({ part: c.call_detail.part, chars: c.call_detail.chars, out: c.out_tokens, truncated: c.truncated === true || c.finish_reason === 'length' }));
  let match = null;
  for (const [name, compare] of [['old 8 000-char plan', { chunk: ex.chunkSizeFor(text.length), rereadOrder: 'document' }], ['new density plan', null]]) {
    const seen = await rebuild(text, parts, compare);
    if (parts.every(p => seen.has(p.part) && seen.get(p.part).chars === p.chars)) { match = { name, seen }; break; }
  }
  if (!match) { console.error('the parts could not be rebuilt from this text (another document, or a code change in between): stop'); process.exit(3); }
  console.log(`Rebuilt with the ${match.name}. NO AI. One document, one model: not a calibration of other documents.\n`);
  const rows = parts.map(p => ({ ...p, predicted: ex.predictDigestTokens(match.seen.get(p.part).full) }));
  for (const r of rows) {
    const err = r.truncated ? `needs >= ${r.out} (cut: lower bound)${r.predicted >= ex.DIGEST_MAX_TOKENS ? ', predicted at the cap' : `, predicted ${Math.round((r.predicted / r.out - 1) * 100)} % vs the bound`}` : `${r.predicted >= r.out ? '+' : ''}${Math.round((r.predicted / r.out - 1) * 100)} %`;
    console.log(`  part ${String(r.part).padEnd(4)} ${String(r.chars).padStart(6)} chars  predicted ${String(r.predicted).padStart(5)}  returned ${String(r.out).padStart(5)}  ${err}`);
  }
  const uncut = rows.filter(r => !r.truncated);
  if (uncut.length) {
    const e = uncut.map(r => r.predicted / r.out - 1);
    console.log(`\nUncut calls: ${uncut.length}; prediction error ${Math.round(Math.min(...e) * 100)} % to ${Math.round(Math.max(...e) * 100)} %, mean ${Math.round((e.reduce((a, b) => a + b, 0) / e.length) * 100)} %.`);
  }
  const cut = rows.filter(r => r.truncated);
  if (cut.length) console.log(`Cut calls: ${cut.length}; predicted at the cap: ${cut.filter(r => r.predicted >= ex.DIGEST_MAX_TOKENS).length} (the others were under-predicted by at least the gap to the cap).`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
