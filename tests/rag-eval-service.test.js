'use strict';

/**
 * Server-side retrieval eval (docs/audit phase 2): law-aware hits, metrics,
 * the one-job-at-a-time runner, the master-only route and the reversible
 * migration.
 *
 *   node tests/rag-eval-service.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRagEvalService, mountRagEvalRoutes, hitRank, lawMatches, summarize } = require('../src/eval/rag-eval-service');
const { getChunkArticleRefs } = require('../src/rag/citation-utils');

const refs = (c) => c.article_numbers || [];
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const quiet = { log() {}, warn() {}, error() {} };

(async () => {
  console.log('rag eval');

  await test('an article number from another law is not a hit (the old eval counted it)', () => {
    const expected = { expected_law: 'Mehnat kodeksi', expected_articles: ['100'] };
    const chunks = [
      { law_name: 'Fuqarolik kodeksi', article_numbers: ['100'] },
      { law_name: "O'zbekiston Respublikasining Mehnat kodeksi", article_numbers: ['99', '100'] },
    ];
    assert.strictEqual(hitRank(chunks, expected, refs), 2);
  });

  await test('a prim article is its own article: 358¹ is not 358 (Astra RAG6)', () => {
    const expected = { expected_law: 'Jinoyat kodeksi', expected_articles: ['358'] };
    assert.strictEqual(hitRank([{ law_name: 'Jinoyat kodeksi', article_numbers: ['358¹'] }], expected, refs), 0);
    assert.strictEqual(hitRank([{ law_name: 'Jinoyat kodeksi', article_numbers: ['358'] }], expected, refs), 1);
    assert.strictEqual(hitRank([{ law_name: 'Jinoyat kodeksi', article_numbers: ['358¹'] }],
      { expected_law: 'Jinoyat kodeksi', expected_articles: ['358¹'] }, refs), 1);
    assert.strictEqual(hitRank([{ law_name: 'Jinoyat kodeksi', article_numbers: ['358-modda'] }], expected, refs), 1);
  });

  await test('doc_id matches even when the law name is written differently', () => {
    assert.ok(lawMatches({ law_name: 'ТК', doc_id: '-6257288' }, { expected_law: 'Mehnat kodeksi', expected_doc_id: '-6257288' }));
    assert.ok(!lawMatches({ law_name: 'Soliq kodeksi', doc_id: '1' }, { expected_law: 'Mehnat kodeksi', expected_doc_id: '2' }));
  });

  await test('works with the production article-ref helper', () => {
    const rank = hitRank([{ law_name: 'Mehnat kodeksi', article_numbers: ['161'] }],
      { expected_law: 'Mehnat kodeksi', expected_articles: ['161'] }, getChunkArticleRefs);
    assert.strictEqual(rank, 1);
  });

  await test('summary: recall@k, MRR, law hit, empty, latency, per topic', () => {
    const s = summarize([
      { rank: 1, lawHit: true, returned: 7, ms: 100, topic: 'mehnat', language: 'uz' },
      { rank: 3, lawHit: true, returned: 7, ms: 300, topic: 'mehnat', language: 'uz' },
      { rank: 0, lawHit: true, returned: 7, ms: 200, topic: 'soliq', language: 'ru' },
      { rank: 0, lawHit: false, returned: 0, ms: 50, topic: 'soliq', language: 'uz' },
    ]);
    assert.strictEqual(s['recall@1'], 0.25);
    assert.strictEqual(s['recall@3'], 0.5);
    assert.strictEqual(s.mrr, +((1 + 1 / 3) / 4).toFixed(3));
    assert.strictEqual(s.lawHit, 0.75);
    assert.strictEqual(s.empty, 0.25);
    assert.strictEqual(s.latencyMs.p50, 100);
    assert.deepStrictEqual(s.byTopic.mehnat, { cases: 2, 'recall@3': 1 });
  });

  await test('builds a frozen synthetic set, runs it through retrieval, stores the run', async () => {
    const db = { cases: [], runs: [] };
    const pool = { query: async (sql, p = []) => {
      if (/count\(\*\)::int AS n FROM rag_eval_cases/.test(sql)) return { rows: [{ n: db.cases.filter(c => c.set_name === p[0]).length }] };
      if (/FROM legal_chunks/.test(sql)) return { rows: [
        { id: 1, law_name: 'Mehnat kodeksi', doc_id: 'd1', category: 'mehnat', language: 'uz', article_numbers: ['161'], chunk_text: 'x'.repeat(400) },
        { id: 2, law_name: 'Soliq kodeksi', doc_id: 'd2', category: 'soliq', language: 'uz', article_numbers: ['7'], chunk_text: 'y'.repeat(400) },
      ] };
      if (/INSERT INTO rag_eval_cases/.test(sql)) { db.cases.push({ id: db.cases.length + 1, set_name: p[0], question: p[1], language: p[2], topic: p[3], expected_law: p[4], expected_doc_id: p[5], expected_articles: p[6] }); return { rows: [] }; }
      if (/SELECT \* FROM rag_eval_cases/.test(sql)) return { rows: db.cases.filter(c => c.set_name === p[0]) };
      if (/INSERT INTO rag_eval_runs/.test(sql)) { db.runs.push({ id: db.runs.length + 1, status: 'running' }); return { rows: [{ id: db.runs.length }] }; }
      if (/UPDATE rag_eval_runs/.test(sql)) { Object.assign(db.runs[p[0] - 1], { status: 'done', summary: p[1] }); return { rows: [] }; }
      return { rows: [] };
    } };
    const seen = [];
    const service = createRagEvalService({
      pool, log: quiet, getArticleRefs: refs,
      callCheapAI: async (msgs) => ({ text: `Savol: ${msgs[1].text.split('\n')[0]}?` }),
      retrieve: async (q, topic, lang, opts) => {
        seen.push({ q, topic, lang, opts });
        return { chunks: q.includes('Mehnat') ? [{ law_name: 'Mehnat kodeksi', doc_id: 'd1', article_numbers: ['161'] }] : [] };
      },
    });
    const started = service.start({ n: 2 });
    assert.strictEqual(started.started, true);
    assert.strictEqual(service.start().started, false, 'only one job at a time');
    for (let i = 0; i < 50 && service.publicJob().status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
    const job = service.publicJob();
    assert.strictEqual(job.status, 'done', job.error);
    assert.strictEqual(db.cases.length, 2, 'two questions written');
    assert.strictEqual(job.summary['recall@1'], 0.5);
    assert.ok(seen.every(s => s.opts.noWebFallback === true && s.topic === null), 'corpus mode, no topic by default');
    assert.ok(seen.every(s => s.lang === null), 'retrieval is called as production calls it: no language filter');
    assert.strictEqual(db.runs[0].status, 'done');
  });

  await test('a Russian question is searched across the whole corpus, as production does', async () => {
    const calls = [];
    const pool = { query: async (sql) => {
      if (/SELECT \* FROM rag_eval_cases/.test(sql)) return { rows: [
        { id: 1, question: 'Может ли работодатель уволить беременную?', language: 'ru', topic: 'mehnat', expected_law: 'Mehnat kodeksi', expected_articles: ['161'] },
      ] };
      if (/INSERT INTO rag_eval_runs/.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    } };
    const service = createRagEvalService({
      pool, log: quiet, getArticleRefs: refs, callCheapAI: async () => ({ text: '' }),
      retrieve: async (q, topic, lang) => { calls.push(lang); return { chunks: [{ law_name: 'Mehnat kodeksi', language: 'uz', article_numbers: ['161'] }] }; },
    });
    const r = await service.runSet({ setName: 'synthetic-v1' });
    assert.deepStrictEqual(calls, [null], 'no language filter (runs 1-2 passed "ru")');
    assert.strictEqual(r.summary.byLanguage.ru['recall@3'], 1, 'the Uzbek article answers the Russian question');
    assert.strictEqual(r.params.language, 'any');
  });

  await test('?misses=1 lists the missed cases with their questions', async () => {
    const pool = { query: async (sql, p) => {
      if (/FROM rag_eval_runs WHERE id/.test(sql)) return { rows: [{ id: 2, set_name: 'synthetic-v1', params: { mode: 'corpus' }, results: [
        { id: 1, language: 'uz', topic: 'mehnat', rank: 1, lawHit: true },
        { id: 2, language: 'ru', topic: 'oila', rank: 0, lawHit: true, top: ['Oila kodeksi 99'] },
        { id: 3, language: 'uz', topic: 'soliq', rank: 5, lawHit: true },
        { id: 4, language: 'uz', topic: 'soliq', rank: 0, error: 'timeout' },
      ] }] };
      if (/FROM rag_eval_cases WHERE set_name/.test(sql)) return { rows: [
        { id: 2, question: 'Как взыскать алименты?', expected_law: 'Oila kodeksi', expected_articles: ['96'] },
        { id: 3, question: 'Soliq imtiyozi?', expected_law: 'Soliq kodeksi', expected_articles: ['7'] },
      ] };
      return { rows: [] };
    } };
    const service = createRagEvalService({ pool, log: quiet, getArticleRefs: refs, callCheapAI: async () => ({}), retrieve: async () => ({}) });
    const m = await service.runMisses(2);
    assert.deepStrictEqual([m.total, m.missed], [4, 2]);
    assert.deepStrictEqual(m.misses[0], { id: 2, language: 'ru', topic: 'oila', rank: null, lawHit: true, question: 'Как взыскать алименты?', expected: 'Oila kodeksi 96', top: ['Oila kodeksi 99'] });
    assert.strictEqual(m.misses[1].rank, 5, 'found but below the top 3 counts as a miss');
    assert.strictEqual(await createRagEvalService({ pool: { query: async () => ({ rows: [] }) }, log: quiet }).runMisses(9), null);
  });

  await test('cut-off questions are left out of the metrics; hubs are reported', async () => {
    const { looksComplete, summarize: sum } = require('../src/eval/rag-eval-service');
    assert.strictEqual(looksComplete('Soliq tekshiruvida qoid'), false);
    assert.strictEqual(looksComplete('Могут ли меня'), false);
    assert.strictEqual(looksComplete('Alimentni undirish muddati bormi?'), true);
    const hub = 'VMQ-86 NIZOM';
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: i, rank: 1, top3: ['Oila kodeksi 12', hub] })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: 10 + i, rank: 0, invalid: true, top3: [hub] })),
    ];
    const s = sum(rows);
    assert.strictEqual(s.cases, 8);
    assert.strictEqual(s.excluded, 2);
    assert.strictEqual(s['recall@3'], 1);
    assert.strictEqual(s.allCases['recall@3'], 0.8, 'the old basis is kept for comparison');
    assert.deepStrictEqual(s.hubs[0], { chunk: hub, cases: 10 });
  });

  await test('?margin= reaches retrieval for that run only and is recorded', async () => {
    const seen = [];
    const pool = { query: async (sql) => {
      if (/SELECT \* FROM rag_eval_cases/.test(sql)) return { rows: [{ id: 1, question: 'Aliment qancha?', language: 'uz', topic: 'oila', expected_law: 'Oila kodeksi', expected_articles: ['99'] }] };
      if (/INSERT INTO rag_eval_runs/.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    } };
    const service = createRagEvalService({ pool, log: quiet, getArticleRefs: refs, callCheapAI: async () => ({}),
      retrieve: async (q, t, l, opts) => { seen.push(opts); return { chunks: [] }; } });
    const r = await service.runSet({ setName: 'synthetic-v1', semanticMargin: 0.05 });
    assert.strictEqual(seen[0].semanticMargin, 0.05);
    assert.strictEqual(r.params.semanticMargin, 0.05);
    await service.runSet({ setName: 'synthetic-v1' });
    assert.ok(!('semanticMargin' in seen[1]), 'no margin unless asked');
    const routes = [];
    mountRagEvalRoutes({ get: (p, ...h) => routes.push({ p, h }) }, { requireMasterAdmin: () => {}, service: { start: (o) => ({ started: true, o }), SYNTHETIC_SET: 'synthetic-v1' } });
    let body;
    await routes[0].h[1]({ query: { start: '1', margin: '0.05' } }, { json: (b) => { body = b; } });
    assert.strictEqual(body.o.semanticMargin, 0.05);
    await routes[0].h[1]({ query: { start: '1', margin: 'abc' } }, { json: (b) => { body = b; } });
    assert.strictEqual(body.o.semanticMargin, null);
  });

  await test('semantic guarantee: a margin keeps a broad hub document out, nothing else changes without one', () => {
    const { selectSemanticGuarantee, semanticMarginFrom } = require('../src/rag/semantic-guarantee');
    const hit = (law, art, score) => ({ law_name: law, article_numbers: [art], score, source_type: 'law_text' });
    const hits = [hit('Oila kodeksi', '96', 0.82), hit('Oila kodeksi', '99', 0.80), hit('FPK', '440', 0.79),
      hit('VMQ-86 NIZOM', '', 0.71), hit('Oila kodeksi', '12', 0.70), { law_name: 'QA', score: 0.9, source_type: 'verified_qa' }];
    const without = selectSemanticGuarantee(hits);
    assert.deepStrictEqual(without.matches.map(r => r.law_name), ['Oila kodeksi', 'FPK', 'VMQ-86 NIZOM', 'Oila kodeksi'], 'old behaviour: the hub is guaranteed');
    const withMargin = selectSemanticGuarantee(hits, { margin: 0.05 });
    assert.deepStrictEqual(withMargin.matches.map(r => `${r.law_name} ${r.article_numbers[0]}`), ['Oila kodeksi 96', 'FPK 440', 'Oila kodeksi 99']);
    assert.strictEqual(semanticMarginFrom({}, {}), null);
    assert.strictEqual(semanticMarginFrom({}, { RAG_SEMANTIC_MARGIN: '0.05' }), 0.05);
    assert.strictEqual(semanticMarginFrom({ semanticMargin: 0.1 }, { RAG_SEMANTIC_MARGIN: '0.05' }), 0.1);
    assert.strictEqual(semanticMarginFrom({}, { RAG_SEMANTIC_MARGIN: 'x' }), null);
  });

  await test('the summary shows where retrieval time goes, stage by stage', () => {
    const { summarize: sum } = require('../src/eval/rag-eval-service');
    const rows = [100, 200, 300, 400].map((ms, i) => ({ id: i, rank: 1, stages: { semantic: ms, corrective: ms * 10, total: ms * 12 } }));
    const s = sum(rows);
    assert.deepStrictEqual(s.stageMs.semantic, { p50: 200, p95: 400 });
    assert.deepStrictEqual(s.stageMs.corrective, { p50: 2000, p95: 4000 });
    assert.strictEqual(sum([{ id: 1, rank: 1 }]).stageMs, undefined);
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    for (const stage of ['article', 'semantic', 'hybrid', 'rerank', 'corrective', 'rest']) {
      assert.ok(server.includes(`markStage('${stage}')`), `retrieval marks ${stage}`);
    }
    assert.ok(/const meta = \{\s*searchMode,\s*timings,/.test(server), 'timings reach meta');
  });

  await test('route is master-only and starts only with ?start=1', () => {
    const routes = [];
    const app = { get: (p, ...h) => routes.push({ p, h }) };
    const requireMasterAdmin = function requireMasterAdmin() {};
    mountRagEvalRoutes(app, { requireMasterAdmin, service: {} });
    assert.deepStrictEqual(routes.map(r => r.p), ['/api/admin/rag-eval', '/api/admin/rag-eval/runs/:id']);
    assert.ok(routes.every(r => r.h[0] === requireMasterAdmin));
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.ok(/mountRagEvalRoutes\(app, \{\s*requireMasterAdmin,/.test(server));
  });

  await test('migration has a matching down file', () => {
    const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260925_009_rag_eval.sql'), 'utf8');
    const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '20260925_009_rag_eval.down.sql'), 'utf8');
    for (const t of ['rag_eval_cases', 'rag_eval_runs']) {
      assert.ok(up.includes(`CREATE TABLE IF NOT EXISTS public.${t}`));
      assert.ok(down.includes(`DROP TABLE IF EXISTS public.${t}`));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
