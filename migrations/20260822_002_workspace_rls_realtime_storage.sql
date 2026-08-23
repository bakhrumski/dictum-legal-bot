BEGIN;

CREATE OR REPLACE FUNCTION juristai_private.workspace_role(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT wm.role
    FROM public.workspace_members AS wm
    JOIN public.workspaces AS w ON w.id = wm.workspace_id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = juristai_private.current_app_user_id()
      AND w.deleted_at IS NULL
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION juristai_private.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT juristai_private.workspace_role(p_workspace_id) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION juristai_private.is_workspace_owner(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT juristai_private.workspace_role(p_workspace_id) = 'owner';
$$;

CREATE OR REPLACE FUNCTION juristai_private.workspace_is_active(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspaces AS w
        WHERE w.id = p_workspace_id
          AND w.deleted_at IS NULL
          AND juristai_private.has_workspace_entitlement(w.owner_id)
    );
$$;

CREATE OR REPLACE FUNCTION juristai_private.can_write_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT juristai_private.workspace_role(p_workspace_id) IN ('owner', 'member')
       AND juristai_private.workspace_is_active(p_workspace_id);
$$;

CREATE OR REPLACE FUNCTION juristai_private.storage_workspace_id(p_object_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    first_segment text;
BEGIN
    first_segment := split_part(p_object_name, '/', 1);
    RETURN first_segment::uuid;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.realtime_topic_workspace_id(p_topic text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    workspace_segment text;
BEGIN
    IF split_part(p_topic, ':', 1) <> 'workspace' THEN
        RETURN NULL;
    END IF;
    workspace_segment := split_part(p_topic, ':', 2);
    RETURN workspace_segment::uuid;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$$;

REVOKE ALL ON SCHEMA juristai_private FROM PUBLIC;
GRANT USAGE ON SCHEMA juristai_private TO authenticated, service_role;

REVOKE ALL ON FUNCTION juristai_private.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.has_workspace_entitlement(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.workspace_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.is_workspace_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.workspace_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.can_write_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.storage_workspace_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION juristai_private.realtime_topic_workspace_id(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION juristai_private.current_app_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.has_workspace_entitlement(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.workspace_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.is_workspace_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.is_workspace_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.workspace_is_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.can_write_workspace(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.storage_workspace_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION juristai_private.realtime_topic_workspace_id(text) TO authenticated, service_role;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_canvas_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_select_member
ON public.workspaces FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(id));

CREATE POLICY workspaces_insert_platinum_owner
ON public.workspaces FOR INSERT TO authenticated
WITH CHECK (
    owner_id = juristai_private.current_app_user_id()
    AND created_by = juristai_private.current_app_user_id()
    AND juristai_private.has_workspace_entitlement(owner_id)
);

CREATE POLICY workspaces_update_owner
ON public.workspaces FOR UPDATE TO authenticated
USING (juristai_private.is_workspace_owner(id))
WITH CHECK (
    juristai_private.is_workspace_owner(id)
    AND owner_id = juristai_private.current_app_user_id()
);

-- No direct DELETE policy: workspaces are soft-deleted so their audit trail and
-- immutable document versions remain recoverable during the retention period.

CREATE POLICY workspace_members_select_member
ON public.workspace_members FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_members_insert_owner
ON public.workspace_members FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND role IN ('member', 'viewer')
);

CREATE POLICY workspace_members_update_owner
ON public.workspace_members FOR UPDATE TO authenticated
USING (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND role <> 'owner'
)
WITH CHECK (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND role IN ('member', 'viewer')
);

CREATE POLICY workspace_members_delete_owner
ON public.workspace_members FOR DELETE TO authenticated
USING (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND role <> 'owner'
);

CREATE POLICY workspace_invitations_select_owner
ON public.workspace_invitations FOR SELECT TO authenticated
USING (juristai_private.is_workspace_owner(workspace_id));

CREATE POLICY workspace_invitations_insert_owner
ON public.workspace_invitations FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND invited_by = juristai_private.current_app_user_id()
    AND role IN ('member', 'viewer')
);

CREATE POLICY workspace_invitations_update_owner
ON public.workspace_invitations FOR UPDATE TO authenticated
USING (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
)
WITH CHECK (
    juristai_private.is_workspace_owner(workspace_id)
    AND juristai_private.workspace_is_active(workspace_id)
    AND role IN ('member', 'viewer')
);

CREATE POLICY workspace_tasks_select_member
ON public.workspace_tasks FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_tasks_insert_writer
ON public.workspace_tasks FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
    AND updated_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_tasks_update_writer
ON public.workspace_tasks FOR UPDATE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id))
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND updated_by = juristai_private.current_app_user_id()
);

-- No hard delete. Member/Owner sets deleted_at and deleted_by through UPDATE.

CREATE POLICY workspace_task_assignees_select_member
ON public.workspace_task_assignees FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_assignees_insert_writer
ON public.workspace_task_assignees FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND assigned_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_assignees_delete_writer
ON public.workspace_task_assignees FOR DELETE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_task_watchers_select_member
ON public.workspace_task_watchers FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_watchers_insert_writer
ON public.workspace_task_watchers FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND added_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_watchers_delete_writer
ON public.workspace_task_watchers FOR DELETE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_task_comments_select_member
ON public.workspace_task_comments FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_comments_insert_writer
ON public.workspace_task_comments FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_comments_update_author
ON public.workspace_task_comments FOR UPDATE TO authenticated
USING (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
)
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND author_id = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_links_select_member
ON public.workspace_task_links FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_links_insert_writer
ON public.workspace_task_links FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_links_delete_writer
ON public.workspace_task_links FOR DELETE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_ai_threads_select_member
ON public.workspace_ai_threads FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_ai_threads_insert_writer
ON public.workspace_ai_threads FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_ai_threads_update_writer
ON public.workspace_ai_threads FOR UPDATE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id))
WITH CHECK (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_ai_runs_select_member
ON public.workspace_ai_runs FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

-- AI run writes are server-only. This prevents a browser from bypassing cost,
-- reuse-key, legal prompt, and audit controls even when it has a valid JWT.

CREATE POLICY workspace_documents_select_member
ON public.workspace_documents FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_documents_insert_writer
ON public.workspace_documents FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_documents_update_writer
ON public.workspace_documents FOR UPDATE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id))
WITH CHECK (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_document_versions_select_member
ON public.workspace_document_versions FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_document_versions_insert_writer
ON public.workspace_document_versions FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

-- No UPDATE or DELETE policy: versions are append-only by design.

CREATE POLICY workspace_document_files_select_member
ON public.workspace_document_files FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_document_files_insert_writer
ON public.workspace_document_files FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

-- No UPDATE or DELETE policy: exported artifacts belong to immutable versions.

CREATE POLICY workspace_task_documents_select_member
ON public.workspace_task_documents FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_documents_insert_writer
ON public.workspace_task_documents FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND attached_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_documents_delete_writer
ON public.workspace_task_documents FOR DELETE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_memory_items_select_member
ON public.workspace_memory_items FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

-- Canonical memory writes are server-only so the reuse fingerprint, citations,
-- prompt-policy version, and provenance cannot be forged by a browser client.

CREATE POLICY workspace_memory_embeddings_select_member
ON public.workspace_memory_embeddings FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

-- Embeddings are server-only writes.

CREATE POLICY workspace_task_memory_items_select_member
ON public.workspace_task_memory_items FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_task_memory_items_insert_writer
ON public.workspace_task_memory_items FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND linked_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_task_memory_items_delete_writer
ON public.workspace_task_memory_items FOR DELETE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id));

CREATE POLICY workspace_ai_messages_select_member
ON public.workspace_ai_messages FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

-- AI messages are inserted by the API together with their run and memory
-- provenance. Browser clients cannot manufacture assistant messages.

CREATE POLICY workspace_activity_log_select_member
ON public.workspace_activity_log FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

-- Activity rows are trigger-written and append-only.

CREATE POLICY workspace_canvas_positions_select_member
ON public.workspace_task_canvas_positions FOR SELECT TO authenticated
USING (juristai_private.is_workspace_member(workspace_id));

CREATE POLICY workspace_canvas_positions_insert_writer
ON public.workspace_task_canvas_positions FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND updated_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_canvas_positions_update_writer
ON public.workspace_task_canvas_positions FOR UPDATE TO authenticated
USING (juristai_private.can_write_workspace(workspace_id))
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND updated_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_saved_views_select_visible
ON public.workspace_saved_views FOR SELECT TO authenticated
USING (
    juristai_private.is_workspace_member(workspace_id)
    AND (is_shared OR created_by = juristai_private.current_app_user_id())
);

CREATE POLICY workspace_saved_views_insert_writer
ON public.workspace_saved_views FOR INSERT TO authenticated
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_saved_views_update_creator
ON public.workspace_saved_views FOR UPDATE TO authenticated
USING (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
)
WITH CHECK (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

CREATE POLICY workspace_saved_views_delete_creator
ON public.workspace_saved_views FOR DELETE TO authenticated
USING (
    juristai_private.can_write_workspace(workspace_id)
    AND created_by = juristai_private.current_app_user_id()
);

REVOKE ALL ON TABLE
    public.workspaces,
    public.workspace_members,
    public.workspace_invitations,
    public.workspace_tasks,
    public.workspace_task_assignees,
    public.workspace_task_watchers,
    public.workspace_task_comments,
    public.workspace_task_links,
    public.workspace_ai_threads,
    public.workspace_ai_runs,
    public.workspace_documents,
    public.workspace_document_versions,
    public.workspace_document_files,
    public.workspace_task_documents,
    public.workspace_memory_items,
    public.workspace_memory_embeddings,
    public.workspace_task_memory_items,
    public.workspace_ai_messages,
    public.workspace_activity_log,
    public.workspace_task_canvas_positions,
    public.workspace_saved_views
FROM anon, authenticated;

-- Browser table access is read-only. All application-table mutations flow
-- through the JuristAI API, which validates payloads and repeats role/plan
-- checks inside a transaction. RLS remains the hard tenant boundary for reads
-- and for Realtime Postgres Changes. Storage upload is the sole intentional
-- direct browser write and has its own policies below.
GRANT SELECT ON TABLE
    public.workspaces,
    public.workspace_members,
    public.workspace_invitations,
    public.workspace_tasks,
    public.workspace_task_assignees,
    public.workspace_task_watchers,
    public.workspace_task_comments,
    public.workspace_task_links,
    public.workspace_ai_threads,
    public.workspace_ai_runs,
    public.workspace_documents,
    public.workspace_document_versions,
    public.workspace_document_files,
    public.workspace_task_documents,
    public.workspace_memory_items,
    public.workspace_memory_embeddings,
    public.workspace_task_memory_items,
    public.workspace_ai_messages,
    public.workspace_activity_log,
    public.workspace_task_canvas_positions,
    public.workspace_saved_views
TO authenticated;

-- Supabase Storage: private bucket; object path must be
-- {workspace_uuid}/{document_uuid}/{version_uuid}/{filename}.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
) VALUES (
    'workspace-documents',
    'workspace-documents',
    false,
    52428800,
    ARRAY[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'application/vnd.oasis.opendocument.text',
        'application/rtf',
        'text/plain',
        'image/jpeg',
        'image/png'
    ]::text[]
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS workspace_documents_storage_select ON storage.objects;
CREATE POLICY workspace_documents_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'workspace-documents'
    AND juristai_private.is_workspace_member(
        juristai_private.storage_workspace_id(name)
    )
);

DROP POLICY IF EXISTS workspace_documents_storage_insert ON storage.objects;
CREATE POLICY workspace_documents_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'workspace-documents'
    AND juristai_private.can_write_workspace(
        juristai_private.storage_workspace_id(name)
    )
);

-- No authenticated UPDATE or DELETE policies on Storage. Every exported/uploaded
-- artifact belongs to an immutable version. Server-side orphan cleanup may use the
-- service role without weakening member isolation.

-- Presence channels are always private and follow
-- workspace:{workspace_uuid}:... naming. Postgres Changes use the table RLS
-- policies above; Presence authorization is independently enforced here.
DROP POLICY IF EXISTS workspace_presence_select ON realtime.messages;
CREATE POLICY workspace_presence_select
ON realtime.messages FOR SELECT TO authenticated
USING (
    realtime.messages.extension = 'presence'
    AND juristai_private.is_workspace_member(
        juristai_private.realtime_topic_workspace_id((SELECT realtime.topic()))
    )
);

DROP POLICY IF EXISTS workspace_presence_insert ON realtime.messages;
CREATE POLICY workspace_presence_insert
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
    realtime.messages.extension = 'presence'
    AND juristai_private.is_workspace_member(
        juristai_private.realtime_topic_workspace_id((SELECT realtime.topic()))
    )
);

-- Realtime change feeds. Presence itself is an ephemeral channel feature and does
-- not need a database table. RLS filters every table subscription by membership.
DO $$
DECLARE
    table_name text;
    realtime_tables text[] := ARRAY[
        'workspaces',
        'workspace_members',
        'workspace_invitations',
        'workspace_tasks',
        'workspace_task_assignees',
        'workspace_task_watchers',
        'workspace_task_comments',
        'workspace_task_links',
        'workspace_ai_threads',
        'workspace_ai_runs',
        'workspace_documents',
        'workspace_document_versions',
        'workspace_document_files',
        'workspace_task_documents',
        'workspace_memory_items',
        'workspace_task_memory_items',
        'workspace_ai_messages',
        'workspace_activity_log',
        'workspace_task_canvas_positions',
        'workspace_saved_views'
    ];
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH table_name IN ARRAY realtime_tables LOOP
            EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', table_name);

            IF NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                  AND schemaname = 'public'
                  AND tablename = table_name
            ) THEN
                EXECUTE format(
                    'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
                    table_name
                );
            END IF;
        END LOOP;
    ELSE
        RAISE NOTICE 'supabase_realtime publication not found; table publication skipped';
    END IF;
END;
$$;

COMMIT;
