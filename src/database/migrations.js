'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MIGRATION_FILE_PATTERN = /^\d{8}_\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 'juristai:versioned-migrations:v1';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stripOuterTransaction(sql) {
  return String(sql)
    .replace(/^\uFEFF?\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;\s*$/i, '')
    .trim();
}

async function migrationFiles(migrationsDir) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL,
      execution_ms integer NOT NULL CHECK (execution_ms >= 0),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applies each checked-in SQL migration exactly once. Every file and its ledger
 * row commit in one transaction. A session advisory lock prevents two Render
 * instances from migrating concurrently during a rolling deploy.
 */
async function runVersionedMigrations(pool, options = {}) {
  if (process.env.VERSIONED_MIGRATIONS === 'off') {
    console.warn('[MIGRATIONS] Versioned migrations disabled by configuration');
    return { applied: [], skipped: [] };
  }

  const migrationsDir = options.migrationsDir
    || path.resolve(__dirname, '..', '..', 'migrations');
  const client = await pool.connect();
  const applied = [];
  const skipped = [];

  try {
    await ensureLedger(client);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);

    for (const filename of await migrationFiles(migrationsDir)) {
      const source = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
      const checksum = sha256(source);
      const existing = await client.query(
        'SELECT checksum FROM public.schema_migrations WHERE version = $1',
        [filename]
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum.trim() !== checksum) {
          throw new Error(
            `Migration ${filename} was changed after being applied; create a new migration instead`
          );
        }
        skipped.push(filename);
        continue;
      }

      const migrationSql = stripOuterTransaction(source);
      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '15s'");
        await client.query("SET LOCAL statement_timeout = '180s'");
        await client.query(migrationSql);
        await client.query(
          `INSERT INTO public.schema_migrations (version, checksum, execution_ms)
           VALUES ($1, $2, $3)`,
          [filename, checksum, Date.now() - startedAt]
        );
        await client.query('COMMIT');
        applied.push(filename);
        console.log(`[MIGRATIONS] Applied ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
      }
    }

    return { applied, skipped };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
    } catch (error) {
      console.warn('[MIGRATIONS] Advisory unlock failed:', error.message);
    }
    client.release();
  }
}

module.exports = {
  MIGRATION_FILE_PATTERN,
  migrationFiles,
  runVersionedMigrations,
  sha256,
  stripOuterTransaction,
};
