'use strict';

const crypto = require('crypto');
const express = require('express');
const { WorkspaceError, sendWorkspaceError } = require('./errors');
const {
  isActivePlatinum,
  requireTask,
  requireWorkspaceAccess,
  withWorkspaceTransaction,
} = require('./authz');
const { issueRealtimeToken } = require('./realtime-auth');
const {
  booleanValue,
  integer,
  isoDate,
  oneOf,
  optionalString,
  requiredString,
  slug,
  uniqueIntegerArray,
  uuid,
} = require('./validation');

const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'];
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const MEMBER_ROLES = ['member', 'viewer'];
const LINK_TYPES = ['dependency', 'subtask', 'related'];
const DOCUMENT_KINDS = ['upload', 'generated'];
const FILE_FORMATS = ['original', 'docx', 'pdf'];
const LANGUAGES = ['uz', 'ru', 'en'];
const GENERATED_FILE_MIME_TYPES = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
});
const UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/plain',
  'image/jpeg',
  'image/png',
]);

function actorId(req) {
  return integer(req.session && req.session.adminId, 'session.adminId', { min: 1 });
}

function jsonColumn(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function translateDatabaseError(error) {
  if (error instanceof WorkspaceError) return error;
  if (error && error.code === '23505') {
    return new WorkspaceError(409, 'workspace_conflict', 'Bu ma’lumot avval saqlangan');
  }
  if (error && ['23503', '23514', '22001', '22P02'].includes(error.code)) {
    return new WorkspaceError(400, 'workspace_constraint', 'Kiritilgan ma’lumotlar o‘zaro mos emas');
  }
  if (error && error.code === 'P0001') {
    return new WorkspaceError(409, 'workspace_rule_violation', error.message);
  }
  return error;
}

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    sendWorkspaceError(res, translateDatabaseError(error));
  });
}

function makeSlug(name) {
  const normalized = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const base = normalized.length >= 3 ? normalized : 'workspace';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function tokenHash(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest();
}

function parseJsonValue(value, field) {
  if (value == null) return null;
  if (typeof value !== 'object') {
    throw new WorkspaceError(400, 'invalid_input', `${field} JSON obyekt yoki ro‘yxat bo‘lishi kerak`);
  }
  return value;
}

async function assertWorkspaceMembers(db, workspaceId, userIds) {
  if (!userIds.length) return;
  const result = await db.query(
    `SELECT user_id FROM workspace_members
      WHERE workspace_id = $1 AND user_id = ANY($2::int[])`,
    [workspaceId, userIds]
  );
  if (result.rowCount !== userIds.length) {
    throw new WorkspaceError(400, 'invalid_workspace_member', 'Tanlangan foydalanuvchilardan biri Workspace a’zosi emas');
  }
}

async function replacePeople(db, table, column, workspaceId, taskId, userIds, userId) {
  await assertWorkspaceMembers(db, workspaceId, userIds);
  await db.query(
    `DELETE FROM ${table} WHERE workspace_id = $1 AND task_id = $2`,
    [workspaceId, taskId]
  );
  for (const selectedUserId of userIds) {
    await db.query(
      `INSERT INTO ${table} (workspace_id, task_id, user_id, ${column})
       VALUES ($1,$2,$3,$4)`,
      [workspaceId, taskId, selectedUserId, userId]
    );
  }
}

async function listTasks(pool, workspaceId, userId, query) {
  await requireWorkspaceAccess(pool, workspaceId, userId);
  const values = [workspaceId];
  const where = ['t.workspace_id = $1', 't.deleted_at IS NULL'];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  if (query.status) add('t.status = ?', oneOf(query.status, 'status', TASK_STATUSES));
  if (query.priority) add('t.priority = ?', oneOf(query.priority, 'priority', TASK_PRIORITIES));
  if (query.assigneeId) {
    const id = integer(query.assigneeId, 'assigneeId', { min: 1 });
    add('EXISTS (SELECT 1 FROM workspace_task_assignees a WHERE a.workspace_id=t.workspace_id AND a.task_id=t.id AND a.user_id=?)', id);
  }
  if (query.from) add('COALESCE(t.due_date,t.start_date) >= ?', isoDate(query.from, 'from', { optional: false }));
  if (query.to) add('COALESCE(t.start_date,t.due_date) <= ?', isoDate(query.to, 'to', { optional: false }));
  if (query.search) {
    const search = requiredString(query.search, 'search', { max: 200 });
    add("(t.title ILIKE '%' || ? || '%' OR t.description ILIKE '%' || ? || '%')", search);
    values.push(search);
    where[where.length - 1] = where[where.length - 1].replace('?', `$${values.length}`);
  }

  const limit = query.limit ? integer(query.limit, 'limit', { min: 1, max: 200 }) : 100;
  const offset = query.offset ? integer(query.offset, 'offset', { min: 0, max: 10000 }) : 0;
  values.push(limit, offset);
  const result = await pool.query(
    `SELECT t.*,
            COALESCE(people.assignees, '[]'::jsonb) AS assignees,
            COALESCE(watch.watchers, '[]'::jsonb) AS watchers,
            COALESCE(doc.document_count, 0)::int AS document_count,
            COALESCE(mem.memory_count, 0)::int AS memory_count
       FROM workspace_tasks t
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', a.id, 'username', a.username, 'fullName', a.full_name
         ) ORDER BY a.full_name, a.username) AS assignees
           FROM workspace_task_assignees ta JOIN admins a ON a.id = ta.user_id
          WHERE ta.workspace_id=t.workspace_id AND ta.task_id=t.id
       ) people ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'id', a.id, 'username', a.username, 'fullName', a.full_name
         ) ORDER BY a.full_name, a.username) AS watchers
           FROM workspace_task_watchers tw JOIN admins a ON a.id = tw.user_id
          WHERE tw.workspace_id=t.workspace_id AND tw.task_id=t.id
       ) watch ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS document_count FROM workspace_task_documents td
          WHERE td.workspace_id=t.workspace_id AND td.task_id=t.id
       ) doc ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS memory_count FROM workspace_task_memory_items tm
          WHERE tm.workspace_id=t.workspace_id AND tm.task_id=t.id
       ) mem ON true
      WHERE ${where.join(' AND ')}
      ORDER BY t.is_milestone DESC, t.due_date ASC NULLS LAST, t.updated_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { items: result.rows, limit, offset };
}

function mountWorkspaceRoutes(app, options) {
  const { pool, requireAuth, aiLimiter, aiService, verificationTokens } = options;
  if (!app || !pool || !requireAuth || !aiService) {
    throw new TypeError('Workspace routes require app, pool, requireAuth and aiService');
  }

  const router = express.Router();
  router.use(requireAuth);

  router.post('/workspace-account/email/verify', asyncRoute(async (req, res) => {
    if (!verificationTokens || typeof verificationTokens.get !== 'function') {
      throw new WorkspaceError(503, 'email_verification_unavailable', 'Email tasdiqlash xizmati mavjud emas');
    }
    const userId = actorId(req);
    const email = requiredString(req.body.email, 'email', { max: 255 }).toLowerCase();
    const token = requiredString(req.body.verificationToken, 'verificationToken', { min: 8, max: 200 });
    const code = requiredString(req.body.verificationCode, 'verificationCode', { min: 4, max: 12 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new WorkspaceError(400, 'invalid_email', 'Email manzili noto‘g‘ri');
    }
    const pending = verificationTokens.get(token);
    if (!pending || pending.channel !== 'email' || pending.email !== email
        || pending.code !== code || Date.now() > pending.expiresAt) {
      throw new WorkspaceError(400, 'email_code_invalid', 'Email tasdiqlash kodi noto‘g‘ri yoki muddati o‘tgan');
    }
    const account = await withWorkspaceTransaction(pool, userId, async (db) => {
      const duplicate = (await db.query(
        'SELECT id FROM admins WHERE lower(email)=lower($1) AND id<>$2 LIMIT 1',
        [email, userId]
      )).rows[0];
      if (duplicate) throw new WorkspaceError(409, 'email_in_use', 'Bu email boshqa hisobga biriktirilgan');
      return (await db.query(
        `UPDATE admins
            SET email=$2, email_verified=true, email_verification_source='email_otp'
          WHERE id=$1
          RETURNING id,email,email_verified,email_verification_source`,
        [userId, email]
      )).rows[0];
    });
    verificationTokens.delete(token);
    res.json({ account });
  }));

  router.get('/workspaces', asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT w.id, w.name, w.slug, w.default_language, w.owner_id,
              w.created_at, w.updated_at, wm.role,
              owner.tariff_plan, owner.tariff_expires_at,
              juristai_private.has_workspace_entitlement(w.owner_id) AS is_active,
              (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id=w.id) AS member_count,
              (SELECT count(*)::int FROM workspace_tasks t WHERE t.workspace_id=w.id AND t.deleted_at IS NULL) AS task_count
         FROM workspace_members wm
         JOIN workspaces w ON w.id=wm.workspace_id
         JOIN admins owner ON owner.id=w.owner_id
        WHERE wm.user_id=$1 AND w.deleted_at IS NULL
        ORDER BY w.updated_at DESC`,
      [actorId(req)]
    );
    res.json({ workspaces: result.rows });
  }));

  router.post('/workspaces', asyncRoute(async (req, res) => {
    const userId = actorId(req);
    const name = requiredString(req.body.name, 'name', { min: 2, max: 120 });
    const workspaceSlug = req.body.slug ? slug(req.body.slug) : makeSlug(name);
    const language = oneOf(req.body.defaultLanguage || 'uz', 'defaultLanguage', LANGUAGES);
    const workspace = await withWorkspaceTransaction(pool, userId, async (db) => {
      const account = (await db.query(
        'SELECT role, tariff_plan, tariff_expires_at FROM admins WHERE id=$1 FOR UPDATE',
        [userId]
      )).rows[0];
      if (!account || account.role !== 'user' || !isActivePlatinum(account)) {
        throw new WorkspaceError(402, 'workspace_platinum_required', 'Workspace yaratish faqat faol Platinum tarifi bilan mavjud');
      }
      return (await db.query(
        `INSERT INTO workspaces (name, slug, owner_id, default_language, created_by)
         VALUES ($1,$2,$3,$4,$3) RETURNING *`,
        [name, workspaceSlug, userId, language]
      )).rows[0];
    });
    res.status(201).json({ workspace, role: 'owner', isActive: true });
  }));

  router.get('/workspaces/:workspaceId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const access = await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const counts = (await pool.query(
      `SELECT
         (SELECT count(*)::int FROM workspace_members WHERE workspace_id=$1) AS members,
         (SELECT count(*)::int FROM workspace_tasks WHERE workspace_id=$1 AND deleted_at IS NULL) AS tasks,
         (SELECT count(*)::int FROM workspace_documents WHERE workspace_id=$1 AND archived_at IS NULL) AS documents,
         (SELECT count(*)::int FROM workspace_memory_items WHERE workspace_id=$1 AND superseded_at IS NULL) AS memory_items`,
      [workspaceId]
    )).rows[0];
    res.json({ workspace: access, counts });
  }));

  router.patch('/workspaces/:workspaceId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const userId = actorId(req);
    const updates = [];
    const values = [];
    if (req.body.name !== undefined) {
      values.push(requiredString(req.body.name, 'name', { min: 2, max: 120 }));
      updates.push(`name=$${values.length}`);
    }
    if (req.body.slug !== undefined) {
      values.push(slug(req.body.slug));
      updates.push(`slug=$${values.length}`);
    }
    if (req.body.defaultLanguage !== undefined) {
      values.push(oneOf(req.body.defaultLanguage, 'defaultLanguage', LANGUAGES));
      updates.push(`default_language=$${values.length}`);
    }
    if (!updates.length) throw new WorkspaceError(400, 'empty_update', 'O‘zgartiriladigan maydon berilmadi');
    const workspace = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner', requireActive: true });
      values.push(workspaceId);
      return (await db.query(
        `UPDATE workspaces SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,
        values
      )).rows[0];
    });
    res.json({ workspace });
  }));

  router.delete('/workspaces/:workspaceId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner' });
      await db.query('UPDATE workspaces SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [workspaceId, userId]);
    });
    res.status(204).end();
  }));

  router.get('/workspaces/:workspaceId/members', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const access = await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const result = await pool.query(
      `SELECT wm.user_id AS id, wm.role, wm.joined_at, a.username, a.full_name, a.email,
              a.last_active_at
         FROM workspace_members wm JOIN admins a ON a.id=wm.user_id
        WHERE wm.workspace_id=$1
        ORDER BY CASE wm.role WHEN 'owner' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                 COALESCE(a.full_name,a.username)`,
      [workspaceId]
    );
    res.json({ members: result.rows, currentRole: access.role });
  }));

  router.get('/workspaces/:workspaceId/invitations', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req), { minimumRole: 'owner' });
    const result = await pool.query(
      `SELECT id, target_email, target_username, role, invited_by, expires_at,
              accepted_by, accepted_at, revoked_at, created_at
         FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC`,
      [workspaceId]
    );
    res.json({ invitations: result.rows });
  }));

  router.post('/workspaces/:workspaceId/invitations', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const userId = actorId(req);
    const email = optionalString(req.body.email, 'email', { max: 255 });
    const username = optionalString(req.body.username, 'username', { max: 100 });
    if ((email ? 1 : 0) + (username ? 1 : 0) !== 1) {
      throw new WorkspaceError(400, 'invitation_target', 'Email yoki username’dan faqat bittasini kiriting');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new WorkspaceError(400, 'invalid_email', 'Email manzili noto‘g‘ri');
    }
    const role = oneOf(req.body.role || 'member', 'role', MEMBER_ROLES);
    const expiresInHours = req.body.expiresInHours == null
      ? 72 : integer(req.body.expiresInHours, 'expiresInHours', { min: 1, max: 168 });
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const invitation = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner', requireActive: true });
      await db.query(
        `UPDATE workspace_invitations SET revoked_at=now()
          WHERE workspace_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL
            AND expires_at<=now()
            AND (($2::text IS NOT NULL AND lower(target_email::text)=lower($2))
              OR ($3::text IS NOT NULL AND lower(target_username::text)=lower($3)))`,
        [workspaceId, email, username]
      );
      return (await db.query(
        `INSERT INTO workspace_invitations
           (workspace_id,target_email,target_username,role,token_hash,invited_by,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()+($7::int * interval '1 hour'))
         RETURNING id,target_email,target_username,role,expires_at,created_at`,
        [workspaceId, email && email.toLowerCase(), username && username.toLowerCase(),
          role, tokenHash(rawToken), userId, expiresInHours]
      )).rows[0];
    });
    const baseUrl = (process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.status(201).json({ invitation, inviteUrl: `${baseUrl}/workspace-invite.html?token=${encodeURIComponent(rawToken)}` });
  }));

  router.delete('/workspaces/:workspaceId/invitations/:invitationId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const invitationId = uuid(req.params.invitationId, 'invitationId');
    const userId = actorId(req);
    const invitation = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_invitations SET revoked_at=now()
          WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL
          RETURNING id,revoked_at`,
        [workspaceId, invitationId]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'invitation_not_found', 'Faol taklif topilmadi');
      return result.rows[0];
    });
    res.json({ invitation });
  }));

  router.post('/workspace-invitations/:token/accept', asyncRoute(async (req, res) => {
    const rawToken = requiredString(req.params.token, 'token', { min: 20, max: 200 });
    const userId = actorId(req);
    const accepted = await withWorkspaceTransaction(pool, userId, async (db) => {
      const invite = (await db.query(
        `SELECT i.id,i.workspace_id,i.role,i.expires_at,i.accepted_at,i.revoked_at,
                juristai_private.has_workspace_entitlement(w.owner_id) AS workspace_active
           FROM workspace_invitations i
           JOIN workspaces w ON w.id=i.workspace_id AND w.deleted_at IS NULL
          WHERE i.token_hash=$1 FOR UPDATE OF i`,
        [tokenHash(rawToken)]
      )).rows[0];
      if (!invite) throw new WorkspaceError(404, 'invitation_not_found', 'Taklif topilmadi');
      if (invite.revoked_at || invite.accepted_at || new Date(invite.expires_at) <= new Date()) {
        throw new WorkspaceError(410, 'invitation_unavailable', 'Taklif muddati tugagan yoki undan foydalanilgan');
      }
      if (!invite.workspace_active) {
        throw new WorkspaceError(402, 'workspace_platinum_required', 'Taklifni qabul qilish uchun Workspace Platinum tarifi faol bo‘lishi kerak');
      }
      const result = await db.query(
        `UPDATE workspace_invitations SET accepted_by=$2,accepted_at=now()
          WHERE id=$1 RETURNING workspace_id,role,accepted_at`,
        [invite.id, userId]
      );
      return result.rows[0];
    });
    res.json({ membership: accepted });
  }));

  router.patch('/workspaces/:workspaceId/members/:memberId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const memberId = integer(req.params.memberId, 'memberId', { min: 1 });
    const role = oneOf(req.body.role, 'role', MEMBER_ROLES);
    const userId = actorId(req);
    const member = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_members SET role=$3
          WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner'
          RETURNING workspace_id,user_id,role,joined_at`,
        [workspaceId, memberId, role]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'member_not_found', 'A’zo topilmadi');
      return result.rows[0];
    });
    res.json({ member });
  }));

  router.delete('/workspaces/:workspaceId/members/:memberId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const memberId = integer(req.params.memberId, 'memberId', { min: 1 });
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'owner', requireActive: true });
      const result = await db.query(
        `DELETE FROM workspace_members
          WHERE workspace_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id`,
        [workspaceId, memberId]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'member_not_found', 'A’zo topilmadi');
    });
    res.status(204).end();
  }));

  router.get('/workspaces/:workspaceId/tasks', asyncRoute(async (req, res) => {
    const data = await listTasks(pool, uuid(req.params.workspaceId, 'workspaceId'), actorId(req), req.query);
    res.json(data);
  }));

  router.get('/workspaces/:workspaceId/timeline', asyncRoute(async (req, res) => {
    const query = { ...req.query, limit: req.query.limit || 200 };
    const data = await listTasks(pool, uuid(req.params.workspaceId, 'workspaceId'), actorId(req), query);
    res.json({ ...data, zoomLevels: ['day', 'week', 'month', 'quarter'] });
  }));

  router.post('/workspaces/:workspaceId/tasks', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const userId = actorId(req);
    const title = requiredString(req.body.title, 'title', { max: 240 });
    const description = req.body.description == null ? '' : requiredString(req.body.description, 'description', { max: 50000 });
    const status = oneOf(req.body.status || 'todo', 'status', TASK_STATUSES);
    const priority = oneOf(req.body.priority || 'normal', 'priority', TASK_PRIORITIES);
    const startDate = isoDate(req.body.startDate, 'startDate');
    const dueDate = isoDate(req.body.dueDate, 'dueDate');
    const isMilestone = booleanValue(req.body.isMilestone, 'isMilestone');
    const assigneeIds = uniqueIntegerArray(req.body.assigneeIds || [], 'assigneeIds');
    const watcherIds = uniqueIntegerArray(req.body.watcherIds || [], 'watcherIds');
    if (!watcherIds.includes(userId)) watcherIds.push(userId);
    const task = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const created = (await db.query(
        `INSERT INTO workspace_tasks
           (workspace_id,title,description,status,priority,start_date,due_date,is_milestone,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [workspaceId, title, description, status, priority, startDate, dueDate, isMilestone, userId]
      )).rows[0];
      await replacePeople(db, 'workspace_task_assignees', 'assigned_by', workspaceId, created.id, assigneeIds, userId);
      await replacePeople(db, 'workspace_task_watchers', 'added_by', workspaceId, created.id, watcherIds, userId);
      return created;
    });
    res.status(201).json({ task });
  }));

  router.get('/workspaces/:workspaceId/tasks/:taskId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const task = await requireTask(pool, workspaceId, taskId);
    const [assignees, watchers, comments, links, documents, memory, activity] = await Promise.all([
      pool.query(`SELECT a.id,a.username,a.full_name FROM workspace_task_assignees x JOIN admins a ON a.id=x.user_id WHERE x.workspace_id=$1 AND x.task_id=$2 ORDER BY a.full_name,a.username`, [workspaceId, taskId]),
      pool.query(`SELECT a.id,a.username,a.full_name FROM workspace_task_watchers x JOIN admins a ON a.id=x.user_id WHERE x.workspace_id=$1 AND x.task_id=$2 ORDER BY a.full_name,a.username`, [workspaceId, taskId]),
      pool.query(`SELECT c.*,a.username,a.full_name FROM workspace_task_comments c JOIN admins a ON a.id=c.author_id WHERE c.workspace_id=$1 AND c.task_id=$2 AND c.deleted_at IS NULL ORDER BY c.created_at`, [workspaceId, taskId]),
      pool.query(`SELECT l.*,s.title AS source_title,t.title AS target_title FROM workspace_task_links l JOIN workspace_tasks s ON s.id=l.source_task_id JOIN workspace_tasks t ON t.id=l.target_task_id WHERE l.workspace_id=$1 AND (l.source_task_id=$2 OR l.target_task_id=$2) ORDER BY l.created_at`, [workspaceId, taskId]),
      pool.query(`SELECT d.*,v.id AS latest_version_id,v.version_number,v.created_at AS version_created_at FROM workspace_task_documents td JOIN workspace_documents d ON d.id=td.document_id LEFT JOIN LATERAL (SELECT id,version_number,created_at FROM workspace_document_versions WHERE document_id=d.id ORDER BY version_number DESC LIMIT 1) v ON true WHERE td.workspace_id=$1 AND td.task_id=$2 AND d.archived_at IS NULL ORDER BY d.updated_at DESC`, [workspaceId, taskId]),
      pool.query(`SELECT m.* FROM workspace_task_memory_items tm JOIN workspace_memory_items m ON m.id=tm.memory_item_id WHERE tm.workspace_id=$1 AND tm.task_id=$2 AND m.superseded_at IS NULL ORDER BY m.created_at DESC`, [workspaceId, taskId]),
      pool.query(`SELECT l.*,a.username,a.full_name FROM workspace_activity_log l LEFT JOIN admins a ON a.id=l.actor_id WHERE l.workspace_id=$1 AND l.task_id=$2 ORDER BY l.created_at DESC LIMIT 200`, [workspaceId, taskId]),
    ]);
    res.json({ task, assignees: assignees.rows, watchers: watchers.rows, comments: comments.rows,
      links: links.rows, documents: documents.rows, memory: memory.rows, activity: activity.rows });
  }));

  router.patch('/workspaces/:workspaceId/tasks/:taskId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const userId = actorId(req);
    const task = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const existing = await requireTask(db, workspaceId, taskId);
      const values = [];
      const updates = [];
      const fields = [
        ['title', 'title', (v) => requiredString(v, 'title', { max: 240 })],
        ['description', 'description', (v) => v === '' ? '' : requiredString(v, 'description', { max: 50000 })],
        ['status', 'status', (v) => oneOf(v, 'status', TASK_STATUSES)],
        ['priority', 'priority', (v) => oneOf(v, 'priority', TASK_PRIORITIES)],
        ['startDate', 'start_date', (v) => isoDate(v, 'startDate')],
        ['dueDate', 'due_date', (v) => isoDate(v, 'dueDate')],
        ['isMilestone', 'is_milestone', (v) => booleanValue(v, 'isMilestone')],
      ];
      for (const [input, column, parser] of fields) {
        if (Object.prototype.hasOwnProperty.call(req.body, input)) {
          values.push(parser(req.body[input]));
          updates.push(`${column}=$${values.length}`);
        }
      }
      if (!updates.length) throw new WorkspaceError(400, 'empty_update', 'O‘zgartiriladigan maydon berilmadi');
      values.push(userId, workspaceId, taskId);
      const updated = (await db.query(
        `UPDATE workspace_tasks SET ${updates.join(', ')},updated_by=$${values.length - 2}
          WHERE workspace_id=$${values.length - 1} AND id=$${values.length} RETURNING *`,
        values
      )).rows[0];
      const clientRevision = req.body.clientRevision == null ? null
        : integer(req.body.clientRevision, 'clientRevision', { min: 1 });
      return {
        ...updated,
        conflict: clientRevision !== null && clientRevision !== existing.revision
          ? { overwrittenRevision: existing.revision, updatedBy: existing.updated_by, updatedAt: existing.updated_at }
          : null,
      };
    });
    res.json({ task });
  }));

  router.delete('/workspaces/:workspaceId/tasks/:taskId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      await db.query('UPDATE workspace_tasks SET deleted_at=now(),deleted_by=$3,updated_by=$3 WHERE workspace_id=$1 AND id=$2', [workspaceId, taskId, userId]);
    });
    res.status(204).end();
  }));

  router.put('/workspaces/:workspaceId/tasks/:taskId/assignees', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const userId = actorId(req);
    const userIds = uniqueIntegerArray(req.body.userIds, 'userIds');
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      await replacePeople(db, 'workspace_task_assignees', 'assigned_by', workspaceId, taskId, userIds, userId);
    });
    res.json({ userIds });
  }));

  router.put('/workspaces/:workspaceId/tasks/:taskId/watchers', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const userId = actorId(req);
    const userIds = uniqueIntegerArray(req.body.userIds, 'userIds');
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      await replacePeople(db, 'workspace_task_watchers', 'added_by', workspaceId, taskId, userIds, userId);
    });
    res.json({ userIds });
  }));

  router.post('/workspaces/:workspaceId/tasks/:taskId/comments', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const userId = actorId(req);
    const body = requiredString(req.body.body, 'body', { max: 20000 });
    const comment = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      return (await db.query(
        `INSERT INTO workspace_task_comments (workspace_id,task_id,author_id,body)
         VALUES ($1,$2,$3,$4) RETURNING *`, [workspaceId, taskId, userId, body]
      )).rows[0];
    });
    res.status(201).json({ comment });
  }));

  router.patch('/workspaces/:workspaceId/tasks/:taskId/comments/:commentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const commentId = uuid(req.params.commentId, 'commentId');
    const userId = actorId(req);
    const body = requiredString(req.body.body, 'body', { max: 20000 });
    const comment = await withWorkspaceTransaction(pool, userId, async (db) => {
      const access = await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_task_comments SET body=$4
          WHERE workspace_id=$1 AND task_id=$2 AND id=$3 AND deleted_at IS NULL
            AND (author_id=$5 OR $6='owner') RETURNING *`,
        [workspaceId, taskId, commentId, body, userId, access.role]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'comment_not_found', 'Izoh topilmadi');
      return result.rows[0];
    });
    res.json({ comment });
  }));

  router.delete('/workspaces/:workspaceId/tasks/:taskId/comments/:commentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const commentId = uuid(req.params.commentId, 'commentId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      const access = await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_task_comments SET deleted_at=now(),deleted_by=$5
          WHERE workspace_id=$1 AND task_id=$2 AND id=$3 AND deleted_at IS NULL
            AND (author_id=$4 OR $6='owner') RETURNING id`,
        [workspaceId, taskId, commentId, userId, userId, access.role]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'comment_not_found', 'Izoh topilmadi');
    });
    res.status(204).end();
  }));

  router.post('/workspaces/:workspaceId/tasks/:taskId/links', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const sourceTaskId = uuid(req.params.taskId, 'taskId');
    const targetTaskId = uuid(req.body.targetTaskId, 'targetTaskId');
    const linkType = oneOf(req.body.linkType, 'linkType', LINK_TYPES);
    const userId = actorId(req);
    const link = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, sourceTaskId);
      await requireTask(db, workspaceId, targetTaskId);
      return (await db.query(
        `INSERT INTO workspace_task_links (workspace_id,source_task_id,target_task_id,link_type,created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [workspaceId, sourceTaskId, targetTaskId, linkType, userId]
      )).rows[0];
    });
    res.status(201).json({ link });
  }));

  router.delete('/workspaces/:workspaceId/tasks/:taskId/links/:linkId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const linkId = uuid(req.params.linkId, 'linkId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const result = await db.query(
        `DELETE FROM workspace_task_links WHERE workspace_id=$1 AND id=$2
          AND (source_task_id=$3 OR target_task_id=$3) RETURNING id`,
        [workspaceId, linkId, taskId]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'task_link_not_found', 'Vazifa aloqasi topilmadi');
    });
    res.status(204).end();
  }));

  router.post('/workspaces/:workspaceId/tasks/:taskId/memory/:memoryId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const memoryId = uuid(req.params.memoryId, 'memoryId');
    const userId = actorId(req);
    const link = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      const memory = (await db.query(
        `SELECT id FROM workspace_memory_items
          WHERE workspace_id=$1 AND id=$2 AND superseded_at IS NULL`,
        [workspaceId, memoryId]
      )).rows[0];
      if (!memory) throw new WorkspaceError(404, 'memory_not_found', 'Workspace xotirasi topilmadi');
      return (await db.query(
        `INSERT INTO workspace_task_memory_items (workspace_id,task_id,memory_item_id,linked_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
        [workspaceId, taskId, memoryId, userId]
      )).rows[0] || { workspace_id: workspaceId, task_id: taskId, memory_item_id: memoryId, linked_by: userId };
    });
    res.status(201).json({ link });
  }));

  router.delete('/workspaces/:workspaceId/tasks/:taskId/memory/:memoryId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const memoryId = uuid(req.params.memoryId, 'memoryId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await db.query(
        `DELETE FROM workspace_task_memory_items
          WHERE workspace_id=$1 AND task_id=$2 AND memory_item_id=$3`,
        [workspaceId, taskId, memoryId]
      );
    });
    res.status(204).end();
  }));

  router.post('/workspaces/:workspaceId/tasks/:taskId/documents/:documentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const userId = actorId(req);
    const link = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await requireTask(db, workspaceId, taskId);
      const document = (await db.query(
        `SELECT id FROM workspace_documents
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL`,
        [workspaceId, documentId]
      )).rows[0];
      if (!document) throw new WorkspaceError(404, 'document_not_found', 'Hujjat topilmadi');
      return (await db.query(
        `INSERT INTO workspace_task_documents (workspace_id,task_id,document_id,attached_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
        [workspaceId, taskId, documentId, userId]
      )).rows[0] || { workspace_id: workspaceId, task_id: taskId, document_id: documentId, attached_by: userId };
    });
    res.status(201).json({ link });
  }));

  router.delete('/workspaces/:workspaceId/tasks/:taskId/documents/:documentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const taskId = uuid(req.params.taskId, 'taskId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      await db.query(
        `DELETE FROM workspace_task_documents
          WHERE workspace_id=$1 AND task_id=$2 AND document_id=$3`,
        [workspaceId, taskId, documentId]
      );
    });
    res.status(204).end();
  }));

  router.get('/workspaces/:workspaceId/documents', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const result = await pool.query(
      `SELECT d.*,v.id AS latest_version_id,v.version_number,v.created_at AS version_created_at,
              COALESCE(f.files,'[]'::jsonb) AS files
         FROM workspace_documents d
         LEFT JOIN LATERAL (SELECT id,version_number,created_at FROM workspace_document_versions WHERE document_id=d.id ORDER BY version_number DESC LIMIT 1) v ON true
         LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',df.id,'format',df.file_format,'path',df.storage_object_path,'mimeType',df.mime_type,'byteSize',df.byte_size)) AS files FROM workspace_document_files df WHERE df.document_version_id=v.id) f ON true
        WHERE d.workspace_id=$1 AND d.archived_at IS NULL
        ORDER BY d.updated_at DESC`, [workspaceId]
    );
    res.json({ documents: result.rows });
  }));

  router.post('/workspaces/:workspaceId/documents', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const userId = actorId(req);
    const taskId = req.body.taskId ? uuid(req.body.taskId, 'taskId') : null;
    const title = requiredString(req.body.title, 'title', { max: 240 });
    const kind = oneOf(req.body.kind || 'upload', 'kind', DOCUMENT_KINDS);
    const contentText = optionalString(req.body.contentText, 'contentText', { max: 2000000 });
    const contentJson = parseJsonValue(req.body.contentJson, 'contentJson');
    const sourceAiRunId = req.body.sourceAiRunId ? uuid(req.body.sourceAiRunId, 'sourceAiRunId') : null;
    const created = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      if (taskId) await requireTask(db, workspaceId, taskId);
      if (sourceAiRunId) {
        const sourceRun = (await db.query(
          `SELECT id FROM workspace_ai_runs
            WHERE workspace_id=$1 AND id=$2 AND status IN ('succeeded','reused')`,
          [workspaceId, sourceAiRunId]
        )).rows[0];
        if (!sourceRun) {
          throw new WorkspaceError(400, 'invalid_source_ai_run', 'AI manbasi shu Workspace’ga tegishli yakunlangan natija bo‘lishi kerak');
        }
      }
      const document = (await db.query(
        `INSERT INTO workspace_documents (workspace_id,origin_task_id,title,kind,created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`, [workspaceId, taskId, title, kind, userId]
      )).rows[0];
      const version = (await db.query(
        `INSERT INTO workspace_document_versions
           (workspace_id,document_id,version_number,content_text,content_json,source_ai_run_id,created_by)
         VALUES ($1,$2,1,$3,$4,$5,$6) RETURNING *`,
        [workspaceId, document.id, contentText, contentJson && JSON.stringify(contentJson), sourceAiRunId, userId]
      )).rows[0];
      return { document, version };
    });
    res.status(201).json({ ...created, storagePathPrefix: `${workspaceId}/${created.document.id}/${created.version.id}/` });
  }));

  router.get('/workspaces/:workspaceId/documents/:documentId/versions', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const documentId = uuid(req.params.documentId, 'documentId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const result = await pool.query(
      `SELECT v.*,COALESCE(f.files,'[]'::jsonb) AS files
         FROM workspace_document_versions v
         LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(df)-'workspace_id') AS files FROM workspace_document_files df WHERE df.document_version_id=v.id) f ON true
        WHERE v.workspace_id=$1 AND v.document_id=$2 ORDER BY v.version_number DESC`,
      [workspaceId, documentId]
    );
    res.json({ versions: result.rows });
  }));

  router.patch('/workspaces/:workspaceId/documents/:documentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const userId = actorId(req);
    const title = requiredString(req.body.title, 'title', { max: 240 });
    const document = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_documents SET title=$3
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *`,
        [workspaceId, documentId, title]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'document_not_found', 'Hujjat topilmadi');
      return result.rows[0];
    });
    res.json({ document });
  }));

  router.delete('/workspaces/:workspaceId/documents/:documentId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const userId = actorId(req);
    await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const result = await db.query(
        `UPDATE workspace_documents SET archived_at=now()
          WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL RETURNING id`,
        [workspaceId, documentId]
      );
      if (!result.rows[0]) throw new WorkspaceError(404, 'document_not_found', 'Hujjat topilmadi');
    });
    res.status(204).end();
  }));

  router.post('/workspaces/:workspaceId/documents/:documentId/versions', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const userId = actorId(req);
    const contentText = optionalString(req.body.contentText, 'contentText', { max: 2000000 });
    const contentJson = parseJsonValue(req.body.contentJson, 'contentJson');
    const sourceAiRunId = req.body.sourceAiRunId ? uuid(req.body.sourceAiRunId, 'sourceAiRunId') : null;
    const version = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const document = (await db.query(
        'SELECT id FROM workspace_documents WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',
        [workspaceId, documentId]
      )).rows[0];
      if (!document) throw new WorkspaceError(404, 'document_not_found', 'Hujjat topilmadi');
      if (sourceAiRunId) {
        const sourceRun = (await db.query(
          `SELECT id FROM workspace_ai_runs
            WHERE workspace_id=$1 AND id=$2 AND status IN ('succeeded','reused')`,
          [workspaceId, sourceAiRunId]
        )).rows[0];
        if (!sourceRun) {
          throw new WorkspaceError(400, 'invalid_source_ai_run', 'AI manbasi shu Workspace’ga tegishli yakunlangan natija bo‘lishi kerak');
        }
      }
      const next = (await db.query(
        'SELECT COALESCE(max(version_number),0)+1 AS number FROM workspace_document_versions WHERE document_id=$1',
        [documentId]
      )).rows[0].number;
      const row = (await db.query(
        `INSERT INTO workspace_document_versions
           (workspace_id,document_id,version_number,content_text,content_json,source_ai_run_id,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [workspaceId, documentId, next, contentText, contentJson && JSON.stringify(contentJson), sourceAiRunId, userId]
      )).rows[0];
      await db.query('UPDATE workspace_documents SET updated_at=now() WHERE id=$1', [documentId]);
      return row;
    });
    res.status(201).json({ version, storagePathPrefix: `${workspaceId}/${documentId}/${version.id}/` });
  }));

  router.post('/workspaces/:workspaceId/documents/:documentId/versions/:versionId/files', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const documentId = uuid(req.params.documentId, 'documentId');
    const versionId = uuid(req.params.versionId, 'versionId');
    const userId = actorId(req);
    const fileFormat = oneOf(req.body.fileFormat, 'fileFormat', FILE_FORMATS);
    const objectPath = requiredString(req.body.objectPath, 'objectPath', { max: 1000 });
    const mimeType = requiredString(req.body.mimeType, 'mimeType', { max: 200 });
    const byteSize = integer(req.body.byteSize, 'byteSize', { min: 0, max: 52428800 });
    const digest = requiredString(req.body.sha256, 'sha256', { min: 64, max: 64 }).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new WorkspaceError(400, 'invalid_sha256', 'sha256 noto‘g‘ri');
    if (!UPLOAD_MIME_TYPES.has(mimeType)) {
      throw new WorkspaceError(400, 'unsupported_file_type', 'Bu fayl turi Workspace hujjatlari uchun qo‘llab-quvvatlanmaydi');
    }
    if (GENERATED_FILE_MIME_TYPES[fileFormat] && GENERATED_FILE_MIME_TYPES[fileFormat] !== mimeType) {
      throw new WorkspaceError(400, 'file_format_mismatch', 'Fayl formati va MIME turi mos emas');
    }
    const expectedPrefix = `${workspaceId}/${documentId}/${versionId}/`;
    const objectName = objectPath.slice(expectedPrefix.length);
    if (!objectPath.startsWith(expectedPrefix) || !objectName || objectName.includes('/')) {
      throw new WorkspaceError(400, 'invalid_storage_path', 'Storage fayl yo‘li hujjat versiyasiga mos emas');
    }
    const file = await withWorkspaceTransaction(pool, userId, async (db) => {
      await requireWorkspaceAccess(db, workspaceId, userId, { minimumRole: 'member', requireActive: true });
      const version = (await db.query(
        `SELECT id FROM workspace_document_versions
          WHERE workspace_id=$1 AND document_id=$2 AND id=$3`,
        [workspaceId, documentId, versionId]
      )).rows[0];
      if (!version) throw new WorkspaceError(404, 'document_version_not_found', 'Hujjat versiyasi topilmadi');
      const stored = (await db.query(
        `SELECT id,metadata FROM storage.objects
          WHERE bucket_id='workspace-documents' AND name=$1`, [objectPath]
      )).rows[0];
      if (!stored) throw new WorkspaceError(409, 'storage_upload_missing', 'Avval faylni Supabase Storage’ga yuklang');
      const storedSize = Number(stored.metadata && stored.metadata.size);
      const storedMimeType = stored.metadata && stored.metadata.mimetype;
      if (!Number.isFinite(storedSize) || !storedMimeType) {
        throw new WorkspaceError(409, 'storage_metadata_missing', 'Yuklangan fayl metadata-si to‘liq emas');
      }
      if (storedSize !== byteSize) {
        throw new WorkspaceError(409, 'storage_size_mismatch', 'Yuklangan fayl hajmi yuborilgan metadata bilan mos emas');
      }
      if (storedMimeType !== mimeType) {
        throw new WorkspaceError(409, 'storage_mime_mismatch', 'Yuklangan fayl turi yuborilgan metadata bilan mos emas');
      }
      return (await db.query(
        `INSERT INTO workspace_document_files
           (workspace_id,document_version_id,file_format,storage_object_path,mime_type,byte_size,sha256,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [workspaceId, versionId, fileFormat, objectPath, mimeType, byteSize, digest, userId]
      )).rows[0];
    });
    res.status(201).json({ file });
  }));

  router.get('/workspaces/:workspaceId/assistant/threads', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const result = await pool.query(
      `SELECT th.*,(SELECT count(*)::int FROM workspace_ai_messages m WHERE m.thread_id=th.id) AS message_count
         FROM workspace_ai_threads th WHERE th.workspace_id=$1 AND th.archived_at IS NULL
        ORDER BY th.updated_at DESC LIMIT 100`, [workspaceId]
    );
    res.json({ threads: result.rows });
  }));

  router.get('/workspaces/:workspaceId/assistant/threads/:threadId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const threadId = uuid(req.params.threadId, 'threadId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const thread = (await pool.query(
      'SELECT * FROM workspace_ai_threads WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL',
      [workspaceId, threadId]
    )).rows[0];
    if (!thread) throw new WorkspaceError(404, 'thread_not_found', 'AI suhbati topilmadi');
    const messages = await pool.query(
      `SELECT m.id,m.role,m.content,m.created_by,m.ai_run_id,m.memory_item_id,m.created_at,
              r.status AS run_status,r.provider,r.model,r.input_tokens,r.output_tokens,
              r.estimated_cost_usd,mi.content_json,mi.citations
         FROM workspace_ai_messages m
         LEFT JOIN workspace_ai_runs r
           ON r.workspace_id=m.workspace_id AND r.id=m.ai_run_id
         LEFT JOIN workspace_memory_items mi
           ON mi.workspace_id=m.workspace_id AND mi.id=m.memory_item_id
        WHERE m.workspace_id=$1 AND m.thread_id=$2
        ORDER BY m.created_at`,
      [workspaceId, threadId]
    );
    res.json({
      thread,
      messages: messages.rows.map((message) => {
        const {
          content_json: contentJson,
          citations,
          run_status: runStatus,
          provider,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimatedCostUsd,
          ...publicMessage
        } = message;
        if (message.role !== 'assistant') return publicMessage;
        const content = jsonColumn(contentJson, {});
        return {
          ...publicMessage,
          result: {
            status: runStatus || 'succeeded',
            reused: runStatus === 'reused',
            runId: message.ai_run_id,
            memoryItemId: message.memory_item_id,
            provider: provider || content.provider || null,
            model: model || content.model || null,
            topic: content.topic || null,
            rag: content.rag || null,
            ragUsed: Boolean(content.ragUsed),
            databases: content.databases || ['Workspace xotirasi', 'Korpus', 'Lex.uz'],
            qaBank: content.qaBank || null,
            citations: jsonColumn(citations, []),
            policyVersions: content.policyVersions || null,
            nextActions: content.nextActions || [],
            usage: {
              inTokens: Number(inputTokens || 0),
              outTokens: Number(outputTokens || 0),
              costUsd: Number(estimatedCostUsd || 0),
            },
          },
        };
      }),
    });
  }));

  router.post('/workspaces/:workspaceId/assistant/ask', aiLimiter || ((req, res, next) => next()), asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const question = requiredString(req.body.question, 'question', { min: 3, max: 20000 });
    const result = await aiService.ask({
      workspaceId,
      taskId: req.body.taskId ? uuid(req.body.taskId, 'taskId') : null,
      threadId: req.body.threadId ? uuid(req.body.threadId, 'threadId') : null,
      question,
      topic: optionalString(req.body.topic, 'topic', { max: 80 }),
      userId: actorId(req),
    });
    res.status(result.status === 'in_progress' ? 202 : 200).json(result);
  }));

  router.get('/workspaces/:workspaceId/assistant/runs/:runId', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    const runId = uuid(req.params.runId, 'runId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const run = (await pool.query(
      `SELECT id,task_id,thread_id,requested_by,status,provider,model,input_tokens,
              output_tokens,estimated_cost_usd,reused_memory_item_id,started_at,completed_at,
              error_code,error_message,created_at
         FROM workspace_ai_runs WHERE workspace_id=$1 AND id=$2`, [workspaceId, runId]
    )).rows[0];
    if (!run) throw new WorkspaceError(404, 'ai_run_not_found', 'AI so‘rovi topilmadi');
    let result = null;
    if (run.status === 'succeeded' || run.status === 'reused') {
      const memory = (await pool.query(
        `SELECT id,content_markdown,content_json,citations
           FROM workspace_memory_items
          WHERE workspace_id=$1
            AND superseded_at IS NULL
            AND (id=$2 OR source_ai_run_id=$3)
          ORDER BY CASE WHEN id=$2 THEN 0 ELSE 1 END
          LIMIT 1`,
        [workspaceId, run.reused_memory_item_id, run.id]
      )).rows[0];
      if (memory) {
        const content = jsonColumn(memory.content_json, {});
        result = {
          status: 'succeeded',
          reused: run.status === 'reused',
          runId: run.id,
          threadId: run.thread_id,
          memoryItemId: memory.id,
          reply: memory.content_markdown,
          provider: run.provider,
          model: run.model || content.model || null,
          topic: content.topic || null,
          rag: content.rag || null,
          ragUsed: Boolean(content.ragUsed),
          databases: content.databases || ['Workspace xotirasi', 'Korpus', 'Lex.uz'],
          qaBank: content.qaBank || null,
          citations: jsonColumn(memory.citations, []),
          policyVersions: content.policyVersions || null,
          nextActions: content.nextActions || [],
          usage: {
            inTokens: Number(run.input_tokens || 0),
            outTokens: Number(run.output_tokens || 0),
            costUsd: Number(run.estimated_cost_usd || 0),
          },
        };
      }
    }
    res.json({ run, result });
  }));

  router.get('/workspaces/:workspaceId/memory', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const result = await pool.query(
      `SELECT id,origin_task_id,kind,title,content_markdown,content_json,citations,
              source_ai_run_id,source_document_version_id,created_by,created_at
         FROM workspace_memory_items
        WHERE workspace_id=$1 AND superseded_at IS NULL
        ORDER BY created_at DESC LIMIT 200`, [workspaceId]
    );
    res.json({ memory: result.rows });
  }));

  router.get('/workspaces/:workspaceId/activity', asyncRoute(async (req, res) => {
    const workspaceId = uuid(req.params.workspaceId, 'workspaceId');
    await requireWorkspaceAccess(pool, workspaceId, actorId(req));
    const limit = req.query.limit ? integer(req.query.limit, 'limit', { min: 1, max: 200 }) : 100;
    const result = await pool.query(
      `SELECT l.*,a.username,a.full_name,t.title AS task_title
         FROM workspace_activity_log l
         LEFT JOIN admins a ON a.id=l.actor_id
         LEFT JOIN workspace_tasks t ON t.id=l.task_id
        WHERE l.workspace_id=$1
        ORDER BY l.created_at DESC LIMIT $2`,
      [workspaceId, limit]
    );
    res.json({ activity: result.rows });
  }));

  router.post('/workspace-realtime/token', asyncRoute(async (req, res) => {
    const userId = actorId(req);
    let workspace = null;
    if (req.body && req.body.workspaceId) {
      const workspaceId = uuid(req.body.workspaceId, 'workspaceId');
      const access = await requireWorkspaceAccess(pool, workspaceId, userId);
      workspace = {
        id: workspaceId,
        role: access.role,
        isActive: access.isActive,
        presenceChannel: `workspace:${workspaceId}:presence`,
      };
    }
    const bridge = await issueRealtimeToken(pool, userId);
    res.set('Cache-Control', 'no-store');
    res.json({ ...bridge, workspace });
  }));

  app.use('/api', router);
  return router;
}

module.exports = {
  DOCUMENT_KINDS,
  FILE_FORMATS,
  GENERATED_FILE_MIME_TYPES,
  LANGUAGES,
  LINK_TYPES,
  MEMBER_ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UPLOAD_MIME_TYPES,
  asyncRoute,
  makeSlug,
  mountWorkspaceRoutes,
  tokenHash,
  translateDatabaseError,
};
