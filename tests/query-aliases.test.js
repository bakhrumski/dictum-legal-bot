'use strict';

const assert = require('assert');
const { expandLegalQueryAliases } = require('../src/rag/query-aliases');
const { buildCorpusOnlyAnswer } = require('../src/rag/corpus-fallback');

const expanded = expandLegalQueryAliases("Pravam yonimda emas. GAI to'xtatdi.");
assert.match(expanded, /haydovchilik guvohnomasi/i);
assert.match(expanded, /YPX/);
assert.match(expanded, /ID-karta/);

const ypxIncident = expandLegalQueryAliases(
  "YPX xodimi nimaga to'xtatganini tushuntirmadi, mashinadan tush dedi, planshetga qo'l qo'ymasam qamab qo'yishini aytdi."
);
assert.match(ypxIncident, /to'xtatish sababini tushuntirish/i);
assert.match(ypxIncident, /kabinasidan chiqmasdan/i);
assert.match(ypxIncident, /ma'muriy bayonnoma/i);
assert.match(ypxIncident, /ushlab turish asoslari/i);

const fallback = buildCorpusOnlyAnswer("Pravam yonimda emas", [{
  law_name: 'VMQ-172 Yo\'l harakati qoidalari',
  source_url: 'https://lex.uz/docs/-5953883',
  is_active: true,
  chunk_text: "Biometrik pasport yoki ID-karta yonida bo'lsa, haydovchilik guvohnomasi talab etilmaydi va planshet orqali tekshiriladi.",
}]);
assert.match(fallback, /asosli ko'rinmaydi/i);
assert.match(fallback, /https:\/\/lex\.uz\/docs\/-5953883/);

// "IT park" -> the acts' own term (VMQ-589), 2026-10-13
assert.match(expandLegalQueryAliases('Men IT park rezidentiman, chet ellik mutaxassis olsam bo\'ladimi?'), /Texnopark rezidenti/);
assert.match(expandLegalQueryAliases('IT-park'), /texnologik parki/);
assert.doesNotMatch(expandLegalQueryAliases('kredit parametrlari'), /Texnopark/);
// another technopark is not taken for IT Park
assert.doesNotMatch(expandLegalQueryAliases('Yashnobod innovatsion texnoparki rezidenti'), /dasturiy mahsulotlar|IT Park/);

console.log('query aliases and corpus fallback: OK');
