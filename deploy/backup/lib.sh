#!/usr/bin/env bash
# Shared helpers for backup.sh and restore.sh. Not run directly.
#
# Two modes (HATUA_BACKUP_MODE):
#   docker (default)  the server: Postgres runs in the `db` container, images are in the `media`
#                     volume, and restic runs in the `backup` service of docker-compose.yml.
#   local             a developer machine or CI: pg_dump, pg_restore, psql and restic from PATH,
#                     with DATABASE_URL, MEDIA_DIR, RESTIC_REPOSITORY and RESTIC_PASSWORD set.

# shellcheck disable=SC2034  # variables here are used by the scripts that source this file
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${HATUA_ENV_FILE:-$ROOT/.env}"
MODE="${HATUA_BACKUP_MODE:-docker}"
BACKUP_DIR="${HATUA_BACKUP_DIR:-$ROOT/backups}"
STAGE_DIR="$BACKUP_DIR/stage"       # the database dump waits here until restic has stored it
RESTORE_DIR="$BACKUP_DIR/restore"   # restores land here, never on top of live data
SNAPSHOT_HOST="hatua"               # fixed, so the keep/forget rules see one continuous history
DUMP_NAME="hatua.dump"
MANIFEST_NAME="manifest.txt"

say()  { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { say "ERROR: $*" >&2; exit 1; }

# Reads one setting: the environment wins, then the .env file. The file is parsed, never
# executed, because values such as EMAIL_FROM contain characters a shell would trip over.
setting() {
  local key="$1" fallback="${2:-}" line value
  if [ -n "${!key:-}" ]; then printf '%s' "${!key}"; return; fi
  if [ -f "$ENV_FILE" ]; then
    line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
    if [ -n "$line" ]; then
      value="${line#*=}"
      value="${value%$'\r'}"
      value="${value%"${value##*[![:space:]]}"}"            # trailing spaces
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
        *)     value="${value%%[[:space:]]#*}"; value="${value%"${value##*[![:space:]]}"}" ;;   # trailing comment
      esac
      if [ -n "$value" ]; then printf '%s' "$value"; return; fi
    fi
  fi
  printf '%s' "$fallback"
}

compose() { docker compose --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" "$@"; }

case "$MODE" in
  docker)
    DB_NAME="hatua"
    SNAP_DB_PATH="/data/db"; SNAP_MEDIA_PATH="/data/media"; SNAP_RESTORE_PATH="/restore"
    ;;
  local)
    DATABASE_URL="$(setting DATABASE_URL)"
    [ -n "$DATABASE_URL" ] || fail "DATABASE_URL is not set (local mode)."
    DB_BASE_URL="${DATABASE_URL%%\?*}"; DB_NAME="${DB_BASE_URL##*/}"; DB_BASE_URL="${DB_BASE_URL%/*}"
    MEDIA_DIR_ABS="$(cd "$ROOT/apps/api" && mkdir -p "$(setting MEDIA_DIR media)" && cd "$(setting MEDIA_DIR media)" && pwd)"
    SNAP_DB_PATH="$STAGE_DIR"; SNAP_MEDIA_PATH="$MEDIA_DIR_ABS"; SNAP_RESTORE_PATH="$RESTORE_DIR"
    ;;
  *) fail "HATUA_BACKUP_MODE must be 'docker' or 'local', not '$MODE'." ;;
esac

# ---- database -----------------------------------------------------------------------------

# db_tool <database> <pg tool> [args...]   runs a Postgres client tool against one database.
db_tool() {
  local database="$1" tool="$2"; shift 2
  if [ "$MODE" = docker ]; then
    compose exec -T db "$tool" -U hatua -d "$database" "$@"
  else
    "$tool" --dbname="$DB_BASE_URL/$database" "$@"
  fi
}

# db_value <database> <sql>   one value, no decoration; fails on any SQL error.
db_value() { db_tool "$1" psql -X -At -v ON_ERROR_STOP=1 -c "$2"; }

db_dump() { db_tool "$DB_NAME" pg_dump --format=custom --no-owner --no-acl; }   # writes to stdout

# A dump that pg_restore can list from start to finish is complete and readable.
db_dump_is_readable() {
  if [ "$MODE" = docker ]; then compose exec -T db pg_restore --list < "$1" > /dev/null
  else pg_restore --list < "$1" > /dev/null; fi
}

db_restore() {  # db_restore <database> <dump file>
  if [ "$MODE" = docker ]; then compose exec -T db pg_restore -U hatua -d "$1" --no-owner --no-acl --exit-on-error < "$2"
  else pg_restore --dbname="$DB_BASE_URL/$1" --no-owner --no-acl --exit-on-error < "$2"; fi
}

# The numbers that describe a database's contents; a restore must reproduce them exactly.
db_fingerprint() {
  db_value "$1" "select 'migrations=' || (select count(*) from schema_migrations)
    || ' last_migration=' || (select coalesce(max(name), '-') from schema_migrations)
    || ' users=' || (select count(*) from users)
    || ' posts=' || (select count(*) from posts)
    || ' images=' || (select count(*) from images)"
}

# ---- restic -------------------------------------------------------------------------------

restic_cmd() {
  if [ "$MODE" = docker ]; then
    compose --profile backup run --rm -T backup "$@"
  else
    RESTIC_REPOSITORY="$(setting RESTIC_REPOSITORY)" RESTIC_PASSWORD="$(setting RESTIC_PASSWORD)" restic "$@"
  fi
}

# Runs a small shell command where restored files are readable (they keep their original owners).
in_restore_area() {
  if [ "$MODE" = docker ]; then compose --profile backup run --rm -T --entrypoint sh backup -c "$1"
  else sh -c "$1"; fi
}

require_backup_settings() {
  local repo; repo="$(setting RESTIC_REPOSITORY)"
  [ -n "$repo" ] || fail "RESTIC_REPOSITORY is not set. See deploy/backup/README.md."
  [ -n "$(setting RESTIC_PASSWORD)" ] || fail "RESTIC_PASSWORD is not set. See deploy/backup/README.md."
  case "$repo" in
    /*|./*|local:*) say "WARNING: the backup repository ($repo) is on this server. If the server is lost, so are the backups. Use off-server storage before launch." ;;
  esac
  mkdir -p "$STAGE_DIR" "$RESTORE_DIR" "$BACKUP_DIR/repo"
  chmod 700 "$BACKUP_DIR" "$STAGE_DIR" "$RESTORE_DIR" 2>/dev/null || true
}

require_repository() {
  restic_cmd cat config > /dev/null 2>&1 \
    || fail "Cannot open the backup repository. Check RESTIC_REPOSITORY, RESTIC_PASSWORD and the storage keys; if this is a brand-new repository, run: deploy/backup/backup.sh init"
}

# One backup or restore at a time.
take_lock() {
  mkdir -p "$BACKUP_DIR"
  exec 9> "$BACKUP_DIR/.lock"
  flock -n 9 || fail "Another backup or restore is already running."
}

# Tells a monitor (e.g. an Uptime Kuma push check) how it went. Never fails the job itself.
ping_url() {
  local url="$1"
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "$url" || say "WARNING: could not reach the monitor."
}
