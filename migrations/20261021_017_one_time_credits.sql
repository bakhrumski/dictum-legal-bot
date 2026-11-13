BEGIN;

-- One-time services (2026-10-21, src/rag/one-time-products.js): units bought
-- one at a time (Telegram Stars today; Click/Payme later) outside a plan.
-- Each row is one purchase: the service and units it added, what was paid,
-- and the provider's charge id (unique, so a repeated payment notice cannot
-- add twice). They are spent only after the plan's own allowance for that
-- service is gone, through the same tariff_usage rows (period_id NULL,
-- meta.pool = 'one_time'); they never expire. A refunded purchase is marked,
-- not deleted. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.service_credits (
    id               bigserial PRIMARY KEY,
    subject          text        NOT NULL,
    admin_id         integer,
    telegram_user_id bigint,
    service          text        NOT NULL CHECK (service IN ('chat', 'analysis', 'opinion', 'draft', 'ocr')),
    units            integer     NOT NULL CHECK (units > 0),
    product          text        NOT NULL,
    price_uzs        integer,
    stars            integer,
    provider         text        NOT NULL,
    payment_ref      text        NOT NULL UNIQUE,
    refunded_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_credits_subject_idx ON public.service_credits (subject, service) WHERE refunded_at IS NULL;
CREATE INDEX IF NOT EXISTS tariff_usage_one_time_idx ON public.tariff_usage (subject, service) WHERE period_id IS NULL;

COMMIT;
