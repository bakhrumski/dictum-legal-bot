'use strict';

/**
 * Expand common Uzbek/Russian colloquialisms into the terminology used by
 * Uzbek legal acts. The original query is always preserved.
 */
function expandLegalQueryAliases(query) {
  if (!query) return query;

  const text = String(query);
  const lower = text.toLowerCase()
    .replace(/[\u02bb\u02bc\u2018\u2019`\u00b4]/gu, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const aliases = [];

  const asksAboutLicence = /\bprava(?:m|si|ni|ga|dan)?\b/u.test(lower)
    || /haydovchilik\s+guvohnoma/u.test(lower)
    || /boshqarish\s+huquqini\s+beruvchi\s+hujjat/u.test(lower);

  if (asksAboutLicence) {
    aliases.push('haydovchilik guvohnomasi transport vositasini boshqarish huquqini beruvchi hujjat');
  }

  const trafficPolice = /\b(?:gai|dan|ypx|dyhxx|yhxx)\b/u.test(lower)
    || /yo['’]?l[-\s]?patrul\s+xizmati/u.test(lower);

  if (trafficPolice) {
    aliases.push("YPX DYHXX YHXX yo'l-patrul xizmati yo'l harakati xavfsizligi xizmati IIO xodimi");
  }

  if (trafficPolice && /(?:nimaga|nega|sabab|asos|tushuntir)/u.test(lower)) {
    aliases.push("transport vositasini to'xtatish asoslari to'xtatish sababini tushuntirish");
  }

  if (trafficPolice && /(?:mashinadan|avtomobildan|kabina|tush(?:ing|irdi| dedi)?)/u.test(lower)) {
    aliases.push("transport vositasi kabinasidan chiqmasdan qolish avtomobildan tushirish talabi");
  }

  if (trafficPolice && /(?:planshet|imzo|qo['’]?l\s+qo['’]?y|bayonnoma|qaror)/u.test(lower)) {
    aliases.push("ma'muriy bayonnoma mazmuni tushuntirish e'tiroz imzo nusxa");
  }

  if (trafficPolice && /(?:qamab|qamoq|ushlab|tahdid)/u.test(lower)) {
    aliases.push("ma'muriy ushlab turish asoslari qamoqqa olish bilan tahdid");
  }

  const physicalDocumentMissing = /(?:yon(?:im|ida)?da\s+(?:yo'q|emas)|uyda\s+qol|unut|olib\s+(?:chiq|yur)ma)/u.test(lower);
  if (asksAboutLicence && physicalDocumentMissing) {
    aliases.push("yonida olib yurishi biometrik pasport ID-karta planshet orqali tekshiriladi talab etilmaydi");
  }

  return aliases.length > 0 ? `${text} ${aliases.join(' ')}` : text;
}

module.exports = { expandLegalQueryAliases };
