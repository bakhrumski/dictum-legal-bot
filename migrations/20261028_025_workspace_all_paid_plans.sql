BEGIN;

-- Workspace for every paid plan, and the internal (staff) workspace
-- (2026-10-28, owner: "Workspace ni barcha tarif uchun och" and the CustDev
-- pilot's option 1).
--
-- 1. Owning a Workspace needs an active Silver, Gold or Platinum plan (was
--    Platinum only). Members keep their own rule: an active paid plan.
-- 2. workspaces.internal: a Workspace a MASTER opens for staff work (the
--    CustDev pilot). It is active while its owner is a master - no plan -
--    and its members can only be staff (master, student, lawyer); an
--    ordinary account can never join one. The flag is set at creation by a
--    master only and never changes. Nothing else is relaxed: a client is
--    never a member, and every other rule (roles, RLS, invitations) stays.
-- Down: migrations/down/.

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;

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
          AND lower(COALESCE(a.tariff_plan, '')) IN ('silver', 'gold', 'platinum')
          AND (a.tariff_expires_at IS NULL OR a.tariff_expires_at >= now())
    );
$$;
COMMENT ON FUNCTION juristai_private.has_workspace_entitlement(integer) IS
    'True for an active Silver, Gold or Platinum user or master: may own a Workspace.';

-- a Workspace is active while its owner may own it, or it is internal and its owner is a master
CREATE OR REPLACE FUNCTION juristai_private.workspace_owner_active(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspaces AS w
        JOIN public.admins AS o ON o.id = w.owner_id
        WHERE w.id = p_workspace_id
          AND w.deleted_at IS NULL
          AND (
              juristai_private.has_workspace_entitlement(w.owner_id)
              OR (w.internal AND o.role = 'master')
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
    SELECT juristai_private.workspace_owner_active(p_workspace_id);
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
        JOIN public.admins m ON m.id = wm.user_id
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = juristai_private.current_app_user_id()
          AND w.deleted_at IS NULL
          AND juristai_private.workspace_owner_active(w.id)
          AND (
              wm.role = 'owner'
              OR juristai_private.has_active_paid_entitlement(wm.user_id, 'silver')
              OR (w.internal AND m.role IN ('master', 'student', 'lawyer'))
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
    actor_role text;
BEGIN
    IF actor_id IS NULL OR actor_id <> NEW.owner_id OR actor_id <> NEW.created_by THEN
        RAISE EXCEPTION 'Workspace owner must be the authenticated creator';
    END IF;

    SELECT role INTO actor_role FROM public.admins WHERE id = actor_id;
    IF NEW.internal THEN
        IF actor_role IS DISTINCT FROM 'master' THEN
            RAISE EXCEPTION 'Only a master can open an internal workspace';
        END IF;
    ELSIF NOT juristai_private.has_workspace_entitlement(actor_id) THEN
        RAISE EXCEPTION 'An active paid plan (Silver, Gold or Platinum) is required to create a workspace';
    END IF;

    RETURN NEW;
END;
$$;

-- the flag is set at creation and never changes
CREATE OR REPLACE FUNCTION juristai_private.guard_workspace_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.internal IS DISTINCT FROM OLD.internal THEN
        RAISE EXCEPTION 'A workspace''s internal flag cannot change';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspaces_guard_internal ON public.workspaces;
CREATE TRIGGER workspaces_guard_internal BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION juristai_private.guard_workspace_internal();

-- an internal workspace's members are staff only, however they are added
CREATE OR REPLACE FUNCTION juristai_private.guard_internal_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.internal)
       AND NOT EXISTS (SELECT 1 FROM public.admins a WHERE a.id = NEW.user_id AND a.role IN ('master', 'student', 'lawyer')) THEN
        RAISE EXCEPTION 'An internal workspace takes staff members only';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_members_guard_internal ON public.workspace_members;
CREATE TRIGGER workspace_members_guard_internal BEFORE INSERT OR UPDATE OF user_id ON public.workspace_members
FOR EACH ROW EXECUTE FUNCTION juristai_private.guard_internal_membership();

CREATE OR REPLACE FUNCTION juristai_private.validate_invitation_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    target_matches boolean;
    is_internal boolean;
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

        SELECT COALESCE(w.internal, false) INTO is_internal FROM public.workspaces AS w WHERE w.id = NEW.workspace_id;

        SELECT EXISTS (
            SELECT 1
            FROM public.admins AS a
            WHERE a.id = NEW.accepted_by
              -- an ordinary or master account; an internal (staff) workspace takes staff only
              AND (
                  (NOT is_internal AND a.role IN ('user', 'master'))
                  OR (is_internal AND a.role IN ('master', 'student', 'lawyer'))
              )
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

DROP POLICY IF EXISTS workspaces_insert_platinum_owner ON public.workspaces;
DROP POLICY IF EXISTS workspaces_insert_paid_owner ON public.workspaces;
CREATE POLICY workspaces_insert_paid_owner
ON public.workspaces FOR INSERT TO authenticated
WITH CHECK (
    owner_id = juristai_private.current_app_user_id()
    AND created_by = juristai_private.current_app_user_id()
    AND (
        juristai_private.has_workspace_entitlement(owner_id)
        OR (internal AND EXISTS (SELECT 1 FROM public.admins a WHERE a.id = owner_id AND a.role = 'master'))
    )
);

REVOKE ALL ON FUNCTION juristai_private.workspace_owner_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION juristai_private.workspace_owner_active(uuid) TO authenticated, service_role;

COMMIT;
