'use strict';

/**
 * One shared budget for an evaluation run (2026-10-11), shared by the A/B
 * screening (scripts/explain-ab.js) and the provider evaluation
 * (scripts/provider-eval.js). No network, no database, no provider here:
 * only the money arithmetic, so both runners keep the same rules.
 *
 *   take()   BEFORE a call: the call's bound is checked and taken in one
 *            synchronous step (no await between), so parallel calls cannot
 *            pass on the same money; a halted budget takes nothing.
 *   settle() AFTER a call:
 *            - no known cost (no usage, no provider cost, no credits): the
 *              reserve stays held and the cost is "unknown", never $0;
 *            - a known cost: the reserve is replaced by the larger known
 *              figure (list-price dollars, provider-reported dollars, credits
 *              at their dollar rate - recorded apart, never added together);
 *            - a known cost above its reserve halts the budget: nothing new
 *              starts; calls already running finish and are settled.
 *   halt()   stops new calls for another reason (e.g. a transport whose
 *            outcome is unknown).
 */

const newBudget = usd => ({ left: usd, spent: 0, listUsd: 0, credits: 0, providerUsd: 0, reservedNow: 0, heldUnknown: 0, unknownCalls: 0, halted: false, haltedBy: null });

/** Takes `usd` from the budget, or returns the reason it cannot (nothing taken). */
function take(budget, usd) {
  if (budget.halted) return { ok: false, reason: 'halted' };
  if (!(Number.isFinite(usd) && usd > 0)) return { ok: false, reason: 'no bound' };
  if (budget.left < usd) return { ok: false, reason: 'budget' };
  budget.left -= usd;
  budget.reservedNow += usd;
  return { ok: true, usd };
}

/**
 * Settles one call that reached the provider. `costs` holds what is known:
 * { listUsd, providerUsd, creditUsd } (null = not known). Returns
 * { costStatus: 'unknown' | 'known' | 'over_reserve', settledUsd }.
 */
function settle(budget, reservedUsd, { listUsd = null, providerUsd = null, creditUsd = null, credits = null } = {}, haltInfo = {}) {
  budget.reservedNow -= reservedUsd;
  const known = [listUsd, providerUsd, creditUsd].filter(x => x != null && Number.isFinite(x));
  budget.listUsd += listUsd || 0;
  budget.providerUsd += providerUsd || 0;
  budget.credits += credits || 0;
  if (!known.length) {
    budget.heldUnknown += reservedUsd;
    budget.unknownCalls += 1;
    return { costStatus: 'unknown', settledUsd: null };
  }
  const settled = Math.max(...known);
  budget.left += reservedUsd - settled;
  budget.spent += settled;
  if (settled > reservedUsd) {
    halt(budget, { ...haltInfo, reservedUsd, settledUsd: settled, reason: 'a cost went above its reserve' });
    return { costStatus: 'over_reserve', settledUsd: settled };
  }
  return { costStatus: 'known', settledUsd: settled };
}

/** Gives a reserve back whole: only for a call that never reached the provider. */
function release(budget, reservedUsd) {
  budget.reservedNow -= reservedUsd;
  budget.left += reservedUsd;
}

function halt(budget, by) {
  if (!budget.halted) { budget.halted = true; budget.haltedBy = by || null; }
}

module.exports = { newBudget, take, settle, release, halt };
