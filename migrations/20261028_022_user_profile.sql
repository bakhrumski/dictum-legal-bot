BEGIN;

-- The adaptive account, PR A1 (2026-10-28, docs/design/adaptiv-akkaunt.md,
-- src/adaptive/). Two tables, both one account's own:
--
--   user_signals  what the person did, as a kind and a short code - never the
--                 text of a question, an answer or a document: a legal area
--                 code, a lex.uz act id and its title, the script of the
--                 question (latn / cyrl), the language, the service used, a
--                 built-in playbook key. Kept 180 days (USER_SIGNALS_DAYS).
--   user_profile  what JuristAI derives from them, with no AI: areas, acts,
--                 script, services, defaults; `manual` holds what the person
--                 set themselves (never overwritten); `paused` stops both
--                 recording and use.
--
-- Account deletion removes both. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.user_signals (
    id          bigserial PRIMARY KEY,
    admin_id    integer     NOT NULL,
    kind        text        NOT NULL CHECK (kind IN ('area', 'act', 'script', 'lang', 'service', 'playbook')),
    value       text        NOT NULL CHECK (char_length(value) BETWEEN 1 AND 40),
    label       text        NOT NULL DEFAULT '' CHECK (char_length(label) <= 160),
    channel     text        NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram', 'word')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_signals_admin_idx ON public.user_signals (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_signals_created_idx ON public.user_signals (created_at);

CREATE TABLE IF NOT EXISTS public.user_profile (
    admin_id     integer PRIMARY KEY,
    profile      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    manual       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    paused       boolean     NOT NULL DEFAULT false,
    signals      integer     NOT NULL DEFAULT 0,
    computed_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

COMMIT;
