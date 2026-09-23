#!/bin/bash
# Installs npm dependencies at the start of a Claude Code on the web session,
# so `npm test` and the other test scripts can run. Cloud containers start
# from a fresh clone with no node_modules; the container is cached after this
# hook finishes, which is why this uses `npm install` rather than `npm ci`.
set -euo pipefail

# Local machines keep their own node_modules; only the web needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
npm install --no-audit --no-fund --loglevel=error
