#!/usr/bin/env bash
#
# Deploy one Stamporama release to an existing installation (#2689, ADR-0083).
#
#   STAMPORAMA_DIR=/path/to/installation scripts/deploy.sh --version 0.150.0 [--allow-downgrade]
#
# Run by `.github/workflows/deploy.yml` on the owner's Raspberry Pi, through a self-hosted runner,
# when a GitHub Release is published (or by hand, from the Actions tab, for a redeploy or a
# rollback). The runbook is `docs/deployment/pi-deploy.md`; the reasoning is ADR-0083.
#
# The steps, in the order the owner set them (2026-11-22):
#
#   1. pull the release image **by digest**: the tag is resolved once, and from then on only the
#      digest is used, so what is deployed is exactly what was resolved;
#   2. the **no-downgrade guard**: when the running version is newer, skip and succeed — unless
#      `--allow-downgrade` (the workflow passes it for a manual run, which is how a rollback is made);
#   3. a **pre-deploy `pg_dump`** of the external database into the backup directory, keeping the
#      newest STAMPORAMA_BACKUP_KEEP dumps;
#   4. `docker compose up -d` in the installation directory, with its own `.env` and so its own
#      compose project name — migrations run at container start, as they always have;
#   5. wait for the container's health check, and **on failure roll back to the previous image**.
#      Migrations are not rolled back; the dump from step 3 is how the database goes back.
#
# **The installation is the configuration.** `.env` is read, never rebuilt: the only key this
# script writes is `TAG`, after a container came up healthy, so a later hand-run `docker compose up -d`
# starts the same image instead of whatever `latest` is by then.
#
# **The output is public.** This repository is public, and so are its Actions logs. Nothing here
# prints `.env`, the database address, a path on the Pi or the application's own logs; a failure
# says where on the Pi to look instead.
#
# Exit status: 0 deployed, already running, or skipped as a downgrade; 1 the release failed and the
# previous image is running again; 2 anything else — including a failed rollback, which leaves the
# instance down and needs the owner.
#
# Settings (environment):
#   STAMPORAMA_DIR               the installation directory (required): .env and the compose files
#   STAMPORAMA_IMAGE             image repository             (default ghcr.io/michalwy/stamporama)
#   STAMPORAMA_BACKUP_DIR        where dumps go               (default $STAMPORAMA_DIR/backups)
#   STAMPORAMA_BACKUP_KEEP       dumps kept                   (default 14)
#   STAMPORAMA_PG_CLIENT_IMAGE   image providing pg_dump      (default postgres:18-alpine; its major
#                                must be at least the server's)
#   STAMPORAMA_HEALTH_TIMEOUT    seconds to wait for healthy  (default 600)
#   STAMPORAMA_HEALTH_POLL       seconds between checks       (default 5)

set -euo pipefail
umask 077

IMAGE="${STAMPORAMA_IMAGE:-ghcr.io/michalwy/stamporama}"
BACKUP_KEEP="${STAMPORAMA_BACKUP_KEEP:-14}"
PG_CLIENT_IMAGE="${STAMPORAMA_PG_CLIENT_IMAGE:-postgres:18-alpine}"
HEALTH_TIMEOUT="${STAMPORAMA_HEALTH_TIMEOUT:-600}"
HEALTH_POLL="${STAMPORAMA_HEALTH_POLL:-5}"

VERSION=""
ALLOW_DOWNGRADE=false

info() { printf '==> %s\n' "$*"; }
warn() { printf '::warning::%s\n' "$*"; }
notice() { printf '::notice::%s\n' "$*"; }
die() {
  printf '::error::%s\n' "$*"
  summary "**Failed:** $*"
  exit 2
}

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n\n' "$*" >>"$GITHUB_STEP_SUMMARY"
  fi
}

usage() {
  echo "Usage: STAMPORAMA_DIR=<installation> $0 --version X.Y.Z [--allow-downgrade]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
  --version)
    [ $# -ge 2 ] || usage
    VERSION="$2"
    shift 2
    ;;
  --allow-downgrade)
    ALLOW_DOWNGRADE=true
    shift
    ;;
  *) usage ;;
  esac
done

VERSION="${VERSION#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Version '$VERSION' is not X.Y.Z."
[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || die "STAMPORAMA_BACKUP_KEEP must be a positive number."
[ -n "${STAMPORAMA_DIR:-}" ] || die "STAMPORAMA_DIR is not set - it names the installation directory (see docs/deployment/pi-deploy.md)."
[ -d "$STAMPORAMA_DIR" ] || die "STAMPORAMA_DIR does not exist on this machine."
cd "$STAMPORAMA_DIR"
[ -f .env ] || die "The installation directory has no .env - is STAMPORAMA_DIR the directory scripts/install.sh set up?"
BACKUP_DIR="${STAMPORAMA_BACKUP_DIR:-$PWD/backups}"

# --- .env, read the way scripts/install.sh writes it --------------------------------------------

get_env() {
  { grep -E "^$1=" .env || true; } | tail -n1 | cut -d= -f2- |
    sed -e 's/^"//' -e 's/"$//' -e 's/\$\$/$/g'
}

# Replace (or add) TAG in .env **in place**, so the file keeps its owner and mode.
write_tag() {
  local tmp
  tmp="$(mktemp)"
  { grep -vE '^TAG=' .env || true; } >"$tmp"
  printf 'TAG="%s"\n' "$1" >>"$tmp"
  cat "$tmp" >.env
  rm -f "$tmp"
}

COMPOSE_FILES="$(get_env COMPOSE_FILE)"
[ -n "$COMPOSE_FILES" ] || COMPOSE_FILES="docker-compose.prod.yml"

# The same wrapper scripts/install.sh and scripts/update.sh use: the file list comes from .env.
compose() {
  COMPOSE_FILE="$COMPOSE_FILES" docker compose "$@"
}

# --- Small docker helpers -----------------------------------------------------------------------

image_env() { # <image> <name> -> value of an ENV baked into the image, or nothing
  docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null |
    sed -n "s/^$2=//p" | head -n1
}

image_digest() { # <image> -> sha256:... the image is known by in $IMAGE, or nothing
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" 2>/dev/null |
    sed -n "s|^${IMAGE}@||p" | head -n1
}

is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

version_gt() { # a > b
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]
}

app_container() { compose ps -a -q app 2>/dev/null | head -n1; }

# --- Preflight ----------------------------------------------------------------------------------

docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon - is the runner's user in the docker group?"
for f in ${COMPOSE_FILES//:/ }; do
  [ -f "$f" ] || die "Compose file $f (from COMPOSE_FILE in .env) is missing from the installation."
done

case ",$(get_env COMPOSE_PROFILES)," in
*,autoupdate,*)
  die "Watchtower is still switched on (COMPOSE_PROFILES=autoupdate in .env). Two updaters would fight over the container - turn it off first (docs/deployment/pi-deploy.md, 'Turn Watchtower off')."
  ;;
esac

# The compose project name decides the name of the photo volume. It comes from the installation
# directory (or COMPOSE_PROJECT_NAME), and a deploy under any other name would start the app on a
# new, empty `<name>_stamporama-data`. So it is checked against the running container's own label.
PROJECT="$(compose config 2>/dev/null | sed -n 's/^name: *//p' | head -n1)"
[ -n "$PROJECT" ] || die "docker compose could not read the installation's compose files."

# The profile switched off is not enough: the installation's Watchtower container, left running,
# still updates the app.
if [ -n "$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter label=com.docker.compose.service=watchtower)" ]; then
  die "The installation's Watchtower container is still running. Remove it first (docs/deployment/pi-deploy.md, 'Turn Watchtower off')."
fi

# A container of this installation is found by the directory compose ran in, not by project name,
# so a different name is caught rather than mistaken for "nothing running yet".
for cid in $(docker ps -a -q --filter label=com.docker.compose.service=app); do
  dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")"
  [ "$dir" = "$PWD" ] || [ "$dir" = "$(pwd -P)" ] || continue
  running_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")"
  [ "$running_project" = "$PROJECT" ] ||
    die "Compose project mismatch: the installation's app runs as project '$running_project', this deploy would use '$PROJECT'. That would start the app on an empty photo volume - nothing was changed. Is COMPOSE_PROJECT_NAME set in the runner's environment?"
done

PREV_CONTAINER="$(app_container)"
PREV_IMAGE_ID=""
PREV_VERSION=""
PREV_RUNNING=false
PREV_HEALTH=""
if [ -n "$PREV_CONTAINER" ]; then
  PREV_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$PREV_CONTAINER")"
  PREV_VERSION="$(image_env "$PREV_IMAGE_ID" STAMPORAMA_VERSION)"
  [ "$(docker inspect --format '{{.State.Running}}' "$PREV_CONTAINER")" = "true" ] && PREV_RUNNING=true
  PREV_HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$PREV_CONTAINER")"
else
  warn "No app container exists in compose project '$PROJECT'. This deploy has nothing to roll back to."
fi

# --- 1. Pull the release image by digest --------------------------------------------------------

info "Resolving ${IMAGE}:${VERSION}"
docker pull -q "${IMAGE}:${VERSION}" >/dev/null || die "Could not pull ${IMAGE}:${VERSION}. Has the release's CI run published the image?"
DIGEST="$(image_digest "${IMAGE}:${VERSION}")"
[ -n "$DIGEST" ] || die "${IMAGE}:${VERSION} has no registry digest."
info "Pulling ${IMAGE}@${DIGEST}"
docker pull -q "${IMAGE}@${DIGEST}" >/dev/null || die "Could not pull ${IMAGE}@${DIGEST}."
NEW_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${IMAGE}@${DIGEST}")"
NEW_VERSION="$(image_env "$NEW_IMAGE_ID" STAMPORAMA_VERSION)"
[ "$NEW_VERSION" = "$VERSION" ] ||
  die "${IMAGE}@${DIGEST} says it is version '${NEW_VERSION}', not ${VERSION}. Nothing was changed."
# Compose's image is `${IMAGE}:${TAG}`; a tag followed by a digest pins the digest, and the tag
# part keeps `docker ps` readable.
NEW_REF="${VERSION}@${DIGEST}"

# --- 2. No-downgrade guard ----------------------------------------------------------------------

if [ -n "$PREV_IMAGE_ID" ] && [ "$PREV_IMAGE_ID" = "$NEW_IMAGE_ID" ] && $PREV_RUNNING &&
  { [ -z "$PREV_HEALTH" ] || [ "$PREV_HEALTH" = "healthy" ]; }; then
  # Pin it in .env all the same, so the installation that Watchtower left on `latest` says what it runs.
  [ "$(get_env TAG)" = "$NEW_REF" ] || write_tag "$NEW_REF"
  notice "${VERSION} (${DIGEST}) is already running and healthy - nothing to do."
  summary "**Already running:** ${VERSION} \`${DIGEST}\` - the container was left alone; .env's TAG names it."
  exit 0
fi

if is_semver "$PREV_VERSION" && version_gt "$PREV_VERSION" "$VERSION"; then
  if ! $ALLOW_DOWNGRADE; then
    notice "Skipped: ${PREV_VERSION} is running, which is newer than ${VERSION}. A manual run (workflow_dispatch) is how a rollback is made."
    summary "**Skipped:** ${PREV_VERSION} is running, newer than ${VERSION}. Nothing was changed."
    exit 0
  fi
  info "Rolling back by hand: ${PREV_VERSION} -> ${VERSION}"
elif [ -n "$PREV_CONTAINER" ] && ! is_semver "$PREV_VERSION"; then
  warn "The running image reports version '${PREV_VERSION:-none}', which is not a release - the no-downgrade guard cannot judge it and lets the deploy through."
fi

# --- 3. Pre-deploy pg_dump ----------------------------------------------------------------------

# The database is the operator's, outside compose, reached through DATABASE_URL — from inside the
# app's network. So the client runs **in the app container's network namespace** when it is up,
# which reaches exactly what the app reaches; otherwise on the shared database network when the
# network overlay is in COMPOSE_FILE, else on the host's.
pg_network() {
  if [ -n "$PREV_CONTAINER" ] && $PREV_RUNNING; then
    echo "container:${PREV_CONTAINER}"
  elif [[ ":${COMPOSE_FILES}:" == *":docker-compose.network.yml:"* ]]; then
    local net
    net="$(get_env STAMPORAMA_DB_NETWORK)"
    echo "${net:-stamporama}"
  else
    echo "host"
  fi
}

# Prisma's connection string carries parameters libpq refuses ("invalid URI query parameter");
# they say nothing about where the database is, so they are dropped for pg_dump.
libpq_url() {
  local url="$1" base query out="" pair
  base="${url%%\?*}"
  [ "$base" = "$url" ] && {
    echo "$url"
    return
  }
  query="${url#*\?}"
  local IFS='&'
  for pair in $query; do
    case "${pair%%=*}" in
    schema | connection_limit | pool_timeout | pgbouncer | statement_cache_size | socket_timeout | sslaccept | sslidentity) ;;
    *) out="${out:+$out&}$pair" ;;
    esac
  done
  echo "${base}${out:+?$out}"
}

DATABASE_URL_VALUE="$(get_env DATABASE_URL)"
[ -n "$DATABASE_URL_VALUE" ] || die "DATABASE_URL is not set in .env."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_NAME="stamporama-${STAMP}-before-${VERSION}.dump"
DUMP="${BACKUP_DIR}/${DUMP_NAME}"
DUMP_LOG="${BACKUP_DIR}/last-dump-error.log"

info "Dumping the database before the deploy (${PG_CLIENT_IMAGE})"
docker pull -q "$PG_CLIENT_IMAGE" >/dev/null || die "Could not pull ${PG_CLIENT_IMAGE} for pg_dump."
# The URL travels in the environment rather than on a command line, where `ps` would show it, and
# pg_dump's own messages go to a file on the Pi: they name the database host and user.
if ! PGURL="$(libpq_url "$DATABASE_URL_VALUE")" docker run --rm -e PGURL --network "$(pg_network)" \
  "$PG_CLIENT_IMAGE" sh -c 'exec pg_dump --format=custom --no-owner --dbname="$PGURL"' \
  >"${DUMP}.partial" 2>"$DUMP_LOG"; then
  rm -f "${DUMP}.partial"
  die "pg_dump failed, so nothing was deployed. Its message is in the backup directory on the Pi, in last-dump-error.log."
fi
[ -s "${DUMP}.partial" ] || {
  rm -f "${DUMP}.partial"
  die "pg_dump wrote nothing, so nothing was deployed."
}
mv "${DUMP}.partial" "$DUMP"
rm -f "$DUMP_LOG"
info "Dump written: ${DUMP_NAME} ($(wc -c <"$DUMP" | tr -d ' ') bytes)"

# Retention: the newest BACKUP_KEEP dumps stay. The names sort by time.
# shellcheck disable=SC2012
ls -1 "$BACKUP_DIR" | { grep -E '^stamporama-[0-9]{8}T[0-9]{6}Z-before-.*\.dump$' || true; } | sort -r |
  awk -v keep="$BACKUP_KEEP" 'NR > keep' | while read -r old; do
  rm -f "${BACKUP_DIR}/${old}"
  info "Removed old dump ${old}"
done

# --- 4. docker compose up -d --------------------------------------------------------------------

wait_healthy() { # <container> -> 0 when healthy, 1 otherwise
  local cid="$1" waited=0 status health restarts
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    status="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo missing)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo missing)"
    restarts="$(docker inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
    case "$health" in
    healthy) return 0 ;;
    unhealthy)
      info "The container reports unhealthy."
      return 1
      ;;
    none)
      info "The container has no health check - cannot tell whether it works."
      return 1
      ;;
    esac
    if [ "$status" = "exited" ] || [ "$status" = "dead" ] || [ "$status" = "missing" ] || [ "$restarts" -gt 0 ]; then
      info "The container stopped (status ${status}, restarts ${restarts}) - a failed migration does this."
      return 1
    fi
    sleep "$HEALTH_POLL"
    waited=$((waited + HEALTH_POLL))
  done
  info "The container was not healthy after ${HEALTH_TIMEOUT}s."
  return 1
}

start() { # <TAG value> <image id> -> the app container, if it runs that image, on stdout
  local cid
  TAG="$1" compose up -d >&2 || return 1
  cid="$(app_container)"
  [ -n "$cid" ] && [ "$(docker inspect --format '{{.Image}}' "$cid")" = "$2" ] || {
    info "docker compose did not start a container on the expected image."
    return 1
  }
  echo "$cid"
}

info "Starting ${VERSION} (compose project ${PROJECT})"
NEW_CONTAINER="$(start "$NEW_REF" "$NEW_IMAGE_ID")" || NEW_CONTAINER=""

# --- 5. Health, and the rollback ----------------------------------------------------------------

if [ -n "$NEW_CONTAINER" ] && wait_healthy "$NEW_CONTAINER"; then
  write_tag "$NEW_REF"
  # Old images of this repository pile up on a small disk; Watchtower used to clean them. Keep the
  # one running and the one rolled back to, and let docker refuse anything still in use.
  docker image ls --no-trunc --format '{{.ID}}' "$IMAGE" 2>/dev/null | sort -u | while read -r id; do
    [ "$id" = "$NEW_IMAGE_ID" ] || [ "$id" = "$PREV_IMAGE_ID" ] || docker image rm "$id" >/dev/null 2>&1 || true
  done
  notice "Deployed ${VERSION} (${DIGEST})${PREV_VERSION:+, replacing ${PREV_VERSION}}."
  summary "**Deployed:** ${VERSION} \`${DIGEST}\`${PREV_VERSION:+ (was ${PREV_VERSION})}. Pre-deploy dump: \`${DUMP_NAME}\`."
  exit 0
fi

printf '::error::%s did not come up healthy. Its logs stay on the Pi: docker compose logs app (in the installation directory).\n' "$VERSION"

if [ -z "$PREV_IMAGE_ID" ]; then
  die "There is no previous image to roll back to. The instance is down; the dump ${DUMP_NAME} is in the backup directory."
fi

# Roll back by the previous image's own digest where it has one; an image with none (built
# locally) gets a local tag instead, which compose finds without pulling.
PREV_DIGEST="$(image_digest "$PREV_IMAGE_ID")"
PREV_TAG="${PREV_VERSION:-previous}"
[[ "$PREV_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$ ]] || PREV_TAG="previous"
if [ -n "$PREV_DIGEST" ]; then
  PREV_REF="${PREV_TAG}@${PREV_DIGEST}"
else
  PREV_REF="rollback-${STAMP}"
  docker tag "$PREV_IMAGE_ID" "${IMAGE}:${PREV_REF}"
fi

info "Rolling back to ${PREV_VERSION:-the previous image} (${PREV_REF})"
ROLLBACK_CONTAINER="$(start "$PREV_REF" "$PREV_IMAGE_ID")" || ROLLBACK_CONTAINER=""
if [ -n "$ROLLBACK_CONTAINER" ] && wait_healthy "$ROLLBACK_CONTAINER"; then
  write_tag "$PREV_REF"
  printf '::error::%s did not come up healthy; %s is running again. Migrations %s applied were NOT rolled back - see docs/deployment/pi-deploy.md, "Restoring a dump". Pre-deploy dump: %s\n' \
    "$VERSION" "${PREV_VERSION:-the previous image}" "$VERSION" "$DUMP_NAME"
  summary "**Rolled back:** ${VERSION} did not come up healthy; ${PREV_VERSION:-the previous image} is running again. Migrations were not rolled back. Pre-deploy dump: \`${DUMP_NAME}\`."
  exit 1
fi

die "The rollback to ${PREV_VERSION:-the previous image} did not come up healthy either. The instance needs the owner; the pre-deploy dump is ${DUMP_NAME}."
