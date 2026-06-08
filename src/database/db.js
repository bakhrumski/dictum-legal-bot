require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 300000, // 5 min — prevents socket drops during long ingest batches
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

module.exports = { pool };