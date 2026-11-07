'use strict';

/**
 * The document editor's storage (D1, migration 036): with DATA_KEYS set the
 * HTML is sealed at rest and bound to its document; only the owner reads it;
 * a save names its revision and a stale one is refused with the current one;
 * the first save keeps a version, the next within 10 minutes does not; a
 * named version and a restore (which keeps the current text first) work;
 * account deletion removes the documents.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/editor.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('editor (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ ed: crypto.randomBytes(32).toString('base64') });
require('../src/privacy/crypto').reload();
const { pool } = require('../src/database/db');
const { createEditorStore, deleteAccountDocuments, AUTO_VERSION_MS } = require('../src/editor/store');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const user = async () => (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', 'user') RETURNING id`, [`ed_${Date.now()}_${rnd()}`])).rows[0].id;

(async () => {
  console.log('document editor (db)');
  const store = createEditorStore({ db: pool });
  const a = await user(), b = await user();
  let id;

  await test('created sealed and cleaned; only the owner reads it; the list has no text', async () => {
    id = (await store.create(a, { title: '  Ijara   shartnomasi ', html: '<h1>ТАРТИБ</h1><p>Pasport AA1234567<script>x</script></p>', source: 'draft' })).id;
    const raw = (await pool.query('SELECT html, chars, title FROM doc_editor_documents WHERE id = $1', [id])).rows[0];
    assert.ok(raw.html.startsWith('enc:ed:') && !raw.html.includes('AA1234567'), 'sealed at rest');
    assert.strictEqual(raw.title, 'Ijara shartnomasi');
    const d = await store.get(id, a);
    assert.strictEqual(d.html, '<h1>ТАРТИБ</h1><p>Pasport AA1234567</p>');
    assert.deepStrictEqual([d.revision, d.source, raw.chars], [1, 'draft', 'ТАРТИБ\nPasport AA1234567'.length]);
    assert.strictEqual(await store.get(id, b), null, 'another account: not found');
    const list = await store.list(a);
    assert.ok(list.length === 1 && !('html' in list[0]));
    // a sealed value moved to another document does not open
    const other = (await store.create(a, { title: 'B', html: '<p>b</p>' })).id;
    await pool.query('UPDATE doc_editor_documents SET html = $2 WHERE id = $1', [other, raw.html]);
    await assert.rejects(store.get(other, a));
    await store.remove(other, a);
  });

  await test('a save names its revision: a stale one is refused with the current revision; versions at most every 10 minutes', async () => {
    const t0 = Date.now();
    const s1 = await store.save(id, a, { html: '<p>birinchi</p>', revision: 1 }, t0);
    assert.deepStrictEqual([s1.revision, s1.version], [2, 1], 'the first save keeps a version');
    const s2 = await store.save(id, a, { html: '<p>ikkinchi</p>', revision: 2 }, t0 + 1000);
    assert.deepStrictEqual([s2.revision, s2.version], [3, null], 'not again within 10 minutes');
    await assert.rejects(store.save(id, a, { html: '<p>eski oyna</p>', revision: 2 }), e => e.status === 409 && e.revision === 3);
    await assert.rejects(store.save(id, b, { html: '<p>x</p>', revision: 3 }), e => e.status === 404);
    const s3 = await store.save(id, a, { title: 'Yangi nom', revision: 3 }, t0 + AUTO_VERSION_MS + 5000);
    assert.deepStrictEqual([s3.revision, s3.version], [4, null], 'a title alone keeps no version');
    assert.strictEqual((await store.get(id, a)).html, '<p>ikkinchi</p>');
  });

  await test('named version, its text, and a restore that keeps the current text first', async () => {
    const n = (await store.nameVersion(id, a, 'Mijozga yuborilgan')).number;
    await store.save(id, a, { html: '<p>uchinchi</p>', revision: 4 });
    const r = await store.restore(id, a, n);
    assert.deepStrictEqual([r.html, r.revision], ['<p>ikkinchi</p>', 6]);
    const vs = await store.versions(id, a);
    assert.deepStrictEqual(vs.slice(0, 2).map(v => [v.kind, v.label]), [['restore', `${n}-versiyani tiklashdan oldin`], ['named', 'Mijozga yuborilgan']]);
    assert.strictEqual(await store.versionHtml(id, a, vs[0].number), '<p>uchinchi</p>');
    assert.strictEqual(await store.versions(id, b), null);
    const raw = (await pool.query('SELECT html FROM doc_editor_versions WHERE document_id = $1 LIMIT 1', [id])).rows[0].html;
    assert.ok(raw.startsWith('enc:ed:'), 'versions sealed too');
  });

  await test('D2 comments: sealed, owner only, replies one level deep, resolve, author-only edit, delete with replies, Word export skips resolved', async () => {
    const { createCommentStore } = require('../src/editor/comments');
    const cs = createCommentStore({ db: pool });
    const c1 = (await cs.add(id, a, { body: 'Summani tekshiring', quote: 'ikkinchi' })).id;
    const r1 = (await cs.add(id, a, { body: 'Tekshirdim', parentId: c1 })).id;
    const r2 = (await cs.add(id, a, { body: 'Javobga javob', parentId: r1 })).id;
    const raw = (await pool.query('SELECT body, quote FROM doc_editor_comments WHERE id = $1', [c1])).rows[0];
    assert.ok(raw.body.startsWith('enc:ed:') && raw.quote.startsWith('enc:ed:'), 'sealed at rest');
    const list = await cs.list(id, a);
    assert.deepStrictEqual([list.length, list[0].body, list[0].quote, list[0].replies.map(x => x.id)], [1, 'Summani tekshiring', 'ikkinchi', [r1, r2]], 'a reply to a reply joins the thread');
    assert.strictEqual(await cs.list(id, b), null, 'another account: not found');
    await assert.rejects(cs.add(id, b, { body: 'x' }), e => e.status === 404);
    await assert.rejects(cs.add(id, a, { body: '   ' }), e => e.status === 400);
    await assert.rejects(cs.update(id, a, r1, { resolved: true }), e => e.status === 400, 'a reply is not resolved on its own');
    await cs.importMany(id, a, [{ id: '00000000-0000-4000-8000-0000000000aa', author: 'Acer', date: '2026-10-07T12:06:00Z', text: 'Word izohi', quote: 'so‘z' }]);
    const word = (await cs.list(id, a)).find(t => t.source === 'word');
    assert.deepStrictEqual([word.author, word.authorId, new Date(word.createdAt).toISOString()], ['Acer', a, '2026-10-07T12:06:00.000Z']);
    await cs.update(id, a, c1, { resolved: true, body: 'Summani qayta tekshiring' });
    const exp = await cs.forExport(id, a);
    assert.deepStrictEqual(exp.map(x => x.author), ['Acer'], 'a resolved thread is not exported');
    assert.strictEqual((await cs.list(id, a)).find(t => t.id === c1).body, 'Summani qayta tekshiring');
    assert.strictEqual(await cs.remove(id, b, c1), false);
    assert.strictEqual(await cs.remove(id, a, c1), true);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM doc_editor_comments WHERE id = ANY($1)', [[c1, r1, r2]])).rows[0].n, 0, 'replies go with the thread');
  });

  await test('account deletion removes the documents, their versions and comments', async () => {
    await deleteAccountDocuments(pool, a);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM doc_editor_comments WHERE document_id = $1', [id])).rows[0].n, 0);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM doc_editor_versions WHERE document_id = $1', [id])).rows[0].n, 0);
    assert.strictEqual((await store.list(a)).length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
