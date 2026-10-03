'use strict';

/**
 * Corpus demand (2026-10-03, owner): grow the corpus from the questions
 * people ask instead of a guessed registry.
 *
 * Every answer cross-checks lex.uz live (retrieveLegalContext, step 4). An act
 * found there that is in force, but whose lex.uz id is not in legal_chunks, is
 * an act an answer needed and the corpus lacks; it is counted in
 * corpus_demand. No question text is stored - the act, how often it was
 * needed (by users and by eval runs, apart), and the question's topic.
 *
 * GET /api/admin/corpus/demand lists the wanted acts, most needed first, and
 * ingests them in the background, up to ten per call: ?ingest=top10, or
 * ?ingest=<lex_id>,<lex_id>. ?dismiss=<lex_id> drops an act from the list.
 * The owner reads the list first: an act the search found is not
 * necessarily the one the answer should rest on.
 */

const { legalForceOf } = require('./legal-force');
const { AMENDING_OR_BILL, latinLexUrl } = require('./corpus-audit');

const MAX_BATCH = 10;
const CORPUS_IDS_TTL_MS = 10 * 60 * 1000;

/** lex.uz document id (digits only) from any lex.uz URL, or ''. */
function lexIdOf(url = '') {
  const m = String(url || '').match(/lex\.uz\/(?:uz\/|ru\/)?docs\/-?(\d+)/iu);
  return m ? m[1] : '';
}

/**
 * The acts in `results` (lex-live-search rows) worth counting: in force, not
 * an amending act or a bill, and not in the corpus. One row per lex.uz id.
 */
function demandRows(results = [], corpusIds = new Set(), { topic = null } = {}) {
  const out = new Map();
  for (const r of results || []) {
    const id = lexIdOf(r && r.url);
    const meta = (r && r.metadata) || {};
    const title = String((r && (r.title || r.lawName)) || '').trim();
    if (!id || !title || corpusIds.has(id) || out.has(id)) continue;
    if (meta.is_active === false || AMENDING_OR_BILL.test(title)) continue;
    const level = legalForceOf(r, r.ownDocumentNumber || meta.document_number || '');
    out.set(id, {
      lex_id: id,
      url: latinLexUrl(r.url),
      title: title.slice(0, 500),
      document_number: r.ownDocumentNumber || meta.document_number || null,
      legal_force: level ? level.key : null,
      topic: topic || null,
    });
  }
  return [...out.values()];
}

/** "top10" -> { top: 10 }; "123,-456" -> { ids: ['123','456'] }; a stray <...> is ignored. */
function parseIngestParam(value = '') {
  const v = String(value || '').replace(/[<>\s]/gu, '');
  const top = v.match(/^top(\d+)$/iu);
  if (top) return { top: Math.max(1, Math.min(MAX_BATCH, parseInt(top[1], 10))) };
  const all = [...new Set(v.split(',').map(x => lexIdOf(x) || x.replace(/^-/u, '')).filter(x => /^\d+$/u.test(x)))].slice(0, MAX_BATCH);
  return all.length ? { ids: all } : null;
}

function createCorpusDemand({ pool, validCategories = [], fallbackCategory = 'davlat-boshqaruvi', log = console }) {
  let corpusIds = null;
  let corpusIdsAt = 0;
  let loading = null;

  async function loadCorpusIds() {
    if (corpusIds && Date.now() - corpusIdsAt < CORPUS_IDS_TTL_MS) return corpusIds;
    if (!loading) {
      loading = pool.query(`SELECT DISTINCT source_url FROM legal_chunks WHERE source_url LIKE '%lex.uz%' AND is_valid IS NOT FALSE`)
        .then(({ rows }) => {
          corpusIds = new Set(rows.map(r => lexIdOf(r.source_url)).filter(Boolean));
          corpusIdsAt = Date.now();
          return corpusIds;
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  /** Count the acts a retrieval found on lex.uz but the corpus lacks. Never throws. */
  async function record(results = [], { topic = null, source = 'user' } = {}) {
    try {
      if (!results || !results.length) return 0;
      const rows = demandRows(results, await loadCorpusIds(), { topic });
      const column = source === 'eval' ? 'eval_hits' : 'user_hits';
      for (const r of rows) {
        await pool.query(
          `INSERT INTO corpus_demand (lex_id, url, title, document_number, legal_force, topic, ${column})
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (lex_id) DO UPDATE SET
             ${column} = corpus_demand.${column} + 1,
             title = EXCLUDED.title,
             document_number = COALESCE(EXCLUDED.document_number, corpus_demand.document_number),
             legal_force = COALESCE(EXCLUDED.legal_force, corpus_demand.legal_force),
             topic = ${source === 'eval'
               // an eval question's topic only fills a gap; a real question's wins
               ? 'COALESCE(corpus_demand.topic, EXCLUDED.topic)'
               : 'COALESCE(EXCLUDED.topic, corpus_demand.topic)'},
             last_seen = now()`,
          [r.lex_id, r.url, r.title, r.document_number, r.legal_force, r.topic]);
      }
      return rows.length;
    } catch (err) {
      log.warn(`[CORPUS-DEMAND] not recorded: ${err.message}`);
      return 0;
    }
  }

  async function list({ limit = 100 } = {}) {
    const { rows } = await pool.query(
      `SELECT lex_id, url, title, document_number, legal_force, topic, user_hits, eval_hits, status, note,
              first_seen, last_seen
         FROM corpus_demand
        ORDER BY (status = 'wanted') DESC, user_hits DESC, eval_hits DESC, last_seen DESC
        LIMIT $1`, [limit]);
    return rows;
  }

  async function pick(spec) {
    if (spec.top) {
      return (await pool.query(
        `SELECT * FROM corpus_demand WHERE status = 'wanted'
          ORDER BY user_hits DESC, eval_hits DESC, last_seen DESC LIMIT $1`, [spec.top])).rows;
    }
    return (await pool.query(
      `SELECT * FROM corpus_demand WHERE lex_id = ANY($1) AND status <> 'ingested'`, [spec.ids])).rows;
  }

  function categoryFor(row) {
    return validCategories.includes(row.topic) ? row.topic : fallbackCategory;
  }

  /**
   * Ingest the picked acts one after another. Each row's status is written as
   * it goes, so a restart mid-batch (a deploy, or memory) loses nothing: the
   * done ones read "ingested" and the next call carries on.
   */
  async function ingestBatch(rows, { reingest, report }) {
    for (const row of rows) {
      await pool.query(`UPDATE corpus_demand SET status = 'ingesting', updated_at = now() WHERE lex_id = $1`, [row.lex_id]);
      const before = report.length;
      await reingest([{ doc_id: `lex-${row.lex_id}`, law_name: row.title, category: categoryFor(row), source_url: row.url }], report);
      const entry = report[before] || { status: 'error', reason: 'no report' };
      const status = entry.status === 'done' ? 'ingested' : 'error';
      await pool.query(`UPDATE corpus_demand SET status = $2, note = $3, updated_at = now() WHERE lex_id = $1`,
        [row.lex_id, status, entry.status === 'done' ? `${entry.chunks} chunks` : String(entry.reason || entry.status).slice(0, 300)]);
      if (status === 'ingested' && corpusIds) corpusIds.add(row.lex_id);
    }
  }

  return { record, list, pick, ingestBatch, loadCorpusIds, categoryFor };
}

function mountCorpusDemandRoutes(app, { requireMasterAdmin, pool, demand, reingest, log = console }) {
  let job = null; // { running, startedAt, finishedAt, picked, results }

  app.get('/api/admin/corpus/demand', requireMasterAdmin, async (req, res) => {
    try {
      if (req.query.dismiss) {
        const ids = String(req.query.dismiss).split(',').map(x => x.replace(/[^\d]/gu, '')).filter(Boolean);
        await pool.query(`UPDATE corpus_demand SET status = 'dismissed', updated_at = now() WHERE lex_id = ANY($1)`, [ids]);
      }
      if (req.query.restore) {
        const ids = String(req.query.restore).split(',').map(x => x.replace(/[^\d]/gu, '')).filter(Boolean);
        await pool.query(`UPDATE corpus_demand SET status = 'wanted', updated_at = now() WHERE lex_id = ANY($1)`, [ids]);
      }
      let started = null;
      if (req.query.ingest) {
        const spec = parseIngestParam(req.query.ingest);
        if (!spec) return res.status(400).json({ error: 'ingest=top10 or ingest=<lex_id>,<lex_id> (up to 10)' });
        if (job && job.running) {
          started = { started: false, reason: 'a batch is already running' };
        } else {
          // Rows left "ingesting" by a restart are wanted again.
          await pool.query(`UPDATE corpus_demand SET status = 'wanted' WHERE status = 'ingesting'`);
          const rows = await demand.pick(spec);
          if (!rows.length) {
            started = { started: false, reason: 'nothing to ingest' };
          } else {
            const current = { running: true, startedAt: new Date().toISOString(), picked: rows.map(r => `${r.title} (${r.lex_id})`), results: [] };
            job = current;
            demand.ingestBatch(rows, { reingest, report: current.results })
              .catch((err) => { current.error = err.message; log.error('[CORPUS-DEMAND]', err.message); })
              .finally(() => { current.running = false; current.finishedAt = new Date().toISOString(); });
            started = { started: true, count: rows.length };
          }
        }
      }
      const rows = await demand.list({ limit: Math.min(300, parseInt(req.query.limit, 10) || 100) });
      const counts = {};
      for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
      res.json({
        ...(started ? { ingest: started } : {}),
        job,
        counts,
        wanted: rows.filter(r => r.status === 'wanted'),
        errors: rows.filter(r => r.status === 'error'),
        ingested: rows.filter(r => r.status === 'ingested').map(r => `${r.title} (${r.lex_id})`),
        dismissed: rows.filter(r => r.status === 'dismissed').map(r => `${r.title} (${r.lex_id})`),
        howTo: 'Acts answers needed from lex.uz that the corpus lacks, most needed first (user_hits: real questions, eval_hits: eval runs with mode=full). ?ingest=top10 ingests the first ten in the background; ?ingest=<lex_id>,<lex_id> picks them (up to 10). Refresh until job.running is false; do not merge or deploy meanwhile. ?dismiss=<lex_id> drops one, ?restore=<lex_id> brings it back.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { MAX_BATCH, lexIdOf, demandRows, parseIngestParam, createCorpusDemand, mountCorpusDemandRoutes };
