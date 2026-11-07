'use strict';

/**
 * CustDev pilot, stage 3 (2026-10-28, migration 027, src/sales/pilot-workspace.js):
 * the internal pilot Workspace is a master's to open and agents join it; an
 * approved pilot gets one task "Mijoz: <ism> — <tur>" (the client is never a
 * member); only an active pilot client's feedback becomes a sub-task, one per
 * Telegram message; the agent tags it; the reply goes once, after the
 * sub-task is done and the agent confirmed it, and not to a client who turned
 * replies off; every Workspace write is in the activity log; the weekly view
 * counts feedback and distinct clients by tag; a client cannot reach the
 * staff routes. Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/pilot-feedback.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('pilot feedback (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const express = require('express');
const { pool } = require('../src/database/db');
const ledger = require('../src/rag/tariff-ledger');
const sales = require('../src/sales/agents');
const pw = require('../src/sales/pilot-workspace');
const fb = require('../src/bot/pilot-feedback');
const { withWorkspaceTransaction } = require('../src/workspace/authz');
const { mountSalesRoutes } = require('../src/sales/routes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user', extra = {}) {
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_chat_id) VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
    [`pf_${Date.now()}_${rnd()}`, extra.name || 'Sinov', role, extra.chat || null]);
  return r.rows[0].id;
}
const env = { PILOT_AUTO: 'on', PILOT_AUTO_TOTAL: '100000', PILOT_AUTO_PER_AGENT: '100' };
async function pilotClient(agent, code, type = 'accountant', name = 'Nodira Yusupova') {
  const chat = 600000000 + (rnd() % 1e8);
  const c = await makeUser('user', { name, chat });
  await sales.claimAtRegistration(pool, { adminId: c, refCode: code });
  await sales.setClientType(pool, { adminId: c, type, by: 'self', actorId: c });
  const r = await sales.maybeAutoApprove(pool, { adminId: c, ledger, env });
  assert.strictEqual(r.approved, true, JSON.stringify(r));
  return { id: c, chat };
}
const taskOf = async id => (await pool.query('SELECT * FROM pilot_client_tasks WHERE admin_id = $1', [id])).rows[0];
const setDone = (actor, wsId, taskId) => withWorkspaceTransaction(pool, actor, db => db.query(
  `UPDATE workspace_tasks SET status = 'done', updated_by = $3 WHERE workspace_id = $1 AND id = $2`, [wsId, taskId, actor]));

(async () => {
  console.log('pilot feedback (db)');
  await pool.query('DELETE FROM pilot_workspace');
  const master = await makeUser('master', { name: 'Master' });
  const agent = await makeUser('student', { name: 'Dilnoza' });
  const other = await makeUser('student', { name: 'Jasur' });
  const code = (await sales.assignCode(pool, { masterId: master, agentId: agent })).code;
  await sales.assignCode(pool, { masterId: master, agentId: other });
  let wsId;

  await test('the pilot Workspace: a master opens it once (internal); agents with a code are members; a later code adds its agent', async () => {
    assert.strictEqual((await pw.openWorkspace(pool, { masterId: agent })).status, 403);
    const o = await pw.openWorkspace(pool, { masterId: master });
    assert.strictEqual(o.ok, true); wsId = o.workspaceId;
    assert.strictEqual((await pw.openWorkspace(pool, { masterId: master })).existed, true);
    assert.strictEqual((await pool.query('SELECT internal FROM workspaces WHERE id = $1', [wsId])).rows[0].internal, true);
    const isMember = async id => !!(await pool.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wsId, id])).rows[0];
    assert.strictEqual(await isMember(agent), true);
    const late = await makeUser('lawyer', { name: 'Ekspert' });
    await sales.assignCode(pool, { masterId: master, agentId: late });
    assert.strictEqual(await isMember(late), true);
  });

  let c1;
  await test('an approved pilot gets one task "Mijoz: <ism> — <tur>" with the sections, assigned to its agent; the client is not a member', async () => {
    c1 = await pilotClient(agent, code);
    const t = await taskOf(c1.id);
    assert.ok(t, 'task opened on approval');
    const task = (await pool.query('SELECT title, description, due_date FROM workspace_tasks WHERE id = $1', [t.task_id])).rows[0];
    assert.strictEqual(task.title, 'Mijoz: Nodira Yusupova — Buxgalter');
    for (const s of pw.SECTIONS) assert.ok(task.description.includes(`## ${s}`), s);
    assert.ok(task.due_date, 'due at the pilot end');
    assert.strictEqual((await pool.query('SELECT user_id FROM workspace_task_assignees WHERE task_id = $1', [t.task_id])).rows[0].user_id, agent);
    assert.ok(!(await pool.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wsId, c1.id])).rows[0]);
    const log = (await pool.query(`SELECT actor_id FROM workspace_activity_log WHERE workspace_id = $1 AND task_id = $2`, [wsId, t.task_id])).rows;
    assert.ok(log.length >= 1 && log.every(l => l.actor_id === agent), 'logged as the agent');
    // by hand: the own agent gets the same one; another agent is told nothing exists
    assert.strictEqual((await pw.ensureClientTask(pool, { adminId: c1.id, actorId: agent })).existed, true);
    assert.strictEqual((await pw.ensureClientTask(pool, { adminId: c1.id, actorId: other })).status, 404);
  });

  let f1;
  await test('feedback: only an active pilot client; one sub-task per Telegram message, linked to the client task, logged', async () => {
    const outsider = await makeUser('user');
    assert.strictEqual((await pw.recordFeedback(pool, { adminId: outsider, chatId: 1, messageId: 1, text: 'x' })).error, 'not_in_pilot');
    const r = await pw.recordFeedback(pool, { adminId: c1.id, chatId: c1.chat, messageId: 501, text: 'Javobda modda raqami chalkash yozilgan', source: 'voice' });
    assert.strictEqual(r.ok, true); f1 = r.id;
    const again = await pw.recordFeedback(pool, { adminId: c1.id, chatId: c1.chat, messageId: 501, text: 'Javobda modda raqami chalkash yozilgan' });
    assert.deepStrictEqual([again.duplicate, again.id], [true, f1]);
    const parent = await taskOf(c1.id);
    const links = (await pool.query(`SELECT target_task_id FROM workspace_task_links WHERE workspace_id = $1 AND source_task_id = $2 AND link_type = 'subtask'`, [wsId, parent.task_id])).rows;
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0].target_task_id, r.taskId);
    const sub = (await pool.query('SELECT title, description FROM workspace_tasks WHERE id = $1', [r.taskId])).rows[0];
    assert.match(sub.title, /^Fikr: Javobda modda/u);
    assert.match(sub.description, /ovozli xabar/u);
    assert.ok((await pool.query(`SELECT 1 FROM workspace_activity_log WHERE workspace_id = $1 AND task_id = $2`, [wsId, r.taskId])).rows[0]);
  });

  await test('tag: the own agent (as a logged comment), never another agent; an unknown tag is refused', async () => {
    assert.strictEqual((await pw.tagFeedback(pool, { feedbackId: f1, tag: 'chalkash', actorId: other })).status, 404);
    assert.strictEqual((await pw.tagFeedback(pool, { feedbackId: f1, tag: 'yaxshi', actorId: agent })).status, 400);
    assert.strictEqual((await pw.tagFeedback(pool, { feedbackId: f1, tag: 'chalkash', actorId: agent })).ok, true);
    const f = (await pool.query('SELECT tag, task_id FROM pilot_feedback WHERE id = $1', [f1])).rows[0];
    assert.strictEqual(f.tag, 'chalkash');
    assert.ok((await pool.query(`SELECT 1 FROM workspace_task_comments WHERE task_id = $1 AND body = 'Teg: Chalkash'`, [f.task_id])).rows[0]);
  });

  await test('reply: only after done, only confirmed, sent once; a client who turned replies off gets nothing', async () => {
    const sent = [];
    const send = async (chatId, text) => { sent.push([chatId, text]); };
    assert.strictEqual((await pw.replyFeedback(pool, { feedbackId: f1, text: 'Tuzatdik', actorId: agent, confirmed: true, send })).error, 'task_not_done');
    const f = (await pool.query('SELECT task_id FROM pilot_feedback WHERE id = $1', [f1])).rows[0];
    await setDone(agent, wsId, f.task_id);
    assert.strictEqual((await pw.replyFeedback(pool, { feedbackId: f1, text: 'Tuzatdik', actorId: agent, send })).error, 'confirm_required');
    assert.strictEqual((await pw.replyFeedback(pool, { feedbackId: f1, text: 'Tuzatdik', actorId: other, confirmed: true, send })).status, 404);
    const ok = await pw.replyFeedback(pool, { feedbackId: f1, text: 'Rahmat! Modda raqamlari endi to‘liq yoziladi.', actorId: agent, confirmed: true, send });
    assert.deepStrictEqual([ok.ok, ok.status], [true, 'sent']);
    assert.strictEqual((await pw.replyFeedback(pool, { feedbackId: f1, text: 'Yana', actorId: agent, confirmed: true, send })).error, 'already_replied');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(String(sent[0][0]), String(c1.chat));
    // a delivery that failed may be sent again
    const r3 = await pw.recordFeedback(pool, { adminId: c1.id, chatId: c1.chat, messageId: 503, text: 'Ilova sekin' });
    await setDone(agent, wsId, r3.taskId);
    const bad = await pw.replyFeedback(pool, { feedbackId: r3.id, text: 'Tezlashtirdik', actorId: agent, confirmed: true, send: async () => { throw new Error('telegram down'); } });
    assert.strictEqual(bad.status, 'failed');
    assert.strictEqual((await pw.replyFeedback(pool, { feedbackId: r3.id, text: 'Tezlashtirdik', actorId: agent, confirmed: true, send })).status, 'sent');
    assert.strictEqual(sent.length, 2);
    // opted out
    const r2 = await pw.recordFeedback(pool, { adminId: c1.id, chatId: c1.chat, messageId: 502, text: 'Narx biroz baland' });
    await setDone(agent, wsId, r2.taskId);
    await pw.setRepliesOff(pool, { adminId: c1.id, off: true });
    const off = await pw.replyFeedback(pool, { feedbackId: r2.id, text: 'Tushunarli', actorId: agent, confirmed: true, send });
    assert.deepStrictEqual([off.ok, off.status, sent.length], [true, 'opted_out', 2]);
  });

  await test('weekly view: by tag, feedback and distinct clients; an agent sees own clients only', async () => {
    const c2 = await pilotClient(agent, code, 'lawyer', 'Aziz Karimov');
    const a = await pw.recordFeedback(pool, { adminId: c2.id, chatId: c2.chat, messageId: 601, text: 'Muddat chalkash' });
    await pw.tagFeedback(pool, { feedbackId: a.id, tag: 'chalkash', actorId: agent });
    const w = await pw.weekly(pool, { actorId: agent });
    const row = w.rows.find(r => r.tag === 'chalkash');
    assert.deepStrictEqual([row.feedback, row.clients], [2, 2]);
    assert.ok(w.rows.find(r => r.tag === 'untagged'));
    assert.strictEqual((await pw.weekly(pool, { actorId: other })).rows.length, 0);
    assert.strictEqual((await pw.listFeedback(pool, { actorId: other })).length, 0);
    assert.ok((await pw.listFeedback(pool, { actorId: agent })).every(x => typeof x.text === 'string' && !/— .*Telegram/u.test(x.text)));
  });

  await test('bot: feedback mode only for the next message within the time; "bekor" cancels', () => {
    assert.strictEqual(fb.waiting({ state: fb.STATE, context: { since: Date.now() - 60e3 } }), true);
    assert.strictEqual(fb.waiting({ state: fb.STATE, context: { since: Date.now() - (fb.FEEDBACK_TTL_MIN + 1) * 60e3 } }), false);
    assert.strictEqual(fb.waiting({ state: 'idle', context: {} }), false);
    assert.ok(fb.CANCEL_RE.test('Bekor'));
    assert.ok(!fb.CANCEL_RE.test('bekor qilinadimi shartnoma?'));
  });

  await test('HTTP: a client gets 404 on the staff routes; an agent sees the list', async () => {
    const app = express();
    app.use(express.json());
    let as = {};
    app.use((req, _r, next) => { req.session = { isAuthenticated: true, ...as }; next(); });
    const pass = (q, r, n) => n();
    const requireMasterAdmin = (q, r, n) => (q.session.role === 'master' ? n() : r.status(403).json({ error: 'master' }));
    mountSalesRoutes(app, { pool, requireAuth: pass, requireMasterAdmin, requireSameOrigin: pass, ledger, botUsername: 't', appUrl: 'https://x' });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      as = { adminId: c1.id, role: 'user' };
      assert.strictEqual((await fetch(`${base}/api/sales/feedback`)).status, 404);
      assert.strictEqual((await fetch(`${base}/api/sales/feedback/${f1}/tag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"tag":"xato"}' })).status, 404);
      as = { adminId: agent, role: 'student' };
      const r = await (await fetch(`${base}/api/sales/feedback`)).json();
      assert.ok(r.feedback.length >= 2);
      assert.strictEqual((await fetch(`${base}/api/admin/sales/workspace`, { method: 'POST' })).status, 403);
    } finally { server.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
