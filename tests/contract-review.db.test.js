'use strict';

/**
 * "Shartnomani to'liq tekshirish" (2026-11-11, audit X8 / G2): the workflow
 * (analysis and firm rules side by side, law quotes kept only when they are
 * in the source, either part may fail), the report as the editor reads it,
 * and - on a real Postgres with the real tariff ledger and stub AI - the
 * quote, the two jobs settled part by part, and the handoff to the editor
 * with the proposals already there. The db part needs TEST_DATABASE_URL
 * (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/contract-review.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runWorkflow } = require('../src/agents/harness');
const cr = require('../src/agents/workflows/contract-review');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CONTRACT = [
  '[Sahifa 1]', 'IJARA SHARTNOMASI', '1.1. Ijaraga beruvchi binoni ijarachiga vaqtincha foydalanishga beradi.',
  "2.1. Ijara haqi oyiga 5 000 000 so'm bo'lib, har oyning 5-sanasigacha to'lanadi.",
  "3.1. To'lov kechiktirilgan har bir kun uchun ijarachi 5 foiz miqdorida penya to'laydi.",
  '[Sahifa 2]', "4.1. Ijaraga beruvchi shartnomani istalgan vaqtda ogohlantirishsiz bekor qilishga haqli.",
  "5.1. Nizolar muzokaralar yo'li bilan hal qilinadi.", "6.1. Shartnoma 2026-yil 1-yanvardan kuchga kiradi va bir yil amal qiladi.",
].join('\n');
const SOURCE = "Neustoyka miqdori majburiyatni buzish oqibatlariga nomutanosib bo'lsa, sud neustoykani kamaytirishga haqli.";
const RULES = [
  { title: 'Penya chegarasi', requirement: "Penya kuniga 0,1 foizdan oshmasin", severity: 'high', preferred: "To'lov kechiktirilgan har bir kun uchun 0,1 foiz penya to'lanadi." },
  { title: 'Fors-major', requirement: "Fors-major bandi bo'lsin", severity: 'medium', preferred: "Tomonlar yengib bo'lmas kuch holatlarida javobgarlikdan ozod qilinadi." },
  { title: 'Nizolar', requirement: 'Nizolarni hal qilish tartibi yozilsin', severity: 'low' },
];
const ANALYSIS = {
  docType: 'Ijara shartnomasi', summary: 'Ijarachi uchun xatarli.', overallScore: 55,
  riskItems: [
    { level: 'high', clause: '4.1', excerpt: "Ijaraga beruvchi shartnomani istalgan vaqtda ogohlantirishsiz bekor qilishga haqli.", issue: 'Bir tomonlama bekor qilish.', replacement: "Tomonlar shartnomani 30 kun oldin yozma ogohlantirib bekor qilishga haqli." },
    { level: 'medium', clause: '9.9', excerpt: 'Bu gap shartnomada yo\'q.', issue: 'Topilmaydigan joy.' },
  ],
  missingClauses: [{ clause: 'Javobgarlik', importance: 'high', description: 'Javobgarlik bandi yo\'q.', text: 'Tomonlar majburiyatlarni bajarmaganlik uchun javob beradi.' }],
  complianceIssues: [
    { article: 'Fuqarolik kodeksi', issue: 'Penya miqdori nomutanosib bo\'lishi mumkin.', suggestion: 'Kamaytiring.' },
    { article: '', issue: 'Davlat ro\'yxatidan o\'tkazish talabi tekshirilsin.' },
  ],
  strengths: ['Narx aniq'],
};

function deps({ analysisFails = false, rulesFail = false, lawQuote = SOURCE.slice(0, 70) } = {}) {
  const calls = { analyze: 0, rules: 0, law: 0, retrieve: [] };
  return {
    calls,
    analyze: async () => { calls.analyze++; if (analysisFails) return { parseError: true }; return { analysis: JSON.parse(JSON.stringify(ANALYSIS)) }; },
    retrieve: async (q) => { calls.retrieve.push(q); return { chunks: /penya/iu.test(q) ? [{ law_name: 'Fuqarolik kodeksi', article_number_display: '326', chunk_text: SOURCE, source_url: 'https://lex.uz/docs/-111189#-326' }] : [] }; },
    callAI: async (m) => {
      if (/PLAYBOOK/u.test(m[1].text)) {
        calls.rules++;
        if (rulesFail) return { text: 'kechirasiz' };
        return { text: JSON.stringify({ results: [
          { id: 'r1', status: 'farq', quote: "To'lov kechiktirilgan har bir kun uchun ijarachi 5 foiz miqdorida penya to'laydi.", note: '5 foiz - qoidadan yuqori.', suggestion: "To'lov kechiktirilgan har bir kun uchun 0,1 foiz penya to'lanadi." },
          { id: 'r2', status: 'yoq', quote: '', note: 'Band topilmadi.', suggestion: "Tomonlar yengib bo'lmas kuch holatlarida javobgarlikdan ozod qilinadi." },
          { id: 'r3', status: 'mos', quote: "Nizolar muzokaralar yo'li bilan hal qilinadi.", note: '' },
        ] }) };
      }
      calls.law++;
      return { text: JSON.stringify({ basis: [{ issue: 1, sourceId: 'S1', quote: lawQuote }, { issue: 2, sourceId: 'S1', quote: 'manbada bunday gap umuman yo\'q edi' }] }) };
    },
  };
}
const run = (d, input) => runWorkflow(cr.createContractReviewWorkflow(), { text: CONTRACT, name: 'ijara.docx', rules: RULES, ...input }, { deps: d, budget: { maxSteps: 6, maxMs: 30000 } });

async function pure() {
  await test('the whole chain: analysis and rules both, the law quote kept only when it is the source\'s words', async () => {
    const d = deps();
    const out = await run(d);
    assert.strictEqual(out.status, 'done', JSON.stringify(out.trace));
    const rep = out.state.steps.report.report;
    assert.deepStrictEqual(rep.parts, { analysis: 'ok', rules: 'ok', law: 'ok' });
    assert.deepStrictEqual([d.calls.analyze, d.calls.rules, d.calls.law, d.calls.retrieve.length], [1, 1, 1, 2]);
    assert.deepStrictEqual(rep.analysis.risks.map(r => r.found), [true, false], 'a risk is placed only where its words stand');
    const [c1, c2] = rep.analysis.compliance;
    assert.deepStrictEqual([c1.law.act, c1.law.article, c1.searched], ['Fuqarolik kodeksi', '326', true]);
    assert.match(c1.law.quote, /^Neustoyka miqdori/u);
    assert.deepStrictEqual([c2.law, c2.searched], [null, true], 'a remark with no quote in the source stays the analysis\'s own');
    assert.strictEqual(rep.lawDropped, 1);
    assert.deepStrictEqual(rep.rules.counts, { mos: 1, farq: 1, yoq: 1, noaniq: 0 });
    assert.ok(!/CONTRACT|IJARA SHARTNOMASI/u.test(JSON.stringify(out.trace)), 'the trace holds no contract text');
  });

  await test('one part may fail: rules alone or the analysis alone is still a report; neither is a failed run', async () => {
    const a = await run(deps({ analysisFails: true }));
    assert.strictEqual(a.status, 'done');
    assert.deepStrictEqual(a.state.steps.report.report.parts, { analysis: 'failed', rules: 'ok', law: 'none' });
    const b = await run(deps({ rulesFail: true }));
    assert.deepStrictEqual(b.state.steps.report.report.parts, { analysis: 'ok', rules: 'failed', law: 'ok' });
    const none = await run(deps({ analysisFails: true, rulesFail: true }));
    assert.deepStrictEqual([none.status, none.stoppedAt], ['failed', 'report']);
    const noRules = await run(deps(), { rules: [] });
    assert.deepStrictEqual(noRules.state.steps.report.report.parts, { analysis: 'ok', rules: 'none', law: 'ok' });
    const short = await run(deps(), { text: 'qisqa' });
    assert.strictEqual(short.status, 'needs_input');
  });

  await test('the editor\'s view: a rule that differs is a replacement on the contract\'s own words, a missing rule is a clause to add, both named as firm rules', async () => {
    const rep = (await run(deps())).state.steps.report.report;
    const ed = cr.editorResult(rep, CONTRACT);
    const p = ed.risks.find(r => r.source === 'rule');
    assert.deepStrictEqual([p.found, p.level, p.clause], [true, 'high', 'Penya chegarasi']);
    assert.match(p.replacement, /0,1 foiz/u);
    assert.match(p.issue, /^Firma qoidasi \(qonun emas\)/u);
    const m = ed.missing.find(x => x.source === 'rule');
    assert.deepStrictEqual([m.clause, m.importance], ['Fors-major', 'medium']);
    assert.match(m.text, /yengib bo'lmas kuch/u);
    assert.ok(!ed.risks.some(r => r.clause === 'Nizolar'), 'a rule that is met proposes nothing');
    assert.deepStrictEqual(ed.counts, { risks: 3, found: 2, proposals: 4 });
    assert.ok(ed.compliance.every(c => !('law' in c)), 'the panel gets its own shape');
  });

  await test('the wiring: mounted with the run store, settled part by part, the page and its doors', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /executors\.contract_review = require\('\.\.\/agents\/contract-routes'\)\.mountContractRoutes/u);
    const routes = fs.readFileSync(path.join(__dirname, '../src/agents/contract-routes.js'), 'utf8');
    assert.match(routes, /report\.parts\[j\.part\] === 'ok'\) \{ await ledger\.commit/u);
    assert.match(routes, /sha\(text\) !== body\.textSha/u, 'the editor gets the text the run read, or nothing');
    const page = fs.readFileSync(path.join(__dirname, '../public/app/contract.js'), 'utf8');
    assert.match(page, /var lib = r\.docId \|\| r\.scanId;/u, 'the document travels by its library id, so the editor can open it');
    assert.match(page, /'\/api\/agent\/contract-review\/quote'/u, 'the price is asked before the button');
    assert.match(page, /p\.async = true;/u, 'the run is followed on its own page, so a reload does not lose it');
    assert.ok(!/border-left/u.test(page), 'no coloured left stripe');
    const html = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
    assert.match(html, /\/app\/contract\.js\?v=\d+/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/tools.js'), 'utf8'), /\['shartnoma', '#\/shartnoma', 'scan'\]/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/docact.js'), 'utf8'), /var ORDER = \['explain', 'risk', 'full', 'ask'/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/find.js'), 'utf8'), /workflow === 'contract_review'\) return J\.go\('#\/shartnoma\/' \+ x\.id\)/u);
  });
}

async function withDb() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const express = require('express');
  const { pool } = require('../src/database/db');
  const ledger = require('../src/rag/tariff-ledger');
  const scans = require('../src/ocr/scan-store');
  const ar = require('../src/agents/agent-routes');
  const { createRunStore } = require('../src/agents/runs/store');
  const { createRunWorker } = require('../src/agents/runs/worker');
  const { mountContractRoutes } = require('../src/agents/contract-routes');
  const { createEditorStore } = require('../src/editor/store');
  const privacy = require('../src/privacy/crypto');
  const rnd = () => Math.floor(Math.random() * 1e9);
  const users = [];
  const makeUser = async (plan = 'silver') => {
    const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Contract Test', 'user') RETURNING id`, [`cr_${Date.now()}_${rnd()}`]);
    users.push(r.rows[0].id);
    if (plan) await ledger.grantPaidPeriod({ adminId: r.rows[0].id, plan, paymentRef: `cr-${r.rows[0].id}-${rnd()}` });
    return r.rows[0].id;
  };
  const usageOf = async adminId => (await pool.query(`SELECT status, credits, meta->>'part' AS part FROM tariff_usage WHERE admin_id = $1 AND service = 'analysis' ORDER BY id`, [adminId])).rows;
  const saveDoc = (adminId, text = CONTRACT) => scans.saveScan(pool, { adminId, fileHash: scans.fileHash(Buffer.from(text + rnd())), kind: 'text', pages: 2, bytes: text.length, text, chars: text.length, name: 'ijara.docx' });

  const store = createRunStore({ db: pool });
  let who = null, d = deps();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _r, next) => { req.session = { adminId: who }; next(); });
  const pass = (q, r, n) => n();
  const runs = { store, pollMs: 50, kick: () => worker.tick() };
  const { executor } = mountContractRoutes(app, {
    requireAuth: pass, requireSameOrigin: pass, ledger, pool, runs,
    callAI: (...a) => d.callAI(...a), analyze: (...a) => d.analyze(...a), retrieve: (...a) => d.retrieve(...a),
    serve: ar.serve, executorFor: ar.executorFor, scanDocuments: ar.scanDocuments, editorStore: createEditorStore({ db: pool }),
  });
  const worker = createRunWorker({ store, executors: { contract_review: executor }, log: { warn() {} }, pollMs: 50 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, body) => { const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  worker.start();

  try {
    let runId = null, docId = null;
    await test('the price first: the analysis and the rules each cost the contract\'s analysis units; nothing is reserved by asking', async () => {
      who = await makeUser();
      docId = (await saveDoc(who)).id;
      const q = await post('/api/agent/contract-review/quote', { scanId: docId, builtin: Object.keys(require('../src/agents/workflows/playbook-review').BUILTIN)[0] });
      assert.strictEqual(q.status, 200, JSON.stringify(q.data));
      assert.deepStrictEqual([q.data.parts.map(p => [p.key, p.units]), q.data.total], [[['analysis', 1], ['rules', 1]], 2]);
      assert.deepStrictEqual((await post('/api/agent/contract-review/quote', { scanId: docId })).data.total, 1, 'no rules: the analysis alone');
      assert.strictEqual((await usageOf(who)).length, 0);
      assert.strictEqual((await post('/api/agent/contract-review/quote', { text: 'qisqa' })).status, 422);
      const other = await makeUser();
      const mine = who; who = other;
      assert.strictEqual((await post('/api/agent/contract-review/quote', { scanId: docId })).status, 404, 'another account\'s document');
      who = mine;
    });

    await test('a run: both parts delivered and both jobs committed; the report is the run\'s result', async () => {
      d = deps();
      const r = await post('/api/agent/contract-review', { scanId: docId, rules: RULES });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data).slice(0, 300));
      runId = r.data.runId;
      assert.deepStrictEqual(r.data.report.parts, { analysis: 'ok', rules: 'ok', law: 'ok' });
      assert.deepStrictEqual(r.data.units, { parts: [{ key: 'analysis', units: 1 }, { key: 'rules', units: 1 }], total: 2, charged: 2 });
      assert.deepStrictEqual((await usageOf(who)).map(u => [u.status, u.part]), [['committed', 'analysis'], ['committed', 'rules']]);
      const row = (await pool.query('SELECT input, workflow FROM agent_runs WHERE id = $1', [runId])).rows[0];
      assert.ok(!JSON.stringify(row.input || {}).includes('IJARA'), 'the contract is not kept with the run');
      assert.ok(!/IJARA SHARTNOMASI/u.test(JSON.stringify(r.data)), 'the reply holds findings and quotes, not the contract');
    });

    await test('to the editor: the contract opens as a document whose AI panel already holds the proposals; a second tap opens the same one', async () => {
      const e = await post(`/api/agent/contract-review/${runId}/editor`);
      assert.strictEqual(e.status, 201, JSON.stringify(e.data));
      assert.strictEqual(e.data.proposals, 4);
      const a = (await pool.query('SELECT result, units, created_by FROM doc_editor_analyses WHERE document_id = $1', [e.data.id])).rows[0];
      assert.deepStrictEqual([a.units, a.created_by], [null, who], 'no unit is taken for the handoff');
      const res = JSON.parse(privacy.open(a.result, `doc_editor_analyses.result:${(await pool.query('SELECT id FROM doc_editor_analyses WHERE document_id = $1', [e.data.id])).rows[0].id}`));
      assert.ok(res.risks.some(x => x.source === 'rule' && x.found) && res.missing.some(x => x.source === 'rule'));
      const doc = (await pool.query('SELECT owner_id, source, chars FROM doc_editor_documents WHERE id = $1', [e.data.id])).rows[0];
      assert.deepStrictEqual([doc.owner_id, doc.source, doc.chars > 300], [who, 'library', true]);
      const again = await post(`/api/agent/contract-review/${runId}/editor`);
      assert.deepStrictEqual([again.status, again.data.id, again.data.existing], [200, e.data.id, true]);
      assert.strictEqual((await usageOf(who)).length, 2);
      const mine = who; who = await makeUser();
      assert.strictEqual((await post(`/api/agent/contract-review/${runId}/editor`)).status, 404, 'another account\'s run');
      who = mine;
      await pool.query('DELETE FROM document_scans WHERE id = $1', [docId]);
      await pool.query('DELETE FROM doc_editor_documents WHERE id = $1', [e.data.id]);
      assert.strictEqual((await post(`/api/agent/contract-review/${runId}/editor`)).status, 409, 'the document left the library: said so, nothing guessed');
    });

    await test('a part that failed goes back, the other stays paid; nothing delivered -> 502 and everything back; no units -> 402 with nothing held', async () => {
      who = await makeUser();
      const id = (await saveDoc(who)).id;
      d = deps({ rulesFail: true });
      const r = await post('/api/agent/contract-review', { scanId: id, rules: RULES });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.data.report.parts.rules, r.data.units.charged], ['failed', 1]);
      assert.deepStrictEqual((await usageOf(who)).map(u => [u.status, u.part]), [['committed', 'analysis'], ['released', 'rules']]);
      who = await makeUser();
      const id2 = (await saveDoc(who)).id;
      d = deps({ rulesFail: true, analysisFails: true });
      const none = await post('/api/agent/contract-review', { scanId: id2, rules: RULES });
      assert.strictEqual(none.status, 502);
      assert.match(none.data.message, /birliklar qaytarildi/u);
      assert.ok((await usageOf(who)).every(u => u.status === 'released'));
      who = await makeUser(null);
      const id3 = (await saveDoc(who)).id;
      d = deps();
      const poor = await post('/api/agent/contract-review', { scanId: id3, rules: RULES });
      assert.strictEqual(poor.status, 402, JSON.stringify(poor.data));
      assert.strictEqual(poor.data.needed, 2);
      assert.ok((await usageOf(who)).every(u => u.status !== 'reserved'), 'the first part\'s unit is not left held when the second does not fit');
      assert.strictEqual(d.calls.analyze, 0);
    });
  } finally {
    await worker.stop();
    server.close();
    for (const id of users) {
      for (const t of ['doc_editor_documents WHERE owner_id', 'agent_runs WHERE admin_id', 'document_scans WHERE admin_id', 'tariff_usage WHERE admin_id', 'tariff_periods WHERE admin_id', 'admins WHERE id']) await pool.query(`DELETE FROM ${t} = $1`, [id]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
}

(async () => {
  console.log('contract review (the full check of a contract)');
  await pure();
  if (!process.env.TEST_DATABASE_URL) console.log('  (db part skipped, TEST_DATABASE_URL not set)');
  else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like a hosted database'); process.exit(1); }
  else await withDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
