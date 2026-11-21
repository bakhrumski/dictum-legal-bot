BEGIN;

-- Voice commands level 2, V5 (docs/design/ovozli-buyruqlar-2.md §6): one
-- row per command shown, run, sent as a question, cancelled or asked a
-- follow-up - codes only. No account, no text: the weekly view counts which
-- commands are used and how often one was a question taken for a command.
-- src/voice/command-events.js; Boshqaruv -> "Ovozli buyruqlar" (master only).
-- Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.voice_command_events (
  id         BIGSERIAL PRIMARY KEY,
  place      TEXT NOT NULL CHECK (place IN ('chat', 'matters', 'telegram')),
  kind       TEXT NOT NULL CHECK (kind IN ('open', 'matter', 'context', 'blocked')),
  action     TEXT NOT NULL CHECK (action ~ '^[a-z_]{1,40}$'),
  outcome    TEXT NOT NULL CHECK (outcome IN ('shown', 'run', 'ask', 'as_question', 'cancel')),
  via        TEXT NOT NULL CHECK (via IN ('voice', 'text')),
  lang       TEXT NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz', 'ru')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_command_events_created ON public.voice_command_events (created_at DESC);

COMMIT;
