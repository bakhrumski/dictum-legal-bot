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

// TLS verification: set DATABASE_CA_CERT to the Supabase project CA (PEM, from
// Dashboard → Settings → Database → SSL) to get *verified* TLS. Without it we
// fall back to unverified TLS (encrypted but MITM-able) so nothing breaks —
// but production should always set the CA.
const caCert = process.env.DATABASE_CA_CERT || null;
const sslConfig = !useSsl ? false
  : caCert ? { ca: caCert, rejectUnauthorized: true }
  : { rejectUnauthorized: false };
if (useSsl && !caCert) {
  console.warn('[DB] TLS certificate verification is OFF (set DATABASE_CA_CERT to enable).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 30000,
  // Supabase free tier drops idle connections; 30s idle timeout recycles them
  // before the server-side RST arrives, preventing "Connection terminated unexpectedly".
  idleTimeoutMillis: 30000,
  // This pool serves the WHOLE app: every API request, session lookups
  // (connect-pg-simple), the Telegram bot, and RAG queries. The old max of 3
  // was sized for a standalone ingest script and became the platform's hard
  // concurrency ceiling (~30-50 users). 15 stays well under Supabase's
  // 60-connection free-tier limit while allowing real parallelism; tune via
  // DB_POOL_MAX (move to Supavisor transaction pooling before going higher).
  max: parseInt(process.env.DB_POOL_MAX || '15', 10),
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
