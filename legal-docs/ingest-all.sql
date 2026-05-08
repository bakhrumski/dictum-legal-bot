-- JuristAI Legal Corpus Ingestion
-- Generated: 2026-03-31T11:35:03.117Z
-- Laws: 13
-- Embedding: gemini-embedding-001 (1536d)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS legal_chunks (
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
  embedding vector(1536),
  tsv tsvector,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION legal_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', COALESCE(NEW.chunk_text, '') || ' ' || COALESCE(NEW.law_name, ''));
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_legal_chunks_tsv ON legal_chunks;
CREATE TRIGGER trg_legal_chunks_tsv BEFORE INSERT OR UPDATE ON legal_chunks
FOR EACH ROW EXECUTE FUNCTION legal_chunks_tsv_trigger();


-- === INDEXES ===
CREATE INDEX IF NOT EXISTS idx_legal_chunks_tsv ON legal_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_category ON legal_chunks(category);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_valid ON legal_chunks(is_valid) WHERE is_valid = TRUE;
CREATE INDEX IF NOT EXISTS idx_legal_chunks_doc_id ON legal_chunks(doc_id);
DROP INDEX IF EXISTS idx_legal_chunks_embedding;
CREATE INDEX idx_legal_chunks_embedding ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- Done! 0 chunks from 0 laws.