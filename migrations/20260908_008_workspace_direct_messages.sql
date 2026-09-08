BEGIN;

-- One-to-one messages between two members of the same Workspace.
--
-- workspace_messages is the room everyone in the Workspace reads: it carries a
-- workspace and an author and nothing else, so there has never been anywhere to
-- put a message meant for one colleague. This table adds the missing half. It
-- stays scoped to a Workspace rather than being account-to-account, because
-- that is what every rule in this schema is already written against: membership
-- decides who may read, the owner's Platinum decides whether the room is open
-- at all, and a person who leaves the team stops seeing the thread without a
-- second set of policies having to say so.

-- RLS needs to ask whether a *named* user is a member, not only whether the
-- caller is. is_workspace_member() answers the second question; the recipient
-- check needs the first, and the subquery it would otherwise use runs under the
-- caller's own policies on workspace_members.
CREATE OR REPLACE FUNCTION juristai_private.is_workspace_member_of(
    p_workspace_id uuid,
    p_user_id integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS m
        WHERE m.workspace_id = p_workspace_id
          AND m.user_id = p_user_id
    )
$$;

CREATE TABLE IF NOT EXISTS public.workspace_direct_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    sender_id integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    recipient_id integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT workspace_direct_messages_two_parties CHECK (sender_id <> recipient_id)
);

-- A thread is the unordered pair, so it is read with
--   (sender=me AND recipient=them) OR (sender=them AND recipient=me)
-- and one index per direction lets the planner take both halves.
CREATE INDEX IF NOT EXISTS workspace_direct_messages_outgoing_idx
    ON public.workspace_direct_messages(workspace_id, sender_id, recipient_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS workspace_direct_messages_incoming_idx
    ON public.workspace_direct_messages(workspace_id, recipient_id, sender_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- Unread counts are read on every thread list, so they get their own partial.
CREATE INDEX IF NOT EXISTS workspace_direct_messages_unread_idx
    ON public.workspace_direct_messages(workspace_id, recipient_id, sender_id)
    WHERE deleted_at IS NULL AND read_at IS NULL;

ALTER TABLE public.workspace_direct_messages ENABLE ROW LEVEL SECURITY;

-- Only the two people named on the row, and only while both the reader's
-- membership stands.
CREATE POLICY workspace_direct_messages_select_party
ON public.workspace_direct_messages FOR SELECT TO authenticated
USING (
    juristai_private.is_workspace_member(workspace_id)
    AND juristai_private.current_app_user_id() IN (sender_id, recipient_id)
);

-- You may only write as yourself, only to someone on the same team, and only
-- while the Workspace is open for writing — the same bar the room chat sets.
CREATE POLICY workspace_direct_messages_insert_sender
ON public.workspace_direct_messages FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND sender_id = juristai_private.current_app_user_id()
    AND sender_id <> recipient_id
    AND juristai_private.is_workspace_member_of(workspace_id, recipient_id)
);

-- The recipient marks a message read; the sender may edit or withdraw their
-- own. Neither may rewrite who the message was between.
CREATE POLICY workspace_direct_messages_update_party
ON public.workspace_direct_messages FOR UPDATE TO authenticated
USING (
    juristai_private.is_workspace_member(workspace_id)
    AND juristai_private.current_app_user_id() IN (sender_id, recipient_id)
)
WITH CHECK (
    juristai_private.is_workspace_member(workspace_id)
    AND juristai_private.current_app_user_id() IN (sender_id, recipient_id)
);

GRANT SELECT, INSERT, UPDATE ON public.workspace_direct_messages TO authenticated;
GRANT ALL ON public.workspace_direct_messages TO service_role;

REVOKE ALL ON FUNCTION juristai_private.is_workspace_member_of(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION juristai_private.is_workspace_member_of(uuid, integer)
    TO authenticated, service_role;

-- Realtime evaluates the SELECT policy against the old row as well as the new
-- one when a row is updated, and the default replica identity carries only the
-- primary key — which would leave a read receipt with no sender or recipient to
-- test, and so deliver it to nobody.
ALTER TABLE public.workspace_direct_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'workspace_direct_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_direct_messages;
    END IF;
END $$;

COMMIT;
