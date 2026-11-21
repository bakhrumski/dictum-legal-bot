-- Reverts migrations/20261029_029_document_library.sql: the library's text
-- documents are deleted (scans fall back to the 7-day cache). Sealed text
-- stays sealed - keep DATA_KEYS. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261029_029_document_library.sql';
BEGIN;
-- the interview limits come back only if no sealed (longer) value is there
ALTER TABLE public.interview_transcripts DROP CONSTRAINT IF EXISTS interview_transcripts_body_check;
ALTER TABLE public.interview_transcripts ADD CONSTRAINT interview_transcripts_body_check CHECK (char_length(body) >= 1 AND char_length(body) <= 400000) NOT VALID;
ALTER TABLE public.interview_recordings DROP CONSTRAINT IF EXISTS interview_recordings_consent_by_check;
ALTER TABLE public.interview_recordings ADD CONSTRAINT interview_recordings_consent_by_check CHECK (char_length(btrim(consent_by)) >= 2 AND char_length(btrim(consent_by)) <= 160) NOT VALID;
ALTER TABLE public.interview_recordings ADD CONSTRAINT interview_recordings_consent_note_check CHECK (consent_note IS NULL OR char_length(consent_note) <= 1000) NOT VALID;
DELETE FROM public.document_scans WHERE kind = 'text';
UPDATE public.document_scans SET expires_at = now() + interval '7 days' WHERE library;
DROP INDEX IF EXISTS public.document_scans_library_idx;
ALTER TABLE public.document_scans DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE public.document_scans DROP COLUMN IF EXISTS library;
ALTER TABLE public.document_scans DROP COLUMN IF EXISTS name;
ALTER TABLE public.document_scans DROP CONSTRAINT IF EXISTS document_scans_kind_check;
ALTER TABLE public.document_scans ADD CONSTRAINT document_scans_kind_check CHECK (kind IN ('pdf', 'image'));
COMMIT;
