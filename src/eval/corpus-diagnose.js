'use strict';

/**
 * Corpus diagnostic — answers ONE question precisely:
 *   "Is a given law's article (e.g. Soliq kodeksi, modda 358) actually in the
 *    corpus, and is it retrievable by article_numbers metadata — or only buried
 *    in chunk text (or missing entirely)?"
 *
 * This distinguishes a DATA gap (article not ingested) from a RETRIEVAL gap
 * (article is there but nothing filters by article_numbers).
 *
 * CLI:    node src/eval/corpus-diagnose.js --law="soliq kodeks" --article=358
 * API:    GET /api/admin/corpus-diagnostic?law=soliq%20kodeks&article=358  (master only)
 */

const { pool } = require('../database/db');
const { detectLawHint } = require('../rag/law-hints');

async function diagnose({ law = 'soliq kodeks', article = '358' } = {}) {
  const rawLaw = String(law).trim();
  // Resolve the law the SAME way retrieval does, so the diagnostic mirrors
  // production scoping. detectLawHint also handles a full query as input
  // (e.g. "Soliq kodeksi 358-modda"); fall back to the raw text if no match.
  const resolvedLaw = detectLawHint(rawLaw) || rawLaw;
  const lawLike = '%' + resolvedLaw + '%';
  const art = String(article).trim();
  const out = { law: rawLaw, resolvedLaw, lawScoping: detectLawHint(rawLaw) ? 'detectLawHint' : 'raw', article: art };

  // 0. Table exists?
  const tbl = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='legal_chunks') AS present`
  );
  out.tableExists = tbl.rows[0].present;
  if (!out.tableExists) {
    out.verdict = { code: 'NO_TABLE', message: 'legal_chunks table does not exist — ingest never ran.' };
    return out;
  }

  // 1. Whole-corpus snapshot
  const corpus = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding,
           COUNT(*) FILTER (WHERE is_valid)::int AS valid,
           COUNT(DISTINCT law_name)::int AS distinct_laws
      FROM legal_chunks`);
  out.corpus = corpus.rows[0];

  // 1b. Every distinct law in the corpus (name, chunk count, category, embedded)
  const laws = await pool.query(`
    SELECT law_name,
           COUNT(*)::int AS chunks,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
           MIN(category) AS category
      FROM legal_chunks
     GROUP BY law_name
     ORDER BY law_name`);
  out.lawsInCorpus = laws.rows;

  // 2. Does the law exist at all?
  const lawRows = await pool.query(`
    SELECT COUNT(*)::int AS chunks,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_embedding,
           COUNT(DISTINCT doc_id)::int AS docs,
           COUNT(*) FILTER (WHERE article_numbers IS NOT NULL AND array_length(article_numbers,1) > 0)::int AS chunks_with_article_meta,
           COUNT(*) FILTER (WHERE article_numbers IS NULL OR array_length(article_numbers,1) IS NULL)::int AS chunks_without_article_meta
      FROM legal_chunks WHERE law_name ILIKE $1`, [lawLike]);
  out.lawPresence = lawRows.rows[0];

  // 3. Article-number coverage for this law
  const distinct = await pool.query(`
    SELECT COUNT(DISTINCT a)::int AS distinct_articles
      FROM (SELECT unnest(article_numbers) AS a FROM legal_chunks WHERE law_name ILIKE $1) t`, [lawLike]);
  out.distinctArticles = distinct.rows[0].distinct_articles;

  const sample = await pool.query(`
    SELECT a FROM (SELECT DISTINCT unnest(article_numbers) AS a
                     FROM legal_chunks WHERE law_name ILIKE $1) t
    WHERE a IS NOT NULL AND a <> ''
    ORDER BY length(a), a
    LIMIT 50`, [lawLike]);
  out.sampleArticles = sample.rows.map(r => r.a);

  // 4. The target article — by metadata (the path retrieval SHOULD use)
  const byMeta = await pool.query(`
    SELECT id, law_name, article_number_display, left(chunk_text, 240) AS preview
      FROM legal_chunks WHERE law_name ILIKE $1 AND $2 = ANY(article_numbers) LIMIT 5`, [lawLike, art]);
  out.articleByMetadata = { found: byMeta.rowCount, samples: byMeta.rows };

  // 5. The target article — by raw text (catches metadata gaps)
  const byText = await pool.query(`
    SELECT COUNT(*)::int AS n FROM legal_chunks
     WHERE law_name ILIKE $1 AND (chunk_text ILIKE $2 OR chunk_text ILIKE $3)`,
    [lawLike, '%' + art + '-modda%', '%' + art + ' modda%']);
  out.articleByText = byText.rows[0].n;

  // 6. The article anywhere in the corpus (any law) by metadata
  const anywhere = await pool.query(
    `SELECT COUNT(*)::int AS n FROM legal_chunks WHERE $1 = ANY(article_numbers)`, [art]);
  out.articleAnywhereByMetadata = anywhere.rows[0].n;

  out.verdict = computeVerdict(out);
  return out;
}

function computeVerdict(o) {
  if (!o.lawPresence || o.lawPresence.chunks === 0) {
    return { code: 'LAW_NOT_INGESTED', message: `No chunks for a law matching "${o.resolvedLaw}". The law is not in the corpus — DATA gap. Run the ingest for it.` };
  }
  if (o.articleByMetadata.found > 0) {
    return { code: 'RETRIEVAL_BUG', message: `Article ${o.article} IS in the corpus and tagged in article_numbers, but the failure happened anyway → the bug is purely in retrieval wiring (article filter never applied). Fix retrieval, no re-ingest needed.` };
  }
  if (o.articleByText > 0) {
    return { code: 'METADATA_GAP', message: `Article ${o.article} text exists in chunks but is NOT tagged in article_numbers → chunking/metadata gap. Backfill article_numbers AND add the article filter.` };
  }
  return { code: 'ARTICLE_NOT_INGESTED', message: `No chunk for "${o.law}" contains article ${o.article} by metadata or text → that article was not ingested (DATA gap). Re-ingest the full law.` };
}

module.exports = { diagnose };

// ── CLI ──
if (require.main === module) {
  require('dotenv').config();
  const args = process.argv.slice(2);
  const get = (k, d) => {
    const hit = args.find(a => a.startsWith('--' + k + '='));
    return hit ? hit.split('=').slice(1).join('=') : d;
  };
  if (!process.env.DATABASE_URL) {
    console.error('[corpus-diagnose] DATABASE_URL not set.');
    process.exit(1);
  }
  diagnose({ law: get('law', 'soliq kodeks'), article: get('article', '358') })
    .then(r => {
      console.log('\n══════ CORPUS DIAGNOSTIC ══════');
      console.log(`Law input: "${r.law}"  →  resolved: "${r.resolvedLaw}" (${r.lawScoping})   Article: ${r.article}\n`);
      if (r.corpus) console.log(`Corpus: ${r.corpus.total} chunks, ${r.corpus.with_embedding} embedded, ${r.corpus.distinct_laws} distinct laws`);
      if (r.lawPresence) {
        console.log(`\nLaw match "${r.resolvedLaw}":`);
        console.log(`  chunks: ${r.lawPresence.chunks} (${r.lawPresence.with_embedding} embedded, ${r.lawPresence.docs} docs)`);
        console.log(`  with article_numbers meta: ${r.lawPresence.chunks_with_article_meta} | without: ${r.lawPresence.chunks_without_article_meta}`);
        console.log(`  distinct articles tagged: ${r.distinctArticles}`);
        if (r.sampleArticles?.length) console.log(`  sample articles: ${r.sampleArticles.join(', ')}`);
      }
      console.log(`\nArticle ${r.article}:`);
      console.log(`  by article_numbers metadata: ${r.articleByMetadata.found} chunk(s)`);
      console.log(`  by raw text ("${r.article}-modda"): ${r.articleByText} chunk(s)`);
      console.log(`  anywhere in corpus by metadata: ${r.articleAnywhereByMetadata} chunk(s)`);
      if (r.articleByMetadata.samples?.length) {
        console.log('\n  Sample chunk(s):');
        r.articleByMetadata.samples.forEach(s =>
          console.log(`   #${s.id} [${s.article_number_display || '—'}] ${(s.preview || '').replace(/\s+/g, ' ').slice(0, 160)}…`));
      }
      console.log(`\n▶ VERDICT [${r.verdict.code}]: ${r.verdict.message}\n`);
      return pool.end();
    })
    .catch(e => { console.error('[corpus-diagnose] error:', e.message); process.exit(1); });
}
