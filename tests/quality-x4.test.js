'use strict';

/**
 * X4 of the 2026-11-10 audit (docs/audit/2026-11-10-audit.md §5), no AI call added:
 * Q2 the dense search scans more ivfflat lists, Q8 a live lex.uz search that could not be
 * read is told apart from one that found nothing (and told to the person), Q5 claims past
 * the claim guard's caps are counted, Q11 quote checks fold both Latin alphabets, Q7 the web
 * chat records what an answer ended as and Boshqaruv shows the shares.
 *
 *   node tests/quality-x4.test.js      (the SET LOCAL check also runs with TEST_DATABASE_URL)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
// the database module reads its address when first loaded, and the modules under test load it
const DB_OK = !!process.env.TEST_DATABASE_URL && !/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL);
if (DB_OK) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('quality X4');
  const server = read('src', 'api', 'server.js');

  await test('Q2: the dense query runs in a transaction with ivfflat.probes; off, a stub pool or a refused setting fall back', async () => {
    const lc = require('../src/rag/legal-corpus');
    assert.strictEqual(lc.ivfflatProbes({}), 10);
    assert.strictEqual(lc.ivfflatProbes({ RAG_IVFFLAT_PROBES: '25' }), 25);
    assert.strictEqual(lc.ivfflatProbes({ RAG_IVFFLAT_PROBES: 'off' }), 0);
    assert.strictEqual(lc.ivfflatProbes({ RAG_IVFFLAT_PROBES: '0' }), 0);
    assert.strictEqual(lc.ivfflatProbes({ RAG_IVFFLAT_PROBES: 'abc' }), 10);
    const mk = (failOn = null) => { const log = []; const client = { query: async (q) => { log.push(String(q).trim().split('\n')[0]); if (failOn && failOn.test(q)) throw new Error('boom'); return { rows: [1] }; }, release: () => log.push('release') }; return { log, pool: { connect: async () => client, query: async (q) => { log.push('POOL ' + q); return { rows: [0] }; } } }; };
    let x = mk(); await lc.withProbes(x.pool, db => db.query('SELECT 1'), {});
    assert.deepStrictEqual(x.log, ['BEGIN', 'SET LOCAL ivfflat.probes = 10', 'SELECT 1', 'COMMIT', 'release']);
    x = mk(); await lc.withProbes(x.pool, db => db.query('SELECT 1'), { RAG_IVFFLAT_PROBES: 'off' });
    assert.deepStrictEqual(x.log, ['POOL SELECT 1'], 'off: the plain query, as before');
    const stub = { log: [], query: async (q) => { stub.log.push(q); return { rows: [] }; } };
    await lc.withProbes(stub, db => db.query('SELECT 1'), {}); assert.deepStrictEqual(stub.log, ['SELECT 1'], 'a pool with no connect()');
    x = mk(/SET LOCAL/); await lc.withProbes(x.pool, db => db.query('SELECT 1'), {});
    assert.deepStrictEqual(x.log, ['BEGIN', 'SET LOCAL ivfflat.probes = 10', 'ROLLBACK', 'SELECT 1', 'release'], 'the setting refused: the search still answers');
    x = mk(/SELECT 1/); await assert.rejects(lc.withProbes(x.pool, db => db.query('SELECT 1'), {}), /boom/);
    assert.deepStrictEqual(x.log.slice(-2), ['ROLLBACK', 'release'], 'a failed search rolls back and frees the connection');
    assert.ok(/const result = await withProbes\(pool, \(db\) => db\.query\(`\s+SELECT[\s\S]{0,600}ORDER BY embedding <=> \$1::vector/.test(read('src', 'rag', 'legal-corpus.js')));
  });

  await test('Q8: unreachable, deadline, partial and "found nothing" are different things; only the first two are told', async () => {
    const L = require('../src/rag/lex-live-status');
    assert.strictEqual(L.statusOf(L.newStats()), 'none');
    assert.strictEqual(L.statusOf({ searches: 4, failed: 0, deadline: 0 }), 'ok', 'read, even if nothing was found');
    assert.strictEqual(L.statusOf({ searches: 4, failed: 1, deadline: 0 }), 'partial');
    assert.strictEqual(L.statusOf({ searches: 4, failed: 4, deadline: 0 }), 'unreachable');
    assert.strictEqual(L.statusOf({ searches: 3, failed: 3, deadline: 3 }), 'deadline');
    for (const st of ['ok', 'partial', 'none']) assert.strictEqual(L.noticeFor({ status: st }), '');
    assert.ok(L.noticeFor({ status: 'unreachable' }, 'uz').includes('lex.uz hozir javob bermadi'));
    assert.ok(L.noticeFor({ status: 'deadline' }, 'ru').includes('lex.uz сейчас не ответил'));
    assert.strictEqual(L.appendNotice('Javob.', { status: 'ok' }, 'uz'), 'Javob.');
    assert.ok(/^Javob\.\n\nℹ️ lex\.uz/.test(L.appendNotice('Javob.  \n', { status: 'unreachable' }, 'uz')));
    // the search itself counts a page it could not read (here: the time was already up - no network is touched)
    const stats = L.newStats();
    const out = await require('../src/rag/lex-live-search').searchLexUz('ijara shartnomasini bekor qilish', { deadline: Date.now() - 1, stats });
    assert.deepStrictEqual([out.length, stats.searches, stats.failed, stats.deadline], [0, 1, 1, 1]);
    assert.ok(server.includes('stats: lexStats,') && server.includes("statusOf(lexStats)") && server.includes('usageLedger.degrade(`lex_${meta.lexLive.status}`)'));
    assert.ok(server.includes('if (cacheKey && !isFailedAnswer(displayReply) && !lexDown) {'), 'an answer given without lex.uz is not cached');
    assert.ok(read('src', 'agents', 'telegram-agent.js').includes("require('../rag/lex-live-status').appendNotice(finalText, lexLive, lang)"));
  });

  await test('Q5: claims past the caps are counted; the guard reports them and the bot can say so', async () => {
    const g = require('../src/rag/legal-claim-guard');
    const answer = Array.from({ length: 11 }, (_, i) => `Mehnat kodeksining ${100 + i}-moddasiga ko'ra muddat ${i + 2} oy.`).join(' ');
    const claims = g.extractCriticalClaims(answer, 'Muddatlar qanday?');
    assert.strictEqual(claims.length, g.DEFAULTS.maxClaims);
    assert.strictEqual(claims.unchecked, 3);
    assert.strictEqual(g.extractCriticalClaims('Mehnat kodeksining 100-moddasiga ko\'ra muddat 2 oy.', 'q').unchecked, 0);
    const src = read('src', 'rag', 'legal-claim-guard.js');
    assert.ok(src.includes('const uncheckedClaims = Number(claims && claims.unchecked) || 0;') && /\n    uncheckedClaims,\n/.test(src));
    assert.ok(read('src', 'agents', 'telegram-agent.js').includes('Number(claimGuard.uncheckedClaims) > 0'));
  });

  await test('Q11: a document in the 2026 alphabet quoted back in the old letters is the same words - with the right place', () => {
    const { findQuote, pageAt } = require('../src/agents/workflows/tabular-review');
    const doc = '[Sahifa 1]\n1.1. Ijaraçi har oy 5 000 000 söm tölaydi.\n[Sahifa 2]\n2.1. Şartnoma muddati 12 oy, uni uzaytiriş «Tomonlar» kelişuvi bilan.';
    const a = findQuote(doc, 'Ijarachi har oy 5 000 000 so‘m to‘laydi'), b = findQuote(doc, "Shartnoma muddati 12 oy, uni uzaytirish Tomonlar kelishuvi bilan");
    assert.ok(a > 0 && doc.slice(a).startsWith('Ijaraçi'), 'the position is in the document\'s own text');
    assert.ok(b > a && doc.slice(b).startsWith('Şartnoma') && pageAt(doc, b) === 2);
    assert.strictEqual(findQuote('Ijarachi har oy 5 000 000 so‘m to‘laydi.', 'ijaraçi har oy 5 000 000 söm tölaydi'), 0, 'and the other way round');
    assert.strictEqual(findQuote(doc, 'Ijarachi har oy 6 000 000 so‘m to‘laydi'), -1, 'another figure is still another sentence');
    for (const f of ['src/agents/workflows/claim-draft.js', 'src/rag/document-explain.js']) assert.ok(/const norm = [^\n]*uz-alphabet'\)\.fold\(/.test(read(...f.split('/'))), f);
  });

  await test('Q7: the web chat records statuses and counts (never text); the summary gives shares per service', () => {
    const Q = require('../src/ai/quality-report');
    const lc = Q.legalCheckOf({ chunks: 6, lexLive: { status: 'unreachable' }, claimGuard: { status: 'partial', withheld: [{ id: 'c1', topic: 'muddat' }], uncheckedClaims: 2, truncated: true }, lexCrossCheck: { status: 'ok' }, citationCheck: 'ok', quotes: { removed: 1 } });
    assert.deepStrictEqual(lc, { claimGuard: 'partial', withheld: 1, unchecked: 2, truncated: true, lexCrossCheck: 'ok', citationCheck: 'ok', quotesRemoved: 1, lexLive: 'unreachable', chunks: 6, delivered: true });
    assert.ok(!JSON.stringify(lc).includes('muddat'), 'no claim text or topic');
    assert.deepStrictEqual(Q.legalCheckOf(null), { claimGuard: null, withheld: 0, unchecked: 0, truncated: false, lexCrossCheck: null, citationCheck: null, quotesRemoved: 0, lexLive: null, chunks: 0, delivered: true });
    const s = Q.summarize([
      { service: 'web', legal_check: lc, degraded: ['lex_unreachable'] },
      { service: 'web', legal_check: Q.legalCheckOf({ chunks: 4, claimGuard: { status: 'verified', withheld: [] } }), degraded: null },
      { service: 'web', legal_check: Q.legalCheckOf({ chunks: 0, claimGuard: { status: 'unverified' } }), degraded: ['rerank_off'] },
      { service: 'web', legal_check: Q.legalCheckOf({ chunks: 3 }), degraded: null },
      { service: 'telegram', legal_check: { confidence: 'low', claimGuard: 'partial', delivered: false }, degraded: null },
      { service: 'telegram', legal_check: null },
    ]);
    assert.strictEqual(s.web.answers, 4);
    assert.deepStrictEqual([s.web.share.withheldSome, s.web.share.unverified, s.web.share.truncated, s.web.share.noSources, s.web.share.lexDown, s.web.share.unchecked], [25, 25, 25, 25, 25, 25]);
    assert.deepStrictEqual(s.web.degraded, { lex_unreachable: 1, rerank_off: 1 });
    assert.deepStrictEqual([s.telegram.answers, s.telegram.share.lowConfidence, s.telegram.share.notDelivered, s.telegram.share.withheldSome], [1, 100, 100, 100]);
    assert.ok(server.includes("usageLedger.annotate({ outcome: 'answer', legalCheck: require('../ai/quality-report').legalCheckOf(ragMeta,"));
    assert.ok(/mountQualityReport\(app, \{ requireMasterAdmin, pool \}\)/.test(server));
    assert.ok(read('public', 'app', 'admin.js').includes("J.api('/api/admin/ai-usage/quality?days=' + aiState.days)"));
  });

  if (DB_OK) {
    const { pool } = require('../src/database/db');
    await test('Q2 on a real database: the setting holds inside the query\'s transaction and not after it', async () => {
      const lc = require('../src/rag/legal-corpus');
      const inside = await lc.withProbes(pool, db => db.query('SHOW ivfflat.probes'), { RAG_IVFFLAT_PROBES: '7' });
      assert.strictEqual(inside.rows[0]['ivfflat.probes'], '7');
      const after = await pool.query("SELECT current_setting('ivfflat.probes', true) AS v");
      assert.notStrictEqual(after.rows[0].v, '7', 'SET LOCAL does not leak into the pool');
    });
    await pool.end();
  } else console.log('  (database part skipped: TEST_DATABASE_URL not set)');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
