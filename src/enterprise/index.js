'use strict';

/**
 * Enterprise Uzbekistan / TIFC — English-law jurisdiction lane
 *
 * A self-contained track for the Tashkent International Financial Center and
 * Enterprise Uzbekistan digital hub, which operate under the common law of
 * England & Wales (per the Nov 2025 presidential decree). English is the
 * official language of the regime, so this lane answers in English, cites
 * English statutes/case law and TIFC rules, and is kept entirely separate
 * from the Uzbek-statute RAG corpus.
 *
 * Storage: reuses the existing legal_chunks table with a new
 * `jurisdiction` column (default 'uz-statute'). English-law chunks are tagged
 * jurisdiction='english-law' and language='en', so the Uzbek retrieval path
 * (which never filters on jurisdiction) is unaffected, and this lane only ever
 * reads its own chunks.
 */

const { pool } = require('../database/db');
const { getEmbedding, getEmbedDims } = require('../rag/embeddings');

const JURISDICTION = 'english-law';
let _ready = false;

/** Idempotent: add jurisdiction column + index. Safe to call repeatedly. */
async function initEnterpriseCorpus() {
  if (_ready) return;
  try {
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(50) DEFAULT 'uz-statute'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_jurisdiction ON legal_chunks(jurisdiction) WHERE is_valid = TRUE`);
    // Backfill any NULLs (existing rows) to the Uzbek default so they keep working.
    await pool.query(`UPDATE legal_chunks SET jurisdiction = 'uz-statute' WHERE jurisdiction IS NULL`);
    _ready = true;
    console.log('[ENTERPRISE] English-law lane ready (jurisdiction column)');
  } catch (err) {
    console.error('[ENTERPRISE] init error:', err.message);
  }
}

/**
 * Retrieve English-law context chunks for a query.
 * Vector search scoped to jurisdiction='english-law'. Returns {context, chunks}.
 * If the English-law corpus is empty, returns empty context (the prompt then
 * tells the model to rely on its own English-law knowledge with a disclaimer).
 */
async function retrieveEnterpriseContext(query, apiKey, limit = 6) {
  try {
    const key = apiKey || process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
    if (!key) return { context: '', chunks: [] };

    const emb = await getEmbedding(query, key);
    const embStr = `[${emb.join(',')}]`;

    const { rows } = await pool.query(`
      SELECT id, chunk_text, law_name, source_url,
             1 - (embedding <=> $1::vector) AS similarity
      FROM legal_chunks
      WHERE jurisdiction = '${JURISDICTION}'
        AND is_valid = TRUE
        AND (is_active IS NULL OR is_active = TRUE)
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `, [embStr, limit]);

    if (!rows.length) return { context: '', chunks: [] };

    const context = rows
      .map((r, i) => `[Source ${i + 1}: ${r.law_name || 'document'}]\n${r.chunk_text}`)
      .join('\n\n');
    return { context, chunks: rows };
  } catch (err) {
    console.warn('[ENTERPRISE] retrieval failed:', err.message);
    return { context: '', chunks: [] };
  }
}

/** Build the English-law system prompt. */
function buildEnglishLawPrompt(ragContext) {
  const base = `You are a specialist legal adviser for the Tashkent International Financial Center (TIFC) and the Enterprise Uzbekistan digital technology hub.

These special jurisdictions in Uzbekistan operate under a legal regime based on the common law of England & Wales, with their own commercial court and arbitration centre, and English as the official language of legal acts and proceedings.

Your expertise: English commercial and contract law, company law, corporate governance, financial services regulation, dispute resolution and arbitration, as applied within the TIFC / Enterprise Uzbekistan framework.

RULES:
- Always answer in clear, professional English.
- Structure substantive answers using the IRAC method where appropriate: Issue, Rule, Application, Conclusion.
- Cite authority precisely: English statutes (e.g. Companies Act 2006, Sale of Goods Act 1979), case law in standard form (e.g. *Carlill v Carbolic Smoke Ball Co* [1893] 1 QB 256), and TIFC regulations where relevant.
- Distinguish clearly between (a) general English common-law principles and (b) any TIFC-specific rules. Where a TIFC-specific rule would govern but you are not certain of its exact text, say so explicitly.
- Never invent case citations or statutory provisions. If you are not certain of a citation, state the principle without a fabricated cite.
- End with a brief disclaimer that this is general information, not formal legal advice, and that complex matters should be referred to a qualified TIFC-registered practitioner.`;

  if (ragContext && ragContext.trim()) {
    return `${base}

You have been provided with the following source materials from the TIFC / Enterprise Uzbekistan knowledge base. Ground your answer in these where they are relevant, and cite them as [Source N]:

--- SOURCES ---
${ragContext}
--- END SOURCES ---`;
  }

  return `${base}

NOTE: No specific source documents were retrieved for this question. Answer from your knowledge of English common law as it would apply within the TIFC framework, being explicit about any uncertainty, and recommend verifying against the current TIFC rulebook.`;
}

/**
 * Handle an Enterprise/English-law chat turn.
 * @returns {Promise<{reply, provider, ragUsed, sources}>}
 */
async function handleEnterpriseChat({ message, history, callAI }) {
  const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
  const { context, chunks } = await retrieveEnterpriseContext(message, apiKey);

  const systemPrompt = buildEnglishLawPrompt(context);
  const messages = [{ role: 'system', text: systemPrompt }];

  if (Array.isArray(history) && history.length > 0) {
    const recent = history.length > 16 ? history.slice(-16) : history;
    recent.forEach((m) => messages.push({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));
  }
  messages.push({ role: 'user', text: message });

  const result = await callAI(messages, { temperature: 0.2, maxTokens: 4096 });

  const sources = chunks.map((c) => ({
    title: c.law_name || 'Document',
    url: c.source_url || null,
    similarity: c.similarity != null ? +parseFloat(c.similarity).toFixed(3) : null,
  }));

  return {
    reply: result.text,
    provider: result.provider,
    ragUsed: chunks.length > 0,
    sources,
  };
}

/**
 * Ingest an English-law document chunk (master only path).
 * Splits long text into ~1200-char chunks, embeds, inserts with
 * jurisdiction='english-law', language='en'.
 */
async function ingestEnterpriseDocument({ lawName, sourceUrl, text, verifiedBy }) {
  const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
  if (!apiKey) throw new Error('No embedding API key configured');

  // Simple paragraph-aware chunking
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > 1200 && buf) { chunks.push(buf); buf = p; }
    else { buf = buf ? buf + '\n\n' + p : p; }
  }
  if (buf) chunks.push(buf);

  const docId = `en_law_${Date.now()}`;
  let inserted = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    let embStr = null;
    try {
      const emb = await getEmbedding(chunkText, apiKey);
      embStr = `[${emb.join(',')}]`;
    } catch (_) { /* embedding optional */ }

    if (embStr) {
      await pool.query(`
        INSERT INTO legal_chunks (law_name, doc_id, source_url, category, chunk_text, chunk_index,
          is_valid, embedding, source_type, quality_score, verified_by, language, jurisdiction)
        VALUES ($1,$2,$3,'english-law',$4,$5,TRUE,$6::vector,'law_text',0.8,$7,'en','${JURISDICTION}')
      `, [lawName, docId, sourceUrl || null, chunkText, i, embStr, verifiedBy || null]);
    } else {
      await pool.query(`
        INSERT INTO legal_chunks (law_name, doc_id, source_url, category, chunk_text, chunk_index,
          is_valid, source_type, quality_score, verified_by, language, jurisdiction)
        VALUES ($1,$2,$3,'english-law',$4,$5,TRUE,'law_text',0.8,$6,'en','${JURISDICTION}')
      `, [lawName, docId, sourceUrl || null, chunkText, i, verifiedBy || null]);
    }
    inserted++;
  }
  return { inserted, docId };
}

/** Count of English-law chunks (for the UI status badge). */
async function enterpriseStats() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT doc_id)::int AS docs
       FROM legal_chunks WHERE jurisdiction = '${JURISDICTION}' AND is_valid = TRUE`
    );
    return rows[0] || { chunks: 0, docs: 0 };
  } catch (_) {
    return { chunks: 0, docs: 0 };
  }
}

module.exports = {
  initEnterpriseCorpus,
  retrieveEnterpriseContext,
  buildEnglishLawPrompt,
  handleEnterpriseChat,
  ingestEnterpriseDocument,
  enterpriseStats,
};
