'use strict';

require('dotenv').config();
const { pool } = require('../src/database/db');
const { runVersionedMigrations } = require('../src/database/migrations');

async function main() {
  const result = await runVersionedMigrations(pool);
  console.log(JSON.stringify({ status: 'ok', ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error('[MIGRATIONS] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
