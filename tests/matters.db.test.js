'use strict';

/**
 * Matters on a real Postgres (2026-10-28, src/matters/store.js, routes.js,
 * migration 019): ownership, Workspace roles, another account's matter and
 * sources as 404, limits by plan, scans held while a matter is open, account
 * deletion. The routes run on a small Express app with a stub session. Needs
 * TEST_DATABASE_URL (throwaway) with the migrations applied - CI runs it after
 * the boot smoke.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/matters.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('matters (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const express = require('express');
const { pool } = require('../src/database/db');
const ledger = require('../src/rag/tariff-ledger');
const { createMatterStore, deleteAccountMatters, MAX_OPEN_TRIAL } = require('../src/matters/store');
const { mountMatterRoutes } = require('../src/matters/routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const users = [];

async function makeUser(plan = null) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Matter Test', 'user') RETURNING id`,
    [`mt_${Date.now()}_${rnd()}`]);
  const id = r.rows[0].id;
  users.push(id);
  if (plan) await ledger.grantPaidPeriod({ adminId: id, plan, paymentRef: `mt-${id}-${rnd()}` });
  return id;
}
async function makeChat(adminId, title = 'Pudrat savoli') {
  const r = await pool.query(`INSERT INTO ai_chat_sessions (admin_id, title, messages) VALUES ($1, $2, '[]'::jsonb) RETURNING id`, [adminId, title]);
  return r.rows[0].id;
}
async function makeScan(adminId) {
  const r = await pool.query(
    `INSERT INTO document_scans (admin_id, file_hash, kind, pages, bytes, text, chars, expires_at)
     VALUES ($1, $2, 'pdf', 2, 100, 'matn', 4, now() + interval '7 days') RETURNING id`,
    [adminId, require('crypto').createHash('sha256').update(String(rnd())).digest('hex')]);
  return r.rows[0].id;
}
const expiresInDays = async (scanId) => {
  const r = await pool.query(`SELECT extract(epoch FROM expires_at - now()) / 86400 AS d FROM document_scans WHERE id = $1`, [scanId]);
  return Number(r.rows[0].d);
};
/** A Workspace with members, inserted past the Platinum triggers (a throwaway test database). */
async function makeWorkspace(ownerId, members = []) {
  const c = await pool.connect();
  try {
    await c.query(`SET session_replication_role = replica`);
    const w = await c.query(
      `INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma', $1, $2, $2) RETURNING id`,
      [`mt-${Date.now()}-${rnd()}`, ownerId]);
    const id = w.rows[0].id;
    await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, ownerId]);
    for (const [user, role] of members) await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [id, user, role]);
    return id;
  } finally {
    await c.query(`SET session_replication_role = origin`).catch(() => {});
    c.release();
  }
}

function app(sessionOf) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = { adminId: sessionOf() }; next(); });
  mountMatterRoutes(a, { requireAuth: (_q, _s, n) => n(), requireSameOrigin: (_q, _s, n) => n(), pool, resolveEntitlement: ledger.resolveEntitlement });
  return a;
}
async function http(a, method, url, body) {
  const server = a.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally { server.close(); }
}

(async () => {
  console.log('matters (db)');
  const store = createMatterStore({ db: pool, resolveEntitlement: ledger.resolveEntitlement });

  await test('the owner creates, reads, renames and closes a matter; another account gets 404 on every route', async () => {
    const owner = await makeUser('silver');
    const other = await makeUser('silver');
    let who = owner;
    const a = app(() => who);
    const created = await http(a, 'POST', '/api/matters', { title: '  Pudratchi bilan nizo ', summary: 'Avans qaytarilmayapti' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.title, 'Pudratchi bilan nizo');
    const id = created.body.id;
    assert.strictEqual((await http(a, 'GET', `/api/matters/${id}`)).body.items.length, 0);
    assert.strictEqual((await http(a, 'PATCH', `/api/matters/${id}`, { title: 'Pudrat nizosi' })).body.title, 'Pudrat nizosi');

    who = other;
    for (const [m, u, b] of [['GET', `/api/matters/${id}`], ['PATCH', `/api/matters/${id}`, { title: 'x y' }], ['DELETE', `/api/matters/${id}`],
      ['POST', `/api/matters/${id}/items`, { kind: 'note', note: 'begona' }]]) {
      assert.strictEqual((await http(a, m, u, b)).status, 404, `${m} ${u}`);
    }
    assert.ok(!(await http(a, 'GET', '/api/matters')).body.matters.some(x => x.id === id), 'not in the other list');
    assert.strictEqual((await http(a, 'GET', '/api/matters/not-a-uuid')).status, 404);

    who = owner;
    assert.strictEqual((await http(a, 'PATCH', `/api/matters/${id}`, { status: 'closed' })).body.status, 'closed');
    assert.strictEqual((await http(a, 'DELETE', `/api/matters/${id}`)).status, 204);
    assert.strictEqual((await http(a, 'GET', `/api/matters/${id}`)).status, 404, 'deleted is gone');
  });

  await test('items: own chat and scan only; a source of another account is 404; duplicates 409; a gone source shows as unavailable', async () => {
    const owner = await makeUser('silver');
    const other = await makeUser('silver');
    const m = await store.create(owner, { title: 'Ijara' });
    const chat = await makeChat(owner, 'Ijara haqida');
    const foreignChat = await makeChat(other);
    const scan = await makeScan(owner);
    const foreignScan = await makeScan(other);

    const c = await store.addItem(m.id, owner, { kind: 'chat', ref: chat });
    assert.strictEqual(c.title, 'Ijara haqida', 'the chat title by default');
    await store.addItem(m.id, owner, { kind: 'scan', ref: scan, title: 'Shartnoma.pdf' });
    await store.addItem(m.id, owner, { kind: 'note', note: "Sud majlisi 12-noyabr" });
    await assert.rejects(store.addItem(m.id, owner, { kind: 'chat', ref: foreignChat }), e => e.status === 404);
    await assert.rejects(store.addItem(m.id, owner, { kind: 'scan', ref: foreignScan }), e => e.status === 404);
    await assert.rejects(store.addItem(m.id, owner, { kind: 'chat', ref: chat }), e => e.status === 409);
    await assert.rejects(store.addItem(m.id, owner, { kind: 'agent_run', ref: scan }), e => e.status === 404, 'not an agent run of this account');
    await assert.rejects(store.addItem(m.id, owner, { kind: 'note', note: '   ' }), e => e.status === 400);

    await pool.query('DELETE FROM ai_chat_sessions WHERE id = $1', [chat]);
    const got = await store.get(m.id, owner);
    assert.strictEqual(got.items.length, 3);
    const byKind = Object.fromEntries(got.items.map(i => [i.kind, i]));
    assert.strictEqual(byKind.chat.available, false, 'a deleted chat is shown as gone, not an error');
    assert.strictEqual(byKind.scan.available, true);
    assert.strictEqual(byKind.note.note, 'Sud majlisi 12-noyabr');
  });

  await test('scans: held while an open matter holds them, 30 days after it closes, a re-scan never shortens it', async () => {
    const owner = await makeUser('silver');
    const scan = await makeScan(owner);
    const a = await store.create(owner, { title: 'Birinchi ish' });
    const b = await store.create(owner, { title: 'Ikkinchi ish' });
    await store.addItem(a.id, owner, { kind: 'scan', ref: scan });
    await store.addItem(b.id, owner, { kind: 'scan', ref: scan });
    assert.ok(await expiresInDays(scan) > 3000, 'held');
    // the OCR cache's upsert for the same file keeps the longer life
    await pool.query(
      `INSERT INTO document_scans (admin_id, file_hash, kind, pages, bytes, text, chars, expires_at)
       SELECT admin_id, file_hash, kind, pages, bytes, text, chars, now() + interval '7 days' FROM document_scans WHERE id = $1
       ON CONFLICT (admin_id, file_hash) DO UPDATE SET expires_at = GREATEST(document_scans.expires_at, EXCLUDED.expires_at)`, [scan]);
    assert.ok(await expiresInDays(scan) > 3000, 'the re-scan did not shorten it');
    await store.update(a.id, owner, { status: 'closed' });
    assert.ok(await expiresInDays(scan) > 3000, 'still held by the other open matter');
    await store.remove(b.id, owner);
    const d = await expiresInDays(scan);
    assert.ok(d > 29 && d <= 30.01, `30 days after the last open matter (${d})`);
    await store.update(a.id, owner, { status: 'open' });
    assert.ok(await expiresInDays(scan) > 3000, 'reopened: held again');
  });

  await test('limits: Sinov keeps one open matter, a paid plan more; a closed one does not count', async () => {
    const trial = await makeUser(null);
    const first = await store.create(trial, { title: 'Bitta ish' });
    await assert.rejects(store.create(trial, { title: 'Ikkinchi ish' }), e => e.status === 402 && /Sinov/u.test(e.message));
    await store.update(first.id, trial, { status: 'closed' });
    const second = await store.create(trial, { title: 'Ikkinchi ish' });
    await assert.rejects(store.update(first.id, trial, { status: 'open' }), e => e.status === 402, 'reopening counts too');
    assert.ok(second.id);
    assert.strictEqual(MAX_OPEN_TRIAL, 1);
    const paid = await makeUser('silver');
    await store.create(paid, { title: 'Bir' });
    await store.create(paid, { title: 'Ikki' });
  });

  await test('Workspace: members write, viewers read, outsiders 404; only the owner deletes or links own chats', async () => {
    const owner = await makeUser('platinum');
    const member = await makeUser('silver');
    const viewer = await makeUser('silver');
    const outsider = await makeUser('silver');
    const ws = await makeWorkspace(owner, [[member, 'member'], [viewer, 'viewer']]);
    await assert.rejects(store.create(outsider, { title: 'Begona', workspaceId: ws }), e => e.status === 404, 'not a member: no attach');
    const m = await store.create(owner, { title: 'Firma ishi', workspaceId: ws });

    assert.strictEqual((await store.get(m.id, member)).access, 'write');
    assert.strictEqual((await store.get(m.id, viewer)).access, 'read');
    assert.strictEqual(await store.get(m.id, outsider), null);
    assert.ok((await store.list(viewer)).some(x => x.id === m.id && x.access === 'read'));
    // the export reads the owner's agent results with the matter's access: a viewer reads, an outsider gets null
    const run = (await pool.query(`INSERT INTO agent_runs (admin_id, workflow, status, result, request_id, finished_at) VALUES ($1, 'playbook_review', 'done', '{"httpStatus":200,"body":{"counts":{"mos":1}}}'::jsonb, gen_random_uuid(), now()) RETURNING id`, [owner])).rows[0].id;
    await store.addItem(m.id, owner, { kind: 'agent_run', ref: run });
    assert.deepStrictEqual((await store.results(m.id, viewer))[run].body.counts, { mos: 1 });
    assert.strictEqual(await store.results(m.id, outsider), null);

    await store.addItem(m.id, member, { kind: 'note', note: "A'zo yozuvi" });
    assert.strictEqual(await store.addItem(m.id, viewer, { kind: 'note', note: 'x' }), null, 'a viewer does not write');
    await assert.rejects(store.addItem(m.id, member, { kind: 'chat', ref: await makeChat(member) }), e => e.status === 400, "a member's own chat would be read as the owner's");
    assert.strictEqual(await store.remove(m.id, member), false, 'a member does not delete');

    await pool.query('UPDATE workspaces SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [ws, owner]).catch(async () => {
      const c = await pool.connect();
      try { await c.query('SET session_replication_role = replica'); await c.query('UPDATE workspaces SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [ws, owner]); }
      finally { await c.query('SET session_replication_role = origin').catch(() => {}); c.release(); }
    });
    assert.strictEqual(await store.get(m.id, member), null, 'a deleted Workspace no longer opens it');
    assert.strictEqual((await store.get(m.id, owner)).access, 'write', 'its owner still has it');
  });

  await test('account deletion removes the matters and the links the person made', async () => {
    const owner = await makeUser('silver');
    const m = await store.create(owner, { title: "O'chiriladigan ish" });
    await store.addItem(m.id, owner, { kind: 'note', note: 'shaxsiy' });
    await deleteAccountMatters(pool, owner);
    const r = await pool.query('SELECT count(*)::int AS n FROM matters WHERE owner_id = $1', [owner]);
    assert.strictEqual(r.rows[0].n, 0);
  });

  await test('commands: create, a note to the matter on screen, close confirmed by its own account only; a non-command is 422', async () => {
    const owner = await makeUser('silver');
    const other = await makeUser('silver');
    let who = owner;
    const a = app(() => who);
    const made = await http(a, 'POST', '/api/matters/command', { text: 'Yangi ish och: Ijara nizosi' });
    assert.deepStrictEqual([made.status, made.body.action], [200, 'matter_created']);
    const id = made.body.matterId;
    const noted = await http(a, 'POST', '/api/matters/command', { text: "Yozuv qo'sh: ijarachi to'lovni kechiktirdi", lastMatterId: id });
    assert.strictEqual(noted.body.action, 'matter_noted');
    assert.strictEqual((await store.get(id, owner)).items[0].note, "ijarachi to'lovni kechiktirdi");
    const ask = await http(a, 'POST', '/api/matters/command', { text: 'ijara ishini yop' });
    assert.strictEqual(ask.body.action, 'matter_confirm');
    assert.strictEqual((await store.get(id, owner)).status, 'open', 'not closed before the confirmation');
    who = other;
    assert.strictEqual((await http(a, 'POST', '/api/matters/command', { confirm: ask.body.confirm.token })).body.action, 'matter_confirm_expired');
    assert.strictEqual((await http(a, 'POST', '/api/matters/command', { text: 'ijara ishini yop' })).body.action, 'matter_not_found', "another account's matter is not found by name");
    who = owner;
    assert.strictEqual((await http(a, 'POST', '/api/matters/command', { confirm: ask.body.confirm.token })).body.action, 'matter_closed');
    assert.strictEqual((await store.get(id, owner)).status, 'closed');
    assert.strictEqual((await http(a, 'POST', '/api/matters/command', { text: 'Ijara shartnomasi qachon bekor qilinadi?' })).status, 422);
  });

  await test('MATTERS=off answers 503', async () => {
    const owner = await makeUser('silver');
    process.env.MATTERS = 'off';
    try { assert.strictEqual((await http(app(() => owner), 'GET', '/api/matters')).status, 503); }
    finally { delete process.env.MATTERS; }
  });

  for (const id of users) {
    await pool.query('DELETE FROM matter_items WHERE added_by = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM matters WHERE owner_id = $1', [id]).catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
