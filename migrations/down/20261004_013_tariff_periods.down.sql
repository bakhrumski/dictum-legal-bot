-- DESTRUCTIVE. FOR A TEST DATABASE WITH NO TARIFFS V2 DATA ONLY.
--
-- Reverts migrations/20261004_013_tariff_periods.sql by dropping
-- tariff_offers and tariff_periods. Once offers or periods exist (any
-- production database after the v2 release), dropping them would destroy
-- what customers paid for and the audit of every discount - that is NOT a
-- rollback. Production rolls back the CODE and keeps the data:
-- docs/tariffs-v2-rollback.md (scripts/rollback/tariffs-v2-to-v1.sql).
-- This file refuses to run when either table holds a row.
--
-- After running it on a test database:
--   DELETE FROM public.schema_migrations WHERE version = '20261004_013_tariff_periods.sql';
-- The v1 code reads tariff_usage by admin_id and time only, so the added
-- columns can stay.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.tariff_offers') IS NOT NULL AND EXISTS (SELECT 1 FROM public.tariff_offers) THEN
    RAISE EXCEPTION 'tariff_offers has rows: this down migration is for an empty test database only (see docs/tariffs-v2-rollback.md)';
  END IF;
  IF to_regclass('public.tariff_periods') IS NOT NULL AND EXISTS (SELECT 1 FROM public.tariff_periods) THEN
    RAISE EXCEPTION 'tariff_periods has rows: this down migration is for an empty test database only (see docs/tariffs-v2-rollback.md)';
  END IF;
END $$;
DROP TABLE IF EXISTS public.test_budget_holds;
DROP TABLE IF EXISTS public.tariff_offers;
ALTER TABLE public.tariff_usage DROP CONSTRAINT IF EXISTS tariff_usage_period_id_fkey;
DROP TABLE IF EXISTS public.tariff_periods;
COMMIT;
