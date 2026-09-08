#!/usr/bin/env bash
#
# The integration-test database, on this worktree's slot (#781).
#
# Every command here goes through scripts/dev-slot.sh, so the host port and the Compose project
# name follow the worktree instead of being written down three times. In the main worktree the
# slot is 0 and this is exactly what it always was: project `stamporama`, port 5433.
#
# Usage: scripts/e2e-db.sh [up|test|time|reset|down]

set -euo pipefail

cd "$(dirname "$0")/.."

# `docker` must be on the PATH this script is run with. That is a requirement rather than something
# to work around, and the message below exists because the *failure* is what misleads (#933).
#
# An empty `command -v docker` is a statement about this shell's PATH and nothing more. A session
# inherits its PATH from the process that launched it, so it can be running an environment older
# than the machine's configuration — the binary may be installed, and on the PATH of a shell you
# open yourself, and still absent here. Four sessions met exactly that: two checked Docker Desktop,
# colima, podman and the usual directories, found nothing, and reported that Docker was not
# installed. Every check was correct and the conclusion was false, and what makes that expensive is
# `pnpm test:integration` — AGENTS.md requires it before a schema or domain-logic change, so a
# session that believes the runtime is missing does not verify some other way. It stops verifying.
#
# So say what is needed and what was actually looked at, and let nothing else be inferred.
require_docker() {
  if command -v docker >/dev/null 2>&1; then
    return 0
  fi

  {
    echo "e2e-db: \`docker\` is not on PATH, and this script needs it to start the test database."
    echo
    echo "That is a fact about *this shell's* PATH, and not yet a fact about this machine. A"
    echo "session inherits its PATH from whatever launched it, so it can be older than the"
    echo "machine's configuration. Before concluding Docker is missing, ask a shell of your own:"
    echo
    echo "  zsh -ic 'command -v docker'   # or your own interactive shell"
    echo
    echo "Answers there and not here — the environment is stale; restart whatever launched this"
    echo "session. Answers nowhere — Docker really is absent; install it."
    echo
    echo "PATH as this script sees it:"
    printf '%s\n' "$PATH" | tr ':' '\n' | sed 's/^/  /'
  } >&2
  exit 1
}

# Before the slot is resolved, not after: `scripts/dev-slot.sh env` *allocates* a slot, and a run
# that is about to die for want of `docker` should not take a number with it (#933).
require_docker

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
time)
  # The same suite, one process per file, timed (#880). Takes the concurrency to measure at:
  # `pnpm test:integration:time 4` is what CI's four-core runner does.
  pnpm exec prisma migrate deploy
  node scripts/time-integration-tests.mjs "${2:-}"
  ;;
reset)
  # The one `prisma migrate reset` this project allows, and only against the throwaway e2e
  # database this script just started.
  pnpm exec prisma migrate reset --force
  ;;
*)
  echo "usage: $0 [up|test|time [concurrency]|reset|down]" >&2
  exit 2
  ;;
esac
