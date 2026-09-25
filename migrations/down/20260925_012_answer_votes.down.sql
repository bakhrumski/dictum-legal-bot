-- Reverts migrations/20260925_012_answer_votes.sql, then:
--   DELETE FROM public.schema_migrations WHERE version = '20260925_012_answer_votes.sql';
BEGIN;
DROP TABLE IF EXISTS public.rag_answer_votes;
COMMIT;
