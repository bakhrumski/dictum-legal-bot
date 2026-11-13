'use strict';

/**
 * Boshqaruv -> "Sud amaliyoti" (S1, docs/design/sud-amaliyoti.md). Master
 * only (the role read again from the database). No AI, no unit.
 *
 *   GET  /api/admin/plenum                     counts, the last runs, whether a run is going
 *   POST /api/admin/plenum/sync { mode, limit } start a run in the background (dry | apply) -> 202
 *   GET  /api/admin/plenum/decisions?q=&page=   the stored decisions (no text)
 *   GET  /api/admin/plenum/decisions/:id?lang=  one decision's bands and the articles they name
 *
 * PLENUM_SYNC=weekly runs `apply` once a week (Sunday night, Tashkent) after
 * the first apply; unset, nothing runs by itself. PLENUM=off stops it all.
 */

const { createPlenumSync } = require('./sync');

function mountPlenumRoutes(app, { pool, requireMasterAdmin, requireSameOrigin, logAudit = () => {}, sync = null }) {
  const plenum = sync || createPlenumSync({ db: pool, log: m => console.log(m) });
  const off = () => String(process.env.PLENUM || '').toLowerCase() === 'off';
  const master = async (req, res, next) => {
    try {
      const r = await pool.query('SELECT role FROM admins WHERE id = $1', [req.session.adminId]);
      if (!r.rows[0] || r.rows[0].role !== 'master') return res.status(403).json({ error: 'Master admin access required' });
      next();
    } catch (e) { res.status(500).json({ error: 'failed' }); }
  };
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable', message: 'PLENUM=off' });
    try { await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: 'Jadval hali yaratilmagan (migratsiya 041).' });
      console.error('[PLENUM]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(e.status || 500).json({ error: 'failed', message: e.message });
    }
  };

  app.get('/api/admin/plenum', requireMasterAdmin, master, guard(async (req, res) => {
    const c = (await pool.query(`SELECT count(*) FILTER (WHERE in_force)::int AS in_force, count(*) FILTER (WHERE NOT in_force)::int AS not_in_force,
        count(*) FILTER (WHERE in_force AND court = 'oliy')::int AS oliy, count(*) FILTER (WHERE in_force AND court = 'xojalik')::int AS xojalik,
        count(*) FILTER (WHERE in_force AND court = 'qoshma')::int AS qoshma, count(*) FILTER (WHERE in_force AND is_amendment)::int AS amendments,
        COALESCE(sum(bands) FILTER (WHERE in_force), 0)::int AS bands, max(checked_at) AS checked_at FROM plenum_decisions`)).rows[0];
    const runs = (await pool.query(`SELECT r.id, r.mode, r.status, r.started_at, r.finished_at, r.report, a.full_name AS by
        FROM plenum_sync_runs r LEFT JOIN admins a ON a.id = r.started_by ORDER BY r.id DESC LIMIT 6`)).rows;
    res.json({ counts: c, runs, running: plenum.isRunning(), weekly: String(process.env.PLENUM_SYNC || '').toLowerCase() === 'weekly' });
  }));

  app.post('/api/admin/plenum/sync', requireSameOrigin, requireMasterAdmin, master, guard(async (req, res) => {
    const mode = (req.body && req.body.mode) === 'apply' ? 'apply' : 'dry';
    const limit = Number(req.body && req.body.limit) > 0 ? Math.min(500, Math.floor(Number(req.body.limit))) : null;
    if (plenum.isRunning()) return res.status(409).json({ error: 'running', message: 'Sinxronlash allaqachon ishlayapti.' });
    logAudit(req, 'plenum.sync', 'plenum', `${mode}${limit ? `:${limit}` : ''}`);
    // a run reads hundreds of pages (minutes): it goes on after this reply, the page asks again
    plenum.run({ mode, by: req.session.adminId, limit }).catch(e => console.warn('[PLENUM] run failed:', e.message));
    res.status(202).json({ started: true, mode, limit });
  }));

  app.get('/api/admin/plenum/decisions', requireMasterAdmin, master, guard(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const args = [];
    let where = 'WHERE in_force';
    if (q) { args.push(`%${q}%`); where += ` AND (title_lat ILIKE $1 OR title_uz ILIKE $1 OR title_ru ILIKE $1 OR number = $${args.length + 1})`; args.push(q); }
    args.push(50, (page - 1) * 50);
    const r = await pool.query(`SELECT lex_id, lat_lex_id, ru_lex_id, court, number, adopted_on, title_lat, title_uz, title_ru, is_amendment, bands, checked_at,
        count(*) OVER()::int AS total FROM plenum_decisions ${where} ORDER BY adopted_on DESC NULLS LAST, lex_id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
    res.json({ decisions: r.rows.map(({ total, ...x }) => x), total: r.rows[0] ? r.rows[0].total : 0, page });
  }));

  app.get('/api/admin/plenum/decisions/:id', requireMasterAdmin, master, guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lang = ['uz', 'lat', 'ru'].includes(req.query.lang) ? req.query.lang : 'lat';
    const d = (await pool.query('SELECT * FROM plenum_decisions WHERE lex_id = $1', [id])).rows[0];
    if (!d) return res.status(404).json({ error: 'not_found' });
    const bands = (await pool.query('SELECT lang, n, text, article_refs FROM plenum_bands WHERE decision_id = $1 AND lang = $2 ORDER BY n', [id, lang])).rows;
    const langs = (await pool.query('SELECT DISTINCT lang FROM plenum_bands WHERE decision_id = $1', [id])).rows.map(x => x.lang);
    res.json({ decision: d, lang, langs, bands });
  }));

  /* the weekly refresh: Sunday after 01:00 Tashkent, when the last apply is over 6 days old */
  if (String(process.env.PLENUM_SYNC || '').toLowerCase() === 'weekly' && !off()) {
    const tick = async () => {
      try {
        const now = new Date(Date.now() + 5 * 3600e3); // Asia/Tashkent, UTC+5 all year
        if (now.getUTCDay() !== 0 || now.getUTCHours() < 1 || plenum.isRunning()) return;
        const last = (await pool.query(`SELECT max(started_at) AS t FROM plenum_sync_runs WHERE mode = 'apply' AND status = 'done'`)).rows[0].t;
        if (!last || Date.now() - new Date(last).getTime() < 6 * 864e5) return; // the first apply is the owner's
        await plenum.run({ mode: 'apply', by: null });
      } catch (e) { console.warn('[PLENUM] weekly:', e.message); }
    };
    const t = setInterval(tick, 3600e3); if (t.unref) t.unref();
  }
  return plenum;
}

module.exports = { mountPlenumRoutes };
