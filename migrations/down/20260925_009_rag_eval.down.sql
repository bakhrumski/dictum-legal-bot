-- Reverts migrations/20260925_009_rag_eval.sql. Run by hand, then delete the
-- ledger row so the up migration can be applied again if needed:
--   DELETE FROM public.schema_migrations WHERE version = '20260925_009_rag_eval.sql';
BEGIN;
DROP TABLE IF EXISTS public.rag_eval_runs;
DROP TABLE IF EXISTS public.rag_eval_cases;
COMMIT;
