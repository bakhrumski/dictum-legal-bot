'use strict';

/**
 * X6 of the 2026-11-10 audit (C1, C2): the long-document digest kept in the database
 * (src/rag/digest-store.js, migration 050) - the same person's next service on the same text
 * reuses it across restarts; sealed; another account never reads it; it goes with the document
 * and the account. The "source suggestions" helper runs on the cheap lane.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/digest-store.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('digest store and cheap helpers (X6)');
  const server = read('src', 'api', 'server.js');

  await test('wiring: memory first, then the store, then the AI; only a digest read whole is stored; the suggestions helper is cheap', () => {
    const fn = server.slice(server.indexOf('async function digestLongDocumentDetailed'), server.indexOf('// ── Yuridik xulosa (structured legal opinion'));
    const order = ['DIGEST_CACHE.get(cacheKey)', "digestStore.get(pool, { adminId: userId, text: documentText })", "buildDigest(documentText"].map(x => fn.indexOf(x));
    assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'the AI is the last resort');
    assert.ok(/if \(userId && !digest\.failed\.length && !digest\.truncated\.length\) \{\s+remember\(digest\);\s+digestStore\.put\(pool, \{ adminId: userId, text: documentText, digest \}\)/.test(fn));
    assert.ok(/const stored = userId \? await digestStore\.get/.test(fn), 'never for an anonymous caller');
    const help = server.slice(server.indexOf('async function identifyRelevantLaws'), server.indexOf('async function generateSourceSuggestions'));
    assert.ok(help.includes("await callCheapAI([{ role: 'user', text: prompt }], { useSearch: false, maxTokens: 300, temperature: 0, endpoint: '/rag/source-suggestions' })") && !/await callAI\(/.test(help));
    assert.ok(read('src', 'ocr', 'scan-store.js').includes("require('../rag/digest-store').removeForText(db, { adminId, text: doc.text })"));
    assert.ok(read('src', 'services', 'account-deletion.js').includes("require('../rag/digest-store').removeForAccount(db, adminId)"));
    assert.ok(!/callAI|callCheapAI|callOpenAI/.test(read('src', 'rag', 'digest-store.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'no AI in the store');
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 7).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  const { pool } = require('../src/database/db');
  const S = require('../src/rag/digest-store');
  const mk = async (n) => (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', $2, 'user') RETURNING id`, [`dg_${Date.now()}_${n}`, 'Dayjest ' + n])).rows[0].id;
  const a = await mk(1), b = await mk(2);
  const text = 'Ijara shartnomasi. '.repeat(900);
  const digest = { text: '1.1 | Ijarachi → to‘laydi | muddat: har oy', chunks: 5, parts: 5, failed: [], truncated: [], plan: { fit: 'ok' } };

  try {
    await test('a digest is kept sealed and read back by its owner; a miss for another text, another account and an unknown account', async () => {
      assert.strictEqual(await S.get(pool, { adminId: a, text }), null, 'nothing yet');
      assert.strictEqual(await S.put(pool, { adminId: a, text, digest }), true);
      const raw = (await pool.query('SELECT digest, chars, uses FROM doc_digests WHERE admin_id = $1', [a])).rows[0];
      assert.ok(raw.digest && typeof raw.digest.enc === 'string' && raw.digest.enc.startsWith('enc:') && !JSON.stringify(raw.digest).includes('Ijarachi'), 'sealed');
      assert.strictEqual(raw.chars, text.length);
      assert.deepStrictEqual(await S.get(pool, { adminId: a, text }), digest);
      assert.strictEqual((await pool.query('SELECT uses FROM doc_digests WHERE admin_id = $1', [a])).rows[0].uses, 1);
      assert.strictEqual(await S.get(pool, { adminId: b, text }), null, 'another account never reads it');
      assert.strictEqual(await S.get(pool, { adminId: a, text: text + ' ' }), null, 'one character more is another document');
      assert.strictEqual(await S.get(pool, { adminId: null, text }), null);
    });
    await test('a row moved to another account does not open there; a broken row is a miss, not an error', async () => {
      await pool.query('INSERT INTO doc_digests (admin_id, text_sha256, version, digest, chars, expires_at) SELECT $2, text_sha256, version, digest, chars, expires_at FROM doc_digests WHERE admin_id = $1', [a, b]);
      assert.strictEqual(await S.get(pool, { adminId: b, text }), null, 'the seal is bound to the account');
      await pool.query('DELETE FROM doc_digests WHERE admin_id = $1', [b]);
    });
    await test('it expires; a later write renews it; off reads and writes nothing', async () => {
      await pool.query(`UPDATE doc_digests SET expires_at = now() - interval '1 minute' WHERE admin_id = $1`, [a]);
      assert.strictEqual(await S.get(pool, { adminId: a, text }), null);
      await S.put(pool, { adminId: a, text, digest: { ...digest, chunks: 6 } });
      assert.strictEqual((await S.get(pool, { adminId: a, text })).chunks, 6);
      process.env.DOC_DIGEST_STORE = 'off';
      assert.strictEqual(await S.get(pool, { adminId: a, text }), null);
      assert.strictEqual(await S.put(pool, { adminId: b, text, digest }), false);
      delete process.env.DOC_DIGEST_STORE;
      assert.strictEqual(await S.put(pool, { adminId: a, text, digest: { chunks: 1 } }), false, 'not a digest');
    });
    await test('deleting the library document removes its digest; account deletion removes the rest', async () => {
      const store = require('../src/ocr/scan-store');
      const row = await store.saveScan(pool, { adminId: a, fileHash: store.fileHash(Buffer.from(text)), kind: 'text', pages: 5, bytes: text.length, text, chars: text.length, name: 'ijara.docx' });
      assert.ok(await S.get(pool, { adminId: a, text }));
      assert.strictEqual(await store.deleteDoc(pool, { adminId: a, id: row.id }), true);
      assert.strictEqual(await S.get(pool, { adminId: a, text }), null, 'gone with the document');
      await S.put(pool, { adminId: a, text, digest });
      await S.removeForAccount(pool, a);
      assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM doc_digests WHERE admin_id = $1', [a])).rows[0].n, 0);
    });
  } finally {
    await pool.query('DELETE FROM document_scans WHERE admin_id = ANY($1::int[])', [[a, b]]).catch(() => {});
    await pool.query('DELETE FROM doc_digests WHERE admin_id = ANY($1::int[])', [[a, b]]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [[a, b]]).catch(() => {});
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
