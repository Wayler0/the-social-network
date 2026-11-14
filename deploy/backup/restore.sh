#!/usr/bin/env bash
# Hatua restore. Nothing here ever overwrites live data.
#
#   deploy/backup/restore.sh list              show the stored backups
#   deploy/backup/restore.sh test  [snapshot]  restore drill: restore a backup into a scratch database
#                                              and folder, prove it matches, then clean up (weekly cron)
#   deploy/backup/restore.sh fetch [snapshot]  disaster recovery, step 1: restore a backup into a NEW
#                                              database and folder, then print how to switch over
#
# [snapshot] is an id from `list`; the default is the newest backup. Runbook: deploy/backup/README.md.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STEP="starting"
SCRATCH_DB=""
SCRATCH_DIR=""

# Restores one snapshot under RESTORE_DIR/<name> and sets DUMP, MANIFEST and MEDIA (host paths)
# plus AREA_MEDIA (the same media folder as the restore area sees it).
restore_snapshot() {
  local snapshot="$1" name="$2"
  SCRATCH_DIR="$RESTORE_DIR/$name"
  STEP="fetching backup '$snapshot'"
  restic_cmd restore "$snapshot" --host "$SNAPSHOT_HOST" --target "$SNAP_RESTORE_PATH/$name"
  # Snapshots keep full paths, so the files sit under <target>/<original path>.
  in_restore_area "chmod -R a+rX '$SNAP_RESTORE_PATH/$name'"
  DUMP="$SCRATCH_DIR$SNAP_DB_PATH/$DUMP_NAME"
  MANIFEST="$SCRATCH_DIR$SNAP_DB_PATH/$MANIFEST_NAME"
  MEDIA="$SCRATCH_DIR$SNAP_MEDIA_PATH"
  AREA_MEDIA="$SNAP_RESTORE_PATH/$name$SNAP_MEDIA_PATH"
  [ -s "$DUMP" ] || fail "The backup holds no database dump."
  [ -s "$MANIFEST" ] || fail "The backup holds no manifest."
}

load_dump_into() {
  local database="$1"
  STEP="checking the dump has not changed since it was taken"
  local expected actual
  expected="$(grep '^dump_sha256=' "$MANIFEST" | cut -d= -f2)"
  actual="$(sha256sum "$DUMP" | cut -d' ' -f1)"
  [ "$expected" = "$actual" ] || fail "The restored dump does not match its checksum (expected $expected, got $actual)."
  STEP="loading the dump into database '$database'"
  db_value postgres "create database \"$database\"" > /dev/null
  db_restore "$database" "$DUMP"
}

compare_with_manifest() {
  local database="$1" expected actual
  STEP="comparing the restored database with what was backed up"
  expected="$(grep '^fingerprint=' "$MANIFEST" | cut -d= -f2-)"
  actual="$(db_fingerprint "$database")"
  [ "$expected" = "$actual" ] || fail "The restored database differs from the backup. Backed up: [$expected]. Restored: [$actual]."
  say "Database matches the backup: $actual"

  STEP="checking every image in the database has its files"
  local list missing
  list="$(db_value "$database" "select path from images order by path")"
  missing="$(printf '%s\n' "$list" | in_restore_area "while IFS= read -r p; do [ -z \"\$p\" ] && continue; for f in 1080.webp 320.webp; do [ -f '$AREA_MEDIA'/\"\$p\"/\$f ] || echo \"\$p/\$f\"; done; done")"
  if [ -n "$missing" ]; then
    printf '%s\n' "$missing" | head -n 20 >&2
    fail "$(printf '%s\n' "$missing" | wc -l) image file(s) named in the database are missing from the backup."
  fi
  say "All $(printf '%s\n' "$list" | grep -c . || true) image(s) in the database have their files."
}

drop_scratch() {
  [ -z "$SCRATCH_DB" ]  || db_value postgres "drop database if exists \"$SCRATCH_DB\"" > /dev/null 2>&1 || true
  [ -z "$SCRATCH_DIR" ] || in_restore_area "rm -rf '$SNAP_RESTORE_PATH/$(basename "$SCRATCH_DIR")'" || true
}

# These run whenever the script ends early for any reason.
on_test_exit() {
  local code=$?
  [ "$code" -eq 0 ] && return
  say "RESTORE TEST FAILED while: $STEP" >&2
  drop_scratch
  ping_url "$(setting BACKUP_FAIL_URL)"
}
on_fetch_exit() {
  local code=$?
  [ "$code" -eq 0 ] && return
  say "RESTORE FAILED while: $STEP. Live data was not touched." >&2
}

run_test() {
  local snapshot="${1:-latest}"
  trap on_test_exit EXIT
  STEP="checking settings"; require_backup_settings; take_lock; require_repository
  SCRATCH_DB="hatua_restore_test"
  db_value postgres "drop database if exists \"$SCRATCH_DB\"" > /dev/null 2>&1
  restore_snapshot "$snapshot" "test-$(date -u +%Y%m%dT%H%M%SZ)"
  load_dump_into "$SCRATCH_DB"
  compare_with_manifest "$SCRATCH_DB"
  STEP="cleaning up"
  local taken; taken="$(grep '^taken_at=' "$MANIFEST" | cut -d= -f2)"
  drop_scratch
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-restore-test"
  trap - EXIT
  say "RESTORE TEST OK: the backup taken at $taken restores completely."
  ping_url "$(setting BACKUP_RESTORE_PING_URL)"
}

run_fetch() {
  local snapshot="${1:-latest}" stamp database
  stamp="$(date -u +%Y%m%d_%H%M%S)"
  database="hatua_restored_$stamp"
  trap on_fetch_exit EXIT
  STEP="checking settings"; require_backup_settings; take_lock; require_repository
  restore_snapshot "$snapshot" "restored-$stamp"
  load_dump_into "$database"
  compare_with_manifest "$database"
  trap - EXIT
  say "RESTORED, live data untouched."
  cat <<DONE

  Backup taken at : $(grep '^taken_at=' "$MANIFEST" | cut -d= -f2)
  Database        : $database   (a new database, next to the live one)
  Images          : $MEDIA

  To switch the app over to this restore, follow "Disaster recovery" in deploy/backup/README.md.
  To discard it instead:  drop database "$database", and delete $SCRATCH_DIR
DONE
}

case "${1:-}" in
  list)  require_backup_settings; restic_cmd snapshots --host "$SNAPSHOT_HOST" ;;
  test)  run_test "${2:-}" ;;
  fetch) run_fetch "${2:-}" ;;
  *) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
