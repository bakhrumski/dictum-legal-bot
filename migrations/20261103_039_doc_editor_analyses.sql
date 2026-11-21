BEGIN;

-- The document editor, D4 (docs/design/hujjat-muharriri.md): the AI analysis
-- run on a document from its side panel. One row a run: who ran it (their
-- analysis units paid for it), the units, and the result - risks with the
-- document's own words and a proposed replacement, missing clauses with a
-- proposed text, compliance notes - sealed (AAD by the row). Every member who
-- can read the document sees the latest run; nothing in the document changes
-- until a person accepts a proposal on the page. Deleting the document
-- deletes its runs. src/editor/analysis.js; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.doc_editor_analyses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES public.doc_editor_documents(id) ON DELETE CASCADE,
  created_by   INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  units        INTEGER,
  revision     INTEGER,
  result       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_analyses_doc ON public.doc_editor_analyses (document_id, created_at DESC);

COMMIT;
