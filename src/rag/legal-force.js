'use strict';

/**
 * The legal force of an act (2026-10-03, owner): a question is often governed
 * by several acts at once - a law, a Presidential resolution, a Cabinet
 * regulation - and the answer must show each of them, from the strongest
 * down, and say which one prevails. The order follows the Law "Normativ-
 * huquqiy hujjatlar to'g'risida":
 *
 *   Konstitutsiya
 *   qonunlar (kodekslar ham qonun)
 *   Oliy Majlis palatalarining qarorlari
 *   Prezidentning farmonlari, qarorlari va farmoyishlari
 *   Prezident Administratsiyasi Rahbarining farmoyishlari
 *   Vazirlar Mahkamasining qarorlari
 *   vazirliklar va idoralarning buyruqlari hamda qarorlari
 *   mahalliy davlat hokimiyati organlarining (hokimlarning) qarorlari
 *
 * The level is read from the act's own identifier (O'RQ / PF / PQ / VMQ) and
 * its title or act-form line as lex.uz prints it; an act whose form cannot
 * be read gets no level rather than a guessed one.
 */

const LEVELS = [
  { rank: 1, key: 'konstitutsiya', uz: 'Konstitutsiya', ru: 'Конституция' },
  { rank: 2, key: 'qonun', uz: 'Qonun', ru: 'Закон' },
  { rank: 3, key: 'palata', uz: 'Oliy Majlis palatasi qarori', ru: 'Постановление палаты Олий Мажлиса' },
  { rank: 4, key: 'prezident', uz: 'Prezident hujjati', ru: 'Акт Президента' },
  { rank: 5, key: 'administratsiya', uz: 'Prezident Administratsiyasi Rahbarining farmoyishi', ru: 'Распоряжение Руководителя Администрации Президента' },
  { rank: 6, key: 'vazirlar-mahkamasi', uz: 'Vazirlar Mahkamasi qarori', ru: 'Постановление Кабинета Министров' },
  { rank: 7, key: 'idoraviy', uz: 'Vazirlik yoki idora hujjati', ru: 'Ведомственный акт' },
  { rank: 8, key: 'hokim', uz: 'Hokim qarori', ru: 'Решение хокима' },
];
const BY_KEY = Object.fromEntries(LEVELS.map(l => [l.key, l]));

const A = "['ʻʼ‘’`]?"; // an Uzbek apostrophe, typed any way or not at all

// Checked in this order: a narrower form first (the Administration head's
// order before the President's acts, a chamber's resolution before "qonun",
// a code before a ministry's "buyrug'i").
const FORM_PATTERNS = [
  ['konstitutsiya', /^\s*(?:o['ʻʼ‘’`]?zbekiston\s+respublikasi(?:ning)?\s+)?konstitutsiya|^\s*(?:конституция|конституцияси)/iu],
  ['administratsiya', new RegExp(`administratsiyasi\\s+rahbari|администрации\\s+президента|маъмурияти\\s+раҳбари`, 'iu')],
  ['palata', new RegExp(`(?:senat|qonunchilik\\s+palatasi|oliy\\s+majlis)\\p{L}*\\s+(?:\\p{L}+\\s+)?qarori|(?:сенат|законодательной\\s+палаты|олий\\s+мажлис)\\p{L}*\\s+постановлени|(?:сенати|қонунчилик\\s+палатаси)\\p{L}*\\s+қарори`, 'iu')],
  ['qonun', new RegExp(`\\bkodeks|кодекс|\\bqonun(?:i|ining)?\\b|\\bзакон\\b|\\bқонун`, 'iu')],
  ['prezident', new RegExp(`prezident\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:farmon|qaror|farmoyish)|президент\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:указ|постановлени|распоряжени|фармон|қарор|фармойиш)`, 'iu')],
  ['vazirlar-mahkamasi', new RegExp(`vazirlar\\s+mahkamasi|кабинет\\p{L}*\\s+министров|вазирлар\\s+маҳкамаси`, 'iu')],
  ['hokim', new RegExp(`hokim(?:i|ining|lari|ligi)?\\p{L}*\\s+(?:\\p{L}+\\s+)?qarori|хоким\\p{L}*\\s+(?:\\p{L}+\\s+)?решени|ҳоким\\p{L}*\\s+(?:\\p{L}+\\s+)?қарори`, 'iu')],
  ['idoraviy', new RegExp(`vazirlig\\p{L}*|qo${A}mitas\\p{L}*|agentligi\\p{L}*|markaziy\\s+bank\\p{L}*|inspeksiyas\\p{L}*|buyrug${A}i|министерств\\p{L}*|комитет\\p{L}*|агентств\\p{L}*|центрального\\s+банка|приказ|вазирлиг\\p{L}*|қўмитас\\p{L}*|буйруғи`, 'iu')],
];

const ID_PATTERNS = [
  ['qonun', /^(?:O['ʻʼ‘’`]?RQ|ЎРҚ|ЗРУ)-/iu],
  // A law before 2017 is numbered with its convocation: "310-II".
  ['qonun', /^\d+-[IVX]+$/u],
  ['prezident', /^(?:PF|PQ|ПФ|ПҚ|УП|ПП)-/iu],
  ['vazirlar-mahkamasi', /^(?:VMQ|ВМҚ|ПКМ)-/iu],
];

/**
 * The legal force of a chunk or a lex.uz result: { rank, key, uz, ru } or
 * null. `identifier` is its normalised own number, when the caller has it.
 */
function legalForceOf(item = {}, identifier = '') {
  const meta = item.metadata || {};
  const id = String(identifier || item.ownDocumentNumber || item.document_number || meta.document_number || '').trim();
  const title = String(item.law_name || item.lawName || item.title || '');
  // The Constitution is read from the title alone: other acts quote it.
  if (FORM_PATTERNS[0][1].test(title)) return BY_KEY.konstitutsiya;
  for (const [key, re] of ID_PATTERNS) if (re.test(id)) return BY_KEY[key];
  // Registry acts are named "<topic>-qonun" / "<topic>-kodeks".
  if (/-(?:qonun|kodeks)$/u.test(String(item.doc_id || ''))) return BY_KEY.qonun;
  // The act-form line ("VAZIRLAR MAHKAMASINING QARORI") names the form; a
  // title can quote another act ("...Qonunini amalga oshirish chora-
  // tadbirlari to'g'risida" is a resolution), so it is read first.
  for (const text of [meta.act_form, meta.actForm, item.act_form, title, meta.publication]) {
    if (!text) continue;
    for (const [key, re] of FORM_PATTERNS.slice(1)) {
      if (key === 'qonun' && text === title && /qaror|farmon|buyru|farmoyish|постановлени|указ|приказ|распоряжени|қарор|фармон|буйру/iu.test(title)) continue;
      if (re.test(String(text))) return BY_KEY[key];
    }
  }
  return null;
}

/** "Yuridik kuchi: Qonun" / "Юридическая сила: Закон", or '' when unknown. */
function legalForceLabel(item = {}, lang = 'uz', identifier = '') {
  const level = legalForceOf(item, identifier);
  if (!level) return '';
  return lang === 'ru' ? `Юридическая сила: ${level.ru}` : `Yuridik kuchi: ${level.uz}`;
}

/** Stable order from the strongest act down; acts of unknown force keep their place after the known ones. */
function sortByLegalForce(items = [], identifierOf = () => '') {
  return items
    .map((item, index) => ({ item, index, rank: (legalForceOf(item, identifierOf(item)) || { rank: 99 }).rank }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(x => x.item);
}

module.exports = { LEVELS, legalForceOf, legalForceLabel, sortByLegalForce };
