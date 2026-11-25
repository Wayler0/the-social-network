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

Usually automatic (next section), or Actions → Deploy → Run workflow. By hand, from a machine that can SSH to
the server, in the repo. Only **committed and pushed** code is deployed. Once the runner is set up the folders
belong to `hatua-runner`, so deploy as that user (`DEPLOY_HOST=hatua-runner@197.137.65.49`):

```sh
DEPLOY_HOST=ubuntu@197.137.65.49 DEPLOY_SSH_KEY=~/.ssh/kenet_rsa deploy/deploy.sh            # origin/main
DEPLOY_HOST=ubuntu@197.137.65.49 DEPLOY_SSH_KEY=~/.ssh/kenet_rsa deploy/deploy.sh v0.1.0     # a tag or commit
```

It builds the web app locally (saves the server's memory), copies the code with `rsync` (never touching `.env`
or `backups/`), rebuilds and restarts the API (migrations run first), waits for `/api/health`, then publishes
the web app. If the API doesn't come up, the old web app stays live and the script prints the API's logs.

After each deploy: open the site, sign in, open the feed. `cat /srv/hatua/REVISION` shows the deployed commit.

## Automatic deploys (CI/CD)

`.github/workflows/deploy.yml` deploys every commit on `main` that passes **CI**. Pull requests never deploy;
only reviewed code that reached `main` does. One deploy runs at a time and is never cancelled halfway.

KENET doesn't let GitHub connect to the server, so the server runs a **GitHub runner**: a small service that
connects *out* to GitHub over HTTPS (443) and collects deploy jobs. Nothing new is opened to the internet.

```
push to main ─▶ CI (GitHub's machines) ─▶ Deploy / build (GitHub's machines)       ─▶ Deploy / deploy (runner on the server)
                tests                     commit is on main? build the web app,       unpack, deploy/deploy.sh with
                                          pack release.tgz                            DEPLOY_HOST=local, /api/health
```

The server never runs `npm install` or a checkout: it only receives the release built from `main`.

### Turn it on (once; Peter + a repo admin)

**1. Keep pull requests off the runner (do this first).** The repo is public (and must stay open source,
CLAUDE.md section 12), and GitHub warns that a pull request from a fork could try to run its own workflow on
a self-hosted runner, that is, on our server. So:
- **Settings → Actions → General → "Approval for running fork pull request workflows from contributors":
  "Require approval for all external contributors".** Before approving a fork's workflow run, check
  whether it changes anything in `.github/`; never approve one that adds `runs-on: self-hosted` or `hatua-deploy`.
- Only people the team trusts get write access to the repo.

**2. A user for the runner** on the server (not `ubuntu`, not root):
```sh
sudo adduser --system --group --home /home/hatua-runner --shell /bin/bash hatua-runner
sudo usermod -aG docker hatua-runner     # docker compose up; note: docker group = root-level access to this VM
sudo chown -R hatua-runner: /srv/hatua /var/www/hatua
sudo chmod 755 /var/www/hatua            # nginx reads the web app
```
`.env` stays `chmod 600`, now owned by `hatua-runner`. People who deploy by hand over SSH log in as
`hatua-runner` (add their key to `/home/hatua-runner/.ssh/authorized_keys`) or use `sudo -u hatua-runner`.

**3. Install the runner.** On GitHub: **Settings → Actions → Runners → New self-hosted runner → Linux x64**.
It shows the download commands and a one-time token (valid 1 hour). On the server, as `hatua-runner`:
```sh
sudo -iu hatua-runner
mkdir actions-runner && cd actions-runner
# curl + tar lines exactly as GitHub shows them (they check the download's sha256)
./config.sh --url https://github.com/Wayler0/the-social-network --token <token from the page> \
  --name kenet-vm-app --labels hatua-deploy --unattended
exit
cd /home/hatua-runner/actions-runner
sudo ./svc.sh install hatua-runner && sudo ./svc.sh start    # a systemd service: starts again after a reboot
```
The runner should show as **Idle** under Settings → Actions → Runners. If the server reaches the internet
through a proxy, put `https_proxy=http://<proxy>:<port>` in `/home/hatua-runner/actions-runner/.env`
and restart: `sudo ./svc.sh stop && sudo ./svc.sh start`.

**4. GitHub → Settings → Environments → New environment `production`:** Deployment branches: **Selected
branches → `main`** only. Optional: **Required reviewers** (someone clicks Approve before each deploy).
No secrets are needed: the runner already lives on the server.

**5. Settings → Secrets and variables → Actions → Variables:** `DEPLOY_ENABLED` = `true`, and
`APP_URL` = `https://hatua.nextup.co.ke` (checked at `/api/health` after each deploy).

To pause automatic deploys, set `DEPLOY_ENABLED` to `false`. To cut the runner off completely:
`sudo ./svc.sh stop`, or remove it under Settings → Actions → Runners.

### Using it

- **See a deploy:** Actions → Deploy. `cat /srv/hatua/REVISION` on the server shows the deployed commit.
- **Deploy or roll back by hand:** Actions → Deploy → Run workflow, and enter a commit or tag. It must be on
  `main` (an older commit rolls back). Migrations only go forward, as above.
- **Runner offline** (server rebooted, service stopped): the deploy job waits in the queue, up to 24 hours, and
  runs when the runner is back. Check with `sudo systemctl status 'actions.runner.*'`.
- **Updates:** the runner updates itself. Patch the server as usual.

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
