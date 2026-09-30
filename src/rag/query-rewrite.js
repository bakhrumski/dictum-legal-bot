'use strict';

/**
 * Question rewrite for retrieval (eval runs 22-23). Most remaining misses
 * find the right law but a neighbouring article: a citizen asks in everyday
 * words ("alimentdan qanday ozod bo'laman?", or in Russian) while the code
 * says it in its own terms, so dense search lands next to the answer. A
 * cheap model rewrites the question in the wording of Uzbek legislation;
 * the rewrite is searched alongside the original question, and the reranker
 * and the grader still judge against the original.
 *
 * Off unless RAG_QUERY_REWRITE=1 or opts.queryRewrite (eval: &rewrite=1).
 * A failed or empty rewrite changes nothing.
 */

const MAX_CHARS = 400;
const CACHE_SIZE = 500;
const cache = new Map();
const META_REPLY = /(^|[^\p{L}])(iltimos|savolingiz|xabaringiz|to['ʻ’`]?liq emas|tugallanmagan|aniqlashtiring|пожалуйста|уточните|ваш вопрос)(?=$|[^\p{L}])/iu;

/** Whether to rewrite: opts.queryRewrite, else RAG_QUERY_REWRITE. */
function queryRewriteFrom(opts = {}, env = process.env) {
  if (opts.queryRewrite === true || opts.queryRewrite === false) return opts.queryRewrite;
  return ['1', 'true', 'on'].includes(String(env.RAG_QUERY_REWRITE || '').toLowerCase());
}

// callAI/callOpenAI take [{ role, text }] and send any non-user role as the
// assistant's, so the instruction goes in the one user message.
function buildRewriteMessages(question) {
  const prompt = [
    "Sen O'zbekiston qonunchiligi bo'yicha qidiruv yordamchisisan.",
    "Quyidagi savolni lex.uz dagi qonun matni uslubida, o'zbek tilida (lotin yozuvida) qayta yoz:",
    "- savoldagi holatni qonun atamalari bilan ifodala (masalan: \"ishdan bo'shatish\" -> \"mehnat shartnomasini bekor qilish\");",
    "- savol rus tilida bo'lsa ham, o'zbekcha yoz;",
    "- savolda yo'q holat, shaxs yoki tushunchani qo'shma (masalan, turmush o'rtog'i uchun aliment haqidagi savolga \"voyaga yetmagan bolalar\" yoki \"nikoh shartnomasi\" ni qo'shma);",
    "- javob berma, modda raqamini to'qima, qonun nomini faqat aniq bo'lsa qo'sh;",
    "- savol chala bo'lsa ham, faqat bor qismini qayta yoz; hech qachon savolni to'ldirishni so'rama va izoh yozma;",
    `- bir-ikki gap, ${MAX_CHARS} belgidan oshmasin. Faqat qayta yozilgan matnni chiqar.`,
    '',
    `Savol: ${String(question || '').slice(0, 1500)}`,
  ].join('\n');
  return [{ role: 'user', text: prompt }];
}

/** Clean a model reply to one short line of text, or null if unusable. */
function cleanRewrite(reply, question) {
  let text = typeof reply === 'string' ? reply : (reply && (reply.text || reply.content)) || '';
  text = String(text).replace(/\s+/g, ' ').trim().replace(/^["'«“]+|["'»”]+$/g, '').trim();
  if (text.length < 10) return null;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '');
  if (text.toLowerCase() === String(question || '').trim().toLowerCase()) return null;
  // A reply to the user instead of a rewrite (run 27, cut-off questions:
  // "Sizning xabaringiz tugallanmagan. Iltimos, …") is not searched.
  if (META_REPLY.test(text)) return null;
  return text;
}

/**
 * The question in legislative wording, or null. callLLM(messages, opts) is
 * the cheap-lane model call; results are cached per question.
 */
async function rewriteLegalQuery(question, callLLM, { timeoutMs = 8000, log = console } = {}) {
  const key = String(question || '').trim();
  if (!key || typeof callLLM !== 'function') return null;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); cache.set(key, hit);
    return hit;
  }
  let timer;
  try {
    const reply = await Promise.race([
      callLLM(buildRewriteMessages(key), { maxTokens: 600, temperature: 0 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('rewrite timeout')), timeoutMs); }),
    ]);
    const text = cleanRewrite(reply, key);
    cache.set(key, text);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return text;
  } catch (err) {
    log.warn(`[RAG] query rewrite failed: ${err.message}`);
    return null; // not cached: a transient failure should be retried next time
  } finally {
    clearTimeout(timer);
  }
}

/** Merge two hit lists by id, keeping each chunk's higher score, best first. */
function mergeByBestScore(a = [], b = []) {
  const byId = new Map();
  for (const r of [...a, ...b]) {
    const prev = byId.get(r.id);
    if (!prev || (Number(r.score) || 0) > (Number(prev.score) || 0)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0));
}

module.exports = { queryRewriteFrom, rewriteLegalQuery, buildRewriteMessages, cleanRewrite, mergeByBestScore, _cache: cache };
