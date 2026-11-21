BEGIN;

-- The document editor, D2 (docs/design/hujjat-muharriri.md): comments on a
-- document. The anchor lives in the document's own HTML (<span
-- data-comment="<id>"> around the commented words); this row holds the
-- comment: its author (an account, or the name from an imported Word
-- comment), its text and the words it was made on (both sealed, AAD by the
-- comment), its thread (replies point to the first comment) and whether it
-- is resolved. Deleting the document deletes its comments.
-- src/editor/comments.js; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.doc_editor_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES public.doc_editor_documents(id) ON DELETE CASCADE,
  parent_id    UUID REFERENCES public.doc_editor_comments(id) ON DELETE CASCADE,
  author_id    INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  author_name  TEXT CHECK (author_name IS NULL OR char_length(author_name) <= 120),
  source       TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'word')),
  body         TEXT NOT NULL,
  quote        TEXT,
  resolved_at  TIMESTAMPTZ,
  resolved_by  INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_comments_doc ON public.doc_editor_comments (document_id, created_at);

COMMIT;
