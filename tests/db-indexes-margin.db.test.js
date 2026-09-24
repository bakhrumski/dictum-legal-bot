'use strict';

/**
 * Query indexes (migration 010) and the margin report on real Postgres.
 * The margin report joined llm_spend_log on a created_at column the table
 * does not have, so /api/admin/margin-report always failed.
 * Reads TEST_DATABASE_URL only (see tariff-race.db.test.js).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/db-indexes-margin.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('db indexes and margin report');

  await test('migration 010 has a down file and guards every table', () => {
    const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260925_010_query_indexes.sql'), 'utf8');
    const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '20260925_010_query_indexes.down.sql'), 'utf8');
    for (const ix of ['idx_llm_spend_user_ts', 'idx_ai_analyses_request', 'idx_ai_chat_sessions_admin']) {
      assert.ok(up.includes(ix) && down.includes(`DROP INDEX IF EXISTS public.${ix}`), ix);
    }
    assert.strictEqual((up.match(/to_regclass/g) || []).length, 3);
  });

  await test('the margin report reads the spend table column that exists', () => {
    const tiers = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'subscription-tiers.js'), 'utf8');
    assert.ok(/l\.ts >= \$1/.test(tiers));
    assert.ok(!/l\.created_at/.test(tiers));
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database cases skipped: TEST_DATABASE_URL not set)');
  } else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('refusing to run against what looks like a hosted database');
    process.exit(1);
  } else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool } = require('../src/database/db');
    const tiers = require('../src/rag/subscription-tiers');
    const spend = require('../src/rag/llm-spend-log');

    await test('margin report runs and counts spend', async () => {
      await spend.initSpendLog();
      const r = await tiers.marginReport({});
      assert.ok(Array.isArray(r.rows));
      assert.ok(r.totals && typeof r.totals.costUsd === 'number');
    });

    await test('the indexes exist after boot', async () => {
      const r = await pool.query(`SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
        [['idx_ai_analyses_request', 'idx_ai_chat_sessions_admin']]);
      assert.strictEqual(r.rows.length, 2, JSON.stringify(r.rows));
    });

    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
