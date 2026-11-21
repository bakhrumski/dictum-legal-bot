-- Reverts migrations/20261022_018_playbooks.sql. The firms' own playbooks
-- are lost with the table: export them first. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261022_018_playbooks.sql';
BEGIN;
DROP TABLE IF EXISTS public.playbooks;
COMMIT;
