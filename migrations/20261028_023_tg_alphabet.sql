BEGIN;

-- The script the bot writes in, per Telegram chat (2026-10-28, owner: the
-- 2026 alphabet OʻRQ-1184 - ö ğ ş ç - by default, the old one on request;
-- src/bot/alphabet.js). No row = the new alphabet. A linked account's own
-- choice (user_profile.manual.alphabet) is read when the chat has none.
-- Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.tg_alphabet (
    chat_id     bigint PRIMARY KEY,
    alphabet    text        NOT NULL CHECK (alphabet IN ('new', 'old')),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tg_alphabet ENABLE ROW LEVEL SECURITY;

COMMIT;
