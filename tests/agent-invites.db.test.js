'use strict';

/**
 * Agent invite links (2026-10-29, owner; migration 031, src/sales/invites.js):
 * the agents list holds only accounts with an offer code; only a master makes
 * a link (the token is never stored, only its sha256); the link works once,
 * for 7 days, and can be revoked; accepting makes the Telegram's account a
 * staff account (student) with a code - a new account from the Telegram
 * identity, an ordinary one promoted, a student kept - and refuses a master or
 * a referred client without using the link up; the bot's tap only works with
 * the token held at /start.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/agent-invites.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('agent invites (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const sales = require('../src/sales/agents');
const inv = require('../src/sales/invites');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const tgId = () => 600000000 + (rnd() % 1e8);
async function makeUser(role = 'user', extra = {}) {
  return (await pool.query(`INSERT INTO admins (username, password, full_name, role, telegram_user_id) VALUES ($1, 'x', 'Sinov', $2, $3) RETURNING id`,
    [`ai_${Date.now()}_${rnd()}`, role, extra.tg || null])).rows[0].id;
}
const tokenOf = link => link.split('start=agi_')[1];

(async () => {
  console.log('agent invites (db)');
  const master = await makeUser('master');

  await test('the agents list: only accounts with a code', async () => {
    const plain = await makeUser('student');
    const agent = await makeUser('student');
    await sales.assignCode(pool, { masterId: master, agentId: agent });
    const ids = (await sales.agentsOverview(pool)).map(a => a.id);
    assert.ok(ids.includes(agent) && !ids.includes(plain));
    await sales.revokeCode(pool, { masterId: master, agentId: agent });
    assert.ok(!(await sales.agentsOverview(pool)).map(a => a.id).includes(agent), 'taken out of the list');
  });

  await test('only a master makes a link; the token is not stored; listed as open', async () => {
    const student = await makeUser('student');
    assert.strictEqual((await inv.createInvite(pool, { masterId: student, botUsername: 'b' })).error, 'master_only');
    const r = await inv.createInvite(pool, { masterId: master, note: 'Guruh A', botUsername: 'yuristga_savolbot' });
    assert.ok(r.ok && /^https:\/\/t\.me\/yuristga_savolbot\?start=agi_[A-Za-z0-9_-]{24}$/u.test(r.link), r.link);
    const token = tokenOf(r.link);
    const row = (await pool.query('SELECT * FROM agent_invites WHERE id = $1', [r.invite.id])).rows[0];
    assert.ok(!JSON.stringify(row).includes(token) && row.token_hash === inv.hashOf(token));
    assert.strictEqual((await inv.listInvites(pool)).find(i => i.id === r.invite.id).status, 'open');
    assert.ok(await inv.peek(pool, token));
  });

  await test('a new Telegram: an account made as a student with a code; the link is used up once', async () => {
    const r = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    const token = tokenOf(r.link);
    const from = { id: tgId(), username: `ag${rnd()}`, first_name: 'Dilshod', last_name: 'Ergashev' };
    const out = await inv.accept(pool, { from, chatId: from.id, token });
    assert.ok(out.ok && out.created && out.role === 'student' && out.code, JSON.stringify(out));
    const a = (await pool.query('SELECT role, sales_agent_code, full_name FROM admins WHERE id = $1', [out.adminId])).rows[0];
    assert.deepStrictEqual([a.role, a.sales_agent_code, a.full_name], ['student', out.code, 'Dilshod Ergashev']);
    assert.ok((await sales.agentsOverview(pool)).some(x => x.id === out.adminId), 'in the agents list');
    assert.strictEqual(await sales.agentByCode(pool, out.code), out.adminId, 'the code works as an offer link');
    assert.strictEqual((await inv.accept(pool, { from: { id: tgId() }, chatId: 1, token })).error, 'expired', 'once');
    const li = (await inv.listInvites(pool)).find(i => i.id === r.invite.id);
    assert.deepStrictEqual([li.status, li.used_by], ['used', out.adminId]);
  });

  await test('an ordinary account is promoted; a student keeps its role and code', async () => {
    const tg1 = tgId(); const u = await makeUser('user', { tg: tg1 });
    let r = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    let out = await inv.accept(pool, { from: { id: tg1 }, chatId: tg1, token: tokenOf(r.link) });
    assert.ok(out.ok && out.adminId === u && !out.created && out.role === 'student');
    const tg2 = tgId(); const s = await makeUser('student', { tg: tg2 });
    const { code } = await sales.assignCode(pool, { masterId: master, agentId: s });
    r = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    out = await inv.accept(pool, { from: { id: tg2 }, chatId: tg2, token: tokenOf(r.link) });
    assert.ok(out.ok && out.adminId === s && out.code === code);
  });

  await test('a master or a referred client is refused, and the link stays usable', async () => {
    const tgM = tgId(); await makeUser('master', { tg: tgM });
    const r = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    const token = tokenOf(r.link);
    assert.strictEqual((await inv.accept(pool, { from: { id: tgM }, chatId: tgM, token })).error, 'master');
    const agent = await makeUser('student');
    await sales.assignCode(pool, { masterId: master, agentId: agent });
    const tgC = tgId(); const c = await makeUser('user', { tg: tgC });
    await sales.attachReferral(pool, { adminId: c, agentId: agent });
    assert.strictEqual((await inv.accept(pool, { from: { id: tgC }, chatId: tgC, token })).error, 'client');
    assert.strictEqual((await pool.query('SELECT role FROM admins WHERE id = $1', [c])).rows[0].role, 'user');
    assert.ok(await inv.peek(pool, token), 'still open');
  });

  await test('revoked and expired links do not work', async () => {
    const r = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    assert.ok((await inv.revokeInvite(pool, { masterId: master, inviteId: r.invite.id })).ok);
    assert.strictEqual((await inv.accept(pool, { from: { id: tgId() }, chatId: 1, token: tokenOf(r.link) })).error, 'expired');
    const e = await inv.createInvite(pool, { masterId: master, botUsername: 'b' });
    await pool.query("UPDATE agent_invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [e.invite.id]);
    assert.strictEqual(await inv.peek(pool, tokenOf(e.link)), null);
    assert.strictEqual((await inv.listInvites(pool)).find(i => i.id === e.invite.id).status, 'expired');
  });

  await test('the tap uses the token held at /start for that Telegram user, once, for 15 minutes', () => {
    inv.hold(11, 'tok-a', 1000);
    assert.strictEqual(inv.take(12, 1000), null, 'another user');
    assert.strictEqual(inv.take(11, 2000), 'tok-a');
    assert.strictEqual(inv.take(11, 2000), null, 'once');
    inv.hold(11, 'tok-b', 0);
    assert.strictEqual(inv.take(11, 16 * 60 * 1000), null, 'after 15 minutes');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
