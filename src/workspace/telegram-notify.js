'use strict';

/**
 * Workspace updates in Telegram (2026-10-20, owner: the landing promises "when
 * a task status changes or a deadline approaches, the team gets a message").
 * Before, Workspace showed changes live on the page only.
 *
 *   - a task's status changes: its assignees, watchers and creator get one
 *     bot message, except the person who changed it;
 *   - a task is due today or tomorrow (Asia/Tashkent) and not done or
 *     cancelled: each assignee (the creator when nobody is assigned) gets one
 *     reminder per task and due date - an hourly sweep, deduplicated in
 *     workspace_telegram_reminders.
 *
 * Only members with a linked Telegram chat get a message; only the task title,
 * the workspace name, the status and the date are sent - never the
 * description, comments or documents. Sending is best effort: a failure is
 * logged and never changes the task. WS_TELEGRAM_NOTIFY=off turns both off.
 */

const STATUS_UZ = { todo: 'Yangi', in_progress: 'Jarayonda', blocked: "To'xtab qolgan", review: 'Tekshiruvda', done: 'Bajarildi', cancelled: 'Bekor qilindi' };
const SWEEP_MS = 60 * 60 * 1000;

const enabled = () => String(process.env.WS_TELEGRAM_NOTIFY || 'on').toLowerCase() !== 'off';

function tashkentDate(now = new Date(), addDays = 0) {
  const d = new Date(now.getTime() + addDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const ddmm = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const appUrl = () => `${String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '')}/app/#/jamoa`;

/** deps: pool, send(chatId, text) -> Promise. */
function createWorkspaceTelegramNotifier({ pool, send }) {
  async function chatsOf(userIds) {
    if (!userIds.length) return [];
    const r = await pool.query(
      `SELECT id, COALESCE(telegram_chat_id, telegram_user_id) AS chat FROM admins WHERE id = ANY($1::int[])`, [userIds]);
    return r.rows.filter(x => x.chat);
  }

  async function taskStatusChanged({ workspaceId, taskId, oldStatus, newStatus, actorId }) {
    if (!enabled() || !send || oldStatus === newStatus) return 0;
    const t = (await pool.query(
      `SELECT t.title, t.created_by, w.name AS workspace FROM workspace_tasks t JOIN workspaces w ON w.id = t.workspace_id
        WHERE t.workspace_id = $1 AND t.id = $2 AND t.deleted_at IS NULL`, [workspaceId, taskId])).rows[0];
    if (!t) return 0;
    const people = (await pool.query(
      `SELECT user_id FROM workspace_task_assignees WHERE workspace_id = $1 AND task_id = $2
       UNION SELECT user_id FROM workspace_task_watchers WHERE workspace_id = $1 AND task_id = $2`, [workspaceId, taskId])).rows.map(x => x.user_id);
    const ids = [...new Set([...people, t.created_by])].filter(id => id !== actorId);
    const text = `📋 ${t.workspace} · ${t.title}\nHolati: ${STATUS_UZ[oldStatus] || oldStatus} → ${STATUS_UZ[newStatus] || newStatus}\n${appUrl()}`;
    let sent = 0;
    for (const p of await chatsOf(ids)) {
      try { await send(p.chat, text); sent++; } catch (e) { console.warn('[WS-TG] status message failed:', e.message); }
    }
    return sent;
  }

  async function ensureTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS workspace_telegram_reminders (
      task_id uuid NOT NULL, user_id integer NOT NULL, due_date date NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (task_id, user_id, due_date))`);
  }

  async function sendDueReminders(now = new Date()) {
    if (!enabled() || !send) return 0;
    await ensureTable();
    const today = tashkentDate(now), tomorrow = tashkentDate(now, 1);
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_date::text AS due, t.created_by, w.name AS workspace,
              COALESCE(array_agg(a.user_id) FILTER (WHERE a.user_id IS NOT NULL), '{}') AS assignees
         FROM workspace_tasks t
         JOIN workspaces w ON w.id = t.workspace_id
         LEFT JOIN workspace_task_assignees a ON a.workspace_id = t.workspace_id AND a.task_id = t.id
        WHERE t.deleted_at IS NULL AND t.status NOT IN ('done', 'cancelled')
          AND t.due_date IN ($1::date, $2::date)
        GROUP BY t.id, w.name
        LIMIT 500`, [today, tomorrow]);
    let sent = 0;
    for (const t of rows) {
      const ids = t.assignees.length ? t.assignees : [t.created_by];
      for (const p of await chatsOf(ids)) {
        const claim = await pool.query(
          `INSERT INTO workspace_telegram_reminders (task_id, user_id, due_date) VALUES ($1, $2, $3::date)
           ON CONFLICT DO NOTHING RETURNING task_id`, [t.id, p.id, t.due]);
        if (!claim.rows.length) continue;
        const when = t.due.slice(0, 10) === today ? 'bugun' : 'ertaga';
        try {
          await send(p.chat, `⏰ Muddat ${when} (${ddmm(t.due)}): ${t.title}\n${t.workspace}\n${appUrl()}`);
          sent++;
        } catch (e) {
          console.warn('[WS-TG] reminder failed:', e.message);
          await pool.query('DELETE FROM workspace_telegram_reminders WHERE task_id = $1 AND user_id = $2 AND due_date = $3::date', [t.id, p.id, t.due]).catch(() => {});
        }
      }
    }
    return sent;
  }

  function start() {
    if (!enabled()) return null;
    const run = () => sendDueReminders().catch(e => console.warn('[WS-TG] sweep failed:', e.message));
    const first = setTimeout(run, 60 * 1000); if (first.unref) first.unref();
    const timer = setInterval(run, SWEEP_MS); if (timer.unref) timer.unref();
    return timer;
  }

  return { taskStatusChanged, sendDueReminders, start, ensureTable };
}

module.exports = { createWorkspaceTelegramNotifier, tashkentDate, STATUS_UZ };
