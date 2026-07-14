#!/usr/bin/env bash
set -euo pipefail

REPO="michalwy/stamporama"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
INSTALL_DIR="${INSTALL_DIR:-$HOME/stamporama}"

# --- helpers ---

info()  { printf '\033[0;34m[stamporama]\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m[stamporama]\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m[stamporama]\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[0;31m[stamporama]\033[0m %s\n' "$*" >&2; exit 1; }

ask() {
  local prompt="$1" default="${2:-}" var
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " var
    echo "${var:-$default}"
  else
    read -r -p "$prompt: " var
    echo "$var"
  fi
}

ask_secret() {
  local prompt="$1" var
  read -r -s -p "$prompt: " var
  echo
  echo "$var"
}

generate_secret() {
  if command -v openssl &>/dev/null; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64
  fi
}

# --- preflight ---

info "Stamporama self-hosted installer"
echo

command -v docker &>/dev/null || die "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
docker compose version &>/dev/null 2>&1 || die "Docker Compose plugin is not installed. Update Docker Desktop or install the Compose plugin."

# --- install directory ---

INSTALL_DIR="$(ask "Install directory" "$INSTALL_DIR")"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# --- download compose files ---

info "Downloading compose files…"
curl -fsSL "${RAW_BASE}/docker-compose.yml"      -o docker-compose.yml
curl -fsSL "${RAW_BASE}/docker-compose.prod.yml" -o docker-compose.prod.yml
ok "Compose files downloaded."

# --- configure environment ---

if [[ -f .env ]]; then
  warn ".env already exists — skipping interactive setup. Edit it manually if needed."
else
  info "Configuring environment…"
  echo

  PUBLIC_URL="$(ask "Public URL of your Stamporama instance (e.g. https://stamps.example.com)" "http://localhost:3000")"
  POSTGRES_PASSWORD="$(ask_secret "PostgreSQL password (leave empty to auto-generate)")"
  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD="$(generate_secret)"
    ok "Generated PostgreSQL password."
  fi
  BETTER_AUTH_SECRET="$(generate_secret)"

  cat > .env <<EOF
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://stamporama:${POSTGRES_PASSWORD}@db:5432/stamporama

BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${PUBLIC_URL}

TAG=latest
EOF

  ok ".env created."
fi

# --- pull and start ---

echo
info "Pulling images and starting Stamporama…"
docker compose pull
docker compose up -d

echo
ok "Stamporama is running!"
info "Manage with: cd ${INSTALL_DIR} && docker compose ..."
