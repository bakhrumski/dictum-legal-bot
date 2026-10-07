-- Reverts migrations/20261006_015_document_scans.sql (the cached OCR texts
-- are deleted with it; the AI cost of those OCR calls stays in
-- llm_spend_log), then:
--   DELETE FROM public.schema_migrations WHERE version = '20261006_015_document_scans.sql';
BEGIN;
DROP TABLE IF EXISTS public.document_scans;
COMMIT;
