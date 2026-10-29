BEGIN;

-- Data protection E5 (docs/design/shifrlash-1-bosqich.md §3.1, §3.4): task
-- comments, the room chat and direct messages are sealed with
-- src/privacy/crypto.js when DATA_KEYS is set. A sealed value is longer than
-- the text it holds, so the upper length limits move to the application
-- (src/workspace/routes.js checks 20 000 / 4 000 characters before sealing);
-- an empty body is still refused here. Files reach Storage only through the
-- server, which seals them: the members' direct INSERT policy on the
-- workspace-documents bucket is dropped (the page has uploaded through
-- /document-uploads since the Astra audit; only the preview mode used the
-- direct path). Down: migrations/down/.
ALTER TABLE public.workspace_task_comments DROP CONSTRAINT IF EXISTS workspace_task_comments_body_check;
ALTER TABLE public.workspace_task_comments ADD CONSTRAINT workspace_task_comments_body_check CHECK (char_length(btrim(body)) >= 1);
ALTER TABLE public.workspace_messages DROP CONSTRAINT IF EXISTS workspace_messages_body_check;
ALTER TABLE public.workspace_messages ADD CONSTRAINT workspace_messages_body_check CHECK (char_length(btrim(body)) >= 1);
ALTER TABLE public.workspace_direct_messages DROP CONSTRAINT IF EXISTS workspace_direct_messages_body_check;
ALTER TABLE public.workspace_direct_messages ADD CONSTRAINT workspace_direct_messages_body_check CHECK (char_length(btrim(body)) >= 1);

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS workspace_documents_storage_insert ON storage.objects';
  END IF;
END $$;

COMMIT;
