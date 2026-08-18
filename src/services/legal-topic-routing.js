'use strict';

function normalizeTopicText(text = '') {
  return String(text || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return a topic only for language that is unambiguous enough to override an
 * LLM classifier. Generic role words such as "xodim" are intentionally not a
 * legal field by themselves: a YPX xodimi is not an employment-law question.
 */
function deterministicLegalTopic(text = '') {
  const normalized = normalizeTopicText(text);

  if (/(?:\bypx\b|\bgai\b|\bdyhxx\b|\byhxx\b|yol patrul xizmati|yol harakati xavfsizligi|patrul avtomobil|haydovchilik guvohnoma)/u.test(normalized)) {
    return 'yol-harakati';
  }

  // Education questions frequently contain words such as "chetlashtirish" or
  // "tashkilot" that a broad classifier can confuse with dismissal from
  // employment. Exam, student and academic-assessment language is much more
  // specific and therefore wins before the labor-law rule below.
  if (/(?:talaba|student|yakuniy nazorat|oraliq nazorat|imtihon|akademik halollik|dekanat|rektorat|universitet|institut|kontrakt asosida oqish|oqishdan chetlat)/u.test(normalized)) {
    return 'talim';
  }

  if (/(?:mehnat shartnom|ish haqi|ish beruvchi|ishdan boshat|ishga tikla|oylik maosh|xodim(?:ni|ning|ga|dan)?\s+(?:boshat|ishga tikla|ish haqi|maosh|oylik|mehnat))/u.test(normalized)) {
    return 'mehnat';
  }

  return null;
}

module.exports = { deterministicLegalTopic, normalizeTopicText };
