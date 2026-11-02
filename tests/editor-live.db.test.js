'use strict';

/**
 * The document editor, D3 (docs/design/hujjat-muharriri.md; migration 038):
 * sharing by link and live co-editing.
 *   - a link is kept as its sha256 only, shown once; joining needs a signed-in
 *     account and the button; a second link keeps the higher role; revoked or
 *     expired links say so; the owner changes roles and removes; a member leaves;
 *   - roles: a viewer reads only, a commenter comments but does not resolve or
 *     write, an editor writes; anyone else is "not found";
 *   - live: two editors on one document see each other's changes through our
 *     own WebSocket; a viewer's changes are dropped; the state is sealed and
 *     saved; the first editor seeds an empty session; a socket without this
 *     site's Origin, a session or access is refused; a restore closes the
 *     session (4000) and the next one starts from the restored text.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/editor-live.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
if (!process.env.TEST_DATABASE_URL) {
  console.log('editor live (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ lv: crypto.randomBytes(32).toString('base64') });
require('../src/privacy/crypto').reload();
const { pool } = require('../src/database/db');
const { createEditorStore } = require('../src/editor/store');
const { createCommentStore } = require('../src/editor/comments');
const { createSharing } = require('../src/editor/sharing');
const live = require('../src/editor/live');
const Y = require('yjs');
const WebSocket = require('ws');
const syncProtocol = require('y-protocols/sync');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const user = async (name) => (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', $2, 'user') RETURNING id`, [`lv_${Date.now()}_${rnd()}`, name])).rows[0].id;
const wait = ms => new Promise(r => setTimeout(r, ms));

/** A minimal live client: the page's protocol (public/vendor/editor/entry.js LiveDoc) in Node. */
function client(port, docId, adminId, { origin = `http://127.0.0.1:${port}` } = {}) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/editor/live?doc=${docId}`, { headers: { origin, 'x-test-admin': String(adminId) } });
  const c = { doc, ws, controls: [], synced: false, closedCode: null, refused: null };
  doc.on('update', (u, o) => { if (o === c) return; const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeUpdate(e, u); if (ws.readyState === 1) ws.send(encoding.toUint8Array(e)); });
  ws.on('open', () => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); syncProtocol.writeSyncStep1(e, doc); ws.send(encoding.toUint8Array(e)); });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { c.controls.push(JSON.parse(String(data))); return; }
    const d = decoding.createDecoder(new Uint8Array(data));
    if (decoding.readVarUint(d) !== 0) return;
    const e = encoding.createEncoder(); encoding.writeVarUint(e, 0);
    const kind = syncProtocol.readSyncMessage(d, e, doc, c);
    if (encoding.length(e) > 1) ws.send(encoding.toUint8Array(e));
    if (kind === syncProtocol.messageYjsSyncStep2) c.synced = true;
  });
  ws.on('close', (code) => { c.closedCode = code; });
  ws.on('unexpected-response', (req, res) => { c.refused = res.statusCode; });
  ws.on('error', () => {});
  c.text = () => doc.getText('t').toString();
  c.type = (s) => doc.getText('t').insert(doc.getText('t').length, s);
  return c;
}

(async () => {
  console.log('document editor: sharing and live (db)');
  const store = createEditorStore({ db: pool });
  const comments = createCommentStore({ db: pool });
  const sharing = createSharing({ db: pool });
  const owner = await user('Aziz Karimov'), ed = await user('Dilnoza Ergasheva'), com = await user('Bobur Toshev'), view = await user('Sardor Aliyev'), out = await user('Begona');
  const id = (await store.create(owner, { title: 'Ijara shartnomasi', html: '<p>Birinchi band.</p>' })).id;
  let tokEditor, tokCom;

  await test('a link is its sha256 only, shown once; joining keeps the higher role; revoke and expiry say so', async () => {
    const i1 = await sharing.createInvite(id, owner, { role: 'editor' });
    tokEditor = i1.token;
    assert.ok(/^[A-Za-z0-9_-]{30,60}$/u.test(i1.token));
    const raw = (await pool.query('SELECT token_hash FROM doc_editor_invites WHERE id = $1', [i1.id])).rows[0].token_hash;
    assert.ok(raw !== i1.token && /^[0-9a-f]{64}$/u.test(raw), 'only the hash is stored');
    await assert.rejects(sharing.createInvite(id, ed, { role: 'editor' }), e => e.status === 404, 'not the owner: no link');
    const p = await sharing.preview(i1.token, ed);
    assert.deepStrictEqual([p.title, p.ownerName, p.role, p.already], ['Ijara shartnomasi', 'Aziz Karimov', 'editor', null]);
    assert.deepStrictEqual(await sharing.accept(i1.token, ed), { documentId: id, role: 'editor' });
    tokCom = (await sharing.createInvite(id, owner, { role: 'commenter' })).token;
    assert.strictEqual((await sharing.accept(tokCom, ed)).role, 'editor', 'a lower link does not lower a member');
    await sharing.accept(tokCom, com);
    const vi = await sharing.createInvite(id, owner, { role: 'viewer' });
    await sharing.accept(vi.token, view);
    assert.deepStrictEqual(await sharing.accept(vi.token, owner), { documentId: id, role: 'owner' });
    await sharing.revokeInvite(id, owner, vi.id);
    await assert.rejects(sharing.accept(vi.token, out), e => e.status === 410);
    const ex = await sharing.createInvite(id, owner);
    await pool.query("UPDATE doc_editor_invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [ex.id]);
    assert.strictEqual(await sharing.preview(ex.token, out), null);
    assert.strictEqual((await sharing.invites(id, owner)).length, 2, 'revoked and expired links are not listed');
    const names = (await sharing.members(id, view)).map(m => [m.name, m.role]);
    assert.deepStrictEqual(names, [['Aziz Karimov', 'owner'], ['Dilnoza Ergasheva', 'editor'], ['Bobur Toshev', 'commenter'], ['Sardor Aliyev', 'viewer']]);
    await assert.rejects(sharing.members(id, out), e => e.status === 404);
  });

  await test('roles: viewer reads only; commenter comments but neither writes nor resolves; editor writes; outsider 404; the list shows shared documents', async () => {
    assert.strictEqual((await store.get(id, view)).role, 'viewer');
    assert.strictEqual(await store.get(id, out), null);
    const rev = (await store.get(id, owner)).revision;
    await assert.rejects(store.save(id, view, { html: '<p>x</p>', revision: rev }), e => e.status === 403);
    await assert.rejects(store.save(id, com, { html: '<p>x</p>', revision: rev }), e => e.status === 403);
    await assert.rejects(comments.add(id, view, { body: 'x' }), e => e.status === 403);
    const c = (await comments.add(id, com, { body: 'Summani tekshiring', quote: 'Birinchi' })).id;
    await assert.rejects(comments.update(id, com, c, { resolved: true }), e => e.status === 403, 'a commenter does not resolve');
    await comments.update(id, ed, c, { resolved: true });
    await assert.rejects(comments.remove(id, ed, c), e => e.status === 403, "not the author's own: only the owner removes it");
    assert.strictEqual((await store.save(id, ed, { html: '<p>Tahrir</p>', revision: rev })).revision, rev + 1);
    await assert.rejects(store.remove(id, ed).then(ok => { if (!ok) throw Object.assign(new Error('x'), { status: 404 }); }), e => e.status === 404, 'only the owner deletes');
    const shared = (await store.list(com)).find(d => d.id === id);
    assert.deepStrictEqual([shared.role, shared.owner_name], ['commenter', 'Aziz Karimov']);
    await sharing.setRole(id, owner, com, 'viewer');
    assert.strictEqual((await store.get(id, com)).role, 'viewer');
    await sharing.setRole(id, owner, com, 'commenter');
  });

  // a real HTTP server with the live endpoint; the session comes from a test header (the app uses its cookie)
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fakeSession = (req, res, next) => { const a = Number(req.headers['x-test-admin']); req.session = a ? { adminId: a } : {}; next(); };
  const hub = live.attachLive(server, { sessionMiddleware: fakeSession, pool, store, allowedOrigin: (req) => req.headers.origin === `http://127.0.0.1:${port}` });

  await test('live: two editors see each other, a viewer\'s changes are dropped, the first editor seeds, the state is sealed and saved', async () => {
    const a = client(port, id, owner), b = client(port, id, ed), v = client(port, id, view);
    await wait(500);
    assert.ok(a.synced && b.synced && v.synced, 'all synced');
    const initA = a.controls.find(m => m.type === 'init'), initB = b.controls.find(m => m.type === 'init'), initV = v.controls.find(m => m.type === 'init');
    assert.deepStrictEqual([initA.role, initA.seed, initB.seed, initV.role, initV.seed], ['owner', true, false, 'viewer', false], 'one seeder');
    a.type('Salom ');
    await wait(200);
    b.type('dunyo');
    await wait(300);
    assert.strictEqual(a.text(), 'Salom dunyo'); assert.strictEqual(b.text(), 'Salom dunyo'); assert.strictEqual(v.text(), 'Salom dunyo');
    v.type(' (o‘quvchi)');
    await wait(300);
    assert.strictEqual(a.text(), 'Salom dunyo', "a viewer's change never reaches the others");
    assert.ok(hub.isLiveEditor(id, ed) && !hub.isLiveEditor(id, view));
    hub.broadcast(id, { type: 'comments' });
    await wait(100);
    assert.ok(b.controls.some(m => m.type === 'comments'));
    for (const c of [a, b, v]) c.ws.close();
    await wait(400);
    const raw = (await pool.query('SELECT ystate FROM doc_editor_documents WHERE id = $1', [id])).rows[0].ystate;
    assert.ok(raw && !raw.toString('latin1').includes('Salom'), 'saved and sealed');
    const again = client(port, id, ed);
    await wait(400);
    assert.strictEqual(again.text(), 'Salom dunyo', 'the next session starts from the saved state');
    assert.strictEqual(again.controls.find(m => m.type === 'init').seed, false);
    again.ws.close(); await wait(200);
  });

  await test('live: no Origin of this site, no session or no access is refused; a removed member is closed (4003); a restore closes all (4000) and clears the state', async () => {
    const bad = client(port, id, owner, { origin: 'https://evil.example' });
    const noSess = client(port, id, 0);
    const stranger = client(port, id, out);
    await wait(300);
    assert.deepStrictEqual([bad.refused, noSess.refused, stranger.refused], [403, 401, 404]);
    const b = client(port, id, ed), c = client(port, id, com);
    await wait(300);
    await sharing.removeMember(id, owner, com);
    await hub.close(id, { adminId: com, code: 4003 });
    await wait(200);
    assert.strictEqual(c.closedCode, 4003);
    await store.nameVersion(id, owner, 'v');
    const n = (await store.versions(id, owner))[0].number;
    await store.restore(id, owner, n);
    await hub.close(id, { code: 4000 });
    await wait(300);
    assert.strictEqual(b.closedCode, 4000);
    assert.strictEqual((await pool.query('SELECT ystate FROM doc_editor_documents WHERE id = $1', [id])).rows[0].ystate, null, 'the next session starts from the restored html');
  });

  await test('a save outside a live session clears the live state; a live snapshot skips the revision', async () => {
    await store.saveLiveState(id, Y.encodeStateAsUpdate(new Y.Doc()));
    const rev = (await store.get(id, owner)).revision;
    await store.save(id, owner, { html: '<p>Yolg‘iz</p>', revision: rev });
    assert.strictEqual((await pool.query('SELECT ystate FROM doc_editor_documents WHERE id = $1', [id])).rows[0].ystate, null);
    const r2 = await store.save(id, ed, { html: '<p>Jonli</p>', revision: 1, live: true });
    assert.strictEqual(r2.revision, rev + 2, 'a stale revision is fine for a live snapshot, and it still moves on');
    const { isSameOrigin } = require('../src/auth/same-origin');
    assert.strictEqual(isSameOrigin({ headers: { host: 'juristai.uz', origin: 'https://juristai.uz' } }), true);
    assert.strictEqual(isSameOrigin({ headers: { host: 'juristai.uz', origin: 'https://evil.uz' } }), false);
    assert.strictEqual(isSameOrigin({ headers: { host: 'juristai.uz' } }), false, 'a socket without Origin is refused');
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
