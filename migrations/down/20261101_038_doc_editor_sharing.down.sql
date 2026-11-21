BEGIN;
DROP TABLE IF EXISTS public.doc_editor_invites;
DROP TABLE IF EXISTS public.doc_editor_members;
ALTER TABLE public.doc_editor_documents DROP COLUMN IF EXISTS ystate;
COMMIT;
