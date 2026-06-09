require('dotenv').config();
const { Pool } = require('pg');

// Supabase (pooler and direct) require TLS. node-postgres does NOT enable SSL
// just because the host is remote — without this the handshake stalls and the
// connection dies with "Connection terminated due to connection timeout" even
// though the TCP socket opens fine. rejectUnauthorized:false is needed because
// the Supabase pooler presents a cert for *.pooler.supabase.com that Node's
// default CA bundle won't validate against the project hostname.
// Allow opting out via PGSSL=disable for local/unencrypted Postgres.
const useSsl = process.env.PGSSL !== 'disable';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 300000, // 5 min — prevents socket drops during long ingest batches
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

module.exports = { pool };