'use strict';

/**
 * K4 (docs/design/firma-bilim-bazasi.md): the firm's knowledge base as an
 * opt-in source of the ordinary web chat (/api/legal-chat). The person picks
 * a Workspace in the composer; the server checks that this account may read
 * it (viewer or above, the Workspace active) and takes its matching bands
 * with no AI (kb.forContext). Nothing is charged for it, no AI call is made
 * for it; the bands go into the prompt as "FIRMA HUJJATI (qonun emas)" and
 * into the final quote check only - the lex.uz cross-check, the claim guard
 * and the citator read the law as before. Not chosen = the chat as before.
 * WS_KB_CHAT=off stops it (WS_KB=off stops the whole knowledge base).
 */

const { requireWorkspaceAccess } = require('./authz');
const kb = require('./kb');

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(v || ''));
const chatOff = () => ['WS_KB', 'WS_KB_CHAT'].some(k => String(process.env[k] || '').toLowerCase() === 'off');

/**
 * @returns null when no firm source was asked for; otherwise
 *   { workspaceId, bands, reason } - reason null when bands were found,
 *   'off' | 'no_access' | 'none_found' otherwise. Never throws.
 */
async function firmForChat(db, { workspaceId, adminId, question } = {}) {
  if (workspaceId === undefined || workspaceId === null || workspaceId === '') return null;
  if (chatOff()) return { workspaceId: String(workspaceId), bands: [], reason: 'off' };
  // an id that is not one, or a Workspace this account may not read, reads the same: no access
  if (!isUuid(workspaceId) || !adminId) return { workspaceId: String(workspaceId).slice(0, 64), bands: [], reason: 'no_access' };
  try {
    await requireWorkspaceAccess(db, workspaceId, adminId, { minimumRole: 'viewer' });
  } catch (e) {
    if (!(e && (e.status || e.statusCode))) console.warn('[WS-KB chat] access:', e && e.message);
    return { workspaceId, bands: [], reason: 'no_access' };
  }
  const bands = await kb.createKnowledgeBase({ db }).forContext(workspaceId, question, { switchName: 'WS_KB_CHAT' });
  return { workspaceId, bands, reason: bands.length ? null : 'none_found' };
}

/** The prompt addition: the bands and the rule (a firm document is never a law). '' without bands. */
function promptBlock(firm) {
  if (!firm || !firm.bands || !firm.bands.length) return '';
  return '\n\n' + kb.contextBlock(firm.bands).trim() + kb.FIRM_RULE;
}

/** The quote-check sources: the law's chunks, then the firm's bands. */
function quoteSources(chunks, firm) {
  return firm && firm.bands && firm.bands.length ? (chunks || []).concat(kb.quoteChunks(firm.bands)) : (chunks || []);
}

/** What the reply says about the firm source: names, bands and pages - never the band text. */
function replyMeta(firm) {
  if (!firm) return null;
  return {
    workspaceId: firm.workspaceId,
    used: firm.bands.length,
    reason: firm.reason,
    bands: firm.bands.map(b => ({ documentId: b.documentId, n: b.n, name: b.name, label: b.label || null, page: b.page || null, partial: !!b.partial })),
  };
}

module.exports = { firmForChat, promptBlock, quoteSources, replyMeta };
