'use strict';

const jwt = require('jsonwebtoken');
const { WorkspaceError } = require('./errors');

const TOKEN_TTL_SECONDS = 5 * 60;

function requireSupabaseBridgeConfig() {
  const privateKey = process.env.SUPABASE_JWT_PRIVATE_KEY
    ? process.env.SUPABASE_JWT_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null;
  const signingKey = privateKey
    || process.env.SUPABASE_JWT_SIGNING_SECRET
    || process.env.SUPABASE_JWT_SECRET;
  const algorithm = process.env.SUPABASE_JWT_ALGORITHM
    || (privateKey ? 'ES256' : 'HS256');
  const keyId = process.env.SUPABASE_JWT_KEY_ID || null;
  const url = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!signingKey || !url || !apiKey) {
    throw new WorkspaceError(
      503,
      'realtime_not_configured',
      'Realtime ulanishi hali sozlanmagan',
      {
        missing: [
          !signingKey && 'SUPABASE_JWT_SIGNING_SECRET (yoki legacy SUPABASE_JWT_SECRET)',
          !url && 'SUPABASE_URL',
          !apiKey && 'SUPABASE_PUBLISHABLE_KEY (yoki legacy SUPABASE_ANON_KEY)',
        ].filter(Boolean),
      }
    );
  }

  if (!['HS256', 'ES256', 'RS256'].includes(algorithm)) {
    throw new WorkspaceError(503, 'realtime_signing_algorithm', 'Realtime JWT algoritmi qo‘llab-quvvatlanmaydi');
  }
  if (algorithm !== 'HS256' && !keyId) {
    throw new WorkspaceError(503, 'realtime_key_id', 'Asimmetrik Realtime JWT uchun SUPABASE_JWT_KEY_ID kerak');
  }

  return { signingKey, algorithm, keyId, url: url.replace(/\/$/, ''), apiKey };
}

async function issueRealtimeToken(db, userId) {
  const config = requireSupabaseBridgeConfig();
  const result = await db.query(
    `SELECT id, supabase_subject, username
       FROM admins
      WHERE id = $1`,
    [userId]
  );
  const account = result.rows[0];
  if (!account) {
    throw new WorkspaceError(401, 'account_not_found', 'Foydalanuvchi hisobi topilmadi');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + TOKEN_TTL_SECONDS;
  const token = jwt.sign(
    {
      aud: 'authenticated',
      role: 'authenticated',
      app_user_id: account.id,
      user_metadata: { username: account.username },
      aal: 'aal1',
      exp: expiresAt,
    },
    config.signingKey,
    {
      algorithm: config.algorithm,
      subject: account.supabase_subject,
      ...(config.keyId ? { keyid: config.keyId } : {}),
    }
  );

  return {
    token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    supabaseUrl: config.url,
    supabaseKey: config.apiKey,
  };
}

module.exports = {
  TOKEN_TTL_SECONDS,
  issueRealtimeToken,
  requireSupabaseBridgeConfig,
};
