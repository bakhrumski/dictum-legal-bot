-- Roll forward to tariffs v2 again after a code rollback, data kept
-- (docs/tariffs-v2-rollback.md). Run AFTER the v2 release is deployed again.
-- Puts the held rows back. A reservation that was running when the code was
-- rolled back was never delivered by v2, so it comes back released (its
-- units return to the customer). Rows go back only when they are in
-- tariff_usage again; the hold table is left for a person to drop once it is
-- empty. Idempotent.
BEGIN;
DO $$
DECLARE cols text;
BEGIN
  IF to_regclass('public.tariff_usage_v2_hold') IS NULL THEN
    RAISE NOTICE 'nothing held: no rollback happened';
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tariff_usage';
  EXECUTE format(
    'INSERT INTO public.tariff_usage (%1$s) SELECT %1$s FROM public.tariff_usage_v2_hold h
      WHERE NOT EXISTS (SELECT 1 FROM public.tariff_usage u WHERE u.id = h.id) ON CONFLICT DO NOTHING', cols);
  UPDATE public.tariff_usage
     SET status = 'released', finalized_at = COALESCE(finalized_at, now()), release_reason = 'code_rollback'
   WHERE status = 'reserved' AND id IN (SELECT id FROM public.tariff_usage_v2_hold);
  DELETE FROM public.tariff_usage_v2_hold h WHERE EXISTS (SELECT 1 FROM public.tariff_usage u WHERE u.id = h.id);
END $$;
SELECT CASE WHEN to_regclass('public.tariff_usage_v2_hold') IS NULL THEN 0
            ELSE (SELECT count(*) FROM public.tariff_usage_v2_hold) END AS still_held;
COMMIT;
