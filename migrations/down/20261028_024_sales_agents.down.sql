-- Reverts migrations/20261028_024_sales_agents.sql: agent codes, referrals,
-- demo links and pilot requests are lost (test entitlements already given
-- stay in tariff_periods). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_024_sales_agents.sql';
BEGIN;
DROP TABLE IF EXISTS public.pilot_requests;
DROP TABLE IF EXISTS public.referral_pending;
DROP INDEX IF EXISTS public.admins_referred_by_idx;
DROP INDEX IF EXISTS public.admins_sales_agent_code_uniq;
ALTER TABLE public.admins DROP COLUMN IF EXISTS demo_for_agent_id;
ALTER TABLE public.admins DROP COLUMN IF EXISTS referral_channel;
ALTER TABLE public.admins DROP COLUMN IF EXISTS referred_at;
ALTER TABLE public.admins DROP COLUMN IF EXISTS referred_by_agent_id;
ALTER TABLE public.admins DROP COLUMN IF EXISTS sales_agent_code;
COMMIT;
