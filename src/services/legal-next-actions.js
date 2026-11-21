'use strict';

const { deterministicLegalTopic } = require('./legal-topic-routing');

// Contextual follow-up actions are deliberately deterministic. The legal
// answer model explains the law; this module turns the already-classified
// topic and the user's facts into safe product actions without another model
// call or an opportunity to invent a service.

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`\u00b4]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

function inputField(key, label, type, placeholder, required = true) {
  return { key, label, type, placeholder, required };
}

// Each next-step document carries its own intake contract. This prevents a
// short shared word such as "ariza" from opening an unrelated court-claim
// template and lets the UI ask only for information that document needs.
const DOCUMENT_INPUT_SCHEMAS = Object.freeze({
  'decision-copy-request': Object.freeze([
    inputField('recipient', 'Qabul qiluvchi ta\'lim tashkiloti yoki mansabdor shaxs', 'text', 'Masalan: universitet rektori yoki fakultet dekani'),
    inputField('applicant', 'Arizachi (F.I.O.)', 'text', 'Familiya, ism va otasining ismi'),
    inputField('applicant_details', 'Talaba va aloqa ma\'lumotlari', 'textarea', 'Fakultet, yo\'nalish, bosqich, guruh, telefon yoki elektron pochta'),
    inputField('assessment_details', 'Chetlashtirish holati', 'textarea', 'Fan nomi, nazorat turi, sana, kim chetlashtirgani va sizga aytilgan sabab'),
    inputField('requested_records', 'So\'ralayotgan asos va hujjatlar', 'textarea', 'Masalan: chetlashtirishning yozma asosi, dalolatnoma, buyruq yoki qaror nusxasi'),
    inputField('available_evidence', 'Mavjud dalillar', 'textarea', 'Xabarnoma, yozishma, guvoh, foto yoki boshqa dalillar', false),
    inputField('date', 'Ariza sanasi', 'date', '', true),
  ]),
  application: Object.freeze([
    inputField('recipient', 'Qabul qiluvchi organ yoki mansabdor shaxs', 'text', 'Ariza kimga yuboriladi'),
    inputField('applicant', 'Arizachi (F.I.O. yoki tashkilot)', 'text', 'To\'liq nomi'),
    inputField('applicant_details', 'Manzil va aloqa ma\'lumotlari', 'textarea', 'Manzil, telefon yoki elektron pochta'),
    inputField('circumstances', 'Muhim holatlar', 'textarea', 'Nima sodir bo\'ldi, qachon va qaysi hujjat yoki harakatga taalluqli'),
    inputField('request', 'Arizada so\'ralayotgan natija', 'textarea', 'Organdan nimani so\'raysiz'),
    inputField('attachments', 'Ilova qilinadigan dalillar', 'textarea', 'Mavjud hujjat va dalillar ro\'yxati', false),
    inputField('date', 'Ariza sanasi', 'date', '', true),
  ]),
  complaint: Object.freeze([
    inputField('recipient', 'Shikoyat beriladigan organ', 'text', 'Vakolatli organ yoki mansabdor shaxs'),
    inputField('applicant', 'Shikoyat beruvchi (F.I.O.)', 'text', 'Familiya, ism va otasining ismi'),
    inputField('applicant_details', 'Manzil va aloqa ma\'lumotlari', 'textarea', 'Manzil, telefon yoki elektron pochta'),
    inputField('challenged_act', 'Shikoyat qilinayotgan qaror yoki harakat', 'textarea', 'Qaror raqami va sanasi, uni chiqargan organ yoki sodir etilgan harakat'),
    inputField('grounds', 'Norozilik sabablari va dalillar', 'textarea', 'Nima uchun qaror yoki harakatni noto\'g\'ri deb hisoblaysiz'),
    inputField('request', 'Shikoyat talabi', 'textarea', 'Bekor qilish, qayta ko\'rib chiqish yoki boshqa so\'ralayotgan natija'),
    inputField('date', 'Shikoyat sanasi', 'date', '', true),
  ]),
  demand: Object.freeze([
    inputField('recipient', 'Talabnoma yuboriladigan shaxs yoki tashkilot', 'text', 'Qarzdor yoki majburiyatni bajarishi kerak bo\'lgan tomon'),
    inputField('sender', 'Talabnoma yuboruvchi', 'text', 'F.I.O. yoki tashkilot nomi'),
    inputField('obligation', 'Bajarilmagan majburiyat', 'textarea', 'Nima bajarilmadi, qachondan beri va qaysi hujjatga asoslanadi'),
    inputField('amount', 'Talab qilinayotgan summa', 'text', 'Summa (agar tegishli bo\'lsa)', false),
    inputField('deadline', 'Bajarish uchun muddat', 'text', 'Masalan: talabnoma olinganidan keyin 10 kun'),
    inputField('evidence', 'Mavjud dalillar', 'textarea', 'Shartnoma, hisob-kitob, yozishma yoki boshqa dalillar', false),
    inputField('date', 'Talabnoma sanasi', 'date', '', true),
  ]),
  // a company decision (2026-10-28: an LLC question was offered a complaint
  // against a fine because its answer named the meeting's "bayonnoma")
  'corporate-decision': Object.freeze([
    inputField('company', 'Jamiyat nomi', 'text', "Masalan: \"Misol\" MChJ"),
    inputField('meeting', "Yig'ilish turi va sanasi", 'text', "Ishtirokchilarning umumiy yig'ilishi, sana va joy"),
    inputField('participants', 'Ishtirokchilar va ulushlari', 'textarea', "Har bir ishtirokchi va uning ulushi (%)"),
    inputField('agenda', "Kun tartibi va qabul qilinadigan qarorlar", 'textarea', "Masalan: yangi ishtirokchini qabul qilish, ustav fondini oshirish, ustavga o'zgartirish"),
    inputField('chair', 'Rais va kotib', 'text', "F.I.O.", false),
    inputField('date', 'Hujjat sanasi', 'date', '', true),
  ]),
  claim: Object.freeze([
    inputField('court_name', 'Sud nomi', 'text', 'Vakolatli sudning to\'liq nomi'),
    inputField('plaintiff', 'Da\'vogar va aloqa ma\'lumotlari', 'textarea', 'F.I.O., manzil va telefon'),
    inputField('defendant', 'Javobgar va uning manzili', 'textarea', 'F.I.O. yoki tashkilotning to\'liq nomi va manzili'),
    inputField('circumstances', 'Nizo holatlari', 'textarea', 'Muhim voqealar, sanalar va mavjud dalillar'),
    inputField('claim_amount', 'Da\'vo summasi', 'text', 'Summa (agar tegishli bo\'lsa)', false),
    inputField('demands', 'Suddan so\'ralayotgan talablar', 'textarea', 'Sud qanday qaror chiqarishini so\'raysiz'),
    inputField('date', 'Da\'vo sanasi', 'date', '', true),
  ]),
});

function documentAction(id, label, documentType, serviceSlug, inputSchema = serviceSlug) {
  return {
    id,
    kind: 'document',
    label,
    documentType,
    serviceSlug,
    inputSchema,
    inputFields: DOCUMENT_INPUT_SCHEMAS[inputSchema] || DOCUMENT_INPUT_SCHEMAS.application,
  };
}

function attorneyAction() {
  return {
    id: 'attorney_directory',
    kind: 'attorney',
    label: "Soha bo'yicha advokat topish",
    userSelectsField: true,
    userSelectsRegion: true,
    nationwideAvailable: true,
  };
}

/**
 * Build three safe actions for a completed legal answer. The first two are
 * case-specific drafting services. The third opens the verified nationwide
 * attorney directory, where the user—not the model—selects field and region.
 */
// A complaint, claim or demand fits only when something went wrong; a "how
// do I / which documents" question gets the documents of that procedure.
const DISPUTE = /(nizo|shikoyat|sudga|da'vo|undir|qarz|to'lamadi|to'lamayapti|to'lanmagan|qaytarmadi|qaytarmayapti|bajarmadi|bajarmayapti|buzdi|buzilgan|zarar|rad et|bo'shatishdi|chetlatishdi|jarima|bermayapti|bermadi)/u;
const CORPORATE = /(mchj|mas'uliyati cheklangan|aksiyadorlik|\bustav|ta'sis|ishtirokchi|ulush|umumiy yig'ilish|ustav fond|direktor(?:ni)? tayinla|kuzatuv kengash)/u;
// "bayonnoma" alone is also a meeting's minutes: only an offence report counts
const ADMINISTRATIVE = /(jarima|ma'muriy|huquqbuzarlik bayonnoma|bayonnoma tuzil|qaror ustidan|\bypx\b|\bgai\b|davlat organi)/u;

const TOPIC_BRANCH = Object.freeze({
  talim: 'talim', mehnat: 'mehnat', oila: 'oila', korporativ: 'korporativ',
  mamuriy: 'mamuriy', mamuriy_huquq: 'mamuriy', 'yol-harakati': 'mamuriy', 'davlat-boshqaruvi': 'mamuriy',
  jinoyat: 'jinoyat', soliq: 'soliq',
});

function branchOf(text, legalTopic) {
  if (legalTopic === 'talim' || /(talaba|student|yakuniy nazorat|oraliq nazorat|imtihon|universitet|dekanat|akademik halollik)/u.test(text)) return 'talim';
  if (legalTopic === 'mehnat' || /(ish haqi|oylik|maosh|ishdan bo'shat|mehnat shartnoma)/u.test(text)) return 'mehnat';
  if (legalTopic === 'oila' || /(aliment|nikoh|ajrash|bola ta'minoti|otalik)/u.test(text)) return 'oila';
  if (CORPORATE.test(text)) return 'korporativ';
  if (['mamuriy', 'mamuriy_huquq', 'yol-harakati', 'davlat-boshqaruvi'].includes(legalTopic) || ADMINISTRATIVE.test(text)) return 'mamuriy';
  if (legalTopic === 'jinoyat') return 'jinoyat';
  if (legalTopic === 'soliq') return 'soliq';
  return null;
}

/**
 * Build up to three safe actions for a completed legal answer: case-specific
 * documents, then the verified nationwide attorney directory, where the
 * user - not the model - selects field and region. The question decides the
 * branch, then the classified topic; the answer's words count only when
 * neither does (2026-10-28: an answer's "umumiy yig'ilish bayonnomasi" read
 * as an offence report). A claim or complaint needs trouble in the question.
 */
function buildLegalNextActions({ question = '', answer = '', topic = '' } = {}) {
  // Re-check the completed question/answer instead of trusting UI topic state.
  // Explicit facts in the current question win, then the completed answer,
  // while the supplied topic remains a fallback for ambiguous wording.
  const legalTopic = deterministicLegalTopic(question)
    || deterministicLegalTopic(answer)
    || String(topic || '').toLocaleLowerCase('uz');
  const q = normalized(question);
  const text = normalized(`${question} ${answer}`);
  // the question's words, then the classified topic, then the answer's words
  const branch = branchOf(q, deterministicLegalTopic(question)) || TOPIC_BRANCH[legalTopic] || branchOf(text, legalTopic);
  const dispute = DISPUTE.test(q);
  let actions;

  if (branch === 'talim') {
    const assessment = /(yakuniy nazorat|oraliq nazorat|imtihon|baho|baholash|chetlat)/u.test(text);
    actions = [
      documentAction(
        'document_application',
        assessment ? "Chetlashtirish asosi va dalolatnoma nusxasini so'rab ariza" : "Ta'lim tashkilotiga yozma ariza",
        'Ariza',
        'application',
        assessment ? 'decision-copy-request' : 'application'
      ),
      documentAction(
        'document_complaint',
        assessment ? "Yakuniy nazorat bo'yicha apellyatsiya yoki shikoyat" : "Ta'lim tashkiloti qarori ustidan shikoyat",
        'Shikoyat arizasi',
        'complaint'
      ),
      attorneyAction('talim'),
    ];
  } else if (branch === 'mehnat') {
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
      attorneyAction('mehnat'),
    ];
  } else if (branch === 'oila') {
    const alimony = /aliment/u.test(text);
    actions = [
      documentAction('document_claim', alimony ? "Aliment bo'yicha da'vo arizasi" : "Oilaviy nizo bo'yicha da'vo arizasi", "Da'vo arizasi", 'claim'),
      documentAction('document_application', alimony ? "Aliment masalasi bo'yicha ariza" : "Sudga ariza yoki iltimosnoma", 'Iltimosnoma', 'application'),
      attorneyAction('oila'),
    ];
  } else if (branch === 'korporativ') {
    const joining = /(ishtirokchi|ulush|hissa|qabul qil|kirish)/u.test(q);
    actions = dispute ? [
      documentAction('document_claim', "Korporativ nizo bo'yicha da'vo arizasi", "Da'vo arizasi", 'claim'),
      documentAction('document_demand', "Jamiyat yoki ishtirokchiga yozma talabnoma", 'Talabnoma', 'demand'),
      attorneyAction('korporativ'),
    ] : [
      documentAction('document_decision', "Umumiy yig'ilish qarori (bayonnomasi) loyihasi", "Umumiy yig'ilish bayonnomasi", 'legal-document', 'corporate-decision'),
      joining
        ? documentAction('document_application', "Yangi ishtirokchining jamiyatga kirish haqida arizasi", 'Ariza', 'application')
        : documentAction('document_charter', "Ustavga o'zgartirishlar loyihasi", "Ustavga o'zgartirishlar", 'legal-document', 'corporate-decision'),
      attorneyAction('korporativ'),
    ];
  } else if (branch === 'mamuriy') {
    actions = [
      documentAction('document_complaint', "Qaror yoki jarima ustidan shikoyat", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_application', "Hujjatlar va qaror nusxasini so'rab ariza", 'Ariza', 'application'),
      attorneyAction(legalTopic || 'mamuriy'),
    ];
  } else if (branch === 'jinoyat') {
    actions = [
      documentAction('document_complaint', "Vakolatli organga shikoyat tayyorlash", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_application', "Protsessual ariza yoki iltimosnoma", 'Iltimosnoma', 'application'),
      attorneyAction('jinoyat'),
    ];
  } else if (branch === 'soliq') {
    actions = dispute ? [
      documentAction('document_complaint', "Soliq qarori ustidan shikoyat", 'Shikoyat arizasi', 'complaint'),
      documentAction('document_demand', "Soliq organiga yozma talabnoma", 'Talabnoma', 'demand'),
      attorneyAction('soliq'),
    ] : [
      documentAction('document_application', "Soliq organiga ariza yoki so'rov", 'Ariza', 'application'),
      attorneyAction('soliq'),
    ];
  } else if (dispute) {
    const debt = /(qarz|undirish|to'lamadi|majburiyat)/u.test(text);
    actions = [
      documentAction('document_claim', debt ? "Qarzni undirish bo'yicha da'vo arizasi" : "Huquqiy talab bo'yicha da'vo arizasi", "Da'vo arizasi", 'claim'),
      documentAction('document_demand', debt ? "Qarzdorga yozma talabnoma" : "Qarshi tomonga yozma talabnoma", 'Talabnoma', 'demand'),
      attorneyAction(legalTopic),
    ];
  } else {
    // an informational question: no claim or complaint against anyone
    actions = [
      documentAction('document_application', "Vakolatli organga ariza", 'Ariza', 'application'),
      attorneyAction(legalTopic),
    ];
  }

  return actions.slice(0, 3);
}

module.exports = {
  buildLegalNextActions,
};
