'use strict';

/**
 * Astra audit S3, S4, S5 (static checks on the server's auth flows) and S6
 * (direct-message update guard, on real Postgres when TEST_DATABASE_URL is
 * set; see tariff-race.db.test.js).
 *
 *   node tests/auth-flows.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const between = (from, to) => { const i = server.indexOf(from); assert.ok(i >= 0, from); return server.slice(i, server.indexOf(to, i + from.length)); };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('auth flows');

  await test('S3: register/common accepts a Telegram id only with the verified registration session', () => {
    const route = between("app.post('/api/register/common'", "// Build a unique username");
    assert.ok(/regSessions\.get\(String\(req\.body\.reg_token/.test(route));
    assert.ok(/String\(req\.body\.otp_code \|\| ''\)\.trim\(\) === regSession\.otp/.test(route));
    assert.ok(/String\(regSession\.telegramUserId \|\| ''\) === tgUserId/.test(route));
    assert.ok(/regSessions\.delete\(/.test(route), 'the session is single use');
  });

  await test('S4: Google OAuth state is random, stored in the session, single use and compared in constant time', () => {
    const start = between("app.get('/auth/google', ", "\n});");
    assert.ok(/crypto\.randomBytes\(24\)\.toString\('hex'\)/.test(start));
    assert.ok(/req\.session\.googleOAuth = \{ state, mode, ts: Date\.now\(\) \}/.test(start));
    assert.ok(!/Buffer\.from\(JSON\.stringify\(\{ mode/.test(start), 'no forgeable base64 state');
    const cb = between("app.get('/auth/google/callback'", "const clientId");
    assert.ok(/delete req\.session\.googleOAuth/.test(cb));
    assert.ok(/crypto\.timingSafeEqual/.test(cb));
    assert.ok(/10 \* 60 \* 1000/.test(cb));
  });

  await test('S5: recovery codes lock after five wrong tries', () => {
    assert.ok(/const RECOVERY_MAX_TRIES = 5;/.test(server));
    const verify = between("app.post('/api/password-recovery/verify'", "\n});");
    assert.ok(/pending\.tries >= RECOVERY_MAX_TRIES/.test(verify) && /verificationTokens\.delete\('recovery_' \+ token\)/.test(verify));
  });

  await test('S5: password reset, role or password change and deletion end old sessions', () => {
    assert.ok(/DELETE FROM user_sessions WHERE \(sess->>'adminId'\) = \$1::text/.test(server));
    const reset = between("app.post('/api/password-recovery/reset'", "\n});");
    assert.strictEqual((reset.match(/await revokeSessionsFor\(/g) || []).length, 2, 'both reset paths');
    assert.ok(/if \(roleChanged \|\| \(password && password\.length > 0\)\) await revokeSessionsFor\(id, req\.sessionID\)/.test(server));
    assert.ok(/DELETE FROM admins WHERE id = \$1', \[adminId\]\);\s*await revokeSessionsFor\(adminId\)/.test(server));
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (S6 database cases skipped: TEST_DATABASE_URL not set)');
  } else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('refusing to run against what looks like a hosted database');
    process.exit(1);
  } else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool } = require('../src/database/db');
    const tag = `dm${Date.now()}`;
    const ids = (await pool.query(
      `INSERT INTO admins (username, password, full_name, role, tariff_plan) VALUES
         ($1, 'x', 'A', 'user', 'platinum'), ($2, 'x', 'B', 'user', 'platinum') RETURNING id`,
      [`${tag}a`, `${tag}b`])).rows.map(r => r.id);
    const [a, b] = ids;
    const client = await pool.connect();
    const as = async (actor, sql, params) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('juristai.actor_id', $1, true)", [String(actor)]);
      try { const r = await client.query(sql, params); await client.query('COMMIT'); return r; }
      catch (e) { await client.query('ROLLBACK'); throw e; }
    };
    const ws = (await as(a, `INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('DM', $1, $2, $2) RETURNING id`, [tag, a])).rows[0].id;
    await as(a, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [ws, b]);
    const dm = (await as(a, `INSERT INTO workspace_direct_messages (workspace_id, sender_id, recipient_id, body) VALUES ($1, $2, $3, 'asl') RETURNING id`, [ws, a, b])).rows[0].id;
    const upd = (actor, set) => as(actor, `UPDATE workspace_direct_messages SET ${set} WHERE id = $1`, [dm]);

    await test('S6: the recipient cannot rewrite the text', () => assert.rejects(upd(b, "body = 'soxta'"), /recipient may only mark/));
    await test('S6: nobody can change the parties', async () => {
      await assert.rejects(upd(b, `sender_id = ${b}, recipient_id = ${a}`), /cannot change/);
      await assert.rejects(upd(a, `recipient_id = ${a}`), /cannot change|two_parties/);
    });
    await test('S6: the sender cannot mark it read', () => assert.rejects(upd(a, 'read_at = now()'), /only the recipient marks/));
    await test('S6: the recipient marks read, the sender edits', async () => {
      await upd(b, 'read_at = now()');
      await upd(a, "body = 'tahrir'");
      const row = (await pool.query('SELECT body, read_at FROM workspace_direct_messages WHERE id = $1', [dm])).rows[0];
      assert.strictEqual(row.body, 'tahrir');
      assert.ok(row.read_at);
    });
    client.release();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
