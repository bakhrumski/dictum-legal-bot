BEGIN;

-- Invited Workspace members must keep at least an active Silver plan.  The
-- Workspace owner must keep Platinum.  These helpers are used by RLS as well
-- as the server API so Realtime subscriptions cannot bypass subscription
-- expiry rules.
CREATE OR REPLACE FUNCTION juristai_private.has_active_paid_entitlement(
    p_user_id integer,
    p_minimum_plan text DEFAULT 'silver'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admins AS a
        WHERE a.id = p_user_id
          AND a.role = 'user'
          AND CASE lower(COALESCE(a.tariff_plan, ''))
                WHEN 'platinum' THEN 3
                WHEN 'gold' THEN 2
                WHEN 'silver' THEN 1
                ELSE 0
              END >= CASE lower(COALESCE(p_minimum_plan, 'silver'))
                WHEN 'platinum' THEN 3
                WHEN 'gold' THEN 2
                ELSE 1
              END
          AND (a.tariff_expires_at IS NULL OR a.tariff_expires_at >= now())
    );
$$;

CREATE OR REPLACE FUNCTION juristai_private.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        JOIN public.workspaces w ON w.id = wm.workspace_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = juristai_private.current_app_user_id()
          AND w.deleted_at IS NULL
          AND juristai_private.has_workspace_entitlement(w.owner_id)
          AND (
              wm.role = 'owner'
              OR juristai_private.has_active_paid_entitlement(wm.user_id, 'silver')
          )
    );
$$;

CREATE OR REPLACE FUNCTION juristai_private.can_write_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT juristai_private.is_workspace_member(p_workspace_id)
       AND juristai_private.workspace_role(p_workspace_id) IN ('owner', 'member')
       AND juristai_private.workspace_is_active(p_workspace_id)
$$;

CREATE TABLE IF NOT EXISTS public.workspace_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    author_id integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
    pinned_task_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT workspace_messages_task_fk
        FOREIGN KEY (workspace_id, pinned_task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE SET NULL (pinned_task_id)
);

CREATE INDEX IF NOT EXISTS workspace_messages_workspace_idx
    ON public.workspace_messages(workspace_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.workspace_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    recipient_id integer NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    notification_type text NOT NULL CHECK (notification_type IN (
        'member_subscription_expired', 'workspace_subscription_expired',
        'invitation_accepted', 'task_updated', 'document_updated'
    )),
    subject_user_id integer REFERENCES public.admins(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (recipient_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS workspace_notifications_recipient_idx
    ON public.workspace_notifications(recipient_id, created_at DESC);

ALTER TABLE public.workspace_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_messages_select_member
ON public.workspace_messages FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_messages_insert_member
ON public.workspace_messages FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_messages_update_author
ON public.workspace_messages FOR UPDATE TO authenticated
USING (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
)
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_notifications_select_recipient
ON public.workspace_notifications FOR SELECT TO authenticated
USING (
    recipient_id = juristai_private.current_app_user_id()
    AND juristai_private.is_workspace_member(workspace_id)
);

CREATE POLICY workspace_notifications_update_recipient
ON public.workspace_notifications FOR UPDATE TO authenticated
USING (
    recipient_id = juristai_private.current_app_user_id()
    AND juristai_private.is_workspace_member(workspace_id)
)
WITH CHECK (recipient_id = juristai_private.current_app_user_id());

GRANT SELECT, INSERT, UPDATE ON public.workspace_messages TO authenticated;
GRANT SELECT, UPDATE ON public.workspace_notifications TO authenticated;
GRANT ALL ON public.workspace_messages, public.workspace_notifications TO service_role;

REVOKE ALL ON FUNCTION juristai_private.has_active_paid_entitlement(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION juristai_private.has_active_paid_entitlement(integer, text)
    TO authenticated, service_role;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'workspace_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_messages;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'workspace_notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_notifications;
    END IF;
END $$;

COMMIT;
