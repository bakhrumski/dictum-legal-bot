BEGIN;

-- OCR results of scanned documents (2026-10-06, src/ocr/scan-store.js).
-- One row per account and file (SHA-256 of the file's bytes): the analysis
-- and the opinion of the same scan reuse its text instead of paying for OCR
-- twice. Never shared between accounts - the same file uploaded by two
-- people is read twice, once for each. The text is legal document content:
-- it is kept 7 days (expires_at) and deleted after. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.document_scans (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    integer     NOT NULL,
    file_hash   text        NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
    kind        varchar(8)  NOT NULL CHECK (kind IN ('pdf', 'image')),
    pages       integer     NOT NULL CHECK (pages > 0),
    bytes       integer     NOT NULL CHECK (bytes > 0),
    text        text        NOT NULL,
    chars       integer     NOT NULL,
    provider    text,
    request_id  uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    UNIQUE (admin_id, file_hash)
);
CREATE INDEX IF NOT EXISTS document_scans_expires_idx ON public.document_scans (expires_at);
ALTER TABLE public.document_scans ENABLE ROW LEVEL SECURITY;

COMMIT;
