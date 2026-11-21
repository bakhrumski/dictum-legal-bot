BEGIN;

-- Client portal P2 (2026-11-07, docs/design/mijoz-portali.md §P2, accepted):
-- one conversation per matter between the lawyer side (whoever writes the
-- matter) and its clients - apart from the Workspace room chat. The body is
-- sealed in the application (AAD matter_messages.body:<matter>:<id>). No AI
-- reads it or answers it; no tariff unit. A client's account deletion
-- replaces their messages' text (the matter stays the lawyer's material).
-- Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.matter_messages (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    author_id   integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    side        text        NOT NULL CHECK (side IN ('lawyer', 'client')),
    body        text        NOT NULL,
    source      text        NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'telegram')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matter_messages_idx ON public.matter_messages (matter_id, created_at);

-- what each person last read (unread counts for the lawyer's card and the client's list)
CREATE TABLE IF NOT EXISTS public.matter_message_reads (
    matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    admin_id    integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    read_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (matter_id, admin_id)
);

ALTER TABLE public.matter_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_message_reads ENABLE ROW LEVEL SECURITY;

COMMIT;
