'use strict';

/**
 * Re-ingest must never leave a law missing from the corpus (audit H-RAG-3).
 * Real Postgres; reads TEST_DATABASE_URL only (see tariff-race.db.test.js).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/rag-safe-reingest.db.test.js
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
  console.log('safe re-ingest');

  await test('ingest paths insert first and delete after (static)', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    const cli = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'ingest-lex.js'), 'utf8');
    assert.ok(!/DELETE FROM legal_chunks WHERE source_url = \$1`, \[cleanUrl\]\);\s*for/.test(server), 'ingestLexUrl no longer deletes first');
    assert.ok(!/DELETE FROM legal_chunks WHERE source_url = \$1 OR doc_id = \$2`/.test(server), 'reingest-registry no longer deletes first');
    assert.ok(/replaceDocumentChunks\(\{ sourceUrl: cleanUrl \}, chunks\)/.test(server));
    assert.ok(/replaceDocumentChunks\(\{ sourceUrl: cleanUrl, docId: law\.doc_id \}, chunks\)/.test(server));
    assert.ok(/code: 'EMBEDDING_FAILED'/.test(server), 'missing vectors stop before touching the corpus');
    assert.ok(/replaceDocumentChunks\(\{ docId: docMeta\.doc_id \}, chunks\)/.test(cli));
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database cases skipped: TEST_DATABASE_URL not set)');
  } else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('refusing to run against what looks like a hosted database');
    process.exit(1);
  } else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool } = require('../src/database/db');
    const { replaceDocumentChunks } = require('../src/rag/advanced-corpus');
    const url = `https://lex.uz/docs/test-${Date.now()}`;
    const count = async (where = '') => (await pool.query(
      `SELECT count(*)::int AS n FROM legal_chunks WHERE source_url = $1 ${where}`, [url])).rows[0].n;
    const insertRows = (texts) => async () => {
      for (const t of texts) {
        await pool.query(`INSERT INTO legal_chunks (law_name, doc_id, source_url, category, chunk_text, chunk_index, article_numbers, source_type)
                          VALUES ('Test kodeksi', 'test-doc', $1, 'test', $2, 0, ARRAY['1'], 'law_text')`, [url, t]);
      }
      return { parents: texts.length, children: 0 };
    };
    const failingInsert = async () => { await insertRows(['partial new'])(); throw new Error('batch 2 dropped'); };

    await insertRows(['old 1', 'old 2'])();

    await test('a failed insert keeps the previous version and removes the partial rows', async () => {
      await assert.rejects(replaceDocumentChunks({ sourceUrl: url }, [{}], { insert: failingInsert }), /previous version kept; 1 partial new rows removed/);
      assert.strictEqual(await count(), 2);
      assert.strictEqual(await count(`AND chunk_text LIKE 'old%'`), 2);
    });

    await test('a successful insert replaces the previous version', async () => {
      const r = await replaceDocumentChunks({ sourceUrl: url }, [{}], { insert: insertRows(['new 1', 'new 2', 'new 3']) });
      assert.strictEqual(r.replaced, 2);
      assert.strictEqual(await count(), 3);
      assert.strictEqual(await count(`AND chunk_text LIKE 'new%'`), 3);
    });

    await test('no chunks is refused before anything is touched', async () => {
      await assert.rejects(replaceDocumentChunks({ sourceUrl: url }, []), /previous version kept/);
      assert.strictEqual(await count(), 3);
    });

    await pool.query('DELETE FROM legal_chunks WHERE source_url = $1', [url]);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
