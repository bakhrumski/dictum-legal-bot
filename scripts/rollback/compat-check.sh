#!/usr/bin/env bash
# The whole old-code-on-new-schema check (docs/tariffs-v2-rollback.md) on a
# throwaway Postgres + pgvector:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/jai_compat scripts/rollback/compat-check.sh [old-ref]
# old-ref: the previous release (default origin/main). The database must be
# empty; it is migrated by booting the new code.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a throwaway database}"
OLD_REF="${1:-origin/main}"
OLD_DIR="$(mktemp -d)/old"
git worktree add -f "$OLD_DIR" "$OLD_REF" > /dev/null
ln -sfn "$PWD/node_modules" "$OLD_DIR/node_modules"
trap 'git worktree remove --force "$OLD_DIR" > /dev/null 2>&1 || true' EXIT

echo "== 1. new code boots and migrates";            PORT=3201 scripts/ci/boot-smoke.sh | tail -1
echo "== 2. new code writes v2 data";                node scripts/rollback/compat-check.js seed
echo "== 3. old code boots on the new schema";       (cd "$OLD_DIR" && PORT=3202 scripts/ci/boot-smoke.sh | tail -1)
echo "== 4. old code reads and writes";              OLD_DIR="$OLD_DIR" node scripts/rollback/compat-check.js old
echo "== 5. rollback prep (data kept)";              psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/rollback/tariffs-v2-to-v1.sql
echo "== 6. old code after prep";                    OLD_DIR="$OLD_DIR" node scripts/rollback/compat-check.js old
echo "== 7. roll forward";                           psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/rollback/tariffs-v1-to-v2.sql
echo "== 8. new code boots again";                   PORT=3203 scripts/ci/boot-smoke.sh | tail -1
echo "== 9. new code reads what both wrote";         node scripts/rollback/compat-check.js new
echo "compat check OK"
