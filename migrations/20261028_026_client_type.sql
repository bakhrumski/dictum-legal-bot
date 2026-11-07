BEGIN;

-- Client type and the one-tap pilot (2026-10-28, owner).
--
-- admins.client_type is what the person does - lawyer (yurist / advokat),
-- accountant (buxgalter), hr (kadrlar), business (tadbirkor) or user
-- (anyone else). It ONLY adapts the platform (the home tasks, offers, later
-- the answer and search); it grants nothing. The access role (admins.role)
-- is unchanged: every client stays role 'user'; staff are master / student /
-- lawyer, and a staff lawyer is shown as "Ekspert". The person sets the type
-- (self), their CustDev agent or a master may correct it.
--
-- pilot_requests.auto: approved by the owner's standing rule (an agent's
-- client of a professional type, within PILOT_AUTO_TOTAL / PILOT_AUTO_PER_AGENT),
-- not by a master's button. client_type_at / _by say who set it last.
-- Down: migrations/down/.
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS client_type text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS client_type_by text;
ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS client_type_at timestamptz;
DO $$ BEGIN
    ALTER TABLE public.admins ADD CONSTRAINT admins_client_type_chk
        CHECK (client_type IS NULL OR client_type IN ('lawyer', 'accountant', 'hr', 'business', 'user'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE public.admins ADD CONSTRAINT admins_client_type_by_chk
        CHECK (client_type_by IS NULL OR client_type_by IN ('self', 'agent', 'master'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.pilot_requests ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

COMMIT;
