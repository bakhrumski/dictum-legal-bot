'use strict';

/**
 * One vote per account per answer (docs/audit BACKLOG "vote dedupe").
 * Before: one account pressing 👎 three times flagged a lawyer-verified
 * answer, and each press rewrote legal_chunks, bumping the corpus revision
 * (which empties the answer cache).
 *
 *   TEST_DATABASE_URL=postgresql://… node tests/answer-votes.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('answer votes: skipped (TEST_DATABASE_URL not set)');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('answer votes: refusing to run against a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { initUsageFeedback, recordChunkFeedback } = require('../src/rag/usage-feedback');
const { voteQaBankEntry, initAdvancedCorpus } = require('../src/rag/advanced-corpus');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const revision = async () => {
  const { rows } = await pool.query('SELECT revision FROM juristai_private.legal_corpus_state').catch(() => ({ rows: [] }));
  return rows.length ? Number(rows[0].revision) : null;
};

(async () => {
  console.log('answer votes');
  await initUsageFeedback();
  await initAdvancedCorpus();
  const chunk = (await pool.query(
    `INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id)
     VALUES ('Test', 'test', 'Savol: x?\n\nJavob: y.', 'verified_qa', 'votes_test_chunk') RETURNING id`
  )).rows[0].id;
  const qa = (await pool.query(
    `INSERT INTO qa_bank (question, answer) VALUES ('x?', 'y.') RETURNING id`
  )).rows[0].id;
  const A = 900001, B = 900002, C = 900003;

  try {
    await test('one account pressing 👎 three times counts once and does not flag', async () => {
      const rev0 = await revision();
      let r;
      for (let i = 0; i < 3; i++) r = await recordChunkFeedback(chunk, false, A);
      const rev1 = await revision();
      console.log(`      after 3 presses: unhelpful=${r.unhelpful} flagged=${r.flagged} revision +${rev1 - rev0}`);
      assert.strictEqual(r.unhelpful, 1);
      assert.strictEqual(r.flagged, false);
      assert.strictEqual(r.repeated, true);
      if (rev0 !== null) assert.ok(rev1 - rev0 <= 1, 'repeats do not rewrite legal_chunks');
    });

    await test('three different accounts still flag it', async () => {
      await recordChunkFeedback(chunk, false, B);
      const r = await recordChunkFeedback(chunk, false, C);
      assert.deepStrictEqual([r.unhelpful, r.flagged], [3, true]);
    });

    await test('changing a vote moves one count across', async () => {
      const r = await recordChunkFeedback(chunk, true, A);
      assert.deepStrictEqual([r.helpful, r.unhelpful, r.flagged], [1, 2, false]);
    });

    await test('unknown answers record nothing', async () => {
      assert.strictEqual(await recordChunkFeedback(2147483000, false, A), null);
      assert.strictEqual(await voteQaBankEntry(2147483000, 'down', A), null);
      const { rows } = await pool.query(`SELECT count(*)::int n FROM rag_answer_votes WHERE target_id = 2147483000`);
      assert.strictEqual(rows[0].n, 0);
    });

    await test('QA bank: repeats are no-ops, a change moves one count', async () => {
      for (let i = 0; i < 5; i++) await voteQaBankEntry(qa, 'down', A);
      let r = await voteQaBankEntry(qa, 'down', A);
      assert.deepStrictEqual([r.thumbsUp, r.thumbsDown, r.repeated], [0, 1, true]);
      r = await voteQaBankEntry(qa, 'up', A);
      assert.deepStrictEqual([r.thumbsUp, r.thumbsDown], [1, 0]);
      const { rows } = await pool.query('SELECT rating FROM qa_bank WHERE id = $1', [qa]);
      assert.strictEqual(rows[0].rating, 1);
    });
  } finally {
    await pool.query(`DELETE FROM rag_answer_votes WHERE target_id IN ($1, $2)`, [chunk, qa]);
    await pool.query('DELETE FROM legal_chunks WHERE id = $1', [chunk]);
    await pool.query('DELETE FROM qa_bank WHERE id = $1', [qa]);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
