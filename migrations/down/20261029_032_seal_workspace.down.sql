BEGIN;
-- Only for a database whose comments and messages are not sealed: a sealed
-- value is longer than the old limits and the checks below would refuse it.
ALTER TABLE public.workspace_task_comments DROP CONSTRAINT IF EXISTS workspace_task_comments_body_check;
ALTER TABLE public.workspace_task_comments ADD CONSTRAINT workspace_task_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000);
ALTER TABLE public.workspace_messages DROP CONSTRAINT IF EXISTS workspace_messages_body_check;
ALTER TABLE public.workspace_messages ADD CONSTRAINT workspace_messages_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000);
ALTER TABLE public.workspace_direct_messages DROP CONSTRAINT IF EXISTS workspace_direct_messages_body_check;
ALTER TABLE public.workspace_direct_messages ADD CONSTRAINT workspace_direct_messages_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000);
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS workspace_documents_storage_insert ON storage.objects';
    EXECUTE $p$CREATE POLICY workspace_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'workspace-documents' AND juristai_private.can_write_workspace(juristai_private.storage_workspace_id(name)))$p$;
  END IF;
END $$;
COMMIT;
