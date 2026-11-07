'use strict';

const { WorkspaceError } = require('./errors');

const ROLE_WEIGHT = Object.freeze({ viewer: 1, member: 2, owner: 3 });
const WORKSPACE_CREATOR_ACCOUNT_ROLES = new Set(['user', 'master']);

const STAFF_ROLES = new Set(['master', 'student', 'lawyer']);

// Owning a Workspace: an active Silver, Gold or Platinum plan (2026-10-28,
// owner: "Workspace ni barcha tarif uchun och"; was Platinum only), the same
// rule as the database's has_workspace_entitlement (migration 025).
function isActiveOwnerPlan(row) {
  if (!row || planWeight(row.tariff_plan) < 1) return false;
  if (!row.tariff_expires_at) return true;
  return new Date(row.tariff_expires_at).getTime() >= Date.now();
}
// the old name, kept for its callers: it now means any paid plan
const isActivePlatinum = isActiveOwnerPlan;

// An internal (staff) Workspace is active while its owner is a master, with no
// plan (the CustDev pilot); a row carries w.internal and owner.role as owner_role.
function isWorkspaceOwnerActive(row) {
  if (!row) return false;
  if (row.internal && String(row.owner_role || '').toLowerCase() === 'master') return true;
  return isActiveOwnerPlan(row);
}

function planWeight(plan) {
  return { silver: 1, gold: 2, platinum: 3 }[String(plan || '').toLowerCase()] || 0;
}

// A membership row carries both the owner's plan (tariff_plan) and the
// member's own (member_tariff_plan). The member is judged on their own plan
// only; falling back to the owner's let a member with no plan ride on the
// owner's Platinum (audit M4). Master accounts need no plan.
function isActivePaidPlan(row, minimumPlan = 'silver') {
  if (!row) return false;
  const isMembership = Object.prototype.hasOwnProperty.call(row, 'member_tariff_plan');
  if (isMembership && String(row.member_role || '').toLowerCase() === 'master') return true;
  const plan = isMembership ? row.member_tariff_plan : row.tariff_plan;
  const expiresAt = isMembership ? row.member_tariff_expires_at : row.tariff_expires_at;
  if (planWeight(plan) < planWeight(minimumPlan)) return false;
  return !expiresAt || new Date(expiresAt).getTime() >= Date.now();
}

function canCreateWorkspace(row, { internal = false } = {}) {
  if (!row) return false;
  const role = String(row.role || '').toLowerCase();
  // an internal Workspace: a master only, no plan needed
  if (internal) return role === 'master';
  return Boolean(WORKSPACE_CREATOR_ACCOUNT_ROLES.has(role) && isActiveOwnerPlan(row));
}

/** A member keeps access by their own paid plan; in an internal Workspace, by being staff. */
function isMemberActive(row) {
  if (!row) return false;
  if (row.role === 'owner') return true;
  if (row.internal && STAFF_ROLES.has(String(row.member_role || '').toLowerCase())) return true;
  return isActivePaidPlan(row, 'silver');
}

async function getWorkspaceAccess(db, workspaceId, userId) {
  const result = await db.query(
    `SELECT w.id,
            w.name,
            w.slug,
            w.owner_id,
            w.default_language,
            w.deleted_at,
            w.internal,
            wm.role,
            owner.role AS owner_role,
            owner.tariff_plan,
            owner.tariff_expires_at,
            member_account.tariff_plan AS member_tariff_plan,
            member_account.tariff_expires_at AS member_tariff_expires_at,
            member_account.role AS member_role
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

  const ownerActive = isWorkspaceOwnerActive(access);
  const memberActive = isMemberActive(access);
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
        : 'Workspace’dan foydalanish uchun Owner’ning faol pullik tarifi (Silver, Gold yoki Platinum) kerak'
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
  isActiveOwnerPlan,
  isWorkspaceOwnerActive,
  isMemberActive,
  STAFF_ROLES,
  requireTask,
  requireWorkspaceAccess,
  withWorkspaceTransaction,
};
