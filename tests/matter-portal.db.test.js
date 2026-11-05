'use strict';

/**
 * Client portal P1a (docs/design/mijoz-portali.md, src/matters/portal.js): a
 * lawyer invites a client to one matter by a one-use link; the client sees
 * only the stage, the deadlines marked visible, notes for the client and
 * shared document copies - never the matter's own notes, chats or anything of
 * other matters; a stranger, a removed client and a used / revoked / expired
 * link get 404; a closed matter stays readable 30 days. No AI.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/matter-portal.db.test.js
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
  console.log('Client portal (P1a)');

  await test('wiring: routes mounted with auth, writes same-origin; no AI; account deletion ends client rows', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../matters/portal').mountPortalRoutes(app, { pool, requireAuth, requireSameOrigin"));
    const src = fs.readFileSync(path.join(__dirname, '../src/matters/portal.js'), 'utf8');
    for (const r of ["app.post('/api/matters/:id/portal/invites', ...W", "app.post('/api/portal/invite/:token/accept', ...W", "app.put('/api/matters/:id/portal/stage', ...W"]) assert.ok(src.includes(r), r);
    assert.ok(src.includes('const W = [requireSameOrigin, requireAuth];'));
    assert.ok(!/callAI|callCheapAI|callOpenAI|getEmbedding/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    assert.ok(fs.readFileSync(path.join(__dirname, '../src/services/account-deletion.js'), 'utf8').includes("require('../matters/portal').deleteAccountClientRows(db, adminId)"));
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
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const { createPortal } = require('../src/matters/portal');
  const { createMatterStore } = require('../src/matters/store');
  const scans = require('../src/ocr/scan-store');
  const portal = createPortal({ db: pool });
  const store = createMatterStore({ db: pool });
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async (name, plan = 'silver') => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', $2, 'user', $3, now() + interval '1 day') RETURNING id`, [`mp_${rnd()}`, name, plan])).rows[0].id;
    made.push(id); return id;
  };
  const lawyer = await mkUser('Yurist Aliyev'), member = await mkUser('Hamkasb'), client = await mkUser('Mijoz Karimov', 'free'), other = await mkUser('Begona', 'free');
  const ws = (await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma portal', $1, $2, $2) RETURNING id`, [`mp-${rnd()}`, lawyer]))).rows[0].id;
  await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3)`, [ws, member, lawyer]));
  const matter = await store.create(lawyer, { title: 'Pudratchi bilan nizo', summary: 'ICHKI XULOSA: mijozga aytilmaydi', workspaceId: ws });
  await store.addItem(matter.id, lawyer, { kind: 'note', note: 'Ichki yozuv: strategiya' });
  const other2 = await store.create(lawyer, { title: 'Boshqa ish' });
  const scan = await scans.saveScan(pool, { adminId: lawyer, fileHash: require('crypto').createHash('sha256').update(String(rnd())).digest('hex'), kind: 'text', pages: 2, bytes: 3000, text: 'Shartnoma matni: 3.1-band penya 0,1 foiz.', provider: 'text', name: 'Shartnoma.docx' });

  let token, inviteId;
  await test('invite: a one-use token, only its sha256 stored; a stranger cannot invite (404)', async () => {
    const inv = await portal.invite(matter.id, lawyer, { note: 'Karimov uchun' });
    token = inv.token; inviteId = inv.id;
    assert.ok(/^[A-Za-z0-9_-]{30,}$/.test(token) && inv.path === `/app/#/portal/taklif/${token}`);
    const row = (await pool.query('SELECT token_hash FROM matter_client_invites WHERE id = $1', [inv.id])).rows[0];
    assert.ok(/^[0-9a-f]{64}$/.test(row.token_hash) && row.token_hash !== token);
    await assert.rejects(portal.invite(matter.id, other, {}), e => e.status === 404);
    // a Workspace member of the matter invites too
    const inv2 = await portal.invite(matter.id, member, {});
    await portal.revokeInvite(matter.id, inv2.id, member);
    await assert.rejects(portal.inviteInfo(inv2.token, client), e => e.code === 'invite_gone', 'revoked');
  });

  await test('accept: the invite page names the matter and lawyer; the link works once; a lawyer of the matter is refused', async () => {
    const info = await portal.inviteInfo(token, client);
    assert.deepStrictEqual([info.matterTitle, info.lawyerName, info.alreadyClient], ['Pudratchi bilan nizo', 'Yurist Aliyev', false]);
    const extra = await portal.invite(matter.id, lawyer, {});
    await assert.rejects(portal.accept(extra.token, member), e => e.status === 409 && e.code === 'own_matter');
    const out = await portal.accept(token, client);
    assert.strictEqual(out.matterId, matter.id);
    await assert.rejects(portal.accept(token, other), e => e.code === 'invite_gone', 'used once');
    await pool.query(`UPDATE matter_client_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [extra.id]);
    await assert.rejects(portal.inviteInfo(extra.token, other), e => e.code === 'invite_gone', 'expired');
    await assert.rejects(portal.inviteInfo('not-a-token', other), e => e.code === 'invite_gone');
  });

  await test('the client sees nothing until marked; stage, visible deadlines, notes and doc copies only', async () => {
    let v = await portal.clientView(matter.id, client);
    assert.strictEqual(v.stage, 'received');
    assert.deepStrictEqual([v.deadlines.length, v.items.length], [0, 0]);
    const all = JSON.stringify(v);
    assert.ok(!all.includes('ICHKI') && !all.includes('Ichki yozuv') && !all.includes('workspace'), 'never the matter summary, notes or Workspace');
    await portal.setStage(matter.id, lawyer, 'waiting_client');
    await portal.addDeadline(matter.id, lawyer, { title: 'Ichki muddat', dueOn: '2026-12-01' });
    const d = await portal.addDeadline(matter.id, lawyer, { title: 'Hujjatlarni topshirish', dueOn: '2026-11-20', clientVisible: true });
    await portal.addItem(matter.id, lawyer, { kind: 'note', text: 'Pasport nusxasini yuboring.' });
    const doc = await portal.addItem(matter.id, lawyer, { kind: 'doc', scanId: scan.id || scan });
    await assert.rejects(portal.addItem(matter.id, lawyer, { kind: 'doc', scanId: scan.id || scan }), e => e.code === 'already_shared');
    v = await portal.clientView(matter.id, client);
    assert.strictEqual(v.stage, 'waiting_client');
    assert.deepStrictEqual(v.deadlines.map(x => x.title), ['Hujjatlarni topshirish']);
    assert.ok(v.items.some(i => i.kind === 'note' && i.text === 'Pasport nusxasini yuboring.'));
    const di = v.items.find(i => i.kind === 'doc');
    assert.ok(di && di.title === 'Shartnoma.docx' && di.text === undefined, 'a doc text comes on its own request');
    assert.ok(/penya 0,1 foiz/.test((await portal.clientItem(matter.id, doc.id, client)).text));
    const stored = (await pool.query('SELECT body FROM matter_client_items WHERE matter_id = $1', [matter.id])).rows;
    assert.ok(stored.every(r => /^enc:t1:/.test(r.body)), 'sealed');
    assert.ok(v.history.some(h => h.stage === 'waiting_client'));
    // hiding a deadline again
    await portal.updateDeadline(matter.id, d.id, lawyer, { clientVisible: false });
    assert.strictEqual((await portal.clientView(matter.id, client)).deadlines.length, 0);
    // the shared copy stays when the library document is deleted
    await scans.deleteDoc(pool, { adminId: lawyer, id: scan.id || scan });
    assert.ok(/penya/.test((await portal.clientItem(matter.id, doc.id, client)).text));
  });

  await test('isolation: another matter, another person, another person\'s library document, a viewer writing', async () => {
    await assert.rejects(portal.clientView(other2.id, client), e => e.status === 404);
    await assert.rejects(portal.clientView(matter.id, other), e => e.status === 404);
    const v = await portal.clientView(matter.id, client);
    await assert.rejects(portal.clientItem(other2.id, v.items[0].id, client), e => e.status === 404);
    const mine = await scans.saveScan(pool, { adminId: other, fileHash: require('crypto').createHash('sha256').update(String(rnd())).digest('hex'), kind: 'text', pages: 1, bytes: 100, text: 'Begona hujjat matni', provider: 'text', name: 'b.docx' });
    await assert.rejects(portal.addItem(matter.id, lawyer, { kind: 'doc', scanId: mine.id || mine }), e => e.status === 404);
    await assert.rejects(portal.setStage(matter.id, client, 'done'), e => e.status === 404, 'a client changes nothing');
    await assert.rejects(portal.panel(matter.id, client), e => e.status === 404, 'a client never sees the lawyer\'s panel');
    const list = await portal.myMatters(client);
    assert.deepStrictEqual(list.map(m => m.id), [matter.id]);
    const p = await portal.panel(matter.id, member);
    assert.ok(p.clients.some(c => c.name === 'Mijoz Karimov') && p.deadlines.length === 2);
  });

  await test('closed: readable 30 days after closing, then not; removed client 404; leaving', async () => {
    await store.update(matter.id, lawyer, { status: 'closed' });
    assert.ok((await portal.clientView(matter.id, client)).status === 'closed');
    await assert.rejects(portal.invite(matter.id, lawyer, {}), e => e.code === 'closed');
    await pool.query(`UPDATE matters SET closed_at = now() - interval '31 days' WHERE id = $1`, [matter.id]);
    await assert.rejects(portal.clientView(matter.id, client), e => e.status === 404);
    assert.deepStrictEqual(await portal.myMatters(client), []);
    await store.update(matter.id, lawyer, { status: 'open' });
    assert.ok(await portal.clientView(matter.id, client));
    await portal.removeClient(matter.id, client, lawyer);
    await assert.rejects(portal.clientView(matter.id, client), e => e.status === 404);
    const inv = await portal.invite(matter.id, lawyer, {});
    await portal.accept(inv.token, client);
    await portal.leave(matter.id, client);
    await assert.rejects(portal.clientView(matter.id, client), e => e.status === 404);
  });

  await pool.query('DELETE FROM matters WHERE owner_id = ANY($1::int[])', [made]).catch(() => {});
  await pool.query('DELETE FROM workspaces WHERE id = $1', [ws]).catch(() => {});
  await pool.query('DELETE FROM document_scans WHERE admin_id = ANY($1::int[])', [made]).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
