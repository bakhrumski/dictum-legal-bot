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
  // Supabase free tier drops idle connections; 30s idle timeout recycles them
  // before the server-side RST arrives, preventing "Connection terminated unexpectedly".
  idleTimeoutMillis: 30000,
  // 3 clients is plenty for ingest; keeps well under the 60-connection free-tier limit.
  max: 3,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Without this listener, a backend-initiated connection drop emits an 'error'
// event on the idle client inside the pool, which Node treats as an unhandled
// error and crashes the process (even mid-ingest).
pool.on('error', (err) => {
  console.error('[DB] Pool idle client error (connection dropped):', err.message);
});

module.exports = { pool };
