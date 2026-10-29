'use strict';

/**
 * E6 (docs/design/shifrlash-1-bosqich.md §3.2): what a person asked and what
 * they were answered in the human queue (`requests.request_text`,
 * `response_text`) and the master's AI analysis archive
 * (`ai_analyses.request_text`) are sealed, with a blind index next to the
 * question (`request_bidx`, src/privacy/blind-index.js) for the staff search.
 *
 *   requests.request_text   AAD requests.request_text:<request id>
 *   requests.response_text  AAD requests.response_text:<request id>
 *   ai_analyses.request_text AAD ai_analyses.request_text:<admin id>
 *
 * A request's id comes from the INSERT, so its text is written in the same
 * transaction right after (sealRequestRow). Plain rows from before read as
 * they are (scripts/seal-backfill.js seals them and builds their index).
 */

const privacy = require('./crypto');
const bidx = require('./blind-index');

const aad = Object.freeze({
  request: id => `requests.request_text:${id}`,
  response: id => `requests.response_text:${id}`,
  analysis: adminId => `ai_analyses.request_text:${adminId}`,
});

const seal = (v, a) => (v == null || v === '' ? v : privacy.seal(String(v), a));
const open = (v, a) => (v == null ? v : privacy.open(v, a));

const sealRequest = (id, text) => seal(text, aad.request(id));
const sealResponse = (id, text) => seal(text, aad.response(id));
const sealAnalysis = (adminId, text) => seal(text, aad.analysis(adminId));

/**
 * One row's question / answer opened (a copy). id: the request id (default
 * row.id); fields: the row's own names when the SELECT aliased them.
 */
function openRequest(row, id = row && row.id, { request = 'request_text', response = 'response_text' } = {}) {
  if (!row) return row;
  const out = { ...row };
  if (request && row[request] != null) out[request] = open(row[request], aad.request(id));
  if (response && row[response] != null) out[response] = open(row[response], aad.response(id));
  return out;
}
const openAnalysis = (row, adminId = row && row.admin_id) =>
  (row && row.request_text != null ? { ...row, request_text: open(row.request_text, aad.analysis(adminId)) } : row);

/**
 * The question written to a request inside the caller's transaction, after
 * the INSERT that gave the id: sealed, with its index.
 */
async function writeRequestText(db, id, text) {
  await db.query('UPDATE requests SET request_text = $2, request_bidx = $3 WHERE id = $1',
    [id, sealRequest(id, text) || '', bidx.tokens(text)]);
}

/** A staff answer written to one request (sealed). Returns the rowCount of the UPDATE the caller builds. */
const responseParam = (id, text) => sealResponse(id, text);

/**
 * Search: the SQL piece and its params for "this question holds these words".
 * Plain rows still match by ILIKE; sealed ones by the index.
 */
function searchClause(column, bidxColumn, likeParam, tokensParam) {
  return `(${column} ILIKE ${likeParam} OR (${tokensParam}::text[] IS NOT NULL AND ${bidxColumn} @> ${tokensParam}::text[]))`;
}

module.exports = { aad, sealRequest, sealResponse, sealAnalysis, openRequest, openAnalysis, writeRequestText, responseParam, searchClause, bidx };
