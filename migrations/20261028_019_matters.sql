BEGIN;

-- Matters (2026-10-28, docs/design/matter-va-agent-runs.md, section 2): one
-- legal matter of one account ("Pudratchi bilan nizo") that ties together
-- what was done for it - chats, scanned documents, agent results, notes. A
-- matter links; it does not copy. An item points at its source by id
-- (ref_int for ai_chat_sessions.id, ref_uuid for document_scans.id and,
-- from PR-B, agent_runs.id), and the server checks the source's owner on
-- every read and write (src/matters/store.js). A Platinum owner may attach a
-- matter to a Workspace: its members then read (viewer) or write
-- (owner/member) it through the Workspace membership. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.matters (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    workspace_id  uuid        REFERENCES public.workspaces(id) ON DELETE SET NULL,
    title         text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
    summary       text        NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
    status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS matters_owner_idx ON public.matters (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS matters_workspace_idx ON public.matters (workspace_id) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.matter_items (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    kind        text        NOT NULL CHECK (kind IN ('chat', 'scan', 'agent_run', 'note')),
    ref_int     bigint,
    ref_uuid    uuid,
    title       text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    note        text        CHECK (note IS NULL OR char_length(note) <= 8000),
    added_by    integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT matter_items_note_kind CHECK ((kind = 'note') = (note IS NOT NULL)),
    CONSTRAINT matter_items_ref_kind CHECK (
        (kind = 'note' AND ref_int IS NULL AND ref_uuid IS NULL)
        OR (kind = 'chat' AND ref_int IS NOT NULL AND ref_uuid IS NULL)
        OR (kind IN ('scan', 'agent_run') AND ref_uuid IS NOT NULL AND ref_int IS NULL)
    )
);
-- one source once per matter (notes are never deduplicated)
CREATE UNIQUE INDEX IF NOT EXISTS matter_items_ref_uidx
    ON public.matter_items (matter_id, kind, COALESCE(ref_int, 0), COALESCE(ref_uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE kind <> 'note';
CREATE INDEX IF NOT EXISTS matter_items_matter_idx ON public.matter_items (matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS matter_items_scan_idx ON public.matter_items (ref_uuid) WHERE kind = 'scan';

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_items ENABLE ROW LEVEL SECURITY;

COMMIT;
