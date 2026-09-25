'use strict';

/**
 * Retrieval evaluation that runs inside the production server, against the
 * production corpus, with the production retrieval (retrieveLegalContext) and
 * the server's own keys. Nothing leaves the server: no database URL or API
 * key has to be handed to anyone to measure retrieval.
 *
 * Two kinds of case sets, both frozen in rag_eval_cases once built:
 *   - synthetic "known item": an article is sampled from the corpus, the
 *     cheap model writes the question a citizen would ask whose answer is in
 *     that article (no law name, no article number), and retrieval must bring
 *     that law + article back. Law-aware, no manual labelling.
 *   - gold: the hand-written src/eval/gold-qa.json (law name + articles).
 *
 * A hit is a returned chunk of the expected law (doc_id, or normalised law
 * name) whose article refs include an expected article. The old eval counted
 * an article number from any law as a hit and bypassed retrieveLegalContext.
 */

const fs = require('fs');
const path = require('path');

const SYNTHETIC_SET = 'synthetic-v1';
const GOLD_SET = 'gold-v0';

function normLaw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’ʻʼ`´']/g, '')
    .replace(/o['‘’ʻ]?zbekiston respublikasining\s*/g, '')
    .replace(/[«»"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lawMatches(chunk, expected) {
  if (expected.expected_doc_id && chunk.doc_id && String(chunk.doc_id) === String(expected.expected_doc_id)) return true;
  const a = normLaw(chunk.law_name);
  const b = normLaw(expected.expected_law);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Article identity for matching: "12-modda" and "12" are the same article,
 * but a prim article is its own article, so "358¹" never equals "358"
 * (Astra audit RAG6: the old digit-stripping counted 358¹ as a hit for 358).
 */
function normArticle(a) {
  return String(a == null ? '' : a).trim().toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-?(modda|статья|ст\.?)$/u, '');
}

/** 1-based rank of the first chunk that has the right law and article, or 0. */
function hitRank(chunks, expected, getArticleRefs) {
  const want = new Set((expected.expected_articles || []).map(normArticle));
  const lawKnown = !!(expected.expected_doc_id || expected.expected_law);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (lawKnown && !lawMatches(c, expected)) continue;
    const refs = (getArticleRefs(c) || []).map(String);
    if (want.size === 0 || refs.some(r => want.has(normArticle(r)))) return i + 1;
  }
  return 0;
}

function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** Summary over per-case results: recall@k, MRR, law hit, latency. */
function summarize(results, ks = [1, 3, 7]) {
  const n = results.length;
  const out = { cases: n, errors: results.filter(r => r.error).length };
  const ok = results.filter(r => !r.error);
  for (const k of ks) out[`recall@${k}`] = n ? +(ok.filter(r => r.rank > 0 && r.rank <= k).length / n).toFixed(3) : null;
  out.mrr = n ? +(ok.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n).toFixed(3) : null;
  out.lawHit = n ? +(ok.filter(r => r.lawHit).length / n).toFixed(3) : null;
  out.empty = n ? +(ok.filter(r => r.returned === 0).length / n).toFixed(3) : null;
  const lat = ok.map(r => r.ms);
  out.latencyMs = { p50: percentile(lat, 50), p95: percentile(lat, 95) };
  const by = (key) => {
    const groups = {};
    for (const r of results) (groups[r[key] || '—'] = groups[r[key] || '—'] || []).push(r);
    return Object.fromEntries(Object.entries(groups).map(([g, rs]) => [g, {
      cases: rs.length,
      'recall@3': +(rs.filter(r => r.rank > 0 && r.rank <= 3).length / rs.length).toFixed(3),
    }]));
  };
  out.byTopic = by('topic');
  out.byLanguage = by('language');
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function createRagEvalService({ pool, retrieve, callCheapAI, getArticleRefs, log = console }) {
  const state = { job: null };

  async function caseCount(setName) {
    const r = await pool.query('SELECT count(*)::int AS n FROM rag_eval_cases WHERE set_name = $1', [setName]);
    return r.rows[0].n;
  }

  /** Sample articles across categories; one article per law+article. */
  async function sampleArticles(n) {
    const r = await pool.query(
      `WITH candidates AS (
         SELECT DISTINCT ON (law_name, article_numbers[1])
                id, law_name, doc_id, category, language, article_numbers, chunk_text
           FROM legal_chunks
          WHERE source_type = 'law_text' AND is_valid IS NOT FALSE AND is_active IS NOT FALSE
            AND array_length(article_numbers, 1) >= 1
            AND length(chunk_text) BETWEEN 300 AND 6000
            AND (chunk_type IS NULL OR chunk_type <> 'child')
          ORDER BY law_name, article_numbers[1], md5(id::text)
       ), ranked AS (
         SELECT *, row_number() OVER (PARTITION BY category ORDER BY md5(id::text || 'juristai-eval')) AS rn
           FROM candidates
       )
       SELECT * FROM ranked ORDER BY rn, category LIMIT $1`,
      [n]
    );
    return r.rows;
  }

  async function writeQuestion(chunk, language) {
    const lang = language === 'ru' ? 'rus tilida' : "o'zbek tilida (lotin yozuvida)";
    const res = await callCheapAI([
      { role: 'system', text:
        `Siz huquqiy savollar to'plamini tuzuvchi yordamchisiz. Berilgan modda matnini o'qing va oddiy fuqaro ` +
        `yuristga beradigan BITTA aniq savolni ${lang} yozing. Savolga to'liq javob aynan shu moddada bo'lsin. ` +
        `Qonun nomini, modda raqamini va moddadagi aniq iboralarni takrorlamang; hayotiy vaziyat sifatida yozing. ` +
        `Faqat savolning o'zini qaytaring, boshqa hech narsa yozmang.` },
      { role: 'user', text: `Qonun: ${chunk.law_name}\nModda: ${chunk.article_numbers[0]}\n\n${String(chunk.chunk_text).slice(0, 3000)}` },
    ], { maxTokens: 120, endpoint: '/api/admin/rag-eval/build' });
    const q = String((res && res.text) || '').trim().replace(/^["«]|["»]$/g, '');
    return q.length >= 12 ? q.slice(0, 500) : null;
  }

  async function buildSyntheticSet({ n = 150, ruShare = 0.2, onProgress = () => {} } = {}) {
    const chunks = await sampleArticles(n);
    let made = 0;
    await mapLimit(chunks, 4, async (c, i) => {
      const language = (i % Math.round(1 / ruShare || 5) === 4) ? 'ru' : 'uz';
      let q = null;
      try { q = await writeQuestion(c, language); } catch (err) { log.warn('[RAG-EVAL] question failed:', err.message); }
      if (q) {
        await pool.query(
          `INSERT INTO rag_eval_cases (set_name, question, language, topic, expected_law, expected_doc_id,
                                       expected_articles, source_chunk_id, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'synthetic')`,
          [SYNTHETIC_SET, q, language, c.category, c.law_name, c.doc_id, [String(c.article_numbers[0])], c.id]
        );
        made++;
      }
      onProgress(i + 1, chunks.length);
    });
    return { set: SYNTHETIC_SET, sampled: chunks.length, created: made };
  }

  async function loadGoldSet() {
    const file = path.join(__dirname, 'gold-qa.json');
    const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
    await pool.query('DELETE FROM rag_eval_cases WHERE set_name = $1', [GOLD_SET]);
    for (const c of cases) {
      await pool.query(
        `INSERT INTO rag_eval_cases (set_name, question, language, topic, expected_law, expected_articles, origin)
         VALUES ($1,$2,'uz',$3,$4,$5,'gold')`,
        [GOLD_SET, c.question, c.category || null, c.expected_law || null, (c.expected_articles || []).map(String)]
      );
    }
    return { set: GOLD_SET, created: cases.length };
  }

  async function runSet({ setName, mode = 'corpus', topicMode = 'none', onProgress = () => {} }) {
    const cases = (await pool.query(
      'SELECT * FROM rag_eval_cases WHERE set_name = $1 ORDER BY id', [setName])).rows;
    // language 'any': retrieval is called as production calls it (every
    // caller passes language = null). Runs 1-2 passed 'ru' for Russian
    // questions, which limited them to the few Russian-language chunks.
    const params = { mode, topicMode, language: 'any', cases: cases.length };
    const run = (await pool.query(
      'INSERT INTO rag_eval_runs (set_name, params) VALUES ($1, $2) RETURNING id', [setName, params])).rows[0];
    const results = await mapLimit(cases, 3, async (c, i) => {
      const t0 = Date.now();
      const row = { id: c.id, topic: c.topic, language: c.language, rank: 0, lawHit: false, returned: 0, ms: 0 };
      try {
        const r = await retrieve(c.question, topicMode === 'oracle' ? c.topic : null, null,
          { noWebFallback: mode !== 'full' });
        const chunks = (r && r.chunks) || [];
        row.returned = chunks.length;
        row.rank = hitRank(chunks, c, getArticleRefs);
        row.lawHit = chunks.some(ch => lawMatches(ch, c));
        if (!row.rank) row.expected = `${c.expected_law} ${(c.expected_articles || []).join(',')}`;
        if (!row.rank) row.top = chunks.slice(0, 3).map(ch => `${ch.law_name} ${(getArticleRefs(ch) || []).slice(0, 3).join(',')}`);
      } catch (err) {
        row.error = String(err.message || err).slice(0, 200);
      }
      row.ms = Date.now() - t0;
      onProgress(i + 1, cases.length);
      return row;
    });
    const summary = summarize(results);
    await pool.query(
      `UPDATE rag_eval_runs SET status = 'done', summary = $2, results = $3, finished_at = now() WHERE id = $1`,
      [run.id, summary, JSON.stringify(results)]
    );
    return { runId: run.id, setName, params, summary };
  }

  /** One job at a time: build the set if missing, then run it. */
  function start({ setName = SYNTHETIC_SET, n = 150, mode = 'corpus', topicMode = 'none' } = {}) {
    if (state.job && state.job.status === 'running') return { started: false, job: publicJob() };
    const job = { status: 'running', phase: 'starting', setName, mode, topicMode, done: 0, total: 0, startedAt: new Date().toISOString() };
    state.job = job;
    const progress = (phase) => (d, t) => { job.phase = phase; job.done = d; job.total = t; };
    (async () => {
      if (await caseCount(setName) === 0) {
        job.phase = 'building';
        if (setName === GOLD_SET) await loadGoldSet();
        else if (setName === SYNTHETIC_SET) await buildSyntheticSet({ n, onProgress: progress('building') });
        else throw new Error(`Unknown set ${setName}`);
      }
      job.phase = 'running';
      const result = await runSet({ setName, mode, topicMode, onProgress: progress('running') });
      Object.assign(job, { status: 'done', phase: 'done', runId: result.runId, summary: result.summary, finishedAt: new Date().toISOString() });
    })().catch((err) => {
      log.error('[RAG-EVAL] job failed:', err.stack || err);
      Object.assign(job, { status: 'failed', error: String(err.message || err), finishedAt: new Date().toISOString() });
    });
    return { started: true, job: publicJob() };
  }

  function publicJob() {
    return state.job ? { ...state.job } : null;
  }

  async function recentRuns(limit = 10) {
    const r = await pool.query(
      `SELECT id, set_name, params, status, summary, started_at, finished_at
         FROM rag_eval_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
    return r.rows;
  }

  async function runDetail(id) {
    const r = await pool.query('SELECT * FROM rag_eval_runs WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  /**
   * The cases a run missed (not in the top 3), with the question and what
   * came back instead, short enough to paste into a chat for analysis.
   */
  async function runMisses(id, { limit = 60 } = {}) {
    const run = await runDetail(id);
    if (!run) return null;
    const results = Array.isArray(run.results) ? run.results : JSON.parse(run.results || '[]');
    const cases = (await pool.query(
      'SELECT id, question, expected_law, expected_articles FROM rag_eval_cases WHERE set_name = $1', [run.set_name])).rows;
    const byId = new Map(cases.map(c => [c.id, c]));
    const misses = results.filter(r => !r.error && !(r.rank >= 1 && r.rank <= 3)).map((r) => {
      const c = byId.get(r.id) || {};
      return {
        id: r.id, language: r.language, topic: r.topic, rank: r.rank || null, lawHit: r.lawHit,
        question: c.question,
        expected: r.expected || `${c.expected_law} ${(c.expected_articles || []).join(',')}`,
        top: r.top || null,
      };
    });
    return { runId: run.id, setName: run.set_name, params: run.params, total: results.length, missed: misses.length, misses: misses.slice(0, limit) };
  }

  return { start, publicJob, recentRuns, runDetail, runMisses, buildSyntheticSet, loadGoldSet, runSet, SYNTHETIC_SET, GOLD_SET };
}

/** Express routes, master only. GET so the owner can start a run from a phone. */
function mountRagEvalRoutes(app, { requireMasterAdmin, service }) {
  app.get('/api/admin/rag-eval', requireMasterAdmin, async (req, res) => {
    try {
      if (req.query.start === '1') {
        const set = req.query.set === 'gold' ? service.GOLD_SET : service.SYNTHETIC_SET;
        const n = Math.max(20, Math.min(400, parseInt(req.query.n, 10) || 150));
        const mode = req.query.mode === 'full' ? 'full' : 'corpus';
        const topicMode = req.query.topic === 'oracle' ? 'oracle' : 'none';
        const started = service.start({ setName: set, n, mode, topicMode });
        return res.json({ ...started, howTo: 'Refresh /api/admin/rag-eval to watch progress; results appear under job.summary and runs.' });
      }
      res.json({ job: service.publicJob(), runs: await service.recentRuns() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/admin/rag-eval/runs/:id', requireMasterAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    // ?misses=1: only the cases missed from the top 3, with their questions.
    const run = req.query.misses === '1'
      ? await service.runMisses(id, { limit: Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 60)) })
      : await service.runDetail(id);
    if (!run) return res.status(404).json({ error: 'not found' });
    res.json(run);
  });
}

module.exports = { createRagEvalService, mountRagEvalRoutes, hitRank, normArticle, lawMatches, summarize, normLaw, SYNTHETIC_SET, GOLD_SET };
