'use strict';

/**
 * The citator's rows (S3): every lex.uz act page the server reads anyway -
 * live search, citation hydration, the corpus freshness run - leaves one row:
 * in force or not as lex.uz shows it, its last amending publication and each
 * article's / band's latest change note (src/citator/changes.js). No AI, no
 * extra request, the page itself is not kept. A write that fails is logged
 * and forgotten; it never touches the answer.
 *
 * A historical edition (lex.uz "… sanasi holatiga", or an ?ONDATE= link) is
 * not recorded: it is not the act as it stands. The same page read again
 * within RECORD_EVERY_MS is not written again. CITATOR=off stops it.
 */

const { parseChanges } = require('./changes');

const RECORD_EVERY_MS = 30 * 60e3;
const recent = new Map(); // lex id -> time written (this process)

const off = () => String(process.env.CITATOR || '').toLowerCase() === 'off';

/** The lex.uz id of a page's url without the sign, or null. */
function lexIdOf(url) {
  const m = /lex\.uz\/(?:uz\/|ru\/|oz\/|en\/)?docs\/(-?\d+)/iu.exec(String(url || ''));
  return m ? Math.abs(Number(m[1])) : null;
}

/** One read page -> its row (or null when it is not a current act page). Pure. */
function rowOf(url, html, parsed = {}) {
  const id = lexIdOf(url);
  if (!id || /[?&]ONDATE=/iu.test(String(url))) return null;
  const meta = parsed.metadata || {};
  if (meta.snapshot_date) return null;
  const c = parseChanges(html);
  const repealed = meta.repealed_date ? require('./changes').isoDate(meta.repealed_date) : null;
  return {
    lex_id: id,
    title: String(parsed.title || '').trim().slice(0, 500) || null,
    in_force: typeof meta.is_active === 'boolean' ? meta.is_active : null,
    status_label: meta.is_active === false ? String(meta.status_label || '').slice(0, 200) || null : null,
    repealed_on: repealed,
    published_on: c.published,
    last_change: c.lastChange,
    changes: c.changes,
    units: c.units,
    unread_notes: c.unreadNotes,
  };
}

async function writeRow(db, r) {
  await db.query(
    `INSERT INTO act_citator (lex_id, title, in_force, status_label, repealed_on, published_on, last_change, changes, units, unread_notes, checked_at)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::date,$8,$9::jsonb,$10,now())
     ON CONFLICT (lex_id) DO UPDATE SET title = COALESCE(EXCLUDED.title, act_citator.title), in_force = EXCLUDED.in_force,
       status_label = EXCLUDED.status_label, repealed_on = EXCLUDED.repealed_on, published_on = EXCLUDED.published_on,
       last_change = EXCLUDED.last_change, changes = EXCLUDED.changes, units = EXCLUDED.units,
       unread_notes = EXCLUDED.unread_notes, checked_at = now()`,
    [r.lex_id, r.title, r.in_force, r.status_label, r.repealed_on, r.published_on, r.last_change, r.changes, JSON.stringify(r.units), r.unread_notes]);
}

/** The page observer for fetch-lex: records in the background, never throws, never waits. */
function createRecorder(db, { log = (m) => console.warn(m) } = {}) {
  return function recordPage(url, html, parsed) {
    if (off() || !db) return;
    let row;
    try { row = rowOf(url, html, parsed); } catch (e) { log(`[CITATOR] parse: ${e.message}`); return; }
    if (!row) return;
    const last = recent.get(row.lex_id);
    if (last && Date.now() - last < RECORD_EVERY_MS) return;
    recent.set(row.lex_id, Date.now());
    if (recent.size > 5000) recent.delete(recent.keys().next().value);
    writeRow(db, row).catch((e) => {
      recent.delete(row.lex_id);
      if (!/does not exist/u.test(String(e && e.message))) log(`[CITATOR] write: ${e.message}`);
    });
  };
}

/** Rows by lex id: Map(id -> row). A missing table is an empty map. */
async function rowsFor(db, ids = []) {
  const list = [...new Set(ids.filter(Boolean))].slice(0, 40);
  if (!list.length || !db) return new Map();
  try {
    const r = await db.query('SELECT * FROM act_citator WHERE lex_id = ANY($1::int[])', [list]);
    return new Map(r.rows.map(x => [x.lex_id, x]));
  } catch (e) {
    if (!/does not exist/u.test(String(e && e.message))) console.warn('[CITATOR] read:', e.message);
    return new Map();
  }
}

module.exports = { createRecorder, rowOf, rowsFor, writeRow, lexIdOf, _forget: () => recent.clear() };
