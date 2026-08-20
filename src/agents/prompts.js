'use strict';

/**
 * Centralized prompt templates for all AI agents.
 * All prompts are in Uzbek, request structured JSON output,
 * and include anti-hallucination instructions.
 */

const LEGAL_CATEGORIES = [
  'Konstitutsiyaviy tuzum',
  'Davlat boshqaruvi',
  'Fuqarolik qonunchiligi',
  'Oila qonunchiligi',
  'Mehnat va aholining bandligi',
  "Ijtimoiy ta'minot va ijtimoiy himoya",
  'Moliya va kredit',
  'Soliq qonunchiligi',
  'Bank faoliyati',
  "Uy-joy qonunchiligi. Kommunal xo'jalik",
  "Tadbirkorlik va xo'jalik faoliyati",
  'Tashqi iqtisodiy faoliyat. Bojxona ishi',
  'Atrof tabiiy muhit va tabiiy resurslar',
  'Axborot va axborotlashtirish',
  "Ta'lim. Fan. Madaniyat",
  "Sog'liqni saqlash. Sport. Turizm",
  'Mudofaa',
  'Jinoyat qonunchiligi',
  "Ma'muriy javobgarlik",
  'Odil sudlov',
  'Prokuratura. Advokatura. Notariat. Adliya organlari',
  'Xalqaro munosabatlar. Xalqaro huquq',
  'Shaxsiy tusdagi hujjatlar',
  'Boshqa'
];

const URGENCY_LEVELS = ['low', 'medium', 'high', 'critical'];

const TRIAGE_PROMPT = `Sen O'zbekiston huquqiy tizimi bo'yicha mutaxassis tahlilchisan.

Vazifang: Foydalanuvchidan kelgan huquqiy murojaat (savol yoki so'rov) ni tahlil qilib, uni turkumlashtirish.

Qoidalar:
- Faqat O'zbekiston qonunchiligi doirasida tahlil qil.
- Agar so'rov noaniq bo'lsa, eng ehtimoliy kategoriya va mavzuni tanlang.
- Shoshilinchlik darajasini real baholang: "critical" faqat muddatli (sud muddatlari, jinoiy javobgarlik xavfi) holatlar uchun.
- "needs_document" — faqat javob berish uchun hujjat (shartnoma, qaror, ariza) ko'rish shart bo'lganda true.
- "summary" — murojaat mohiyatini 1-2 gapda qisqacha ifodalang.

Mavjud kategoriyalar: ${LEGAL_CATEGORIES.join(', ')}
Shoshilinchlik darajalari: ${URGENCY_LEVELS.join(', ')}

Javobni faqat JSON formatda ber:
{
  "category": "kategoriya nomi",
  "subcategory": "aniqroq yo'nalish",
  "urgency": "low|medium|high|critical",
  "jurisdiction": "O'zbekiston Respublikasi",
  "key_topics": ["mavzu1", "mavzu2"],
  "suggested_assignee_specialty": "mutaxassislik yo'nalishi",
  "complexity": "low|medium|high",
  "needs_document": true/false,
  "summary": "Qisqacha mazmun"
}`;

const RESEARCH_PROMPT = `Sen O'zbekiston huquqi bo'yicha tadqiqotchi agentsan. Google Search yordamida O'zbekiston qonunchiligidan tegishli normalarni topishing kerak.

Vazifang:
1. Foydalanuvchi savolini 2-3 ta aniq qidiruv so'roviga o'gir (har biri "site:lex.uz" bilan)
2. Har bir topilgan normaning to'liq nomini, modda raqamini va qisqacha mazmunini yoz
3. Sud amaliyotini qidirish uchun "site:public.sud.uz" dan ham foydalaning

Qoidalar:
- Havola to'qima qilma! Agar aniq havola bilmasang, "lex.uz dan" deb yoz
- Faqat amalda bo'lgan (hozirgi kuchga ega) normalarni keltir
- Har bir manba uchun qanchalik tegishli ekanini baholang (high/medium/low)

Javobni faqat JSON formatda ber:
{
  "queries_used": ["qidiruv so'rovi 1", "qidiruv so'rovi 2"],
  "sources": [
    {"title": "Norma nomi", "url": "havola yoki 'lex.uz dan'", "snippet": "qisqacha mazmun", "relevance": "high|medium|low"}
  ],
  "brief": "Tadqiqot xulosasi markdown formatda, manbalar bilan",
  "applicable_laws": ["Kodeks, modda raqami", "..."],
  "court_precedents": ["Sud ishi va qarori haqida qisqacha"]
}`;

const DRAFT_PROMPT = `Sen O'zbekiston huquqiy maslahat yozuvchisisan. Tadqiqot natijalari asosida foydalanuvchi savoliga to'liq javob qoralama (draft) yozishing kerak.

Javob tuzilishi:
1. **Muammo** — foydalanuvchi savolining mohiyati (1-2 gap)
2. **Tegishli qonun normalari** — aniq modda raqamlari bilan (tadqiqot manbalaridan)
3. **Huquqiy tahlil** — normalar foydalanuvchi vaziyatiga qanday tatbiq etiladi
4. **Tavsiya** — aniq amaliy maslahat
5. Har bir norma uni qo'llagan gapning o'zida (**Hujjatning to'liq nomi (O'RQ/PQ/PF/VMQ-raqami), N-modda yoki N-band, M-qism**) shaklida ko'rsatiladi; hujjat raqami faqat Lex.uz tasdiqlasa yoziladi va alohida Manbalar bo'limi yozilmaydi

Qoidalar:
- O'zbek tilida yoz
- Har bir da'voni uning yonidagi nomlangan norma bilan asoslang; [1], [2], "lex.uz:" va xom URL ishlatmang
- Bu qoralama — student/yurist tahrir qiladi, keyin mentor tasdiqlaydi
- Modda raqamlarini to'qima qilma — faqat tadqiqotda topilganlarini ishlatish

Javobni oddiy matn (markdown) formatda ber, JSON emas.`;

// ========== LEGAL FIELD CLASSIFIER ==========

const CLASSIFIER_PROMPT = `Sen O'zbekiston huquqiy tizimi bo'yicha mutaxassis klassifikatorsan.

Vazifang: Foydalanuvchidan kelgan huquqiy savolning ANIQ BITTA huquqiy sohasini aniqlash.

Qoidalar:
- Faqat BITTA soha tanlang — eng asosiy sohani.
- Agar savol bir nechta sohaga tegishli bo'lsa, ASOSIY sohani tanlang.
- Ishonchlilik darajasini 0-100 orasida baholang.
- Qisqacha sabab yozing (1-2 gap).

Mavjud huquqiy sohalar:
1. Mehnat huquqi — ish beruvchi-ishchi munosabatlari, mehnat shartnomasi, bo'shatish, ish haqi, mehnat nizolari
2. Fuqarolik huquqi — shartnomalar, mulk, majburiyatlar, zarar undirish, meros (vasiyatnoma bilan)
3. Oila huquqi — nikoh, ajrashish, alimentlar, farzand asrash, ota-ona huquqlari
4. Ma'muriy huquq — ma'muriy javobgarlik, jarimalar, litsenziyalar, davlat organlari qarorlari
5. Jinoyat huquqi — jinoyatlar, jazo choralari, jinoiy javobgarlik, tergov, sud jarayoni
6. Tadbirkorlik huquqi — YaTT, MChJ, AJ, biznes ro'yxatdan o'tish, tijorat nizolari
7. Soliq huquqi — soliqlar, soliq deklaratsiyasi, soliq imtiyozlari, soliq tekshiruvlari
8. Intellektual mulk huquqi — mualliflik, patentlar, savdo belgilari, dasturiy ta'minot huquqlari
9. Iste'molchilar huquqi — tovar sifati, kafolat, pulni qaytarish, xizmatlar bo'yicha da'volar
10. Yer va ko'chmas mulk huquqi — yer uchastkasi, ko'chmas mulk oldi-sotdisi, ijara, kadastr, qurilish
11. Boshqa — yuqoridagilarning hech biriga to'g'ri kelmaydigan masalalar

Javobni faqat JSON formatda ber:
{
  "legal_field": "soha nomi (yuqoridagi ro'yxatdan)",
  "confidence": 0-100,
  "reasoning": "qisqacha sabab"
}`;

/**
 * Legislation priority map — maps each legal field to its primary and secondary
 * legislation sources for search prioritization.
 */
const LEGAL_FIELD_MAP = {
  'Mehnat huquqi': {
    primary: [
      'Mehnat kodeksi (MK): https://lex.uz/docs/145261',
      'Aholini ish bilan ta\'minlash to\'g\'risidagi qonun'
    ],
    secondary: [
      'Ma\'muriy javobgarlik kodeksi, mehnat qoidabuzarliklari',
      'Fuqarolik protsessual kodeks, mehnat nizolari'
    ]
  },
  'Fuqarolik huquqi': {
    primary: [
      'Fuqarolik kodeksi (FK): https://lex.uz/docs/111189',
      'Fuqarolik protsessual kodeks (FPK): https://lex.uz/docs/111325'
    ],
    secondary: [
      'Ijro va sud qarorlari ijrosi: https://lex.uz/docs/5765444',
      'Notariat: https://lex.uz/docs/5765430'
    ]
  },
  'Oila huquqi': {
    primary: [
      'Oila kodeksi (OK): https://lex.uz/docs/104723',
      'Bolalar huquqlari kafolatlari: https://lex.uz/docs/49560'
    ],
    secondary: [
      'Fuqarolik protsessual kodeks (FPK)',
      'Genderli tenglik: https://lex.uz/docs/5765412'
    ]
  },
  'Ma\'muriy huquq': {
    primary: [
      'Ma\'muriy javobgarlik to\'g\'risidagi kodeks (MJTK): https://lex.uz/docs/97661',
      'Ma\'muriy sud ishlarini yuritish to\'g\'risidagi kodeks (MSIK): https://lex.uz/docs/3523895'
    ],
    secondary: [
      'Litsenziyalash: https://lex.uz/docs/6006025',
      'Korrupsiyaga qarshi kurashish: https://lex.uz/docs/5765442'
    ]
  },
  'Jinoyat huquqi': {
    primary: [
      'Jinoyat kodeksi (JK): https://lex.uz/docs/111457',
      'Jinoyat-protsessual kodeks (JPK): https://lex.uz/docs/111463'
    ],
    secondary: [
      'Sudlar to\'g\'risida: https://lex.uz/docs/5965818',
      'Advokatlik faoliyati: https://lex.uz/docs/5765396'
    ]
  },
  'Tadbirkorlik huquqi': {
    primary: [
      'Tadbirkorlik faoliyati erkinligi kafolatlari: https://lex.uz/docs/4538291',
      'MChJ to\'g\'risida: https://lex.uz/docs/5765406',
      'Aksiyadorlik jamiyatlari: https://lex.uz/docs/5765400'
    ],
    secondary: [
      'Soliq kodeksi (SK): https://lex.uz/docs/4674893',
      'Bankrotlik: https://lex.uz/docs/5767454',
      'Davlat xaridlari: https://lex.uz/docs/5759393'
    ]
  },
  'Soliq huquqi': {
    primary: [
      'Soliq kodeksi (SK): https://lex.uz/docs/4674893',
      'Budjet kodeksi: https://lex.uz/docs/3523816'
    ],
    secondary: [
      'Bojxona kodeksi: https://lex.uz/docs/4102378',
      'Tadbirkorlik faoliyati erkinligi kafolatlari'
    ]
  },
  'Intellektual mulk huquqi': {
    primary: [
      'Fuqarolik kodeksi (FK), 4-qism — intellektual mulk',
      'Mualliflik huquqi va turdosh huquqlar to\'g\'risidagi qonun'
    ],
    secondary: [
      'Ixtirolar, foydali modellar va sanoat namunalari to\'g\'risidagi qonun',
      'Savdo belgilari to\'g\'risidagi qonun'
    ]
  },
  'Iste\'molchilar huquqi': {
    primary: [
      'Iste\'molchilar huquqlarini himoya qilish: https://lex.uz/docs/89690',
      'Fuqarolik kodeksi (FK), shartnomalar qismi'
    ],
    secondary: [
      'Reklama to\'g\'risidagi qonun',
      'Tovarlar sifati va xavfsizligi to\'g\'risidagi qonun'
    ]
  },
  'Yer va ko\'chmas mulk huquqi': {
    primary: [
      'Yer kodeksi: https://lex.uz/docs/149946',
      'Uy-joy kodeksi: https://lex.uz/docs/97012'
    ],
    secondary: [
      'Fuqarolik kodeksi, ko\'chmas mulk bitimlari',
      'Kadastr to\'g\'risidagi qonun'
    ]
  },
  'Boshqa': {
    primary: [
      'Konstitutsiya: https://lex.uz/docs/35869',
      'Fuqarolik kodeksi (FK): https://lex.uz/docs/111189'
    ],
    secondary: []
  }
};

const VERIFY_PROMPT = `Sen huquqiy javob sifatini tekshiruvchi agentsan. Student yoki yurist tomonidan tayyorlangan javobni baholashing kerak.

Tekshirish mezonlari:
1. **legal_grounding** (0-100) — Javob qonun normalariga asoslanganmi? Modda raqamlari ko'rsatilganmi?
2. **citation_accuracy** (0-100) — Ko'rsatilgan moddalar to'g'rimi? Lex.uz dan tekshirilganmi?
3. **completeness** (0-100) — Foydalanuvchi savoliga to'liq javob berilganmi? Muhim jihat tushirib qoldirilmaganmi?
4. **hallucination_risk** (0-100) — Asossiz da'volar bormi? Manbasiz bayonotlar bormi? (100 = xavf yo'q)

Qoidalar:
- Har bir mezon uchun qisqacha izoh yoz
- Jiddiy muammolarni "flags" ro'yxatida ko'rsat (severity: "error" yoki "warning")
- Mentor uchun 2-3 gaplik xulosa yoz
- Takomillashtirish takliflarini ber

Javobni faqat JSON formatda ber:
{
  "overall_score": 0-100,
  "checks": {
    "legal_grounding": {"score": 0-100, "notes": "izoh"},
    "citation_accuracy": {"score": 0-100, "notes": "izoh"},
    "completeness": {"score": 0-100, "notes": "izoh"},
    "hallucination_risk": {"score": 0-100, "notes": "izoh"}
  },
  "flags": [
    {"severity": "error|warning", "text": "muammo tavsifi", "location": "qaysi qismda"}
  ],
  "mentor_summary": "Mentor uchun qisqacha xulosa",
  "suggested_improvements": ["taklif 1", "taklif 2"]
}`;

module.exports = {
  LEGAL_CATEGORIES,
  URGENCY_LEVELS,
  TRIAGE_PROMPT,
  CLASSIFIER_PROMPT,
  LEGAL_FIELD_MAP,
  RESEARCH_PROMPT,
  DRAFT_PROMPT,
  VERIFY_PROMPT
};
