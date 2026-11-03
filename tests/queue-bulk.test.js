'use strict';

/**
 * The queue's actions on many requests (2026-11-03, src/queue/bulk.js): the
 * master only (role read again from the database), at most 200 ids, only
 * open requests close, only closed ones reopen, a bulk assignment sends ONE
 * message with the count (never a client's text); the list filters by type.
 *
 *   node tests/queue-bulk.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mountQueueBulk, ids, MAX_IDS } = require('../src/queue/bulk');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); } }

function harness({ role = 'master', assignee = { id: 5, role: 'lawyer', full_name: 'Dilshod', telegram_chat_id: 77 } } = {}) {
  const routes = {}, queries = [], sent = [], audit = [];
  const app = { post: (p, ...h) => { routes[p] = h; } };
  const run = async (q, args) => {
    queries.push({ q, args });
    if (/SELECT role FROM admins/.test(q)) return { rows: role ? [{ role }] : [] };
    if (/SELECT id, role, full_name, telegram_chat_id FROM admins/.test(q)) return { rows: assignee ? [assignee] : [] };
    if (/UPDATE requests SET status = 'closed'/.test(q)) return { rowCount: 2, rows: [{ id: 1 }, { id: 2 }] };
    if (/UPDATE requests SET status = 'pending'/.test(q)) return { rowCount: 1, rows: [{ id: 3 }] };
    if (/UPDATE requests SET assigned_to/.test(q)) return { rows: [{ id: 1 }, { id: 2 }, { id: 4 }] };
    if (/INSERT INTO request_students/.test(q)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  };
  const pool = { query: run, connect: async () => ({ query: run, release() {} }) };
  mountQueueBulk(app, { pool, requireMasterAdmin: (q, s, n) => n(), requireSameOrigin: (q, s, n) => n(),
    logAudit: (r, a, t, d) => audit.push([a, d]), notify: (who, list) => { sent.push({ who: who.id, list }); } });
  async function call(p, body) {
    const req = { body, session: { adminId: 1, role: 'master' } };
    let out = {}; const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; out.status = out.status || 200; return res; } };
    const hs = routes[p];
    let i = 0; const next = async () => { const h = hs[i++]; if (h) await h(req, res, next); };
    await next();
    return out;
  }
  return { call, queries, sent, audit, routes };
}

(async () => {
  console.log('queue bulk');
  await test('ids: unique positive integers, at most 200', () => {
    assert.deepStrictEqual(ids({ requestIds: [3, '3', 4, -1, 'x', 0, 5.5] }), [3, 4]);
    assert.strictEqual(ids({ requestIds: Array.from({ length: MAX_IDS + 1 }, (_, i) => i + 1) }), null);
    assert.deepStrictEqual(ids({}), []);
  });
  await test('a session that says master but the database does not -> 403, nothing changed', async () => {
    const h = harness({ role: 'lawyer' });
    const r = await h.call('/api/requests/close', { requestIds: [1, 2] });
    assert.strictEqual(r.status, 403);
    assert.ok(!h.queries.some(x => /UPDATE requests/.test(x.q)));
  });
  await test('close: only open statuses, who / when / why kept, counts of changed and left', async () => {
    const h = harness();
    const r = await h.call('/api/requests/close', { requestIds: [1, 2, 9], reason: '  eskirgan  ' });
    assert.deepStrictEqual(r.body, { closed: 2, skipped: 1, ids: [1, 2] });
    const q = h.queries.find(x => /status = 'closed'/.test(x.q));
    assert.ok(/AND status = ANY\(\$4::text\[\]\)/.test(q.q) && q.args[3].includes('pending') && !q.args[3].includes('answered'));
    assert.deepStrictEqual(q.args.slice(0, 3), [[1, 2, 9], 1, 'eskirgan']);
    assert.strictEqual((await h.call('/api/requests/close', { requestIds: [] })).status, 400);
  });
  await test('reopen: only closed ones go back to pending', async () => {
    const h = harness();
    const r = await h.call('/api/requests/reopen', { requestIds: [3, 4] });
    assert.deepStrictEqual(r.body, { reopened: 1, skipped: 1 });
    assert.ok(/WHERE id = ANY\(\$1::int\[\]\) AND status = 'closed'/.test(h.queries.find(x => /status = 'pending'/.test(x.q)).q));
  });
  await test('assign-bulk: a lawyer becomes the lawyer of open requests; one message for the batch', async () => {
    const h = harness();
    const r = await h.call('/api/requests/assign-bulk', { requestIds: [1, 2, 3, 4], assigneeId: 5 });
    assert.deepStrictEqual(r.body, { assigned: 3, skipped: 1, role: 'lawyer', name: 'Dilshod' });
    await new Promise(x => setTimeout(x, 5));
    assert.deepStrictEqual(h.sent, [{ who: 5, list: [1, 2, 4] }]);
    assert.ok(h.queries.some(x => x.q === 'COMMIT'));
  });
  await test('assign-bulk: a student is added; anyone else is refused', async () => {
    const st = harness({ assignee: { id: 6, role: 'student', full_name: 'Sardor', telegram_chat_id: null } });
    const r = await st.call('/api/requests/assign-bulk', { requestIds: [1], assigneeId: 6 });
    assert.strictEqual(r.body.assigned, 1); assert.strictEqual(st.sent.length, 0, 'no Telegram linked -> no message');
    const u = harness({ assignee: { id: 9, role: 'user' } });
    assert.strictEqual((await u.call('/api/requests/assign-bulk', { requestIds: [1], assigneeId: 9 })).status, 400);
  });
  await test('server: the type filter and the bulk routes are wired; the bulk message has no client text', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(/TYPE_GROUPS = \{ text: \['text'\], voice: \['voice', 'audio'\], file: \['photo', 'video', 'video_note', 'document'\] \}/.test(src));
    assert.ok(src.includes("require('../queue/bulk').mountQueueBulk(app"));
    const msg = src.slice(src.indexOf("require('../queue/bulk').mountQueueBulk(app"), src.indexOf("app.post('/api/assign-request'"));
    assert.ok(!/request_text/.test(msg));
    const mig = fs.readFileSync(path.join(__dirname, '../migrations/20261103_040_request_close.sql'), 'utf8');
    assert.ok(/ADD COLUMN IF NOT EXISTS closed_at/.test(mig) && /close_reason TEXT CHECK/.test(mig));
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
