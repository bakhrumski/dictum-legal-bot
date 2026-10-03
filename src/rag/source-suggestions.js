'use strict';

/**
 * Suggested sources, fed by every answer and ingested ten at a time
 * (owner, 2026-10-03: grow the corpus from the questions people ask, and do
 * it from the Master Admin dashboard).
 *
 * suggested_sources (server.js) was filled only after a web chat answer,
 * from the acts the answer named and an LLM's list of relevant acts. Every
 * answer - web, Telegram, Workspace - also cross-checks lex.uz live
 * (retrieveLegalContext step 4); an act found there in force but missing
 * from the corpus is now suggested too. The dashboard's "Tavsiya etilgan
 * manbalar" could add one act per click and wait for it; the batch route
 * here ingests up to ten in the background, one after another, writing each
 * act's outcome to its row as it goes, so a restart mid-batch loses nothing.
 */

const { legalForceOf } = require('./legal-force');
const { AMENDING_OR_BILL } = require('./corpus-audit');

const MAX_BATCH = 10;
const CORPUS_IDS_TTL_MS = 10 * 60 * 1000;

/** lex.uz document id (digits only) from any lex.uz URL, or ''. */
function lexIdOf(url = '') {
  const m = String(url || '').match(/lex\.uz\/(?:uz\/|ru\/)?docs\/-?(\d+)/iu);
  return m ? m[1] : '';
}

/**
 * The Uzbek Latin page for an Uzbek Cyrillic URL (/uz/docs/N -> /docs/-N,
 * the same id); any other URL is kept as it is: /docs/N without the minus
 * and /ru/docs/N are Russian texts, whose ids differ from the Uzbek ones.
 */
function preferLatinUrl(url = '') {
  const clean = String(url || '').split('#')[0].split('?')[0].trim();
  const m = clean.match(/^https?:\/\/(?:www\.)?lex\.uz\/uz\/docs\/-?(\d+)$/iu);
  return m ? `https://lex.uz/docs/-${m[1]}` : clean;
}

/**
 * Rows worth suggesting from lex-live-search results: in force, not an
 * amending act or a bill, not in the corpus; one per lex.uz id.
 */
function liveSuggestionRows(results = [], corpusIds = new Set()) {
  const out = new Map();
  for (const r of results || []) {
    const id = lexIdOf(r && r.url);
    const meta = (r && r.metadata) || {};
    const title = String((r && (r.title || r.lawName)) || '').trim();
    if (!id || !title || corpusIds.has(id) || out.has(id)) continue;
    if (meta.is_active === false || AMENDING_OR_BILL.test(title)) continue;
    out.set(id, { lex_doc_id: id, lex_url: preferLatinUrl(r.url), title: title.slice(0, 300), status_label: meta.status_label || null });
  }
  return [...out.values()];
}

/** The level of a suggested act, for the dashboard card ({ key, uz } or null). */
function suggestionForce(row = {}) {
  const level = legalForceOf({ title: row.title });
  return level ? { key: level.key, uz: level.uz } : null;
}

function createSuggestionRecorder({ pool, log = console }) {
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

  /** Suggest the acts a live lex.uz check found that the corpus lacks. Never throws. */
  async function record(results = [], { question = '', topic = null } = {}) {
    try {
      if (!results || !results.length) return 0;
      const rows = liveSuggestionRows(results, await loadCorpusIds());
      for (const r of rows) {
        // Same upsert as generateSourceSuggestions: a rejected or ingested
        // row keeps its status; only the count moves.
        await pool.query(`
          INSERT INTO suggested_sources (lex_doc_id, lex_url, title, is_active, status_label, sample_query, topic)
          VALUES ($1, $2, $3, TRUE, $4, $5, $6)
          ON CONFLICT (lex_doc_id) DO UPDATE
            SET times_suggested = suggested_sources.times_suggested + 1,
                last_suggested_at = NOW(),
                sample_query = COALESCE(suggested_sources.sample_query, EXCLUDED.sample_query),
                topic = COALESCE(suggested_sources.topic, EXCLUDED.topic)`,
          [r.lex_doc_id, r.lex_url, r.title, r.status_label, String(question || '').slice(0, 500) || null, topic || null]);
      }
      return rows.length;
    } catch (err) {
      log.warn(`[suggest-live] not recorded: ${err.message}`);
      return 0;
    }
  }

  function markIngested(lexDocId) { if (corpusIds && lexDocId) corpusIds.add(String(lexDocId)); }

  return { record, loadCorpusIds, markIngested };
}

/** [{ id, topic }] from a request body: integer ids, at most ten, each once. */
function parseBatchItems(body = {}) {
  const seen = new Set();
  const items = [];
  for (const it of (Array.isArray(body && body.items) ? body.items : [])) {
    const id = parseInt(it && it.id, 10);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, topic: typeof (it && it.topic) === 'string' ? it.topic.trim().slice(0, 50) : '' });
    if (items.length >= MAX_BATCH) break;
  }
  return items;
}

/**
 * POST /api/admin/suggested-sources/ingest-batch { items: [{ id, topic }] }
 * starts a background batch (up to ten); GET returns its progress.
 * ingestOne({ url, topic, law_name, adminId }) is server.js's ingestLexUrl,
 * which refuses repealed acts and replaces the document's chunks.
 */
function mountSuggestionBatchRoutes(app, { requireMasterAdmin, pool, ingestOne, recorder, log = console }) {
  let job = null;

  async function runBatch(current, rows, topics, adminId) {
    for (const row of rows) {
      const item = { id: row.id, title: row.title, status: 'running' };
      current.items.push(item);
      const topic = topics.get(row.id) || row.topic;
      try {
        if (!topic) throw Object.assign(new Error("Soha (topic) tanlanmadi"), { status: 400 });
        const result = await ingestOne({ url: preferLatinUrl(row.lex_url), topic, law_name: row.title, adminId });
        await pool.query(
          `UPDATE suggested_sources SET status = 'ingested', topic = $2, reviewed_by = $3, reviewed_at = NOW(), last_error = NULL WHERE id = $1`,
          [row.id, topic, adminId || null]);
        if (recorder) recorder.markIngested(row.lex_doc_id);
        item.status = 'done';
        item.chunks = (result && result.chunks) || 0;
        if (result && result.lang_warning) item.warning = result.lang_warning;
      } catch (err) {
        item.status = 'error';
        item.error = String(err.message || err).slice(0, 300);
        await pool.query(`UPDATE suggested_sources SET last_error = $2 WHERE id = $1`, [row.id, item.error]).catch(() => {});
      }
      current.done++;
    }
  }

  app.post('/api/admin/suggested-sources/ingest-batch', requireMasterAdmin, async (req, res) => {
    try {
      if (job && job.running) return res.status(409).json({ error: "Oldingi yuklash hali tugamadi", job });
      const items = parseBatchItems(req.body);
      if (!items.length) return res.status(400).json({ error: 'Hech narsa tanlanmadi' });
      const { rows } = await pool.query(
        `SELECT * FROM suggested_sources WHERE id = ANY($1::int[]) AND status = 'pending'`, [items.map(i => i.id)]);
      // keep the order the admin chose
      const byId = new Map(rows.map(r => [r.id, r]));
      const picked = items.map(i => byId.get(i.id)).filter(Boolean);
      if (!picked.length) return res.status(400).json({ error: "Tanlanganlar allaqachon qo'shilgan yoki rad etilgan" });
      const topics = new Map(items.filter(i => i.topic).map(i => [i.id, i.topic]));
      const adminId = req.session && req.session.adminId;
      const current = { running: true, startedAt: new Date().toISOString(), total: picked.length, done: 0, items: [] };
      job = current;
      runBatch(current, picked, topics, adminId)
        .catch((err) => { current.error = err.message; log.error('[suggest-batch]', err.message); })
        .finally(() => { current.running = false; current.finishedAt = new Date().toISOString(); });
      res.json({ started: true, job: current });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/suggested-sources/ingest-batch', requireMasterAdmin, (req, res) => {
    res.json({ job });
  });
}

module.exports = { MAX_BATCH, lexIdOf, preferLatinUrl, liveSuggestionRows, suggestionForce, parseBatchItems, createSuggestionRecorder, mountSuggestionBatchRoutes };
