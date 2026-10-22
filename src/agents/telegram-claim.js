'use strict';

/**
 * The claim-draft agent in the Telegram bot (2026-10-22): a da'vo arizasi
 * ordered in the bot is drafted by the same workflow as /app/#/agent/dava
 * (src/agents/workflows/claim-draft.js) instead of the plain draft generator.
 *
 * The bot only has free text (the question, the answer it got and what the
 * person wrote for the order), so one cheap call first reads it into the
 * claim's fields - only what the text says, empty where it says nothing, never
 * invented. Missing fields stop the run with the questions to ask (the bot
 * asks, the person answers in one message, the run starts again); nothing is
 * charged for that. Then the workflow: lex.uz search, basis with quotes found
 * word for word, the draft citing only that basis, the mechanical check.
 *
 * deps: callAI, callCheapAI, retrieve(query, topic), generateDraftHtml.
 */

const { runWorkflow, parseJson } = require('./harness');
const { createClaimDraftWorkflow, readIntake } = require('./workflows/claim-draft');

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);

/** The claim's fields from the person's own words; empty where the text is silent. */
async function extractFacts(text, { callCheapAI, lang = 'uz' }) {
  const source = String(text || '').slice(0, 8000);
  let parsed = null;
  try {
    const r = await callCheapAI([
      { role: 'system', text: "Matndan da'vo arizasi maydonlarini ajrating. FAQAT matnda yozilganini oling; yo'q bo'lsa \"\" qoldiring, hech narsani o'ylab topmang. Faqat JSON: {\"court\":\"\",\"plaintiff\":{\"name\":\"\",\"details\":\"\"},\"defendant\":{\"name\":\"\",\"details\":\"\"},\"circumstances\":\"\",\"demands\":\"\",\"amount\":\"\",\"evidence\":\"\"}. circumstances - nima bo'lgani (sanalar bilan), demands - suddan nima so'ralayotgani." },
      { role: 'user', text: source },
    ], { temperature: 0, maxTokens: 900, endpoint: '/tg/claim-agent', lane: 'cheap' });
    parsed = parseJson(r && r.text);
  } catch (_) { parsed = null; }
  const p = parsed || {};
  const facts = {
    court: clean(p.court, 200),
    plaintiff: { name: clean(p.plaintiff && p.plaintiff.name, 200), details: clean(p.plaintiff && p.plaintiff.details, 400) },
    defendant: { name: clean(p.defendant && p.defendant.name, 200), details: clean(p.defendant && p.defendant.details, 400) },
    circumstances: clean(p.circumstances, 6000),
    demands: clean(p.demands, 2000),
    amount: clean(p.amount, 60),
    evidence: clean(p.evidence, 2000),
    lang: lang === 'ru' ? 'ru' : 'uz',
  };
  // the person's whole text stands in for the story when the model kept too little of it
  if (facts.circumstances.length < 80 && source.replace(/\s+/gu, '').length >= 80) facts.circumstances = clean(source, 6000);
  return { facts, parsed: !!parsed };
}

function createTelegramClaimAgent(deps) {
  const workflow = createClaimDraftWorkflow();

  /**
   * run(text, { onStep }) -> { status: 'needs_input', missing, facts }
   *                        | { status: 'done', html, basis, warnings, dropped, trace }
   *                        | { status: 'failed', stoppedAt, trace }
   */
  async function run(text, { lang = 'uz', onStep = null } = {}) {
    const { facts } = await extractFacts(text, { callCheapAI: deps.callCheapAI || deps.callAI, lang });
    const intake = readIntake(facts);
    if (intake.missing.length) return { status: 'needs_input', missing: intake.missing, facts };
    const out = await runWorkflow(workflow, facts, {
      deps: { callAI: deps.callAI, callCheapAI: deps.callCheapAI || deps.callAI, retrieve: deps.retrieve, generateDraftHtml: deps.generateDraftHtml },
      budget: { maxSteps: 8, maxMs: Number(process.env.AGENT_MAX_MS) || 150000 },
      onEvent: onStep,
    });
    const s = (out.state && out.state.steps) || {};
    if (out.status === 'done' && s.draft && s.draft.html) {
      return { status: 'done', html: s.draft.html, basis: (s.basis && s.basis.basis) || [], dropped: (s.basis && s.basis.dropped) || 0,
        warnings: (s.verify && s.verify.warnings) || [], trace: out.trace, facts };
    }
    return { status: out.status === 'needs_input' ? 'needs_input' : 'failed', missing: s.intake ? s.intake.missing : [], stoppedAt: out.stoppedAt || null, trace: out.trace };
  }

  return { run };
}

/** The bot's text after a delivered draft: the checked basis with links, then the warnings. Plain text. */
function resultText({ basis = [], warnings = [], dropped = 0 }) {
  const lines = ["⚖️ Huquqiy asos (iqtibos lex.uz manbasida so'zma-so'z topilgan):"];
  if (basis.length) {
    for (const b of basis.slice(0, 8)) lines.push(`• ${b.act}${b.article ? `, ${b.article}-modda` : ''}: «${String(b.quote).slice(0, 220)}»${b.url ? `\n  ${b.url}` : ''}`);
  } else {
    lines.push("• Tasdiqlangan asos topilmadi — moddalarni yurist bilan aniqlang.");
  }
  if (dropped) lines.push(`(${dropped} ta iqtibos manbada topilmadi va ishlatilmadi.)`);
  if (warnings.length) {
    lines.push('', '⚠️ Tekshiring:');
    for (const w of warnings.slice(0, 10)) lines.push(`• ${w.text}`);
  }
  return lines.join('\n').slice(0, 3900);
}

module.exports = { createTelegramClaimAgent, extractFacts, resultText };
