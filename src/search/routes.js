'use strict';
/**
 * U1 (docs/design/ux-audit-2026-11.md): one search over the NAMES of what a
 * person already has - chats, uploaded documents, editor documents, matters -
 * and the "Davom ettirish" list (the last items of every kind). No AI, no
 * unit, names only: a chat's messages, a document's text, a matter's summary
 * or an agent run's result are never read here (most are sealed anyway).
 *
 * Access is each list's own rule: own chats, own library, editor documents
 * owned or shared with the person, matters owned or of a live Workspace they
 * are in, own agent runs. SEARCH=off stops both routes (404).
 */
const A = require('../../public/js/uz-alphabet');

const enabled = () => String(process.env.SEARCH || '').toLowerCase() !== 'off';
const PER_KIND = 6;
const RECENT = 8;

/** The same folding as uz-alphabet.fold, in SQL: lower case, no apostrophes, 2026 letters to the old ones. */
// (the 2026 letters in both cases first: lower() of a C-locale database leaves non-ASCII letters as they are)
const FOLD_PAIRS = [['ö', 'o'], ['Ö', 'o'], ['ğ', 'g'], ['Ğ', 'g'], ['ş', 'sh'], ['Ş', 'sh'], ['ç', 'ch'], ['Ç', 'ch']];
const foldSql = col => 'lower(' + FOLD_PAIRS.reduce((acc, [a, b]) => `replace(${acc}, '${a}', '${b}')`, `translate(${col}, 'ʻ‘''\`ʼ’', '')`) + ')';
/** The query's words, folded (every one must be in the name, any order). */
function words(q) { return A.fold(String(q || '').slice(0, 120)).split(/\s+/u).filter(Boolean).slice(0, 6); }
function patterns(q) { const w = words(q); return w.length ? w.map(x => '%' + x.replace(/[\\%_]/g, m => '\\' + m) + '%') : null; }
const whereAll = (col, from) => (n) => Array.from({ length: n }, (_, i) => `${foldSql(col)} LIKE $${from + i}`).join(' AND ');

/** Each source is one query; a missing table (an older database) just drops that kind. */
async function safe(fn) { try { return await fn(); } catch (e) { if (e && e.code === '42P01') return []; throw e; } }

function createSearch({ db }) {
  const sources = {
    chat: (me, pats) => safe(async () => (await db.query(
      `SELECT id::text, title, updated_at AS at FROM ai_chat_sessions WHERE admin_id = $1
         ${pats ? 'AND ' + whereAll("coalesce(title, '')", 3)(pats.length) : ''} ORDER BY updated_at DESC LIMIT $2`,
      [me, pats ? PER_KIND : RECENT, ...(pats || [])])).rows.map(r => ({ kind: 'chat', id: r.id, title: r.title || '', at: r.at }))),
    doc: (me, pats) => safe(async () => (await db.query(
      `SELECT id::text, name, kind, pages, COALESCE(last_used_at, created_at) AS at FROM document_scans WHERE admin_id = $1 AND library
         ${pats ? 'AND ' + whereAll("coalesce(name, '')", 3)(pats.length) : ''} ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT $2`,
      [me, pats ? PER_KIND : RECENT, ...(pats || [])])).rows.map(r => ({ kind: 'doc', id: r.id, title: r.name || '', at: r.at, meta: { docKind: r.kind, pages: r.pages } }))),
    editor: (me, pats) => safe(async () => (await db.query(
      `SELECT d.id::text, d.title, d.updated_at AS at, (d.owner_id <> $1) AS shared FROM doc_editor_documents d
         LEFT JOIN doc_editor_members m ON m.document_id = d.id AND m.admin_id = $1
        WHERE (d.owner_id = $1 OR m.admin_id IS NOT NULL)
         ${pats ? 'AND ' + whereAll("coalesce(d.title, '')", 3)(pats.length) : ''} ORDER BY d.updated_at DESC LIMIT $2`,
      [me, pats ? PER_KIND : RECENT, ...(pats || [])])).rows.map(r => ({ kind: 'editor', id: r.id, title: r.title || '', at: r.at, meta: { shared: !!r.shared } }))),
    matter: (me, pats) => safe(async () => (await db.query(
      `SELECT m.id::text, m.title, m.status, m.updated_at AS at FROM matters m
         LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = $1
         LEFT JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.deleted_at IS NULL AND (m.owner_id = $1 OR (wm.user_id IS NOT NULL AND w.deleted_at IS NULL))
         ${pats ? 'AND ' + whereAll("coalesce(m.title, '')", 3)(pats.length) : ''} ORDER BY m.updated_at DESC LIMIT $2`,
      [me, pats ? PER_KIND : RECENT, ...(pats || [])])).rows.map(r => ({ kind: 'matter', id: r.id, title: r.title || '', at: r.at, meta: { status: r.status } }))),
    // an agent run has no name of its own: the title it was saved under in a matter, else its workflow (the page names it)
    run: (me, pats) => safe(async () => (await db.query(
      `SELECT r.id::text, r.workflow, r.status, COALESCE(r.finished_at, r.created_at) AS at,
              (SELECT i.title FROM matter_items i WHERE i.kind = 'agent_run' AND i.ref_uuid = r.id ORDER BY i.created_at LIMIT 1) AS title
         FROM agent_runs r WHERE r.admin_id = $1 AND r.status <> 'awaiting_approval'
        ORDER BY COALESCE(r.finished_at, r.created_at) DESC LIMIT $2`,
      [me, pats ? 50 : RECENT])).rows
      .map(r => ({ kind: 'run', id: r.id, title: r.title || '', at: r.at, meta: { workflow: r.workflow, status: r.status } }))
      .filter(r => !pats || (r.title && pats.words.every(w => A.fold(r.title).includes(w))))
      .slice(0, PER_KIND)),
  };
  const byTime = (a, b) => new Date(b.at) - new Date(a.at);

  async function search(me, q) {
    const pats = patterns(q);
    if (!pats) return { items: [] };
    pats.words = words(q);
    const lists = await Promise.all(Object.values(sources).map(fn => fn(me, pats)));
    return { items: [].concat(...lists).sort(byTime) };
  }
  async function recent(me) {
    const lists = await Promise.all(Object.values(sources).map(fn => fn(me, null)));
    return { items: [].concat(...lists).filter(x => x.at).sort(byTime).slice(0, RECENT) };
  }
  return { search, recent, patterns };
}

function mountSearchRoutes(app, { pool, requireAuth }) {
  const s = createSearch({ db: pool });
  const guard = fn => async (req, res) => {
    if (!enabled()) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (e) { console.error('[SEARCH]', e.message); res.status(500).json({ error: 'search_failed', message: 'Qidiruv bajarilmadi' }); }
  };
  app.get('/api/search', requireAuth, guard(async (req, res) => { res.json(await s.search(req.session.adminId, req.query.q)); }));
  app.get('/api/recent', requireAuth, guard(async (req, res) => { res.json(await s.recent(req.session.adminId)); }));
  return s;
}

module.exports = { createSearch, mountSearchRoutes, patterns: q => patterns(q) };
