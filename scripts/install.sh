#!/usr/bin/env bash
#
# Stamporama self-hosting installer.
#
# Downloads the production Docker Compose stack, interviews you for the required
# configuration, writes a local .env, and starts the app.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/michalwy/stamporama/main/scripts/install.sh | bash
#
# Re-running is safe: it re-runs the interview with your current .env values
# pre-filled as defaults, so you can adjust individual settings; only the keys
# you change are written and any other keys in .env are preserved.
#
# The interview uses whiptail (a native dialog UI, preinstalled on Raspberry Pi
# OS / Debian) when available, and falls back to a pure-bash arrow-key menu
# otherwise, so it works everywhere with no extra dependencies.

set -euo pipefail

REPO="michalwy/stamporama"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
ENV_EXAMPLE=".env.prod.example"
APP_TITLE="Stamporama installer"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31mxx \033[0m %s\n' "$*" >&2; }

die() {
  err "$*"
  exit 1
}

# Always restore the cursor, even if interrupted while a fallback menu is drawn.
restore_cursor() { printf '\033[?25h' >/dev/tty 2>/dev/null || true; }
trap restore_cursor EXIT INT TERM

# =============================================================================
# UI layer — whiptail when available, pure-bash fallback otherwise.
# All interaction goes through /dev/tty so it works under `curl ... | bash`.
# =============================================================================

have_whiptail() { [ -e /dev/tty ] && command -v whiptail >/dev/null 2>&1; }

# ui_prompt <var> <question> [default] — free-text input.
ui_prompt() {
  local __var="$1" question="$2" default="${3:-}"
  if have_whiptail; then
    local val
    val=$(whiptail --title "$APP_TITLE" --inputbox "$question" 12 78 "$default" \
      3>&1 1>&2 2>&3 </dev/tty) || die "Installation cancelled."
    printf -v "$__var" '%s' "$val"
  else
    fallback_prompt "$__var" "$question" "$default"
  fi
}

# ui_password <var> <question> — masked input.
ui_password() {
  local __var="$1" question="$2"
  if have_whiptail; then
    local val
    val=$(whiptail --title "$APP_TITLE" --passwordbox "$question" 12 78 \
      3>&1 1>&2 2>&3 </dev/tty) || die "Installation cancelled."
    printf -v "$__var" '%s' "$val"
  else
    fallback_prompt "$__var" "$question" ""
  fi
}

# ui_menu <var> <default_value> <question> <value1> <label1> <value2> <label2> ...
# Sets <var> to the chosen value.
ui_menu() {
  local __var="$1" default="$2" question="$3"
  shift 3
  local vals=() labels=()
  while [ "$#" -gt 0 ]; do
    vals+=("$1")
    labels+=("$2")
    shift 2
  done
  local n=${#vals[@]} i
  if have_whiptail; then
    local menu_args=()
    for ((i = 0; i < n; i++)); do menu_args+=("${vals[i]}" "${labels[i]}"); done
    local default_args=()
    [ -n "$default" ] && default_args=(--default-item "$default")
    local choice
    choice=$(whiptail --title "$APP_TITLE" --notags "${default_args[@]}" --menu "$question" 16 78 "$n" \
      "${menu_args[@]}" 3>&1 1>&2 2>&3 </dev/tty) || die "Installation cancelled."
    printf -v "$__var" '%s' "$choice"
  else
    local start=0
    for ((i = 0; i < n; i++)); do [ "${vals[i]}" = "$default" ] && start=$i; done
    local idx
    fallback_choose idx "$start" "$question" "${labels[@]}"
    printf -v "$__var" '%s' "${vals[idx]}"
  fi
}

# ui_confirm <question> — returns 0 for Yes, non-zero for No/cancel.
ui_confirm() {
  if have_whiptail; then
    whiptail --title "$APP_TITLE" --yesno "$1" 12 78 </dev/tty
  else
    fallback_confirm "$1"
  fi
}

# --- Pure-bash fallbacks -----------------------------------------------------

fallback_prompt() {
  local __var="$1" __question="$2" __default="${3:-}" __reply
  if [ -n "$__default" ]; then
    printf '%s [%s]: ' "$__question" "$__default" >/dev/tty
  else
    printf '%s: ' "$__question" >/dev/tty
  fi
  IFS= read -r __reply </dev/tty || __reply=""
  [ -n "$__reply" ] || __reply="$__default"
  printf -v "$__var" '%s' "$__reply"
}

# Arrow-key single-select menu; sets the named variable to the selected index.
# fallback_choose <var> <start_index> <title> <option> [<option> ...]
fallback_choose() {
  local __var="$1" __start="$2" __title="$3"
  shift 3
  local __opts=("$@")
  local __count=${#__opts[@]}
  local __sel="${__start:-0}" __key __rest __i __first=1
  [ "$__sel" -ge 0 ] && [ "$__sel" -lt "$__count" ] || __sel=0

  printf '\033[1m%s\033[0m\n' "$__title" >/dev/tty
  printf '\033[2m  (↑/↓ to move, Enter to select)\033[0m\n' >/dev/tty
  printf '\033[?25l' >/dev/tty

  while true; do
    if [ "$__first" -eq 1 ]; then
      __first=0
    else
      printf '\033[%dA' "$__count" >/dev/tty
    fi
    for __i in "${!__opts[@]}"; do
      if [ "$__i" -eq "$__sel" ]; then
        printf '\033[K\033[1;36m  ❯ %s\033[0m\n' "${__opts[$__i]}" >/dev/tty
      else
        printf '\033[K    \033[2m%s\033[0m\n' "${__opts[$__i]}" >/dev/tty
      fi
    done
    IFS= read -rsn1 __key </dev/tty || __key=""
    case "$__key" in
    $'\x1b')
      IFS= read -rsn2 __rest </dev/tty || __rest=""
      case "$__rest" in
      '[A') __sel=$(((__sel - 1 + __count) % __count)) ;;
      '[B') __sel=$(((__sel + 1) % __count)) ;;
      esac
      ;;
    'k' | 'K') __sel=$(((__sel - 1 + __count) % __count)) ;;
    'j' | 'J') __sel=$(((__sel + 1) % __count)) ;;
    '') break ;;
    esac
  done

  printf '\033[?25h' >/dev/tty
  printf '\033[1;36m  → %s\033[0m\n' "${__opts[$__sel]}" >/dev/tty
  printf -v "$__var" '%s' "$__sel"
}

# Yes/No via the arrow-key menu. Returns 0 for Yes, 1 for No.
fallback_confirm() {
  local __idx
  fallback_choose __idx 0 "$1" "Yes" "No"
  [ "$__idx" -eq 0 ]
}

# =============================================================================
# .env helpers
# =============================================================================

# Escape a value for a double-quoted value in a Compose-style .env file.
env_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/$$/g'
}

# Set KEY="value" in the .env file, replacing any existing line for KEY.
set_env() {
  local key="$1" value="$2" escaped
  escaped="$(env_escape "$value")"
  if grep -qE "^${key}=" .env; then
    grep -vE "^${key}=" .env >.env.tmp
    printf '%s="%s"\n' "$key" "$escaped" >>.env.tmp
    mv .env.tmp .env
  else
    printf '%s="%s"\n' "$key" "$escaped" >>.env
  fi
}

# Read a value back from .env (unquoted, $$ un-escaped to $).
get_env() {
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- |
    sed -e 's/^"//' -e 's/"$//' -e 's/\$\$/$/g'
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n'
  fi
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

# Run docker compose using the file list from .env's COMPOSE_FILE.
compose() {
  local files
  files="$(get_env COMPOSE_FILE)"
  [ -n "$files" ] || files="docker-compose.yml:docker-compose.prod.yml"
  COMPOSE_FILE="$files" docker compose "$@"
}

# =============================================================================

main() {
  info "Stamporama self-hosting installer"

  # --- Preflight -----------------------------------------------------------
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 is not available. Install the Compose plugin: https://docs.docker.com/compose/install/"
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Cannot talk to the Docker daemon. Is it running, and do you have permission?"
  fi

  # --- Install directory ---------------------------------------------------
  local target_dir
  ui_prompt target_dir "Where should Stamporama be installed?" "./stamporama"
  [ -n "$target_dir" ] || target_dir="./stamporama"
  mkdir -p "$target_dir"
  cd "$target_dir"
  info "Using $(pwd)"

  # --- Fetch deployment files ---------------------------------------------
  info "Downloading docker-compose.yml"
  download "${RAW_BASE}/docker-compose.yml" "docker-compose.yml"
  info "Downloading docker-compose.prod.yml"
  download "${RAW_BASE}/docker-compose.prod.yml" "docker-compose.prod.yml"

  local is_reconfigure=0
  if [ -f .env ]; then
    is_reconfigure=1
    info "Existing .env found — its current values are offered as defaults."
  else
    info "Downloading ${ENV_EXAMPLE}"
    download "${RAW_BASE}/${ENV_EXAMPLE}" "${ENV_EXAMPLE}"
    cp "${ENV_EXAMPLE}" .env
  fi

  # Default for a question: current .env value when reconfiguring, else the fallback.
  dflt() {
    local existing=""
    [ "$is_reconfigure" -eq 1 ] && existing="$(get_env "$1")"
    [ -n "$existing" ] && printf '%s' "$existing" || printf '%s' "${2:-}"
  }

  set_env COMPOSE_FILE "docker-compose.yml:docker-compose.prod.yml"

  # --- Interview -----------------------------------------------------------
  local auth_url http_port postgres_password secret secret_mode update_mode interval update_default existing_secret

  update_default="off"
  if [ "$is_reconfigure" -eq 1 ]; then
    case "$(get_env COMPOSE_PROFILES)" in *autoupdate*) update_default="on" ;; esac
  fi

  ui_prompt auth_url \
    "Public URL where this deployment will be reachable (BETTER_AUTH_URL)" \
    "$(dflt BETTER_AUTH_URL http://localhost:3000)"
  set_env BETTER_AUTH_URL "$auth_url"

  ui_prompt http_port "Host port to expose the app on" "$(dflt STAMPORAMA_HTTP_PORT 3000)"
  set_env STAMPORAMA_HTTP_PORT "$http_port"

  local pg_default
  pg_default="$(dflt POSTGRES_PASSWORD "")"
  if [ -z "$pg_default" ]; then
    pg_default="$(gen_secret)"
    info "Generated a PostgreSQL password."
  fi
  ui_password postgres_password "PostgreSQL password (leave blank to keep/use generated value)"
  if [ -z "$postgres_password" ]; then
    postgres_password="$pg_default"
  fi
  set_env POSTGRES_PASSWORD "$postgres_password"
  set_env DATABASE_URL "postgresql://stamporama:${postgres_password}@db:5432/stamporama"

  existing_secret="$(dflt BETTER_AUTH_SECRET "")"
  if [ -n "$existing_secret" ]; then
    ui_menu secret_mode keep "Authentication secret (BETTER_AUTH_SECRET)" \
      keep "Keep the current secret" \
      auto "Generate a new strong secret" \
      manual "Enter my own"
  else
    ui_menu secret_mode auto "Authentication secret (BETTER_AUTH_SECRET)" \
      auto "Auto-generate a strong secret (recommended)" \
      manual "Enter my own"
  fi
  case "$secret_mode" in
  keep)
    info "Keeping the existing auth secret."
    ;;
  auto)
    set_env BETTER_AUTH_SECRET "$(gen_secret)"
    info "Generated a new auth secret."
    ;;
  manual)
    ui_password secret "Enter BETTER_AUTH_SECRET (at least 32 random characters)"
    [ ${#secret} -ge 32 ] || die "BETTER_AUTH_SECRET must be at least 32 characters."
    set_env BETTER_AUTH_SECRET "$secret"
    ;;
  esac

  ui_menu update_mode "$update_default" "Automatic updates" \
    off "Disabled — update manually" \
    on  "Enabled — Watchtower watches for new release images"
  if [ "$update_mode" = "on" ]; then
    set_env COMPOSE_PROFILES "autoupdate"
    ui_prompt interval "Update check interval in seconds" "$(dflt OSO_UPDATE_INTERVAL 3600)"
    [ -n "$interval" ] || interval="3600"
    set_env STAMPORAMA_UPDATE_INTERVAL "$interval"
    info "Auto-update enabled."
  else
    set_env COMPOSE_PROFILES ""
    info "Auto-update disabled. Update manually with: docker compose pull && docker compose up -d"
  fi

  # --- Launch --------------------------------------------------------------
  info "Pulling images..."
  compose pull
  info "Starting stack..."
  compose up -d

  print_summary
}

print_summary() {
  local url port
  port="$(get_env STAMPORAMA_HTTP_PORT || true)"
  url="$(get_env BETTER_AUTH_URL || true)"
  echo >/dev/tty
  info "Stamporama is starting."
  echo "  Directory:   $(pwd)" >/dev/tty
  echo "  Config:      $(pwd)/.env" >/dev/tty
  [ -n "$url" ] && echo "  App URL:     ${url}" >/dev/tty
  [ -n "$port" ] && echo "  Local port:  ${port}" >/dev/tty
  echo >/dev/tty
  echo "Useful commands (run from $(pwd)):" >/dev/tty
  echo "  View logs:   docker compose logs -f" >/dev/tty
  echo "  Update:      docker compose pull && docker compose up -d" >/dev/tty
  echo "  Stop:        docker compose down" >/dev/tty
}

main "$@"
