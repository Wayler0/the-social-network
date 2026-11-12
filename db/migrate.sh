#!/usr/bin/env bash
# db/migrate.sh — tiny migration runner for Hatua (plain SQL + psql).
#
#   db/migrate.sh up              apply every migration not yet applied
#   db/migrate.sh status          list applied and pending migrations
#   db/migrate.sh seed-reference  load schools, courses and auto groups
#   db/migrate.sh seed-dev        load test users and sample content (dev only)
#
# Connection: set DATABASE_URL, or the standard PGHOST / PGPORT / PGUSER /
# PGPASSWORD / PGDATABASE variables. Each file runs in one transaction, so a
# failing migration leaves the database unchanged.
set -euo pipefail

DB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$DB_DIR/migrations"
SEEDS_DIR="$DB_DIR/seeds"

run_psql() {
    if [ -n "${DATABASE_URL:-}" ]; then
        # -d, not a bare argument: psql on Windows ignores every option that
        # comes after a positional one and would open an interactive session.
        psql -X -q -v ON_ERROR_STOP=1 -d "$DATABASE_URL" "$@"
    else
        psql -X -q -v ON_ERROR_STOP=1 "$@"
    fi
}

ensure_table() {
    run_psql -c "SET client_min_messages = warning; CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
    );" >/dev/null
}

applied_checksum() {
    run_psql -At -c "SELECT checksum FROM schema_migrations WHERE filename = '$1';"
}

cmd_up() {
    ensure_table
    local applied=0 file name sum old
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [ -e "$file" ] || continue
        name="$(basename "$file")"
        sum="$(sha256sum "$file" | cut -d' ' -f1)"
        old="$(applied_checksum "$name")"
        if [ -n "$old" ]; then
            if [ "$old" != "$sum" ]; then
                echo "ERROR: $name was changed after it was applied." >&2
                echo "       Never edit an applied migration; add a new file instead." >&2
                exit 1
            fi
            continue
        fi
        echo "applying $name"
        run_psql -1 -f "$file" \
            -c "INSERT INTO schema_migrations (filename, checksum) VALUES ('$name', '$sum');"
        applied=$((applied + 1))
    done
    echo "done: $applied migration(s) applied."
}

cmd_status() {
    ensure_table
    local file name
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [ -e "$file" ] || continue
        name="$(basename "$file")"
        if [ -n "$(applied_checksum "$name")" ]; then
            echo "applied  $name"
        else
            echo "PENDING  $name"
        fi
    done
}

run_seeds() {
    local dir="$1" file
    for file in "$dir"/*.sql; do
        [ -e "$file" ] || continue
        echo "seeding $(basename "$file")"
        run_psql -1 -f "$file"
    done
}

case "${1:-}" in
    up)             cmd_up ;;
    status)         cmd_status ;;
    seed-reference) run_seeds "$SEEDS_DIR/reference" ;;
    seed-dev)
        if [ "${APP_ENV:-development}" = "production" ]; then
            echo "ERROR: seed-dev refuses to run when APP_ENV=production." >&2
            exit 1
        fi
        run_seeds "$SEEDS_DIR/reference"
        run_seeds "$SEEDS_DIR/dev"
        ;;
    *)
        sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
