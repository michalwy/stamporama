#!/usr/bin/env bash
#
# One slot per worktree (#781).
#
# Every host port this project pins is derived from a small integer — the *slot* — so that two
# sessions working in two worktrees can run the integration suite, or a dev stack, at the same
# time instead of the second one dying on "port is already allocated".
#
#   slot N  ->  every pinned port shifted by 10 x N, and the e2e Compose project suffixed "-N"
#
# The main worktree is always slot 0, which is today's numbers exactly: nothing is configured
# there and nothing changes there. Linked worktrees take 1, 2, 3 … on first use.
#
# The registry is the worktrees themselves: a slot is recorded in that worktree's own `.env.slot`
# (untracked), and allocation reads the `.env.slot` of every worktree `git worktree list` knows
# about. There is no shared table to go stale, so **a slot is reclaimed by the worktree going
# away** — delete the directory, or `git worktree remove` it, and the number is free again on the
# next allocation. To release a slot without removing the worktree, run `pnpm slot release` (or
# delete `.env.slot` by hand); to move a worktree to a particular number, write it into
# `.env.slot`, or set STAMPORAMA_SLOT in the environment for one command.
#
# Usage:
#   scripts/dev-slot.sh env       # shell `export` lines — this is what the pnpm scripts eval
#   scripts/dev-slot.sh number    # just the slot number
#   scripts/dev-slot.sh show      # every worktree, its slot and its ports
#   scripts/dev-slot.sh release   # forget this worktree's slot

set -euo pipefail

# Slot 0 is the documented default for each of these; a slot shifts all of them by the same
# stride, so one number is enough to describe a worktree's whole set of ports.
BASE_APP_PORT=3000  # docker-compose.yml / docker-compose.dev.yml, the app container
BASE_DEV_PORT=3002  # a bare `next dev` started for verification
BASE_E2E_DB_PORT=5433 # docker-compose.e2e.yml, the integration-test database
PORT_STRIDE=10
MAX_SLOT=9 # ten worktrees at once is already implausible; a typo should fail, not bind :3990

die() {
  echo "dev-slot: $*" >&2
  exit 1
}

abs() { (cd "$1" >/dev/null 2>&1 && pwd -P); }

# The worktree this script *belongs to*, not the one the caller happens to be standing in: the
# script lives inside the worktree it describes, and `pnpm slot` from a sibling directory should
# still answer for that sibling.
ROOT="$(abs "$(dirname "$0")/..")"

git_common_dir() { abs "$(git -C "$ROOT" rev-parse --git-common-dir)"; }

# The main worktree is the parent of the shared git directory. Everything else is a linked one.
main_worktree() { dirname "$(git_common_dir)"; }

this_worktree() { echo "$ROOT"; }

# Reads STAMPORAMA_SLOT out of a worktree's .env.slot. Prints nothing when the file, or the
# worktree itself, is gone — which is the whole of the reclamation story.
slot_of() {
  local file="$1/.env.slot" value
  [ -r "$file" ] || return 0
  value="$(sed -n 's/^[[:space:]]*STAMPORAMA_SLOT[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*$/\1/p' "$file" | head -n 1)"
  [ -n "$value" ] && echo "$value"
}

worktree_paths() { git -C "$ROOT" worktree list --porcelain | sed -n 's/^worktree //p'; }

validate_slot() {
  case "$1" in
  '' | *[!0-9]*) die "slot must be a number, got '$1'" ;;
  esac
  [ "$1" -le "$MAX_SLOT" ] || die "slot $1 is above the maximum of $MAX_SLOT"
}

# Lowest free number, taking the main worktree's implicit 0 into account. Runs under the lock.
allocate_slot() {
  local main this taken="" path slot candidate
  main="$(main_worktree)"
  this="$(this_worktree)"

  for path in $(worktree_paths); do
    [ "$path" = "$this" ] && continue
    slot="$(slot_of "$path")"
    if [ -z "$slot" ] && [ "$path" = "$main" ]; then slot=0; fi
    [ -n "$slot" ] && taken="$taken $slot "
  done

  candidate=1
  while [ "$candidate" -le "$MAX_SLOT" ]; do
    case "$taken" in
    *" $candidate "*) candidate=$((candidate + 1)) ;;
    *)
      echo "$candidate"
      return 0
      ;;
    esac
  done
  die "all slots 1..$MAX_SLOT are taken; remove a worktree you no longer use, or run 'pnpm slot show'"
}

# Two sessions starting a suite in the same second must not both read "1 is free". mkdir is the
# one atomic primitive every shell and filesystem here agrees on.
with_lock() {
  local lock tries=0
  lock="$(git_common_dir)/stamporama-slot.lock"
  until mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -lt 100 ] || die "timed out waiting for $lock — remove it if no other session is starting"
    sleep 0.1
  done
  trap 'rmdir "$lock" 2>/dev/null || true' EXIT
  "$@"
  rmdir "$lock" 2>/dev/null || true
  trap - EXIT
}

write_slot_file() {
  cat >"$(this_worktree)/.env.slot" <<EOF
# This worktree's slot (#781). Ports are the project defaults shifted by 10 x the slot;
# \`pnpm slot show\` prints them. Delete this file to release the number — removing the
# worktree releases it too, which is why nothing here needs cleaning up by hand.
STAMPORAMA_SLOT=$1
EOF
}

resolve_slot() {
  local this slot
  this="$(this_worktree)"

  if [ -n "${STAMPORAMA_SLOT:-}" ]; then
    validate_slot "$STAMPORAMA_SLOT"
    echo "$STAMPORAMA_SLOT"
    return 0
  fi

  slot="$(slot_of "$this")"
  if [ -n "$slot" ]; then
    validate_slot "$slot"
    echo "$slot"
    return 0
  fi

  # The main worktree is slot 0 by definition and writes no file: "nothing configured" has to
  # keep meaning today's ports there, because that is the path the project is used on.
  if [ "$this" = "$(main_worktree)" ]; then
    echo 0
    return 0
  fi

  slot="$(with_lock allocate_slot)"
  write_slot_file "$slot"
  echo "$slot"
}

port() { echo $(($1 + PORT_STRIDE * $2)); }

suffix() { [ "$1" = 0 ] || echo "-$1"; }

cmd_env() {
  local slot
  slot="$(resolve_slot)"
  echo "export STAMPORAMA_SLOT=$slot"
  echo "export STAMPORAMA_SLOT_SUFFIX=$(suffix "$slot")"
  echo "export STAMPORAMA_APP_PORT=$(port "$BASE_APP_PORT" "$slot")"
  echo "export STAMPORAMA_DEV_PORT=$(port "$BASE_DEV_PORT" "$slot")"
  echo "export STAMPORAMA_E2E_DB_PORT=$(port "$BASE_E2E_DB_PORT" "$slot")"
  echo "export STAMPORAMA_E2E_DATABASE_URL=postgresql://stamporama:stamporama@localhost:$(port "$BASE_E2E_DB_PORT" "$slot")/stamporama_test"
}

cmd_show() {
  local this main path slot mark
  this="$(this_worktree)"
  main="$(main_worktree)"
  resolve_slot >/dev/null # so the current worktree appears with the number it will actually use
  printf '%-5s %-9s %-9s %-9s %-22s %s\n' slot app dev e2e-db project worktree
  for path in $(worktree_paths); do
    slot="$(slot_of "$path")"
    if [ -z "$slot" ] && [ "$path" = "$main" ]; then slot=0; fi
    if [ -z "$slot" ]; then
      printf '%-5s %-9s %-9s %-9s %-22s %s\n' '-' '-' '-' '-' '-' "$path (no slot yet)"
      continue
    fi
    mark=""
    [ "$path" = "$this" ] && mark=" <- this worktree"
    printf '%-5s %-9s %-9s %-9s %-22s %s\n' \
      "$slot" \
      "$(port "$BASE_APP_PORT" "$slot")" \
      "$(port "$BASE_DEV_PORT" "$slot")" \
      "$(port "$BASE_E2E_DB_PORT" "$slot")" \
      "stamporama$(suffix "$slot")" \
      "$path$mark"
  done
}

cmd_release() {
  local file
  file="$(this_worktree)/.env.slot"
  if [ -e "$file" ]; then
    rm -f "$file"
    echo "released: $file removed; the next command re-allocates"
  else
    echo "nothing to release: $file does not exist"
  fi
}

case "${1:-env}" in
env) cmd_env ;;
number) resolve_slot ;;
show) cmd_show ;;
release) cmd_release ;;
*) die "usage: $0 [env|number|show|release]" ;;
esac
