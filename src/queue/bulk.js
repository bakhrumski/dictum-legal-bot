'use strict';

/**
 * The human queue's actions on many requests at once (2026-11-03, owner:
 * "Yopish", bulk assignment). Master only (the route checks the role in the
 * session and again in the database). No AI, no unit; the client is sent
 * nothing.
 *
 *   POST /api/requests/close    { requestIds: [..], reason? }  open requests -> 'closed' (who, when, why)
 *   POST /api/requests/reopen   { requestIds: [..] }           'closed' -> 'pending'
 *   POST /api/requests/assign-bulk { requestIds: [..], assigneeId }
 *        a lawyer becomes the request's lawyer, a student is added to it; the
 *        assignee gets ONE Telegram message with the count and the queue link
 *        (never the client's text), not one message a request.
 *
 * Every reply names how many rows changed and how many were left as they
 * were (already closed, answered, not found).
 */

const OPEN = ['pending', 'assigned', 'rejected', 'student_responded', 'lawyer_approved'];
const MAX_IDS = 200;

function ids(body) {
  const raw = Array.isArray(body && body.requestIds) ? body.requestIds : [];
  const out = [...new Set(raw.map(Number).filter(n => Number.isInteger(n) && n > 0))];
  return out.length > MAX_IDS ? null : out;
}

function mountQueueBulk(app, { pool, requireMasterAdmin, requireSameOrigin, logAudit = () => {}, notify = null }) {
  // the master role read again from the database: a session that says master is not enough
  const master = async (req, res, next) => {
    try {
      const r = await pool.query('SELECT role FROM admins WHERE id = $1', [req.session.adminId]);
      if (!r.rows[0] || r.rows[0].role !== 'master') return res.status(403).json({ error: 'Master admin access required' });
      next();
    } catch (e) { res.status(500).json({ error: 'failed' }); }
  };
  const bad = (res, msg) => res.status(400).json({ error: 'bad_request', message: msg });
  const tooMany = `Bir martada ${MAX_IDS} tagacha murojaat.`;

  app.post('/api/requests/close', requireSameOrigin, requireMasterAdmin, master, async (req, res) => {
    const list = ids(req.body); if (!list) return bad(res, tooMany); if (!list.length) return bad(res, 'Murojaat tanlanmagan.');
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 300) || null;
    try {
      const r = await pool.query(
        `UPDATE requests SET status = 'closed', closed_at = NOW(), closed_by = $2, close_reason = $3
          WHERE id = ANY($1::int[]) AND status = ANY($4::text[]) RETURNING id`,
        [list, req.session.adminId, reason, OPEN]);
      logAudit(req, 'request.close', 'request', `${r.rowCount}/${list.length}`);
      res.json({ closed: r.rowCount, skipped: list.length - r.rowCount, ids: r.rows.map(x => x.id) });
    } catch (e) { console.error('[QUEUE] close:', e.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/requests/reopen', requireSameOrigin, requireMasterAdmin, master, async (req, res) => {
    const list = ids(req.body); if (!list) return bad(res, tooMany); if (!list.length) return bad(res, 'Murojaat tanlanmagan.');
    try {
      const r = await pool.query(`UPDATE requests SET status = 'pending' WHERE id = ANY($1::int[]) AND status = 'closed' RETURNING id`, [list]);
      logAudit(req, 'request.reopen', 'request', `${r.rowCount}/${list.length}`);
      res.json({ reopened: r.rowCount, skipped: list.length - r.rowCount });
    } catch (e) { console.error('[QUEUE] reopen:', e.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/requests/assign-bulk', requireSameOrigin, requireMasterAdmin, master, async (req, res) => {
    const list = ids(req.body); if (!list) return bad(res, tooMany); if (!list.length) return bad(res, 'Murojaat tanlanmagan.');
    const who = Number(req.body && req.body.assigneeId);
    if (!Number.isInteger(who) || who <= 0) return bad(res, 'Kimga biriktirish tanlanmagan.');
    const client = await pool.connect();
    try {
      const a = (await client.query('SELECT id, role, full_name, telegram_chat_id FROM admins WHERE id = $1', [who])).rows[0];
      if (!a || !['lawyer', 'student'].includes(a.role)) return bad(res, 'Faqat yurist yoki talabaga biriktiriladi.');
      await client.query('BEGIN');
      let changed;
      if (a.role === 'lawyer') {
        changed = (await client.query(
          `UPDATE requests SET assigned_to = $2, assigned_at = NOW()
            WHERE id = ANY($1::int[]) AND status = ANY($3::text[]) AND assigned_to IS DISTINCT FROM $2 RETURNING id`,
          [list, who, OPEN])).rows.map(x => x.id);
      } else {
        changed = (await client.query(
          `INSERT INTO request_students (request_id, student_id)
           SELECT r.id, $2 FROM requests r WHERE r.id = ANY($1::int[]) AND r.status = ANY($3::text[])
           ON CONFLICT (request_id, student_id) DO NOTHING RETURNING request_id AS id`,
          [list, who, OPEN])).rows.map(x => x.id);
      }
      await client.query('COMMIT');
      logAudit(req, 'request.assign_bulk', 'request', `${a.role}:${who}:${changed.length}/${list.length}`);
      // one message for the whole batch: the count and the queue, never the clients' words
      if (changed.length && a.telegram_chat_id && typeof notify === 'function') {
        Promise.resolve(notify(a, changed)).catch(e => console.warn('[QUEUE] assign-bulk notify:', e.message));
      }
      res.json({ assigned: changed.length, skipped: list.length - changed.length, role: a.role, name: a.full_name || null });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[QUEUE] assign-bulk:', e.message); res.status(500).json({ error: 'failed' });
    } finally { client.release(); }
  });
}

module.exports = { mountQueueBulk, ids, OPEN, MAX_IDS };
