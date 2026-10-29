BEGIN;

-- Data protection E6 (docs/design/shifrlash-1-bosqich.md §3.2, §9 answer 1):
-- the human queue's questions (requests.request_text) and the master's AI
-- analysis archive (ai_analyses.request_text) are sealed by the application
-- (src/privacy/request-text.js); their staff search moves from ILIKE to a
-- blind index - the keyed hashes of the question's word roots
-- (src/privacy/blind-index.js). The chat sessions get a message count, read
-- by the list now that the messages column may hold a sealed object.
-- Down: migrations/down/.
DO $$
BEGIN
  IF to_regclass('public.requests') IS NOT NULL THEN
    ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS request_bidx text[];
    CREATE INDEX IF NOT EXISTS idx_requests_request_bidx ON public.requests USING gin (request_bidx);
  END IF;
  IF to_regclass('public.ai_analyses') IS NOT NULL THEN
    ALTER TABLE public.ai_analyses ADD COLUMN IF NOT EXISTS request_bidx text[];
    CREATE INDEX IF NOT EXISTS idx_ai_analyses_request_bidx ON public.ai_analyses USING gin (request_bidx);
  END IF;
  IF to_regclass('public.ai_chat_sessions') IS NOT NULL THEN
    ALTER TABLE public.ai_chat_sessions ADD COLUMN IF NOT EXISTS message_count integer;
  END IF;
END $$;

COMMIT;
