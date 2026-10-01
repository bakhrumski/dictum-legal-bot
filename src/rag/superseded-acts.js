'use strict';

/**
 * Acts that no longer apply, and what replaced them.
 *
 * 2026-10-01: a Russian question on an LLC share was answered from the 2001
 * Law "Об обществах с ограниченной и дополнительной ответственностью"
 * (O'RQ-310), which is no longer in force; the current law is O'RQ-1137
 * (owner, a lawyer). Retrieval had found no LLC law, the model wrote the
 * old one from memory, and nothing told the user. The citation hydrator saw
 * on lex.uz that O'RQ-310 was repealed but only logged it.
 *
 * An answer that names a listed act, or any act the hydrator found repealed
 * on lex.uz, now ends with a notice in the answer's language. The answer is
 * not rewritten: the notice says what changed and links the current act.
 * Entries are added only on a lawyer's confirmation.
 */

const { normalizeOfficialDocumentIdentifier } = require('./citation-utils');

const SUPERSEDED = [
  {
    identifier: "O'RQ-310",
    kind: { uz: 'Qonun', ru: 'Закон' },
    names: [
      /ограниченной\s+и\s+дополнительной\s+ответственност/iu,
      /qo['ʻ’`]?shimcha\s+mas['ʻ’`]?uliyatli\s+jamiyat/iu,
    ],
    title: {
      uz: "Mas'uliyati cheklangan hamda qo'shimcha mas'uliyatli jamiyatlar to'g'risida",
      ru: 'Об обществах с ограниченной и дополнительной ответственностью',
    },
    replacedBy: {
      identifier: "O'RQ-1137",
      title: {
        uz: "Mas'uliyati cheklangan jamiyatlar to'g'risida",
        ru: 'Об обществах с ограниченной ответственностью',
      },
      url: 'https://lex.uz/docs/-8151376',
    },
  },
];

// O'RQ-310, ЎРҚ-310, ЗРУ-310 and similar, as written in an answer.
const OFFICIAL_ID_RE = /(O['ʻ’`]?RQ|ЎРҚ|ЗРУ|PQ|ПҚ|ПП|PF|ПФ|УП|VMQ|ВМҚ|ПКМ)\s*[-–—№]?\s*(\d{2,5})/giu;

function mentionedIdentifiers(text = '') {
  const ids = new Set();
  let m;
  OFFICIAL_ID_RE.lastIndex = 0;
  while ((m = OFFICIAL_ID_RE.exec(String(text || '')))) {
    const id = normalizeOfficialDocumentIdentifier(`${m[1]}-${m[2]}`);
    if (id) ids.add(id);
  }
  return ids;
}

/** Listed superseded acts the answer names, by identifier or by title. */
function findSupersededMentions(answer = '') {
  const text = String(answer || '');
  const ids = mentionedIdentifiers(text);
  return SUPERSEDED.filter(entry =>
    ids.has(normalizeOfficialDocumentIdentifier(entry.identifier)) || entry.names.some(rx => rx.test(text)));
}

const RU_PREFIX = { "O'RQ": 'ЗРУ', PQ: 'ПП', PF: 'УП', VMQ: 'ПКМ' };
function identifierFor(id = '', lang = 'uz') {
  if (lang !== 'ru') return id;
  const [prefix, ...rest] = String(id).split('-');
  return RU_PREFIX[prefix] ? [RU_PREFIX[prefix], ...rest].join('-') : id;
}

/**
 * The notice appended to an answer: listed superseded acts (with their
 * replacement) and acts the hydrator found repealed on lex.uz. `repealed` is
 * [{ identifier, title, url }]. Returns '' when there is nothing to say.
 */
function buildRepealedNotice({ superseded = [], repealed = [] } = {}, lang = 'uz') {
  const ru = lang === 'ru';
  const listed = new Set(superseded.map(e => normalizeOfficialDocumentIdentifier(e.identifier)));
  const lines = [];
  for (const e of superseded) {
    const kind = (e.kind && e.kind[ru ? 'ru' : 'uz']) || '';
    const old = `${ru ? `${kind} ` : ''}«${e.title[ru ? 'ru' : 'uz']}»${ru ? '' : ` ${kind.toLowerCase()}`} (${identifierFor(e.identifier, lang)})`.replace(/\s+\(/u, ' (');
    const next = e.replacedBy;
    const current = `${ru ? `${kind} ` : ''}«${next.title[ru ? 'ru' : 'uz']}»${ru ? '' : ` ${kind.toLowerCase()}`} (${identifierFor(next.identifier, lang)})`.replace(/\s+\(/u, ' (');
    lines.push(ru
      ? `- ${old} **утратил силу**. Действует ${current}: [lex.uz](${next.url}). Проверьте выводы по действующему закону.`
      : `- ${old} **kuchini yo'qotgan**. Amaldagisi: ${current}: [lex.uz](${next.url}). Xulosalarni amaldagi qonun bo'yicha tekshiring.`);
  }
  for (const r of repealed) {
    const id = normalizeOfficialDocumentIdentifier(r.identifier);
    if (!id || listed.has(id)) continue;
    const name = r.title ? `«${r.title}» ` : '';
    const link = r.url ? ` [lex.uz](${r.url})` : '';
    lines.push(ru
      ? `- ${name}(${identifierFor(id, lang)}) по данным lex.uz **утратил силу**.${link} Не опирайтесь на него.`
      : `- ${name}(${id}) lex.uz ma'lumotiga ko'ra **kuchini yo'qotgan**.${link} Unga tayanmang.`);
  }
  if (!lines.length) return '';
  const heading = ru ? '⚠️ **Статус документа**' : '⚠️ **Hujjat holati**';
  return `\n\n---\n${heading}\n${lines.join('\n')}`;
}

/** The answer with the notice appended (unchanged when there is none or it is already there). */
function appendRepealedNotice(answer = '', { repealed = [] } = {}, lang = 'uz') {
  const text = String(answer || '');
  if (/⚠️ \*\*(?:Статус документа|Hujjat holati)\*\*/u.test(text)) return text;
  const notice = buildRepealedNotice({ superseded: findSupersededMentions(text), repealed }, lang);
  return notice ? text + notice : text;
}

module.exports = { SUPERSEDED, findSupersededMentions, buildRepealedNotice, appendRepealedNotice, identifierFor };
