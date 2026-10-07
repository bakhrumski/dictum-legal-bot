BEGIN;

-- Login and password as a second way into an account (2026-10-07,
-- src/auth/credentials.js). Two nullable columns, no data change:
--   credentials_set_at   when the account's owner set a login and password
--                        after a fresh confirmation (NULL: never; an account
--                        made through Telegram keeps a random password nobody
--                        knows until then);
--   created_by_master_id the master who created an ordinary test account
--                        (POST /api/admin/test-users); NULL for everyone else.
-- Logins stay in admins.username (unique); a change is checked
-- case-insensitively under an advisory lock in the code. Down: migrations/down/.
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS credentials_set_at timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS created_by_master_id integer;

COMMIT;
