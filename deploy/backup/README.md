# Backups and restore

Owner: Peter. Scripts: `deploy/backup/backup.sh`, `deploy/backup/restore.sh`.

Every night the server takes an **encrypted** copy of the database and the uploaded images and stores it
**off the server**. Once a week it restores the newest backup into a scratch database and proves it is complete.
A backup that has never been restored is not a backup.

| What | Backed up? |
|---|---|
| Database (members, posts, groups, everything) | Yes |
| Uploaded images (the `media` volume) | Yes |
| The `.env` file (passwords, keys) | **No.** Keep a copy in the team's password manager |
| The code | No need: it is in Git |

## Decision needed: where the backups go

The storage must be **outside the server** (if the server dies, is wiped or is broken into, the backups must survive).
Any S3-compatible storage bucket or Backblaze B2 works with the settings below. At our size (a few GB) the cost is small.
Whoever opens the account should not be the only person with the login.

## Set-up (once, on the server)

1. Create a private storage bucket and an access key that can read and write only that bucket.
2. Add to `.env` (examples in `.env.example`):
   ```
   RESTIC_REPOSITORY=s3:https://<storage-endpoint>/<bucket>/hatua
   RESTIC_PASSWORD=<a long random passphrase>
   AWS_ACCESS_KEY_ID=<key id>
   AWS_SECRET_ACCESS_KEY=<key>
   ```
3. **Store `RESTIC_PASSWORD` in the password manager now.** It encrypts the backups. If it is lost, every backup
   is unreadable, and nobody can recover it.
4. Create the repository and take the first backup:
   ```
   deploy/backup/backup.sh init
   deploy/backup/backup.sh run
   deploy/backup/restore.sh test
   ```
5. Schedule it (`crontab -e` for the user that runs Docker; adjust the path):
   ```
   15 2 * * *  cd /srv/hatua && deploy/backup/backup.sh run   >> backups/backup.log 2>&1
   30 3 * * 0  cd /srv/hatua && deploy/backup/restore.sh test >> backups/backup.log 2>&1
   ```
   That is a backup at 02:15 every night and a restore test at 03:30 every Sunday.

To practise before the storage exists, set `RESTIC_REPOSITORY=/repo`: backups then go to `backups/repo` on the same
disk. The scripts warn every time, because that protects against nothing.

## Knowing it works

| Check | How |
|---|---|
| Did last night's backup run? | `deploy/backup/backup.sh status` — fails if the last success is older than 26 hours |
| What backups exist? | `deploy/backup/restore.sh list` |
| Can we really restore? | `deploy/backup/restore.sh test` |
| Be told automatically | Set `BACKUP_PING_URL`, `BACKUP_RESTORE_PING_URL` and `BACKUP_FAIL_URL` in `.env` to push-monitor addresses (e.g. Uptime Kuma). A monitor that expects a call every day raises the alarm when a backup is **missed**, not only when it fails |

Kept: 7 daily, 4 weekly and 6 monthly backups (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, `BACKUP_KEEP_MONTHLY`).

What the restore test proves: the backup downloads and decrypts, the database dump is unchanged (checksum), it loads
into PostgreSQL without errors, the restored database has the same migrations and the same number of members, posts
and images as when it was taken, and every image named in the database has both of its files.

## Disaster recovery

`restore.sh` never overwrites live data. It restores into a **new** database and folder; switching over is a
deliberate step done by a person. **Rehearse this on the server before launch** (roadmap: 18 Dec) — the switch-over
commands below have not been run on the real server yet.

**A. The server is fine but data is damaged or lost**

```
deploy/backup/restore.sh list                 # pick a backup (default: the newest)
deploy/backup/restore.sh fetch [snapshot]     # prints the new database name and image folder
```

Then, using the names it printed:

```
# 1. Stop the app (members see the site as down)
docker compose --profile server stop api

# 2. Swap the databases (the damaged one is kept, renamed)
docker compose exec -T db psql -U hatua -d postgres \
  -c 'alter database hatua rename to hatua_before_restore' \
  -c 'alter database "hatua_restored_<stamp>" rename to hatua'

# 3. Copy the restored images into the media volume
docker compose --profile server run --rm --no-deps --user root --entrypoint sh \
  -v "$PWD/backups/restore/restored-<stamp>/data/media:/from:ro" api \
  -c 'cp -a /from/. /data/media/ && chown -R node:node /data/media'

# 4. Start the app and check it
docker compose --profile server up -d api
curl -fs http://127.0.0.1:3000/api/health
```

Sign in, open the feed, open a post with a photo. When all is well for a few days, drop `hatua_before_restore`
and delete `backups/restore/restored-<stamp>`.

**B. The server is gone**

1. New server with Docker. Clone the repository.
2. Restore `.env` from the password manager (it holds `RESTIC_PASSWORD` and the storage keys).
3. `docker compose up -d db`
4. `deploy/backup/restore.sh fetch`, then steps 2 to 4 of A (in step 2 the "damaged" database is the new empty one).
5. Point the domain at the new server.

Everything since the last nightly backup is lost in both cases (at most 24 hours).

## Running it without Docker (developers, CI)

```
HATUA_BACKUP_MODE=local DATABASE_URL=postgres://… RESTIC_REPOSITORY=/tmp/hatua-repo RESTIC_PASSWORD=test \
  deploy/backup/backup.sh init
```

`local` mode uses `pg_dump`, `pg_restore`, `psql` and `restic` from your machine and the API's `MEDIA_DIR`.
