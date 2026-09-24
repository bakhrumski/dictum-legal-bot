'use strict';

/**
 * How the first master account comes to exist, and the passwords no master
 * may sign in with.
 *
 * Every boot used to run
 *   INSERT INTO admins ... ('masteradmin', bcrypt('juristAI'), ..., 'master')
 *   ON CONFLICT DO NOTHING
 * — a master login whose password is in the repository — and to force the
 * 'admin' username to the master role, so if that account were ever removed,
 * whoever next registered 'admin' would become master.
 *
 * Now a master is created only when there is none at all and
 * MASTER_BOOTSTRAP_PASSWORD is set (12+ characters); nothing is promoted by
 * username. An account of any role that still has a password published in
 * this codebase is refused at sign-in until it is changed.
 */

// Passwords that have appeared in this repository for a seeded account:
// server.js seeded 'masteradmin' / 'juristAI'; src/database/setup.js created
// 'admin' / 'admin123' (master) and 'student' / 'student123'.
const PUBLISHED_MASTER_PASSWORDS = Object.freeze(['juristAI', 'admin123', 'student123']);

function isPublishedMasterPassword(password) {
  return PUBLISHED_MASTER_PASSWORDS.includes(String(password || ''));
}

/**
 * Creates the first master from MASTER_BOOTSTRAP_PASSWORD when the database
 * has none. Returns what it did, for the boot log.
 */
async function bootstrapFirstMaster(pool, bcrypt, env = process.env) {
  const password = String(env.MASTER_BOOTSTRAP_PASSWORD || '');
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM admins WHERE role = 'master'`);
  if (rows[0].n > 0) return { created: false, reason: 'master_exists' };
  if (!password) return { created: false, reason: 'no_bootstrap_password' };
  if (password.length < 12 || isPublishedMasterPassword(password)) {
    return { created: false, reason: 'bootstrap_password_too_weak' };
  }
  const username = String(env.MASTER_BOOTSTRAP_USERNAME || 'masteradmin').trim() || 'masteradmin';
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (username, password, full_name, role)
     VALUES ($1, $2, 'Master Admin', 'master')
     ON CONFLICT (username) DO NOTHING`,
    [username, hash]
  );
  return { created: true, username };
}

module.exports = { bootstrapFirstMaster, isPublishedMasterPassword, PUBLISHED_MASTER_PASSWORDS };
