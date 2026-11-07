BEGIN;

-- CustDev pilot, stage 2 (2026-10-28, src/sales/agents.js): student lawyers
-- bring clients to a 14-day pilot. No new role:
--
--   admins.sales_agent_code      a staff account's offer code (unique, random);
--                                only a master gives or takes it
--   admins.referred_by_agent_id  the FIRST agent a client came through - set
--                                once, never replaced
--   admins.demo_for_agent_id     an ordinary account the master opened as an
--                                agent's demo (its spend is reported apart)
--   referral_pending             a Telegram user who opened ref_<code> before
--                                having an account; claimed when one is made
--   pilot_requests               one per referred client: pending until a
--                                master approves (a 14-day test entitlement)
--                                or declines
-- Down: migrations/down/.
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS sales_agent_code text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS referred_by_agent_id integer;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS referred_at timestamptz;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS referral_channel text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS demo_for_agent_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS admins_sales_agent_code_uniq ON public.admins (sales_agent_code) WHERE sales_agent_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS admins_referred_by_idx ON public.admins (referred_by_agent_id) WHERE referred_by_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referral_pending (
    telegram_user_id bigint PRIMARY KEY,
    agent_id         integer     NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_requests (
    id          bigserial PRIMARY KEY,
    admin_id    integer     NOT NULL UNIQUE,
    agent_id    integer     NOT NULL,
    status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    decided_by  integer,
    decided_at  timestamptz,
    period_id   bigint,
    note        text        NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS pilot_requests_status_idx ON public.pilot_requests (status, created_at DESC);

ALTER TABLE public.referral_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_requests ENABLE ROW LEVEL SECURITY;

COMMIT;
