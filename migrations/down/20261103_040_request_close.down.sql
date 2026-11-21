BEGIN;
ALTER TABLE public.requests DROP COLUMN IF EXISTS close_reason;
ALTER TABLE public.requests DROP COLUMN IF EXISTS closed_by;
ALTER TABLE public.requests DROP COLUMN IF EXISTS closed_at;
COMMIT;
