BEGIN;

-- Client portal P1a (2026-11-05, docs/design/mijoz-portali.md, accepted):
-- the client of one matter. A client is any platform account, with no plan,
-- and is NOT a Workspace member: the role covers this one matter only, and
-- the client sees only what the lawyer marked for them - the stage, the
-- deadlines marked visible, notes written for the client and documents
-- shared to the client (a copy of the text taken then, never the lawyer's
-- library). Texts are sealed in the application (src/privacy/crypto.js).
-- No AI, no tariff unit. Down: migrations/down/.

ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS client_stage text NOT NULL DEFAULT 'received'
    CHECK (client_stage IN ('received', 'in_progress', 'waiting_client', 'in_court', 'done'));
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS client_stage_at timestamptz NOT NULL DEFAULT now();
-- when the matter was last closed: a client still reads it for 30 days after
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.matter_stage_history (
    id          bigserial   PRIMARY KEY,
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    stage       text        NOT NULL,
    changed_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_stage_history_idx ON public.matter_stage_history (matter_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.matter_clients (
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    client_id   integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    invited_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    joined_at   timestamptz NOT NULL DEFAULT now(),
    removed_at  timestamptz,
    removed_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    PRIMARY KEY (matter_id, client_id)
);
CREATE INDEX IF NOT EXISTS matter_clients_client_idx ON public.matter_clients (client_id) WHERE removed_at IS NULL;

-- one-use invite links: only the sha256 of the token is kept
CREATE TABLE IF NOT EXISTS public.matter_client_invites (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    note        text        CHECK (note IS NULL OR char_length(note) <= 120),
    created_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    used_by     integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS matter_client_invites_matter_idx ON public.matter_client_invites (matter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.matter_deadlines (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id       uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    title           text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
    due_on          date        NOT NULL,
    client_visible  boolean     NOT NULL DEFAULT false,
    created_by      integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_deadlines_idx ON public.matter_deadlines (matter_id, due_on);

-- what the client sees: a note written for the client, or a document's text
-- copied when it was shared (sealed; the lawyer's own library row is not read again)
CREATE TABLE IF NOT EXISTS public.matter_client_items (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    kind        text        NOT NULL CHECK (kind IN ('note', 'doc')),
    title       text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    body        text        NOT NULL,
    pages       integer,
    chars       integer,
    source_scan uuid,
    created_by  integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_client_items_idx ON public.matter_client_items (matter_id, created_at DESC);
-- one library document shared once per matter
CREATE UNIQUE INDEX IF NOT EXISTS matter_client_items_doc_uidx ON public.matter_client_items (matter_id, source_scan) WHERE source_scan IS NOT NULL;

ALTER TABLE public.matter_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_client_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_client_items ENABLE ROW LEVEL SECURITY;

COMMIT;
