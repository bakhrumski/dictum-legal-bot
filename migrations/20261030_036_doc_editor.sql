BEGIN;

-- The document editor, D1 (docs/design/hujjat-muharriri.md): a document a
-- person edits in the app - from an AI draft, an uploaded Word / PDF, a
-- library document, or blank. The HTML is sealed at rest (src/privacy/crypto.js,
-- AAD by document / version); only its owner opens it until sharing comes (D3).
-- Every save raises `revision`; a save names the revision it started from,
-- so two tabs never overwrite each other unseen. Versions: an automatic one
-- at most every 10 minutes, named ones, and one before every restore.
-- src/editor/; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.doc_editor_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     INTEGER NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  source       TEXT NOT NULL CHECK (source IN ('blank', 'draft', 'upload', 'library')),
  html         TEXT NOT NULL DEFAULT '',
  chars        INTEGER NOT NULL DEFAULT 0 CHECK (chars >= 0),
  revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  import_notes JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_documents_owner ON public.doc_editor_documents (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.doc_editor_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.doc_editor_documents(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL CHECK (number > 0),
  kind        TEXT NOT NULL CHECK (kind IN ('auto', 'named', 'restore')),
  label       TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  html        TEXT NOT NULL,
  chars       INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, number)
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_versions_doc ON public.doc_editor_versions (document_id, number DESC);

COMMIT;
