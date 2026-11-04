BEGIN;

-- Firm knowledge base K1b (docs/design/firma-bilim-bazasi.md): a Workspace's
-- shared library of templates, playbooks and chat skills. A shared item is the
-- firm's own copy (the author's personal one is untouched); owner and member
-- add, change and archive it, a viewer reads and uses it. `content` holds the
-- item's body as JSON text, sealed (AAD workspace_library.content:<ws>:<id>:<v>);
-- the activity-log trigger drops `content`, so the log keeps who / when / what
-- kind, never the text. Every change keeps the previous version.
-- src/workspace/library.js; Down: migrations/down/.
CREATE TABLE IF NOT EXISTS public.workspace_library_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind IN ('template', 'playbook', 'skill')),
  name         TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  content      TEXT        NOT NULL,
  version      INTEGER     NOT NULL DEFAULT 1,
  source_kind  TEXT,                                   -- where it was shared from: template / playbook / skill
  source_id    TEXT,                                   -- and its id: one item is shared to a Workspace once
  created_by   INTEGER     REFERENCES public.admins(id) ON DELETE SET NULL,
  updated_by   INTEGER     REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_library_source_uidx ON public.workspace_library_items (workspace_id, source_kind, source_id)
  WHERE source_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_library_ws_idx ON public.workspace_library_items (workspace_id, kind, updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.workspace_library_versions (
  item_id     UUID        NOT NULL REFERENCES public.workspace_library_items(id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL,
  name        TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  updated_by  INTEGER     REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, version)
);

DO $$
BEGIN
  IF to_regprocedure('juristai_private.log_workspace_activity()') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_library_items_log') THEN
    CREATE TRIGGER workspace_library_items_log
      AFTER INSERT OR UPDATE OR DELETE ON public.workspace_library_items
      FOR EACH ROW EXECUTE FUNCTION juristai_private.log_workspace_activity('library_item');
  END IF;
END $$;

COMMIT;
