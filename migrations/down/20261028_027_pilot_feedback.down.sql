-- Reverts migrations/20261028_027_pilot_feedback.sql: the pilot's links to
-- its Workspace and the feedback tags / replies are lost (the Workspace tasks
-- and their activity log stay). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_027_pilot_feedback.sql';
BEGIN;
ALTER TABLE public.admins DROP COLUMN IF EXISTS pilot_replies_off;
DROP TABLE IF EXISTS public.pilot_feedback;
DROP TABLE IF EXISTS public.pilot_client_tasks;
DROP TABLE IF EXISTS public.pilot_workspace;
COMMIT;
