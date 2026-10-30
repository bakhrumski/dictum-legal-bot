-- Reverts migrations/20261028_022_user_profile.sql. Every account's signals
-- and profile are lost with the tables (they hold no text; a profile is
-- rebuilt from new signals). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_022_user_profile.sql';
BEGIN;
DROP TABLE IF EXISTS public.user_profile;
DROP TABLE IF EXISTS public.user_signals;
COMMIT;
