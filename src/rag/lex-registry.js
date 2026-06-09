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
 *  konstitutsiya   — Konstitutsiyaviy tuzum
 *  fuqarolik       — Fuqarolik qonunchiligi
 *  oila            — Oila qonunchiligi
 *  mehnat          — Mehnat va aholining bandligi to'g'risidagi qonunchilik
 *  ijtimoiy        — Ijtimoiy ta'minot va ijtimoiy sug'urta. Ijtimoiy himoya
 *  moliya          — Moliya va kredit to'g'risidagi qonunchilik. Bank faoliyati
 *  uy-joy          — Uy-joy qonunchiligi. Kommunal xo'jalik
 *  tadbirkorlik    — Tadbirkorlik va xo'jalik faoliyati
 *  tashqi-iqtisod  — Tashqi iqtisodiy faoliyat. Bojxona ishi
 *  ekologiya       — Atrof tabiiy muhit va tabiiy resurslar
 *  axborot         — Axborot va axborotlashtirish
 *  talim           — Ta'lim. Fan. Madaniyat
 *  soglik          — Sog'liqni saqlash. Jismoniy tarbiya. Sport. Turizm
 *  mudofaa         — Mudofaa
 *  xavfsizlik      — Xavfsizlik va huquq tartibot muhofazasi
 *  sudlov          — Odil sudlov
 *  adliya          — Prokuratura. Advokatura. Notariat. Yuridik xizmat. Adliya organlari
 *  xalqaro         — Xalqaro munosabatlar. Xalqaro huquq
 *  shaxsiy         — Shaxsiy tusdagi hujjatlar
 *  boshqa          — (catch-all)
 *
 * Add more laws per category freely — ingest:fetch-all iterates all entries.
 * Each doc_id must be unique (it is the dedup key in the DB).
 * Use /uz/docs/ URLs (Uzbek-Latin), not /ru/.
 */

const LEX_REGISTRY = {

  // ── 1. Konstitutsiyaviy tuzum ────────────────────────────────────────────
  konstitutsiya: [],   // add constitution + related laws when URLs are ready

  // ── 2. Fuqarolik qonunchiligi ────────────────────────────────────────────
  fuqarolik: [
    {
      doc_id: 'fuqarolik-kodeks',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111181',
      enforcement_date: '1997-03-01'
    },
    {
      doc_id: 'fuqarolik-kodeks-shartnoma',
      law_name: "Fuqarolik kodeksi (Shartnoma qismi)",
      lex_url: 'https://lex.uz/uz/docs/180550',
      enforcement_date: '1997-03-01'
    },
    {
      doc_id: 'mulkchilik-qonun',
      law_name: "Mulkchilik to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/111189',
      enforcement_date: '1990-02-01'
    },
  ],

  // ── 3. Oila qonunchiligi ─────────────────────────────────────────────────
  oila: [
    {
      doc_id: 'oila-kodeks',
      law_name: "O'zbekiston Respublikasining Oila kodeksi",
      lex_url: 'https://lex.uz/uz/docs/104723',
      enforcement_date: '1998-09-01'
    },
  ],

  // ── 4. Mehnat va aholining bandligi ──────────────────────────────────────
  mehnat: [
    {
      doc_id: 'mehnat-kodeks',
      law_name: "O'zbekiston Respublikasining Mehnat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/6257291',
      enforcement_date: '2023-04-30'
    },
  ],

  // ── 5. Ijtimoiy ta'minot ─────────────────────────────────────────────────
  ijtimoiy: [
    {
      doc_id: 'fuqarolarni-ijtimoiy-himoya-qonun',
      law_name: "Fuqarolarning ijtimoiy himoyalanganligi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/112298',
      enforcement_date: '1994-04-26'
    },
  ],

  // ── 6. Moliya va kredit. Bank faoliyati ──────────────────────────────────
  moliya: [
    {
      doc_id: 'soliq-kodeks',
      law_name: "O'zbekiston Respublikasining Soliq kodeksi",
      lex_url: 'https://lex.uz/uz/docs/4674902',
      enforcement_date: '2020-01-01'
    },
  ],

  // ── 7. Uy-joy qonunchiligi ───────────────────────────────────────────────
  'uy-joy': [
    {
      doc_id: 'uy-joy-kodeks',
      law_name: "O'zbekiston Respublikasining Uy-joy kodeksi",
      lex_url: 'https://lex.uz/uz/docs/97791',
      enforcement_date: '1999-01-01'
    },
  ],

  // ── 8. Tadbirkorlik va xo'jalik faoliyati ────────────────────────────────
  tadbirkorlik: [
    {
      doc_id: 'tadbirkorlik-erkinligi-qonun',
      law_name: "Tadbirkorlik erkinligi kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/4538291',
      enforcement_date: '2000-05-25'
    },
    {
      doc_id: 'aksiyadorlik-jamiyatlari-qonun',
      law_name: "Aksiyadorlik jamiyatlari va aksiyadorlarning huquqlarini himoya qilish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765878',
      enforcement_date: '2014-05-07'
    },
  ],

  // ── 9. Tashqi iqtisodiy faoliyat. Bojxona ────────────────────────────────
  'tashqi-iqtisod': [],  // add when URLs are ready

  // ── 10. Atrof tabiiy muhit ───────────────────────────────────────────────
  ekologiya: [],

  // ── 11. Axborot va axborotlashtirish ─────────────────────────────────────
  axborot: [],

  // ── 12. Ta'lim. Fan. Madaniyat ───────────────────────────────────────────
  talim: [],

  // ── 13. Sog'liqni saqlash. Sport. Turizm ────────────────────────────────
  soglik: [],

  // ── 14. Mudofaa ──────────────────────────────────────────────────────────
  mudofaa: [],

  // ── 15. Xavfsizlik va huquq tartibot muhofazasi ──────────────────────────
  xavfsizlik: [
    {
      doc_id: 'jinoyat-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111457',
      enforcement_date: '1995-04-01'
    },
    {
      doc_id: 'mamuriy-javobgarlik-kodeks',
      law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/uz/docs/97661',
      enforcement_date: '1995-04-01'
    },
  ],

  // ── 16. Odil sudlov ──────────────────────────────────────────────────────
  sudlov: [],

  // ── 17. Prokuratura. Advokatura. Notariat. Adliya ────────────────────────
  adliya: [
    {
      doc_id: 'notariat-qonun',
      law_name: "Notariat to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/98304',
      enforcement_date: '1997-01-01'
    },
  ],

  // ── 18. Xalqaro munosabatlar. Xalqaro huquq ──────────────────────────────
  xalqaro: [],

  // ── 19. Shaxsiy tusdagi hujjatlar ────────────────────────────────────────
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
