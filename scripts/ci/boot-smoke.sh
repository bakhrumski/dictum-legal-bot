#!/usr/bin/env bash
# Boot the real server against a throwaway Postgres + pgvector, check that it
# comes up with every route mounted, run the anonymous-access matrix, and
# check that SIGTERM shuts it down cleanly.
#
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jai scripts/ci/boot-smoke.sh
#
# Needs: psql, a database the URL points at (empty is fine).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a throwaway database}"
export PGSSL=disable PORT="${PORT:-3000}"
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-123456:CI_FAKE_TOKEN_xxxxxxxxxxxxxxxxxxxxxxxx}"
export SESSION_SECRET="${SESSION_SECRET:-ci-session-secret-ci-session-secret}"
export JWT_SECRET="${JWT_SECRET:-ci-jwt-secret-ci-jwt-secret}"
export REG_BOT_TOKEN=""

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/ci/supabase-stubs.sql
node src/database/setup.js > /tmp/boot-smoke-setup.log 2>&1

node index.js > /tmp/boot-smoke.log 2>&1 &
PID=$!
trap 'kill -9 $PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" > /dev/null 2>&1; then break; fi
  if ! kill -0 $PID 2>/dev/null; then echo "server exited during boot"; tail -50 /tmp/boot-smoke.log; exit 1; fi
  sleep 2
done
curl -fsS "http://localhost:$PORT/api/health"; echo
grep -q "Shared AI memory mounted\|shared AI memory mounted" /tmp/boot-smoke.log || { echo "workspace routes not mounted"; tail -50 /tmp/boot-smoke.log; exit 1; }

BASE_URL="http://localhost:$PORT" node tests/authz-matrix.test.js

kill -TERM $PID
for _ in $(seq 1 30); do kill -0 $PID 2>/dev/null || break; sleep 1; done
if kill -0 $PID 2>/dev/null; then echo "server ignored SIGTERM"; exit 1; fi
grep -q "\[SHUTDOWN\] done" /tmp/boot-smoke.log || { echo "no clean shutdown"; tail -30 /tmp/boot-smoke.log; exit 1; }
echo "boot smoke OK"
