'use strict';
/**
 * One-time script: re-ingest the 14 priority kodeks from their Uzbek-Latin
 * lex.uz URLs (https://lex.uz/docs/-NNNN). Previous Cyrillic/Russian chunks
 * for each doc_id are replaced automatically by ingestFromUrl → deleteByDocId.
 *
 * Run:
 *   node scripts/reingest-codes-uzbek-latin.js
 *
 * Requires DB connection (DATABASE_URL env) and an embedding API key
 * (GEMINI_API_KEY / HF_TOKEN / GPT_API_KEY).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ingestFromUrl } = require('../src/rag/ingest-lex');

const CODES = [
  { doc_id: 'fuqarolik-kodeks-1',         category: 'fuqarolik', law_name: "Fuqarolik kodeksi 1-qism",                              url: 'https://lex.uz/docs/-111189'  },
  { doc_id: 'fuqarolik-kodeks-2',         category: 'fuqarolik', law_name: "Fuqarolik kodeksi 2-qism",                              url: 'https://lex.uz/docs/-180552'  },
  { doc_id: 'mehnat-kodeks',              category: 'mehnat',    law_name: "Mehnat kodeksi",                                        url: 'https://lex.uz/docs/-6257288' },
  { doc_id: 'soliq-kodeks',               category: 'soliq',     law_name: "Soliq kodeksi",                                         url: 'https://lex.uz/docs/-4674902' },
  { doc_id: 'iqtisodiy-protsessual-kodeks', category: 'fuqarolik', law_name: "Iqtisodiy protsessual kodeksi",                      url: 'https://lex.uz/docs/-3523891' },
  { doc_id: 'fuqarolik-protsessual-kodeks', category: 'fuqarolik', law_name: "Fuqarolik protsessual kodeksi",                      url: 'https://lex.uz/docs/-3517337' },
  { doc_id: 'jinoyat-protsessual-kodeks', category: 'jinoyat',   law_name: "Jinoyat-protsessual kodeksi",                          url: 'https://lex.uz/docs/-111460'  },
  { doc_id: 'mamuriy-javobgarlik-kodeks', category: 'mamuriy',   law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks",            url: 'https://lex.uz/docs/-97664'   },
  { doc_id: 'jinoyat-kodeks',             category: 'jinoyat',   law_name: "Jinoyat kodeksi",                                       url: 'https://lex.uz/docs/-111453'  },
  { doc_id: 'mamuriy-sud-kodeks',         category: 'sudlov',    law_name: "Ma'muriy sud ishlarini yuritish kodeksi",               url: 'https://lex.uz/docs/-3527353' },
  { doc_id: 'oila-kodeks',                category: 'oila',      law_name: "Oila kodeksi",                                          url: 'https://lex.uz/docs/-104720'  },
  { doc_id: 'bojxona-kodeks',             category: 'tashqi-iqtisod', law_name: "Bojxona kodeksi",                                  url: 'https://lex.uz/docs/-2876354' },
  { doc_id: 'yer-kodeks',                 category: 'ekologiya', law_name: "Yer kodeksi",                                           url: 'https://lex.uz/docs/-152653'  },
  { doc_id: 'jinoyat-ijroiya-kodeks',     category: 'jinoyat',   law_name: "Jinoyat-ijroiya kodeksi",                               url: 'https://lex.uz/docs/-163629'  },
];

async function main() {
  let ok = 0;
  let fail = 0;

  for (const code of CODES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${ok + fail + 1}/${CODES.length}] ${code.law_name}`);
    console.log(`  URL: ${code.url}`);
    try {
      const inserted = await ingestFromUrl(code.url, {
        category: code.doc_id === 'mamuriy-sud-kodeks' ? 'sudlov' : code.category,
        docId:    code.doc_id,
        lawName:  code.law_name,
      });
      if (inserted === 0) {
        console.log(`  ⚠ 0 chunks inserted (document inactive or empty?)`);
      } else {
        console.log(`  ✓ ${inserted} chunks inserted`);
      }
      ok++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`);
      fail++;
    }
    // Rate-limit between documents
    if (ok + fail < CODES.length) {
      console.log('  (waiting 3s before next…)');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done: ${ok} succeeded, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
