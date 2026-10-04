'use strict';

/**
 * A legal question usually asks several things at once - what to do, what
 * evidence, by when, and what compensation - and one retrieval for the whole
 * question returns the norms of its loudest part (2026-10-04: a wage-arrears
 * question got the general article 25 and an unrelated article 511, and never
 * the article on time limits for labour disputes or the one on compensation
 * for late wages).
 *
 * Each part the question asks about gets its own corpus search, phrased in the
 * legislation's own terms for the question's field. The phrases are legal
 * concepts per field, not article numbers, and not tied to any one question;
 * a part the question does not ask about is not searched.
 */

// What a part of a question looks like (Uzbek Latin and Cyrillic, Russian).
const ASPECTS = [
  {
    key: 'deadline',
    label: { uz: 'murojaat muddati', ru: 'срок обращения' },
    detect: /muddat|qachongacha|qancha vaqt|necha (?:kun|oy|yil)|муддат|қачонгача|срок|в течение|до какого/iu,
    terms: {
      mehnat: "mehnat nizolarini hal qilish uchun murojaat qilish muddatlari",
      fuqarolik: "da'vo muddati muddatni hisoblash",
      oila: "oilaviy nizolar bo'yicha da'vo muddati",
      default: "sudga murojaat qilish muddati da'vo muddati",
    },
  },
  {
    key: 'compensation',
    label: { uz: 'kompensatsiya', ru: 'компенсация' },
    // wages not paid on time carry the employer's liability for the delay,
    // asked about or not
    detect: /kompensatsiya|kechiktir|penya|neustoyka|ustama|компенсац|кечиктир|задержк|пен[ия]\b|неусто|ish haq\p{L}*[^.?!]{0,60}(?:to['ʻ’`]?la(?:ma|n?ma)|berma|qarz)|иш ҳақ\p{L}*[^.?!]{0,60}(?:тўла(?:ма|нма)|берма|қарз)|зарплат\p{L}*[^.?!]{0,60}(?:не выплач|не плат|задерж|долг)|(?:не выплач|не плат|задерж)\p{L}*[^.?!]{0,40}(?:зарплат|заработн)/iu,
    terms: {
      mehnat: "ish haqini to'lash muddatlari buzilganligi uchun ish beruvchining javobgarligi kompensatsiya",
      fuqarolik: "pul majburiyatini bajarishni kechiktirganlik uchun javobgarlik",
      default: "majburiyatni bajarishni kechiktirganlik uchun javobgarlik",
    },
  },
  {
    key: 'evidence',
    label: { uz: 'dalillar va hujjatlar', ru: 'доказательства и документы' },
    detect: /hujjat|dalil|isbot|ҳужжат|далил|документ|доказ/iu,
    terms: {
      mehnat: "mehnat nizosi bo'yicha dalillar ish beruvchi taqdim etadigan hujjatlar",
      default: "da'vo arizasiga ilova qilinadigan hujjatlar dalillar",
    },
  },
  {
    key: 'remedy',
    label: { uz: 'himoya choralari', ru: 'способы защиты' },
    detect: /chora|undir|qanday qilib|nima qil|himoya|чора|ундир|ҳимоя|взыск|что делать|как защит/iu,
    terms: {
      mehnat: "mehnat nizolarini ko'rib chiquvchi organlar xodimning sudga murojaat qilishi",
      default: "huquqlarni himoya qilish usullari sudga murojaat",
    },
  },
];

// A light search: no query rewrite, no relevance grader, no live lex.uz and
// no cross-encoder - only the embedding of the query is an AI call.
const LIGHT = Object.freeze({ noWebFallback: true, queryRewrite: false, correctiveMode: 'off', rerank: false });

/** The parts of a question to search separately: [{ key, label, query }]. */
function questionAspects(question = '', topic = null, { lang = 'uz', max = 4 } = {}) {
  const q = String(question || '');
  return ASPECTS
    .filter(a => a.detect.test(q))
    .slice(0, max)
    .map(a => ({ key: a.key, label: a.label[lang === 'ru' ? 'ru' : 'uz'], query: a.terms[topic] || a.terms.default }));
}

/**
 * Retrieve each part's norms with a light corpus search (no rewrite, no
 * grader, no live lex.uz, no rerank: the main retrieval did those) and add the
 * chunks that are not already there. Returns { chunks, context, found }:
 * found maps each part to the article refs its search brought.
 */
async function retrieveAspects({ question, topic, retrieve, existing = [], lang = 'uz', perAspect = 3, maxChars = 1400 }) {
  const aspects = questionAspects(question, topic, { lang });
  if (!aspects.length || typeof retrieve !== 'function') return { chunks: [], context: '', found: {} };
  const seen = new Set(existing.map(c => c && (c.id || `${c.law_name}|${String(c.chunk_text || '').slice(0, 60)}`)));
  const results = await Promise.all(aspects.map(async (a) => {
    try {
      const r = await retrieve(a.query, topic, LIGHT);
      return { aspect: a, chunks: ((r && r.chunks) || []).slice(0, perAspect) };
    } catch (_) {
      return { aspect: a, chunks: [] };
    }
  }));
  const added = [];
  const blocks = [];
  const found = {};
  for (const { aspect, chunks } of results) {
    found[aspect.key] = [];
    const lines = [];
    for (const c of chunks) {
      if (!c || c.is_active === false) continue;
      const refs = Array.isArray(c.article_numbers) ? c.article_numbers : [];
      found[aspect.key].push(...refs);
      const key = c.id || `${c.law_name}|${String(c.chunk_text || '').slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ ...c, _aspect: aspect.key });
      const text = String(c.parentText || c.chunk_text || '');
      lines.push(`- ${c.law_name}${refs.length ? `, ${refs.join(', ')}-modda` : ''}\n${text.slice(0, maxChars)}${c.source_url ? `\n  (Manba: ${c.source_url})` : ''}`);
    }
    if (lines.length) blocks.push(`SAVOLNING "${aspect.label}" QISMI UCHUN TOPILGAN NORMALAR:\n${lines.join('\n\n')}`);
  }
  return { chunks: added, context: blocks.length ? `\n\n${blocks.join('\n\n')}` : '', found };
}

module.exports = { ASPECTS, LIGHT, questionAspects, retrieveAspects };
