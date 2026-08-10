'use strict';

/**
 * Expand common Uzbek/Russian colloquialisms into the terminology used by
 * Uzbek legal acts. The original query is always preserved.
 */
function expandLegalQueryAliases(query) {
  if (!query) return query;

  const text = String(query);
  const lower = text.toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const aliases = [];

  const asksAboutLicence = /\bprava(?:m|si|ni|ga|dan)?\b/u.test(lower)
    || /haydovchilik\s+guvohnoma/u.test(lower)
    || /boshqarish\s+huquqini\s+beruvchi\s+hujjat/u.test(lower);

  if (asksAboutLicence) {
    aliases.push('haydovchilik guvohnomasi transport vositasini boshqarish huquqini beruvchi hujjat');
  }

  if (/\b(?:gai|dan|ypx|dyhxx|yhxx)\b/u.test(lower)) {
    aliases.push("YPX DYHXX YHXX yo'l-patrul xizmati yo'l harakati xavfsizligi xizmati IIO xodimi");
  }

  const physicalDocumentMissing = /(?:yon(?:im|ida)?da\s+(?:yo'q|emas)|uyda\s+qol|unut|olib\s+(?:chiq|yur)ma)/u.test(lower);
  if (asksAboutLicence && physicalDocumentMissing) {
    aliases.push("yonida olib yurishi biometrik pasport ID-karta planshet orqali tekshiriladi talab etilmaydi");
  }

  return aliases.length > 0 ? `${text} ${aliases.join(' ')}` : text;
}

module.exports = { expandLegalQueryAliases };
