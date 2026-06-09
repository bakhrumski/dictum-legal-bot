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
 */

/**
 * Category slugs follow the 19-field classification adopted from lex.uz:
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
      doc_id: 'saylov-kodeks',
      law_name: "O'zbekiston Respublikasining Saylov kodeksi",
      lex_url: 'https://lex.uz/uz/docs/4386848',
      enforcement_date: null
    },
  ],

  // ── 2. Davlat boshqaruvi ─────────────────────────────────────────────────
  'davlat-boshqaruvi': [
    {
      doc_id: 'xavo-kodeks',
      law_name: "O'zbekiston Respublikasining Havo kodeksi",
      lex_url: 'https://lex.uz/uz/docs/55594',
      enforcement_date: null
    },
    {
      doc_id: 'mamuriy-sud-kodeks',
      law_name: "Ma'muriy sud ishlarini yuritish to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/uz/docs/3527353',
      enforcement_date: null
    },
  ],

  // ── 3. Fuqarolik qonunchiligi ────────────────────────────────────────────
  fuqarolik: [
    {
      doc_id: 'fuqarolik-kodeks-1',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi (1-qism)",
      lex_url: 'https://lex.uz/uz/docs/111189',
      enforcement_date: null
    },
    {
      doc_id: 'fuqarolik-kodeks-2',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi (2-qism)",
      lex_url: 'https://lex.uz/uz/docs/180552',
      enforcement_date: null
    },
    {
      doc_id: 'fuqarolik-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Fuqarolik protsessual kodeksi",
      lex_url: 'https://lex.uz/uz/docs/3517337',
      enforcement_date: null
    },
    {
      doc_id: 'iqtisodiy-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Iqtisodiy protsessual kodeksi",
      lex_url: 'https://lex.uz/uz/docs/3523891',
      enforcement_date: null
    },
  ],

  // ── 4. Oila qonunchiligi ─────────────────────────────────────────────────
  oila: [
    {
      doc_id: 'oila-kodeks',
      law_name: "O'zbekiston Respublikasining Oila kodeksi",
      lex_url: 'https://lex.uz/uz/docs/104720',
      enforcement_date: null
    },
  ],

  // ── 5. Mehnat va aholining bandligi ──────────────────────────────────────
  mehnat: [
    {
      doc_id: 'mehnat-kodeks',
      law_name: "O'zbekiston Respublikasining Mehnat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/6257288',
      enforcement_date: null
    },
  ],

  // ── 6. Ijtimoiy ta'minot va ijtimoiy himoya ──────────────────────────────
  ijtimoiy: [],

  // ── 7. Moliya va kredit ──────────────────────────────────────────────────
  moliya: [
    {
      doc_id: 'byudjet-kodeks',
      law_name: "O'zbekiston Respublikasining Byudjet kodeksi",
      lex_url: 'https://lex.uz/uz/docs/2304138',
      enforcement_date: null
    },
  ],

  // ── 8. Soliq qonunchiligi ────────────────────────────────────────────────
  soliq: [
    {
      doc_id: 'soliq-kodeks',
      law_name: "O'zbekiston Respublikasining Soliq kodeksi",
      lex_url: 'https://lex.uz/uz/docs/4674902',
      enforcement_date: null
    },
  ],

  // ── 9. Bank faoliyati ────────────────────────────────────────────────────
  bank: [],

  // ── 10. Uy-joy qonunchiligi. Shaharsozlik ────────────────────────────────
  'uy-joy': [
    {
      doc_id: 'uy-joy-kodeks',
      law_name: "O'zbekiston Respublikasining Uy-joy kodeksi",
      lex_url: 'https://lex.uz/uz/docs/106136',
      enforcement_date: null
    },
    {
      doc_id: 'shaharsozlik-kodeks',
      law_name: "O'zbekiston Respublikasining Shaharsozlik kodeksi",
      lex_url: 'https://lex.uz/uz/docs/5307951',
      enforcement_date: null
    },
  ],

  // ── 11. Tadbirkorlik va xo'jalik faoliyati ───────────────────────────────
  tadbirkorlik: [],

  // ── 12. Tashqi iqtisodiy faoliyat. Bojxona ───────────────────────────────
  'tashqi-iqtisod': [
    {
      doc_id: 'bojxona-kodeks',
      law_name: "O'zbekiston Respublikasining Bojxona kodeksi",
      lex_url: 'https://lex.uz/uz/docs/2876354',
      enforcement_date: null
    },
  ],

  // ── 13. Atrof tabiiy muhit va tabiiy resurslar ───────────────────────────
  ekologiya: [
    {
      doc_id: 'suv-kodeks',
      law_name: "O'zbekiston Respublikasining Suv va suvdan foydalanish kodeksi",
      lex_url: 'https://lex.uz/uz/docs/7655343',
      enforcement_date: null
    },
    {
      doc_id: 'yer-kodeks',
      law_name: "O'zbekiston Respublikasining Yer kodeksi",
      lex_url: 'https://lex.uz/uz/docs/152653',
      enforcement_date: null
    },
  ],

  // ── 14. Axborot va axborotlashtirish ─────────────────────────────────────
  axborot: [],

  // ── 15. Ta'lim. Fan. Madaniyat ───────────────────────────────────────────
  talim: [],

  // ── 16. Sog'liqni saqlash. Sport. Turizm ────────────────────────────────
  soglik: [],

  // ── 17. Mudofaa ──────────────────────────────────────────────────────────
  mudofaa: [],

  // ── 18. Jinoyat qonunchiligi ─────────────────────────────────────────────
  jinoyat: [
    {
      doc_id: 'jinoyat-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111453',
      enforcement_date: null
    },
    {
      doc_id: 'jinoyat-ijroiya-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat-ijroiya kodeksi",
      lex_url: 'https://lex.uz/uz/docs/163629',
      enforcement_date: null
    },
    {
      doc_id: 'jinoyat-protsessual-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111460',
      enforcement_date: null
    },
  ],

  // ── 19. Ma'muriy javobgarlik ─────────────────────────────────────────────
  mamuriy: [
    {
      doc_id: 'mamuriy-javobgarlik-kodeks',
      law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/uz/docs/97664',
      enforcement_date: null
    },
  ],

  // ── 20. Odil sudlov ──────────────────────────────────────────────────────
  sudlov: [],

  // ── 21. Prokuratura. Advokatura. Notariat. Adliya ────────────────────────
  adliya: [],

  // ── 22. Xalqaro munosabatlar. Xalqaro huquq ──────────────────────────────
  xalqaro: [],

  // ── 23. Shaxsiy tusdagi hujjatlar ────────────────────────────────────────
  shaxsiy: [],
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
