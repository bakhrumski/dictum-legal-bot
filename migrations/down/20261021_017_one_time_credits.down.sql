-- Reverts migrations/20261021_017_one_time_credits.sql. Purchased one-time
-- units are lost with the table: export service_credits first if anything was
-- sold. Usage rows already written (period_id NULL) stay. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261021_017_one_time_credits.sql';
BEGIN;
DROP INDEX IF EXISTS public.tariff_usage_one_time_idx;
DROP TABLE IF EXISTS public.service_credits;
COMMIT;
