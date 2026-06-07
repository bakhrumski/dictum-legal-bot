'use strict';

/**
 * Eval harness — measures RAG retrieval quality against a gold Q&A dataset.
 *
 * Metrics:
 *   Recall@5  — at least one expected article appears in the top-5 retrieved chunks
 *   MRR       — mean reciprocal rank of the first correct article hit
 *
 * Usage:
 *   node src/eval/eval-runner.js
 *   node src/eval/eval-runner.js --min-recall=0.70   # exits 1 if recall falls below threshold
 *   node src/eval/eval-runner.js --limit=10          # run only first N cases
 *
 * Requires:
 *   DATABASE_URL env var (Postgres connection)
 *   One of: HF_TOKEN | GEMINI_API_KEY | GPT_API_KEY | OPENAI_API_KEY
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { parentChildSearch } = require('../rag/advanced-corpus');
const { rrfSearch } = require('../rag/legal-corpus');
const { detectProvider } = require('../rag/embeddings');
const { pool } = require('../database/db');

const GOLD_PATH = path.resolve(__dirname, 'gold-qa.json');
const REPORT_PATH = path.resolve(__dirname, 'eval-report.json');

// ── CLI flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const minRecall = parseFloat(
  (args.find(a => a.startsWith('--min-recall=')) || '').split('=')[1] || '0'
);
const caseLimit = parseInt(
  (args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0'
);

// ── Article-number normalizer ──────────────────────────────────────────────
// DB stores bare numbers like "100" or "4¹". Keywords in gold data may carry
// a "-modda" suffix. Strip it so the comparison is format-agnostic.

function normalizeArticle(s) {
  return String(s || '')
    .replace(/-modda$/i, '')
    .replace(/\s+/g, '')
    .trim();
}

// ── API key resolution ─────────────────────────────────────────────────────

function resolveApiKey() {
  const provider = detectProvider();
  if (!provider) return null;
  if (provider === 'huggingface') return process.env.HF_TOKEN;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
}

// ── Retrieve top-5 chunks for a question ──────────────────────────────────

async function retrieve(question, category, apiKey) {
  // parentChildSearch handles v2 parent-child data and falls back to RRF
  // internally when no child chunks exist for the given category.
  const chunks = await parentChildSearch(question, {
    category: category || null,
    limit: 5,
    apiKey,
  });

  return chunks.slice(0, 5).map(c => normalizeArticle(c.articleNumber));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Pre-flight checks
  if (!process.env.DATABASE_URL) {
    console.error('[EVAL] DATABASE_URL is not set.');
    process.exit(1);
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error('[EVAL] No embedding API key found. Set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY.');
    process.exit(1);
  }

  const provider = detectProvider();
  const goldCases = JSON.parse(fs.readFileSync(GOLD_PATH, 'utf8'));
  const cases = caseLimit > 0 ? goldCases.slice(0, caseLimit) : goldCases;

  console.log(`[EVAL] Provider: ${provider} | Cases: ${cases.length}${minRecall ? ` | Min recall: ${(minRecall * 100).toFixed(0)}%` : ''}\n`);

  const results = [];

  for (const tc of cases) {
    const label = `${tc.id}`.padEnd(22);
    process.stdout.write(`  ${label} `);

    try {
      const retrieved = await retrieve(tc.question, tc.category, apiKey);
      const expected = tc.expected_articles.map(normalizeArticle);

      // Recall@5: any expected article in top-5?
      const recall = expected.some(ea => retrieved.includes(ea)) ? 1 : 0;

      // MRR: reciprocal rank of first expected article hit
      let rr = 0;
      for (let i = 0; i < retrieved.length; i++) {
        if (expected.includes(retrieved[i])) {
          rr = 1 / (i + 1);
          break;
        }
      }

      results.push({ id: tc.id, expected, retrieved, recall, rr, pass: recall === 1 });

      if (recall === 1) {
        const rank = retrieved.findIndex(r => expected.includes(r)) + 1;
        console.log(`PASS  (rank ${rank})`);
      } else {
        console.log(`FAIL  expected=[${expected.join(', ')}]  got=[${retrieved.join(', ')}]`);
      }
    } catch (err) {
      results.push({ id: tc.id, error: err.message, recall: 0, rr: 0, pass: false });
      console.log(`ERROR  ${err.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const recall5 = results.reduce((s, r) => s + r.recall, 0) / total;
  const mrr = results.reduce((s, r) => s + r.rr, 0) / total;

  console.log('\n' + '─'.repeat(50));
  console.log(`Cases:    ${total}`);
  console.log(`Pass:     ${passed}/${total}`);
  console.log(`Recall@5: ${(recall5 * 100).toFixed(1)}%`);
  console.log(`MRR:      ${mrr.toFixed(3)}`);
  console.log('─'.repeat(50));

  // ── Failures detail ───────────────────────────────────────────────────────

  const failures = results.filter(r => !r.pass && !r.error);
  const errors = results.filter(r => r.error);

  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    failures.forEach(f => {
      console.log(`  ${f.id.padEnd(22)} expected=[${f.expected.join(', ')}]  got=[${f.retrieved.join(', ')}]`);
    });
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(e => console.log(`  ${e.id.padEnd(22)} ${e.error}`));
  }

  // ── Write JSON report ─────────────────────────────────────────────────────

  const report = {
    timestamp: new Date().toISOString(),
    provider,
    total,
    passed,
    recall5: parseFloat(recall5.toFixed(4)),
    mrr: parseFloat(mrr.toFixed(4)),
    cases: results,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n[EVAL] Report → src/eval/eval-report.json`);

  // ── CI gate ───────────────────────────────────────────────────────────────

  await pool.end();

  if (minRecall > 0 && recall5 < minRecall) {
    console.error(`\n[EVAL] GATE FAILED: Recall@5 ${(recall5 * 100).toFixed(1)}% < required ${(minRecall * 100).toFixed(0)}%`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[EVAL] Fatal error:', err.message);
  process.exit(1);
});
