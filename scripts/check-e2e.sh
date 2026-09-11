#!/usr/bin/env bash
set -euo pipefail
bun run build
# Require the runtime migration copy, with exactly the same SQL bytes as source.
test -f build/index.js
diff -r src/lib/db/migrations build/server/migrations
E2E_SKIP_BUILD=1 E2E_SEED_SETUP_PRE_ADMIN=0 bunx --no-install playwright test
# Each invocation seeds and launches its own fresh temporary database/server.
E2E_SKIP_BUILD=1 E2E_SEED_SETUP_PRE_ADMIN=1 bunx --no-install playwright test
