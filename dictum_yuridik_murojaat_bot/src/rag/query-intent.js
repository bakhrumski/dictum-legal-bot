'use strict';

function normalizeQueryText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[’`ʻʼʹ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isDefinitionQuery(text = '') {
  const query = normalizeQueryText(text);
  if (!query) return false;

  const patterns = [
    /\bkim\s*\??$/u,
    /\bnima\s*\??$/u,
    /\bkim\s+hisoblanadi\b/u,
    /\bnima\s+hisoblanadi\b/u,
    /\bdegani\b/u,
    /\bmazmuni\b/u,
    /\bta'rifi\b/u,
    /\bta'rif\b/u,
    /\bnima o'zi\b/u,
    /\bnimani anglatadi\b/u,
    /\bqanday tushuniladi\b/u,
    /\bhuquqiy maqomi\b/u,
    /\bhuquqiy maqom\b/u,
  ];

  return patterns.some((pattern) => pattern.test(query));
}

function getDefinitionPromptAddendum(text = '') {
  if (!isDefinitionQuery(text)) return '';

  return `
DEFINITSIYA SAVOLI ANIQLANDI:
- Foydalanuvchi atamaning bevosita huquqiy ta'rifi yoki kimligini so'rayapti.
- Javobning BIRINCHI 1-2 gapida aynan shu tushunchaning bevosita ta'rifini bering.
- Agar kontekstda ta'rif berilgan modda bo'lsa, birinchi xatboshida o'sha moddaning mazmunini sodda va aniq bayon qiling.
- Bu holatda savoldagi tushunchani tushuntirish TAQIQLANMAYDI; aksincha bu javobning markaziy qismi bo'lishi shart.
`;
}

function getTermExplanationRule(text = '') {
  if (isDefinitionQuery(text)) {
    return "- Bu definitsiya savoli: savoldagi tushunchani aynan kontekstdagi huquqiy mazmuni bilan bevosita tushuntiring.";
  }

  return "- Savolda berilgan tushunchani qayta tushuntirmang - foydalanuvchi buni allaqachon biladi.";
}

module.exports = {
  getDefinitionPromptAddendum,
  getTermExplanationRule,
  isDefinitionQuery,
  normalizeQueryText,
};
