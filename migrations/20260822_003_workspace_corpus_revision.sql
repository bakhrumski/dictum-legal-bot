BEGIN;

-- Workspace AI reuse must be invalidated whenever the legal corpus changes.
-- The transaction id guard makes a bulk ingest bump the revision only once per
-- transaction, even when that transaction writes thousands of chunks.
CREATE TABLE IF NOT EXISTS juristai_private.legal_corpus_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    last_transaction bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO juristai_private.legal_corpus_state (singleton, revision)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION juristai_private.bump_legal_corpus_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_transaction bigint := txid_current();
BEGIN
    INSERT INTO juristai_private.legal_corpus_state (
        singleton,
        revision,
        last_transaction,
        updated_at
    )
    VALUES (true, 1, current_transaction, now())
    ON CONFLICT (singleton) DO UPDATE
       SET revision = juristai_private.legal_corpus_state.revision + 1,
           last_transaction = EXCLUDED.last_transaction,
           updated_at = now()
     WHERE juristai_private.legal_corpus_state.last_transaction
           IS DISTINCT FROM EXCLUDED.last_transaction;

    RETURN NULL;
END;
$$;

-- legal_chunks is initialized before versioned migrations during normal app
-- startup. Keep this migration safe for a standalone migration runner too.
DO $$
BEGIN
    IF to_regclass('public.legal_chunks') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS legal_chunks_workspace_revision
            ON public.legal_chunks;
        CREATE TRIGGER legal_chunks_workspace_revision
        AFTER INSERT OR UPDATE OR DELETE ON public.legal_chunks
        FOR EACH STATEMENT
        EXECUTE FUNCTION juristai_private.bump_legal_corpus_revision();
    ELSE
        RAISE NOTICE 'legal_chunks not found; initLegalCorpus will install the revision trigger';
    END IF;
END;
$$;

REVOKE ALL ON TABLE juristai_private.legal_corpus_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION juristai_private.bump_legal_corpus_revision() FROM PUBLIC, anon, authenticated;

COMMIT;
