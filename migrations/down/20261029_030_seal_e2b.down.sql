-- Reverts migrations/20261029_030_seal_e2b.sql. The limits come back NOT VALID:
-- sealed (longer) values already stored are left as they are. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261029_030_seal_e2b.sql';
BEGIN;
ALTER TABLE public.matters ADD CONSTRAINT matters_summary_check CHECK (char_length(summary) <= 4000) NOT VALID;
ALTER TABLE public.matter_items ADD CONSTRAINT matter_items_note_check CHECK (note IS NULL OR char_length(note) <= 8000) NOT VALID;
COMMIT;
