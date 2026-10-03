BEGIN;

-- lex.uz acts that answers needed but the corpus does not hold (owner,
-- 2026-10-03: grow the corpus from the questions people ask, not from a
-- guessed list). Every answer cross-checks lex.uz live; an act found there in
-- force whose lex.uz id is not in legal_chunks is counted here. No question
-- text is kept - only the act, how often it was needed, and the topic.
-- Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.corpus_demand (
    lex_id          text        PRIMARY KEY,           -- lex.uz document id, digits only
    url             text        NOT NULL,              -- Latin page, https://lex.uz/docs/-<id>
    title           text        NOT NULL,
    document_number text,
    legal_force     text,                              -- legal-force.js level key
    topic           text,                              -- topic of the latest question
    user_hits       integer     NOT NULL DEFAULT 0,
    eval_hits       integer     NOT NULL DEFAULT 0,
    status          text        NOT NULL DEFAULT 'wanted'
                    CHECK (status IN ('wanted', 'ingesting', 'ingested', 'error', 'dismissed')),
    note            text,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_seen       timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corpus_demand_wanted_idx
    ON public.corpus_demand (status, user_hits DESC, eval_hits DESC);

-- Server-side only, like the other RAG tables.
ALTER TABLE public.corpus_demand ENABLE ROW LEVEL SECURITY;

COMMIT;
