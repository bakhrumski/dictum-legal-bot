'use strict';

/**
 * Why an AI call happens (2026-10-07). AI runs only when the person asks a
 * question or confirms a service; attaching or reading a file never calls it.
 *
 * requireServiceConfirm: the document services (analysis, explanation,
 * legal opinion) run only with `confirmed: true` in the body - sent by the
 * dashboard after the person pressed "Davom etish" on the cost card (or the
 * scan card, for a held scan). Without it: 409 SERVICE_CONFIRM, no AI call,
 * no quota. The request's trigger goes into the usage ledger
 * (ai_requests.trigger): 'service_confirmed' or 'user_question'.
 */

const usageLedger = require('./usage-ledger');

const TRIGGERS = Object.freeze(['user_question', 'service_confirmed']);

function markTrigger(trigger) {
  if (TRIGGERS.includes(trigger)) usageLedger.annotate({ trigger });
}

function requireServiceConfirm(req, res, next) {
  if (req.body && req.body.confirmed === true) {
    markTrigger('service_confirmed');
    return next();
  }
  return res.status(409).json({ error: 'confirm', code: 'SERVICE_CONFIRM', quotaRefunded: true,
    message: "Xizmat tasdiqlanmagan: narx kartasida «Davom etish»ni bosing. AI ishga tushmadi, limit sarflanmadi." });
}

module.exports = { TRIGGERS, markTrigger, requireServiceConfirm };
