-- Reverts migrations/20261004_013_tariff_periods.sql, then:
--   DELETE FROM public.schema_migrations WHERE version = '20261004_013_tariff_periods.sql';
-- The v1 code reads tariff_usage by admin_id and time only, so the added
-- columns can stay; usage rows of unlinked Telegram users (admin_id NULL)
-- are ignored by it. tariff_periods is dropped: the v1 code keeps the plan
-- in admins.tariff_*, which v2 keeps in sync.
BEGIN;
ALTER TABLE public.tariff_usage DROP CONSTRAINT IF EXISTS tariff_usage_period_id_fkey;
DROP TABLE IF EXISTS public.tariff_periods;
COMMIT;
