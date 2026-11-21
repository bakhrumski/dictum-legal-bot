-- Reverts migrations/20261028_025_workspace_all_paid_plans.sql: owning a
-- Workspace needs Platinum again, internal workspaces stop being active (their
-- rows stay; drop them first if they must go), and the earlier definitions
-- come back (005, 002, 004, 001, 007). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_025_workspace_all_paid_plans.sql';
BEGIN;

DROP POLICY IF EXISTS workspaces_insert_paid_owner ON public.workspaces;
CREATE POLICY workspaces_insert_platinum_owner
ON public.workspaces FOR INSERT TO authenticated
WITH CHECK (
    owner_id = juristai_private.current_app_user_id()
    AND created_by = juristai_private.current_app_user_id()
    AND juristai_private.has_workspace_entitlement(owner_id)
);

DROP TRIGGER IF EXISTS workspace_members_guard_internal ON public.workspace_members;
DROP TRIGGER IF EXISTS workspaces_guard_internal ON public.workspaces;
DROP FUNCTION IF EXISTS juristai_private.guard_internal_membership();
DROP FUNCTION IF EXISTS juristai_private.guard_workspace_internal();

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
          AND a.role IN ('user', 'master')
          AND lower(COALESCE(a.tariff_plan, '')) = 'platinum'
          AND (
              a.tariff_expires_at IS NULL
              OR a.tariff_expires_at >= now()
          )
    );
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

CREATE OR REPLACE FUNCTION juristai_private.validate_invitation_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_matches boolean;
    already_member boolean;
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
              AND a.role IN ('user', 'master')
              AND (
                  (NEW.target_email IS NULL AND NEW.target_username IS NULL)
                  OR (
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

        SELECT EXISTS (
            SELECT 1
            FROM public.workspace_members AS wm
            WHERE wm.workspace_id = NEW.workspace_id
              AND wm.user_id = NEW.accepted_by
        ) INTO already_member;

        IF already_member THEN
            RAISE EXCEPTION 'Account is already a workspace member';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS juristai_private.workspace_owner_active(uuid);
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS internal;

COMMIT;
