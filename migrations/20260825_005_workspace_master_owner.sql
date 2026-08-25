BEGIN;

-- Workspace ownership is a subscription entitlement. Master Admin accounts
-- may therefore create and keep a Workspace when their Platinum plan is
-- active, while lawyer and student account roles remain ineligible.
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

COMMENT ON FUNCTION juristai_private.has_workspace_entitlement(integer) IS
    'Returns true for active Platinum user or Master Admin Workspace owners.';

COMMIT;
