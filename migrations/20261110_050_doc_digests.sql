BEGIN;

-- X6 of the 2026-11-10 audit (C1): the long-document digest, kept between
-- services and across restarts. One person's analysis, explanation, opinion
-- and chat about the SAME document each need its digest (5-13 AI calls); it
-- was cached in the process's memory only - lost on every deploy and gone
-- after an hour. The digest is sealed in the application (AAD
-- doc_digests.digest:<admin>:<sha256>:<version>), is read by its owner only,
-- expires (DOC_DIGEST_DAYS, 14) and goes with the document or the account.
-- Only a digest with every part read whole is ever stored. Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.doc_digests (
    admin_id    integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    text_sha256 text        NOT NULL,
    version     text        NOT NULL,
    digest      jsonb       NOT NULL,
    chars       integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    used_at     timestamptz,
    uses        integer     NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    PRIMARY KEY (admin_id, text_sha256, version)
);
CREATE INDEX IF NOT EXISTS doc_digests_expiry_idx ON public.doc_digests (expires_at);

ALTER TABLE public.doc_digests ENABLE ROW LEVEL SECURITY;

COMMIT;
