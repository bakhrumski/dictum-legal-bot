'use strict';

/**
 * The editor's AI analysis panel (D4, src/editor/analysis.js, public/app/editor-ai.js):
 * a risk's excerpt is found word for word or marked not found (never guessed),
 * a malformed answer is dropped, a replacement equal to its excerpt proposes
 * nothing; the editor's prompt asks for the replacement wording while
 * /api/analyze keeps its own prompt; the route is metered as an analysis and
 * needs the price confirmation.
 *
 *   node tests/editor-analysis.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../src/editor/analysis');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); }
}

const DOC = 'IJARA SHARTNOMASI\n1. Ijara haqi oyiga 5 000 000 so‘m.\n2. Ijarachi “oldindan ogohlantirmasdan” shartnomani bekor qilishi mumkin.';

(async () => {
  console.log('editor analysis');
  await test('an excerpt is found word for word, spaces / case / apostrophe and quote forms aside', () => {
    assert.ok(A.locate(DOC, "ijara haqi oyiga 5 000 000   so'm"));
    assert.ok(A.locate(DOC, 'Ijarachi "oldindan ogohlantirmasdan" shartnomani'));
    assert.ok(!A.locate(DOC, 'Ijara haqi oyiga 6 000 000 so‘m'), 'another figure is not the same words');
    assert.ok(!A.locate(DOC, 'Ijarachi ... bekor qilishi mumkin'), 'a shortened excerpt is never matched');
    assert.ok(!A.locate(DOC, 'Ija'), 'too short to stand for a place');
  });
  await test('the answer is shaped: found flags, no empty proposals, malformed rows dropped', () => {
    const r = A.shape({
      docType: 'Ijara shartnomasi', summary: 'Qisqa.', overallScore: 140,
      riskItems: [
        { level: 'HIGH', clause: '2-band', excerpt: 'shartnomani bekor qilishi mumkin', issue: 'Bir tomonlama bekor qilish.', suggestion: 'FK 382-modda.', replacement: '30 kun oldin yozma ogohlantirib bekor qilishi mumkin' },
        { level: 'odd', clause: 'x', excerpt: 'hujjatda yo‘q so‘zlar', issue: 'Topilmaydigan.', replacement: 'nimadir' },
        { level: 'low', excerpt: 'Ijara haqi oyiga 5 000 000 so‘m', issue: 'Bir xil', replacement: 'ijara haqi oyiga 5 000 000 so\'m' },
        null, 'string', {},
      ],
      missingClauses: [{ clause: 'Nizolarni hal qilish', importance: 'high', description: 'Yo‘q.', text: 'Nizolar sudda hal qilinadi.' }, { foo: 1 }],
      complianceIssues: [{ article: 'FK 535', issue: 'Ro‘yxatdan o‘tkazish.', suggestion: 'Notarius.' }],
      strengths: ['Narx aniq', ''],
    }, DOC);
    assert.strictEqual(r.score, 100);
    assert.strictEqual(r.risks.length, 3);
    assert.deepStrictEqual(r.risks.map(x => [x.level, x.found]), [['high', true], ['low', false], ['low', true]]);
    assert.strictEqual(r.risks[2].replacement, '', 'a replacement that equals its excerpt proposes nothing');
    assert.strictEqual(r.missing.length, 1);
    assert.strictEqual(r.missing[0].text, 'Nizolar sudda hal qilinadi.');
    assert.deepStrictEqual(r.counts, { risks: 3, found: 2, proposals: 2 });
    assert.deepStrictEqual(r.strengths, ['Narx aniq']);
  });
  await test('the editor prompt asks for the wording; /api/analyze keeps its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/ocr/routes.js'), 'utf8');
    assert.ok(/forEditor \? SYSTEM_PROMPT \+ EDITOR_ADDENDUM : SYSTEM_PROMPT/.test(src));
    assert.ok(/"replacement": the full corrected wording that would REPLACE its "excerpt"/.test(src));
    const analyzeRoute = src.slice(src.indexOf("app.post('/api/analyze', requireAuth"));
    assert.ok(/role: 'system', text: SYSTEM_PROMPT \}/.test(analyzeRoute), 'the analysis page is unchanged');
  });
  await test('wiring: confirmed and metered as an analysis, the server-kept text, commenter or above to run', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/editor/analysis.js'), 'utf8');
    assert.ok(/'\/api\/editor\/docs\/:id\/analysis', requireSameOrigin, requireAuth, requireServiceConfirm/.test(src));
    assert.ok(/meterDocument\(req, res, \{ service: 'analysis', text: d\.text/.test(src));
    assert.ok(/docText\(req\.params\.id, me\(req\), 'comment'\)/.test(src));
    assert.ok(/privacy\.seal\(JSON\.stringify\(result\), aad\(id\.id\)\)/.test(src), 'the result is sealed');
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../editor/analysis').mountEditorAnalysis(app"));
    assert.ok(/forEditor: true, endpoint: '\/api\/editor\/analysis'/.test(server));
    const page = fs.readFileSync(path.join(__dirname, '../public/app/editor-ai.js'), 'utf8');
    assert.ok(page.includes("body: { confirmed: true, langHint: J.lang }"), 'runs only after the price card');
    assert.ok(page.includes('await keepVersion();'), 'a version is kept before the first accepted proposal');
    assert.ok(/insertContentAt\(y, \{ type: 'text', text: r\.replacement \}\)/.test(page), 'the replacement goes in as plain text');
    const mig = fs.readFileSync(path.join(__dirname, '../migrations/20261103_039_doc_editor_analyses.sql'), 'utf8');
    assert.ok(/REFERENCES public\.doc_editor_documents\(id\) ON DELETE CASCADE/.test(mig));
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
