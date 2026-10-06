BEGIN;

-- Pilot budget accuracy (2026-10-06): a test-budget hold records, besides
-- what the request committed, its estimated-risk calls (calls with no
-- proven cost bound, run only in the 'estimated' budget mode) and any call
-- whose real cost came out above its reserved bound. Additive only; the
-- previous release ignores the column. Down: migrations/down/.
ALTER TABLE public.test_budget_holds ADD COLUMN IF NOT EXISTS risk jsonb;

COMMIT;
