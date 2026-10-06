-- Tariffs v2 -> v1 CODE rollback, data kept (docs/tariffs-v2-rollback.md).
-- Run AFTER the previous release is deployed. Deletes nothing permanently:
-- the v1 code counts every tariff_usage row of an account as used, so the
-- v2 rows that were NOT delivered (released = refunded, reserved = still
-- running) are moved aside into tariff_usage_v2_hold, where
-- tariffs-v1-to-v2.sql puts them back on roll-forward. tariff_periods,
-- tariff_offers and the v2 columns stay (the v1 code ignores them); the
-- v1 code reads the plan from admins.tariff_*, which v2 kept in sync.
-- Idempotent.
BEGIN;
CREATE TABLE IF NOT EXISTS public.tariff_usage_v2_hold (LIKE public.tariff_usage INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.tariff_usage_v2_hold ADD COLUMN IF NOT EXISTS held_at timestamptz NOT NULL DEFAULT now();
INSERT INTO public.tariff_usage_v2_hold
SELECT u.*, now() FROM public.tariff_usage u
 WHERE u.status IN ('released', 'reserved')
   AND NOT EXISTS (SELECT 1 FROM public.tariff_usage_v2_hold h WHERE h.id = u.id);
DELETE FROM public.tariff_usage u
 WHERE u.status IN ('released', 'reserved')
   AND EXISTS (SELECT 1 FROM public.tariff_usage_v2_hold h WHERE h.id = u.id);
SELECT count(*) AS held_rows FROM public.tariff_usage_v2_hold;
COMMIT;
