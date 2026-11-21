'use strict';

/**
 * The Plenum corpus sync (S1, docs/design/sud-amaliyoti.md). No AI.
 *
 *   dry   - lists and reads every decision, writes nothing but the run's report
 *   apply - writes new and changed decisions (all three editions, by bands),
 *           marks unchanged ones checked, and a decision lex.uz no longer
 *           lists as in force `in_force = false` (only when the whole list
 *           was read); nothing is deleted
 *
 * A decision is compared by the sha256 of its Uzbek edition's text: an
 * unchanged one is one page read. One run at a time (a lock in the database).
 * Every decision that could not be read is named in the report with why.
 */

const crypto = require('crypto');
const { parseLexHtml } = require('../rag/fetch-lex');
const P = require('./parse');
const defaultSource = require('./source');

const LOCK = 74120231; // pg advisory lock key for the sync
const sha = s => crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
const flat = h => String(h || '').replace(/<[^>]+>/g, ' ');

/** One edition's page -> { title, header, bands: [{ n, text, refs }], sha, chars, html } or { error }. */
function readEdition(html) {
  if (!html || html.length < 500) return { error: 'empty page' };
  let parsed;
  try { parsed = parseLexHtml(html, ''); } catch (e) { return { error: `unreadable: ${e.message}` }; }
  const body = String(parsed.body || '').trim();
  // lex.uz's own note "Текст акта приводится на узбекском языке": the edition has no text of its own
  if (body.length < 200) return { error: /Текст акта приводится на|Hujjat matni .{0,20}tilida keltiriladi/u.test(html) ? 'lex.uz has no text in this language' : 'no text on the page' };
  const abbr = P.abbreviations(body);
  const bands = P.splitBands(body).map(b => ({ n: b.n, text: b.text, refs: P.articleRefs(b.text, abbr) }));
  return { title: String(parsed.title || '').trim(), header: P.parseHeader(flat(html)), bands, sha: sha(body), chars: body.length, html };
}

function createPlenumSync({ db, source = defaultSource, log = () => {} } = {}) {
  let running = false;

  /** A listed decision (its Latin edition id from the list) -> the whole decision or { error }. */
  async function readDecision(item) {
    const uzId = Math.abs(item.id);
    let uzHtml;
    try { uzHtml = await source.fetchEdition(uzId); } catch (e) { return { error: `uz page: ${e.message}` }; }
    const uz = readEdition(uzHtml);
    if (uz.error) return { error: `uz page: ${uz.error}` };
    const ed = P.editions(uzHtml, uzId);
    return { lexId: uzId, latId: ed.lat || -uzId, ruId: ed.ru || null, uz };
  }
  async function readOthers(d) {
    const out = { problems: [] };
    for (const [lang, id] of [['lat', d.latId], ['ru', d.ruId]]) {
      if (!id) { out.problems.push(`${lang}: no edition`); continue; }
      try {
        const e = readEdition(await source.fetchEdition(id));
        if (e.error) out.problems.push(`${lang}: ${e.error}`); else out[lang] = e;
      } catch (err) { out.problems.push(`${lang}: ${err.message}`); }
    }
    return out;
  }

  async function write(client, d, others, listed) {
    const header = d.uz.header || (others.lat && others.lat.header) || (others.ru && others.ru.header) || {};
    const court = header.court || (listed.body === 'xojalik' ? 'xojalik' : 'oliy');
    const all = { uz: d.uz, lat: others.lat, ru: others.ru };
    const bands = d.uz.bands.length;
    const chars = Object.values(all).filter(Boolean).reduce((n, e) => n + e.chars, 0);
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO plenum_decisions (lex_id, lat_lex_id, ru_lex_id, court, number, adopted_on, title_uz, title_lat, title_ru,
            is_amendment, in_force, bands, chars, sha_uz, sha_lat, sha_ru, fetched_at, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,true,$11,$12,$13,$14,$15,now(),now())
         ON CONFLICT (lex_id) DO UPDATE SET lat_lex_id = EXCLUDED.lat_lex_id, ru_lex_id = EXCLUDED.ru_lex_id, court = EXCLUDED.court,
            number = EXCLUDED.number, adopted_on = EXCLUDED.adopted_on, title_uz = EXCLUDED.title_uz, title_lat = EXCLUDED.title_lat,
            title_ru = EXCLUDED.title_ru, is_amendment = EXCLUDED.is_amendment, in_force = true, bands = EXCLUDED.bands, chars = EXCLUDED.chars,
            sha_uz = EXCLUDED.sha_uz, sha_lat = EXCLUDED.sha_lat, sha_ru = EXCLUDED.sha_ru, fetched_at = now(), checked_at = now()`,
        [d.lexId, d.latId, d.ruId, court, header.number || null, header.date || null, d.uz.title || null,
          others.lat ? others.lat.title : (listed.title || null), others.ru ? others.ru.title : null,
          P.isAmendment((others.lat && others.lat.title) || listed.title || d.uz.title), bands, chars,
          d.uz.sha, others.lat ? others.lat.sha : null, others.ru ? others.ru.sha : null]);
      await client.query('DELETE FROM plenum_bands WHERE decision_id = $1', [d.lexId]);
      for (const [lang, e] of Object.entries(all)) {
        if (!e) continue;
        for (const b of e.bands) {
          await client.query('INSERT INTO plenum_bands (decision_id, lang, n, text, article_refs) VALUES ($1,$2,$3,$4,$5::jsonb)',
            [d.lexId, lang, b.n, b.text, JSON.stringify(b.refs)]);
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  }

  /**
   * { mode: 'dry' | 'apply', by, limit } -> the report. `limit` reads only the
   * first N listed decisions (a quick look); the list itself is always whole.
   */
  async function run({ mode = 'dry', by = null, limit = null } = {}) {
    if (running) { const e = new Error('Sinxronlash allaqachon ishlayapti.'); e.status = 409; throw e; }
    running = true;
    const started = Date.now();
    const lockClient = await db.connect();
    let runId = null;
    try {
      const got = (await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0].ok;
      if (!got) { const e = new Error('Sinxronlash boshqa jarayonda ishlayapti.'); e.status = 409; throw e; }
      runId = (await db.query(`INSERT INTO plenum_sync_runs (mode, started_by) VALUES ($1, $2) RETURNING id`, [mode, by])).rows[0].id;
      const report = { mode, lists: {}, listed: 0, read: 0, new: 0, changed: 0, unchanged: 0, notInForce: 0, failed: [], partialEditions: [],
        bands: 0, chars: 0, byCourt: {}, amendments: 0, refs: 0, refsWithoutAct: 0 };
      // the lists of both courts; a joint decision is in both - kept once
      const items = new Map();
      let listWhole = true;
      for (const body of Object.keys(source.BODIES)) {
        const l = await source.listDecisions(body);
        report.lists[body] = { pages: l.pages, items: l.items.length, partial: l.partial || null };
        if (l.partial) listWhole = false;
        l.items.forEach(x => { if (!items.has(Math.abs(x.id))) items.set(Math.abs(x.id), x); });
      }
      report.listed = items.size;
      const known = new Map((await db.query('SELECT lex_id, sha_uz, in_force FROM plenum_decisions')).rows.map(r => [r.lex_id, r]));
      let n = 0;
      for (const [id, item] of items) {
        if (limit && n >= limit) break;
        n += 1;
        const d = await readDecision(item);
        if (d.error) { report.failed.push({ id, title: item.title.slice(0, 160), why: d.error }); continue; }
        report.read += 1;
        const was = known.get(id);
        if (was && was.sha_uz === d.uz.sha) {
          report.unchanged += 1;
          if (mode === 'apply') await db.query('UPDATE plenum_decisions SET checked_at = now(), in_force = true WHERE lex_id = $1', [id]);
          continue;
        }
        const others = await readOthers(d);
        if (others.problems.length) report.partialEditions.push({ id, problems: others.problems });
        const header = d.uz.header || (others.lat && others.lat.header) || {};
        const court = header.court || (item.body === 'xojalik' ? 'xojalik' : 'oliy');
        report.byCourt[court] = (report.byCourt[court] || 0) + 1;
        if (P.isAmendment((others.lat && others.lat.title) || item.title)) report.amendments += 1;
        for (const e of [d.uz, others.lat, others.ru].filter(Boolean)) {
          report.bands += e.bands.length; report.chars += e.chars;
          e.bands.forEach(b => { report.refs += b.refs.length; report.refsWithoutAct += b.refs.filter(r => !r.act).length; });
        }
        if (was) report.changed += 1; else report.new += 1;
        if (mode === 'apply') {
          const c = await db.connect();
          try { await write(c, d, others, item); } catch (e) { report.failed.push({ id, title: item.title.slice(0, 160), why: `write: ${e.message}` }); } finally { c.release(); }
        }
        if (n % 10 === 0) log(`[PLENUM] ${n}/${items.size}`);
      }
      // a decision no longer listed as in force - only when both lists were read whole and nothing was limited
      if (listWhole && !limit) {
        const gone = [...known.keys()].filter(id => !items.has(id) && known.get(id).in_force);
        report.notInForce = gone.length;
        if (mode === 'apply' && gone.length) await db.query('UPDATE plenum_decisions SET in_force = false, checked_at = now() WHERE lex_id = ANY($1::int[])', [gone]);
      } else report.notInForceSkipped = listWhole ? 'limit' : 'list partial';
      report.ms = Date.now() - started;
      await db.query(`UPDATE plenum_sync_runs SET finished_at = now(), status = 'done', report = $2::jsonb WHERE id = $1`, [runId, JSON.stringify(report)]);
      return { id: runId, ...report };
    } catch (e) {
      if (runId) await db.query(`UPDATE plenum_sync_runs SET finished_at = now(), status = 'failed', report = $2::jsonb WHERE id = $1`, [runId, JSON.stringify({ error: e.message })]).catch(() => {});
      throw e;
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
      lockClient.release();
      running = false;
    }
  }

  return { run, readDecision, readEdition, isRunning: () => running };
}

module.exports = { createPlenumSync, readEdition };
