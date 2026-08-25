BEGIN;

ALTER TABLE public.workspace_invitations
    DROP CONSTRAINT IF EXISTS workspace_invitation_one_target;

ALTER TABLE public.workspace_invitations
    ADD CONSTRAINT workspace_invitation_at_most_one_target CHECK (
        num_nonnulls(target_email, target_username) <= 1
    );

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
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
