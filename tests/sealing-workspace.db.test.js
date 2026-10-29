'use strict';

/**
 * Data protection E5 (2026-10-29, migration 032, docs/design/shifrlash-1-bosqich.md
 * §3.1, §3.3, §3.4): with DATA_KEYS set, task comments, the room chat, direct
 * messages, Workspace AI questions / answers / context and document version
 * text are sealed in the database, each bound to its Workspace; every route
 * returns them as they were written. An uploaded file reaches Storage sealed
 * (its row keeps the original's size and sha256), is downloaded through the
 * server - opened, checked against the sha256 - and a file stored plain before
 * E5 still downloads. Another Workspace's file id is 404.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/sealing-workspace.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('sealing E5 (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ e5: crypto.randomBytes(32).toString('base64') });
process.env.SUPABASE_URL = 'https://storage.test.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
const privacy = require('../src/privacy/crypto');
privacy.reload();

// Supabase Storage in memory: what the server sends is what is kept
const objects = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://storage.test.local/storage/v1/')) return realFetch(url, init);
  const path = decodeURIComponent(u.replace(/^.*\/storage\/v1\/object\/(?:authenticated\/)?workspace-documents\//u, ''));
  if (init.method === 'POST' || init.method === 'PUT') {
    objects.set(path, Buffer.from(init.body));
    return new Response(JSON.stringify({ Key: path }), { status: 200 });
  }
  if (!init.method || init.method === 'GET') {
    return objects.has(path) ? new Response(objects.get(path), { status: 200 }) : new Response('{"message":"not found"}', { status: 404 });
  }
  return new Response('{}', { status: 200 });
};

const express = require('express');
const { pool } = require('../src/database/db');
const { withWorkspaceTransaction } = require('../src/workspace/authz');
const { mountWorkspaceRoutes } = require('../src/workspace/routes');
const { createWorkspaceAiService } = require('../src/workspace/ai-service');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const SECRET = 'Aziz Karimov, pasport AA1234567';
const raw = async (sql, args) => JSON.stringify((await pool.query(sql, args)).rows);
async function makeUser(plan = 'gold') {
  return (await pool.query(
    `INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at)
     VALUES ($1, 'x', 'Sinov', 'user', $2, now() + interval '1 day') RETURNING id`, [`e5_${Date.now()}_${rnd()}`, plan])).rows[0].id;
}
async function makeWorkspace(owner, member) {
  const id = await withWorkspaceTransaction(pool, owner, async (c) => (await c.query(
    `INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('E5', $1, $2, $2) RETURNING id`, [`e5-${Date.now()}-${rnd()}`, owner])).rows[0].id);
  if (member) await withWorkspaceTransaction(pool, owner, (c) => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3)`, [id, member, owner]));
  return id;
}

(async () => {
  console.log('sealing E5 (db)');
  const owner = await makeUser();
  const member = await makeUser();
  const ws = await makeWorkspace(owner, member);
  const other = await makeWorkspace(await makeUser());

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => { req.session = { adminId: Number(req.get('x-user')), isAuthenticated: true }; next(); });
  mountWorkspaceRoutes(app, { pool, requireAuth: (req, res, next) => next(), aiService: { ask: async () => ({}) } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (user, method, url, body, isForm) => {
    const r = await fetch(base + url, { method, headers: { 'x-user': String(user), ...(isForm ? {} : { 'Content-Type': 'application/json' }) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: /json/u.test(type) ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };

  let taskId;
  await test('task comments: sealed in the database, read back by the task and after an edit', async () => {
    const t = await call(owner, 'POST', `/api/workspaces/${ws}/tasks`, { title: 'Ijara nizosi', status: 'todo', priority: 'normal' });
    assert.ok(t.status === 201 || t.status === 200, JSON.stringify(t.data));
    taskId = (t.data.task || t.data).id;
    const c = await call(member, 'POST', `/api/workspaces/${ws}/tasks/${taskId}/comments`, { body: SECRET });
    assert.strictEqual(c.status, 201, JSON.stringify(c.data));
    assert.strictEqual(c.data.comment.body, SECRET);
    const r = await raw('SELECT body FROM workspace_task_comments WHERE task_id = $1', [taskId]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e5:'), r);
    const e = await call(member, 'PATCH', `/api/workspaces/${ws}/tasks/${taskId}/comments/${c.data.comment.id}`, { body: `${SECRET} (yangilandi)` });
    assert.strictEqual(e.data.comment.body, `${SECRET} (yangilandi)`);
    const d = await call(owner, 'GET', `/api/workspaces/${ws}/tasks/${taskId}`);
    assert.strictEqual(d.data.comments[0].body, `${SECRET} (yangilandi)`);
  });

  await test('room chat and direct messages: sealed; the thread list shows the last one opened', async () => {
    const m = await call(owner, 'POST', `/api/workspaces/${ws}/messages`, { body: SECRET });
    assert.strictEqual(m.data.message.body, SECRET);
    assert.ok(!(await raw('SELECT body FROM workspace_messages WHERE workspace_id = $1', [ws])).includes('Karimov'));
    assert.strictEqual((await call(member, 'GET', `/api/workspaces/${ws}/messages`)).data.messages[0].body, SECRET);
    const dm = await call(owner, 'POST', `/api/workspaces/${ws}/direct-messages/${member}`, { body: SECRET });
    assert.strictEqual(dm.status, 201, JSON.stringify(dm.data));
    assert.ok(!(await raw('SELECT body FROM workspace_direct_messages WHERE workspace_id = $1', [ws])).includes('Karimov'));
    assert.strictEqual((await call(member, 'GET', `/api/workspaces/${ws}/direct-messages/${owner}`)).data.messages[0].body, SECRET);
    const th = (await call(member, 'GET', `/api/workspaces/${ws}/direct-threads`)).data.threads.find(x => x.id === owner);
    assert.strictEqual(th.last_body, SECRET);
  });

  await test('a sealed message does not open in another Workspace', async () => {
    const row = (await pool.query('SELECT body FROM workspace_messages WHERE workspace_id = $1 LIMIT 1', [ws])).rows[0];
    assert.throws(() => require('../src/workspace/sealing').openMessage({ body: row.body }, other));
  });

  let docId;
  await test('document versions: text and JSON sealed; the versions list and a new version read back', async () => {
    const d = await call(member, 'POST', `/api/workspaces/${ws}/documents`, { taskId, title: 'Xulosa', kind: 'generated', contentText: SECRET, contentJson: { party: SECRET } });
    assert.strictEqual(d.status, 201, JSON.stringify(d.data));
    docId = d.data.document.id;
    assert.strictEqual(d.data.version.content_text, SECRET);
    const r = await raw('SELECT content_text, content_json FROM workspace_document_versions WHERE document_id = $1', [docId]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e5:'), r);
    const v2 = await call(member, 'POST', `/api/workspaces/${ws}/documents/${docId}/versions`, { contentText: `${SECRET} v2` });
    assert.ok(v2.status === 201, JSON.stringify(v2.data));
    const list = (await call(owner, 'GET', `/api/workspaces/${ws}/documents/${docId}/versions`)).data.versions;
    assert.deepStrictEqual([list[0].content_text, list[1].content_text, list[1].content_json.party], [`${SECRET} v2`, SECRET, SECRET]);
  });

  await test('an upload is sealed in Storage and in the version; the download opens it through the server', async () => {
    const original = Buffer.from(`Shartnoma. ${SECRET}. 15 000 000 so'm.`);
    const fd = new FormData();
    fd.append('file', new Blob([original], { type: 'text/plain' }), 'shartnoma.txt');
    fd.append('title', 'shartnoma.txt');
    fd.append('taskId', taskId);
    const up = await call(member, 'POST', `/api/workspaces/${ws}/document-uploads`, fd, true);
    assert.strictEqual(up.status, 201, JSON.stringify(up.data));
    const path = up.data.file.storage_object_path;
    const stored = objects.get(path);
    assert.ok(stored && privacy.isSealedBytes(stored) && !stored.toString('latin1').includes('Karimov'), 'sealed in Storage');
    assert.strictEqual(up.data.file.sha256, crypto.createHash('sha256').update(original).digest('hex'), 'the row keeps the original digest');
    assert.ok(!(await raw('SELECT content_text FROM workspace_document_versions WHERE id = $1', [up.data.version.id])).includes('Karimov'));
    const u = await call(owner, 'POST', `/api/workspaces/${ws}/document-download-url`, { objectPath: path });
    assert.ok(u.data.signedUrl.startsWith(`/api/workspaces/${ws}/document-files/`), u.data.signedUrl);
    const f = await call(owner, 'GET', u.data.signedUrl);
    assert.strictEqual(f.status, 200);
    assert.ok(Buffer.compare(f.data, original) === 0, 'the original bytes');
    assert.match(f.headers.get('content-type'), /^text\/plain/u);
    assert.match(f.headers.get('cache-control'), /no-store/u);
    // a file stored plain before E5 still downloads; bytes that do not match the digest are refused
    objects.set(path, original);
    assert.ok(Buffer.compare((await call(owner, 'GET', u.data.signedUrl)).data, original) === 0);
    objects.set(path, Buffer.from('boshqa'));
    assert.strictEqual((await call(owner, 'GET', u.data.signedUrl)).status, 409);
    // another Workspace's member cannot reach it
    const outsider = await makeUser();
    assert.ok([403, 404].includes((await call(outsider, 'GET', u.data.signedUrl)).status));
    const fileId = u.data.signedUrl.split('/document-files/')[1].split('/')[0];
    assert.strictEqual((await call(owner, 'GET', `/api/workspaces/${other}/document-files/${fileId}/content`)).status === 200, false);
  });

  await test('Workspace AI: the question, the answer, the context and the history are sealed and read back', async () => {
    let historySeen = null, contextSeen = null;
    const ai = createWorkspaceAiService({ pool, generateAnswer: async ({ history, workspaceContext }) => {
      historySeen = history; contextSeen = workspaceContext;
      return { reply: `Javob: ${SECRET}`, provider: 'stub', model: 'stub', usage: { inTokens: 1, outTokens: 1, costUsd: 0 }, citations: [] };
    } });
    const r1 = await ai.ask({ workspaceId: ws, taskId, question: `Savol: ${SECRET}`, userId: member });
    assert.strictEqual(r1.reply, `Javob: ${SECRET}`);
    assert.ok(String(contextSeen).includes('Karimov'), 'the document text reached the AI context opened');
    const runs = await raw('SELECT request_text, context_snapshot FROM workspace_ai_runs WHERE workspace_id = $1', [ws]);
    const msgs = await raw('SELECT content FROM workspace_ai_messages WHERE workspace_id = $1', [ws]);
    assert.ok(!runs.includes('Karimov') && !msgs.includes('Karimov') && msgs.includes('enc:e5:'), msgs.slice(0, 200));
    // the same question again is answered from the team's memory (the reuse path writes sealed too)
    const r3 = await ai.ask({ workspaceId: ws, taskId, threadId: r1.threadId, question: `Savol: ${SECRET}`, userId: member });
    assert.ok(r3.reused, JSON.stringify(r3).slice(0, 200));
    assert.ok(!(await raw('SELECT content FROM workspace_ai_messages WHERE workspace_id = $1', [ws])).includes('Karimov'));
    await ai.ask({ workspaceId: ws, taskId, threadId: r1.threadId, question: 'Yana bir savol', userId: member });
    assert.ok(historySeen.some(m => String(m.content).includes('Karimov')), 'the history reached the AI opened');
    const t = await call(member, 'GET', `/api/workspaces/${ws}/assistant/threads/${r1.threadId}`);
    assert.ok(t.data.messages.some(m => m.content === `Savol: ${SECRET}`) && t.data.messages.some(m => m.content === `Javob: ${SECRET}`));
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
