'use strict';

/**
 * "Hujjatlarim" and data protection E2 (2026-10-29, migration 029):
 * every uploaded document is kept until its owner deletes it (no expiry, no
 * purge, a closed matter does not shorten it); the text is sealed in the
 * database when DATA_KEYS is set and opens only for its own account and
 * file; the list has no text; rename / delete are the owner's only; a full
 * library falls back to the 7-day cache and says so; a kept text document
 * used by a service is billed as text, not as a scan; interview audio,
 * transcripts and consent are sealed too. Needs TEST_DATABASE_URL (throwaway)
 * with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/document-library.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('document library (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ t1: crypto.randomBytes(32).toString('base64') });
const express = require('express');
const { pool } = require('../src/database/db');
const privacy = require('../src/privacy/crypto');
const scans = require('../src/ocr/scan-store');
const ledger = require('../src/rag/tariff-ledger');
const { mountDocumentRoutes } = require('../src/documents/routes');
privacy.reload();

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user') {
  return (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', $2) RETURNING id`, [`dl_${Date.now()}_${rnd()}`, role])).rows[0].id;
}
const hash = () => crypto.randomBytes(32).toString('hex');
const TEXT = 'IJARA SHARTNOMASI\nIjarachi Aziz Karimov (pasport AA1234567) oyiga 5 000 000 so‘m to‘laydi.';

(async () => {
  console.log('document library (db)');
  const a = await makeUser();
  const b = await makeUser();
  let doc;

  await test('kept until deleted: no expiry, the purge leaves it, a 7-day cache row goes', async () => {
    doc = await scans.saveScan(pool, { adminId: a, fileHash: hash(), kind: 'text', pages: 2, bytes: 1200, text: TEXT, chars: TEXT.length, name: 'Ijara.docx' });
    assert.strictEqual(doc.library, true);
    assert.strictEqual(String(doc.expires_at), 'Infinity');
    const cache = await scans.saveScan(pool, { adminId: a, fileHash: hash(), kind: 'image', pages: 1, bytes: 10, text: 'eski kesh matni', library: false });
    await pool.query(`UPDATE document_scans SET expires_at = now() - interval '1 minute' WHERE id = $1`, [cache.id]);
    await scans.purgeExpired(pool);
    assert.ok(await scans.getScan(pool, { adminId: a, scanId: doc.id }));
    assert.ok(!(await pool.query('SELECT 1 FROM document_scans WHERE id = $1', [cache.id])).rows[0]);
  });

  await test('sealed in the database; opens only for its own account and file', async () => {
    const raw = (await pool.query('SELECT text FROM document_scans WHERE id = $1', [doc.id])).rows[0].text;
    assert.ok(raw.startsWith('enc:t1:'));
    assert.ok(!raw.includes('Karimov') && !raw.includes('AA1234567'));
    assert.strictEqual((await scans.getScan(pool, { adminId: a, scanId: doc.id })).text, TEXT);
    assert.strictEqual(await scans.getScan(pool, { adminId: b, scanId: doc.id }), null);
    // the sealed text moved to another account's row does not open there
    const other = await scans.saveScan(pool, { adminId: b, fileHash: hash(), kind: 'text', pages: 1, bytes: 5, text: 'x' });
    await pool.query('UPDATE document_scans SET text = $2 WHERE id = $1', [other.id, raw]);
    await assert.rejects(scans.getScan(pool, { adminId: b, scanId: other.id }), e => e.code === 'DECRYPT_FAILED');
    await pool.query('DELETE FROM document_scans WHERE id = $1', [other.id]);
  });

  await test('the same file again is the same document (one row), its name kept', async () => {
    const h = (await pool.query('SELECT file_hash FROM document_scans WHERE id = $1', [doc.id])).rows[0].file_hash;
    const again = await scans.saveScan(pool, { adminId: a, fileHash: h, kind: 'text', pages: 2, bytes: 1200, text: TEXT, name: 'boshqa.docx' });
    assert.strictEqual(again.id, doc.id);
    assert.strictEqual(again.name, 'Ijara.docx');
  });

  await test('a closed matter does not shorten a kept document', async () => {
    const store = require('../src/matters/store').createMatterStore({ db: pool });
    const m = await store.create(a, { title: 'Ijara nizosi' });
    await store.addItem(m.id, a, { kind: 'scan', ref: doc.id, title: 'Ijara.docx' });
    await store.update(m.id, a, { status: 'closed' });
    assert.strictEqual(String((await pool.query('SELECT expires_at FROM document_scans WHERE id = $1', [doc.id])).rows[0].expires_at), 'Infinity');
  });

  await test('used by a service: billed as a text document (not a scan), last use recorded', async () => {
    const req = { body: { scanId: doc.id }, session: { adminId: a } };
    await new Promise((ok, no) => scans.resolveScans({ pool, ledger })(req, { status: () => ({ json: x => no(new Error(JSON.stringify(x))) }) }, ok));
    assert.strictEqual(req.body.documentText, TEXT);
    const t = ledger.readDocTicket(req.body.docTicket, TEXT);
    assert.ok(t, 'a ticket bound to the text');
    assert.deepStrictEqual([t.scanned, t.pages, t.chars], [false, 2, TEXT.length]);
    await new Promise(r => setTimeout(r, 100));
    assert.ok((await pool.query('SELECT last_used_at FROM document_scans WHERE id = $1', [doc.id])).rows[0].last_used_at);
  });

  await test('a full library: the next document is the 7-day cache, and says so', async () => {
    const was = process.env.DOC_LIBRARY_MAX;
    process.env.DOC_LIBRARY_MAX = '1';
    try {
      const full = await scans.saveScan(pool, { adminId: a, fileHash: hash(), kind: 'text', pages: 1, bytes: 5, text: 'yana bir hujjat' });
      assert.deepStrictEqual([full.library, full.libraryFull], [false, true]);
    } finally { if (was === undefined) delete process.env.DOC_LIBRARY_MAX; else process.env.DOC_LIBRARY_MAX = was; }
  });

  await test('HTTP: the list has no text; rename and delete are the owner\'s only', async () => {
    const app = express();
    app.use(express.json());
    let as = a;
    app.use((req, _r, next) => { req.session = { adminId: as }; next(); });
    const pass = (q, r, n) => n();
    mountDocumentRoutes(app, { pool, requireAuth: pass, requireSameOrigin: pass });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const j = { 'content-type': 'application/json' };
    try {
      const list = await (await fetch(`${base}/api/documents`)).json();
      const row = list.documents.find(d => d.id === doc.id);
      assert.ok(row && row.name === 'Ijara.docx' && row.text === undefined);
      as = b;
      assert.strictEqual((await fetch(`${base}/api/documents/${doc.id}`, { method: 'PATCH', headers: j, body: '{"name":"x"}' })).status, 404);
      assert.strictEqual((await fetch(`${base}/api/documents/${doc.id}`, { method: 'DELETE' })).status, 404);
      assert.ok(!(await (await fetch(`${base}/api/documents`)).json()).documents.some(d => d.id === doc.id));
      as = a;
      assert.strictEqual((await fetch(`${base}/api/documents/${doc.id}`, { method: 'PATCH', headers: j, body: '{"name":"Ijara 2026.docx"}' })).status, 200);
      assert.strictEqual((await fetch(`${base}/api/documents/${doc.id}`, { method: 'DELETE' })).status, 200);
      assert.strictEqual(await scans.getScan(pool, { adminId: a, scanId: doc.id }), null);
    } finally { server.close(); }
  });

  await test('interviews: audio, transcript, consent and summary are sealed in the database', async () => {
    const iv = require('../src/interviews/store');
    const agent = await makeUser('student');
    const matter = (await pool.query(`INSERT INTO matters (owner_id, title) VALUES ($1, 'Intervyu') RETURNING id`, [agent])).rows[0].id;
    const r = await iv.create(pool, { actorId: agent, matterId: matter, audio: Buffer.from('OggS audio'), mime: 'audio/ogg', durationSec: 30,
      consent: { by: 'Nodira Yusupova', at: new Date().toISOString(), method: 'written', note: 'yozma rozilik', ack: true } });
    await iv.transcribe(pool, { id: r.recording.id, stt: { transcribeDetailed: async () => ({ text: 'Biz Excelda ishlaymiz.', segments: [] }) } });
    const rec = (await pool.query('SELECT consent_by, consent_note, title FROM interview_recordings WHERE id = $1', [r.recording.id])).rows[0];
    assert.ok(rec.consent_by.startsWith('enc:') && rec.consent_note.startsWith('enc:'));
    assert.ok(!rec.title.includes('Nodira'), 'the name is not put into the plain title');
    assert.ok((await pool.query('SELECT data FROM interview_audio WHERE recording_id = $1', [r.recording.id])).rows[0].data.subarray(0, 4).toString() === 'JEN1');
    assert.ok((await pool.query('SELECT body FROM interview_transcripts WHERE recording_id = $1', [r.recording.id])).rows[0].body.startsWith('enc:'));
    const g = await iv.get(pool, { id: r.recording.id, actorId: agent });
    assert.deepStrictEqual([g.recording.consent.by, g.recording.consent.note, g.transcript.body], ['Nodira Yusupova', 'yozma rozilik', 'Biz Excelda ishlaymiz.']);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
