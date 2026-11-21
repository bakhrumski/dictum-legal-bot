BEGIN;

-- Data protection E2b (docs/design/shifrlash-1-bosqich.md §3.1): matters.summary
-- and matter_items.note are sealed with src/privacy/crypto.js when DATA_KEYS
-- is set. A sealed value is longer than the text it holds, so the length
-- limits move to the application (src/matters/store.js checks them before
-- sealing). The other E2b columns (tg_conversations, agent_runs,
-- agent_run_steps, service_orders, attorney_consultation_requests,
-- answer_feedback, agent_traces, chat_messages) have no such limit.
-- Down: migrations/down/.
ALTER TABLE public.matters DROP CONSTRAINT IF EXISTS matters_summary_check;
ALTER TABLE public.matter_items DROP CONSTRAINT IF EXISTS matter_items_note_check;

COMMIT;
