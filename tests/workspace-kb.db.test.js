'use strict';

/**
 * K2a firm documents (docs/design/firma-bilim-bazasi.md, src/workspace/kb.js):
 * a member adds a document from Hujjatlarim, the editor or the Workspace; its
 * bands are sealed with a blind index and nothing of the words is in the
 * table; search finds every word's root in any form and alphabet, then half
 * the words when few match; a viewer searches but cannot add; a stranger 404;
 * the same text twice 409; taking a document out deletes its bands. No AI.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/workspace-kb.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CONTRACT = `YETKAZIB BERISH SHARTNOMASI

1. Shartnoma predmeti
Sotuvchi xaridorga tovarni yetkazib beradi, xaridor uni qabul qilib, haqini to'laydi.

2. Narx va to'lov
2.1. Tovar narxi 120 000 000 so'm.
2.2. To'lov tovar qabul qilingandan keyin 10 bank kuni ichida amalga oshiriladi.

=== PAGE 2 ===
3. Javobgarlik
3.1. To'lov kechiktirilsa, xaridor har bir kechiktirilgan kun uchun 0,1 foiz miqdorida penya to'laydi.
3.2. Penyaning umumiy miqdori shartnoma bahosining 10 foizidan oshmaydi.

4. Fors-major
Tomonlar yengib bo'lmaydigan kuch holatlarida javobgar bo'lmaydi.`;

(async () => {
  console.log('Firm documents (K2a)');
  const K = require('../src/workspace/kb');

  await test('bands: by clause numbers and paragraphs, a hit is placed by the page mark and clause above it; marks are never shown', () => {
    const long = Array.from({ length: 30 }, (_, i) => `${i + 1}. ${'Band matni shartnoma shartlari haqida batafsil yozilgan. '.repeat(8)}`).join('\n\n');
    const c = K.splitChunks(long);
    assert.ok(c.length >= 8 && c.every(x => x.text.length <= 3000) && c[1].label, 'several bands, each labelled by its clause');
    // the mark stays in the stored band (it places a hit) and is never shown
    const bands = K.splitChunks(CONTRACT);
    assert.ok(bands.some(x => /=== PAGE 2 ===/.test(x.text)) && bands.every(x => !/=== PAGE/.test(K.shown(x.text))));
    const hit = K.locate(bands[0].text, 'penya', bands[0]);
    assert.deepStrictEqual([hit.page, hit.label], [2, '3.1'], 'the page and clause of the hit itself');
    assert.strictEqual(K.locate(bands[0].text, 'predmeti', bands[0]).page, 1, 'before the first mark: page 1');
    assert.ok(!/=== PAGE/.test(hit.passage));
    const paged = K.splitChunks(`${'Birinchi sahifa matni. '.repeat(100)}\n\n=== PAGE 2 ===\n${'Ikkinchi sahifa matni. '.repeat(100)}`);
    assert.strictEqual(paged[paged.length - 1].page, 2);
  });

  await test('wiring: routes mounted with auth and same-origin writes; no AI, no embeddings', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../workspace/kb').mountKnowledgeBaseRoutes(app, { db: pool, requireAuth, requireSameOrigin: require('../auth/same-origin').requireSameOrigin })"));
    assert.ok(server.indexOf('mountKnowledgeBaseRoutes(app') < server.indexOf('mountWorkspaceRoutes(app'));
    const src = fs.readFileSync(path.join(__dirname, '../src/workspace/kb.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const r of ["app.post('/api/workspaces/:id/kb', requireSameOrigin, requireAuth", "app.post('/api/workspaces/:id/kb/search', requireSameOrigin, requireAuth", "app.delete('/api/workspaces/:id/kb/:doc', requireSameOrigin, requireAuth"]) assert.ok(src.includes(r), r);
    assert.ok(!/callAI|callCheapAI|callOpenAI|getEmbedding|embedding/.test(src));
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 5).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  const { pool } = require('../src/database/db');
  const privacy = require('../src/privacy/crypto');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const kb = K.createKnowledgeBase({ db: pool });
  const scans = require('../src/ocr/scan-store');
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async () => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', 'Sinov', 'user', 'silver', now() + interval '1 day') RETURNING id`, [`kb_${rnd()}`])).rows[0].id;
    made.push(id); return id;
  };
  const owner = await mkUser(), member = await mkUser(), viewer = await mkUser(), stranger = await mkUser();
  const ws = (await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma', $1, $2, $2) RETURNING id`, [`kb-${rnd()}`, owner]))).rows[0].id;
  for (const [u, role] of [[member, 'member'], [viewer, 'viewer']]) await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)`, [ws, u, role, owner]));
  const scan = await scans.saveScan(pool, { adminId: member, fileHash: require("crypto").createHash("sha256").update(String(rnd())).digest("hex"), kind: 'text', pages: 2, bytes: 5000, text: CONTRACT, provider: 'text', name: 'Yetkazib berish.docx' });
  const scanId = scan.id || scan.scanId || scan;

  let docId;
  await test('a member adds a Hujjatlarim document: bands sealed, the index holds hashes only', async () => {
    const out = await kb.add(ws, member, { from: { kind: 'library', id: scanId }, tags: ['shartnoma'] });
    docId = out.id;
    assert.ok(out.chunks >= 1 && out.name === 'Yetkazib berish.docx');
    const rows = (await pool.query('SELECT text, bidx FROM workspace_kb_chunks WHERE document_id = $1', [docId])).rows;
    assert.ok(rows.every(r => /^enc:t1:/.test(r.text) && !r.text.includes('penya')), 'sealed');
    assert.ok(rows.every(r => Array.isArray(r.bidx) && r.bidx.length && r.bidx.every(h => /^[0-9a-f]{16}$/.test(h))), 'hashes only');
    await assert.rejects(kb.add(ws, member, { from: { kind: 'library', id: scanId } }), e => e.status === 409 && e.code === 'already_added');
  });

  await test('roles: a viewer searches but cannot add (403); a stranger 404; another member\'s Hujjatlarim document cannot be added (404)', async () => {
    await assert.rejects(kb.add(ws, viewer, { from: { kind: 'library', id: scanId } }), e => e.status === 403);
    await assert.rejects(kb.search(ws, stranger, { q: 'penya' }), e => e.status === 404);
    await assert.rejects(kb.add(ws, owner, { from: { kind: 'library', id: scanId } }), e => e.status === 404, 'the owner cannot take the member\'s own document');
    const r = await kb.search(ws, viewer, { q: 'penya' });
    assert.ok(r.results.length >= 1 && r.mode === 'index');
  });

  await test('search: word roots in any form and both alphabets; a passage around the word; the page and clause given', async () => {
    const a = await kb.search(ws, viewer, { q: 'penyaning miqdori' });
    assert.ok(a.results[0] && /Penya/.test(a.results[0].passage) && a.results[0].documentId === docId && !a.results[0].partial, JSON.stringify(a));
    assert.ok((await kb.search(ws, viewer, { q: 'yetkazib berishi' })).results.length >= 1, 'another ending');
    assert.ok((await kb.search(ws, viewer, { q: 'Toʻlov kechiktirilsa' })).results.length >= 1, 'the apostrophe form');
    const late = (await kb.search(ws, viewer, { q: 'kechiktirilgan kun penya' })).results[0];
    assert.ok(late.page === 2 || late.label, 'where it stands');
    assert.deepStrictEqual((await kb.search(ws, viewer, { q: 'ijara' })).results, [], 'a word not in the document');
    assert.deepStrictEqual((await kb.search(ws, viewer, { q: '' })).results, []);
  });

  await test('few whole matches: bands with half the words come after, marked partial', async () => {
    const r = await kb.search(ws, viewer, { q: 'penya foiz arbitraj' });
    assert.ok(r.results.length >= 1 && r.results.every(x => x.partial), JSON.stringify(r.results.map(x => x.partial)));
    assert.deepStrictEqual((await kb.search(ws, viewer, { q: 'penya arbitraj ijara sudga' })).results, [], 'less than half: nothing');
  });

  await test('an editor document and a Workspace document can be added; a band opens whole', async () => {
    const html = '<h1>Ijara shartnomasi</h1><p>1. Ijarachi oyiga ijara haqini to\'laydi.</p><p>2. Ijara muddati bir yil, uzaytirilishi mumkin.</p>';
    const ed = (await pool.query(`INSERT INTO doc_editor_documents (owner_id, title, source, html, chars) VALUES ($1, 'Ijara', 'blank', '', 0) RETURNING id`, [member])).rows[0].id;
    await pool.query('UPDATE doc_editor_documents SET html = $2 WHERE id = $1', [ed, privacy.seal(html, `doc_editor_documents.html:${ed}`)]);
    const e = await kb.add(ws, member, { from: { kind: 'editor', id: ed } });
    await assert.rejects(kb.add(ws, owner, { from: { kind: 'editor', id: ed } }), e2 => e2.status === 404, 'not readable by the owner');
    const hit = (await kb.search(ws, viewer, { q: 'ijara muddati' })).results.find(x => x.documentId === e.id);
    assert.ok(hit);
    const full = await kb.chunk(ws, e.id, hit.n, viewer);
    assert.ok(/uzaytirilishi mumkin/.test(full.text));
    const wd = (await withWorkspaceTransaction(pool, member, c => c.query(`INSERT INTO workspace_documents (workspace_id, title, kind, created_by) VALUES ($1, 'Ichki tartib', 'generated', $2) RETURNING id`, [ws, member]))).rows[0].id;
    await withWorkspaceTransaction(pool, member, c => c.query(`INSERT INTO workspace_document_versions (workspace_id, document_id, version_number, content_text, created_by) VALUES ($1, $2, 1, $3, $4)`,
      [ws, wd, privacy.seal('Ichki mehnat tartibi qoidalari: ish vaqti soat 9 dan 18 gacha, tushlik tanaffusi bir soat.', `workspace_document_versions.content_text:${ws}:${wd}`), member]));
    await kb.add(ws, member, { from: { kind: 'workspace_doc', id: wd } });
    assert.ok((await kb.search(ws, viewer, { q: 'tushlik tanaffusi' })).results.length === 1);
  });

  await test('list without text; taking a document out deletes its bands and frees the text for a new add', async () => {
    const l = await kb.list(ws, viewer);
    assert.ok(l.documents.length === 3 && l.used.documents === 3 && !JSON.stringify(l).includes('penya'));
    await assert.rejects(kb.remove(ws, docId, viewer), e => e.status === 403);
    await kb.remove(ws, docId, member);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM workspace_kb_chunks WHERE document_id = $1', [docId])).rows[0].n, 0);
    assert.deepStrictEqual((await kb.search(ws, viewer, { q: 'penya' })).results, []);
    const again = await kb.add(ws, member, { from: { kind: 'library', id: scanId } });
    assert.ok(again.id && again.id !== docId);
  });

  await test('limits: documents a Workspace (WS_KB_MAX_DOCS); a text too short is refused', async () => {
    process.env.WS_KB_MAX_DOCS = '3';
    const s2 = await scans.saveScan(pool, { adminId: member, fileHash: require("crypto").createHash("sha256").update(String(rnd())).digest("hex"), kind: 'text', pages: 1, bytes: 100, text: 'Boshqa hujjat matni, yetarlicha uzun bo\'lishi kerak bo\'lgan qism shu yerda.', provider: 'text', name: 'b.docx' });
    await assert.rejects(kb.add(ws, member, { from: { kind: 'library', id: s2.id || s2 } }), e => e.status === 409 && e.code === 'too_many');
    delete process.env.WS_KB_MAX_DOCS;
    const s3 = await scans.saveScan(pool, { adminId: member, fileHash: require("crypto").createHash("sha256").update(String(rnd())).digest("hex"), kind: 'text', pages: 1, bytes: 10, text: 'Qisqa.', provider: 'text', name: 'c.docx' });
    await assert.rejects(kb.add(ws, member, { from: { kind: 'library', id: s3.id || s3 } }), e => e.status === 422);
  });

  await pool.query('DELETE FROM doc_editor_documents WHERE owner_id = $1', [member]).catch(() => {});
  await pool.query('DELETE FROM document_scans WHERE admin_id = $1', [member]).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
