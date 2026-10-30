'use strict';

/**
 * Access log (E6b, docs/design/shifrlash-1-bosqich.md §6): when a staff
 * account (master, lawyer, student) opens another person's sealed data, one
 * row per person seen - who looked, whose, which table, which route, how
 * many of their rows, when. Never the text. Reading one's own data is not
 * logged. Writing never blocks or fails the request it describes.
 *
 *   owner kinds  'account' (admins.id) and 'telegram_user' (users.id, the
 *                bot's human queue)
 *   ACCESS_LOG=off stops it.
 */

const STAFF = Object.freeze(['master', 'lawyer', 'student']);
const MAX_OWNERS = 200;

/**
 * record(db, req, { table, ownerKind, owners }) - owners: ids (repeats are
 * counted as rows seen). The viewer is the session's account and role.
 */
async function record(db, req, { table, ownerKind = 'account', owners = [] } = {}, env = process.env) {
  try {
    if (String(env.ACCESS_LOG || 'on').toLowerCase() === 'off') return 0;
    const s = (req && req.session) || {};
    const viewer = Number(s.adminId) || null;
    if (!viewer || !STAFF.includes(s.role)) return 0;
    const counts = new Map();
    for (const o of owners) {
      if (o == null || o === '') continue;
      const id = Number(o);
      if (!Number.isFinite(id)) continue;
      if (ownerKind === 'account' && id === viewer) continue; // one's own
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (!counts.size) return 0;
    const ids = [...counts.keys()].slice(0, MAX_OWNERS);
    const route = `${req.method || 'GET'} ${String((req.route && req.route.path) || req.path || '').slice(0, 100)}`;
    await db.query(
      `INSERT INTO data_access_log (viewer_id, viewer_role, owner_kind, owner_id, table_name, route, rows_seen)
       SELECT $1, $2, $3, o, $4, $5, n FROM unnest($6::bigint[], $7::int[]) AS t(o, n)`,
      [viewer, s.role, ownerKind, String(table).slice(0, 60), route, ids, ids.map(i => counts.get(i))]);
    return ids.length;
  } catch (e) {
    if (!/does not exist/u.test(String(e && e.message))) console.warn('[ACCESS-LOG] not written:', e.message);
    return 0;
  }
}

/** Fire and forget: the response never waits for it. */
const note = (db, req, what) => { record(db, req, what).catch(() => {}); };

/** The master's view: newest first, with names, filtered by days / viewer / owner. */
async function list(db, { days = 7, viewerId = null, ownerKind = null, ownerId = null, limit = 200 } = {}) {
  const d = Math.max(1, Math.min(Number(days) || 7, 365));
  const r = await db.query(
    `SELECT l.id, l.created_at, l.viewer_id, l.viewer_role, v.full_name AS viewer_name, v.username AS viewer_username,
            l.owner_kind, l.owner_id, l.table_name, l.route, l.rows_seen,
            CASE WHEN l.owner_kind = 'account' THEN oa.full_name ELSE ou.first_name END AS owner_name
       FROM data_access_log l
       LEFT JOIN admins v ON v.id = l.viewer_id
       LEFT JOIN admins oa ON l.owner_kind = 'account' AND oa.id = l.owner_id
       LEFT JOIN users ou ON l.owner_kind = 'telegram_user' AND ou.id = l.owner_id
      WHERE l.created_at > now() - make_interval(days => $1)
        AND ($2::int IS NULL OR l.viewer_id = $2)
        AND ($3::text IS NULL OR l.owner_kind = $3)
        AND ($4::bigint IS NULL OR l.owner_id = $4)
      ORDER BY l.created_at DESC LIMIT $5`,
    [d, viewerId, ownerKind, ownerId, Math.max(1, Math.min(Number(limit) || 200, 1000))]);
  return r.rows;
}

module.exports = { STAFF, record, note, list };
