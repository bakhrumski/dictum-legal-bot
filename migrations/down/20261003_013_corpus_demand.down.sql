-- Reverts migrations/20261003_013_corpus_demand.sql, then:
--   DELETE FROM public.schema_migrations WHERE version = '20261003_013_corpus_demand.sql';
BEGIN;
DROP TABLE IF EXISTS public.corpus_demand;
COMMIT;
