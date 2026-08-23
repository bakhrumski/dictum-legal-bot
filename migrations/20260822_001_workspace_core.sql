BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- Existing JuristAI accounts remain the identity source. This stable UUID is used
-- as the Supabase-compatible JWT subject; admins.id remains the application user id.
ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS supabase_subject uuid,
    ADD COLUMN IF NOT EXISTS tariff_plan varchar(20),
    ADD COLUMN IF NOT EXISTS tariff_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS email varchar(255),
    ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS google_id varchar(100),
    ADD COLUMN IF NOT EXISTS email_verification_source varchar(20);

ALTER TABLE public.admins
    ADD CONSTRAINT admins_email_verification_source_check
    CHECK (
        email_verification_source IS NULL
        OR email_verification_source IN ('google', 'email_otp')
    ) NOT VALID;

-- Google already proved ownership for existing OAuth-linked accounts. Older
-- password/Telegram registrations cannot be safely inferred and must verify
-- their email once before accepting an email-targeted Workspace invitation.
UPDATE public.admins
SET email_verified = true,
    email_verification_source = 'google'
WHERE google_id IS NOT NULL
  AND email IS NOT NULL;

ALTER TABLE public.admins
    VALIDATE CONSTRAINT admins_email_verification_source_check;

UPDATE public.admins
SET supabase_subject = gen_random_uuid()
WHERE supabase_subject IS NULL;

ALTER TABLE public.admins
    ALTER COLUMN supabase_subject SET DEFAULT gen_random_uuid(),
    ALTER COLUMN supabase_subject SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS admins_supabase_subject_uidx
    ON public.admins (supabase_subject);

CREATE SCHEMA IF NOT EXISTS juristai_private;

CREATE OR REPLACE FUNCTION juristai_private.current_app_user_id()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    setting_actor text;
    claims_text text;
    claim_actor text;
BEGIN
    -- A signed client identity always wins. The private actor setting exists
    -- only for trusted server-side transactions using the existing session
    -- system; it must never override a Supabase JWT claim.
    claims_text := current_setting('request.jwt.claims', true);
    IF claims_text IS NOT NULL AND claims_text <> '' THEN
        claim_actor := claims_text::jsonb ->> 'app_user_id';
        IF claim_actor ~ '^[0-9]+$' THEN
            RETURN claim_actor::integer;
        END IF;
    END IF;

    setting_actor := current_setting('juristai.actor_id', true);
    IF setting_actor ~ '^[0-9]+$' THEN
        RETURN setting_actor::integer;
    END IF;

    RETURN NULL;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.has_workspace_entitlement(p_user_id integer)
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
          AND lower(COALESCE(a.tariff_plan, '')) = 'platinum'
          AND (
              a.tariff_expires_at IS NULL
              OR a.tariff_expires_at >= now()
          )
    );
$$;

CREATE TABLE public.workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
    slug citext NOT NULL UNIQUE CHECK (slug::text ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
    owner_id integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    default_language text NOT NULL DEFAULT 'uz' CHECK (default_language IN ('uz', 'ru', 'en')),
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    CONSTRAINT workspaces_owner_is_creator CHECK (owner_id = created_by),
    CONSTRAINT workspaces_delete_pair CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL)
        OR deleted_at IS NOT NULL
    )
);

CREATE TABLE public.workspace_members (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
    invited_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE UNIQUE INDEX workspace_members_single_owner_uidx
    ON public.workspace_members (workspace_id)
    WHERE role = 'owner';

CREATE INDEX workspace_members_user_idx
    ON public.workspace_members (user_id, workspace_id);

CREATE TABLE public.workspace_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    target_email citext,
    target_username citext,
    role text NOT NULL CHECK (role IN ('member', 'viewer')),
    token_hash bytea NOT NULL UNIQUE,
    invited_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    expires_at timestamptz NOT NULL,
    accepted_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    accepted_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_invitation_one_target CHECK (
        num_nonnulls(target_email, target_username) = 1
    ),
    CONSTRAINT workspace_invitation_expiry CHECK (expires_at > created_at),
    CONSTRAINT workspace_invitation_acceptance_pair CHECK (
        (accepted_at IS NULL AND accepted_by IS NULL)
        OR (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
    )
);

CREATE UNIQUE INDEX workspace_invitation_pending_email_uidx
    ON public.workspace_invitations (workspace_id, lower(target_email::text))
    WHERE accepted_at IS NULL AND revoked_at IS NULL AND target_email IS NOT NULL;

CREATE UNIQUE INDEX workspace_invitation_pending_username_uidx
    ON public.workspace_invitations (workspace_id, lower(target_username::text))
    WHERE accepted_at IS NULL AND revoked_at IS NULL AND target_username IS NOT NULL;

CREATE TABLE public.workspace_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled')),
    priority text NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    start_date date,
    due_date date,
    is_milestone boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    updated_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    deleted_at timestamptz,
    deleted_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    CONSTRAINT workspace_task_dates CHECK (
        start_date IS NULL OR due_date IS NULL OR start_date <= due_date
    ),
    CONSTRAINT workspace_task_milestone_date CHECK (NOT is_milestone OR due_date IS NOT NULL),
    CONSTRAINT workspace_task_deleted_pair CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL)
        OR deleted_at IS NOT NULL
    ),
    UNIQUE (workspace_id, id)
);

CREATE INDEX workspace_tasks_workspace_status_idx
    ON public.workspace_tasks (workspace_id, status, due_date)
    WHERE deleted_at IS NULL;

CREATE INDEX workspace_tasks_workspace_priority_idx
    ON public.workspace_tasks (workspace_id, priority, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE public.workspace_task_assignees (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id integer NOT NULL,
    assigned_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id, user_id),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX workspace_task_assignees_user_idx
    ON public.workspace_task_assignees (workspace_id, user_id, task_id);

CREATE TABLE public.workspace_task_watchers (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id integer NOT NULL,
    added_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id, user_id),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX workspace_task_watchers_user_idx
    ON public.workspace_task_watchers (workspace_id, user_id, task_id);

CREATE TABLE public.workspace_task_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    author_id integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (workspace_id, id)
);

CREATE INDEX workspace_task_comments_task_idx
    ON public.workspace_task_comments (workspace_id, task_id, created_at);

CREATE TABLE public.workspace_task_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    source_task_id uuid NOT NULL,
    target_task_id uuid NOT NULL,
    link_type text NOT NULL CHECK (link_type IN ('dependency', 'subtask', 'related')),
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, source_task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, target_task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT workspace_task_link_not_self CHECK (source_task_id <> target_task_id),
    UNIQUE (workspace_id, source_task_id, target_task_id, link_type)
);

CREATE INDEX workspace_task_links_target_idx
    ON public.workspace_task_links (workspace_id, target_task_id);

CREATE TABLE public.workspace_ai_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id uuid,
    title text NOT NULL DEFAULT 'Yangi suhbat' CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, id)
);

CREATE INDEX workspace_ai_threads_workspace_idx
    ON public.workspace_ai_threads (workspace_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE TABLE public.workspace_ai_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id uuid,
    thread_id uuid,
    requested_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    request_text text NOT NULL CHECK (char_length(btrim(request_text)) > 0),
    reuse_key text NOT NULL CHECK (char_length(reuse_key) BETWEEN 16 AND 160),
    context_fingerprint text NOT NULL CHECK (char_length(context_fingerprint) BETWEEN 16 AND 160),
    prompt_policy_version text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'reused')),
    provider text,
    model text,
    input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
    estimated_cost_usd numeric(14, 8) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
    context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(context_snapshot) = 'object'),
    reused_memory_item_id uuid,
    started_at timestamptz,
    completed_at timestamptz,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, thread_id)
        REFERENCES public.workspace_ai_threads(workspace_id, id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, id)
);

CREATE UNIQUE INDEX workspace_ai_runs_one_active_generation_uidx
    ON public.workspace_ai_runs (
        workspace_id,
        COALESCE(task_id, '00000000-0000-0000-0000-000000000000'::uuid),
        reuse_key
    )
    WHERE status IN ('queued', 'running');

CREATE INDEX workspace_ai_runs_workspace_status_idx
    ON public.workspace_ai_runs (workspace_id, status, created_at DESC);

CREATE TABLE public.workspace_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    origin_task_id uuid,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    kind text NOT NULL CHECK (kind IN ('upload', 'generated', 'template')),
    template_schema jsonb,
    generated_from_document_id uuid,
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    FOREIGN KEY (workspace_id, origin_task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, generated_from_document_id)
        REFERENCES public.workspace_documents(workspace_id, id) ON DELETE RESTRICT,
    CONSTRAINT workspace_document_template_schema CHECK (
        (kind = 'template' AND template_schema IS NOT NULL AND jsonb_typeof(template_schema) = 'object')
        OR (kind <> 'template' AND template_schema IS NULL)
    ),
    UNIQUE (workspace_id, id)
);

CREATE INDEX workspace_documents_workspace_idx
    ON public.workspace_documents (workspace_id, updated_at DESC)
    WHERE archived_at IS NULL;

CREATE TABLE public.workspace_document_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version_number integer NOT NULL CHECK (version_number > 0),
    content_text text,
    content_json jsonb,
    source_ai_run_id uuid,
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, document_id)
        REFERENCES public.workspace_documents(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, source_ai_run_id)
        REFERENCES public.workspace_ai_runs(workspace_id, id)
        ON DELETE SET NULL (source_ai_run_id),
    CONSTRAINT workspace_document_version_json CHECK (
        content_json IS NULL OR jsonb_typeof(content_json) IN ('object', 'array')
    ),
    UNIQUE (workspace_id, id),
    UNIQUE (document_id, version_number)
);

CREATE INDEX workspace_document_versions_document_idx
    ON public.workspace_document_versions (document_id, version_number DESC);

CREATE TABLE public.workspace_document_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    document_version_id uuid NOT NULL,
    file_format text NOT NULL CHECK (file_format IN ('original', 'docx', 'pdf')),
    storage_bucket text NOT NULL DEFAULT 'workspace-documents'
        CHECK (storage_bucket = 'workspace-documents'),
    storage_object_path text NOT NULL UNIQUE,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, document_version_id)
        REFERENCES public.workspace_document_versions(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (document_version_id, file_format)
);

CREATE TABLE public.workspace_task_documents (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    document_id uuid NOT NULL,
    attached_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    attached_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id, document_id),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, document_id)
        REFERENCES public.workspace_documents(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE public.workspace_memory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    origin_task_id uuid,
    kind text NOT NULL
        CHECK (kind IN ('answer', 'research', 'document_summary', 'decision', 'note', 'generated_document')),
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
    content_markdown text NOT NULL CHECK (char_length(btrim(content_markdown)) > 0),
    content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    citations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(citations) = 'array'),
    reuse_key text NOT NULL CHECK (char_length(reuse_key) BETWEEN 16 AND 160),
    context_fingerprint text NOT NULL CHECK (char_length(context_fingerprint) BETWEEN 16 AND 160),
    prompt_policy_version text NOT NULL,
    source_ai_run_id uuid,
    source_document_version_id uuid,
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz,
    superseded_by uuid,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(content_markdown, ''))
    ) STORED,
    FOREIGN KEY (workspace_id, origin_task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, source_ai_run_id)
        REFERENCES public.workspace_ai_runs(workspace_id, id)
        ON DELETE SET NULL (source_ai_run_id),
    FOREIGN KEY (workspace_id, source_document_version_id)
        REFERENCES public.workspace_document_versions(workspace_id, id)
        ON DELETE SET NULL (source_document_version_id),
    FOREIGN KEY (workspace_id, superseded_by)
        REFERENCES public.workspace_memory_items(workspace_id, id) ON DELETE RESTRICT,
    UNIQUE (workspace_id, id)
);

CREATE UNIQUE INDEX workspace_memory_items_active_reuse_uidx
    ON public.workspace_memory_items (workspace_id, reuse_key)
    WHERE superseded_at IS NULL;

CREATE UNIQUE INDEX workspace_memory_items_source_run_uidx
    ON public.workspace_memory_items (source_ai_run_id)
    WHERE source_ai_run_id IS NOT NULL;

CREATE INDEX workspace_memory_items_search_idx
    ON public.workspace_memory_items USING gin (search_vector);

CREATE INDEX workspace_memory_items_workspace_kind_idx
    ON public.workspace_memory_items (workspace_id, kind, created_at DESC)
    WHERE superseded_at IS NULL;

ALTER TABLE public.workspace_ai_runs
    ADD CONSTRAINT workspace_ai_runs_reused_memory_fk
    FOREIGN KEY (workspace_id, reused_memory_item_id)
    REFERENCES public.workspace_memory_items(workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE public.workspace_memory_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    memory_item_id uuid NOT NULL,
    embedding_model text NOT NULL,
    embedding_dimensions integer NOT NULL CHECK (embedding_dimensions > 0),
    embedding vector NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, memory_item_id)
        REFERENCES public.workspace_memory_items(workspace_id, id) ON DELETE CASCADE,
    UNIQUE (memory_item_id, embedding_model)
);

CREATE INDEX workspace_memory_embeddings_lookup_idx
    ON public.workspace_memory_embeddings (workspace_id, embedding_model, embedding_dimensions);

CREATE TABLE public.workspace_task_memory_items (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    memory_item_id uuid NOT NULL,
    linked_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    linked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id, memory_item_id),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, memory_item_id)
        REFERENCES public.workspace_memory_items(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE public.workspace_ai_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content text NOT NULL CHECK (char_length(content) > 0),
    created_by integer REFERENCES public.admins(id) ON DELETE SET NULL,
    ai_run_id uuid,
    memory_item_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, thread_id)
        REFERENCES public.workspace_ai_threads(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, ai_run_id)
        REFERENCES public.workspace_ai_runs(workspace_id, id)
        ON DELETE SET NULL (ai_run_id),
    FOREIGN KEY (workspace_id, memory_item_id)
        REFERENCES public.workspace_memory_items(workspace_id, id)
        ON DELETE SET NULL (memory_item_id),
    UNIQUE (workspace_id, id)
);

CREATE INDEX workspace_ai_messages_thread_idx
    ON public.workspace_ai_messages (workspace_id, thread_id, created_at);

CREATE TABLE public.workspace_activity_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id uuid,
    actor_id integer REFERENCES public.admins(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX workspace_activity_workspace_idx
    ON public.workspace_activity_log (workspace_id, created_at DESC);

CREATE INDEX workspace_activity_task_idx
    ON public.workspace_activity_log (workspace_id, task_id, created_at DESC)
    WHERE task_id IS NOT NULL;

-- Phase 2 compatibility only. No Canvas or saved-view UI/API is part of Phase 1.
CREATE TABLE public.workspace_task_canvas_positions (
    workspace_id uuid NOT NULL,
    task_id uuid NOT NULL,
    x double precision NOT NULL DEFAULT 0,
    y double precision NOT NULL DEFAULT 0,
    width double precision NOT NULL DEFAULT 300 CHECK (width BETWEEN 120 AND 1200),
    height double precision NOT NULL DEFAULT 160 CHECK (height BETWEEN 80 AND 900),
    updated_by integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, task_id),
    FOREIGN KEY (workspace_id, task_id)
        REFERENCES public.workspace_tasks(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE public.workspace_saved_views (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    view_kind text NOT NULL CHECK (view_kind IN ('list', 'timeline', 'canvas')),
    filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
    sort_config jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sort_config) = 'array'),
    is_shared boolean NOT NULL DEFAULT false,
    created_by integer NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, created_by, name)
);

CREATE OR REPLACE FUNCTION juristai_private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.prepare_task_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'Immutable task identity fields cannot be changed';
    END IF;

    NEW.updated_at := now();
    NEW.revision := OLD.revision + 1;

    IF NEW.status = 'done' AND OLD.status <> 'done' THEN
        NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSIF NEW.status <> 'done' THEN
        NEW.completed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.prepare_workspace_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor_id integer := juristai_private.current_app_user_id();
BEGIN
    IF actor_id IS NULL OR actor_id <> NEW.owner_id OR actor_id <> NEW.created_by THEN
        RAISE EXCEPTION 'Workspace owner must be the authenticated creator';
    END IF;

    IF NOT juristai_private.has_workspace_entitlement(actor_id) THEN
        RAISE EXCEPTION 'An active Platinum plan is required to create a workspace';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.add_workspace_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
    VALUES (NEW.id, NEW.owner_id, 'owner', NEW.owner_id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.protect_workspace_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.owner_id <> OLD.owner_id OR NEW.created_by <> OLD.created_by THEN
        RAISE EXCEPTION 'Workspace identity and owner cannot be changed';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.protect_membership_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.workspace_id <> OLD.workspace_id OR NEW.user_id <> OLD.user_id THEN
        RAISE EXCEPTION 'Workspace membership identity cannot be changed';
    END IF;
    IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN
        RAISE EXCEPTION 'Workspace owner membership cannot be demoted';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.prevent_owner_membership_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.role = 'owner' AND EXISTS (
        SELECT 1
        FROM public.workspaces AS w
        WHERE w.id = OLD.workspace_id
          AND w.deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Workspace owner membership cannot be deleted';
    END IF;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.validate_invitation_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_matches boolean;
BEGIN
    IF OLD.accepted_at IS NOT NULL THEN
        IF NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
           OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by THEN
            RAISE EXCEPTION 'Accepted invitation state is immutable';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.accepted_at IS NOT NULL THEN
        IF NEW.revoked_at IS NOT NULL OR NEW.expires_at <= now() THEN
            RAISE EXCEPTION 'Invitation is revoked or expired';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.admins AS a
            WHERE a.id = NEW.accepted_by
              AND a.role = 'user'
              AND (
                  (
                      NEW.target_email IS NOT NULL
                      AND a.email IS NOT NULL
                      AND a.email_verified IS TRUE
                      AND a.email_verification_source IN ('google', 'email_otp')
                      AND lower(a.email) = lower(NEW.target_email::text)
                  )
                  OR (
                      NEW.target_username IS NOT NULL
                      AND lower(a.username) = lower(NEW.target_username::text)
                  )
              )
        ) INTO target_matches;

        IF NOT target_matches THEN
            RAISE EXCEPTION 'Invitation target does not match the accepting account';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.add_accepted_workspace_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL THEN
        INSERT INTO public.workspace_members (
            workspace_id, user_id, role, invited_by, joined_at
        ) VALUES (
            NEW.workspace_id, NEW.accepted_by, NEW.role, NEW.invited_by, NEW.accepted_at
        ) ON CONFLICT (workspace_id, user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.prevent_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.protect_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    column_name text;
    old_data jsonb := to_jsonb(OLD);
    new_data jsonb := to_jsonb(NEW);
BEGIN
    FOREACH column_name IN ARRAY TG_ARGV LOOP
        IF (new_data -> column_name) IS DISTINCT FROM (old_data -> column_name) THEN
            RAISE EXCEPTION '% is immutable on %', column_name, TG_TABLE_NAME;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.attach_origin_document_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.origin_task_id IS NOT NULL THEN
        INSERT INTO public.workspace_task_documents (
            workspace_id, task_id, document_id, attached_by
        ) VALUES (
            NEW.workspace_id, NEW.origin_task_id, NEW.id, NEW.created_by
        ) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.attach_origin_memory_to_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.origin_task_id IS NOT NULL THEN
        INSERT INTO public.workspace_task_memory_items (
            workspace_id, task_id, memory_item_id, linked_by
        ) VALUES (
            NEW.workspace_id, NEW.origin_task_id, NEW.id, NEW.created_by
        ) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION juristai_private.log_workspace_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    row_data jsonb;
    old_data jsonb;
    target_workspace uuid;
    target_task uuid;
    target_entity uuid;
    target_entity_text text;
    target_action text;
    safe_new jsonb;
    safe_old jsonb;
BEGIN
    row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    old_data := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
    target_workspace := (row_data ->> 'workspace_id')::uuid;
    target_task := NULLIF(
        COALESCE(row_data ->> 'task_id', row_data ->> 'origin_task_id', row_data ->> 'source_task_id'),
        ''
    )::uuid;

    IF TG_ARGV[0] = 'task' THEN
        target_task := (row_data ->> 'id')::uuid;
    END IF;

    target_entity_text := NULLIF(
        COALESCE(
            row_data ->> 'id',
            row_data ->> 'document_id',
            row_data ->> 'memory_item_id',
            row_data ->> 'target_task_id'
        ),
        ''
    );
    target_entity := CASE
        WHEN target_entity_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN target_entity_text::uuid
        ELSE NULL
    END;

    safe_new := row_data
        - ARRAY['description', 'body', 'content', 'content_text', 'content_json',
                'content_markdown', 'embedding', 'token_hash', 'error_message'];
    safe_old := COALESCE(old_data, '{}'::jsonb)
        - ARRAY['description', 'body', 'content', 'content_text', 'content_json',
                'content_markdown', 'embedding', 'token_hash', 'error_message'];
    target_action := TG_ARGV[0] || '.' || lower(TG_OP);

    INSERT INTO public.workspace_activity_log (
        workspace_id,
        task_id,
        actor_id,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        target_workspace,
        target_task,
        juristai_private.current_app_user_id(),
        target_action,
        TG_ARGV[0],
        target_entity,
        CASE
            WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', safe_old, 'after', safe_new)
            ELSE jsonb_build_object('record', safe_new)
        END
    );

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER workspaces_prepare_insert
BEFORE INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION juristai_private.prepare_workspace_insert();

CREATE TRIGGER workspaces_add_owner
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION juristai_private.add_workspace_owner_membership();

CREATE TRIGGER workspaces_protect_identity
BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_workspace_identity();

CREATE TRIGGER workspace_members_protect_identity
BEFORE UPDATE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_membership_identity();

CREATE TRIGGER workspace_members_protect_owner_delete
BEFORE DELETE ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION juristai_private.prevent_owner_membership_delete();

CREATE TRIGGER workspace_invitations_protect_identity
BEFORE UPDATE ON public.workspace_invitations
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'id', 'workspace_id', 'target_email', 'target_username', 'token_hash',
    'invited_by', 'created_at'
);

CREATE TRIGGER workspace_invitations_validate_acceptance
BEFORE UPDATE ON public.workspace_invitations
FOR EACH ROW EXECUTE FUNCTION juristai_private.validate_invitation_acceptance();

CREATE TRIGGER workspace_invitations_add_member
AFTER UPDATE ON public.workspace_invitations
FOR EACH ROW EXECUTE FUNCTION juristai_private.add_accepted_workspace_member();

CREATE TRIGGER workspace_tasks_prepare_update
BEFORE UPDATE ON public.workspace_tasks
FOR EACH ROW EXECUTE FUNCTION juristai_private.prepare_task_update();

CREATE TRIGGER workspace_task_comments_touch
BEFORE UPDATE ON public.workspace_task_comments
FOR EACH ROW EXECUTE FUNCTION juristai_private.touch_updated_at();

CREATE TRIGGER workspace_task_comments_protect_identity
BEFORE UPDATE ON public.workspace_task_comments
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'id', 'workspace_id', 'task_id', 'author_id', 'created_at'
);

CREATE TRIGGER workspace_ai_threads_touch
BEFORE UPDATE ON public.workspace_ai_threads
FOR EACH ROW EXECUTE FUNCTION juristai_private.touch_updated_at();

CREATE TRIGGER workspace_ai_threads_protect_identity
BEFORE UPDATE ON public.workspace_ai_threads
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'id', 'workspace_id', 'created_by', 'created_at'
);

CREATE TRIGGER workspace_documents_touch
BEFORE UPDATE ON public.workspace_documents
FOR EACH ROW EXECUTE FUNCTION juristai_private.touch_updated_at();

CREATE TRIGGER workspace_documents_protect_identity
BEFORE UPDATE ON public.workspace_documents
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'id', 'workspace_id', 'created_by', 'created_at'
);

CREATE TRIGGER workspace_saved_views_touch
BEFORE UPDATE ON public.workspace_saved_views
FOR EACH ROW EXECUTE FUNCTION juristai_private.touch_updated_at();

CREATE TRIGGER workspace_saved_views_protect_identity
BEFORE UPDATE ON public.workspace_saved_views
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'id', 'workspace_id', 'created_by', 'created_at'
);

CREATE TRIGGER workspace_canvas_positions_protect_identity
BEFORE UPDATE ON public.workspace_task_canvas_positions
FOR EACH ROW EXECUTE FUNCTION juristai_private.protect_identity_columns(
    'workspace_id', 'task_id'
);

CREATE TRIGGER workspace_documents_attach_origin_task
AFTER INSERT ON public.workspace_documents
FOR EACH ROW EXECUTE FUNCTION juristai_private.attach_origin_document_to_task();

CREATE TRIGGER workspace_memory_attach_origin_task
AFTER INSERT ON public.workspace_memory_items
FOR EACH ROW EXECUTE FUNCTION juristai_private.attach_origin_memory_to_task();

CREATE TRIGGER workspace_document_versions_immutable
BEFORE UPDATE OR DELETE ON public.workspace_document_versions
FOR EACH ROW EXECUTE FUNCTION juristai_private.prevent_immutable_change();

CREATE TRIGGER workspace_document_files_immutable
BEFORE UPDATE OR DELETE ON public.workspace_document_files
FOR EACH ROW EXECUTE FUNCTION juristai_private.prevent_immutable_change();

CREATE TRIGGER workspace_activity_log_immutable
BEFORE UPDATE OR DELETE ON public.workspace_activity_log
FOR EACH ROW EXECUTE FUNCTION juristai_private.prevent_immutable_change();

CREATE TRIGGER workspace_tasks_activity
AFTER INSERT OR UPDATE ON public.workspace_tasks
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('task');

CREATE TRIGGER workspace_task_assignees_activity
AFTER INSERT OR DELETE ON public.workspace_task_assignees
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('assignee');

CREATE TRIGGER workspace_task_watchers_activity
AFTER INSERT OR DELETE ON public.workspace_task_watchers
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('watcher');

CREATE TRIGGER workspace_task_comments_activity
AFTER INSERT OR UPDATE ON public.workspace_task_comments
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('comment');

CREATE TRIGGER workspace_task_links_activity
AFTER INSERT OR DELETE ON public.workspace_task_links
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('task_link');

CREATE TRIGGER workspace_documents_activity
AFTER INSERT OR UPDATE ON public.workspace_documents
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('document');

CREATE TRIGGER workspace_document_versions_activity
AFTER INSERT ON public.workspace_document_versions
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('document_version');

CREATE TRIGGER workspace_task_documents_activity
AFTER INSERT OR DELETE ON public.workspace_task_documents
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('task_document');

CREATE TRIGGER workspace_memory_items_activity
AFTER INSERT OR UPDATE ON public.workspace_memory_items
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('memory_item');

CREATE TRIGGER workspace_task_memory_items_activity
AFTER INSERT OR DELETE ON public.workspace_task_memory_items
FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('task_memory');

COMMENT ON TABLE public.workspace_memory_items IS
'Canonical reusable AI/research outputs. A reuse_key uniquely identifies the active output for a stable workspace context, so work is generated once and linked to many tasks.';

COMMENT ON TABLE public.workspace_task_memory_items IS
'Many-to-many links from tasks to canonical workspace memory. Reusing prior work creates a link, not a copied answer or a second AI run.';

COMMENT ON TABLE public.workspace_document_versions IS
'Immutable document versions. New edits always insert a new row; previous legal documents are never overwritten.';

COMMENT ON TABLE public.workspace_memory_embeddings IS
'Variable-dimension embeddings. Model and dimensions are stored explicitly because JuristAI currently uses both 1024- and 1536-dimensional embedding providers.';

COMMIT;
