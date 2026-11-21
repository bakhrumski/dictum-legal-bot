-- Reverts migrations/20261028_026_client_type.sql: client types are lost
-- (pilots already given stay). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_026_client_type.sql';
BEGIN;
ALTER TABLE public.pilot_requests DROP COLUMN IF EXISTS auto;
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_client_type_by_chk;
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_client_type_chk;
ALTER TABLE public.admins DROP COLUMN IF EXISTS client_type_at;
ALTER TABLE public.admins DROP COLUMN IF EXISTS client_type_by;
ALTER TABLE public.admins DROP COLUMN IF EXISTS client_type;
COMMIT;
