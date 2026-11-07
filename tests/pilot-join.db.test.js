'use strict';

/**
 * Client type and the one-tap pilot join (2026-10-28, owner; migration 026):
 * the type adapts and grants nothing (the role stays 'user'); the person sets
 * their own, only their agent or a master corrects it; the bot's tap makes
 * the account from the Telegram identity once; the standing rule opens the
 * pilot for a professional type within the total / per-agent caps, one at a
 * time, and never for "user"; PILOT_AUTO=off stops it; a staff Telegram is
 * never made a client; a policy grant needs no master and only a known policy.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/pilot-join.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('pilot join (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const ledger = require('../src/rag/tariff-ledger');
const sales = require('../src/sales/agents');
const join = require('../src/bot/pilot-join');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const tgId = () => 700000000 + (rnd() % 1e8);
async function makeUser(role = 'user', extra = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id) VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
    [`pj_${Date.now()}_${rnd()}`, extra.name || 'Sinov', role, extra.tg || null]);
  return r.rows[0].id;
}
async function agentWithCode(master) {
  const a = await makeUser('student', { name: 'Agent' });
  const { code } = await sales.assignCode(pool, { masterId: master, agentId: a });
  return { id: a, code };
}
const approvedCount = async () => (await pool.query("SELECT count(*)::int AS n FROM pilot_requests WHERE status = 'approved'")).rows[0].n;
const env = (o = {}) => ({ PILOT_AUTO: 'on', PILOT_AUTO_TOTAL: '100000', PILOT_AUTO_PER_AGENT: '4', ...o });
async function tap(code, type, e = env(), from = null) {
  const f = from || { id: tgId(), username: `u${rnd()}`, first_name: 'Aziza', last_name: 'Karimova' };
  await sales.rememberTelegramRef(pool, { telegramUserId: f.id, code });
  return { from: f, out: await sales.joinFromTelegram(pool, { from: f, chatId: f.id, type, ledger, env: e }) };
}

(async () => {
  console.log('pilot join (db)');
  const master = await makeUser('master');

  await test('bot texts: five type buttons, each a known type; unknown data is ignored', () => {
    const kb = join.typeKeyboard().inline_keyboard.flat();
    assert.deepStrictEqual(kb.map(b => join.typeFromData(b.callback_data)), ['lawyer', 'accountant', 'hr', 'business', 'user']);
    assert.strictEqual(join.typeFromData('pj_master'), null);
    assert.strictEqual(join.typeFromData('pj_'), null);
    assert.match(join.joinReply({ ok: true, pilot: 'approved' }, 'https://x'), /pilotingiz ochildi/u);
    assert.match(join.joinReply({ ok: true, pilot: 'not_professional' }, 'https://x'), /bir martalik/u);
    assert.match(join.joinReply({ ok: false, error: 'staff' }, 'https://x'), /xodimi/u);
  });

  await test('one tap: the account is made from the Telegram identity, role user, the type set by self, the pilot opened', async () => {
    const ag = await agentWithCode(master);
    const { from, out } = await tap(ag.code, 'accountant');
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.created, true);
    assert.strictEqual(out.pilot, 'approved');
    const a = (await pool.query('SELECT role, client_type, client_type_by, referred_by_agent_id, telegram_user_id::text AS tg FROM admins WHERE id = $1', [out.adminId])).rows[0];
    assert.deepStrictEqual([a.role, a.client_type, a.client_type_by, a.referred_by_agent_id, a.tg], ['user', 'accountant', 'self', ag.id, String(from.id)]);
    const q = (await pool.query('SELECT status, auto, decided_by FROM pilot_requests WHERE admin_id = $1', [out.adminId])).rows[0];
    assert.deepStrictEqual([q.status, q.auto, q.decided_by], ['approved', true, null]);
    const p = (await pool.query("SELECT created_by, economics->>'policy' AS policy FROM tariff_periods WHERE admin_id = $1 AND source = 'test'", [out.adminId])).rows[0];
    assert.deepStrictEqual([p.created_by, p.policy], [null, 'custdev_pilot_auto']);
    // a second tap: the same account, no second pilot
    const again = await sales.joinFromTelegram(pool, { from, chatId: from.id, type: 'lawyer', ledger, env: env() });
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.adminId, out.adminId);
    assert.strictEqual((await pool.query("SELECT count(*)::int AS n FROM tariff_periods WHERE admin_id = $1 AND source = 'test'", [out.adminId])).rows[0].n, 1);
  });

  await test('"user" (anyone else): an account and Sinov, the request waits - no pilot', async () => {
    const ag = await agentWithCode(master);
    const { out } = await tap(ag.code, 'user');
    assert.strictEqual(out.pilot, 'not_professional');
    assert.strictEqual((await pool.query('SELECT status FROM pilot_requests WHERE admin_id = $1', [out.adminId])).rows[0].status, 'pending');
  });

  await test('caps: per agent, then in all; PILOT_AUTO=off stops it; past a cap the request waits for a master', async () => {
    const ag = await agentWithCode(master);
    const e = env({ PILOT_AUTO_PER_AGENT: '2' });
    assert.strictEqual((await tap(ag.code, 'lawyer', e)).out.pilot, 'approved');
    assert.strictEqual((await tap(ag.code, 'hr', e)).out.pilot, 'approved');
    const third = (await tap(ag.code, 'business', e)).out;
    assert.deepStrictEqual([third.pilot, third.reason], ['pending', 'agent_cap']);
    const ag2 = await agentWithCode(master);
    const full = (await tap(ag2.code, 'lawyer', env({ PILOT_AUTO_TOTAL: String(await approvedCount()) }))).out;
    assert.deepStrictEqual([full.pilot, full.reason], ['pending', 'total_cap']);
    const off = (await tap(ag2.code, 'lawyer', env({ PILOT_AUTO: 'off' }))).out;
    assert.deepStrictEqual([off.pilot, off.reason], ['pending', 'off']);
    // a master still approves by hand
    const qid = (await pool.query('SELECT id FROM pilot_requests WHERE admin_id = $1', [third.adminId])).rows[0].id;
    assert.strictEqual((await sales.approve(pool, { masterId: master, requestId: qid, ledger })).ok, true);
  });

  await test('parallel: the standing rule takes one at a time, so a cap is never passed', async () => {
    const ag = await agentWithCode(master);
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const f = { id: tgId(), first_name: 'P' };
      await sales.rememberTelegramRef(pool, { telegramUserId: f.id, code: ag.code });
      const r = await sales.joinFromTelegram(pool, { from: f, chatId: f.id, type: 'user', ledger, env: env() });
      await pool.query("UPDATE admins SET client_type = 'lawyer' WHERE id = $1", [r.adminId]);
      ids.push(r.adminId);
    }
    const res = await Promise.all(ids.map(adminId => sales.maybeAutoApprove(pool, { adminId, ledger, env: env({ PILOT_AUTO_PER_AGENT: '1' }) })));
    assert.strictEqual(res.filter(r => r.approved).length, 1);
  });

  await test('who may set the type: self, the own agent, a master - never another agent; staff have none', async () => {
    const ag = await agentWithCode(master);
    const other = await agentWithCode(master);
    const { out } = await tap(ag.code, 'user');
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'hr', by: 'agent', actorId: other.id })).status, 404);
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'hr', by: 'agent', actorId: ag.id })).ok, true);
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'lawyer', by: 'self', actorId: ag.id })).status, 403);
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'lawyer', by: 'self', actorId: out.adminId })).ok, true);
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'expert', by: 'master', actorId: master })).status, 400);
    assert.strictEqual((await sales.setClientType(pool, { adminId: out.adminId, type: 'business', by: 'master', actorId: ag.id })).status, 403);
    assert.strictEqual((await sales.setClientType(pool, { adminId: ag.id, type: 'lawyer', by: 'master', actorId: master })).status, 404);
    assert.strictEqual((await pool.query('SELECT role FROM admins WHERE id = $1', [out.adminId])).rows[0].role, 'user');
  });

  await test('a staff Telegram is never made a client', async () => {
    const ag = await agentWithCode(master);
    const t = tgId();
    await makeUser('lawyer', { tg: t });
    const { out } = await tap(ag.code, 'lawyer', env(), { id: t, first_name: 'Ekspert' });
    assert.deepStrictEqual([out.ok, out.error], [false, 'staff']);
  });

  await test('a policy grant: no master needed, but only a known policy and never with a grantor', async () => {
    const u = await makeUser();
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: u, grantedBy: master, policy: 'custdev_pilot_auto', reason: 'sinov', hours: 1 })).reason, 'invalid_policy');
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: u, grantedBy: null, policy: 'anything', reason: 'sinov', hours: 1 })).reason, 'invalid_policy');
    assert.strictEqual((await ledger.grantTestEntitlement({ adminId: u, grantedBy: null, reason: 'sinov', hours: 1 })).reason, 'master_only');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
