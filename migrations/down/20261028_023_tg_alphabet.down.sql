-- Reverts migrations/20261028_023_tg_alphabet.sql: every chat goes back to
-- the default (the new alphabet). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_023_tg_alphabet.sql';
BEGIN;
DROP TABLE IF EXISTS public.tg_alphabet;
COMMIT;
