BEGIN;

-- Court practice S1 (docs/design/sud-amaliyoti.md, owner 2026-11-03): the
-- Supreme Court (and the former Higher Economic Court) Plenum decisions in
-- force, read from lex.uz with no AI. One row a decision (by its Uzbek
-- edition's lex.uz id), its bands in each edition (uz Cyrillic as
-- published, lat lex.uz's Latin edition, ru) with the articles each band
-- names, and one row a sync run. Public legal texts, not personal data -
-- not sealed. Kept apart from legal_chunks: nothing in the answers uses
-- them until S2. src/plenum/; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.plenum_decisions (
  lex_id        INTEGER PRIMARY KEY,
  lat_lex_id    INTEGER,
  ru_lex_id     INTEGER,
  court         TEXT NOT NULL CHECK (court IN ('oliy', 'xojalik', 'qoshma')),
  number        TEXT,
  adopted_on    DATE,
  title_uz      TEXT,
  title_lat     TEXT,
  title_ru      TEXT,
  is_amendment  BOOLEAN NOT NULL DEFAULT false,
  in_force      BOOLEAN NOT NULL DEFAULT true,
  bands         INTEGER NOT NULL DEFAULT 0,
  chars         INTEGER NOT NULL DEFAULT 0,
  sha_uz        TEXT,
  sha_lat       TEXT,
  sha_ru        TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at    TIMESTAMPTZ,
  checked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_plenum_decisions_force ON public.plenum_decisions (in_force, adopted_on DESC);

CREATE TABLE IF NOT EXISTS public.plenum_bands (
  decision_id   INTEGER NOT NULL REFERENCES public.plenum_decisions(lex_id) ON DELETE CASCADE,
  lang          TEXT NOT NULL CHECK (lang IN ('uz', 'lat', 'ru')),
  n             INTEGER NOT NULL CHECK (n >= 0),
  text          TEXT NOT NULL,
  article_refs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (decision_id, lang, n)
);

CREATE TABLE IF NOT EXISTS public.plenum_sync_runs (
  id            SERIAL PRIMARY KEY,
  mode          TEXT NOT NULL CHECK (mode IN ('dry', 'apply')),
  started_by    INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  report        JSONB
);

COMMIT;
