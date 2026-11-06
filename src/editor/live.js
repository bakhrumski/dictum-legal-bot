'use strict';

/**
 * Live co-editing (D3, docs/design/hujjat-muharriri.md §4): one WebSocket
 * endpoint on our own server, `/api/editor/live?doc=<id>`, carrying the Yjs
 * protocol (binary: 0 sync, 1 awareness) and small JSON control messages
 * (text). The text never passes through a third party.
 *
 *   - Who: the request's own session (the app's cookie, read by the same
 *     express-session middleware) and this site's Origin; the role from
 *     src/editor/access.js. No access -> the upgrade is refused (404 / 403).
 *   - What: an editor's updates are applied and passed on; a commenter's or
 *     viewer's are dropped (they read, and see the others' carets).
 *   - State: one Y.Doc per open document in this process (one Node process,
 *     as the rest of the app). It starts from the sealed `ystate`; when there
 *     is none, the first editor in is told to `seed` it from the stored HTML,
 *     and the others wait for that. Saved (sealed) 2 s after a change and when
 *     the last person leaves; then the room is dropped from memory.
 *   - Control: `init` (role, seed), `seed` (you seed: the seeder left),
 *     `comments` (reload the comment panel), `members` (re-check). A restore
 *     or a removed member closes the sockets with 4000 / 4003 - the page
 *     reloads or leaves.
 * The HTML snapshot (list, Word export, versions, AI) is still written by an
 * editor's page through PUT /api/editor/docs/:id with `live: true`, which
 * routes.js accepts only from an account with an open editor socket here.
 */

const { URL } = require('url');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const access = require('./access');

const MSG_SYNC = 0, MSG_AWARENESS = 1;
const SAVE_MS = 2000;
const MAX_PEOPLE = 25;
const MAX_FRAME = 4 * 1024 * 1024;

const rooms = new Map(); // docId -> room

function control(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sendBin(ws, buf) { if (ws.readyState === 1) ws.send(buf, { binary: true }); }

function createHub({ store, log = console }) {
  async function room(docId) {
    let r = rooms.get(docId);
    if (r) { await r.ready; return r; }
    r = { id: docId, doc: new Y.Doc(), conns: new Map(), seeded: false, seeder: null, timer: null };
    r.awareness = new awarenessProtocol.Awareness(r.doc);
    r.awareness.setLocalState(null);
    rooms.set(docId, r);
    r.ready = (async () => {
      const state = await store.liveState(docId).catch((e) => { log.warn('[EDITOR-LIVE] state not read:', e.message); return null; });
      if (state && state.length) { Y.applyUpdate(r.doc, new Uint8Array(state), 'load'); r.seeded = true; }
    })();
    await r.ready;
    r.doc.on('update', (update, origin) => {
      if (origin === 'load') return;
      if (!r.seeded && origin && origin.role) {
        r.seeded = true;
        // readers who opened it before it had text re-open it now
        for (const [ws, c] of r.conns) if (!access.can(c.role, 'write')) control(ws, { type: 'seeded' });
      }
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeUpdate(e, update);
      const buf = encoding.toUint8Array(e);
      for (const ws of r.conns.keys()) if (ws !== origin?.ws) sendBin(ws, buf);
      schedule(r);
    });
    r.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      if (origin && origin.ws) for (const id of added.concat(updated)) origin.clients.add(id);
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_AWARENESS);
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(r.awareness, changed));
      const buf = encoding.toUint8Array(e);
      for (const ws of r.conns.keys()) sendBin(ws, buf);
    });
    return r;
  }

  function schedule(r) {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => save(r), SAVE_MS);
  }
  async function save(r) {
    clearTimeout(r.timer); r.timer = null;
    if (!r.seeded) return;
    try { await store.saveLiveState(r.id, Y.encodeStateAsUpdate(r.doc)); } catch (e) { log.warn('[EDITOR-LIVE] state not saved:', e.message); }
  }

  /** A socket for this account on this document (role already checked). */
  async function join(ws, docId, adminId, role, name) {
    const r = await room(docId);
    if (r.conns.size >= MAX_PEOPLE) { ws.close(4029, 'full'); return; }
    const conn = { ws, adminId, role, name, clients: new Set() };
    r.conns.set(ws, conn);
    const editor = access.can(role, 'write');
    let seed = false;
    if (!r.seeded && editor && !r.seeder) { r.seeder = ws; seed = true; }
    control(ws, { type: 'init', role, seed, seeded: r.seeded });
    // the server's state to the newcomer, and its awareness of the others
    const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); syncProtocol.writeSyncStep1(e, r.doc); sendBin(ws, encoding.toUint8Array(e));
    const states = Array.from(r.awareness.getStates().keys());
    if (states.length) {
      const a = encoding.createEncoder(); encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(r.awareness, states)); sendBin(ws, encoding.toUint8Array(a));
    }
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // control is server -> page only
      try {
        const d = decoding.createDecoder(new Uint8Array(data));
        const type = decoding.readVarUint(d);
        if (type === MSG_SYNC) {
          const out = encoding.createEncoder(); encoding.writeVarUint(out, MSG_SYNC);
          const kind = decoding.readVarUint(d);
          if (kind === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(d, out, r.doc);
          else if (editor) {
            // only an editor's changes reach the document; a reader's are dropped
            const update = decoding.readVarUint8Array(d);
            Y.applyUpdate(r.doc, update, { ws, role });
          }
          if (encoding.length(out) > 1) sendBin(ws, encoding.toUint8Array(out));
        } else if (type === MSG_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(r.awareness, decoding.readVarUint8Array(d), conn);
        }
      } catch (e) { log.warn('[EDITOR-LIVE] bad frame:', e.message); ws.close(1003, 'bad frame'); }
    });
    ws.on('close', () => leave(r, ws));
  }

  async function leave(r, ws) {
    const conn = r.conns.get(ws);
    r.conns.delete(ws);
    if (conn && conn.clients.size) awarenessProtocol.removeAwarenessStates(r.awareness, Array.from(conn.clients), null);
    if (r.seeder === ws) {
      r.seeder = null;
      if (!r.seeded) {
        // the seeder left before seeding: the next editor in the room does it
        for (const [w, c] of r.conns) if (access.can(c.role, 'write')) { r.seeder = w; control(w, { type: 'seed' }); break; }
      }
    }
    if (!r.conns.size) {
      await save(r);
      // a closed room may already have a successor under the same id (a restore): only this one goes
      if (!r.conns.size && rooms.get(r.id) === r) { rooms.delete(r.id); r.doc.destroy(); }
    }
  }

  return {
    join,
    /** A control message to everyone on a document (e.g. comments changed). */
    broadcast(docId, obj, except = null) { const r = rooms.get(docId); if (r) for (const ws of r.conns.keys()) if (ws !== except) control(ws, obj); },
    /** Close sockets: everyone (a restore: 4000, they reload) or one account (removed / role changed: 4003). */
    async close(docId, { adminId = null, code = 4000 } = {}) {
      const r = rooms.get(docId);
      if (!r) return;
      // a restore: nothing of this room is written again (its timer stops, `seeded` off), the next session starts from html
      if (adminId == null) { r.seeded = false; clearTimeout(r.timer); r.timer = null; rooms.delete(docId); }
      for (const [ws, c] of r.conns) if (adminId == null || c.adminId === Number(adminId)) ws.close(code, 'reload');
    },
    /** Does this account have an open editor socket on the document (the live snapshot save)? */
    isLiveEditor(docId, adminId) {
      const r = rooms.get(docId);
      if (!r) return false;
      for (const c of r.conns.values()) if (c.adminId === Number(adminId) && access.can(c.role, 'write')) return true;
      return false;
    },
    people(docId) { const r = rooms.get(docId); return r ? r.conns.size : 0; },
    /**
     * The server stops (SIGTERM, a deploy): every open document's state is saved now (it lives only in
     * memory until its 2 s timer), then the sockets close with 1012 "service restart" - the page's
     * LiveDoc reconnects by itself to the next server, which opens the saved state.
     */
    async shutdown() {
      const list = Array.from(rooms.values());
      await Promise.all(list.map(r => save(r)));
      for (const r of list) for (const ws of r.conns.keys()) { try { ws.close(1012, 'restart'); } catch (_) { /* gone */ } }
      return list.length;
    },
    _rooms: rooms,
  };
}

let hub = null;
const getHub = () => hub;

/**
 * Attach to the HTTP server. sessionMiddleware: the app's express-session;
 * allowedOrigin(req) -> boolean (this site). EDITOR_LIVE=off leaves the
 * editor in its one-person mode (the page falls back by itself).
 */
function attachLive(server, { sessionMiddleware, pool, store, allowedOrigin, log = console }) {
  if (String(process.env.EDITOR_LIVE || '').toLowerCase() === 'off') return null;
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  hub = createHub({ store, log });
  const refuse = (socket, code, text) => { try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (_) { /* gone */ } socket.destroy(); };
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (_) { return; }
    if (url.pathname !== '/api/editor/live') return; // not ours (another upgrade handler may take it)
    if (allowedOrigin && !allowedOrigin(req)) return refuse(socket, 403, 'Forbidden');
    sessionMiddleware(req, {}, async () => {
      try {
        const adminId = req.session && req.session.adminId;
        if (!adminId) return refuse(socket, 401, 'Unauthorized');
        const docId = url.searchParams.get('doc');
        const doc = await access.load(pool, docId, adminId, 'read').catch((e) => (e.status === 403 ? false : Promise.reject(e)));
        if (!doc) return refuse(socket, 404, 'Not Found');
        const who = (await pool.query('SELECT full_name FROM admins WHERE id = $1', [adminId])).rows[0];
        wss.handleUpgrade(req, socket, head, (ws) => { hub.join(ws, doc.id, Number(adminId), doc.my_role, who && who.full_name).catch((e) => { log.warn('[EDITOR-LIVE] join:', e.message); ws.close(1011); }); });
      } catch (e) { log.warn('[EDITOR-LIVE] upgrade:', e.message); refuse(socket, 500, 'Error'); }
    });
  });
  return hub;
}

module.exports = { attachLive, getHub, createHub, MSG_SYNC, MSG_AWARENESS };
