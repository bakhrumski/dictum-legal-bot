BEGIN;

-- Firm knowledge base K2a (docs/design/firma-bilim-bazasi.md): a Workspace's
-- documents for search. A document is added from a member's Hujjatlarim, an
-- editor document or a Workspace document; its text is copied at that moment,
-- split into bands (chunks) of a few hundred words, each sealed (AAD
-- workspace_kb_chunks.text:<ws>:<doc>:<n>) with a blind index of its word
-- roots next to it (src/privacy/blind-index.js), so the database never holds
-- the words. No AI, no embeddings. The documents table has no text, so its
-- activity-log trigger records who / when / which document only.
-- src/workspace/kb.js; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.workspace_kb_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 240),
  source_kind  TEXT        NOT NULL CHECK (source_kind IN ('library', 'editor', 'workspace_doc')),
  source_id    TEXT        NOT NULL,
  sha256       TEXT        NOT NULL,
  chars        INTEGER     NOT NULL DEFAULT 0,
  bytes        BIGINT      NOT NULL DEFAULT 0,
  chunks       INTEGER     NOT NULL DEFAULT 0,
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  added_by     INTEGER     REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workspace_kb_documents_ws_idx ON public.workspace_kb_documents (workspace_id, created_at DESC) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_kb_documents_text_uidx ON public.workspace_kb_documents (workspace_id, sha256) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.workspace_kb_chunks (
  document_id  UUID    NOT NULL REFERENCES public.workspace_kb_documents(id) ON DELETE CASCADE,
  workspace_id UUID    NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  n            INTEGER NOT NULL,
  label        TEXT,                 -- the band / clause number the chunk opens with ("5.2"), if any
  page         INTEGER,              -- the page mark it starts on, if the text had one
  text         TEXT    NOT NULL,     -- sealed
  bidx         TEXT[],               -- keyed hashes of its word roots (NULL without DATA_KEYS)
  PRIMARY KEY (document_id, n)
);
CREATE INDEX IF NOT EXISTS workspace_kb_chunks_bidx ON public.workspace_kb_chunks USING GIN (bidx);
CREATE INDEX IF NOT EXISTS workspace_kb_chunks_ws_idx ON public.workspace_kb_chunks (workspace_id);

DO $$
BEGIN
  IF to_regprocedure('juristai_private.log_workspace_activity()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_kb_documents_log') THEN
    CREATE TRIGGER workspace_kb_documents_log
      AFTER INSERT OR UPDATE OR DELETE ON public.workspace_kb_documents
      FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('kb_document');
  END IF;
END $$;

COMMIT;
