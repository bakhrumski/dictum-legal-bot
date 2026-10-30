-- Reverts migrations/20261028_019_matters.sql. The matters and their links
-- are lost with the tables (the chats and scans they point at stay). Scans
-- held for a matter keep their longer expires_at; shorten them first if
-- needed. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_019_matters.sql';
BEGIN;
DROP TABLE IF EXISTS public.matter_items;
DROP TABLE IF EXISTS public.matters;
COMMIT;
