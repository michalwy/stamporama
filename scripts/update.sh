#!/usr/bin/env bash
#
# Stamporama self-hosting updater.
#
# Updates the Docker Compose files to the latest release, pulls the image .env's TAG
# names (`latest` unless you pinned a version), and restarts the stack. Run from your
# Stamporama installation directory.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/latest/scripts/update.sh | bash
#
# Or, if already downloaded:
#   bash update.sh
#
# This is the update path for self-hosters (#2690, ADR-0083): Watchtower is gone. To update
# on a schedule, run a downloaded copy from the host's cron or a systemd timer — README.md,
# "Updating", has both. The first run on an installation that still had Watchtower switched
# on also switches it off and removes its container.

set -euo pipefail

REPO="michalwy/stamporama"
BRANCH="latest"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mxx \033[0m %s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "Neither curl nor wget is available to download files."
  fi
}

get_env() {
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- |
    sed -e 's/^"//' -e 's/"$//' -e 's/\$\$/$/g'
}

compose() {
  local files
  files="$(get_env COMPOSE_FILE 2>/dev/null || true)"
  [ -n "$files" ] || files="docker-compose.prod.yml"
  COMPOSE_FILE="$files" docker compose "$@"
}

# Set KEY="value" in .env, replacing any existing line for KEY (as scripts/install.sh does).
set_env() {
  local key="$1" escaped
  escaped="$(printf '%s' "$2" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/$$/g')"
  grep -vE "^${key}=" .env >.env.tmp || true
  printf '%s="%s"\n' "$key" "$escaped" >>.env.tmp
  mv .env.tmp .env
}

# Watchtower was the `autoupdate` profile until #2690. Its container outlives the service's
# removal from docker-compose.prod.yml, so it is switched off here: the profile is dropped from
# COMPOSE_PROFILES (any other profile stays) and the installation's own Watchtower container is
# removed. Found by its compose labels, so a Watchtower that is not this installation's is left alone.
retire_watchtower() {
  local profiles kept="" p project ids
  profiles="$(get_env COMPOSE_PROFILES 2>/dev/null || true)"
  case ",${profiles}," in
  *,autoupdate,*)
    local IFS=","
    for p in $profiles; do
      [ "$p" = "autoupdate" ] || kept="${kept:+$kept,}$p"
    done
    unset IFS
    set_env COMPOSE_PROFILES "$kept"
    info "Watchtower auto-update is retired (unmaintained) - removed 'autoupdate' from COMPOSE_PROFILES."
    ;;
  esac
  project="$(compose config 2>/dev/null | sed -n 's/^name: *//p' | head -n1)" || project=""
  [ -n "$project" ] || return 0
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=${project}" \
    --filter label=com.docker.compose.service=watchtower)"
  if [ -n "$ids" ]; then
    info "Removing this installation's Watchtower container"
    # shellcheck disable=SC2086 # one id per word
    docker rm -f $ids >/dev/null
  fi
}

main() {
  [ -f .env ] || die "No .env file found. Run this script from your Stamporama installation directory."

  info "Downloading latest docker-compose.prod.yml"
  download "${RAW_BASE}/docker-compose.prod.yml" "docker-compose.prod.yml"

  info "Downloading latest docker-compose.network.yml"
  download "${RAW_BASE}/docker-compose.network.yml" "docker-compose.network.yml"

  retire_watchtower

  info "Pulling the image"
  compose pull

  info "Restarting stack"
  compose up -d

  info "Update complete."
}

main "$@"
