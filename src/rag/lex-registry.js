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

const LEX_REGISTRY = {
  mehnat: [
    {
      doc_id: 'mehnat-kodeks',
      law_name: "O'zbekiston Respublikasining Mehnat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/6257291',
      enforcement_date: '2023-04-30'
    }
  ],

  oila: [
    {
      doc_id: 'oila-kodeks',
      law_name: "O'zbekiston Respublikasining Oila kodeksi",
      lex_url: 'https://lex.uz/uz/docs/104723',
      enforcement_date: '1998-09-01'
    }
  ],

  fuqarolik: [
    {
      doc_id: 'fuqarolik-kodeks',
      law_name: "O'zbekiston Respublikasining Fuqarolik kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111181',
      enforcement_date: '1997-03-01'
    }
  ],

  shartnoma: [
    // Contract law is part of the Civil Code (Part 2)
    {
      doc_id: 'fuqarolik-kodeks-shartnoma',
      law_name: "Fuqarolik kodeksi (Shartnoma qismi)",
      lex_url: 'https://lex.uz/uz/docs/180550',
      enforcement_date: '1997-03-01'
    }
  ],

  soliq: [
    {
      doc_id: 'soliq-kodeks',
      law_name: "O'zbekiston Respublikasining Soliq kodeksi",
      lex_url: 'https://lex.uz/uz/docs/4674902',
      enforcement_date: '2020-01-01'
    }
  ],

  jinoyat: [
    {
      doc_id: 'jinoyat-kodeks',
      law_name: "O'zbekiston Respublikasining Jinoyat kodeksi",
      lex_url: 'https://lex.uz/uz/docs/111457',
      enforcement_date: '1995-04-01'
    }
  ],

  mamuriy: [
    {
      doc_id: 'mamuriy-javobgarlik-kodeks',
      law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks",
      lex_url: 'https://lex.uz/uz/docs/97661',
      enforcement_date: '1995-04-01'
    }
  ],

  korporativ: [
    {
      doc_id: 'aksiyadorlik-jamiyatlari-qonun',
      law_name: "Aksiyadorlik jamiyatlari va aksiyadorlarning huquqlarini himoya qilish to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/5765878',
      enforcement_date: '2014-05-07'
    }
  ],

  tadbirkorlik: [
    {
      doc_id: 'tadbirkorlik-erkinligi-qonun',
      law_name: "Tadbirkorlik erkinligi kafolatlari to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/4538291',
      enforcement_date: '2000-05-25'
    }
  ],

  'uy-joy': [
    {
      doc_id: 'uy-joy-kodeks',
      law_name: "O'zbekiston Respublikasining Uy-joy kodeksi",
      lex_url: 'https://lex.uz/uz/docs/97791',
      enforcement_date: '1999-01-01'
    }
  ],

  mulk: [
    // Property rights are in the Civil Code, but there's also a specific law
    {
      doc_id: 'mulkchilik-qonun',
      law_name: "Mulkchilik to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/111189',
      enforcement_date: '1990-02-01'
    }
  ],

  notarius: [
    {
      doc_id: 'notariat-qonun',
      law_name: "Notariat to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/98304',
      enforcement_date: '1997-01-01'
    }
  ],

  ijtimoiy: [
    {
      doc_id: 'fuqarolarni-ijtimoiy-himoya-qonun',
      law_name: "Fuqarolarning ijtimoiy himoyalanganligi to'g'risida",
      lex_url: 'https://lex.uz/uz/docs/112298',
      enforcement_date: '1994-04-26'
    }
  ]
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
