BEGIN;

-- Personal speech glossary (2026-10-28, owner: "glossary har bir user uchun
-- individual alohida bo'lishi kerak"; src/voice/user-glossary.js). One row a
-- word of one account:
--   kind 'fix'   heard -> term: the speech engine heard `heard`, the person
--                meant `term` (learned when they pick a suggestion or correct
--                the heard text, or added by hand); offered first next time
--   kind 'word'  a word of their own (a client's name, a firm's term): never
--                flagged as mis-heard; a mis-heard form of it is suggested
-- Nothing here is replaced by itself - it only orders the suggestions.
-- At most 500 rows an account (enforced in code). Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.voice_glossary (
    id          bigserial PRIMARY KEY,
    admin_id    integer     NOT NULL,
    kind        text        NOT NULL CHECK (kind IN ('fix', 'word')),
    heard       text        NOT NULL DEFAULT '' CHECK (char_length(heard) <= 80),
    term        text        NOT NULL CHECK (char_length(btrim(term)) BETWEEN 2 AND 80),
    source      text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'learned')),
    uses        integer     NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_glossary_uniq ON public.voice_glossary (admin_id, kind, lower(heard), lower(term));
CREATE INDEX IF NOT EXISTS voice_glossary_admin_idx ON public.voice_glossary (admin_id, updated_at DESC);

COMMIT;
