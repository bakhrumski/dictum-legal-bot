BEGIN;

-- Indexes for the per-user lookups that scan whole tables today
-- (docs/audit/findings/reliability.md). Down: migrations/down/.
-- Plain CREATE INDEX (the runner wraps each file in a transaction, so not
-- CONCURRENTLY); these tables are small enough that the brief write lock
-- during a deploy is acceptable. Each table is created lazily by the app,
-- so an index is only added where its table already exists.
DO $$
BEGIN
  -- Margin report and per-user spend: WHERE user_id = ? AND ts >= ?
  IF to_regclass('public.llm_spend_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_llm_spend_user_ts ON public.llm_spend_log (user_id, ts DESC);
  END IF;
  -- Request detail: analyses of one request, newest first.
  IF to_regclass('public.ai_analyses') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ai_analyses_request ON public.ai_analyses (request_id, created_at DESC);
  END IF;
  -- A user's chat history list.
  IF to_regclass('public.ai_chat_sessions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_admin ON public.ai_chat_sessions (admin_id, updated_at DESC);
  END IF;
END $$;

COMMIT;
