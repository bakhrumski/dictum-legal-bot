BEGIN;

-- Agent runs (2026-10-28, docs/design/matter-va-agent-runs.md, section 3):
-- an agent workflow's state lives here, not in the Node process, so a run
-- outlives a deploy or a crash. A worker in the server process
-- (src/agents/runs/worker.js) takes a queued run - or a running one whose
-- lease ran out - with FOR UPDATE SKIP LOCKED, and each finished step is
-- written to agent_run_steps as a checkpoint; a resumed run skips the steps
-- already done. `input` (the user's documents and facts) and the steps'
-- `output` are kept only while the run is live and emptied when it ends;
-- `result` (what the page shows) is kept until `expires_at` (90 days), or
-- while a matter links it. `plan` and `price` are for the planner (PR-D).
-- Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.agent_runs (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id          integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    matter_id         uuid        REFERENCES public.matters(id) ON DELETE SET NULL,
    workflow          text        NOT NULL CHECK (char_length(workflow) BETWEEN 2 AND 60),
    channel           text        NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram', 'word')),
    status            text        NOT NULL DEFAULT 'queued' CHECK (status IN
                        ('queued', 'awaiting_approval', 'running', 'needs_input', 'done', 'failed', 'cancelled', 'budget')),
    input             jsonb,
    plan              jsonb,
    price             jsonb,
    jobs              jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(jobs) = 'array'),
    budget            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    spent             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    result            jsonb,
    error             text        CHECK (error IS NULL OR char_length(error) <= 300),
    cancel_requested  boolean     NOT NULL DEFAULT false,
    lease_owner       text,
    lease_until       timestamptz,
    attempts          integer     NOT NULL DEFAULT 0,
    request_id        uuid        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,
    expires_at        timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
CREATE INDEX IF NOT EXISTS agent_runs_queue_idx ON public.agent_runs (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS agent_runs_admin_idx ON public.agent_runs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_expiry_idx ON public.agent_runs (expires_at) WHERE result IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
    run_id       uuid        NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    step_id      text        NOT NULL CHECK (char_length(step_id) BETWEEN 1 AND 60),
    label        text        NOT NULL DEFAULT '',
    status       text        NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped', 'skipped_error')),
    output       jsonb,
    note         text,
    error        text,
    ms           integer,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    PRIMARY KEY (run_id, step_id)
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

COMMIT;
