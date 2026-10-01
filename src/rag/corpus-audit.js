'use strict';

/**
 * Two read-only master checks (2026-10-01).
 *
 * 1. Registry check. 60 of 76 registry URLs were /uz/docs/<id>, which on
 *    lex.uz opens the Uzbek Cyrillic text (the Latin text is /docs/-<id>),
 *    37 entries sit at 5765396..5765480 in steps of two, and the LLC law's
 *    5765406 in that run was a 404. Each registry URL is opened from the
 *    server and reported: missing (404), not in force, title not matching
 *    the registry name, and the script of its text.
 *
 * 2. Corpus script. Laws ingested from /uz/docs/<id> may be stored in
 *    Cyrillic, which Latin keyword search cannot match. Each document is
 *    reported with the script of its stored text; ?reingest=1 re-ingests
 *    the next Uzbek Cyrillic one from its Latin URL (one per call, as the
 *    truncated-article repair did).
 */

const UZ_CYRILLIC = /[ўқғҳЎҚҒҲ]/u;

/** 'latin' | 'uz-cyrillic' | 'russian' | 'mixed' | 'empty' for a text sample. */
function textScript(text = '') {
  const sample = String(text || '').slice(0, 20000);
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cyrillic = (sample.match(/[Ѐ-ӿ]/gu) || []).length;
  const total = latin + cyrillic;
  if (total < 50) return 'empty';
  if (latin / total >= 0.8) return 'latin';
  if (cyrillic / total >= 0.8) return UZ_CYRILLIC.test(sample) ? 'uz-cyrillic' : 'russian';
  return 'mixed';
}

/** /uz/docs/123 or /docs/123 -> https://lex.uz/docs/-123; a Latin URL is kept. */
function latinLexUrl(url = '') {
  const m = String(url || '').match(/lex\.uz\/(?:uz\/|ru\/)?docs\/(-?)(\d+)/iu);
  if (!m) return '';
  return `https://lex.uz/docs/-${m[2]}`;
}

function words(s = '') {
  return String(s || '').toLowerCase()
    .replace(/[ʻʼ‘’`']/gu, '')
    .replace(/o['ʻ’`]?zbekiston|respublikasi\p{L}*|to['ʻ’`]?g['ʻ’`]?risida\p{L}*|qonun\p{L}*/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
}

/** Share of the registry name's words found in the fetched title (0..1). */
function titleMatch(registryName = '', fetchedTitle = '') {
  const want = words(registryName);
  if (!want.length) return 1;
  const got = new Set(words(fetchedTitle));
  return want.filter(w => got.has(w)).length / want.length;
}

/** One registry entry checked against lex.uz. fetchDoc(url) -> { title, body, metadata }. */
async function checkRegistryEntry(entry, fetchDoc) {
  const out = { doc_id: entry.doc_id, law_name: entry.law_name, category: entry.category, url: entry.lex_url };
  try {
    const doc = await fetchDoc(entry.lex_url);
    const meta = (doc && doc.metadata) || {};
    const body = String((doc && doc.body) || '');
    out.title = String((doc && doc.title) || '').slice(0, 200);
    out.chars = body.length;
    out.script = textScript(`${out.title} ${body}`);
    out.in_force = meta.is_active !== false;
    if (meta.status_label) out.status_label = meta.status_label;
    out.title_match = +titleMatch(entry.law_name, out.title).toFixed(2);
    const problems = [];
    if (body.length < 500) problems.push('empty_or_not_found');
    if (!out.in_force) problems.push('not_in_force');
    if (out.title && out.title_match < 0.5) problems.push('title_mismatch');
    if (out.script !== 'latin' && out.script !== 'empty') problems.push(`script_${out.script}`);
    out.status = problems.length ? problems.join(',') : 'ok';
  } catch (err) {
    const msg = String(err.message || err);
    out.status = /HTTP 404/u.test(msg) ? 'not_found_404' : 'error';
    out.error = msg.slice(0, 160);
  }
  return out;
}

/** Per-document script of the stored law text (first 600 characters of up to 40 chunks). */
async function corpusScripts(pool) {
  const { rows } = await pool.query(`
    WITH sample AS (
      SELECT law_name, doc_id, source_url, category, left(chunk_text, 600) AS t,
             row_number() OVER (PARTITION BY doc_id ORDER BY id) AS rn
        FROM legal_chunks
       WHERE source_type = 'law_text' AND is_valid IS NOT FALSE AND doc_id IS NOT NULL
    )
    SELECT doc_id, min(law_name) AS law_name, min(source_url) AS source_url, min(category) AS category,
           string_agg(t, ' ') FILTER (WHERE rn <= 40) AS text,
           (SELECT count(*)::int FROM legal_chunks c WHERE c.doc_id = sample.doc_id AND c.is_valid IS NOT FALSE) AS chunks
      FROM sample GROUP BY doc_id`);
  const docs = rows.map(r => ({
    doc_id: r.doc_id, law_name: r.law_name, category: r.category, source_url: r.source_url, chunks: r.chunks,
    script: textScript(r.text),
  }));
  const order = { 'uz-cyrillic': 0, mixed: 1, russian: 2, empty: 3, latin: 4 };
  docs.sort((a, b) => (order[a.script] - order[b.script]) || (b.chunks - a.chunks));
  const byScript = {};
  for (const d of docs) byScript[d.script] = (byScript[d.script] || 0) + 1;
  return { byScript, documents: docs };
}

/** Documents stored in Uzbek Cyrillic that have a Latin URL to re-ingest from. */
function needsLatinReingest(d) {
  return d.script === 'uz-cyrillic' && Boolean(latinLexUrl(d.source_url)) && Boolean(d.doc_id);
}

function mountCorpusAuditRoutes(app, { requireMasterAdmin, pool, getAllLaws, fetchDoc, reingest, log = console }) {
  let registryJob = null; // { running, startedAt, done, total, results }
  let reingestJob = null;

  // GET /api/admin/lex-registry/check — ?start=1 opens every registry URL in
  // the background (one at a time); refresh without it to read the results.
  app.get('/api/admin/lex-registry/check', requireMasterAdmin, (req, res) => {
    if (req.query.start === '1' && !(registryJob && registryJob.running)) {
      const laws = getAllLaws();
      const job = { running: true, startedAt: new Date().toISOString(), done: 0, total: laws.length, results: [] };
      registryJob = job;
      (async () => {
        for (const entry of laws) {
          job.results.push(await checkRegistryEntry(entry, fetchDoc));
          job.done++;
          await new Promise(r => setTimeout(r, 1200));
        }
      })().catch((err) => { job.error = err.message; log.error('[REGISTRY-CHECK]', err.message); })
        .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
    }
    const results = registryJob ? registryJob.results : [];
    const problems = results.filter(r => r.status !== 'ok');
    const byStatus = {};
    for (const r of results) for (const s of r.status.split(',')) byStatus[s] = (byStatus[s] || 0) + 1;
    res.json({
      job: registryJob && { running: registryJob.running, startedAt: registryJob.startedAt, finishedAt: registryJob.finishedAt, done: registryJob.done, total: registryJob.total, error: registryJob.error },
      byStatus, problems, ok: results.filter(r => r.status === 'ok').map(r => r.law_name),
      howTo: 'Add ?start=1 to check every registry URL on lex.uz (about 2 minutes); refresh without it to see progress.',
    });
  });

  // GET /api/admin/corpus/script — the script of each stored law; ?reingest=1
  // re-ingests the next Uzbek Cyrillic document from its Latin URL.
  app.get('/api/admin/corpus/script', requireMasterAdmin, async (req, res) => {
    try {
      const found = await corpusScripts(pool);
      const pending = found.documents.filter(needsLatinReingest);
      if (req.query.reingest === '1' && !(reingestJob && reingestJob.running) && pending.length) {
        const d = pending[0];
        const latin = { ...d, source_url: latinLexUrl(d.source_url) };
        reingestJob = { running: true, startedAt: new Date().toISOString(), results: [] };
        const job = reingestJob;
        reingest([latin], job.results)
          .catch((err) => { job.error = err.message; })
          .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });
      }
      res.json({
        byScript: found.byScript,
        documents: found.documents.map(({ doc_id, law_name, category, source_url, chunks, script }) => ({ doc_id, law_name, category, source_url, chunks, script })),
        reingest: reingestJob,
        pending: pending.map(d => `${d.law_name} (${d.doc_id})`),
        howTo: 'Add ?reingest=1 to re-ingest the next Uzbek Cyrillic document from its Latin lex.uz URL (one per call); refresh until reingest.running is false, then call again.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { textScript, latinLexUrl, titleMatch, checkRegistryEntry, corpusScripts, needsLatinReingest, mountCorpusAuditRoutes };
