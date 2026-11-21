BEGIN;

-- Client portal P3 (2026-11-10, docs/design/mijoz-portali.md §P3, accepted):
-- the lawyer asks the client for a document ("Pasport nusxasi", with a date)
-- and the client uploads a file to the matter - on the site or by sending it
-- to the bot. The file's bytes are sealed in the application (AAD
-- matter_client_files.data:<matter>:<id>) and kept apart from its row, with
-- the sha256 of the original. Nothing reads the file: no OCR, no AI, no unit,
-- until the lawyer takes it into a service of their own. 20 MB a file, 200
-- files a matter (application). A client's account deletion removes their
-- files. Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.matter_doc_requests (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    title       text        NOT NULL CHECK (char_length(title) BETWEEN 2 AND 240),
    due_on      date,
    status      text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    created_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    closed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS matter_doc_requests_idx ON public.matter_doc_requests (matter_id, created_at);

CREATE TABLE IF NOT EXISTS public.matter_client_files (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    request_id  uuid        REFERENCES public.matter_doc_requests(id) ON DELETE SET NULL,
    uploaded_by integer     REFERENCES public.admins(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    mime        text        NOT NULL,
    bytes       integer     NOT NULL CHECK (bytes > 0),
    sha256      text        NOT NULL,
    source      text        NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (matter_id, sha256)
);
CREATE INDEX IF NOT EXISTS matter_client_files_idx ON public.matter_client_files (matter_id, created_at);
CREATE INDEX IF NOT EXISTS matter_client_files_by_idx ON public.matter_client_files (uploaded_by);

-- the bytes, apart from the row so lists never load them
CREATE TABLE IF NOT EXISTS public.matter_client_file_data (
    file_id     uuid        PRIMARY KEY REFERENCES public.matter_client_files(id) ON DELETE CASCADE,
    data        bytea       NOT NULL
);

ALTER TABLE public.matter_doc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_client_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_client_file_data ENABLE ROW LEVEL SECURITY;

COMMIT;
