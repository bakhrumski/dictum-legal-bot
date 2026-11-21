BEGIN;

-- Court practice S4 (docs/design/sud-amaliyoti.md): monitoring. For each
-- open matter, the lex.uz acts its chats and agent results link (ids and
-- article numbers only, never text) and the state of each act the owner was
-- last told about (or first seen in, which is no news); one Telegram digest
-- per person per Tashkent day; a person's own off switch. No AI.
-- src/monitor/; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.lex_monitor_watch (
  matter_id     UUID    NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  lex_id        INTEGER NOT NULL,
  units         TEXT[]  NOT NULL DEFAULT '{}',    -- articles / bands the matter cites
  seen_change   DATE,                              -- act_citator.last_change last reported (or first seen)
  seen_in_force BOOLEAN,
  seen_units    JSONB   NOT NULL DEFAULT '{}'::jsonb,  -- { "161": "2026-10-15" }
  seen_plenum   TIMESTAMPTZ,                       -- Plenum decisions fetched after this are news
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, lex_id)
);

CREATE TABLE IF NOT EXISTS public.lex_monitor_digests (
  admin_id  INTEGER NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
  day       DATE    NOT NULL,
  items     INTEGER NOT NULL DEFAULT 0,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, day)
);

CREATE TABLE IF NOT EXISTS public.lex_monitor_settings (
  admin_id   INTEGER PRIMARY KEY REFERENCES public.admins(id) ON DELETE CASCADE,
  off        BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
