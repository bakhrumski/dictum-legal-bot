'use strict';

/**
 * K1b firm library (docs/design/firma-bilim-bazasi.md, src/workspace/library.js):
 * share one's own skill / playbook / template into a Workspace (the server reads
 * it from its owner's table), members write, a viewer reads, a stranger gets
 * 404; the body is sealed; every change keeps a version and a stale write is
 * 409; the activity log records the write without the text; a firm template
 * opens through the drafting route's "ws:<id>" for members only. No AI.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/workspace-library.db.test.js
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
  console.log('Firm library (K1b)');

  await test('wiring: routes mounted with auth and same-origin writes; drafting opens "ws:" templates through the library; the app lists firm items', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../workspace/library').mountLibraryRoutes(app, { db: pool, requireAuth, requireSameOrigin: require('../auth/same-origin').requireSameOrigin })"));
    assert.ok(server.indexOf("mountLibraryRoutes(app") < server.indexOf("mountWorkspaceRoutes(app"), 'mounted before the Workspace router');
    const lib = fs.readFileSync(path.join(__dirname, '../src/workspace/library.js'), 'utf8');
    for (const r of ["app.post('/api/workspaces/:id/library', requireSameOrigin, requireAuth", "app.put('/api/workspaces/:id/library/:item', requireSameOrigin, requireAuth", "app.delete('/api/workspaces/:id/library/:item', requireSameOrigin, requireAuth", "app.post('/api/workspaces/:id/library/:item/restore', requireSameOrigin, requireAuth"]) assert.ok(lib.includes(r), r);
    assert.ok(!/callAI|callCheapAI|callOpenAI/.test(lib), 'no AI');
    const dr = fs.readFileSync(path.join(__dirname, '../src/drafting/routes.js'), 'utf8');
    assert.ok(/async function getTemplateFor\(ref, adminId\)/.test(dr) && (dr.match(/getTemplateFor\(/g) || []).length >= 4);
    assert.ok(/\/api\/library/.test(fs.readFileSync(path.join(__dirname, '../public/app/ws-save.js'), 'utf8')), 'J.firm reads the firm library');
    for (const f of ['views.js', 'playbook.js', 'chat.js']) assert.ok(/J\.firm/.test(fs.readFileSync(path.join(__dirname, '../public/app', f), 'utf8')), `${f} uses J.firm`);
    const pb = fs.readFileSync(path.join(__dirname, '../public/app/playbook.js'), 'utf8');
    assert.ok(/payload\.rules = chosen\.rules/.test(pb), 'a firm playbook is reviewed by its rules');
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 9).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  const { pool } = require('../src/database/db');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const { createLibrary } = require('../src/workspace/library');
  const { createSkillStore } = require('../src/skills/routes');
  const lib = createLibrary({ db: pool });
  const skills = createSkillStore(pool);
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async (plan = 'silver') => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', 'Sinov', 'user', $2, $3) RETURNING id`,
      [`wl_${rnd()}`, plan, plan ? new Date(Date.now() + 864e5) : null])).rows[0].id;
    made.push(id); return id;
  };
  const owner = await mkUser(), member = await mkUser(), viewer = await mkUser(), stranger = await mkUser();
  const ws = (await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma', $1, $2, $2) RETURNING id`, [`wl-${rnd()}`, owner]))).rows[0].id;
  for (const [u, role] of [[member, 'member'], [viewer, 'viewer']]) await withWorkspaceTransaction(pool, owner, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)`, [ws, u, role, owner]));

  let skillItem, tplItem;
  await test('share one\'s own skill: the firm copy is the author\'s words; another\'s skill cannot be shared (404); the body is sealed', async () => {
    const mine = await skills.create(member, { name: 'Qisqa javob', ins: 'Javobni 5 gapda yoz.' });
    const theirs = await skills.create(stranger, { name: 'Begona', ins: 'x' });
    skillItem = await lib.create(ws, member, { from: { kind: 'skill', id: mine.id } });
    assert.deepStrictEqual([skillItem.kind, skillItem.name, skillItem.data.ins, skillItem.version, skillItem.sourceKind], ['skill', 'Qisqa javob', 'Javobni 5 gapda yoz.', 1, 'skill']);
    await assert.rejects(lib.create(ws, member, { from: { kind: 'skill', id: theirs.id } }), e => e.status === 404);
    await assert.rejects(lib.create(ws, member, { from: { kind: 'skill', id: mine.id } }), e => e.status === 409 && e.code === 'already_shared', 'shared once');
    const raw = (await pool.query('SELECT content FROM workspace_library_items WHERE id = $1', [skillItem.id])).rows[0].content;
    assert.ok(/^enc:t1:/.test(raw) && !raw.includes('gapda'));
    // the author's own copy is untouched by later firm edits
    await lib.update(ws, skillItem.id, member, { name: 'Qisqa javob', data: { ins: 'Uch gap.' }, version: 1 });
    assert.strictEqual((await skills.list(member))[0].ins, 'Javobni 5 gapda yoz.');
  });

  await test('roles: a viewer reads but cannot write (403); a stranger gets 404; the owner writes', async () => {
    assert.strictEqual((await lib.list(ws, viewer)).length, 1);
    await assert.rejects(lib.create(ws, viewer, { kind: 'skill', name: 'v', data: { ins: 'x' } }), e => e.status === 403);
    await assert.rejects(lib.update(ws, skillItem.id, viewer, { name: 'v', data: { ins: 'x' } }), e => e.status === 403);
    await assert.rejects(lib.list(ws, stranger), e => e.status === 404);
    await assert.rejects(lib.create(ws, stranger, { kind: 'skill', name: 's', data: { ins: 'x' } }), e => e.status === 404);
    const pb = await lib.create(ws, owner, { kind: 'playbook', name: 'Yetkazib berish', data: { description: 'Sotuvchi tomoni', rules: [{ title: 'Penya', requirement: 'Penya 0,1 % dan oshmasin', severity: 'high' }] } });
    assert.deepStrictEqual([pb.kind, pb.data.rules.length], ['playbook', 1]);
    await assert.rejects(lib.create(ws, owner, { kind: 'playbook', name: 'x', data: { rules: [] } }), e => e.status === 400);
  });

  await test('versions: a stale write is 409; the history keeps the old text; restore keeps the current one first', async () => {
    await assert.rejects(lib.update(ws, skillItem.id, member, { name: 'Qisqa javob', data: { ins: 'eski tab' }, version: 1 }), e => e.status === 409);
    const v3 = await lib.update(ws, skillItem.id, owner, { name: 'Qisqa javob', data: { ins: 'Ikki gap.' }, version: 2 });
    assert.strictEqual(v3.version, 3);
    const h = await lib.versions(ws, skillItem.id, viewer);
    assert.deepStrictEqual([h.current, h.versions.map(x => x.version)], [3, [2, 1]]);
    const back = await lib.restore(ws, skillItem.id, member, 1);
    assert.deepStrictEqual([back.version, back.data.ins], [4, 'Javobni 5 gapda yoz.']);
    assert.ok((await lib.versions(ws, skillItem.id, member)).versions.some(x => x.version === 3), 'the replaced version is kept');
  });

  await test('the activity log records who and what kind, never the text', async () => {
    const r = await pool.query(`SELECT actor_id, action, details FROM workspace_activity_log WHERE workspace_id = $1 AND entity_type = 'library_item' ORDER BY id`, [ws]);
    assert.ok(r.rows.length >= 4);
    assert.ok(r.rows.some(x => x.actor_id === member && x.action === 'library_item.insert'));
    assert.ok(r.rows.every(x => !JSON.stringify(x.details).includes('content') && !JSON.stringify(x.details).includes('gap')), 'no body in the log');
  });

  await test('a firm template: shared from one\'s own, opened by "ws:<id>" for a member or viewer, null for a stranger', async () => {
    const t = (await pool.query(`INSERT INTO document_templates (slug, name, description, category, lang, fields, body, owner_id, created_by)
      VALUES ($1, $2::jsonb, '{"uz":"","ru":""}'::jsonb, 'shartnoma', 'uz', $3::jsonb, $4, $5, $5) RETURNING id`,
      [`u${member}-wl-${rnd()}`, JSON.stringify({ uz: 'Ijara shartnomasi', ru: 'Договор аренды' }), JSON.stringify([{ key: 'ijarachi', label: { uz: 'Ijarachi' } }]), '<p>Ijarachi {{ijarachi}} ushbu shartnoma bo\'yicha oyiga ijara haqi to\'laydi.</p>', member])).rows[0].id;
    tplItem = await lib.create(ws, member, { from: { kind: 'template', id: t } });
    assert.strictEqual(tplItem.name, 'Ijara shartnomasi');
    const forViewer = await lib.templateFor(`ws:${tplItem.id}`, viewer);
    assert.ok(forViewer && forViewer.body.includes('{{ijarachi}}') && forViewer.fields[0].key === 'ijarachi' && forViewer.name.ru === 'Договор аренды');
    assert.strictEqual(await lib.templateFor(`ws:${tplItem.id}`, stranger), null);
    assert.strictEqual(await lib.templateFor('12', viewer), null, 'only "ws:" refs');
    await pool.query('DELETE FROM document_templates WHERE id = $1', [t]);
  });

  await test('listAll: every item of the caller\'s active Workspaces; an inactive Workspace is left out; archive hides an item', async () => {
    const all = await lib.listAll(viewer);
    assert.deepStrictEqual(new Set(all.map(x => x.kind)), new Set(['skill', 'playbook', 'template']));
    assert.ok(all.every(x => x.workspaceName === 'Firma' && x.role === 'viewer'));
    assert.deepStrictEqual(await lib.listAll(stranger), []);
    await lib.archive(ws, tplItem.id, member);
    assert.ok(!(await lib.list(ws, member)).some(x => x.id === tplItem.id));
    assert.strictEqual(await lib.templateFor(`ws:${tplItem.id}`, member), null, 'an archived template no longer opens');
    await pool.query('UPDATE admins SET tariff_plan = NULL, tariff_expires_at = NULL WHERE id = $1', [owner]);
    assert.deepStrictEqual(await lib.listAll(member), [], 'the owner\'s plan ended: the firm library rests');
    await pool.query("UPDATE admins SET tariff_plan = 'silver', tariff_expires_at = now() + interval '1 day' WHERE id = $1", [owner]);
  });

  await test('the limit a kind holds (WS_LIBRARY_MAX)', async () => {
    process.env.WS_LIBRARY_MAX = '2';
    await lib.create(ws, member, { kind: 'skill', name: 'Ikkinchi', data: { ins: 'x' } });
    await assert.rejects(lib.create(ws, member, { kind: 'skill', name: 'Uchinchi', data: { ins: 'y' } }), e => e.status === 409);
    delete process.env.WS_LIBRARY_MAX;
  });

  await withWorkspaceTransaction(pool, owner, c => c.query('DELETE FROM workspace_library_items WHERE workspace_id = $1', [ws])).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
