-- Reverts migrations/20261028_028_interview_recordings.sql: recordings, their
-- transcripts, consents and events are lost. Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_028_interview_recordings.sql';
BEGIN;
DROP TABLE IF EXISTS public.interview_events;
DROP TABLE IF EXISTS public.interview_transcripts;
DROP TABLE IF EXISTS public.interview_audio;
DROP TABLE IF EXISTS public.interview_recordings;
COMMIT;
