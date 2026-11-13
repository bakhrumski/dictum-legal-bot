'use strict';

/**
 * U1 search and "Davom ettirish" (docs/design/ux-audit-2026-11.md, src/search/routes.js):
 * names only - a chat's messages or a document's text never match; every word
 * of the query in the name, in either Latin alphabet and any apostrophe form;
 * only what the person may open (own chats, own library, editor documents
 * owned or shared, matters owned or of their Workspace, own agent runs); the
 * recent list is the last 8 of every kind together. No AI.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/search.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('Search and recent items (U1)');
  const { patterns } = require('../src/search/routes');

  await test('wiring: mounted with auth; no AI; no text or summary column read', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../search/routes').mountSearchRoutes(app, { pool, requireAuth })"));
    const src = fs.readFileSync(path.join(__dirname, '../src/search/routes.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/callAI|callCheapAI|callOpenAI|getEmbedding/.test(src));
    // the columns each query reads: names, ids, kinds and times only
    const selects = src.match(/SELECT[\s\S]*?FROM/g);
    assert.ok(selects.length >= 5);
    for (const sel of selects) for (const col of ['messages', 'summary', 'html', 'result', 'text', 'note', 'input', 'ystate']) assert.ok(!new RegExp('\\b' + col + '\\b').test(sel.replace(/::text/g, '')), col + ' in ' + sel);
    assert.ok(src.includes("app.get('/api/search', requireAuth"));
    assert.ok(src.includes("app.get('/api/recent', requireAuth"));
  });

  await test('the page: side field + Ctrl/⌘K, "Davom ettirish" on both home pages, Hujjatlar with three tabs', () => {
    const rd = f => fs.readFileSync(path.join(__dirname, '../public/app', f), 'utf8');
    const find = rd('find.js');
    assert.ok(find.includes("J.api('/api/search?q=' + encodeURIComponent(q.slice(0, 120)))"));
    assert.ok(find.includes("J.api('/api/recent')"));
    assert.ok(/\(e\.ctrlKey \|\| e\.metaKey\)[\s\S]{0,120}KeyK/.test(find));
    assert.ok(!/innerHTML[^;]*(?:x\.title|J\.itemTitle)/.test(find), 'names go in as text');
    assert.strictEqual((rd('views.js').match(/J\.recentBlock\(\$\('\.recent', (?:v|lean)\)/g) || []).length, 2);
    const lib = rd('library.js');
    assert.ok(lib.includes("var TABS = ['yuklangan', 'muharrir', 'natijalar'];"));
    assert.ok(lib.includes("J.route(/^\\/hujjatlarim(?:\\?(\\w+))?$/"));
    assert.ok(rd('matters.js').includes('J.openRun = function (id, title)'));
    assert.ok(/<script src="\/app\/find\.js\?v=\d+"><\/script>/.test(rd('index.html')));
    assert.ok(rd('i18n.js').includes("'nav.docs':'Hujjatlar'"));
  });

  await test('the query: folded words, LIKE wildcards escaped, empty = nothing', () => {
    assert.deepStrictEqual(patterns('  Şartnoma  IJARA '), ['%shartnoma%', '%ijara%']);
    assert.deepStrictEqual(patterns('50%_x'), ['%50\\%\\_x%']);
    assert.strictEqual(patterns('   '), null);
    assert.strictEqual(patterns('a b c d e f g h').length, 6);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = require('../src/database/db');
  const { createSearch } = require('../src/search/routes');
  const s = createSearch({ db: pool });
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async (name) => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', $2, 'user') RETURNING id`, [`sr_${rnd()}`, name])).rows[0].id;
    made.push(id); return id;
  };
  const me = await mkUser('Qidiruvchi'), other = await mkUser('Begona');
  const ago = m => new Date(Date.now() - m * 60000);
  const chat = (who, title, at, msg = '') => pool.query(`INSERT INTO ai_chat_sessions (admin_id, title, messages, updated_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [who, title, JSON.stringify([{ role: 'user', text: msg }]), at]).then(r => String(r.rows[0].id));
  const doc = (who, name, at, text = 'matn') => pool.query(`INSERT INTO document_scans (admin_id, file_hash, kind, pages, bytes, text, chars, expires_at, name, library, created_at)
      VALUES ($1, $2, 'text', 1, 10, $3, 4, 'infinity', $4, true, $5) RETURNING id`, [who, require('crypto').randomBytes(32).toString('hex'), text, name, at]).then(r => r.rows[0].id);
  const edDoc = (who, title, at) => pool.query(`INSERT INTO doc_editor_documents (owner_id, title, source, updated_at) VALUES ($1, $2, 'blank', $3) RETURNING id`, [who, title, at]).then(r => r.rows[0].id);
  const matter = (who, title, at, summary = '') => pool.query(`INSERT INTO matters (owner_id, title, summary, updated_at) VALUES ($1, $2, $3, $4) RETURNING id`, [who, title, summary, at]).then(r => r.rows[0].id);
  const run = (who, workflow, at, status = 'done') => pool.query(`INSERT INTO agent_runs (admin_id, workflow, status, request_id, created_at, finished_at) VALUES ($1, $2, $3, gen_random_uuid(), $4, $4) RETURNING id`, [who, workflow, status, at]).then(r => r.rows[0].id);

  try {
    const c1 = await chat(me, 'Ijara shartnomasini bekor qilish', ago(50), 'yashirin-soz');
    await chat(other, 'Ijara shartnomasi begona', ago(1));
    const d1 = await doc(me, 'Oʻqituvchi bilan mehnat shartnomasi.docx', ago(40), 'Ijara haqida matn');
    await doc(other, 'Ijara begona.pdf', ago(2));
    const e1 = await edDoc(me, 'Ijara shartnomasi loyihasi', ago(30));
    const e2 = await edDoc(other, 'Ulashilgan ijara xati', ago(20));
    await pool.query(`INSERT INTO doc_editor_members (document_id, admin_id, role) VALUES ($1, $2, 'viewer')`, [e2, me]);
    await edDoc(other, 'Ulashilmagan ijara', ago(3));
    const m1 = await matter(me, 'Karimov — ijara nizosi', ago(10), 'ijara yashirin-soz');
    await matter(other, 'Begona ijara ishi', ago(4));
    const r1 = await run(me, 'tabular_review', ago(5));
    await pool.query(`INSERT INTO matter_items (matter_id, kind, ref_uuid, title, added_by) VALUES ($1, 'agent_run', $2, 'Jadval — ijara shartnomalari', $3)`, [m1, r1, me]);
    await run(me, 'planned', ago(1), 'awaiting_approval');

    await test('search: every kind the person may open, newest first, nobody else\'s', async () => {
      const out = await s.search(me, 'ijara');
      assert.deepStrictEqual(out.items.map(x => x.kind + ':' + x.id), [`run:${r1}`, `matter:${m1}`, `editor:${e2}`, `editor:${e1}`, `chat:${c1}`]);
      assert.strictEqual(out.items.find(x => x.id === e2).meta.shared, true);
      assert.strictEqual(out.items[0].meta.workflow, 'tabular_review');
    });
    await test('names only: words in a message, a document text or a summary do not match', async () => {
      assert.deepStrictEqual((await s.search(me, 'yashirin-soz')).items, []);
      assert.ok(!(await s.search(me, 'ijara')).items.some(x => x.id === d1)); // its text says "Ijara", its name does not
    });
    await test('every word, any order; the 2026 alphabet and apostrophe forms fold', async () => {
      assert.deepStrictEqual((await s.search(me, 'bekor ijara')).items.map(x => x.id), [c1]);
      assert.deepStrictEqual((await s.search(me, 'ijara bekor yo‘q')).items, []);
      assert.deepStrictEqual((await s.search(me, 'Öqituvçi')).items.map(x => x.id), [d1]);
      assert.deepStrictEqual((await s.search(me, "o'qituvchi")).items.map(x => x.id), [d1]);
    });
    await test('recent: the last 8 of every kind together, a plan nobody approved left out', async () => {
      for (let i = 0; i < 6; i++) await chat(me, 'Mavzu sinovi ' + i, ago(60 + i));
      const out = await s.recent(me);
      assert.strictEqual(out.items.length, 8);
      assert.deepStrictEqual(out.items.slice(0, 6).map(x => x.kind + ':' + x.id), [`run:${r1}`, `matter:${m1}`, `editor:${e2}`, `editor:${e1}`, `doc:${d1}`, `chat:${c1}`]);
      assert.ok(!out.items.some(x => x.meta && x.meta.status === 'awaiting_approval'));
      assert.deepStrictEqual((await s.recent(other)).items.every(x => x.kind !== 'run'), true);
    });
  } finally {
    await pool.query('DELETE FROM agent_runs WHERE admin_id = ANY($1)', [made]);
    await pool.query('DELETE FROM matters WHERE owner_id = ANY($1)', [made]);
    await pool.query('DELETE FROM doc_editor_documents WHERE owner_id = ANY($1)', [made]);
    await pool.query('DELETE FROM document_scans WHERE admin_id = ANY($1)', [made]);
    await pool.query('DELETE FROM ai_chat_sessions WHERE admin_id = ANY($1)', [made]);
    await pool.query('DELETE FROM admins WHERE id = ANY($1)', [made]);
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
