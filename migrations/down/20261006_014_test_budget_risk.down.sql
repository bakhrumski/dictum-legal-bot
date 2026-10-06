-- Reverts migrations/20261006_014_test_budget_risk.sql (drops the risk notes
-- of test-budget holds; the holds themselves stay), then:
--   DELETE FROM public.schema_migrations WHERE version = '20261006_014_test_budget_risk.sql';
BEGIN;
ALTER TABLE public.test_budget_holds DROP COLUMN IF EXISTS risk;
COMMIT;
