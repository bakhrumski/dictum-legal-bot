'use strict';

/**
 * Workspace for every paid plan and the internal (staff) Workspace
 * (2026-10-28, migration 025): an active Silver, Gold or Platinum account
 * may own a Workspace, Sinov or no plan may not; a master opens an internal
 * Workspace with no plan, nobody else can; an internal Workspace takes staff
 * members only (a client can never join, by insert or by invitation); its
 * flag never changes; a staff member of it is a member with no plan of their
 * own. Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/workspace-entitlement.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('workspace entitlement (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { withWorkspaceTransaction } = require('../src/workspace/authz');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const workspaces = [];
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user', plan = null) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at)
     VALUES ($1, 'x', 'Sinov', $2, $3, $4) RETURNING id`,
    [`we_${Date.now()}_${rnd()}`, role, plan, plan ? new Date(Date.now() + 86400000) : null]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}
async function createWorkspace(actorId, { internal = false } = {}) {
  const row = await withWorkspaceTransaction(pool, actorId, async (client) => (await client.query(
    `INSERT INTO workspaces (name, slug, owner_id, created_by, internal)
     VALUES ('Sinov jamoa', $1, $2, $2, $3) RETURNING id`,
    [`we-${Date.now()}-${rnd()}`, actorId, internal])).rows[0]);
  workspaces.push(row.id);
  return row.id;
}
async function addMember(actorId, workspaceId, userId) {
  return withWorkspaceTransaction(pool, actorId, (client) => client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3)`,
    [workspaceId, userId, actorId]));
}
async function isMember(actorId, workspaceId) {
  return withWorkspaceTransaction(pool, actorId, async (client) =>
    (await client.query('SELECT juristai_private.is_workspace_member($1) AS ok', [workspaceId])).rows[0].ok);
}
async function acceptInvite(ownerId, workspaceId, userId) {
  const inv = (await pool.query(
    `INSERT INTO workspace_invitations (workspace_id, target_username, role, token_hash, invited_by, expires_at)
     VALUES ($1, (SELECT username FROM admins WHERE id = $4), 'member', $2, $3, now() + interval '1 day') RETURNING id`,
    [workspaceId, crypto.randomBytes(32), ownerId, userId])).rows[0].id;
  return withWorkspaceTransaction(pool, userId, (client) => client.query(
    'UPDATE workspace_invitations SET accepted_by = $2, accepted_at = now() WHERE id = $1', [inv, userId]));
}
const owner = async (wsId) => (await pool.query('SELECT juristai_private.workspace_owner_active($1) AS ok', [wsId])).rows[0].ok;

(async () => {
  console.log('workspace entitlement (db)');
  const silver = await makeUser('user', 'silver');
  const gold = await makeUser('user', 'gold');
  const sinov = await makeUser('user', 'sinov');
  const noPlan = await makeUser('user');
  const master = await makeUser('master');
  const student = await makeUser('student');
  const lawyer = await makeUser('lawyer');
  const client = await makeUser('user', 'platinum');

  await test('Silver and Gold own a Workspace; Sinov and no plan do not', async () => {
    assert.strictEqual(await owner(await createWorkspace(silver)), true);
    assert.strictEqual(await owner(await createWorkspace(gold)), true);
    await assert.rejects(createWorkspace(sinov), /Silver, Gold or Platinum/u);
    await assert.rejects(createWorkspace(noPlan), /Silver, Gold or Platinum/u);
  });

  await test('a Silver owner\'s Workspace closes when the plan ends', async () => {
    const u = await makeUser('user', 'silver');
    const ws = await createWorkspace(u);
    await pool.query("UPDATE admins SET tariff_expires_at = now() - interval '1 minute' WHERE id = $1", [u]);
    assert.strictEqual(await owner(ws), false);
    assert.strictEqual(await isMember(u, ws), false);
  });

  let internal;
  await test('only a master opens an internal Workspace, with no plan; a master with no plan cannot open an ordinary one', async () => {
    internal = await createWorkspace(master, { internal: true });
    assert.strictEqual(await owner(internal), true);
    assert.strictEqual(await isMember(master, internal), true);
    await assert.rejects(createWorkspace(client, { internal: true }), /Only a master/u);
    await assert.rejects(createWorkspace(student, { internal: true }), /Only a master/u);
    await assert.rejects(createWorkspace(master), /Silver, Gold or Platinum/u);
  });

  await test('staff join an internal Workspace with no plan; a client never does (insert or invitation)', async () => {
    await addMember(master, internal, student);
    assert.strictEqual(await isMember(student, internal), true);
    await acceptInvite(master, internal, lawyer);
    assert.strictEqual(await isMember(lawyer, internal), true);
    await assert.rejects(addMember(master, internal, client), /staff members only/u);
    await assert.rejects(acceptInvite(master, internal, client), /does not match the accepting account/u); // the role check, as in 007
    assert.strictEqual(await isMember(client, internal), false);
  });

  await test('the internal flag never changes', async () => {
    await assert.rejects(withWorkspaceTransaction(pool, master, (c) =>
      c.query('UPDATE workspaces SET internal = false WHERE id = $1', [internal])), /cannot change/u);
    const ws = await createWorkspace(silver);
    await assert.rejects(withWorkspaceTransaction(pool, silver, (c) =>
      c.query('UPDATE workspaces SET internal = true WHERE id = $1', [ws])), /cannot change/u);
  });

  await test('an ordinary Workspace still needs the member\'s own paid plan; staff get no exemption there', async () => {
    const ws = await createWorkspace(gold);
    await addMember(gold, ws, client);
    assert.strictEqual(await isMember(client, ws), true);
    await addMember(gold, ws, sinov);
    assert.strictEqual(await isMember(sinov, ws), false);
  });

  // cleanup
  try {
    await pool.query('DELETE FROM workspace_invitations WHERE workspace_id = ANY($1::uuid[])', [workspaces]);
    await pool.query("SET session_replication_role = replica");
    await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaces]);
    await pool.query("SET session_replication_role = DEFAULT");
  } catch (_) { /* a throwaway database; leftovers are harmless */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
