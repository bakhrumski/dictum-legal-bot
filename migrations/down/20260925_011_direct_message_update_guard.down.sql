-- Reverts migrations/20260925_011_direct_message_update_guard.sql, then:
--   DELETE FROM public.schema_migrations WHERE version = '20260925_011_direct_message_update_guard.sql';
BEGIN;
DROP TRIGGER IF EXISTS workspace_direct_messages_update_guard ON public.workspace_direct_messages;
DROP FUNCTION IF EXISTS juristai_private.guard_direct_message_update();
COMMIT;
