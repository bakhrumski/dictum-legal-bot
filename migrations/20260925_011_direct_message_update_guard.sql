BEGIN;

-- Astra audit S6. The UPDATE policy on workspace_direct_messages checks only
-- that the caller is one of the two parties, so either party could rewrite
-- who the message was between, and the recipient could rewrite its text.
-- Policies cannot compare OLD and NEW, so a trigger enforces what the
-- comment in migration 008 promised:
--   * nobody changes the workspace, the two parties or the creation time;
--   * the recipient may only mark it read;
--   * the sender may edit or withdraw it, but not mark it read.
-- Down: migrations/down/20260925_011_direct_message_update_guard.down.sql
CREATE OR REPLACE FUNCTION juristai_private.guard_direct_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    actor integer := juristai_private.current_app_user_id();
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'direct message parties and origin cannot change'
            USING ERRCODE = '42501';
    END IF;

    IF actor IS NOT NULL AND actor = OLD.recipient_id THEN
        IF NEW.body IS DISTINCT FROM OLD.body OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
            RAISE EXCEPTION 'the recipient may only mark a direct message read'
                USING ERRCODE = '42501';
        END IF;
    ELSIF actor IS NOT NULL AND actor = OLD.sender_id THEN
        IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN
            RAISE EXCEPTION 'only the recipient marks a direct message read'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION juristai_private.guard_direct_message_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS workspace_direct_messages_update_guard ON public.workspace_direct_messages;
CREATE TRIGGER workspace_direct_messages_update_guard
BEFORE UPDATE ON public.workspace_direct_messages
FOR EACH ROW EXECUTE FUNCTION juristai_private.guard_direct_message_update();

COMMIT;
