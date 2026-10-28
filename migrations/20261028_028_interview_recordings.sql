BEGIN;

-- CustDev pilot, stage 4 (2026-10-28, owner; src/interviews/): interview
-- recordings on a Matter.
--
--   interview_recordings   one recording with its consent: who consented, when
--                          and how (said at the start of the recording, or in
--                          writing) - no upload without them; the uploader
--                          confirmed the person was told it is transcribed and
--                          sent to AI providers (VoiceLab, DeepSeek) and the
--                          audio is deleted after INTERVIEW_AUDIO_DAYS (30)
--   interview_audio        the audio itself, apart so it can be deleted alone
--   interview_transcripts  the transcript as versions (1 = STT, then edits);
--                          it stays when the audio is deleted
--   interview_events       what happened (uploaded with consent, transcribed,
--                          summary, audio deleted - by whom or by retention)
--
-- Only the uploader and a master see a recording - not other members of a
-- Workspace the Matter is attached to. Down: migrations/down/.

CREATE TABLE IF NOT EXISTS public.interview_recordings (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id          uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
    owner_id           integer     NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    client_admin_id    integer     REFERENCES public.admins(id) ON DELETE SET NULL,
    title              text        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    consent_by         text        NOT NULL CHECK (char_length(btrim(consent_by)) BETWEEN 2 AND 160),
    consent_at         timestamptz NOT NULL,
    consent_method     text        NOT NULL CHECK (consent_method IN ('verbal_recording', 'written')),
    consent_note       text        CHECK (consent_note IS NULL OR char_length(consent_note) <= 1000),
    consent_ack        boolean     NOT NULL CHECK (consent_ack),
    audio_mime         text        NOT NULL,
    audio_bytes        integer     NOT NULL CHECK (audio_bytes > 0),
    duration_sec       integer     NOT NULL CHECK (duration_sec > 0),
    language           text        NOT NULL DEFAULT 'uz',
    status             text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'transcribing', 'transcribed', 'failed')),
    error              text,
    chunks             integer,
    transcribed_at     timestamptz,
    audio_delete_after timestamptz,
    audio_deleted_at   timestamptz,
    summary            jsonb,
    summary_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_recordings_matter_idx ON public.interview_recordings (matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interview_recordings_purge_idx ON public.interview_recordings (audio_delete_after) WHERE audio_deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.interview_audio (
    recording_id  uuid  PRIMARY KEY REFERENCES public.interview_recordings(id) ON DELETE CASCADE,
    data          bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS public.interview_transcripts (
    recording_id  uuid        NOT NULL REFERENCES public.interview_recordings(id) ON DELETE CASCADE,
    version       integer     NOT NULL CHECK (version > 0),
    body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 400000),
    source        text        NOT NULL CHECK (source IN ('stt', 'edit')),
    created_by    integer,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (recording_id, version)
);

CREATE TABLE IF NOT EXISTS public.interview_events (
    id            bigserial   PRIMARY KEY,
    recording_id  uuid        NOT NULL REFERENCES public.interview_recordings(id) ON DELETE CASCADE,
    event         text        NOT NULL,
    actor_id      integer,
    details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_events_rec_idx ON public.interview_events (recording_id, at);

ALTER TABLE public.interview_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_events ENABLE ROW LEVEL SECURITY;

COMMIT;
