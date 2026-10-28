'use strict';

/**
 * Each account's own speech glossary (2026-10-28, owner: "glossary har bir
 * user uchun individual alohida bo'lishi kerak"; migration 021,
 * table voice_glossary). It learns from what the person does, and they can
 * see and change all of it:
 *
 *   picked a suggestion / corrected the heard words   -> fix   heard -> term
 *   kept the heard word against a suggestion           -> word  (never flagged again)
 *   added by hand ("Lug'atim")                         -> fix or word
 *
 * The glossary only orders and filters suggestions (src/voice/glossary.js);
 * nothing is replaced by itself. One account's rows are never read for
 * another. At most MAX rows an account: the least used learned row makes
 * room. No AI.
 *
 *   GET    /api/voice/glossary          the caller's rows
 *   POST   /api/voice/glossary          { term, heard? }   by hand
 *   DELETE /api/voice/glossary/:id      the caller's own
 *   POST   /api/voice/glossary/learn    { heard, final, suggested } or { pairs: [{ from, to }], keep: [word] }
 */

const glossary = require('./glossary');

const MAX = 500;
const CACHE_MS = 60 * 1000;
const cache = new Map(); // adminId -> { at, opts }

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const word = v => clean(v, 80).replace(/^[«"“(]+|[»"”).,:;!?]+$/gu, '');
const tableMissing = e => /relation "voice_glossary" does not exist/u.test(String(e && e.message));

function createUserGlossary({ db }) {
  async function list(adminId) {
    const r = await db.query(
      `SELECT id, kind, heard, term, source, uses, updated_at FROM voice_glossary WHERE admin_id = $1 ORDER BY updated_at DESC LIMIT ${MAX}`, [adminId]);
    return r.rows;
  }

  /** { extra, fixes } for glossary.suggest - from cache for a minute; an unavailable table is an empty glossary */
  async function optionsFor(adminId) {
    if (!adminId) return { extra: [], fixes: {} };
    const hit = cache.get(adminId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.opts;
    let rows = [];
    try { rows = await list(adminId); } catch (e) { if (!tableMissing(e)) console.warn('[GLOSSARY] read failed:', e.message); }
    const opts = { extra: [], fixes: {} };
    for (const r of rows) {
      opts.extra.push(r.term);
      if (r.kind === 'fix' && r.heard) opts.fixes[r.heard.toLocaleLowerCase('uz')] = r.term;
    }
    cache.set(adminId, { at: Date.now(), opts });
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
    return opts;
  }

  async function suggest(adminId, text) {
    return glossary.suggest(text, await optionsFor(adminId));
  }

  async function room(adminId) {
    const n = (await db.query('SELECT count(*)::int AS n FROM voice_glossary WHERE admin_id = $1', [adminId])).rows[0].n;
    if (n < MAX) return true;
    // a full glossary makes room by dropping its least used learned row; hand-made rows stay
    const r = await db.query(`DELETE FROM voice_glossary WHERE id = (SELECT id FROM voice_glossary WHERE admin_id = $1 AND source = 'learned'
      ORDER BY uses, updated_at LIMIT 1) RETURNING id`, [adminId]);
    return r.rowCount > 0;
  }

  /** one row, or one more use of the same row */
  async function put(adminId, { kind, heard = '', term, source }) {
    term = word(term); heard = kind === 'fix' ? word(heard) : '';
    if (term.length < 2 || (kind === 'fix' && (heard.length < 2 || glossary.bare(heard) === glossary.bare(term)))) return null;
    const same = await db.query(`UPDATE voice_glossary SET uses = uses + 1, updated_at = now()
      WHERE admin_id = $1 AND kind = $2 AND lower(heard) = lower($3) AND lower(term) = lower($4) RETURNING id, kind, heard, term, source, uses`, [adminId, kind, heard, term]);
    if (same.rows[0]) return same.rows[0];
    if (!(await room(adminId))) return null;
    // a new correction of the same heard word replaces the old one
    if (kind === 'fix') await db.query(`DELETE FROM voice_glossary WHERE admin_id = $1 AND kind = 'fix' AND lower(heard) = lower($2)`, [adminId, heard]);
    const r = await db.query(`INSERT INTO voice_glossary (admin_id, kind, heard, term, source) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING RETURNING id, kind, heard, term, source, uses`, [adminId, kind, heard, term, source]);
    return r.rows[0] || null;
  }

  /**
   * What the person did with a heard text: the words they changed, the words
   * they kept against a suggestion. `heard` + `final` (+ `suggested`): the
   * page sends the dictated text and what was run; the pairs are worked out here.
   */
  async function learn(adminId, { pairs = [], keep = [], heard = null, final = null, suggested = [] } = {}) {
    if (heard != null && final != null) {
      pairs = glossary.learnPairs(clean(heard, 600), clean(final, 600));
      const fin = glossary.bare(final);
      keep = (Array.isArray(suggested) ? suggested : []).map(x => x && x.from).filter(w => w && fin.includes(glossary.bare(w)));
    }
    const out = [];
    for (const p of (Array.isArray(pairs) ? pairs : []).slice(0, 5)) {
      const row = await put(adminId, { kind: 'fix', heard: p && p.from, term: p && p.to, source: 'learned' });
      if (row) out.push(row);
    }
    for (const w of (Array.isArray(keep) ? keep : []).slice(0, 5)) {
      const row = await put(adminId, { kind: 'word', term: w, source: 'learned' });
      if (row) out.push(row);
    }
    cache.delete(adminId);
    return out;
  }

  async function add(adminId, { term, heard = '' }) {
    const row = await put(adminId, { kind: clean(heard, 80) ? 'fix' : 'word', heard, term, source: 'manual' });
    cache.delete(adminId);
    return row;
  }

  async function remove(adminId, id) {
    const r = await db.query('DELETE FROM voice_glossary WHERE id = $1 AND admin_id = $2', [Number(id) || 0, adminId]);
    cache.delete(adminId);
    return r.rowCount > 0;
  }

  return { list, optionsFor, suggest, learn, add, remove };
}

function mountGlossaryRoutes(app, { db, requireAuth, requireSameOrigin }) {
  const g = createUserGlossary({ db });
  const me = req => req.session.adminId;
  const safe = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (tableMissing(e)) return res.status(503).json({ error: 'unavailable', message: "Lug'at hali tayyor emas" });
      console.error('[GLOSSARY]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  app.get('/api/voice/glossary', requireAuth, safe(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ rows: await g.list(me(req)), max: MAX });
  }));
  app.post('/api/voice/glossary', requireSameOrigin, requireAuth, safe(async (req, res) => {
    const row = await g.add(me(req), { term: req.body && req.body.term, heard: req.body && req.body.heard });
    if (!row) return res.status(400).json({ error: 'invalid', message: "So'z kamida 2 harf bo'lsin; eshitilgan shakl to'g'risidan farq qilsin" });
    res.status(201).json(row);
  }));
  app.delete('/api/voice/glossary/:id', requireSameOrigin, requireAuth, safe(async (req, res) => {
    res.status((await g.remove(me(req), req.params.id)) ? 204 : 404).end();
  }));
  app.post('/api/voice/glossary/learn', requireSameOrigin, requireAuth, safe(async (req, res) => {
    const b = req.body || {};
    const rows = await g.learn(me(req), { pairs: b.pairs, keep: b.keep, heard: typeof b.heard === 'string' ? b.heard : null, final: typeof b.final === 'string' ? b.final : null, suggested: b.suggested });
    res.json({ learned: rows.length });
  }));
  return g;
}

/** Account deletion: the person's glossary goes. */
async function deleteAccountGlossary(db, adminId) {
  await db.query('DELETE FROM voice_glossary WHERE admin_id = $1', [adminId]);
  cache.delete(adminId);
}

module.exports = { createUserGlossary, mountGlossaryRoutes, deleteAccountGlossary, MAX };
