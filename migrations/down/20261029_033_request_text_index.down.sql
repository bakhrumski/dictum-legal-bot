BEGIN;
DROP INDEX IF EXISTS public.idx_requests_request_bidx;
DROP INDEX IF EXISTS public.idx_ai_analyses_request_bidx;
ALTER TABLE IF EXISTS public.requests DROP COLUMN IF EXISTS request_bidx;
ALTER TABLE IF EXISTS public.ai_analyses DROP COLUMN IF EXISTS request_bidx;
ALTER TABLE IF EXISTS public.ai_chat_sessions DROP COLUMN IF EXISTS message_count;
COMMIT;
