#!/usr/bin/env bash
#
# The integration-test database, on this worktree's slot (#781).
#
# Every command here goes through scripts/dev-slot.sh, so the host port and the Compose project
# name follow the worktree instead of being written down three times. In the main worktree the
# slot is 0 and this is exactly what it always was: project `stamporama`, port 5433.
#
# Usage: scripts/e2e-db.sh [up|test|reset|down]

set -euo pipefail

cd "$(dirname "$0")/.."

eval "$(scripts/dev-slot.sh env)"

# `docker-compose.e2e.yml` reads STAMPORAMA_SLOT_SUFFIX for its project name and
# STAMPORAMA_E2E_DB_PORT for the published port; both are exported above.
if [ "${1:-test}" = "down" ]; then
  exec docker compose -f docker-compose.e2e.yml down
fi

docker compose -f docker-compose.e2e.yml up -d --wait

export DATABASE_URL="$STAMPORAMA_E2E_DATABASE_URL"

case "${1:-test}" in
up)
  echo "e2e database ready on localhost:$STAMPORAMA_E2E_DB_PORT (slot $STAMPORAMA_SLOT)"
  ;;
test)
  pnpm exec prisma migrate deploy
  # Quoted deliberately: no shell here expands `**`, so the pattern reaches the Node test runner
  # intact — which is what it did before, by accident, through a glob that matched nothing.
  pnpm exec tsx --tsconfig tests/integration/tsconfig.json --test 'tests/integration/**/*.test.ts'
  ;;
reset)
  # The one `prisma migrate reset` this project allows, and only against the throwaway e2e
  # database this script just started.
  pnpm exec prisma migrate reset --force
  ;;
*)
  echo "usage: $0 [up|test|reset|down]" >&2
  exit 2
  ;;
esac
