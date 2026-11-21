'use strict';

/**
 * The planner agent (2026-10-28, roadmap PR-D, docs/design/matter-va-agent-runs.md
 * 4.2). One cheap call reads the task, the matter's item names and the tool
 * lines, and returns a plan: a JSON list of steps, each a registry tool with
 * its args and the steps it comes after. It never writes legal text.
 *
 * The server checks the plan mechanically (no AI) before anyone sees it:
 * known tools, args each tool accepts, ids unique, `after` only to earlier
 * steps (so no cycle), at most MAX_NODES steps and MAX_SEARCHES searches,
 * exactly one answer and a verify after it as the last step, documents only
 * from this matter. A plan that fails is asked for once more with the
 * errors named; a second failure takes the fixed plan (search -> answer ->
 * verify, with the matter's context first when there is a matter), and says
 * so. The price is the sum of the tools' costs (only `answer` costs: 1 chat
 * unit); the plan call itself is not charged (the owner, 2026-10-28).
 */

const { parseJson } = require('./harness');

const MAX_NODES = 12;
const MAX_SEARCHES = 4;
const ID = /^n\d{1,2}$/u;

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);

function plannerPrompt({ task, toolLines, matter = null }) {
  return [
    {
      role: 'system',
      text: [
        "Siz yuridik ish rejasini tuzuvchisiz. Siz huquqiy matn YOZMAYSIZ: faqat qaysi vositalar qaysi tartibda ishlashini tanlaysiz.",
        "Vositalar:",
        toolLines,
        "Qoidalar:",
        `- Ko'pi bilan ${MAX_NODES} qadam, lex_search ko'pi bilan ${MAX_SEARCHES} marta (har biri savolning boshqa huquqiy jihati uchun, lex.uz so'z shakllarida: masalan "pudrat shartnomasi avans qaytarish").`,
        "- Aynan bitta answer qadami bo'ladi va oxirgi qadam verify (answer'dan keyin).",
        "- Ish bo'lsa, matter_context birinchi qadam bo'lsin. doc_excerpt faqat ISH HUJJATLARI ro'yxatidagi scanId bilan.",
        "- after: shu qadamdan oldin tugashi kerak bo'lgan qadamlar id'lari (faqat oldingi qadamlar). Bir-biriga bog'liq bo'lmagan qidiruvlar after:[] bilan parallel ishlaydi.",
        "- ask_user faqat javob uchun zarur fakt topshiriqda ham, ishda ham bo'lmasa (ko'pi bilan bir marta, answer'dan oldin).",
        'Faqat JSON qaytaring: {"goal":"...","nodes":[{"id":"n1","tool":"...","args":{...},"after":[]}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      text: [
        matter ? `ISH: ${clean(matter.title, 160)}${matter.summary ? ` — ${clean(matter.summary, 600)}` : ''}` : 'ISH: yo\'q',
        matter && matter.scans.length ? `ISH HUJJATLARI:\n${matter.scans.map(s => `- scanId ${s.id}: ${clean(s.title, 120)}`).join('\n')}` : '',
        `TOPSHIRIQ: ${clean(task, 2000)}`,
      ].filter(Boolean).join('\n'),
    },
  ];
}

/**
 * The plan as the server accepts it: { ok, plan: { goal, nodes }, errors, price }.
 * ctx: { matterId, matterScans: [scanId] }.
 */
function validatePlan(raw, registry, ctx = {}) {
  const errors = [];
  const nodes = Array.isArray(raw && raw.nodes) ? raw.nodes : [];
  if (!nodes.length) errors.push("reja bo'sh");
  if (nodes.length > MAX_NODES) errors.push(`qadamlar ${MAX_NODES} tadan ko'p`);
  const out = [];
  const ids = new Set();
  let searches = 0, answers = 0;
  for (const [i, n] of nodes.slice(0, MAX_NODES).entries()) {
    const id = clean(n && n.id, 4);
    const tool = registry.get(clean(n && n.tool, 40));
    if (!ID.test(id) || ids.has(id)) { errors.push(`${i + 1}-qadam: id noto'g'ri yoki takror (${id || '—'})`); continue; }
    if (!tool) { errors.push(`${id}: noma'lum vosita ${clean(n && n.tool, 40) || '—'}`); continue; }
    const args = n.args && typeof n.args === 'object' && !Array.isArray(n.args) ? n.args : {};
    const bad = tool.validate(args, ctx);
    if (bad) errors.push(`${id}: ${bad}`);
    const after = (Array.isArray(n.after) ? n.after : []).map(a => clean(a, 4));
    for (const a of after) if (!ids.has(a)) errors.push(`${id}: after ${a} oldingi qadam emas`);
    if (tool.id === 'lex_search') searches++;
    if (tool.id === 'answer') answers++;
    ids.add(id);
    out.push({ id, tool: tool.id, args: JSON.parse(JSON.stringify(args)), after: [...new Set(after.filter(a => ids.has(a)))] });
  }
  if (searches > MAX_SEARCHES) errors.push(`lex_search ${MAX_SEARCHES} tadan ko'p`);
  if (answers !== 1) errors.push("aynan bitta answer qadami bo'lishi kerak");
  const last = out[out.length - 1];
  const answerAt = out.findIndex(n => n.tool === 'answer');
  if (!last || last.tool !== 'verify' || answerAt < 0 || answerAt > out.length - 2) errors.push("oxirgi qadam answer'dan keyingi verify bo'lishi kerak");
  if (out.filter(n => n.tool === 'verify').length !== 1) errors.push("aynan bitta verify qadami bo'lishi kerak");
  if (out.filter(n => n.tool === 'ask_user').length > 1) errors.push("ask_user ko'pi bilan bir marta");
  if (out.some((n, i) => n.tool === 'ask_user' && answerAt >= 0 && i > answerAt)) errors.push("ask_user answer'dan oldin bo'lishi kerak");
  // the steps run as a graph (PR-E): the answer waits for every step before it,
  // verify for everything; other steps keep their own `after`
  for (const [i, n] of out.entries()) {
    if (n.tool === 'answer' || n.tool === 'verify') n.after = out.slice(0, i).map(x => x.id);
  }
  return { ok: !errors.length, plan: { goal: clean(raw && raw.goal, 300), nodes: out }, errors: errors.slice(0, 10), price: priceOf(out, registry) };
}

/** { service: units } of a plan. */
function priceOf(nodes, registry) {
  const price = {};
  for (const n of nodes) {
    const t = registry.get(n.tool);
    if (t && t.cost) price[t.cost.service] = (price[t.cost.service] || 0) + t.cost.units;
  }
  return price;
}

/** The fixed plan when the model's plan cannot be used. */
function fallbackPlan(task, ctx = {}) {
  const nodes = [];
  if (ctx.matterId) nodes.push({ id: 'n1', tool: 'matter_context', args: {}, after: [] });
  const s = `n${nodes.length + 1}`;
  nodes.push({ id: s, tool: 'lex_search', args: { query: clean(task, 200) }, after: [] });
  const a = `n${nodes.length + 1}`;
  nodes.push({ id: a, tool: 'answer', args: { question: clean(task, 2000) }, after: nodes.map(n => n.id) });
  nodes.push({ id: `n${nodes.length + 1}`, tool: 'verify', args: {}, after: [a] });
  return { goal: clean(task, 300), nodes };
}

/**
 * Plan a task: { plan, price, source: 'model' | 'model_retry' | 'fallback', errors }.
 * deps: { callCheapAI }. ctx: { matterId, matter: { title, summary, scans } , matterScans }.
 */
async function makePlan(task, registry, { callCheapAI }, ctx = {}) {
  const usageLedger = require('../ai/usage-ledger');
  const ask = async (extra) => {
    const messages = plannerPrompt({ task, toolLines: registry.describe(), matter: ctx.matter || null });
    if (extra) messages.push({ role: 'user', text: extra });
    const r = await usageLedger.withStage('agent_plan', () => callCheapAI(messages, { temperature: 0, maxTokens: 900, endpoint: '/api/agent/plan' }));
    return parseJson(r && r.text);
  };
  let first = null, errors = [];
  try { first = await ask(null); } catch (e) { errors = [`reja chaqiruvi: ${clean(e.message, 120)}`]; }
  if (first) {
    const v = validatePlan(first, registry, ctx);
    if (v.ok) return { plan: v.plan, price: v.price, source: 'model', errors: [] };
    errors = v.errors;
    let second = null;
    try { second = await ask(`Rejangiz qabul qilinmadi: ${v.errors.join('; ')}. Qoidalarga mos yangi JSON qaytaring.`); } catch (_) { second = null; }
    if (second) {
      const v2 = validatePlan(second, registry, ctx);
      if (v2.ok) return { plan: v2.plan, price: v2.price, source: 'model_retry', errors };
      errors = errors.concat(v2.errors);
    }
  }
  const plan = fallbackPlan(task, ctx);
  const v = validatePlan(plan, registry, ctx);
  return { plan: v.plan, price: v.price, source: 'fallback', errors };
}

module.exports = { makePlan, validatePlan, fallbackPlan, priceOf, plannerPrompt, MAX_NODES, MAX_SEARCHES };
