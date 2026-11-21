-- Reverts migrations/20261028_020_agent_runs.sql. Run history and kept
-- results are lost with the tables; a run still live must be finished or
-- cancelled first (its reserved units are released by the worker, not by
-- this file). Turn the worker off first (AGENT_RUNS=off). Then:
--   DELETE FROM public.schema_migrations WHERE version = '20261028_020_agent_runs.sql';
BEGIN;
DROP TABLE IF EXISTS public.agent_run_steps;
DROP TABLE IF EXISTS public.agent_runs;
COMMIT;
