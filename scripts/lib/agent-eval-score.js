'use strict';

/**
 * Scores one planned agent run against its case (2026-10-28, roadmap PR-G,
 * docs/quality/agent-eval.md). No AI, no network: the checks read the run's
 * reply as the server gave it. A check passes, fails, or is "n/a" (the case
 * expects nothing there). A found act or phrase says the words are there,
 * not that the answer is legally right - that is the lawyer's review.
 *
 *   delivered     the run ended done with an answer
 *   asked         the run asked the person (ask_user) iff the case expects it
 *   acts          every expected act is among the run's sources (title words
 *                 or the lex.uz document id)
 *   structure     the answer has Tahlil and Xulosa
 *   must_say      every expected phrase (a regex, "a|b" for either) is in the answer
 *   must_not_say  no forbidden phrase is in the answer
 *   verification  the server's check: verified / no_claims pass, partial warns,
 *                 unverified or none fails
 */

const norm = s => String(s || '').toLocaleLowerCase('uz')
  .replace(/[ʻʼ‘’`´]/gu, "'")
  .replace(/\s+/gu, ' ');

function docIdOf(url = '') {
  const m = String(url || '').match(/lex\.uz\/(?:[a-z]{2}\/)?(?:docs|acts)\/-?(\d+)/iu);
  return m ? m[1] : '';
}

function actFound(act, sources = []) {
  const ids = new Set(sources.map(s => docIdOf(s.url)).filter(Boolean));
  if ((act.docIds || []).some(id => ids.has(String(id)))) return true;
  const titles = sources.map(s => norm(s.act));
  return (act.match || []).some(m => titles.some(t => t.includes(norm(m))));
}

/**
 * case: { expect: { acts, mustSay, mustNotSay, askUser } }
 * run:  { status, asked (bool, the runner saw needs_input), body: { answer, sources, verification } }
 * Returns { checks: [{ id, result: 'pass'|'fail'|'warn'|'n/a', note }], passed, failed, warned }.
 */
function scoreRun(c, run) {
  const e = c.expect || {};
  const body = (run && run.body) || {};
  const answer = norm(body.answer);
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const checks = [];
  const add = (id, result, note = '') => checks.push({ id, result, note });

  add('delivered', run && run.status === 'done' && answer ? 'pass' : 'fail', run ? `status ${run.status}` : 'no run');
  add('asked', !!run && !!run.asked === !!e.askUser ? 'pass' : 'fail', e.askUser ? 'savol kutilgan edi' : 'savol kutilmagan edi');

  const acts = e.acts || [];
  if (!acts.length) add('acts', 'n/a');
  else {
    const missing = acts.filter(a => !actFound(a, sources)).map(a => a.label);
    add('acts', missing.length ? 'fail' : 'pass', missing.length ? `topilmadi: ${missing.join(', ')}` : `${acts.length} ta akt`);
  }

  if (!answer) add('structure', 'fail', "javob yo'q");
  else add('structure', /tahlil/u.test(answer) && /xulosa/u.test(answer) ? 'pass' : 'fail');

  const say = e.mustSay || [];
  if (!say.length) add('must_say', 'n/a');
  else {
    const missing = say.filter(p => !new RegExp(norm(p), 'u').test(answer));
    add('must_say', missing.length ? 'fail' : 'pass', missing.length ? `yo'q: ${missing.join('; ')}` : '');
  }
  const not = e.mustNotSay || [];
  if (!not.length) add('must_not_say', 'n/a');
  else {
    const found = not.filter(p => new RegExp(norm(p), 'u').test(answer));
    add('must_not_say', found.length ? 'fail' : 'pass', found.length ? `bor: ${found.join('; ')}` : '');
  }

  const v = body.verification && body.verification.status;
  add('verification', v === 'verified' || v === 'no_claims' ? 'pass' : (v === 'partial' ? 'warn' : 'fail'), v || "tekshiruv yo'q");

  const count = r => checks.filter(x => x.result === r).length;
  return { checks, passed: count('pass'), failed: count('fail'), warned: count('warn') };
}

/** Totals over scored cases; reviewed and unreviewed cases apart (only reviewed ones speak for quality). */
function summarize(rows = []) {
  const group = list => {
    const byCheck = {};
    for (const r of list) for (const ch of r.score.checks) {
      const s = byCheck[ch.id] || (byCheck[ch.id] = { pass: 0, fail: 0, warn: 0, 'n/a': 0 });
      s[ch.result] += 1;
    }
    return { cases: list.length, allPassed: list.filter(r => r.score.failed === 0).length, byCheck };
  };
  return { reviewed: group(rows.filter(r => r.reviewed)), unreviewed: group(rows.filter(r => !r.reviewed)) };
}

module.exports = { scoreRun, summarize, actFound, docIdOf };
