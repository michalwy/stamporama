#!/usr/bin/env bash
#
# Stamporama self-hosting updater.
#
# Updates the Docker Compose files to the latest release, pulls the new image,
# and restarts the stack. Run from your Stamporama installation directory.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/latest/scripts/update.sh | bash
#
# Or, if already downloaded:
#   bash scripts/update.sh

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

main() {
  [ -f .env ] || die "No .env file found. Run this script from your Stamporama installation directory."

  info "Downloading latest docker-compose.prod.yml"
  download "${RAW_BASE}/docker-compose.prod.yml" "docker-compose.prod.yml"

  info "Downloading latest docker-compose.network.yml"
  download "${RAW_BASE}/docker-compose.network.yml" "docker-compose.network.yml"

  info "Pulling latest image"
  compose pull

  info "Restarting stack"
  compose up -d

  info "Update complete."
}

main "$@"
