BEGIN;

-- CustDev pilot (2026-10-29, owner): a master adds an agent with a link
-- instead of picking from every staff account. The link is
-- t.me/<legal bot>?start=agi_<token>; only the token's sha256 is kept. One
-- use, 7 days, revocable. Accepting it in the bot makes (or keeps) the
-- Telegram's account a staff account (student) with an offer code.
-- src/sales/invites.js. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.agent_invites (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  note        TEXT CHECK (note IS NULL OR length(note) <= 120),
  created_by  INTEGER NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  used_by     INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_invites_created ON public.agent_invites (created_at DESC);

COMMIT;
