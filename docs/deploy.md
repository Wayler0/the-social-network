# Deploying to the KENET server

Owner: Peter (data, media & deployment). Server: `vm-app`, `197.137.65.49`, shared with other projects that use
its existing **nginx**. Site: `https://hatua.nextup.co.ke` (placeholder until the name and domain are chosen).

```
browser ──HTTPS──▶ nginx (host) ──┬─ /            → /var/www/hatua      (built web app)
                                  └─ /api, /media → 127.0.0.1:3000      (API container)
                                                        └─ Postgres + PostGIS container (127.0.0.1 only)
```

| Where | What |
|---|---|
| `/srv/hatua` | The code (copied by `deploy/deploy.sh`) and **`.env`** (secrets, only on the server). The folder name makes the Docker Compose project `hatua`, so containers and volumes don't clash with other projects |
| `/var/www/hatua` | The built web app |
| `/etc/nginx/sites-available/hatua` | From `deploy/nginx/hatua.conf` |
| Docker volumes `hatua_dbdata`, `hatua_media` | Database and uploaded images (backed up: `deploy/backup/README.md`) |

## First time (once)

**Before you start:** DNS `A` record `hatua.nextup.co.ke → 197.137.65.49`, and ports 80/443 open to the internet.

1. **Check the server has room** (the stack uses about 450 MB of memory at most):
   ```sh
   ssh ubuntu@197.137.65.49
   free -m; df -h /; docker compose version; nginx -v
   sudo ss -ltnp | grep -E ':(3000|5434)\b'   # anything here? then pick other ports in step 3
   ```
2. **Folders** (owned by the deploy user, who must be in the `docker` group):
   ```sh
   sudo mkdir -p /srv/hatua /var/www/hatua
   sudo chown "$USER": /srv/hatua /var/www/hatua
   ```
3. **Secrets:** create `/srv/hatua/.env` (`chmod 600`). Generate the values on the server; keep a copy in the
   team's password manager (backups don't include `.env`):
   ```sh
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   CODE_PEPPER=<openssl rand -base64 48>          # the API refuses to start without it
   APP_NAME=Hatua
   APP_URL=https://hatua.nextup.co.ke
   # API_PORT=3001  DB_PORT=5435                  # only if step 1 found 3000/5434 taken
   EMAIL_MODE=smtp                                 # + EMAIL_FROM and SMTP_* — docs/email.md
   ```
   VAPID keys (push) and restic settings (backups) can be added later; see `.env.example`.
4. **First deploy** from your own machine (step "Every deploy" below). It copies the code, builds the API image,
   runs the migrations (which also create the campus row) and publishes the web app.
5. **nginx + HTTPS:**
   ```sh
   cd /srv/hatua
   sudo cp deploy/nginx/hatua.conf /etc/nginx/sites-available/hatua
   sudo ln -s /etc/nginx/sites-available/hatua /etc/nginx/sites-enabled/hatua
   sudo nginx -t && sudo systemctl reload nginx            # -t first: a broken file would take down the other sites
   sudo certbot --nginx -d hatua.nextup.co.ke --redirect   # HTTPS certificate, renews itself
   ```
   If `API_PORT` isn't 3000, change the `upstream` port in the nginx file to match.
6. **Email:** `cd /srv/hatua && docker compose --profile server exec api node dist/email/send-test.js you@student.tharaka.ac.ke`
   then check the code arrives and is not in spam (docs/email.md).
7. **First admin:** sign in once on the site, then
   `docker compose --profile server exec api node dist/admin/grant-admin.js <your email>`.
8. **Backups:** follow `deploy/backup/README.md` (off-server storage, nightly cron, weekly restore test).

## Every deploy

From your own machine, in the repo. Only **committed and pushed** code is deployed:

```sh
DEPLOY_HOST=ubuntu@197.137.65.49 DEPLOY_SSH_KEY=~/.ssh/kenet_rsa deploy/deploy.sh            # origin/main
DEPLOY_HOST=ubuntu@197.137.65.49 DEPLOY_SSH_KEY=~/.ssh/kenet_rsa deploy/deploy.sh v0.1.0     # a tag or commit
```

It builds the web app locally (saves the server's memory), copies the code with `rsync` (never touching `.env`
or `backups/`), rebuilds and restarts the API (migrations run first), waits for `/api/health`, then publishes
the web app. If the API doesn't come up, the old web app stays live and the script prints the API's logs.

After each deploy: open the site, sign in, open the feed. `cat /srv/hatua/REVISION` shows the deployed commit.

## Day to day

```sh
cd /srv/hatua
docker compose --profile server ps                 # is it running?
docker compose --profile server logs -f --tail 100 api
docker compose --profile server restart api
```

**Roll back:** deploy the previous commit or tag (`deploy/deploy.sh <ref>`). Migrations only go forward. If a
migration damaged data, restore from backup (`deploy/backup/README.md`).

## Before launch (week-4 security check)

- TLS: `nmap --script ssl-enum-ciphers -p 443 hatua.nextup.co.ke` shows TLS 1.2+ only. Hybrid PQ key exchange
  (X25519MLKEM768, CLAUDE.md section 12) needs nginx built with OpenSSL 3.5+. Check with
  `openssl version` on the server; on older OpenSSL browsers use plain X25519.
- Only 22, 80 and 443 reachable from outside (`sudo ss -ltnp`: Postgres and the API listen on 127.0.0.1 only).
- Uptime Kuma (or any monitor) watching `https://hatua.nextup.co.ke/api/health`.
