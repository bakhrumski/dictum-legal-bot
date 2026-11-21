BEGIN;

-- Playbooks (2026-10-22, src/agents/workflows/playbook-review.js): a firm's
-- own rules a contract is checked against ("the liability cap is 100% of the
-- price", "disputes in Tashkent"). One row per playbook, owned by one
-- account; the rules are a JSON list of { id, title, requirement, severity,
-- preferred }. Built-in templates live in the code, not here. Down:
-- migrations/down/.
CREATE TABLE IF NOT EXISTS public.playbooks (
    id          bigserial PRIMARY KEY,
    admin_id    integer     NOT NULL,
    name        text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
    description text        NOT NULL DEFAULT '',
    rules       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playbooks_admin_idx ON public.playbooks (admin_id, updated_at DESC);

COMMIT;
