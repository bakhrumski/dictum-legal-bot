BEGIN;

-- Tariffs v2 (2026-10-04, docs/tariffs-v2.md): a one-time Sinov instead of a
-- free-forever plan, and 30-day paid periods with monthly service quotas
-- instead of unlimited chat with weekly allowances.
--
-- One ledger, extended: tariff_usage stays the single usage table (it already
-- holds every metered request); it gains the service, units, the period it is
-- charged to, a reserve / commit / release status, an idempotency key and the
-- actor / payer / Workspace of the work. tariff_periods records what each
-- person is entitled to and when - a trial grant, a paid 30-day period, or a
-- legacy subscription carried over with the rules it was sold with.
--
-- Subjects: 'a:<admins.id>' for an account, 't:<telegram user id>' for a
-- Telegram user not linked to an account. A person whose Telegram and web
-- accounts are linked has one trial between them (resolved in code).
-- Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.tariff_usage (
    id       serial PRIMARY KEY,
    admin_id integer,
    endpoint varchar(50),
    ts       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS credits integer DEFAULT 1;
-- a Telegram user without an account has usage too
ALTER TABLE public.tariff_usage ALTER COLUMN admin_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.tariff_periods (
    id             bigserial PRIMARY KEY,
    subject        text        NOT NULL CHECK (subject ~ '^(a|t):[0-9]+$'),
    admin_id       integer,
    plan           varchar(20) NOT NULL CHECK (plan IN ('sinov', 'silver', 'gold', 'platinum')),
    -- 'v2': monthly service quotas in limits; 'legacy_v1': the rules the
    -- subscription was sold with (unlimited chat + weekly allowances), kept
    -- until it ends - never silently reduced
    rules          varchar(12) NOT NULL CHECK (rules IN ('v2', 'legacy_v1')),
    source         varchar(12) NOT NULL CHECK (source IN ('trial', 'payment', 'admin', 'migration')),
    starts_at      timestamptz NOT NULL,
    -- NULL only for a trial: it does not expire, it is used up
    ends_at        timestamptz,
    limits         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- money, in whole so'm (integers: no float rounding):
    --   list_price_uzs  the catalogue price when bought
    --   discount_uzs    an individual offer's discount (tariff_offers)
    --   credit_uzs      value carried from a superseded period on upgrade
    --                   (not new cash)
    --   price_uzs       cash received for this period; NULL = not recorded
    --                   (a legacy grant made before payments were recorded)
    price_uzs      integer,
    list_price_uzs integer,
    discount_uzs   integer NOT NULL DEFAULT 0,
    credit_uzs     integer NOT NULL DEFAULT 0,
    offer_id       uuid,
    economics      jsonb,
    payment_ref    text,
    provider       varchar(30),
    status         varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'cancelled')),
    superseded_by  bigint REFERENCES public.tariff_periods(id),
    created_by     integer,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (source = 'trial' OR ends_at IS NOT NULL),
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- (repeatable on a database that has an earlier draft of this table)
ALTER TABLE public.tariff_periods ADD COLUMN IF NOT EXISTS list_price_uzs integer;
ALTER TABLE public.tariff_periods ADD COLUMN IF NOT EXISTS discount_uzs integer NOT NULL DEFAULT 0;
ALTER TABLE public.tariff_periods ADD COLUMN IF NOT EXISTS credit_uzs integer NOT NULL DEFAULT 0;
ALTER TABLE public.tariff_periods ADD COLUMN IF NOT EXISTS offer_id uuid;
ALTER TABLE public.tariff_periods ADD COLUMN IF NOT EXISTS economics jsonb;

-- One Sinov per subject, ever: a redeploy or a retry cannot grant another.
CREATE UNIQUE INDEX IF NOT EXISTS tariff_periods_one_trial_uidx
    ON public.tariff_periods (subject) WHERE source = 'trial';
-- A payment (or a migration row) grants one period, however often its
-- callback arrives.
CREATE UNIQUE INDEX IF NOT EXISTS tariff_periods_payment_ref_uidx
    ON public.tariff_periods (payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS tariff_periods_subject_idx
    ON public.tariff_periods (subject, starts_at DESC);

ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS service      varchar(16);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS status       varchar(10);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS period_id    bigint REFERENCES public.tariff_periods(id);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS subject      text;
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS job_key      text;
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS actor_id     integer;
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS channel      varchar(12);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS release_reason varchar(60);
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS meta         jsonb;
-- the AI usage ledger request (llm_spend_log.request_id) the job ran under:
-- joins a service unit to what its model calls actually cost
ALTER TABLE public.tariff_usage ADD COLUMN IF NOT EXISTS request_id   uuid;
-- NULL status = a row written before v2: it was a used unit
ALTER TABLE public.tariff_usage DROP CONSTRAINT IF EXISTS tariff_usage_status_check;
ALTER TABLE public.tariff_usage ADD CONSTRAINT tariff_usage_status_check
    CHECK (status IS NULL OR status IN ('reserved', 'committed', 'released'));
CREATE UNIQUE INDEX IF NOT EXISTS tariff_usage_job_key_uidx
    ON public.tariff_usage (job_key) WHERE job_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS tariff_usage_period_service_idx
    ON public.tariff_usage (period_id, service) WHERE period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tariff_usage_request_idx
    ON public.tariff_usage (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tariff_usage_reserved_idx
    ON public.tariff_usage (subject, ts) WHERE status = 'reserved';

-- Carry every running paid subscription over with the rules it was sold
-- with, until it ends. Idempotent: the payment_ref of a migration row is
-- fixed per account and subscription start.
-- What was actually paid for these was never recorded (payments were off,
-- D-2: a master granted them), so price_uzs stays NULL - unknown, not the
-- new catalogue price; list_price_uzs keeps the v1 list price for reference.
INSERT INTO public.tariff_periods
    (subject, admin_id, plan, rules, source, starts_at, ends_at, limits, price_uzs, list_price_uzs, payment_ref, provider)
SELECT 'a:' || a.id, a.id, a.tariff_plan, 'legacy_v1', 'migration',
       COALESCE(a.tariff_starts_at, a.tariff_expires_at - interval '30 days'),
       a.tariff_expires_at,
       '{}'::jsonb,
       NULL,
       CASE a.tariff_plan WHEN 'silver' THEN 199000 WHEN 'gold' THEN 399000 WHEN 'platinum' THEN 999000 END,
       'migration:legacy_v1:' || a.id || ':' || to_char(a.tariff_expires_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'),
       'migration'
  FROM public.admins a
 WHERE a.role = 'user'
   AND a.tariff_plan IN ('silver', 'gold', 'platinum')
   AND a.tariff_expires_at IS NOT NULL
   AND a.tariff_expires_at > now()
ON CONFLICT DO NOTHING;

ALTER TABLE public.tariff_periods ENABLE ROW LEVEL SECURITY;

-- Individual discount offers (2026-10-05): a master offers one user one
-- paid plan for one 30-day period at a discount, with a reason and an
-- expiry; redeemed once, by the payment that activates the period. The
-- quote (prices, cost estimate, model versions) is stored as it was made.
CREATE TABLE IF NOT EXISTS public.tariff_offers (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            integer     NOT NULL,
    plan               varchar(20) NOT NULL CHECK (plan IN ('silver', 'gold', 'platinum')),
    quota_version      text        NOT NULL,
    quotas             jsonb       NOT NULL,
    list_price_uzs     integer     NOT NULL CHECK (list_price_uzs > 0),
    discount_uzs       integer     NOT NULL CHECK (discount_uzs > 0),
    final_price_uzs    integer     NOT NULL CHECK (final_price_uzs > 0),
    min_price_uzs      integer     NOT NULL CHECK (min_price_uzs > 0),
    cost_estimate      jsonb       NOT NULL,
    cost_model_version text        NOT NULL,
    reason             text        NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
    created_by         integer     NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    status             varchar(10) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('draft', 'active', 'redeemed', 'expired', 'revoked')),
    payment_ref        text UNIQUE,
    period_id          bigint REFERENCES public.tariff_periods(id),
    redeemed_at        timestamptz,
    revoked_at         timestamptz,
    revoked_by         integer,
    revoke_reason      text,
    CHECK (final_price_uzs = list_price_uzs - discount_uzs),
    CHECK (final_price_uzs >= min_price_uzs),
    CHECK (expires_at > created_at),
    CHECK (status <> 'redeemed' OR (payment_ref IS NOT NULL AND period_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tariff_offers_user_idx ON public.tariff_offers (user_id, created_at DESC);
ALTER TABLE public.tariff_offers ENABLE ROW LEVEL SECURITY;

COMMIT;
