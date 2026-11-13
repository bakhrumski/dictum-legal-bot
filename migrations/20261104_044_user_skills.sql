BEGIN;

-- Firm knowledge base K1a (docs/design/firma-bilim-bazasi.md): a person's own
-- chat skills on the server, so they follow the account to every device
-- (they lived in one browser's localStorage). `client_id` keeps the id the
-- browser gave a skill, so moving them up once is idempotent. The
-- instructions are sealed (AAD user_skills.ins:<id>); the name is a label.
-- src/skills/; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.user_skills (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    INTEGER     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  client_id   TEXT        CHECK (client_id IS NULL OR char_length(client_id) <= 40),
  name        TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  ins         TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_skills_admin_idx ON public.user_skills (admin_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_skills_client_uidx ON public.user_skills (admin_id, client_id) WHERE client_id IS NOT NULL;

COMMIT;
