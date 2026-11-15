#!/usr/bin/env bash
# Hatua backup: database + uploaded images, encrypted, to off-server storage (restic).
#
#   deploy/backup/backup.sh init      create the backup repository (once)
#   deploy/backup/backup.sh run       take a backup now (the nightly cron job)
#   deploy/backup/backup.sh status    last success and recent snapshots; fails if the last backup is too old
#
# Set-up, schedule and the restore procedure: deploy/backup/README.md.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STEP="starting"
# Runs whenever the script ends early for any reason (a failed command or an explicit error).
on_exit() {
  local code=$?
  [ "$code" -eq 0 ] && return
  say "BACKUP FAILED while: $STEP" >&2
  rm -f "$STAGE_DIR/$DUMP_NAME.tmp" "$STAGE_DIR/$DUMP_NAME"
  ping_url "$(setting BACKUP_FAIL_URL)"
}

run_backup() {
  trap on_exit EXIT
  STEP="checking settings";            require_backup_settings; take_lock
  STEP="opening the backup repository"; require_repository

  # Database first, images second: every image row in the dump then has its files in the
  # snapshot (files are written before their row). The reverse order could miss files.
  STEP="dumping the database"
  local dump="$STAGE_DIR/$DUMP_NAME"
  db_dump > "$dump.tmp"
  STEP="checking the dump is complete"
  [ -s "$dump.tmp" ] || fail "The database dump is empty."
  db_dump_is_readable "$dump.tmp"
  mv "$dump.tmp" "$dump"

  STEP="recording what the dump contains"
  {
    echo "taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "fingerprint=$(db_fingerprint "$DB_NAME")"
    echo "dump_sha256=$(sha256sum "$dump" | cut -d' ' -f1)"
    echo "dump_bytes=$(stat -c %s "$dump")"
  } > "$STAGE_DIR/$MANIFEST_NAME"

  STEP="storing the backup"
  restic_cmd backup "$SNAP_DB_PATH" "$SNAP_MEDIA_PATH" --host "$SNAPSHOT_HOST" --tag hatua --exclude "$SNAP_MEDIA_PATH/tmp"

  STEP="removing old backups"
  restic_cmd forget --host "$SNAPSHOT_HOST" --tag hatua --group-by host \
    --keep-daily "$(setting BACKUP_KEEP_DAILY 7)" --keep-weekly "$(setting BACKUP_KEEP_WEEKLY 4)" \
    --keep-monthly "$(setting BACKUP_KEEP_MONTHLY 6)" --prune

  STEP="verifying the repository"
  restic_cmd check

  STEP="finishing"
  rm -f "$dump"   # the plain dump does not stay on disk; the encrypted copy is in the repository
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success"
  trap - EXIT
  say "BACKUP OK ($(grep '^fingerprint=' "$STAGE_DIR/$MANIFEST_NAME" | cut -d= -f2-))"
  ping_url "$(setting BACKUP_PING_URL)"
}

show_status() {
  require_backup_settings
  local max_hours last age
  max_hours="$(setting BACKUP_MAX_AGE_HOURS 26)"
  restic_cmd snapshots --host "$SNAPSHOT_HOST" --latest 5 || true
  [ -f "$BACKUP_DIR/last-success" ] || fail "No successful backup has been recorded on this machine."
  last="$(cat "$BACKUP_DIR/last-success")"
  age=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  [ "$age" -le "$max_hours" ] || fail "The last successful backup was $age hours ago ($last). Expected one every $max_hours hours."
  say "Last successful backup: $last ($age hours ago)."
}

case "${1:-}" in
  init)
    require_backup_settings
    if restic_cmd cat config > /dev/null 2>&1; then say "The repository already exists; nothing to do."
    else restic_cmd init; say "Repository created. Store RESTIC_PASSWORD somewhere safe off this server: without it the backups cannot be read."; fi
    ;;
  run)    run_backup ;;
  status) show_status ;;
  *) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
