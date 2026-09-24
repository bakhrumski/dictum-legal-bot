BEGIN;

-- Retrieval evaluation (docs/audit, phase 2). Cases are frozen once built so
-- every run of a set measures the same questions; runs keep their summary and
-- per-case results for before/after comparison. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.rag_eval_cases (
    id                serial PRIMARY KEY,
    set_name          text NOT NULL,
    question          text NOT NULL,
    language          text NOT NULL DEFAULT 'uz',
    topic             text,
    expected_law      text,
    expected_doc_id   text,
    expected_articles text[] NOT NULL DEFAULT '{}',
    source_chunk_id   integer,
    origin            text NOT NULL DEFAULT 'synthetic',
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rag_eval_cases_set_idx ON public.rag_eval_cases (set_name);

CREATE TABLE IF NOT EXISTS public.rag_eval_runs (
    id          serial PRIMARY KEY,
    set_name    text NOT NULL,
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status      text NOT NULL DEFAULT 'running',
    summary     jsonb,
    results     jsonb,
    error       text,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS rag_eval_runs_started_idx ON public.rag_eval_runs (started_at DESC);

-- Server-side only: the API reaches these through the service role, never
-- through Supabase's public roles.
ALTER TABLE public.rag_eval_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_eval_runs ENABLE ROW LEVEL SECURITY;

COMMIT;
