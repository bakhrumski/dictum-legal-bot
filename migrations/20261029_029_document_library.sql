BEGIN;

-- "Hujjatlarim" (2026-10-29, owner: "har bir yuklangan hujjat keyingi amallar
-- uchun qolishi kerak", kept until the person deletes it) and data
-- protection E2 (docs/design/shifrlash-1-bosqich.md).
--
-- document_scans becomes the person's document library: every document they
-- upload (a text Word/PDF read by /api/analyze/extract, or a scan read by
-- OCR) is one row per account and file (sha256), reused by every service
-- through its id (scanId) - no second upload, no second OCR.
--   library       true: kept until the person deletes it (expires_at is
--                 'infinity' and nothing shortens it); false: the old 7-day
--                 cache (rows from before this migration)
--   name          the file's name, shown and editable
--   kind 'text'   a document with a text layer (Word, text PDF)
--   last_used_at  when a service last read it
-- text is sealed with src/privacy/crypto.js (AAD document_scans.text:<admin>:<hash>)
-- when DATA_KEYS is set; older rows stay readable as they are.
-- Down: migrations/down/.
ALTER TABLE public.document_scans DROP CONSTRAINT IF EXISTS document_scans_kind_check;
ALTER TABLE public.document_scans ADD CONSTRAINT document_scans_kind_check CHECK (kind IN ('pdf', 'image', 'text'));
ALTER TABLE public.document_scans ADD COLUMN IF NOT EXISTS name text CHECK (name IS NULL OR char_length(name) <= 200);
ALTER TABLE public.document_scans ADD COLUMN IF NOT EXISTS library boolean NOT NULL DEFAULT false;
ALTER TABLE public.document_scans ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
CREATE INDEX IF NOT EXISTS document_scans_library_idx ON public.document_scans (admin_id, created_at DESC) WHERE library;

-- interview recordings (028) are sealed too: a sealed value is longer than the
-- text it holds, so the length limits move to the application (it checks them
-- before sealing); only "not empty" stays in the database
ALTER TABLE public.interview_recordings DROP CONSTRAINT IF EXISTS interview_recordings_consent_by_check;
ALTER TABLE public.interview_recordings ADD CONSTRAINT interview_recordings_consent_by_check CHECK (char_length(btrim(consent_by)) >= 2);
ALTER TABLE public.interview_recordings DROP CONSTRAINT IF EXISTS interview_recordings_consent_note_check;
ALTER TABLE public.interview_transcripts DROP CONSTRAINT IF EXISTS interview_transcripts_body_check;
ALTER TABLE public.interview_transcripts ADD CONSTRAINT interview_transcripts_body_check CHECK (char_length(body) >= 1);

COMMIT;
