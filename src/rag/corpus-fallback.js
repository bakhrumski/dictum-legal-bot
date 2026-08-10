'use strict';

function safeLexUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\/(?:www\.)?lex\.uz\//i.test(url) ? url : '';
}

function compactExcerpt(text, maxChars = 420) {
  const cleaned = String(text || '')
    .replace(/^\s*\(davomi\)\s*/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const cut = cleaned.slice(0, maxChars);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (sentenceEnd > 160 ? cut.slice(0, sentenceEnd + 1) : cut) + '…';
}

function isPhysicalLicenceQuestion(question) {
  const q = String(question || '').toLowerCase().replace(/[‘’`´]/g, "'");
  const licence = /\bprava(?:m|si|ni|ga|dan)?\b/u.test(q)
    || /haydovchilik\s+guvohnoma/u.test(q);
  const missing = /(?:yon(?:im|ida)?da\s+(?:yo'q|emas)|uyda\s+qol|unut|olib\s+(?:chiq|yur)ma)/u.test(q);
  return licence && missing;
}

/**
 * Produce a conservative, source-grounded response when no generative model is
 * configured. It never invents article numbers or URLs.
 */
function buildCorpusOnlyAnswer(question, chunks = []) {
  const usable = (Array.isArray(chunks) ? chunks : [])
    .filter(chunk => chunk && chunk.chunk_text && chunk.is_active !== false);

  if (isPhysicalLicenceQuestion(question)) {
    const rule = usable.find(chunk => {
      const body = String(chunk.chunk_text).toLowerCase();
      return body.includes('biometrik pasport')
        && body.includes('id-karta')
        && body.includes('talab etilmaydi')
        && body.includes('planshet orqali tekshiriladi');
    });

    if (rule) {
      const sourceUrl = safeLexUrl(rule.source_url);
      const sourceLine = sourceUrl
        ? `**Manba:** [Yo'l harakati qoidalari, 7-band](${sourceUrl})`
        : `**Manba:** ${rule.law_name || "Yo'l harakati qoidalari"}, 7-band.`;

      return [
        "Bu holat yoningizda shaxsni tasdiqlovchi hujjat bo'lgan-bo'lmaganiga bog'liq.",
        "Agar yoningizda O'zbekiston IIO yoki konsullik muassasasi bergan **biometrik pasport yoki ID-karta** bo'lgan bo'lsa, haydovchilik guvohnomasining qog'oz/plastik nusxasi talab qilinmaydi. Guvohnoma YHXX xodimi tomonidan planshet orqali tekshirilishi kerak. Shuning uchun faqat “prava yonimda emas” degan sabab bilan jarima qo'llash bunday holatda asosli ko'rinmaydi.",
        "Agar pasport yoki ID-karta ham yoningizda bo'lmagan bo'lsa, yoxud ma'lumotni planshetda aniqlash imkoni bo'lmagan favqulodda holat yuz bergan bo'lsa, huquqiy baho boshqacha bo'lishi mumkin. Jarima qarori yoki bayonnomada ko'rsatilgan aniq modda va sababni tekshiring.",
        sourceLine,
      ].join('\n\n');
    }
  }

  if (usable.length === 0) {
    return "Savol bo'yicha qonunchilik korpusidan yetarli aniq norma topilmadi. AI tahlil xizmati ham hozircha sozlanmagan; savolni aniqroq yozing yoki hujjat/modda raqamini kiriting.";
  }

  const items = usable.slice(0, 3).map((chunk, index) => {
    const title = chunk.law_name || `Manba ${index + 1}`;
    const url = safeLexUrl(chunk.source_url);
    const label = url ? `[${title}](${url})` : `**${title}**`;
    return `${index + 1}. ${label}\n${compactExcerpt(chunk.chunk_text)}`;
  });

  return [
    "AI tahlil xizmati ulanmaganligi sababli qonunchilik korpusidan topilgan eng yaqin normalar ko'rsatilmoqda. Ular savolga to'liq yuridik xulosa bermasligi mumkin.",
    ...items,
  ].join('\n\n');
}

module.exports = { buildCorpusOnlyAnswer, isPhysicalLicenceQuestion };
