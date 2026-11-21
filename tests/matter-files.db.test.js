'use strict';

/**
 * Client portal P3 (docs/design/mijoz-portali.md §P3, src/matters/portal-files.js,
 * src/bot/telegram-portal.js): the lawyer asks for a document, the client
 * uploads a file (site or bot). Sealed bytes with the original's sha256; a
 * client sees and removes only their own files; the lawyer side sees all (a
 * viewer reads, changes nothing); a stranger, another matter's client and a
 * removed client get 404; type, size, count and duplicate limits; nothing
 * reads a file (no OCR, no AI); the bot asks which request a file is for;
 * account deletion removes the client's files.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/matter-files.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

(async () => {
  console.log('Client portal document requests and files (P3)');

  await test('wiring: routes (writes same-origin), attachment + nosniff, the access log, the bot before the question path; no AI, no OCR', () => {
    const src = read('src', 'matters', 'portal.js');
    for (const r of ["app.get('/api/matters/:id/portal/requests', requireAuth", "app.post('/api/matters/:id/portal/requests', ...W", "app.patch('/api/matters/:id/portal/requests/:requestId', ...W",
      "app.get('/api/matters/:id/portal/files/:fileId/content', requireAuth", "app.delete('/api/matters/:id/portal/files/:fileId', ...W",
      "app.post('/api/portal/:matterId/files', ...W, oneFile", "app.get('/api/portal/:matterId/files/:fileId/content', requireAuth", "app.delete('/api/portal/:matterId/files/:fileId', ...W"]) assert.ok(src.includes(r), r);
    assert.ok(src.includes("'X-Content-Type-Options': 'nosniff'") && src.includes('attachment; filename="file"'));
    assert.ok(src.includes("note(pool, req, { table: 'matter_client_files', owners:"));
    const files = read('src', 'matters', 'portal-files.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/callAI|callCheapAI|callOpenAI|callVisionOCR|ocr-image|extractFileText|getEmbedding/.test(files), 'nothing reads the file');
    const bot = read('src', 'bot', 'bot.js');
    assert.ok(bot.includes("/^mp[mdwu]_[0-9a-f-]{36}$/.test(data)") && bot.includes("data === 'mpu_x'"));
    assert.ok(bot.indexOf('tp.fileOffer(pool, account.id, msg') < bot.indexOf('documentFlow.offer(msg)'), 'asked before the AI analysis offer and the lawyer queue');
    assert.ok(bot.includes("(msg.document || msg.photo) && msg.chat.type === 'private' && !msg._portalSkip"));
    const page = read('public', 'app', 'portal-files.js');
    assert.ok(page.includes('J.readFile(new File([blob], f.name, { type: f.mime }), J.scanConfirm)'), 'the ordinary document door: a scan shows its price first');
    assert.ok(/<script src="\/app\/portal-files\.js\?v=\d+"><\/script>\s*<script src="\/app\/portal\.js/.test(read('public', 'app', 'index.html')));
  });

  await test('file names: no path, no control characters, the extension kept', () => {
    const { cleanName } = require('../src/matters/portal-files');
    assert.strictEqual(cleanName('C:\\Users\\a\\..\\pasport nusxasi.PDF'), 'pasport nusxasi.pdf');
    assert.strictEqual(cleanName('../../etc/passwd'), 'passwd');
    assert.strictEqual(cleanName('a"b\r\nc.docx'), 'a b c.docx');
    assert.ok(cleanName('x'.repeat(400) + '.pdf').length <= 180);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 7).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  process.env.PORTAL_FILE_MAX_MB = '1';
  const { pool } = require('../src/database/db');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const { createPortal, deleteAccountClientRows } = require('../src/matters/portal');
  const { createMatterStore } = require('../src/matters/store');
  const privacy = require('../src/privacy/crypto');
  const tp = require('../src/bot/telegram-portal');
  const told = [];
  const notify = (id, e) => told.push({ id, ...e });
  const portal = createPortal({ db: pool, notify });
  const F = portal.files;
  const store = createMatterStore({ db: pool });
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async (name, plan = 'silver') => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', $2, 'user', $3, now() + interval '1 day') RETURNING id`,
      [`mf_${rnd()}`, name, plan])).rows[0].id;
    made.push(id); return id;
  };
  const lawyer = await mkUser('Yurist Aliyev'), viewer = await mkUser('Kuzatuvchi'), client = await mkUser('Mijoz Karimov', 'free'), client2 = await mkUser('Mijoz Ikkinchi', 'free'), other = await mkUser('Begona', 'free');
  const ws = (await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma fayl', $1, $2, $2) RETURNING id`, [`mf-${rnd()}`, lawyer]))).rows[0].id;
  await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'viewer', $3)`, [ws, viewer, lawyer]));
  const matter = await store.create(lawyer, { title: 'Ijara nizosi', workspaceId: ws });
  const second = await store.create(lawyer, { title: 'Boshqa ish' });
  await portal.accept((await portal.invite(matter.id, lawyer, {})).token, client);
  await portal.accept((await portal.invite(matter.id, lawyer, {})).token, client2);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3000, 65)]);
  let req, file;

  try {
    await test('the lawyer opens a request; the clients are told; a viewer, a client and a stranger cannot', async () => {
      req = await F.addRequest(matter.id, lawyer, { title: '  Pasport   nusxasi ', dueOn: '2026-12-01' });
      assert.deepStrictEqual([req.title, req.dueOn, req.status], ['Pasport nusxasi', '2026-12-01', 'open']);
      assert.deepStrictEqual(told.map(x => [x.kind, x.title, x.dueOn]), [['request', 'Pasport nusxasi', '2026-12-01']]);
      await assert.rejects(F.addRequest(matter.id, lawyer, { title: 'x' }), e => e.status === 400);
      await assert.rejects(F.addRequest(matter.id, lawyer, { title: 'Hujjat', dueOn: '12.01.2026' }), e => e.status === 400);
      for (const who of [viewer, client, other]) await assert.rejects(F.addRequest(matter.id, who, { title: 'Hujjat' }), e => e.status === 404);
      assert.strictEqual((await F.lawyerList(matter.id, viewer)).requests.length, 1, 'a viewer reads');
    });
    await test('the client uploads to the request: the bytes are sealed, the sha256 is the original\'s, the lawyer side is told', async () => {
      file = await F.upload(matter.id, client, { buffer: pdf, name: '../Pasport nusxasi.pdf', requestId: req.id });
      assert.deepStrictEqual([file.name, file.bytes, file.requestId, file.mine, file.source], ['Pasport nusxasi.pdf', pdf.length, req.id, true, 'web']);
      const row = (await pool.query('SELECT f.sha256, d.data FROM matter_client_files f JOIN matter_client_file_data d ON d.file_id = f.id WHERE f.id = $1', [file.id])).rows[0];
      assert.ok(privacy.isSealedBytes(row.data) && !row.data.includes(Buffer.from('%PDF')), 'sealed');
      assert.strictEqual(row.sha256, require('crypto').createHash('sha256').update(pdf).digest('hex'));
      const up = told.find(x => x.kind === 'upload');
      assert.deepStrictEqual([up.name, up.request, up.authorId, up.ownerId, up.requestBy], ['Pasport nusxasi.pdf', 'Pasport nusxasi', client, lawyer, lawyer]);
      assert.ok(!('buffer' in up) && !('text' in up), 'never the file');
    });
    await test('download: the client their own, the lawyer side any - the original bytes; the other client and strangers 404', async () => {
      assert.ok((await F.clientDownload(matter.id, file.id, client)).buffer.equals(pdf));
      const d = await F.lawyerDownload(matter.id, file.id, viewer);
      assert.ok(d.buffer.equals(pdf) && d.mime === 'application/pdf' && d.uploadedBy === client);
      await assert.rejects(F.clientDownload(matter.id, file.id, client2), e => e.status === 404, 'another client of the same matter');
      await assert.rejects(F.lawyerDownload(matter.id, file.id, other), e => e.status === 404);
      await assert.rejects(F.lawyerDownload(second.id, file.id, lawyer), e => e.status === 404, 'a file is read only through its own matter');
      assert.deepStrictEqual((await F.clientList(matter.id, client2)).requests.map(q => q.files.length), [0], 'the other client sees the request, not the file');
      assert.strictEqual((await F.lawyerList(matter.id, lawyer)).requests[0].files[0].by, 'Mijoz Karimov');
    });
    await test('a damaged or moved file is not served', async () => {
      const other2 = await F.upload(matter.id, client2, { buffer: Buffer.concat([pdf, Buffer.from('2')]), name: 'ikkinchi.pdf' });
      await pool.query('UPDATE matter_client_file_data SET data = (SELECT data FROM matter_client_file_data WHERE file_id = $2) WHERE file_id = $1', [other2.id, file.id]);
      await assert.rejects(F.lawyerDownload(matter.id, other2.id, lawyer), e => /DECRYPT|decrypt|auth/i.test(String(e.code || e.message)), 'another row\'s sealed bytes do not open here');
      await F.lawyerRemove(matter.id, other2.id, lawyer);
    });
    await test('limits: type, size, an empty file, the same file twice, a closed request, another matter\'s request', async () => {
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.from('MZ...'), name: 'virus.exe' }), e => e.status === 415);
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.from('<script>'), name: 'sahifa.html' }), e => e.status === 415);
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.alloc(1024 * 1024 + 1, 1), name: 'katta.pdf' }), e => e.status === 413);
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.alloc(0), name: 'bosh.pdf' }), e => e.status === 400);
      await assert.rejects(F.upload(matter.id, client, { buffer: pdf, name: 'yana.pdf' }), e => e.status === 409 && e.code === 'already_uploaded');
      await assert.rejects(F.upload(matter.id, client, { buffer: privacy.sealBytes(pdf, 'x'), name: 'sealed.pdf' }), e => e.status === 415, 'a file that looks sealed would never open');
      const far = await F.addRequest(second.id, lawyer, { title: 'Boshqa ish hujjati' });
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.from('boshqa'), name: 'a.txt', requestId: far.id }), e => e.status === 404);
      await assert.rejects(F.upload(matter.id, other, { buffer: Buffer.from('begona'), name: 'a.txt' }), e => e.status === 404);
      await assert.rejects(F.upload(matter.id, lawyer, { buffer: Buffer.from('yurist'), name: 'a.txt' }), e => e.status === 404, 'the lawyer is not a client');
      await F.setRequest(matter.id, req.id, lawyer, { status: 'done' });
      assert.ok(told.some(x => x.kind === 'request_done'));
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.from('kech'), name: 'kech.txt', requestId: req.id }), e => e.status === 409 && e.code === 'request_closed');
      await assert.rejects(F.setRequest(matter.id, req.id, viewer, { status: 'open' }), e => e.status === 404);
      await F.setRequest(matter.id, req.id, lawyer, { status: 'open' });
    });
    await test('the bot: a client\'s file is held and the request asked; several files are one question; "not for the lawyer" lets it go', async () => {
      assert.strictEqual(await tp.fileOffer(pool, other, { from: { id: 1 }, document: { file_id: 'F0', file_name: 'a.pdf', file_size: 10 } }), null, 'no open request: the file goes its ordinary way');
      const offer = await tp.fileOffer(pool, client, { from: { id: 777 }, message_id: 5, document: { file_id: 'F1', file_name: 'Shartnoma asli.pdf', file_size: 900 } });
      assert.strictEqual(offer.keyboard.inline_keyboard[0][0].callback_data, `mpu_${req.id}`);
      assert.strictEqual(offer.keyboard.inline_keyboard.slice(-1)[0][0].callback_data, 'mpu_x');
      assert.deepStrictEqual(await tp.fileOffer(pool, client, { from: { id: 777 }, message_id: 6, photo: [{ file_id: 'p1', file_size: 5 }, { file_id: 'P2', file_size: 700 }] }), { silent: true });
      const held = tp.takeFile(777);
      assert.deepStrictEqual(held.items.map(i => i.file.fileId), ['F1', 'P2']);
      assert.strictEqual(tp.takeFile(777), null, 'taken once');
      const out = await tp.fileToRequest(pool, null, client, req.id, held, { notify, download: async id => Buffer.from(`fayl ${id}`) });
      assert.strictEqual(out.matterId, matter.id);
      assert.strictEqual(out.text.split('\n').length, 2);
      const mine = (await F.clientList(matter.id, client)).requests[0].files;
      assert.deepStrictEqual(mine.map(f => [f.name, f.source]), [['Pasport nusxasi.pdf', 'web'], ['Shartnoma asli.pdf', 'telegram'], ['rasm-6.jpg', 'telegram']]);
      assert.deepStrictEqual((await tp.fileToRequest(pool, null, other, req.id, { items: [{ file: { fileId: 'X', name: 'x.pdf', size: 1 } }] }, { download: async () => Buffer.from('x') })).text, tp.T('uz').notFound);
      const card = await tp.matterCard(pool, client, matter.id, 'uz');
      assert.ok(card.text.includes('Pasport nusxasi') && card.text.includes('✓ 3'), 'the card names what the lawyer asked for');
    });
    await test('removing: the client their own (not another\'s); a removed request leaves its files in the matter; a closed matter takes no file', async () => {
      const mine = (await F.clientList(matter.id, client)).requests[0].files;
      await assert.rejects(F.clientRemove(matter.id, mine[1].id, client2), e => e.status === 404);
      await F.clientRemove(matter.id, mine[1].id, client);
      await assert.rejects(F.lawyerRemove(matter.id, mine[2].id, viewer), e => e.status === 404, 'a viewer changes nothing');
      await F.removeRequest(matter.id, req.id, lawyer);
      const L = await F.lawyerList(matter.id, lawyer);
      assert.deepStrictEqual([L.requests.length, L.files.length], [0, 2], 'the files stay, unattached');
      await store.update(matter.id, lawyer, { status: 'closed' });
      await assert.rejects(F.upload(matter.id, client, { buffer: Buffer.from('yopiq'), name: 'y.txt' }), e => e.status === 409 && e.code === 'closed');
      assert.ok((await F.clientDownload(matter.id, mine[0].id, client)).buffer.equals(pdf), 'still readable in the closed matter\'s 30 days');
      await store.update(matter.id, lawyer, { status: 'open' });
    });
    await test('a removed client reads nothing; account deletion removes the client\'s files and bytes', async () => {
      const f2 = await F.upload(matter.id, client2, { buffer: Buffer.from('ikkinchi mijoz'), name: 'ariza.txt' });
      await portal.removeClient(matter.id, client2, lawyer);
      await assert.rejects(F.clientDownload(matter.id, f2.id, client2), e => e.status === 404);
      assert.ok((await F.lawyerDownload(matter.id, f2.id, lawyer)).buffer.equals(Buffer.from('ikkinchi mijoz')), 'the lawyer keeps it');
      await deleteAccountClientRows(pool, client);
      const left = (await pool.query('SELECT uploaded_by FROM matter_client_files WHERE matter_id = $1', [matter.id])).rows;
      assert.deepStrictEqual(left.map(r => r.uploaded_by), [client2]);
      assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM matter_client_file_data d WHERE NOT EXISTS (SELECT 1 FROM matter_client_files f WHERE f.id = d.file_id)')).rows[0].n, 0);
    });
  } finally {
    await pool.query('DELETE FROM matters WHERE owner_id = ANY($1::int[])', [made]).catch(() => {});
    await pool.query('DELETE FROM workspaces WHERE id = $1', [ws]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
