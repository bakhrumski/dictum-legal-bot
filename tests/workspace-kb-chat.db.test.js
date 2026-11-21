'use strict';

/**
 * K4 (docs/design/firma-bilim-bazasi.md, src/workspace/kb-chat.js): the firm's
 * knowledge base as an opt-in source of the web chat. Not chosen = nothing
 * changes; chosen = membership checked (viewer reads, a stranger gets no
 * bands), bands found with no AI, the prompt says they are not law, the quote
 * check reads them, the answer cache is skipped and a canned answer is not
 * served; the reply names documents and clauses, never the band text.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/workspace-kb-chat.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CONTRACT = `YETKAZIB BERISH SHARTNOMASI

1. Shartnoma predmeti
Sotuvchi xaridorga tovarni yetkazib beradi, xaridor uni qabul qilib, haqini to'laydi.

3. Javobgarlik
3.1. To'lov kechiktirilsa, xaridor har bir kechiktirilgan kun uchun 0,1 foiz miqdorida penya to'laydi.
3.2. Penyaning umumiy miqdori shartnoma bahosining 10 foizidan oshmaydi.`;

(async () => {
  console.log('Firm base in the web chat (K4)');
  const KC = require('../src/workspace/kb-chat');
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  const chat = server.slice(server.indexOf("app.post('/api/legal-chat'"), server.indexOf("app.post('/api/legal-chat'") + 60000);

  await test('wiring: only when chosen; membership first; cache and canned answers skipped with firm bands; quote check only', () => {
    assert.ok(chat.includes("kbChat.firmForChat(pool, { workspaceId: req.body.firmWorkspaceId, adminId: req.session?.adminId || null, question: message })"));
    assert.ok(chat.includes('if (korpusOverride && firmUsed) korpusOverride = null;'));
    assert.ok(chat.includes('if (verifiedOverride && firmUsed) {'));
    assert.ok(/&& !hasDocument\s+\/\/[^\n]*\n\s+&& !firmUsed/.test(chat), 'never cached');
    assert.ok(chat.includes('if (firmUsed) systemPrompt += kbChat.promptBlock(firmChat);'));
    assert.ok(chat.includes('normalizeLegalAnswerCitationsDetailed(displayReply, kbChat.quoteSources(ragChunks, firmChat), citationLanguage)'));
    // the cross-check, the claim guard and the citator still read the law only
    assert.ok(/crossCheckLegalAnswer\(\{[\s\S]{0,120}chunks: ragChunks,/.test(chat) && /guardLegalAnswer\(\{[\s\S]{0,120}chunks: ragChunks,/.test(chat));
    assert.ok(chat.includes("citatorFor(pool, { reply: displayReply, chunks: ragChunks"));
    const src = fs.readFileSync(path.join(__dirname, '../src/workspace/kb-chat.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/callAI|callCheapAI|callOpenAI|getEmbedding/.test(src), 'no AI');
  });

  await test('page: the composer chip (only Workspaces with documents), firmWorkspaceId sent, the note under the answer', () => {
    const read = f => fs.readFileSync(path.join(__dirname, '../public/app', f), 'utf8');
    const c = read('chat.js'), k = read('firm-kb.js');
    assert.ok(c.includes('data-a="kb" hidden') && c.includes("J.chatKb.bind($('[data-a=kb]', el), el, opts.menuDown)"));
    assert.ok(c.includes('firmWorkspaceId: J.chatKb ? J.chatKb.chosen() : null'));
    assert.ok(c.includes('J.chatKb.note(data.firm)') && c.includes('firm: d.firm || null'));
    assert.ok(/J\.chatKb = \{/.test(k) && /\(r\.data\.documents \|\| \[\]\)\.length/.test(k) && k.includes("localStorage.getItem('jai-chat-kb')"));
    assert.ok(/\.kb-note\{/.test(read('app.css')));
  });

  await test('helpers: not asked = null; off and a bad id need no database; the prompt says not law; meta carries no text', async () => {
    assert.strictEqual(await KC.firmForChat(null, { workspaceId: null }), null);
    assert.strictEqual(await KC.firmForChat(null, {}), null);
    process.env.WS_KB_CHAT = 'off';
    assert.deepStrictEqual(await KC.firmForChat(null, { workspaceId: 'x', adminId: 1 }), { workspaceId: 'x', bands: [], reason: 'off' });
    delete process.env.WS_KB_CHAT;
    assert.strictEqual((await KC.firmForChat(null, { workspaceId: 'not-a-uuid', adminId: 1 })).reason, 'no_access');
    const firm = { workspaceId: 'w', reason: null, bands: [{ documentId: 'd', n: 2, name: 'Yetkazib berish.docx', label: '3.1', page: 2, text: 'Penya 0,1 foiz.' }] };
    const p = KC.promptBlock(firm);
    assert.ok(p.includes('FIRMA HUJJATI (qonun emas): Yetkazib berish.docx, 3.1-band, 2-bet') && p.includes('FIRMA HUJJATLARI:'));
    assert.strictEqual(KC.promptBlock({ bands: [] }), '');
    const q = KC.quoteSources([{ doc_type: 'law' }], firm);
    assert.ok(q.length === 2 && q[1].doc_type === 'firm' && q[1].source_url === null && q[1].article_numbers.length === 0);
    assert.strictEqual(KC.quoteSources([1], null).length, 1);
    const m = KC.replyMeta(firm);
    assert.ok(m.used === 1 && m.bands[0].label === '3.1' && !JSON.stringify(m).includes('Penya'));
    assert.strictEqual(KC.replyMeta(null), null);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 6).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  const { pool } = require('../src/database/db');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const kb = require('../src/workspace/kb').createKnowledgeBase({ db: pool });
  const scans = require('../src/ocr/scan-store');
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async () => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', 'Sinov', 'user', 'silver', now() + interval '1 day') RETURNING id`, [`kbc_${rnd()}`])).rows[0].id;
    made.push(id); return id;
  };
  const owner = await mkUser(), viewer = await mkUser(), stranger = await mkUser();
  const ws = (await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma chat', $1, $2, $2) RETURNING id`, [`kbc-${rnd()}`, owner]))).rows[0].id;
  await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'viewer', $3)`, [ws, viewer, owner]));
  const scan = await scans.saveScan(pool, { adminId: owner, fileHash: require('crypto').createHash('sha256').update(String(rnd())).digest('hex'), kind: 'text', pages: 1, bytes: 4000, text: CONTRACT, provider: 'text', name: 'Yetkazib berish.docx' });
  await kb.add(ws, owner, { from: { kind: 'library', id: scan.id || scan.scanId || scan } });

  await test('a viewer gets the matching bands; a question with no match gets none_found', async () => {
    const f = await KC.firmForChat(pool, { workspaceId: ws, adminId: viewer, question: 'Kechiktirilgan kun uchun penya qancha?' });
    assert.ok(f.bands.length >= 1 && f.reason === null && /penya/i.test(f.bands[0].text) && f.bands[0].name === 'Yetkazib berish.docx', JSON.stringify(f));
    const n = await KC.firmForChat(pool, { workspaceId: ws, adminId: viewer, question: 'Ijara muddati qancha?' });
    assert.deepStrictEqual([n.bands.length, n.reason], [0, 'none_found']);
  });

  await test('a stranger and an ended plan get no bands (no_access); WS_KB_AI=off does not stop the chat, WS_KB_CHAT=off does', async () => {
    assert.strictEqual((await KC.firmForChat(pool, { workspaceId: ws, adminId: stranger, question: 'penya' })).reason, 'no_access');
    process.env.WS_KB_AI = 'off';
    assert.ok((await KC.firmForChat(pool, { workspaceId: ws, adminId: viewer, question: 'penya miqdori' })).bands.length >= 1);
    delete process.env.WS_KB_AI;
    process.env.WS_KB_CHAT = 'off';
    assert.strictEqual((await KC.firmForChat(pool, { workspaceId: ws, adminId: viewer, question: 'penya miqdori' })).reason, 'off');
    delete process.env.WS_KB_CHAT;
    await pool.query(`UPDATE admins SET tariff_plan = 'free', tariff_expires_at = now() - interval '1 day' WHERE id = $1`, [owner]);
    assert.strictEqual((await KC.firmForChat(pool, { workspaceId: ws, adminId: viewer, question: 'penya miqdori' })).reason, 'no_access', 'the Workspace is not active');
  });

  await pool.query('DELETE FROM workspaces WHERE id = $1', [ws]).catch(() => {});
  await pool.query('DELETE FROM document_scans WHERE admin_id = $1', [owner]).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
