BEGIN;

-- Court practice S3 (docs/design/sud-amaliyoti.md): the citator. One row per
-- lex.uz act page the server has read (live search, citation hydration, the
-- corpus freshness run): whether lex.uz shows it in force, the date of its
-- last amending publication, and per article / band the latest change note
-- (date and amending act). Written from the page already downloaded, no AI,
-- no extra request; the page itself is never kept. Public legal metadata,
-- not personal data - not sealed. src/citator/; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.act_citator (
  lex_id        INTEGER PRIMARY KEY,          -- the page's lex.uz id without the sign (Latin -id = Cyrillic id)
  title         TEXT,
  in_force      BOOLEAN,                      -- NULL: lex.uz showed no status we can read
  status_label  TEXT,
  repealed_on   DATE,
  published_on  DATE,
  last_change   DATE,                          -- the latest amending publication on the page
  changes       INTEGER NOT NULL DEFAULT 0,
  units         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { "161": { kind, date, by, count } }
  unread_notes  INTEGER NOT NULL DEFAULT 0,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
