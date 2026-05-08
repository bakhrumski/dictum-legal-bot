'use strict';

/**
 * Offline Ingestion — generates SQL file for Supabase
 *
 * When direct DB connection is not available (firewall, network),
 * this script fetches laws, chunks, embeds locally, and outputs
 * a .sql file that can be pasted into Supabase SQL Editor.
 *
 * Usage:
 *   node src/rag/ingest-offline.js
 *
 * Output: legal-docs/ingest-all.sql
 */

require('dotenv').config();
// Need at least one embedding API key
if (!process.env.GEMINI_API_KEY && !process.env.GPT_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error('ERROR: Set GEMINI_API_KEY or GPT_API_KEY environment variable');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { fetchLexDocument } = require('./fetch-lex');
const { chunkLegalDocument } = require('./chunker');
const { getEmbeddingsBatch, getEmbedDims } = require('./embeddings');
const { getAllLaws } = require('./lex-registry');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'legal-docs');
const DIMS = getEmbedDims();

function escapeSql(str) {
  if (!str) return 'NULL';
  return "'" + str.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

function arrayToSql(arr) {
  if (!arr || arr.length === 0) return 'NULL';
  return "ARRAY[" + arr.map(a => escapeSql(a)).join(',') + "]";
}

function embeddingToSql(emb) {
  if (!emb) return 'NULL';
  return "'[" + emb.join(',') + "]'::vector";
}

async function main() {
  const laws = getAllLaws();
  console.log(`\nOffline Ingestion: ${laws.length} laws to process\n`);

  // SQL header
  const sqlParts = [];
  sqlParts.push(`-- JuristAI Legal Corpus Ingestion`);
  sqlParts.push(`-- Generated: ${new Date().toISOString()}`);
  sqlParts.push(`-- Laws: ${laws.length}`);
  sqlParts.push(`-- Embedding: gemini-embedding-001 (${DIMS}d)\n`);
  sqlParts.push(`CREATE EXTENSION IF NOT EXISTS vector;`);
  sqlParts.push(`CREATE EXTENSION IF NOT EXISTS pg_trgm;\n`);

  // Table creation
  sqlParts.push(`CREATE TABLE IF NOT EXISTS legal_chunks (
  id SERIAL PRIMARY KEY,
  law_name TEXT NOT NULL,
  doc_id VARCHAR(100),
  source_url TEXT,
  category VARCHAR(100) NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  article_numbers TEXT[],
  chapter TEXT,
  enforcement_date DATE,
  is_valid BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  embedding vector(${DIMS}),
  tsv tsvector,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);\n`);

  // Trigger for auto tsvector
  sqlParts.push(`CREATE OR REPLACE FUNCTION legal_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', COALESCE(NEW.chunk_text, '') || ' ' || COALESCE(NEW.law_name, ''));
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_legal_chunks_tsv ON legal_chunks;
CREATE TRIGGER trg_legal_chunks_tsv BEFORE INSERT OR UPDATE ON legal_chunks
FOR EACH ROW EXECUTE FUNCTION legal_chunks_tsv_trigger();\n`);

  let totalChunks = 0;
  let successCount = 0;

  for (let i = 0; i < laws.length; i++) {
    const law = laws[i];
    console.log(`[${i + 1}/${laws.length}] ${law.law_name}`);

    try {
      // Fetch
      const doc = await fetchLexDocument(law.lex_url);

      // Save raw text backup
      const catDir = path.join(OUTPUT_DIR, law.category);
      if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
      fs.writeFileSync(
        path.join(catDir, `${law.doc_id}.txt`),
        `---\nlaw_name: ${law.law_name}\ndoc_id: ${law.doc_id}\nsource_url: ${law.lex_url}\ncategory: ${law.category}\n---\n\n${doc.body}`,
        'utf-8'
      );

      // Chunk
      const chunks = chunkLegalDocument(doc.body, {
        law_name: law.law_name || doc.title,
        doc_id: law.doc_id,
        source_url: law.lex_url,
        category: law.category
      });

      if (chunks.length === 0) {
        console.log('  WARNING: No chunks generated, skipping');
        continue;
      }

      // Embed
      console.log(`  Embedding ${chunks.length} chunks...`);
      const texts = chunks.map(c => c.text);
      const embeddings = await getEmbeddingsBatch(texts);

      // Generate SQL — delete old + insert new
      sqlParts.push(`\n-- === ${law.law_name} (${law.category}) ===`);
      sqlParts.push(`DELETE FROM legal_chunks WHERE doc_id = ${escapeSql(law.doc_id)};`);

      for (let j = 0; j < chunks.length; j++) {
        const c = chunks[j];
        const m = c.metadata || {};
        const articleNums = (m.articles || []).map(a => a.number).filter(Boolean);

        sqlParts.push(`INSERT INTO legal_chunks (law_name, doc_id, source_url, category, chunk_text, chunk_index, article_numbers, chapter, enforcement_date, is_valid, embedding) VALUES (${escapeSql(law.law_name || doc.title)}, ${escapeSql(law.doc_id)}, ${escapeSql(law.lex_url)}, ${escapeSql(law.category)}, ${escapeSql(c.text)}, ${j}, ${arrayToSql(articleNums)}, ${escapeSql(m.chapter || null)}, ${law.enforcement_date ? escapeSql(law.enforcement_date) : 'NULL'}, TRUE, ${embeddingToSql(embeddings[j])});`);
      }

      totalChunks += chunks.length;
      successCount++;
      console.log(`  OK: ${chunks.length} chunks`);

      // Rate limit between laws
      if (i < laws.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }
  }

  // Indexes (after data)
  sqlParts.push(`\n-- === INDEXES ===`);
  sqlParts.push(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_tsv ON legal_chunks USING GIN (tsv);`);
  sqlParts.push(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_category ON legal_chunks(category);`);
  sqlParts.push(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_valid ON legal_chunks(is_valid) WHERE is_valid = TRUE;`);
  sqlParts.push(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_doc_id ON legal_chunks(doc_id);`);

  // IVFFlat index
  const lists = Math.max(10, Math.min(100, Math.floor(Math.sqrt(totalChunks))));
  sqlParts.push(`DROP INDEX IF EXISTS idx_legal_chunks_embedding;`);
  sqlParts.push(`CREATE INDEX idx_legal_chunks_embedding ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists});`);

  sqlParts.push(`\n-- Done! ${totalChunks} chunks from ${successCount} laws.`);

  // Write SQL file
  const sqlContent = sqlParts.join('\n');
  const outputPath = path.join(OUTPUT_DIR, 'ingest-all.sql');
  fs.writeFileSync(outputPath, sqlContent, 'utf-8');

  console.log(`\n========================================`);
  console.log(`SUCCESS: ${successCount}/${laws.length} laws processed`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`SQL file: ${outputPath}`);
  console.log(`File size: ${(sqlContent.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`========================================`);
  console.log(`\nNext: paste the SQL into Supabase SQL Editor and run it.`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
