'use strict';

/**
 * K1a (docs/design/firma-bilim-bazasi.md, src/skills/routes.js): a person's
 * own chat skills on the server - own only (another account's is 404), the
 * limit holds, the browser's list moves up once (a second move adds nothing),
 * the instructions are sealed when DATA_KEYS is set; and the app keeps the
 * browser list when the server is not there. No AI.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/user-skills.db.test.js
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
  console.log('User skills (K1a)');

  await test('wiring: routes mounted with auth and same-origin writes, deletion removes them, the app moves the browser list once and falls back to it', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../skills/routes').mountSkillRoutes(app, { db: pool, requireAuth, requireSameOrigin: require('../auth/same-origin').requireSameOrigin })"));
    const routes = fs.readFileSync(path.join(__dirname, '../src/skills/routes.js'), 'utf8');
    for (const r of ["app.post('/api/skills', requireSameOrigin, requireAuth", "app.post('/api/skills/import', requireSameOrigin, requireAuth", "app.put('/api/skills/:id', requireSameOrigin, requireAuth", "app.delete('/api/skills/:id', requireSameOrigin, requireAuth", "app.get('/api/skills', requireAuth"]) assert.ok(routes.includes(r), r);
    assert.ok(!/callAI|callCheapAI|callOpenAI/.test(routes), 'no AI');
    const del = fs.readFileSync(path.join(__dirname, '../src/services/account-deletion.js'), 'utf8');
    assert.ok(/DELETE FROM user_skills WHERE admin_id = \$1/.test(del));
    const chat = fs.readFileSync(path.join(__dirname, '../public/app/chat.js'), 'utf8');
    assert.ok(/\/api\/skills\/import/.test(chat) && /localStorage\.removeItem\('jai-skills'\)/.test(chat) && /if \(!SRV\)/.test(chat), 'moved once; the browser list without the server');
    const core = fs.readFileSync(path.join(__dirname, '../public/app/core.js'), 'utf8');
    assert.ok(/J\.skills\.load\(\)/.test(core));
    assert.ok(!/saveMine/.test(fs.readFileSync(path.join(__dirname, '../public/app/views.js'), 'utf8')));
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
  const { pool } = require('../src/database/db');
  const { createSkillStore } = require('../src/skills/routes');
  const store = createSkillStore(pool);
  const rnd = () => Math.floor(Math.random() * 1e9);
  const mk = async () => (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', 'user') RETURNING id`, [`sk_${rnd()}`])).rows[0].id;
  const a = await mk();
  const b = await mk();

  await test('own skills: create, list, update, delete; another account gets 404; the instructions are sealed in the table', async () => {
    const s = await store.create(a, { name: 'Qisqa javob', ins: 'Javobni 5 gapda yoz, mijozning ismini yozma.' });
    assert.ok(s.id && s.name === 'Qisqa javob');
    const raw = (await pool.query('SELECT ins FROM user_skills WHERE id = $1', [s.id])).rows[0].ins;
    assert.ok(/^enc:t1:/.test(raw) && !raw.includes('mijozning'), 'sealed');
    assert.deepStrictEqual((await store.list(a)).map(x => x.ins), ['Javobni 5 gapda yoz, mijozning ismini yozma.']);
    assert.deepStrictEqual(await store.list(b), []);
    await assert.rejects(store.update(b, s.id, { name: 'x', ins: 'y' }), e => e.status === 404);
    await assert.rejects(store.remove(b, s.id), e => e.status === 404);
    const u = await store.update(a, s.id, { name: 'Qisqa', ins: 'Uch gap.' });
    assert.strictEqual(u.ins, 'Uch gap.');
    await assert.rejects(store.create(a, { name: '', ins: 'x' }), e => e.status === 400);
    await assert.rejects(store.update(a, 'not-a-uuid', { name: 'x', ins: 'y' }), e => e.status === 404);
    assert.deepStrictEqual(await store.remove(a, s.id), { deleted: true });
    assert.deepStrictEqual(await store.list(a), []);
  });

  await test('the browser list moves up once: a second move adds nothing; invalid ones skipped; the limit holds', async () => {
    const list = [{ id: 'k1', name: 'Ruscha', ins: 'Javob rus tilida.' }, { id: 'k2', name: 'Jadval', ins: 'Jadval bilan.' }, { id: 'k3', name: '', ins: 'nomsiz' }];
    const first = await store.importList(a, list);
    assert.deepStrictEqual(first, { added: 2, skipped: 1, full: 0 });
    const again = await store.importList(a, list);
    assert.deepStrictEqual(again, { added: 0, skipped: 3, full: 0 });
    assert.strictEqual((await store.list(a)).length, 2);
    process.env.SKILLS_MAX = '3';
    await store.create(a, { name: 'Uchinchi', ins: 'x' });
    await assert.rejects(store.create(a, { name: 'Tortinchi', ins: 'y' }), e => e.status === 409);
    const over = await store.importList(a, [{ id: 'k9', name: 'Ortiqcha', ins: 'z' }]);
    assert.deepStrictEqual(over, { added: 0, skipped: 0, full: 1 });
    delete process.env.SKILLS_MAX;
  });

  await test('parallel creates do not pass the limit', async () => {
    process.env.SKILLS_MAX = '2';
    const settled = await Promise.allSettled([1, 2, 3, 4].map(i => store.create(b, { name: `P${i}`, ins: 'x' })));
    delete process.env.SKILLS_MAX;
    assert.strictEqual(settled.filter(x => x.status === 'fulfilled').length, 2);
    assert.strictEqual((await store.list(b)).length, 2);
  });

  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [[a, b]]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
