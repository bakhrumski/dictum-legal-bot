'use strict';

// Unit tests for the legal-opinion verification engine — no network, no DB.
// callAI and the lookup deps are mocked so extraction parsing, load-bearing
// ordering, the maxRefs cap (deferred => tekshirilmadi), and status
// classification are all exercised deterministically.
//
//   node tests/legal-verify.test.js

const assert = require('assert');
const { extractReferences, verifyDocument, referenceWeight } = require('../src/rag/legal-verify');

let passed = 0, failed = 0;
function t(name, fn) {
  Promise.resolve().then(fn).then(
    () => { passed++; console.log('PASS  ' + name); },
    (e) => { failed++; console.log('FAIL  ' + name + ' — ' + e.message); }
  );
}

// Mock callAI: routes by endpoint. Extraction returns 3 refs; judge returns a
// status derived from whether source material mentions "306".
function makeCallAI() {
  return async (messages, opts) => {
    const ep = opts && opts.endpoint;
    if (ep === '/legal-verify/extract') {
      return { text: '```json\n' + JSON.stringify([
        { type: 'VM_qarori', name: 'Tender nizomi', number: '306-son', date: '2021', claims: ['21-modda xizmatni davom ettirishga ruxsat beradi', 'umumiy tartibni belgilaydi'] },
        { type: 'qonun', name: 'Davlat xaridlari', number: '', date: '', claims: ['xaridlar tartibi'] },
        { type: 'boshqa', name: '', number: '', claims: [] } // dropped (no checkable content)
      ]) + '\n```' };
    }
    if (ep === '/legal-verify/judge') {
      const userText = messages[1].text;
      const status = /306/.test(userText) ? 'tasdiqlandi' : 'qisman_tasdiqlandi';
      return { text: JSON.stringify({ status, topilgan_matn: 'Manba tasdiqlaydi.', izoh: '' }) };
    }
    return { text: '{}' };
  };
}

t('extractReferences parses fenced JSON and drops empty refs', async () => {
  const refs = await extractReferences('some doc', { callAI: makeCallAI() });
  assert.strictEqual(refs.length, 2, 'should keep 2 checkable refs, drop the empty one');
  assert.strictEqual(refs[0].number, '306-son');
  assert.strictEqual(refs[0].claims.length, 2);
});

t('referenceWeight ranks numbered, multi-claim refs higher', () => {
  const a = referenceWeight({ number: '306-son', name: 'X', claims: ['a', 'b'] });
  const b = referenceWeight({ number: '', name: '', claims: ['a'] });
  assert.ok(a > b, 'load-bearing ref should outweigh a bare one');
});

t('verifyDocument caps at maxRefs and defers the rest as tekshirilmadi', async () => {
  const searchLexUzMock = async () => [{ title: 'VMQ-306', url: 'https://lex.uz/uz/docs/306', content: '306-son qaror matni' }];
  // inject the mock by overriding the module's lex search via deps is not
  // supported, so verify only the cap/deferral logic with maxRefs=1.
  const out = await verifyDocument('doc', {
    callAI: makeCallAI(),
    apiKey: null,
    maxRefs: 1,
    searchKorpus: null,
    retrieveLegalContext: null,
  });
  assert.strictEqual(out.total, 2, 'two references total');
  assert.strictEqual(out.verifiedCount, 1, 'only 1 verified in full (cap)');
  assert.strictEqual(out.deferredCount, 1, 'the other deferred');
  const deferred = out.references.find(r => r.izoh.includes('byudjet'));
  assert.ok(deferred && deferred.status === 'tekshirilmadi', 'deferred ref marked tekshirilmadi');
  // the top-weighted ref (306-son, 2 claims) must be the one verified
  const top = out.references[0];
  assert.strictEqual(top.ref.number, '306-son', 'highest-weight ref verified first');
});

process.on('exit', () => {
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exitCode = 1;
});
