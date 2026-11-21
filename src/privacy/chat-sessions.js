'use strict';

/**
 * E6 (docs/design/shifrlash-1-bosqich.md §3.2): a web chat's messages
 * (`ai_chat_sessions.messages`, JSONB) are sealed, bound to their account
 * (AAD ai_chat_sessions.messages:<admin id>). The list reads only the
 * readable title - identifiers hidden by src/privacy/redact.js - and the
 * stored `message_count` (migration 033); it never opens the messages.
 * Appending a turn (the bot's history, src/services/telegram-history.js) is a
 * read-modify-write under FOR UPDATE in one transaction, since a sealed array
 * cannot be extended in SQL. An old plain row reads as it is.
 */

const privacy = require('./crypto');
const { redact, createMap } = require('./redact');

const aad = adminId => `ai_chat_sessions.messages:${adminId}`;

/** JSON text for the messages column (sealed when keys are set). */
const sealMessages = (messages, adminId) => JSON.stringify(privacy.sealJson(messages, aad(adminId)));
/** The messages array of a row (opened). */
function openMessages(value, adminId) {
  const v = typeof value === 'string' ? JSON.parse(value) : value;
  const out = privacy.openJson(v, aad(adminId));
  return Array.isArray(out) ? out : [];
}
const openRow = (row, adminId = row && row.admin_id) =>
  (row && row.messages != null ? { ...row, messages: openMessages(row.messages, adminId) } : row);

/** The readable title, identifiers hidden (a passport number in the first question stays out of the list). */
const listTitle = title => redact(String(title || ''), createMap()).slice(0, 200);

/** Append messages to a chat inside the caller's transaction (FOR UPDATE). */
async function appendMessages(db, { id, adminId, add }) {
  const row = (await db.query('SELECT messages FROM ai_chat_sessions WHERE id = $1 AND admin_id = $2 FOR UPDATE', [id, adminId])).rows[0];
  if (!row) return false;
  const next = openMessages(row.messages, adminId).concat(add);
  await db.query('UPDATE ai_chat_sessions SET messages = $2::jsonb, message_count = $3, updated_at = NOW() WHERE id = $1',
    [id, sealMessages(next, adminId), next.length]);
  return true;
}

module.exports = { aad, sealMessages, openMessages, openRow, listTitle, appendMessages };
