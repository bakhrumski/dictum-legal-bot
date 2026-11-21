-- Reverts migrations/20261028_021_voice_glossary.sql. Every account's own
-- speech glossary is lost with the table. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_021_voice_glossary.sql';
BEGIN;
DROP TABLE IF EXISTS public.voice_glossary;
COMMIT;
