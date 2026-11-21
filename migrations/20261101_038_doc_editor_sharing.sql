BEGIN;

-- The document editor, D3 (docs/design/hujjat-muharriri.md; owner 2026-10-30:
-- any platform user by link, every plan): members of a document and the
-- links that make them, and the live document's Yjs state.
--   doc_editor_members: who besides the owner may open it, and as what -
--     editor (writes), commenter (reads and comments), viewer (reads).
--   doc_editor_invites: a link's sha256 only (the link is shown once), the
--     role it gives, 7 days by default, revocable, how many joined by it.
--   doc_editor_documents.ystate: the live document (Yjs update, sealed, AAD
--     by document); NULL means "start from html" on the next live session.
-- src/editor/access.js, src/editor/sharing.js, src/editor/live.js; Down: migrations/down/.
ALTER TABLE public.doc_editor_documents ADD COLUMN IF NOT EXISTS ystate BYTEA;

CREATE TABLE IF NOT EXISTS public.doc_editor_members (
  document_id UUID NOT NULL REFERENCES public.doc_editor_documents(id) ON DELETE CASCADE,
  admin_id    INTEGER NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  invite_id   UUID,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, admin_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_members_admin ON public.doc_editor_members (admin_id);

CREATE TABLE IF NOT EXISTS public.doc_editor_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.doc_editor_documents(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role        TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  created_by  INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  joined      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_doc_editor_invites_doc ON public.doc_editor_invites (document_id, created_at DESC);

COMMIT;
