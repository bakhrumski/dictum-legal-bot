'use strict';

/**
 * legal-verify uses the lawyer-corrected answer from the QA corpus.
 * searchKorpus returns it as `answer`; legal-verify read `corrected_answer`,
 * so the corpus never reached the judge and fell through to plain retrieval.
 *
 *   node tests/legal-verify-korpus.test.js
 */

const assert = require('assert');
const Module = require('module');

// No network: lex.uz search returns nothing.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (/lex-live-search$/.test(request)) return { searchLexUz: async () => [] };
  return origLoad.apply(this, arguments);
};
const { verifyReference } = require('../src/rag/legal-verify');
Module._load = origLoad;

(async () => {
  let prompt = '';
  let retrieved = false;
  const out = await verifyReference(
    { name: 'Mehnat kodeksi', number: '161-modda', date: '', type: 'kodeks', claims: ['ishdan asossiz bo‘shatish'] },
    {
      apiKey: 'k',
      searchKorpus: async () => ({ match: 'context', answer: 'TASDIQLANGAN: 161-modda bo‘yicha xodim ishga tiklanadi.' }),
      retrieveLegalContext: async () => { retrieved = true; return { context: 'generic' }; },
      callAI: async (messages) => { prompt = messages[1].text; return { text: '{"status":"tasdiqlandi","topilgan_matn":"x","izoh":"y"}' }; },
    }
  );
  assert.ok(prompt.includes('TASDIQLANGAN: 161-modda'), 'the corpus answer reaches the judge');
  assert.strictEqual(retrieved, false, 'no fallback to generic retrieval when the corpus answered');
  assert.strictEqual(out.status, 'tasdiqlandi');
  console.log('  ✓ legal-verify passes the QA-corpus answer to the judge\n\n1 passed, 0 failed');
})().catch((e) => { console.error('  ✗', e.message, '\n\n0 passed, 1 failed'); process.exit(1); });
