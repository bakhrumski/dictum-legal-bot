BEGIN;

-- Data protection E6b (docs/design/shifrlash-1-bosqich.md §6): a staff
-- account (master, lawyer, student) opening another person's sealed data
-- leaves one row - who, whose, which table, which route, how many rows,
-- when. Never the text itself. Reading one's own data is not logged.
-- src/privacy/access-log.js; Boshqaruv -> "Kirish jurnali" (master only).
-- Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.data_access_log (
  id          BIGSERIAL PRIMARY KEY,
  viewer_id   INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  viewer_role TEXT NOT NULL CHECK (viewer_role IN ('master', 'lawyer', 'student')),
  owner_kind  TEXT NOT NULL CHECK (owner_kind IN ('account', 'telegram_user')),
  owner_id    BIGINT,
  table_name  TEXT NOT NULL CHECK (char_length(table_name) <= 60),
  route       TEXT CHECK (route IS NULL OR char_length(route) <= 120),
  rows_seen   INTEGER NOT NULL DEFAULT 1 CHECK (rows_seen >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_access_log_created ON public.data_access_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_access_log_owner ON public.data_access_log (owner_kind, owner_id, created_at DESC);

COMMIT;
