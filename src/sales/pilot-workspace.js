'use strict';

/**
 * CustDev pilot, stage 3 (2026-10-28, owner; migration 027): the pilot's own
 * Workspace, a task per pilot client, Telegram feedback as sub-tasks and the
 * reply that closes the loop. No AI anywhere here.
 *
 *   workspace    one internal (staff) Workspace a master opens (migration
 *                025): members are the agents (added with their code); a
 *                client is never a member
 *   client task  "Mijoz: <ism> — <tur>", opened when the pilot is approved
 *                (by the master or the standing rule) or by hand by the
 *                client's agent or a master; tied to admins.id in
 *                pilot_client_tasks; the logbook is the task's comments and
 *                activity log
 *   feedback     a message the client sent in feedback mode (the bot's
 *                "💬 Fikr bildirish" or /fikr; a voice note after STT) becomes
 *                one sub-task of the client's task (unique by chat + message)
 *   tag          xato / chalkash / yangi imkoniyat / narx, set by the agent
 *   reply        once the sub-task is done, the agent writes a short reply and
 *                confirms it; the bot sends it once (not AI); a client who
 *                turned these off gets nothing
 *
 * Every Workspace write goes through the Workspace transaction as the acting
 * staff account, so the Workspace triggers log it (workspace_activity_log).
 */

const { withWorkspaceTransaction, requireWorkspaceAccess } = require('../workspace/authz');
const { CLIENT_TYPE_LABELS } = require('./agents');

const TAGS = Object.freeze(['xato', 'chalkash', 'yangi_imkoniyat', 'narx']);
const TAG_LABELS = Object.freeze({ xato: 'Xato', chalkash: 'Chalkash', yangi_imkoniyat: 'Yangi imkoniyat', narx: 'Narx' });
const SECTIONS = Object.freeze(['Muammo', 'Hozirgi yechim', 'Demo', '7-kun', '14-kun', 'Narx javoblari']);
const REPLY_MAX = 600;

const fail = (status, error, message = null) => ({ ok: false, status, error, message });

async function roleOf(db, id) {
  const r = await db.query('SELECT role FROM admins WHERE id = $1', [id]);
  return r.rows[0] ? r.rows[0].role : null;
}

/** The pilot Workspace (null before a master opens it, or if it was deleted). */
async function pilotWorkspace(db) {
  const r = await db.query(
    `SELECT p.workspace_id, w.owner_id FROM pilot_workspace p JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = 1 AND w.deleted_at IS NULL AND w.internal`);
  return r.rows[0] || null;
}

/** Add a staff account to the pilot Workspace as a member (as its owner); a repeat does nothing. */
async function ensureMember(pool, ws, userId) {
  if (!ws || !userId || Number(userId) === Number(ws.owner_id)) return;
  await withWorkspaceTransaction(pool, ws.owner_id, (db) => db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3)
     ON CONFLICT (workspace_id, user_id) DO NOTHING`, [ws.workspace_id, userId, ws.owner_id]));
}

/** A master opens the pilot's internal Workspace once; every agent with a code becomes a member. */
async function openWorkspace(pool, { masterId, name = 'CustDev pilot' }) {
  if ((await roleOf(pool, masterId)) !== 'master') return fail(403, 'master_only');
  const have = await pilotWorkspace(pool);
  if (have) return { ok: true, workspaceId: have.workspace_id, existed: true };
  const title = String(name || 'CustDev pilot').trim().slice(0, 120) || 'CustDev pilot';
  const slug = `custdev-pilot-${Date.now().toString(36)}`;
  const ws = await withWorkspaceTransaction(pool, masterId, async (db) => {
    const w = (await db.query(
      `INSERT INTO workspaces (name, slug, owner_id, created_by, internal) VALUES ($1, $2, $3, $3, true) RETURNING id`,
      [title, slug, masterId])).rows[0];
    await db.query(
      `INSERT INTO pilot_workspace (id, workspace_id, created_by) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id, created_by = EXCLUDED.created_by, created_at = now()`,
      [w.id, masterId]);
    return w;
  });
  const row = { workspace_id: ws.id, owner_id: masterId };
  const agents = await pool.query(`SELECT id FROM admins WHERE sales_agent_code IS NOT NULL AND role IN ('student', 'lawyer')`);
  for (const a of agents.rows) await ensureMember(pool, row, a.id);
  return { ok: true, workspaceId: ws.id, existed: false, members: agents.rows.length };
}

function clientTaskDescription(c) {
  const head = [`Mijoz: ${c.full_name || '—'} (#${c.id}) — ${CLIENT_TYPE_LABELS[c.client_type] || 'tur belgilanmagan'}`,
    `Agent: ${c.agent_name || '—'}`, c.pilot_ends ? `Pilot: ${String(c.pilot_ends).slice(0, 10)} gacha` : null].filter(Boolean).join('\n');
  return `${head}\n\n${SECTIONS.map(s => `## ${s}\n`).join('\n')}`;
}

async function clientRow(db, adminId) {
  const r = await db.query(
    `SELECT c.id, c.full_name, c.role, c.client_type, c.referred_by_agent_id AS agent_id, g.full_name AS agent_name,
            (SELECT p.ends_at FROM pilot_requests q JOIN tariff_periods p ON p.id = q.period_id WHERE q.admin_id = c.id AND q.status = 'approved') AS pilot_ends
       FROM admins c LEFT JOIN admins g ON g.id = c.referred_by_agent_id WHERE c.id = $1`, [adminId]);
  return r.rows[0] || null;
}

/** May this staff account work on this client: a master, or the agent the client came through. */
async function mayActFor(db, actorId, client) {
  const role = await roleOf(db, actorId);
  if (role === 'master') return true;
  return !!(client && client.agent_id && Number(client.agent_id) === Number(actorId) && ['student', 'lawyer'].includes(role));
}

/**
 * The client's task in the pilot Workspace, opened once. actorId: who opens it
 * by hand (a master or the client's agent); without one (the pilot was just
 * approved) the client's agent opens it, else the Workspace owner.
 */
async function ensureClientTask(pool, { adminId, actorId = null }) {
  const ws = await pilotWorkspace(pool);
  if (!ws) return fail(409, 'no_pilot_workspace', "Pilot Workspace hali ochilmagan (Boshqaruv → CustDev pilot)");
  const c = await clientRow(pool, adminId);
  if (!c || c.role !== 'user') return fail(404, 'not_found');
  if (actorId != null && !(await mayActFor(pool, actorId, c))) return fail(404, 'not_found');
  const actor = actorId != null ? Number(actorId) : (c.agent_id || ws.owner_id);
  if (actor !== Number(ws.owner_id)) await ensureMember(pool, ws, actor);
  if (c.agent_id && Number(c.agent_id) !== actor) await ensureMember(pool, ws, c.agent_id);
  return withWorkspaceTransaction(pool, actor, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pilot_task:${adminId}`]);
    const have = (await db.query('SELECT task_id, workspace_id FROM pilot_client_tasks WHERE admin_id = $1', [adminId])).rows[0];
    if (have) return { ok: true, taskId: have.task_id, workspaceId: have.workspace_id, existed: true };
    await requireWorkspaceAccess(db, ws.workspace_id, actor, { minimumRole: 'member', requireActive: true });
    const title = `Mijoz: ${c.full_name || `#${c.id}`} — ${CLIENT_TYPE_LABELS[c.client_type] || 'tur belgilanmagan'}`.slice(0, 240);
    const due = c.pilot_ends ? new Date(c.pilot_ends).toISOString().slice(0, 10) : null;
    const t = (await db.query(
      `INSERT INTO workspace_tasks (workspace_id, title, description, status, priority, due_date, created_by, updated_by)
       VALUES ($1, $2, $3, 'in_progress', 'normal', $4, $5, $5) RETURNING id`,
      [ws.workspace_id, title, clientTaskDescription(c), due, actor])).rows[0];
    const owner = c.agent_id || actor;
    await db.query(`INSERT INTO workspace_task_assignees (workspace_id, task_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [ws.workspace_id, t.id, owner, actor]);
    await db.query(`INSERT INTO workspace_task_watchers (workspace_id, task_id, user_id, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [ws.workspace_id, t.id, owner, actor]);
    await db.query(`INSERT INTO pilot_client_tasks (admin_id, workspace_id, task_id, agent_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [adminId, ws.workspace_id, t.id, c.agent_id || null, actor]);
    return { ok: true, taskId: t.id, workspaceId: ws.workspace_id, existed: false };
  });
}

/** An approved pilot whose period is running: only such a client gets feedback mode. */
async function activePilot(db, adminId) {
  const r = await db.query(
    `SELECT q.admin_id FROM pilot_requests q JOIN tariff_periods p ON p.id = q.period_id
      WHERE q.admin_id = $1 AND q.status = 'approved' AND p.status = 'active' AND p.ends_at > now()`, [adminId]);
  return !!r.rows[0];
}

/**
 * One feedback message -> one sub-task of the client's task, in one
 * transaction: the row is unique by chat + message, so a repeated delivery of
 * the same Telegram message changes nothing.
 */
async function recordFeedback(pool, { adminId, chatId, messageId, text, source = 'text' }) {
  const body = String(text || '').trim();
  if (!body) return fail(400, 'empty');
  if (!(await activePilot(pool, adminId))) return fail(403, 'not_in_pilot');
  const dup = (await pool.query('SELECT id, task_id FROM pilot_feedback WHERE tg_chat_id = $1 AND tg_message_id = $2', [chatId, messageId])).rows[0];
  if (dup) return { ok: true, duplicate: true, id: dup.id, taskId: dup.task_id };
  const parent = await ensureClientTask(pool, { adminId });
  if (!parent.ok) return parent;
  const c = await clientRow(pool, adminId);
  const ws = await pilotWorkspace(pool);
  const actor = c.agent_id || ws.owner_id;
  return withWorkspaceTransaction(pool, actor, async (db) => {
    const row = (await db.query(
      `INSERT INTO pilot_feedback (admin_id, agent_id, tg_chat_id, tg_message_id, source, workspace_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tg_chat_id, tg_message_id) DO NOTHING RETURNING id`,
      [adminId, c.agent_id || null, chatId, messageId, source === 'voice' ? 'voice' : 'text', parent.workspaceId])).rows[0];
    if (!row) {
      const d = (await db.query('SELECT id, task_id FROM pilot_feedback WHERE tg_chat_id = $1 AND tg_message_id = $2', [chatId, messageId])).rows[0];
      return { ok: true, duplicate: true, id: d.id, taskId: d.task_id };
    }
    await requireWorkspaceAccess(db, parent.workspaceId, actor, { minimumRole: 'member', requireActive: true });
    const first = body.replace(/\s+/gu, ' ').slice(0, 100);
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const t = (await db.query(
      `INSERT INTO workspace_tasks (workspace_id, title, description, status, priority, created_by, updated_by)
       VALUES ($1, $2, $3, 'todo', 'normal', $4, $4) RETURNING id`,
      [parent.workspaceId, `Fikr: ${first}`.slice(0, 240),
        `${body.slice(0, 20000)}\n\n— ${c.full_name || `#${adminId}`}, Telegram (${source === 'voice' ? 'ovozli xabar, matnga aylantirilgan' : 'matn'}), ${when} UTC`, actor])).rows[0];
    await db.query(`INSERT INTO workspace_task_links (workspace_id, source_task_id, target_task_id, link_type, created_by) VALUES ($1, $2, $3, 'subtask', $4)`,
      [parent.workspaceId, parent.taskId, t.id, actor]);
    if (c.agent_id) {
      await db.query(`INSERT INTO workspace_task_assignees (workspace_id, task_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [parent.workspaceId, t.id, c.agent_id, actor]);
    }
    await db.query('UPDATE pilot_feedback SET task_id = $2 WHERE id = $1', [row.id, t.id]);
    return { ok: true, duplicate: false, id: row.id, taskId: t.id };
  });
}

async function feedbackRow(db, id) {
  const r = await db.query(
    `SELECT f.*, c.full_name, c.referred_by_agent_id AS agent_id, c.telegram_chat_id, c.pilot_replies_off,
            t.status AS task_status, t.title AS task_title
       FROM pilot_feedback f JOIN admins c ON c.id = f.admin_id
       LEFT JOIN workspace_tasks t ON t.workspace_id = f.workspace_id AND t.id = f.task_id
      WHERE f.id = $1`, [id]);
  return r.rows[0] || null;
}

async function comment(pool, actorId, f, body) {
  await withWorkspaceTransaction(pool, actorId, async (db) => {
    await requireWorkspaceAccess(db, f.workspace_id, actorId, { minimumRole: 'member', requireActive: true });
    // sealed like every Workspace comment (E5, src/workspace/sealing.js)
    const sealing = require('../workspace/sealing');
    await db.query(`INSERT INTO workspace_task_comments (workspace_id, task_id, author_id, body) VALUES ($1, $2, $3, $4)`,
      [f.workspace_id, f.task_id, actorId, sealing.sealText(body, sealing.aad.comment(f.workspace_id, f.task_id))]);
  });
}

/** The agent (or a master) tags a feedback; the tag is also a comment on the sub-task (logged). */
async function tagFeedback(pool, { feedbackId, tag, actorId }) {
  if (!TAGS.includes(tag)) return fail(400, 'invalid_tag');
  const f = await feedbackRow(pool, feedbackId);
  if (!f || !f.task_id || !(await mayActFor(pool, actorId, f))) return fail(404, 'not_found');
  if (f.tag === tag) return { ok: true, tag, unchanged: true };
  await ensureMember(pool, await pilotWorkspace(pool), actorId);
  await comment(pool, actorId, f, `Teg: ${TAG_LABELS[tag]}`);
  await pool.query('UPDATE pilot_feedback SET tag = $2, tagged_by = $3, tagged_at = now() WHERE id = $1', [feedbackId, tag, actorId]);
  return { ok: true, tag };
}

/**
 * Close the loop: once the sub-task is done, the agent's own short reply,
 * confirmed, goes to the client once. send(chatId, text, feedbackId) delivers
 * it; nothing is sent to a client who turned these off or has no chat.
 */
async function replyFeedback(pool, { feedbackId, text, actorId, confirmed = false, send }) {
  const body = String(text || '').trim();
  if (!body || body.length > REPLY_MAX) return fail(400, 'invalid_reply', `Javob 1–${REPLY_MAX} belgi bo'lsin`);
  if (confirmed !== true) return fail(409, 'confirm_required', "Javobni tasdiqlang: u mijozga bir marta yuboriladi");
  const f = await feedbackRow(pool, feedbackId);
  if (!f || !f.task_id || !(await mayActFor(pool, actorId, f))) return fail(404, 'not_found');
  if (f.task_status !== 'done') return fail(409, 'task_not_done', "Avval Workspace'da bu fikr vazifasini «Bajarildi» qiling");
  const won = (await pool.query(
    `UPDATE pilot_feedback SET reply_text = $2, reply_by = $3, reply_confirmed_at = now()
      WHERE id = $1 AND reply_confirmed_at IS NULL RETURNING id`, [feedbackId, body, actorId])).rows[0];
  if (!won) return fail(409, 'already_replied', 'Bu fikrga javob allaqachon yuborilgan');
  await ensureMember(pool, await pilotWorkspace(pool), actorId);
  await comment(pool, actorId, f, `Mijozga javob (tasdiqlangan): ${body}`);
  let status = 'sent';
  if (f.pilot_replies_off) status = 'opted_out';
  else if (!f.telegram_chat_id || typeof send !== 'function') status = 'no_chat';
  else {
    try { await send(f.telegram_chat_id, body, feedbackId); } catch (e) { status = 'failed'; console.warn('[PILOT] reply not delivered:', e.message); }
  }
  // a delivery that failed is not "sent once": the agent may send it again
  await pool.query(`UPDATE pilot_feedback SET reply_status = $2${status === 'failed' ? ', reply_confirmed_at = NULL' : ''} WHERE id = $1`, [feedbackId, status]);
  return { ok: true, status };
}

/** The client turns the replies off (or on again) from the bot. */
async function setRepliesOff(db, { adminId, off = true }) {
  await db.query('UPDATE admins SET pilot_replies_off = $2 WHERE id = $1', [adminId, !!off]);
  return { ok: true, off: !!off };
}

/** Feedback for the agent's own clients (or every one, for a master), newest first. */
async function listFeedback(pool, { actorId, limit = 200 }) {
  const master = (await roleOf(pool, actorId)) === 'master';
  const r = await pool.query(
    `SELECT f.id, f.admin_id, c.full_name, c.client_type, f.source, f.tag, f.created_at, f.reply_text, f.reply_status, f.reply_confirmed_at,
            t.title, t.description, t.status AS task_status, g.full_name AS agent_name
       FROM pilot_feedback f JOIN admins c ON c.id = f.admin_id
       LEFT JOIN admins g ON g.id = c.referred_by_agent_id
       LEFT JOIN workspace_tasks t ON t.workspace_id = f.workspace_id AND t.id = f.task_id
      WHERE ($1::boolean OR c.referred_by_agent_id = $2) ORDER BY f.created_at DESC LIMIT $3`,
    [master, actorId, Math.min(500, Math.max(1, Number(limit) || 200))]);
  return r.rows.map(x => ({ ...x, text: String(x.description || '').split('\n\n— ')[0] }));
}

/** The weekly view: feedback by tag, and how many clients said each (counts only). */
async function weekly(pool, { actorId, days = 7 }) {
  const master = (await roleOf(pool, actorId)) === 'master';
  const d = Math.min(90, Math.max(1, Number(days) || 7));
  const r = await pool.query(
    `SELECT COALESCE(f.tag, 'untagged') AS tag, count(*)::int AS feedback, count(DISTINCT f.admin_id)::int AS clients
       FROM pilot_feedback f JOIN admins c ON c.id = f.admin_id
      WHERE f.created_at > now() - make_interval(days => $3) AND ($1::boolean OR c.referred_by_agent_id = $2)
      GROUP BY 1 ORDER BY 2 DESC`, [master, actorId, d]);
  return { days: d, rows: r.rows };
}

module.exports = { TAGS, TAG_LABELS, SECTIONS, REPLY_MAX, pilotWorkspace, ensureMember, openWorkspace, ensureClientTask, activePilot,
  recordFeedback, tagFeedback, replyFeedback, setRepliesOff, listFeedback, weekly, clientTaskDescription };
