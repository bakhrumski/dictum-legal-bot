BEGIN;

-- CustDev pilot, stage 3 (2026-10-28, owner; src/sales/pilot-workspace.js).
--
--   pilot_workspace      the one internal (staff) Workspace the pilot runs in;
--                        a master opens it (migration 025's internal flag)
--   pilot_client_tasks   the Workspace task "Mijoz: <ism> - <tur>" of each
--                        pilot client, tied to the client's admins.id (the
--                        client is never a Workspace member)
--   pilot_feedback       one row per Telegram message the client sent in
--                        feedback mode (unique by chat + message: a message
--                        never becomes two sub-tasks); the text lives in the
--                        Workspace sub-task, the row keeps the tag and the
--                        reply that closes the loop (sent once, never AI)
--   admins.pilot_replies_off   the client asked not to get those replies
--
-- Workspace rows are written only through the Workspace transaction with the
-- acting staff account (juristai.actor_id), so the Workspace triggers log
-- every write in workspace_activity_log. Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.pilot_workspace (
    id            smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    workspace_id  uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by    integer     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_client_tasks (
    admin_id      integer     PRIMARY KEY REFERENCES public.admins(id) ON DELETE CASCADE,
    workspace_id  uuid        NOT NULL,
    task_id       uuid        NOT NULL,
    agent_id      integer,
    created_by    integer     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, task_id) REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.pilot_feedback (
    id                 bigserial   PRIMARY KEY,
    admin_id           integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    agent_id           integer,
    tg_chat_id         bigint      NOT NULL,
    tg_message_id      bigint      NOT NULL,
    source             text        NOT NULL CHECK (source IN ('text', 'voice')),
    workspace_id       uuid,
    task_id            uuid,
    tag                text        CHECK (tag IS NULL OR tag IN ('xato', 'chalkash', 'yangi_imkoniyat', 'narx')),
    tagged_by          integer,
    tagged_at          timestamptz,
    reply_text         text        CHECK (reply_text IS NULL OR char_length(reply_text) BETWEEN 1 AND 600),
    reply_by           integer,
    reply_confirmed_at timestamptz,
    reply_status       text        CHECK (reply_status IS NULL OR reply_status IN ('sent', 'opted_out', 'no_chat', 'failed')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tg_chat_id, tg_message_id)
);
CREATE INDEX IF NOT EXISTS pilot_feedback_admin_idx ON public.pilot_feedback (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pilot_feedback_created_idx ON public.pilot_feedback (created_at DESC);

ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS pilot_replies_off boolean NOT NULL DEFAULT false;

ALTER TABLE public.pilot_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_client_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_feedback ENABLE ROW LEVEL SECURITY;

COMMIT;
