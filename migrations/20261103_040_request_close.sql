BEGIN;

-- The human queue (public/app/queue.js), 2026-11-03, owner: old requests that
-- will not be answered can be closed so they leave the open list - who closed
-- them, when and why (a short reason, never the client's text). Status
-- 'closed'; reopening sets it back to 'pending' and keeps who closed it last.
-- src/queue/bulk.js; Down: migrations/down/.
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS close_reason TEXT CHECK (close_reason IS NULL OR char_length(close_reason) <= 300);

COMMIT;
