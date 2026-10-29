'use strict';

/**
 * Data protection E5 (docs/design/shifrlash-1-bosqich.md §3.1, §3.3, §3.4):
 * what people write in a Workspace - task comments, the room chat, direct
 * messages, Workspace AI questions / answers / context, document version text
 * - and every uploaded file are sealed with src/privacy/crypto.js when
 * DATA_KEYS is set. Each value is bound to its Workspace (and its task,
 * thread or document), so a sealed value moved to another place does not
 * open. Plain values from before pass through, so a column switches row by
 * row (scripts/seal-backfill.js seals the old ones).
 *
 * Realtime (postgres_changes) is a signal only: the pages re-read through
 * the API, which opens the values; a row the feed carries holds the sealed
 * text, never the plain one.
 */

const privacy = require('../privacy/crypto');

const aad = Object.freeze({
  comment: (ws, task) => `workspace_task_comments.body:${ws}:${task}`,
  message: ws => `workspace_messages.body:${ws}`,
  dm: ws => `workspace_direct_messages.body:${ws}`,
  aiMessage: (ws, thread) => `workspace_ai_messages.content:${ws}:${thread}`,
  aiRequest: ws => `workspace_ai_runs.request_text:${ws}`,
  aiContext: ws => `workspace_ai_runs.context_snapshot:${ws}`,
  versionText: (ws, doc) => `workspace_document_versions.content_text:${ws}:${doc}`,
  versionJson: (ws, doc) => `workspace_document_versions.content_json:${ws}:${doc}`,
  file: objectPath => `workspace-documents:${objectPath}`,
});

const sealText = (v, a) => (v == null || v === '' ? v : privacy.seal(String(v), a));
const openText = (v, a) => (v == null ? v : privacy.open(v, a));
// JSONB: the caller passes it to the query as JSON text, as before
const sealJsonText = (v, a) => (v == null ? v : JSON.stringify(privacy.sealJson(typeof v === 'string' ? JSON.parse(v) : v, a)));
const openJson = (v, a) => (v == null ? v : privacy.openJson(typeof v === 'string' ? JSON.parse(v) : v, a));

/** One row's sealed fields opened in place (a copy); ws / ids default to the row's own. */
function openComment(row, ws = row && row.workspace_id, task = row && row.task_id) {
  return row && row.body != null ? { ...row, body: openText(row.body, aad.comment(ws, task)) } : row;
}
function openMessage(row, ws = row && row.workspace_id) {
  return row && row.body != null ? { ...row, body: openText(row.body, aad.message(ws)) } : row;
}
function openDm(row, ws = row && row.workspace_id, field = 'body') {
  return row && row[field] != null ? { ...row, [field]: openText(row[field], aad.dm(ws)) } : row;
}
function openAiMessage(row, ws = row && row.workspace_id, thread = row && row.thread_id) {
  return row && row.content != null ? { ...row, content: openText(row.content, aad.aiMessage(ws, thread)) } : row;
}
function openAiRun(row, ws = row && row.workspace_id) {
  if (!row) return row;
  const out = { ...row };
  if (row.request_text != null) out.request_text = openText(row.request_text, aad.aiRequest(ws));
  if (row.context_snapshot != null) out.context_snapshot = openJson(row.context_snapshot, aad.aiContext(ws));
  return out;
}
function openVersion(row, ws = row && row.workspace_id, doc = row && row.document_id) {
  if (!row) return row;
  const out = { ...row };
  if (row.content_text != null) out.content_text = openText(row.content_text, aad.versionText(ws, doc));
  if (row.content_json != null) out.content_json = openJson(row.content_json, aad.versionJson(ws, doc));
  return out;
}

/** A file's bytes before Storage, and after it (a file stored plain before E5 comes back as it is). */
const sealFile = (buffer, objectPath) => (privacy.enabled() ? privacy.sealBytes(buffer, aad.file(objectPath)) : buffer);
const openFile = (buffer, objectPath) => privacy.openBytes(buffer, aad.file(objectPath));

module.exports = { aad, sealText, openText, sealJsonText, openJson, openComment, openMessage, openDm, openAiMessage, openAiRun, openVersion, sealFile, openFile };
