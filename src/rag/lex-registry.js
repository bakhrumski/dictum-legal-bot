'use strict';

/**
 * Lex.uz Law Registry
 *
 * Maps each AI panel category to the key legal documents on lex.uz.
 * These are the foundational codes and laws that cover each topic.
 *
 * doc_id format: short unique slug used for dedup in legal_chunks table.
 * lex_url: direct lex.uz link (Uzbek-Latin version: /uz/docs/...).
 *
 * To add more laws: just append to the appropriate category array.
 * Then run: npm run ingest:fetch -- --category mehnat
 *
 * Source reliability tiers (comment in each entry):
 *   [KODEKS]   — official code, lex.uz ID confirmed
 *   [QONUN]    — parliament law, lex.uz ID confirmed from system prompt
 *   [FARMONI]  — presidential decree, ID verified
 *   [VM]       — Cabinet of Ministers resolution, ID verified
 *   [VERIFY]   — included but lex.uz URL needs a manual check before ingesting
 */

/**
 * Category slugs follow the 23-field classification:
 *
 *  konstitutsiya      — Konstitutsiyaviy tuzum
 *  davlat-boshqaruvi — Davlat boshqaruvi
 *  fuqarolik          — Fuqarolik qonunchiligi
 *  oila               — Oila qonunchiligi
 *  mehnat             — Mehnat va aholining bandligi
 *  ijtimoiy           — Ijtimoiy ta'minot va ijtimoiy himoya
 *  moliya             — Moliya va kredit
 *  soliq              — Soliq qonunchiligi
 *  bank               — Bank faoliyati
 *  uy-joy             — Uy-joy qonunchiligi. Kommunal xo'jalik
 *  tadbirkorlik       — Tadbirkorlik va xo'jalik faoliyati
 *  tashqi-iqtisod     — Tashqi iqtisodiy faoliyat. Bojxona ishi
 *  ekologiya          — Atrof tabiiy muhit va tabiiy resurslar
 *  axborot            — Axborot va axborotlashtirish
 *  talim              — Ta'lim. Fan. Madaniyat
 *  soglik             — Sog'liqni saqlash. Sport. Turizm
 *  mudofaa            — Mudofaa
 *  jinoyat            — Jinoyat qonunchiligi
 *  mamuriy            — Ma'muriy javobgarlik
 *  yol-harakati       — Yo'l-harakati qoidalari
 *  sudlov             — Odil sudlov
 *  adliya             — Prokuratura. Advokatura. Notariat. Adliya organlari
 *  xalqaro            — Xalqaro munosabatlar. Xalqaro huquq
 *  shaxsiy            — Shaxsiy tusdagi hujjatlar
 *  boshqa             — (catch-all)
 *
 * Add more laws per category freely — ingest:fetch-all iterates all entries.
 * Each doc_id must be unique (it is the dedup key in the DB).
 * Use /uz/docs/ URLs (Uzbek-Latin), not /ru/.
 */

const LEX_REGISTRY = {

  // ── 1. Konstitutsiyaviy tuzum ────────────────────────────────────────────
  konstitutsiya: [
    {
      doc_id: 'konstitutsiya',
      law_name: "O'zbekiston Respublikasi Konstitutsiyasi",
      lex_url: 'https://lex.uz/uz/docs/35869',        // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'saylov-kodeks',
      law_name: "O'zbekiston Respublikasining Saylov kodeksi",
      lex_url: 'https://lex.uz/uz/docs/4386848',      // [KODEKS]
      enforcement_date: null
    },
  ],

  // ── 2. Davlat boshqaruvi ─────────────────────────────────────────────────
  'davlat-boshqaruvi': [
    {
      doc_id: 'xavo-kodeks',
      law_name: "O'zbekiston Respublikasining Havo kodeksi",
      lex_url: 'https://lex.uz/uz/docs/55594',        // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'mamuriy-sud-kodeks',
      law_name: "Ma'muriy sud ishlarini yuritish to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/docs/-3527353',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'davlat-xizmati-qonun',
      law_name: "Davlat fuqarolik xizmati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765408',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'ochiq-davlat-qonun',
      law_name: "Axborot erkinligi prinsiplari va kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765418',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 3. Fuqarolik qonunchiligi ────────────────────────────────────────────
  fuqarolik: [
    {
      doc_id: 'fuqarolik-kodeks-1',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi (1-qism)",
      lex_url: 'https://lex.uz/docs/-111189',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'fuqarolik-kodeks-2',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi (2-qism)",
      lex_url: 'https://lex.uz/docs/-180552',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'fuqarolik-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Fuqarolik protsessual kodeksi",
      lex_url: 'https://lex.uz/docs/-3517337',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'iqtisodiy-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Iqtisodiy protsessual kodeksi",
      lex_url: 'https://lex.uz/docs/-3523891',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'iste-molchilar-himoya-qonun',
      law_name: "Iste'molchilarning huquqlarini himoya qilish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/89690',        // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'ijro-hujjatlar-qonun',
      law_name: "Ijro hujjatlari va ijrochilar faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765444',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 4. Oila qonunchiligi ─────────────────────────────────────────────────
  oila: [
    {
      doc_id: 'oila-kodeks',
      law_name: "O'zbekiston Respublikasining Oila kodeksi",
      lex_url: 'https://lex.uz/docs/-104720',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'bolalar-huquqlari-qonun',
      law_name: "Bolalar huquqlarining kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/49560',        // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'genderli-tenglik-qonun',
      law_name: "Erkaklar va ayollarning teng huquq va imkoniyatlari kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765412',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 5. Mehnat va aholining bandligi ──────────────────────────────────────
  mehnat: [
    {
      doc_id: 'mehnat-kodeks',
      law_name: "O'zbekiston Respublikasining Mehnat kodeksi",
      lex_url: 'https://lex.uz/docs/-6257288',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'pq-4008-xorijiy-malakali-mutaxassislar',
      law_name: "O'zbekiston Respublikasi hududida xorijiy davlatlarning malakali mutaxassislari tomonidan mehnat faoliyatini amalga oshirishi uchun qulay shart-sharoitlar yaratish chora-tadbirlari to'g'risida",
      lex_url: 'https://lex.uz/docs/-4045557',         // [PQ-4008, amaldagi]
      enforcement_date: '2018-11-08'
    },
    {
      doc_id: 'bandlik-qonun',
      law_name: "Aholini ish bilan ta'minlash to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765424',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'kasaba-uyushmalari-qonun',
      law_name: "Kasaba uyushmalari, ularning huquqlari va faoliyatining kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765420',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 6. Ijtimoiy ta'minot va ijtimoiy himoya ──────────────────────────────
  ijtimoiy: [
    {
      doc_id: 'pensiya-qonun',
      law_name: "Fuqarolarning pensiya ta'minoti to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765428',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'nogironlar-ijtimoiy-himoya-qonun',
      law_name: "Nogironligi bo'lgan shaxslarni ijtimoiy himoya qilish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765426',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'ijtimoiy-sheriklik-qonun',
      law_name: "Ijtimoiy sheriklik to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765422',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 7. Moliya va kredit ──────────────────────────────────────────────────
  moliya: [
    {
      doc_id: 'byudjet-kodeks',
      law_name: "O'zbekiston Respublikasining Byudjet kodeksi",
      lex_url: 'https://lex.uz/uz/docs/2304138',      // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'buxgalteriya-hisobi-qonun',
      law_name: "Buxgalteriya hisobi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765434',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'audit-qonun',
      law_name: "Auditorlik faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765436',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'sug-urta-qonun',
      law_name: "Sug'urta faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765438',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 8. Soliq qonunchiligi ────────────────────────────────────────────────
  soliq: [
    {
      doc_id: 'soliq-kodeks',
      law_name: "O'zbekiston Respublikasining Soliq kodeksi",
      lex_url: 'https://lex.uz/docs/-4674902',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'investitsiya-qonun',
      law_name: "Investitsiyalar va investitsiya faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765414',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'erkin-iqtisodiy-zona-qonun',
      law_name: "Erkin iqtisodiy zonalar to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765416',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 9. Bank faoliyati ────────────────────────────────────────────────────
  bank: [
    {
      doc_id: 'banklar-qonun',
      law_name: "Banklar va bank faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765410',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'markaziy-bank-qonun',
      law_name: "O'zbekiston Respublikasining Markaziy banki to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765402',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'valyuta-tartibga-solish-qonun',
      law_name: "Valyutani tartibga solish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/3561549',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'tolov-tizimlari-qonun',
      law_name: "To'lov tizimlari va to'lov tashkilotlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5017043',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 10. Uy-joy qonunchiligi. Shaharsozlik ────────────────────────────────
  'uy-joy': [
    {
      doc_id: 'uy-joy-kodeks',
      law_name: "O'zbekiston Respublikasining Uy-joy kodeksi",
      lex_url: 'https://lex.uz/uz/docs/106136',       // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'shaharsozlik-kodeks',
      law_name: "O'zbekiston Respublikasining Shaharsozlik kodeksi",
      lex_url: 'https://lex.uz/uz/docs/5307951',      // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'ipoteka-qonun',
      law_name: "Ipoteka to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765440',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 11. Tadbirkorlik va xo'jalik faoliyati ───────────────────────────────
  tadbirkorlik: [
    {
      doc_id: 'tadbirkorlik-erkinligi-qonun',
      law_name: "Tadbirkorlik faoliyati erkinligi kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/4538291',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'aksiyadorlik-jamiyat-qonun',
      law_name: "Aksiyadorlik jamiyatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765400',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'mchj-qonun',
      law_name: "Mas'uliyati cheklangan jamiyatlar to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765406',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'bankrotlik-qonun',
      law_name: "To'lovga qobiliyatsizlik (bankrotlik) to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5767454',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'davlat-xaridlari-qonun',
      law_name: "Davlat xaridlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5759393',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'litsenziyalash-qonun',
      law_name: "Litsenziyalash to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/6006025',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'korrupsiyaga-qarshi-qonun',
      law_name: "Korrupsiyaga qarshi kurashish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765442',      // [QONUN]
      enforcement_date: null
    },
  ],

  // ── 12. Tashqi iqtisodiy faoliyat. Bojxona ───────────────────────────────
  'tashqi-iqtisod': [
    {
      doc_id: 'bojxona-kodeks',
      law_name: "O'zbekiston Respublikasining Bojxona kodeksi",
      lex_url: 'https://lex.uz/docs/-2876354',         // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'tashqi-savdo-faoliyati-qonun',
      law_name: "Tashqi savdo faoliyati to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765448',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'raqamli-iqtisodiyot-farmoni',
      law_name: "IT Park va raqamli iqtisodiyot imtiyozlari (PF-6013)",
      lex_url: 'https://lex.uz/uz/docs/4896093',      // [FARMONI — VERIFY]
      enforcement_date: '2020-07-03'
    },
  ],

  // ── 13. Atrof tabiiy muhit va tabiiy resurslar ───────────────────────────
  ekologiya: [
    {
      doc_id: 'suv-kodeks',
      law_name: "O'zbekiston Respublikasining Suv va suvdan foydalanish kodeksi",
      lex_url: 'https://lex.uz/uz/docs/7655343',      // [KODEKS]
      enforcement_date: null
    },
    {
      doc_id: 'yer-kodeks',
      law_name: "O'zbekiston Respublikasining Yer kodeksi",
      lex_url: 'https://lex.uz/docs/-152653',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'tabiatni-muhofaza-qonun',
      law_name: "Tabiatni muhofaza qilish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765450',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'ekologik-ekspertiza-qonun',
      law_name: "Ekologik ekspertiza to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765452',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 14. Axborot va axborotlashtirish ─────────────────────────────────────
  axborot: [
    {
      doc_id: 'axborotlashtirish-qonun',
      law_name: "Axborotlashtirish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765454',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'shaxsiy-ma-lumotlar-qonun',
      law_name: "Shaxsiy ma'lumotlar to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765456',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'kiberhavfsizlik-qonun',
      law_name: "Kiberxavfsizlik to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/6047454',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 15. Ta'lim. Fan. Madaniyat ───────────────────────────────────────────
  talim: [
    {
      doc_id: 'talim-qonun',
      law_name: "Ta'lim to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/-5013007',     // [QONUN, o'zbek-lotin]
      enforcement_date: null
    },
    {
      doc_id: 'vmq-824-oliy-talim-jarayoni',
      law_name: "Oliy ta'lim muassasalarida ta'lim jarayonini tashkil etish bilan bog'liq tizimni takomillashtirish chora-tadbirlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/-5193564',     // [VMQ-824, amaldagi]
      enforcement_date: '2020-12-31'
    },
  ],

  // ── 16. Sog'liqni saqlash. Sport. Turizm ────────────────────────────────
  soglik: [
    {
      doc_id: 'soglikni-saqlash-qonun',
      law_name: "Fuqarolar sog'ligini saqlash to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765462',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'sanitariya-qonun',
      law_name: "Sanitariya-epidemiologik farovonlik to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765464',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'turizm-qonun',
      law_name: "Turizm to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765466',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 17. Mudofaa ──────────────────────────────────────────────────────────
  mudofaa: [
    {
      doc_id: 'mudofaa-qonun',
      law_name: "Mudofaa to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765468',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'harbiy-majburiyat-qonun',
      law_name: "Harbiy majburiyat va harbiy xizmat to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765470',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 18. Jinoyat qonunchiligi ─────────────────────────────────────────────
  jinoyat: [
    {
      doc_id: 'jinoyat-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat kodeksi",
      lex_url: 'https://lex.uz/docs/-111453',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'jinoyat-ijroiya-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat-ijroiya kodeksi",
      lex_url: 'https://lex.uz/docs/-163629',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
    {
      doc_id: 'jinoyat-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi",
      lex_url: 'https://lex.uz/docs/-111460',          // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
  ],

  // ── 19. Ma'muriy javobgarlik ─────────────────────────────────────────────
  mamuriy: [
    {
      doc_id: 'mamuriy-javobgarlik-kodeks',
      law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/docs/-97664',           // [KODEKS] Uzbek Latin
      enforcement_date: null
    },
  ],

  // ── 20. Yo'l-harakati qoidalari ──────────────────────────────────────────
  // NOTE: These VM resolutions cover the most common traffic-law questions.
  // The YHQ document (ID 1284440) is the primary source — WakilAI's answer
  // on tire/retrofitting cited an annex (1-ilova) from this exact document.
  'yol-harakati': [
    {
      doc_id: 'yol-harakati-qoidalari',
      law_name: "Yo'l harakati qoidalari (VM qaror bilan tasdiqlangan)",
      lex_url: 'https://lex.uz/uz/docs/1284440',      // [VM — VERIFY before ingest]
      enforcement_date: null
    },
    {
      doc_id: 'yol-harakati-xavfsizligi-qonun',
      law_name: "Yo'l harakati xavfsizligi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/35878',        // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'transport-qayta-jihozlash-vm758',
      law_name: "Avtomototransport vositasini qayta jihozlashga ruxsatnoma berish tartibi to'g'risidagi nizom (VM 758, 2020)",
      lex_url: 'https://lex.uz/uz/docs/5099700',      // [VM — VERIFY before ingest]
      enforcement_date: '2020-11-30'
    },
    {
      doc_id: 'transport-vositalari-royxatga-olish',
      law_name: "Avtomototransport vositalarini davlat ro'yxatidan o'tkazish tartibi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/3010697',      // [VM — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 21. Odil sudlov ──────────────────────────────────────────────────────
  sudlov: [
    {
      doc_id: 'sudlar-qonun',
      law_name: "Sudlar to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5965818',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'konstitutsiyaviy-sud-qonun',
      law_name: "O'zbekiston Respublikasi Konstitutsiyaviy sudi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765472',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 22. Prokuratura. Advokatura. Notariat. Adliya ────────────────────────
  adliya: [
    {
      doc_id: 'advokatlik-faoliyati-qonun',
      law_name: "Advokatlik faoliyati va advokatura to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765396',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'notariat-qonun',
      law_name: "Notariat to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765430',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'prokuratura-qonun',
      law_name: "Prokuratura to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765432',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'yuridik-yordam-qonun',
      law_name: "Yuridik yordam to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765474',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 23. Xalqaro munosabatlar. Xalqaro huquq ──────────────────────────────
  xalqaro: [
    {
      doc_id: 'xalqaro-arbitraj-qonun',
      law_name: "Xalqaro tijorat arbitraji to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/6555446',      // [QONUN]
      enforcement_date: null
    },
    {
      doc_id: 'xalqaro-shartnamalar-qonun',
      law_name: "O'zbekiston Respublikasining xalqaro shartnomalari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765476',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],

  // ── 24. Shaxsiy tusdagi hujjatlar ────────────────────────────────────────
  shaxsiy: [
    {
      doc_id: 'fuqarolik-holati-aktlari-qonun',
      law_name: "Fuqarolik holati aktlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765478',      // [QONUN — VERIFY]
      enforcement_date: null
    },
    {
      doc_id: 'pasport-tizimi-qonun',
      law_name: "Pasport tizimi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765480',      // [QONUN — VERIFY]
      enforcement_date: null
    },
  ],
};

/**
 * Get all law entries for a category.
 */
function getLawsForCategory(category) {
  return LEX_REGISTRY[category] || [];
}

/**
 * Get all categories with their law counts.
 */
function getRegistryStats() {
  const stats = {};
  for (const [cat, laws] of Object.entries(LEX_REGISTRY)) {
    stats[cat] = laws.length;
  }
  return stats;
}

/**
 * Get all laws across all categories (flat list).
 */
function getAllLaws() {
  const all = [];
  for (const [cat, laws] of Object.entries(LEX_REGISTRY)) {
    for (const law of laws) {
      all.push({ ...law, category: cat });
    }
  }
  return all;
}

module.exports = { LEX_REGISTRY, getLawsForCategory, getRegistryStats, getAllLaws };
