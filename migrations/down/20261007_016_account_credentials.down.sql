-- Reverts migrations/20261007_016_account_credentials.sql. Logins and
-- passwords already set stay (they live in admins.username / password); only
-- the two markers go. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261007_016_account_credentials.sql';
BEGIN;
ALTER TABLE public.admins DROP COLUMN IF EXISTS created_by_master_id;
ALTER TABLE public.admins DROP COLUMN IF EXISTS credentials_set_at;
COMMIT;
