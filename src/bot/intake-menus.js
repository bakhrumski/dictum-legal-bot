'use strict';

// Telegram callback payloads must stay below 64 bytes, so stable short codes
// are used here and expanded into explicit, auditable matching criteria.
const ATTORNEY_FIELDS = Object.freeze({
  civil: {
    label: 'Fuqarolik va meros',
    registryField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
    category: 'Fuqarolik qonunchiligi',
  },
  family: {
    label: 'Oila va aliment',
    registryField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
    category: 'Oila qonunchiligi',
  },
  labor: {
    label: 'Mehnat huquqi',
    registryField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
    category: 'Mehnat va aholining bandligi',
  },
  business: {
    label: 'Biznes va iqtisodiy nizolar',
    registryField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
    category: "Tadbirkorlik va xo'jalik faoliyati",
  },
  criminal: {
    label: 'Jinoyat ishlari',
    registryField: "Ma'muriy va jinoiy sud ishlarini yuritish",
    category: 'Jinoyat qonunchiligi',
  },
  administrative: {
    label: "Ma'muriy ishlar va jarimalar",
    registryField: "Ma'muriy va jinoiy sud ishlarini yuritish",
    category: "Ma'muriy javobgarlik",
  },
  unsure: {
    label: "Yo'nalishni bilmayman",
    registryField: '',
    category: 'Boshqa',
    needsHumanFieldReview: true,
  },
});

const ATTORNEY_REGIONS = Object.freeze({
  tashkent_city: { label: 'Toshkent shahri', value: 'Toshkent shahar' },
  tashkent: { label: 'Toshkent viloyati', value: 'Toshkent viloyati' },
  andijon: { label: 'Andijon', value: 'Andijon viloyati' },
  buxoro: { label: 'Buxoro', value: 'Buxoro viloyati' },
  fargona: { label: "Farg'ona", value: "Farg'ona viloyati" },
  jizzax: { label: 'Jizzax', value: 'Jizzax viloyati' },
  xorazm: { label: 'Xorazm', value: 'Xorazm viloyati' },
  namangan: { label: 'Namangan', value: 'Namangan viloyati' },
  navoiy: { label: 'Navoiy', value: 'Navoiy viloyati' },
  qashqadaryo: { label: 'Qashqadaryo', value: 'Qashqadaryo viloyati' },
  qoraqalpogiston: { label: "Qoraqalpog'iston", value: "Qoraqalpog'iston Respublikasi" },
  samarqand: { label: 'Samarqand', value: 'Samarqand viloyati' },
  sirdaryo: { label: 'Sirdaryo', value: 'Sirdaryo viloyati' },
  surxondaryo: { label: 'Surxondaryo', value: 'Surxondaryo viloyati' },
  any: { label: 'Barcha hududlar', value: '' },
});

const DOCUMENT_TYPES = Object.freeze({
  claim: { label: "Da'vo arizasi", serviceSlug: 'claim', category: 'Odil sudlov' },
  complaint: { label: 'Shikoyat yoki apellyatsiya', serviceSlug: 'complaint', category: 'Odil sudlov' },
  application: { label: 'Ariza yoki iltimosnoma', serviceSlug: 'application', category: "Shaxsiy tusdagi hujjatlar" },
  contract: { label: 'Shartnoma', serviceSlug: 'contract', category: 'Fuqarolik qonunchiligi' },
  opinion: { label: 'Yuridik xulosa', serviceSlug: 'legal-opinion', category: 'Boshqa' },
  other: { label: 'Boshqa hujjat', serviceSlug: 'legal-document', category: "Shaxsiy tusdagi hujjatlar" },
});

function rows(items, prefix, columns = 2) {
  const result = [];
  for (let i = 0; i < items.length; i += columns) {
    result.push(items.slice(i, i + columns).map(([code, item]) => ({
      text: item.label,
      callback_data: `${prefix}${code}`,
    })));
  }
  return result;
}

function serviceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Huquqiy savol', callback_data: 'svc_legal' }],
      [{ text: 'Advokat topish', callback_data: 'svc_attorney' }],
      [{ text: 'Hujjat tayyorlash', callback_data: 'svc_document' }],
    ],
  };
}

function attorneyFieldKeyboard() {
  return {
    inline_keyboard: [
      ...rows(Object.entries(ATTORNEY_FIELDS), 'atf_'),
      [{ text: 'Bosh menyu', callback_data: 'intake_home' }],
    ],
  };
}

function attorneyRegionKeyboard() {
  return {
    inline_keyboard: [
      ...rows(Object.entries(ATTORNEY_REGIONS), 'atr_'),
      [{ text: 'Orqaga', callback_data: 'svc_attorney' }],
    ],
  };
}

function documentTypeKeyboard() {
  return {
    inline_keyboard: [
      ...rows(Object.entries(DOCUMENT_TYPES), 'doc_'),
      [{ text: 'Bosh menyu', callback_data: 'intake_home' }],
    ],
  };
}

/** Pure callback resolver: no database, Telegram API, or AI call. */
function resolveIntakeCallback(data, currentContext = {}) {
  if (data === 'intake_home') {
    return {
      reset: true,
      state: 'idle',
      context: {},
      message: 'Kerakli xizmatni tanlang:',
      replyMarkup: serviceKeyboard(),
    };
  }
  if (data === 'svc_legal') {
    return {
      reset: true,
      state: 'legal_question_intake',
      context: {},
      message: "Huquqiy vaziyatingizni yozing: nima sodir bo'ldi, qachon va siz qanday natija xohlaysiz?",
    };
  }
  if (data === 'svc_attorney') {
    return {
      reset: true,
      state: 'attorney_field',
      context: {},
      message: "Advokat qaysi huquq yo'nalishi bo'yicha kerak?",
      replyMarkup: attorneyFieldKeyboard(),
    };
  }
  if (data === 'svc_document') {
    return {
      reset: true,
      state: 'document_type',
      context: {},
      message: "Hujjat tayyorlash pullik xizmat bo'lib, buyurtma yurist tasdig'idan keyin qabul qilinadi. Kerakli hujjat turini tanlang:",
      replyMarkup: documentTypeKeyboard(),
    };
  }

  if (data.startsWith('atf_')) {
    const code = data.slice(4);
    const field = ATTORNEY_FIELDS[code];
    if (!field) return null;
    return {
      state: 'attorney_region',
      context: {
        fieldCode: code,
        fieldLabel: field.label,
        legalField: field.registryField,
        category: field.category,
        strictField: Boolean(field.registryField),
        needsHumanFieldReview: Boolean(field.needsHumanFieldReview),
      },
      message: `Tanlangan yo'nalish: ${field.label}\n\nQaysi hududdan advokat kerak?`,
      replyMarkup: attorneyRegionKeyboard(),
    };
  }

  if (data.startsWith('atr_')) {
    const code = data.slice(4);
    const region = ATTORNEY_REGIONS[code];
    if (!region) return null;
    if (!currentContext.fieldCode) {
      return {
        state: 'attorney_field',
        context: {},
        message: "Avval huquq yo'nalishini tanlang:",
        replyMarkup: attorneyFieldKeyboard(),
      };
    }
    return {
      state: 'attorney_problem',
      context: {
        ...currentContext,
        regionCode: code,
        region: region.value,
        regionLabel: region.label,
        strictRegion: Boolean(region.value),
      },
      message: [
        `Yo'nalish: ${currentContext.fieldLabel}`,
        `Hudud: ${region.label}`,
        '',
        "Endi huquqiy muammoni 1–3 gapda yozing: nima sodir bo'ldi, ish qaysi bosqichda va qanday yordam kerak?",
        "Advokatlar faqat shu ma'lumotlardan keyin tanlanadi.",
      ].join('\n'),
    };
  }

  if (data.startsWith('doc_')) {
    const code = data.slice(4);
    const documentType = DOCUMENT_TYPES[code];
    if (!documentType) return null;
    return {
      state: 'document_details',
      context: {
        documentTypeCode: code,
        documentTypeLabel: documentType.label,
        serviceSlug: documentType.serviceSlug,
        category: documentType.category,
      },
      message: [
        `Tanlangan hujjat: ${documentType.label}.`,
        "Bu pullik xizmat; narx va bajarish muddati mas'ul yurist tekshiruvidan keyin tasdiqlanadi.",
        '',
        "Vaziyatni, tomonlarni, mavjud hujjatlarni va muddatni qisqacha yozing. Shaxsiy maxfiy ma'lumotlarni hozircha yubormang.",
      ].join('\n'),
    };
  }

  return null;
}

module.exports = {
  ATTORNEY_FIELDS,
  ATTORNEY_REGIONS,
  DOCUMENT_TYPES,
  serviceKeyboard,
  attorneyFieldKeyboard,
  attorneyRegionKeyboard,
  documentTypeKeyboard,
  resolveIntakeCallback,
};
