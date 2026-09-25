BEGIN;

-- One vote per account per answer (docs/audit BACKLOG "vote dedupe").
-- Before this, any signed-in account could press 👎 three times and flag a
-- lawyer-verified answer, or drive a QA bank entry's quality_score to 0.1;
-- every press also rewrote legal_chunks and so bumped the corpus revision,
-- emptying the answer cache. A repeated vote is now a no-op and a changed
-- vote moves one count. Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.rag_answer_votes (
    target     text    NOT NULL CHECK (target IN ('chunk', 'qa_bank')),
    target_id  integer NOT NULL,
    voter_id   integer NOT NULL,
    helpful    boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (target, target_id, voter_id)
);

-- Server-side only, like the other RAG tables.
ALTER TABLE public.rag_answer_votes ENABLE ROW LEVEL SECURITY;

COMMIT;
