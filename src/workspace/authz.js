'use strict';

const { WorkspaceError } = require('./errors');

const ROLE_WEIGHT = Object.freeze({ viewer: 1, member: 2, owner: 3 });
const WORKSPACE_CREATOR_ACCOUNT_ROLES = new Set(['user', 'master']);

function isActivePlatinum(row) {
  if (!row || String(row.tariff_plan || '').toLowerCase() !== 'platinum') return false;
  if (!row.tariff_expires_at) return true;
  return new Date(row.tariff_expires_at).getTime() >= Date.now();
}

function planWeight(plan) {
  return { silver: 1, gold: 2, platinum: 3 }[String(plan || '').toLowerCase()] || 0;
}

function isActivePaidPlan(row, minimumPlan = 'silver') {
  if (!row || planWeight(row.member_tariff_plan || row.tariff_plan) < planWeight(minimumPlan)) return false;
  const expiresAt = row.member_tariff_expires_at || row.tariff_expires_at;
  return !expiresAt || new Date(expiresAt).getTime() >= Date.now();
}

function canCreateWorkspace(row) {
  return Boolean(
    row
    && WORKSPACE_CREATOR_ACCOUNT_ROLES.has(String(row.role || '').toLowerCase())
    && isActivePlatinum(row)
  );
}

async function getWorkspaceAccess(db, workspaceId, userId) {
  const result = await db.query(
    `SELECT w.id,
            w.name,
            w.slug,
            w.owner_id,
            w.default_language,
            w.deleted_at,
            wm.role,
            owner.tariff_plan,
            owner.tariff_expires_at,
            member_account.tariff_plan AS member_tariff_plan,
            member_account.tariff_expires_at AS member_tariff_expires_at
       FROM workspaces w
       JOIN workspace_members wm
         ON wm.workspace_id = w.id AND wm.user_id = $2
       JOIN admins owner ON owner.id = w.owner_id
       JOIN admins member_account ON member_account.id = wm.user_id
      WHERE w.id = $1`,
    [workspaceId, userId]
  );

  const access = result.rows[0];
  if (!access || access.deleted_at) {
    throw new WorkspaceError(404, 'workspace_not_found', 'Workspace topilmadi');
  }

  const ownerActive = isActivePlatinum(access);
  const memberActive = access.role === 'owner' || isActivePaidPlan(access, 'silver');
  return { ...access, ownerActive, memberActive, isActive: ownerActive && memberActive };
}

async function requireWorkspaceAccess(db, workspaceId, userId, options = {}) {
  const minimumRole = options.minimumRole || 'viewer';
  const requireActive = options.requireActive !== false;
  const access = await getWorkspaceAccess(db, workspaceId, userId);

  if ((ROLE_WEIGHT[access.role] || 0) < ROLE_WEIGHT[minimumRole]) {
    throw new WorkspaceError(403, 'workspace_forbidden', 'Bu amal uchun Workspace rolingiz yetarli emas');
  }

  if (requireActive && !access.isActive) {
    throw new WorkspaceError(
      402,
      'workspace_platinum_required',
      access.ownerActive
        ? 'Workspace’dan foydalanish uchun kamida faol Silver tarifi kerak'
        : 'Workspace’dan foydalanish uchun Owner’ning faol Platinum tarifi kerak'
    );
  }

  return access;
}

async function requireTask(db, workspaceId, taskId, options = {}) {
  const includeDeleted = options.includeDeleted === true;
  const result = await db.query(
    `SELECT * FROM workspace_tasks
      WHERE workspace_id = $1
        AND id = $2
        AND ($3::boolean OR deleted_at IS NULL)`,
    [workspaceId, taskId, includeDeleted]
  );
  if (!result.rows[0]) {
    throw new WorkspaceError(404, 'task_not_found', 'Vazifa topilmadi');
  }
  return result.rows[0];
}

async function withWorkspaceTransaction(pool, actorId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('juristai.actor_id', $1, true)", [String(actorId)]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ROLE_WEIGHT,
  canCreateWorkspace,
  getWorkspaceAccess,
  isActivePaidPlan,
  isActivePlatinum,
  requireTask,
  requireWorkspaceAccess,
  withWorkspaceTransaction,
};
