'use strict';

const { deterministicLegalTopic } = require('./legal-topic-routing');

// Contextual follow-up actions are deliberately deterministic. The legal
// answer model explains the law; this module turns the already-classified
// topic and the user's facts into safe product actions without another model
// call or an opportunity to invent a service.

const ATTORNEY_FIELDS = Object.freeze({
  mehnat: 'labor',
  oila: 'family',
  fuqarolik: 'civil',
  tadbirkorlik: 'business',
  bank: 'business',
  'uy-joy': 'civil',
  soliq: 'tax',
  mamuriy: 'administrative',
  mamuriy_huquq: 'administrative',
  'davlat-boshqaruvi': 'administrative',
  'yol-harakati': 'administrative',
  talim: 'administrative',
  jinoyat: 'criminal',
});

const ATTORNEY_FIELD_CODES = Object.freeze({
  mehnat: 'labor',
  oila: 'family',
  fuqarolik: 'civil',
  tadbirkorlik: 'business',
  bank: 'business',
  'uy-joy': 'civil',
  soliq: 'administrative',
  mamuriy: 'administrative',
  mamuriy_huquq: 'administrative',
  'davlat-boshqaruvi': 'administrative',
  'yol-harakati': 'administrative',
  talim: 'administrative',
  jinoyat: 'criminal',
});

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`\u00b4]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function documentAction(id, label, documentType, serviceSlug) {
  return { id, kind: 'document', label, documentType, serviceSlug };
}

function attorneyAction(topic, label) {
  return {
    id: `attorney_${ATTORNEY_FIELD_CODES[topic] || 'unsure'}`,
    kind: 'attorney',
    label,
    attorneyFieldCode: ATTORNEY_FIELD_CODES[topic] || 'unsure',
    attorneyField: ATTORNEY_FIELDS[topic] || '',
  };
}

/**
 * Build at most four safe actions for a completed legal answer.
 * The first two are existing paid drafting services, the third searches the
 * verified attorney directory, and the fourth simply returns focus to chat.
 */
function buildLegalNextActions({ question = '', answer = '', topic = '' } = {}) {
  // Re-check the completed question/answer instead of trusting UI topic state.
  // Explicit facts in the current question win, then the completed answer,
  // while the supplied topic remains a fallback for ambiguous wording.
  const legalTopic = deterministicLegalTopic(question)
    || deterministicLegalTopic(answer)
    || String(topic || '').toLocaleLowerCase('uz');
  const text = normalized(`${question} ${answer}`);
  let actions;

  if (legalTopic === 'talim' || /(talaba|student|yakuniy nazorat|oraliq nazorat|imtihon|universitet|dekanat|akademik halollik)/u.test(text)) {
    const assessment = /(yakuniy nazorat|oraliq nazorat|imtihon|baho|baholash|chetlat)/u.test(text);
    actions = [
      documentAction(
        'document_application',
        assessment ? "Chetlashtirish asosi va dalolatnoma nusxasini so'rab ariza" : "Ta'lim tashkilotiga yozma ariza",
        'Ariza',
        'application'
      ),
      documentAction(
        'document_complaint',
        assessment ? "Yakuniy nazorat bo'yicha apellyatsiya yoki shikoyat" : "Ta'lim tashkiloti qarori ustidan shikoyat",
        'Shikoyat arizasi',
        'complaint'
      ),
      attorneyAction('talim', "Ta'lim huquqi bo'yicha advokat topish"),
    ];
  } else if (legalTopic === 'mehnat' || /(ish haqi|oylik|maosh|ishdan bo'shat|mehnat shartnoma)/u.test(text)) {
    const unpaid = /(ish haqi|oylik|maosh).*(ber|to'la|undir)|to'lanmagan/u.test(text);
    const dismissed = /ishdan bo'shat|ishga tikla/u.test(text);
    actions = [
      documentAction(
        'document_claim',
        dismissed ? "Ishga tiklash va ish haqini undirish bo'yicha da'vo arizasi" : "Ish haqini undirish bo'yicha da'vo arizasi",
        "Da'vo arizasi",
        'claim'
      ),
      documentAction(
        'document_demand',
        unpaid ? "Ish beruvchiga ish haqini to'lash haqida talabnoma" : "Ish beruvchiga yozma talabnoma",
        'Talabnoma',
        'demand'
      ),
      attorneyAction('mehnat', 'Mehnat nizolari bo\'yicha advokat topish'),
    ];
  } else if (legalTopic === 'oila' || /(aliment|nikoh|ajrash|bola ta'minoti|otalik)/u.test(text)) {
    const alimony = /aliment/u.test(text);
    actions = [
      documentAction('document_claim', alimony ? "Aliment bo'yicha da'vo arizasi" : "Oilaviy nizo bo'yicha da'vo arizasi", "Da'vo arizasi", 'claim'),
      documentAction('document_application', alimony ? "Aliment masalasi bo'yicha ariza" : "Sudga ariza yoki iltimosnoma", 'Iltimosnoma', 'application'),
      attorneyAction('oila', alimony ? "Aliment bo'yicha advokat topish" : "Oila huquqi bo'yicha advokat topish"),
    ];
  } else if (['mamuriy', 'mamuriy_huquq', 'yol-harakati', 'davlat-boshqaruvi'].includes(legalTopic)
      || /(jarima|bayonnoma|qaror ustidan|ypx|gai|davlat organ)/u.test(text)) {
    actions = [
      documentAction('document_complaint', "Qaror yoki jarima ustidan shikoyat", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_application', "Hujjatlar va qaror nusxasini so'rab ariza", 'Ariza', 'application'),
      attorneyAction(legalTopic || 'mamuriy', "Ma'muriy ishlar bo'yicha advokat topish"),
    ];
  } else if (legalTopic === 'jinoyat') {
    actions = [
      documentAction('document_complaint', "Vakolatli organga shikoyat tayyorlash", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_application', "Protsessual ariza yoki iltimosnoma", 'Iltimosnoma', 'application'),
      attorneyAction('jinoyat', "Jinoyat ishlari bo'yicha advokat topish"),
    ];
  } else if (legalTopic === 'soliq') {
    actions = [
      documentAction('document_complaint', "Soliq qarori ustidan shikoyat", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_demand', "Soliq organiga yozma talabnoma", 'Talabnoma', 'demand'),
      attorneyAction('soliq', "Soliq nizolari bo'yicha advokat topish"),
    ];
  } else {
    const debt = /(qarz|undirish|to'lamadi|majburiyat)/u.test(text);
    actions = [
      documentAction('document_claim', debt ? "Qarzni undirish bo'yicha da'vo arizasi" : "Huquqiy talab bo'yicha da'vo arizasi", "Da'vo arizasi", 'claim'),
      documentAction('document_demand', debt ? "Qarzdorga yozma talabnoma" : "Qarshi tomonga yozma talabnoma", 'Talabnoma', 'demand'),
      attorneyAction(legalTopic, "Masala bo'yicha advokat topish"),
    ];
  }

  actions.push({ id: 'custom', kind: 'custom', label: "Boshqa keyingi qadamni o'zim yozaman" });
  return actions.slice(0, 4);
}

module.exports = {
  ATTORNEY_FIELDS,
  ATTORNEY_FIELD_CODES,
  buildLegalNextActions,
};
