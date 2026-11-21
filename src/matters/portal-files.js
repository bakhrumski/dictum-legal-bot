'use strict';

/**
 * Client portal P3 (2026-11-10, docs/design/mijoz-portali.md §P3, accepted):
 * document requests and the client's uploads. No AI call, no OCR, no unit.
 *
 *   - the lawyer side (whoever writes the matter) opens a request - a title
 *     ("Pasport nusxasi") and an optional date - marks it received or opens it
 *     again, removes it (its files stay in the matter, unattached);
 *   - a client of the matter uploads a file while the matter is open: on the
 *     site (multipart) or by sending it to the bot (src/bot/telegram-portal.js),
 *     to a request or to the matter itself. FILE_MAX_MB (20) a file, MAX_FILES
 *     (200) a matter, PORTAL_FILES_MAX_BYTES (2 GB) over the matter's
 *     Workspace (or, with none, the owner's own matters); a fixed list of file
 *     types; the same file twice in one matter is 409;
 *   - the bytes are sealed (AAD matter_client_files.data:<matter>:<id>) and
 *     kept apart from the row, with the sha256 of the original - a download
 *     is opened, checked against it and sent as an attachment (nosniff);
 *   - a client sees and removes only their own files; the lawyer side sees all
 *     (a viewer reads), downloads and removes. Nothing here reads a file: the
 *     lawyer's page hands a downloaded file to the ordinary document door
 *     ("Nima qilaylik?", public/app/docact.js) - a text PDF / Word lands in the
 *     lawyer's OWN "Hujjatlarim" with no AI, a scan shows the OCR price first
 *     and counts against the lawyer's limit only when they confirm.
 * Everything else is 404, as in portal.js. A staff account opening a client's
 * file is in the access log (route side).
 */

const crypto = require('crypto');
const path = require('path');
const privacy = require('../privacy/crypto');
const { MatterError } = require('./store');

const FILE_MAX_BYTES = () => Math.min(20, Math.max(1, Number(process.env.PORTAL_FILE_MAX_MB) || 20)) * 1024 * 1024;
const MAX_FILES = 200;
const MAX_REQUESTS = 50;
const TOTAL_MAX_BYTES = () => Math.max(FILE_MAX_BYTES(), Number(process.env.PORTAL_FILES_MAX_BYTES) || 2 * 1024 * 1024 * 1024);
const TYPES = Object.freeze({
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8', rtf: 'application/rtf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const isUuid = v => typeof v === 'string' && UUID.test(v);
const fail = (status, code, message) => new MatterError(status, code, message);
const NOT_FOUND = () => fail(404, 'not_found', 'Topilmadi');
const dataAad = (matterId, id) => `matter_client_files.data:${matterId}:${id}`;
const extOf = name => path.extname(String(name || '')).slice(1).toLowerCase();
/** A file name safe to show and to send in a header: no path, no control characters, <= 180. */
function cleanName(name) {
  const base = String(name == null ? '' : name).replace(/\\/gu, '/').split('/').pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/gu, ' ').replace(/\s+/gu, ' ').trim();
  const ext = extOf(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base).slice(0, 170).trim() || 'fayl';
  return ext ? `${stem}.${ext}` : stem;
}
const isoDate = d => (d == null ? null : (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)));

function createPortalFiles({ db, lawyerMatter, clientMatter, tell = () => {} }) {
  const fileView = (f, me) => ({
    id: f.id, requestId: f.request_id || null, name: f.name, bytes: f.bytes, mime: f.mime, source: f.source, at: f.created_at,
    mine: f.uploaded_by === me, by: f.by_name || 'Mijoz',
  });
  const requestView = (r, files) => ({ id: r.id, title: r.title, dueOn: isoDate(r.due_on), status: r.status, createdAt: r.created_at, files });

  /** Requests (oldest first, open ones before received) with their files, and the files sent with no request. */
  async function listFor(matterId, me, onlyMine) {
    const [reqs, files] = await Promise.all([
      db.query(`SELECT * FROM matter_doc_requests WHERE matter_id = $1 ORDER BY (status = 'open') DESC, created_at`, [matterId]),
      db.query(`SELECT f.id, f.request_id, f.uploaded_by, f.name, f.mime, f.bytes, f.source, f.created_at, a.full_name AS by_name
                  FROM matter_client_files f LEFT JOIN admins a ON a.id = f.uploaded_by
                 WHERE f.matter_id = $1 ${onlyMine ? 'AND f.uploaded_by = $2' : ''} ORDER BY f.created_at`, onlyMine ? [matterId, me] : [matterId]),
    ]);
    const views = files.rows.map(f => fileView(f, me));
    const known = new Set(reqs.rows.map(r => r.id));
    return {
      requests: reqs.rows.map(r => requestView(r, views.filter(f => f.requestId === r.id))),
      files: views.filter(f => !f.requestId || !known.has(f.requestId)),
      limits: { fileMb: Math.round(FILE_MAX_BYTES() / 1048576), files: MAX_FILES, types: Object.keys(TYPES) },
    };
  }

  // ---------- the lawyer's side ----------

  async function lawyerList(matterId, adminId) {
    const m = await lawyerMatter(matterId, adminId, 'read');
    return listFor(m.id, adminId, false);
  }

  async function addRequest(matterId, adminId, { title, dueOn } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    const t = String(title == null ? '' : title).replace(/\s+/gu, ' ').trim().slice(0, 240);
    if (t.length < 2) throw fail(400, 'invalid', 'Qaysi hujjat kerakligini yozing');
    let due = null;
    if (dueOn != null && dueOn !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(dueOn)) || Number.isNaN(Date.parse(dueOn))) throw fail(400, 'invalid', 'Sana noto‘g‘ri');
      due = String(dueOn);
    }
    const n = (await db.query(`SELECT count(*)::int AS n FROM matter_doc_requests WHERE matter_id = $1 AND status = 'open'`, [m.id])).rows[0].n;
    if (n >= MAX_REQUESTS) throw fail(409, 'too_many', `Bir ishda ${MAX_REQUESTS} tadan ortiq ochiq so‘rov bo‘lmaydi.`);
    const r = (await db.query('INSERT INTO matter_doc_requests (matter_id, title, due_on, created_by) VALUES ($1, $2, $3, $4) RETURNING *', [m.id, t, due, adminId])).rows[0];
    tell(m.id, { kind: 'request', title: r.title, dueOn: isoDate(r.due_on) });
    return requestView(r, []);
  }

  async function setRequest(matterId, requestId, adminId, { status } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(requestId)) throw NOT_FOUND();
    if (status !== 'open' && status !== 'done') throw fail(400, 'invalid', 'status: open yoki done');
    const r = await db.query(`UPDATE matter_doc_requests SET status = $3, closed_at = CASE WHEN $3 = 'done' THEN now() ELSE NULL END WHERE id = $1 AND matter_id = $2 RETURNING *`, [requestId, m.id, status]);
    if (!r.rows[0]) throw NOT_FOUND();
    if (status === 'done') tell(m.id, { kind: 'request_done', title: r.rows[0].title });
    return { ok: true, status };
  }

  /** The request goes; files sent to it stay in the matter (request_id -> NULL). */
  async function removeRequest(matterId, requestId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(requestId)) throw NOT_FOUND();
    const r = await db.query('DELETE FROM matter_doc_requests WHERE id = $1 AND matter_id = $2', [requestId, m.id]);
    if (!r.rowCount) throw NOT_FOUND();
    return { ok: true };
  }

  // ---------- files ----------

  async function fileRow(matterId, fileId, { owner = null } = {}) {
    if (!isUuid(fileId)) throw NOT_FOUND();
    const r = await db.query(`SELECT * FROM matter_client_files WHERE id = $1 AND matter_id = $2 ${owner != null ? 'AND uploaded_by = $3' : ''}`,
      owner != null ? [fileId, matterId, owner] : [fileId, matterId]);
    if (!r.rows[0]) throw NOT_FOUND();
    return r.rows[0];
  }
  /** The original bytes: opened and checked against the sha256 written at upload. */
  async function bytesOf(row) {
    const d = (await db.query('SELECT data FROM matter_client_file_data WHERE file_id = $1', [row.id])).rows[0];
    if (!d) throw NOT_FOUND();
    const buf = privacy.openBytes(d.data, dataAad(row.matter_id, row.id));
    if (crypto.createHash('sha256').update(buf).digest('hex') !== row.sha256) throw fail(500, 'damaged', 'Fayl buzilgan - yuklab bo‘lmadi');
    return buf;
  }
  const download = async row => ({ name: row.name, mime: TYPES[extOf(row.name)] || 'application/octet-stream', buffer: await bytesOf(row), uploadedBy: row.uploaded_by });

  /** A client's upload. buffer: the file as sent; requestId optional (an open request of this matter). */
  async function upload(matterId, adminId, { buffer, name, requestId = null, source = 'web' } = {}) {
    const m = await clientMatter(matterId, adminId);
    if (m.status !== 'open') throw fail(409, 'closed', 'Ish yopilgan - fayl yuborib bo‘lmaydi');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'invalid', 'Fayl bo‘sh');
    if (buffer.length > FILE_MAX_BYTES()) throw fail(413, 'too_large', `Fayl ${Math.round(FILE_MAX_BYTES() / 1048576)} MB dan oshmasin`);
    const fileName = cleanName(name);
    if (!TYPES[extOf(fileName)]) throw fail(415, 'type', `Bu turdagi fayl qabul qilinmaydi. Mumkin: ${Object.keys(TYPES).join(', ')}`);
    // a file that already looks sealed would be stored as it is and never open again
    if (privacy.isSealedBytes(buffer)) throw fail(415, 'type', 'Bu faylni qabul qilib bo‘lmaydi');
    let request = null;
    if (requestId != null && requestId !== '') {
      if (!isUuid(requestId)) throw NOT_FOUND();
      request = (await db.query(`SELECT * FROM matter_doc_requests WHERE id = $1 AND matter_id = $2`, [requestId, m.id])).rows[0];
      if (!request) throw NOT_FOUND();
      if (request.status !== 'open') throw fail(409, 'request_closed', 'Bu so‘rov yopilgan');
    }
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const c = await db.connect();
    let row;
    try {
      await c.query('BEGIN');
      // one upload at a time a matter: the count and the size are checked and taken together
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`matter_client_files:${m.id}`]);
      const used = (await c.query('SELECT count(*)::int AS n FROM matter_client_files WHERE matter_id = $1', [m.id])).rows[0];
      if (used.n >= MAX_FILES) throw fail(409, 'too_many', `Bir ishga ${MAX_FILES} tadan ortiq fayl yuklanmaydi.`);
      const total = (await c.query(
        m.workspace_id
          ? 'SELECT COALESCE(sum(f.bytes), 0)::bigint AS b FROM matter_client_files f JOIN matters x ON x.id = f.matter_id WHERE x.workspace_id = $1'
          : 'SELECT COALESCE(sum(f.bytes), 0)::bigint AS b FROM matter_client_files f JOIN matters x ON x.id = f.matter_id WHERE x.owner_id = $1 AND x.workspace_id IS NULL',
        [m.workspace_id || m.owner_id])).rows[0];
      if (Number(total.b) + buffer.length > TOTAL_MAX_BYTES()) throw fail(409, 'storage_full', 'Yuristning fayl joyi to‘ldi - yuristingizga yozing.');
      const id = crypto.randomUUID();
      try {
        row = (await c.query(`INSERT INTO matter_client_files (id, matter_id, request_id, uploaded_by, name, mime, bytes, sha256, source)
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [id, m.id, request ? request.id : null, adminId, fileName, TYPES[extOf(fileName)], buffer.length, sha, source === 'telegram' ? 'telegram' : 'web'])).rows[0];
      } catch (e) {
        if (e && e.code === '23505') throw fail(409, 'already_uploaded', 'Bu fayl ishga allaqachon yuklangan');
        throw e;
      }
      await c.query('INSERT INTO matter_client_file_data (file_id, data) VALUES ($1, $2)', [id, privacy.sealBytes(buffer, dataAad(m.id, id))]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    tell(m.id, { kind: 'upload', fileId: row.id, authorId: adminId, name: row.name, request: request ? request.title : null, title: m.title, ownerId: m.owner_id,
      requestBy: request ? request.created_by : null });
    return fileView({ ...row, by_name: null }, adminId);
  }

  async function clientList(matterId, adminId) {
    const m = await clientMatter(matterId, adminId);
    const out = await listFor(m.id, adminId, true);
    return { ...out, canUpload: m.status === 'open' };
  }
  /** The client's open requests over every open matter they are a client of (the bot asks which one a file is for). */
  async function openRequestsOf(adminId) {
    const r = await db.query(
      `SELECT q.id, q.title, q.due_on, m.id AS matter_id, m.title AS matter_title
         FROM matter_doc_requests q JOIN matters m ON m.id = q.matter_id
         JOIN matter_clients c ON c.matter_id = m.id AND c.client_id = $1 AND c.removed_at IS NULL
        WHERE q.status = 'open' AND m.deleted_at IS NULL AND m.status = 'open' ORDER BY q.due_on NULLS LAST, q.created_at LIMIT 12`, [adminId]);
    return r.rows.map(x => ({ id: x.id, title: x.title, dueOn: isoDate(x.due_on), matterId: x.matter_id, matterTitle: x.matter_title }));
  }
  async function requestMatter(requestId) {
    if (!isUuid(requestId)) return null;
    const r = (await db.query('SELECT matter_id FROM matter_doc_requests WHERE id = $1', [requestId])).rows[0];
    return r ? r.matter_id : null;
  }
  async function clientDownload(matterId, fileId, adminId) {
    const m = await clientMatter(matterId, adminId);
    return download(await fileRow(m.id, fileId, { owner: adminId }));
  }
  async function clientRemove(matterId, fileId, adminId) {
    const m = await clientMatter(matterId, adminId);
    if (m.status !== 'open') throw fail(409, 'closed', 'Ish yopilgan');
    const row = await fileRow(m.id, fileId, { owner: adminId });
    await db.query('DELETE FROM matter_client_files WHERE id = $1', [row.id]);
    return { ok: true };
  }
  async function lawyerDownload(matterId, fileId, adminId) {
    const m = await lawyerMatter(matterId, adminId, 'read');
    return download(await fileRow(m.id, fileId));
  }
  async function lawyerRemove(matterId, fileId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    const row = await fileRow(m.id, fileId);
    await db.query('DELETE FROM matter_client_files WHERE id = $1', [row.id]);
    return { ok: true };
  }

  return { lawyerList, addRequest, setRequest, removeRequest, upload, clientList, openRequestsOf, requestMatter, clientDownload, clientRemove,
    lawyerDownload, lawyerRemove };
}

/** Account deletion: the person's uploaded files go (rows and bytes). */
async function deleteAccountFiles(db, adminId) {
  await db.query('DELETE FROM matter_client_files WHERE uploaded_by = $1', [adminId]).catch(e => { if (e.code !== '42P01') throw e; });
}

module.exports = { createPortalFiles, deleteAccountFiles, cleanName, TYPES, FILE_MAX_BYTES, MAX_FILES };
