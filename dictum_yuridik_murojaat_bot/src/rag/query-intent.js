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

  return `[Definitsiya rejimi: Javobning birinchi 1-2 gapida tushunchaning bevosita huquqiy ta'rifini bering. Agar kontekstda ta'rif berilgan modda bo'lsa, birinchi xatboshida shu moddaning mazmunini sodda va aniq bayon qiling. Bu sarlavha emas — javobda ko'rsatmang.]`;
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
