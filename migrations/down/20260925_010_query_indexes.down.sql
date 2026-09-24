-- Reverts migrations/20260925_010_query_indexes.sql, then:
--   DELETE FROM public.schema_migrations WHERE version = '20260925_010_query_indexes.sql';
BEGIN;
DROP INDEX IF EXISTS public.idx_llm_spend_user_ts;
DROP INDEX IF EXISTS public.idx_ai_analyses_request;
DROP INDEX IF EXISTS public.idx_ai_chat_sessions_admin;
COMMIT;
