#!/usr/bin/env node
'use strict';

/**
 * First A/B screening of the document explanation (2026-10-11): 3 documents
 * x 4 variants = 12 answers. DRY RUN BY DEFAULT - no AI call, nothing sent.
 *
 *   A  the saved digest      + the current final model (aisha-comet)
 *   B  the SAME saved digest + one stronger final model
 *   C  the full text         + the current final model
 *   D  the full text         + the same stronger model
 *
 * Per document the digest is made ONCE (by the current pipeline) and reused
 * unchanged by A and B. All four variants of a document get the same task
 * (explainSystem), the same helper material picked from the document (key
 * lines with their source ids, contradiction candidates) and the same output
 * cap (EXPLAIN_MAX_TOKENS); the key lines are picked and sent whole the same
 * way in every variant (sameHelpers: no "[matnda]/[dayjestda]" references,
 * which would differ by input form). What the input form still forces is
 * printed, not hidden: C/D carry the whole text instead of the digest, and
 * the note at the top of the prompt says which.
 * A parameter a model does not take (e.g. temperature) is not forced equal:
 * the difference is recorded.
 *
 * Dry run (default): builds the real prompts with a stub model and prints,
 * per document and variant, the measured prompt size, the estimated tokens,
 * the cost at the list price, the reserve (a bound per call from the price
 * table: UTF-8 input bound + the output cap, one retry each) and the time.
 * ESTIMATE / MEASURED / UNKNOWN are kept apart; a reserve is not a
 * guaranteed maximum (VoiceLab bills in credits whose rate per token is not
 * confirmed; a price missing from the table is "unknown", never $0).
 *
 *   node scripts/explain-ab.js --docs a.docx,b.txt,c.docx
 *   node scripts/explain-ab.js --docs a.docx,b.txt,c.docx --strong voicelab/aisha-halo
 *
 * Live (only with the owner's approval): every one of these is needed -
 *   EXPLAIN_AB_LIVE=yes  --live  --budget-usd N  --out <dir outside the repo>
 * The whole reserve must fit N before the first call; each call then
 * reserves its own bound from what is left and is not made if it does not
 * fit; the actual cost replaces the bound after the call. Answers, prompts'
 * hashes, usage and a blind set (answers under random codes, the key apart)
 * go to --out only - never to the repository. Live calls go to VoiceLab
 * models only (voicelab/<id>); another provider is refused here.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ex = require('../src/rag/document-explain');
const pricing = require('../src/ai/model-pricing');

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = n => args.includes(n);
const REPO = path.resolve(__dirname, '..');

const BASE = arg('--base', 'voicelab/aisha-comet');
const STRONG = arg('--strong', 'voicelab/aisha-halo');
const CAP = ex.EXPLAIN_MAX_TOKENS;
const RETRIES = Number(arg('--retries', 1));
// MEASURED, per request - never merged into one figure (each from ONE
// document's live run on aisha-comet; not an independent calibration):
//   R1 5c3c052e-0571-4c70-a6e6-361982965679 (2026-10-09, 51 398-char DOCX):
//      final call 14 475 in / 1 737 out, 37.5 s; prompt rebuilt from that
//      run's trace = 41 919 chars -> 0.345 in-token/char; digest part 1:
//      1 540 out in 30.0 s (~52 tok/s); 12 calls, 90.9 s in all.
//   R2 504b2e59-5fe4-4727-a88e-7fd000f77b1d (2026-10-11, 54 260-char DOCX):
//      final call 20 047 in / 1 947 out, 47.7 s; prompt rebuilt from that
//      run's trace (code at 731d28d) = 54 576 chars -> 0.367 in-token/char;
//      13 calls, 95.8 s in all.
// The plan uses R2 (the latest, the same prompt shape as now); R1 is shown
// for reference. Digest speed is known from R1 only.
const RUNS = {
  R1: { id: '5c3c052e-0571-4c70-a6e6-361982965679', inPerChar: 0.345, answerTokens: 1737, answerSeconds: 37.5, digestTokPerS: 52, serviceCalls: 12, serviceSeconds: 90.9 },
  R2: { id: '504b2e59-5fe4-4727-a88e-7fd000f77b1d', inPerChar: 0.367, answerTokens: 1947, answerSeconds: 47.7, digestTokPerS: null, serviceCalls: 13, serviceSeconds: 95.8 },
};
const RUN = RUNS[arg('--run', 'R2')] || RUNS.R2;
const MEASURED = { inPerChar: RUN.inPerChar, answerTokens: RUN.answerTokens, finalTokPerS: RUN.answerTokens / RUN.answerSeconds, digestTokPerS: RUNS.R1.digestTokPerS, digestCharsPerOut: 2.82 };
// what a model is known to take; not forced equal
const PARAMS = {
  'voicelab/aisha-comet': { temperature: 0.2, context: '258k (kod izohi; tekshirilmagan)' },
  'voicelab/aisha-orbit': { temperature: 0.2, context: '1M (kod izohi; tekshirilmagan)', note: "yashirin reasoning chiqish chegarasini sarflagan holatlar bo'lgan (2026-10-04)" },
  'voicelab/aisha-halo': { temperature: 0.2, context: '1M (kod izohi; tekshirilmagan)', note: "yashirin reasoning bo'yicha ma'lumot yo'q - noma'lum" },
  'openai/gpt-6-sol': { temperature: null, context: "noma'lum (narx jadvalida uzun kontekst ustamasi hisobga olinmagan)", note: 'temperature ba\'zan rad etiladi: provayder standarti ishlatiladi' },
};

function readDoc(p) {
  if (/\.docx$/iu.test(p)) return require('../src/ocr/docx-text').docxText(fs.readFileSync(p)).then(d => ({ text: d.text, tables: d.tables ? { count: d.tables, structure: d.structure } : null }));
  return Promise.resolve({ text: fs.readFileSync(p, 'utf8'), tables: null });
}
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const price = (model) => { try { return pricing.pricingSnapshot(String(model).toLowerCase()); } catch { return null; } };
const usd = (model, inTok, outTok) => { const p = price(model); return p ? (inTok * p.in + outTok * p.out) / 1e6 : null; };
const bound = (model, messages, outMax) => pricing.callCostBound({ model, inputTokensMax: pricing.inputTokenBound(messages.map(m => ({ content: m.text }))), outputTokensMax: outMax });
const filler = tokens => '- band | Taraf → harakat | muddat: 10 kun\n'.repeat(Math.max(1, Math.ceil(tokens * MEASURED.digestCharsPerOut / 41))).slice(0, Math.round(tokens * MEASURED.digestCharsPerOut));

/** A stub model that records each call's messages (dry run). */
function recorder(answerTokens) {
  const calls = [];
  const fn = async (messages, opts = {}) => {
    const user = String(messages[1].text || '');
    if (/^Excerpt /u.test(user)) {
      const need = ex.predictDigestTokens(user.replace(/^Excerpt [^\n]*\n\n/u, ''));
      calls.push({ kind: 'digest', messages, out: Math.min(ex.DIGEST_MAX_TOKENS, need), part: opts.detail && opts.detail.part });
      return need >= ex.DIGEST_MAX_TOKENS ? { text: filler(ex.DIGEST_MAX_TOKENS), truncated: true, provider: 'stub' } : { text: filler(need), provider: 'stub' };
    }
    calls.push({ kind: 'final', messages, out: answerTokens });
    return { text: 'Izoh.', provider: 'stub' };
  };
  fn.calls = calls;
  return fn;
}

/**
 * A live caller under ONE shared budget (digest parts, pre-splits, re-reads,
 * every final answer and every retry go through the same object):
 *  - before each attempt its bound (price table: UTF-8 input bound + the
 *    output cap) is taken from what is left in the same synchronous step as
 *    the check, so parallel calls cannot both pass on the same money;
 *  - a call with no bound (no price, credit-only billing) is not started;
 *  - after the call the reserve is replaced by the actual cost. The list-
 *    price dollars (from the returned tokens) and the VoiceLab credits (as
 *    returned, and their dollar value at VOICELAB_CREDIT_USD) are recorded
 *    APART; the budget is settled at the larger known one, and at the whole
 *    reserve when neither is known. A settled cost above its reserve is
 *    flagged - the reserve is a planning bound, not a guaranteed maximum.
 *  - VoiceLab ids called by name never fall back to another provider; a
 *    retry here is another attempt of the same call, reserved again.
 * `provider` defaults to src/ai/voicelab.js chatCompletion (tests pass a stub).
 */
function liveCaller(model, budget, log, temperature, { provider = null } = {}) {
  const call = provider || ((m, msgs, o) => require('../src/ai/voicelab').chatCompletion(m, msgs, o));
  return async (messages, opts = {}) => {
    const maxTokens = opts.maxTokens || CAP;
    const b = bound(model, messages, maxTokens);
    if (b.usd == null) { log.push({ model, status: 'not_called', reason: `no cost bound: ${b.reason}` }); throw new Error(`${model}: no cost bound (${b.reason}) - not called`); }
    for (let attempt = 1; attempt <= 1 + RETRIES; attempt++) {
      // check and take in one step (no await in between)
      if (budget.left < b.usd) { log.push({ model, attempt, status: 'not_called', reason: 'budget' }); throw new Error(`budget: ${budget.left.toFixed(4)} left, call needs ${b.usd.toFixed(4)} - not called`); }
      budget.left -= b.usd;
      budget.reservedNow += b.usd;
      const t0 = Date.now();
      let r, err;
      try { r = await call(model, messages, { temperature: temperature == null ? undefined : temperature, maxTokens }); } catch (e) { err = e; }
      const usage = (r && r.usage) || (err && err.usage) || {};
      const listUsd = usage.inTokens != null || usage.outTokens != null ? pricing.calculateTokenCost(model, usage) : null;
      const credits = Number.isFinite(Number(usage.credits)) && usage.credits != null ? Number(usage.credits) : null;
      const rate = pricing.voicelabCreditUsd();
      const creditUsd = credits == null || !rate || !Number.isFinite(Number(rate.usdPerCredit)) ? null : credits * Number(rate.usdPerCredit);
      const known = [listUsd, creditUsd].filter(x => x != null && Number.isFinite(x));
      const settled = known.length ? Math.max(...known) : b.usd;
      budget.reservedNow -= b.usd;
      budget.left += b.usd - settled;
      budget.spent += settled;
      budget.listUsd += listUsd || 0;
      budget.credits += credits || 0;
      log.push({ model, attempt, status: err ? 'error' : 'answered', ms: Date.now() - t0, usage, listUsd, credits, creditUsd, settledUsd: settled, reservedUsd: b.usd, overReserve: settled > b.usd, finish: r ? r.finishReason : null, error: err ? String(err.code || err.message).slice(0, 120) : null, promptSha: sha(messages.map(m => m.text).join('\n')) });
      const cut = r && r.finishReason === 'length';
      if (r && !cut) return { text: r.text, provider: r.provider };
      if (attempt > RETRIES) { if (r) return { text: r.text, provider: r.provider, truncated: true }; throw err; }
    }
    return null;
  };
}
const newBudget = usd => ({ left: usd, spent: 0, listUsd: 0, credits: 0, reservedNow: 0 });

async function main() {
  const docs = String(arg('--docs', '')).split(',').filter(Boolean);
  if (!docs.length) { console.error('usage: node scripts/explain-ab.js --docs a.docx,b.txt,c.docx [--strong voicelab/aisha-halo] [--live ...]'); process.exit(2); }
  const live = has('--live');
  const out = arg('--out');
  if (out && path.resolve(out).startsWith(REPO + path.sep)) { console.error('--out must be outside the repository (answers hold document text)'); process.exit(2); }
  if (live) {
    if (process.env.EXPLAIN_AB_LIVE !== 'yes' || !(Number(arg('--budget-usd')) > 0) || !out) { console.error('live needs EXPLAIN_AB_LIVE=yes, --budget-usd N and --out <dir outside the repo>'); process.exit(2); }
    if (![BASE, STRONG].every(m => /^voicelab\//u.test(m))) { console.error('live calls are prepared for VoiceLab models only'); process.exit(2); }
  }
  const variants = [
    { id: 'A', input: 'digest', model: BASE }, { id: 'B', input: 'digest', model: STRONG },
    { id: 'C', input: 'full_text', model: BASE }, { id: 'D', input: 'full_text', model: STRONG },
  ];
  const plan = [];
  for (const p of docs) {
    const { text, tables } = await readDoc(p);
    const doc = { file: path.basename(p), sha: sha(text).slice(0, 12), chars: text.length, contentChars: ex.contentChars(text) };
    // the digest, once (dry run: its size from the prediction)
    const rec = recorder(MEASURED.answerTokens);
    const digest = await ex.buildDigest(text, { callAI: rec });
    const dg = rec.calls.filter(c => c.kind === 'digest');
    doc.digest = {
      calls: dg.length, parts: digest.chunks, density: digest.plan && digest.plan.density ? digest.plan.density.fit : null,
      inTok: Math.round(dg.reduce((n, c) => n + c.messages.reduce((k, m) => k + m.text.length, 0), 0) * MEASURED.inPerChar),
      outTok: dg.reduce((n, c) => n + c.out, 0),
      reserve: dg.reduce((n, c) => n + (bound(BASE, c.messages, ex.DIGEST_MAX_TOKENS).usd || 0), 0) + ex.DIGEST_LIMITS.maxExtraCalls * (bound(BASE, dg[0].messages, ex.DIGEST_MAX_TOKENS).usd || 0),
    };
    doc.digest.usd = usd(BASE, doc.digest.inTok, doc.digest.outTok);
    doc.variants = [];
    for (const v of variants) {
      const r2 = recorder(MEASURED.answerTokens);
      await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: r2, digest: async () => digest, tables, inputMode: v.input, sameHelpers: true });
      const fin = r2.calls.find(c => c.kind === 'final');
      const chars = fin.messages.reduce((n, m) => n + m.text.length, 0);
      const inTok = Math.round(chars * MEASURED.inPerChar);
      const b = bound(v.model, fin.messages, CAP);
      doc.variants.push({
        ...v, promptChars: chars, inTok, ids: (fin.messages[1].text.match(/\[S\d+·[0-9a-f]{4}\]/gu) || []).length,
        usdAnswer: usd(v.model, inTok, MEASURED.answerTokens), usdCap: usd(v.model, inTok, CAP),
        reserve: b.usd == null ? null : b.usd * (1 + RETRIES), reserveNote: b.usd == null ? b.reason : null,
        seconds: v.model === BASE ? Math.round(MEASURED.answerTokens / MEASURED.finalTokPerS) : null,
        params: PARAMS[v.model] || { temperature: 0.2, context: "noma'lum" },
        promptSha: sha(fin.messages.map(m => m.text).join('\n')).slice(0, 12),
      });
    }
    plan.push(doc);
  }
  const fmt = x => (x == null ? "noma'lum" : `$${x.toFixed(4)}`);
  const sum = (f) => plan.reduce((n, d) => n + f(d), 0);
  const est = sum(d => (d.digest.usd || 0) + d.variants.reduce((k, v) => k + (v.usdAnswer || 0), 0));
  const estCap = sum(d => (d.digest.usd || 0) + d.variants.reduce((k, v) => k + (v.usdCap || 0), 0));
  const reserve = sum(d => d.digest.reserve + d.variants.reduce((k, v) => k + (v.reserve || 0), 0));
  const unknownReserve = plan.some(d => d.variants.some(v => v.reserve == null));
  if (has('--json')) { console.log(JSON.stringify({ base: BASE, strong: STRONG, cap: CAP, retries: RETRIES, plan, est, estCap, reserve, unknownReserve }, null, 2)); }
  else {
    console.log(`A/B dry run - NO AI CALL. Base ${BASE}, stronger ${STRONG}. Output cap ${CAP}, ${RETRIES} retry per answer in the reserve.`);
    console.log(`MEASURED (request ${RUN.id}, one document, comet): ${RUN.inPerChar} in-token/char, a ${RUN.answerTokens}-token answer in ${RUN.answerSeconds} s, the service ${RUN.serviceCalls} calls in ${RUN.serviceSeconds} s. Other request (reference, not merged): ${Object.values(RUNS).filter(x => x !== RUN).map(x => `${x.id}: ${x.inPerChar}/char, ${x.answerTokens} tok in ${x.answerSeconds} s`).join('; ')}.`);
    console.log("ESTIMATE: digest sizes from the prediction; answers at the measured length and at the 3 000 cap. UNKNOWN: the stronger model's speed, hidden reasoning, credit rate. Not an independent calibration.\n");
    for (const d of plan) {
      console.log(`${d.file} (sha ${d.sha}, ${d.contentChars} chars): digest ${d.digest.calls} calls (${d.digest.parts} parts, density ${d.digest.density}), ~${d.digest.inTok}+${d.digest.outTok} tok, ${fmt(d.digest.usd)}, reserve ${fmt(d.digest.reserve)}`);
      for (const v of d.variants) console.log(`  ${v.id} ${v.input.padEnd(9)} ${v.model.padEnd(22)} prompt ${v.promptChars} chars ~${v.inTok} tok, ${v.ids} ids | answer ${MEASURED.answerTokens}: ${fmt(v.usdAnswer)}, at cap: ${fmt(v.usdCap)} | reserve ${v.reserve == null ? `noma'lum (${v.reserveNote})` : fmt(v.reserve)} | ~${v.seconds == null ? "noma'lum" : `${v.seconds} s`} | temperature ${v.params.temperature == null ? 'provayder standarti' : v.params.temperature}`);
    }
    console.log(`\nTotal, 12 answers + 3 digests: estimate ${fmt(est)} (answers at ${MEASURED.answerTokens} tok), ${fmt(estCap)} (answers at the cap); reserve ${fmt(reserve)}${unknownReserve ? ' + calls with no bound (unknown)' : ''}. A reserve is a planning bound from the price table, not a guaranteed maximum.`);
  }
  if (!live) return;
  // ── live: the owner's approval, the budget, outputs outside the repo ──
  const budget = newBudget(Number(arg('--budget-usd')));
  if (reserve > budget.left || unknownReserve) { console.error(`the reserve ${fmt(reserve)} does not fit the budget $${budget.left} (or a call has no bound): nothing called`); process.exit(3); }
  fs.mkdirSync(out, { recursive: true });
  const log = [];
  const answers = [];
  for (const p of docs) {
    const { text, tables } = await readDoc(p);
    const key = sha(text).slice(0, 12);
    const digestFile = path.join(out, `digest-${key}.json`);
    let digest;
    if (fs.existsSync(digestFile)) digest = JSON.parse(fs.readFileSync(digestFile, 'utf8'));
    else { digest = await ex.buildDigest(text, { callAI: liveCaller(BASE, budget, log, 0.1) }); fs.writeFileSync(digestFile, JSON.stringify(digest)); }
    for (const v of variants) {
      const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: liveCaller(v.model, budget, log, (PARAMS[v.model] || {}).temperature), digest: async () => digest, tables, inputMode: v.input, sameHelpers: true });
      answers.push({ doc: key, variant: v.id, model: v.model, input: v.input, reply: r.reply, check: r.check, coverage: r.coverage });
    }
  }
  // blind set: random codes, the key apart
  const codes = answers.map((a, i) => ({ code: `J${String(i + 1).padStart(2, '0')}`, a, r: crypto.randomInt(1e9) })).sort((x, y) => x.r - y.r);
  fs.mkdirSync(path.join(out, 'blind'), { recursive: true });
  codes.forEach((c, i) => fs.writeFileSync(path.join(out, 'blind', `javob-${String(i + 1).padStart(2, '0')}-${c.a.doc}.md`), c.a.reply));
  fs.writeFileSync(path.join(out, 'key.json'), JSON.stringify(codes.map((c, i) => ({ file: `javob-${String(i + 1).padStart(2, '0')}-${c.a.doc}.md`, doc: c.a.doc, variant: c.a.variant, model: c.a.model, input: c.a.input })), null, 2));
  fs.writeFileSync(path.join(out, 'calls.jsonl'), log.map(l => JSON.stringify(l)).join('\n'));
  console.log(`live: ${answers.length} answers; settled ${fmt(budget.spent)} of the budget; list price ${fmt(budget.listUsd)} and VoiceLab credits ${budget.credits} shown apart (credits per token unconfirmed); ${log.filter(l => l.overReserve).length} call(s) above their reserve; outputs in ${out} (blind/ for the lawyer, key.json kept apart).`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { liveCaller, newBudget, bound, RUNS, CAP };
