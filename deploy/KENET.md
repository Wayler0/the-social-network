# Hatua on KENET (live since 22 Nov 2026)

Hatua runs on the university's KENET VMs next to the NextUp apps (SMARTTT, Attendance, Timetable)
and 9two5. It does **not** use this repo's `docker-compose.yml` there: the server has one shared
stack in `/opt/nextup`, so Hatua is two services in it.

| | |
|---|---|
| Address | **https://hatua.nextup.co.ke** (DNS: Cloudflare `A` record → 197.137.65.49, **proxied** (orange cloud): kept on purpose for attack protection, decided 25 Nov; see To do 1) |
| Where | vm-app (197.137.65.49): `hatua-api` and `hatua-web` in `/opt/nextup/compose.yml` |
| Front door | the shared Caddy (Let's Encrypt) → `hatua-web` (this repo's `deploy/web.Dockerfile`: app files, headers, `/api` and `/media` → `hatua-api`). `TRUST_PROXY_HOPS=2` |
| Database | vm-db (10.8.0.12 over WireGuard): PostgreSQL 18, database and user `hatua`. No PostGIS there yet: the first migration that needs it needs it installed on vm-db first |
| Photos | Docker volume `nextup_hatua_media` |
| Settings | `/opt/nextup/env/hatua.env` (CODE_PEPPER, APP_URL, email) and `HATUA_DB_PASSWORD` in `/opt/nextup/.env`. Never in git |
| Backups | nightly 02:00 (`/opt/nextup/backup.sh`): `hatua-<date>.dump` and `hatua-media-<date>.tar.gz` in `/srv/files/backups`, kept 14 days |
| Deploy | **Automatic:** every commit on `main` whose CI passes, within about 5 minutes (below). By hand: `deploy/kenet.sh` (origin/main) or `deploy/kenet.sh <ref>`, with the KENET key `~/.ssh/kenet_rsa` |
| Logs | `ssh user@197.137.65.49 'cd /opt/nextup && docker compose logs --tail 100 hatua-api'` |

## Automatic deploys (CI/CD)

The server pulls; GitHub never connects to it. `/opt/nextup/hatua-autodeploy.sh` (this repo's
`deploy/kenet-autodeploy.sh`) runs every 5 minutes from `user`'s crontab on vm-app. It asks GitHub's
public API for `main`'s newest commit; once the **CI** workflow has passed on it, it does what
`deploy/kenet.sh` does: the commit's files go to `/opt/nextup/src/the-social-network`, then
`deploy-hatua.sh` builds, restarts, checks `/api/health` and puts the previous images back on failure.
No keys or secrets on GitHub, no runner, nothing opened to the internet. Only reviewed code reaches
`main` (pull requests need an approval).

- A commit whose CI or deploy failed is skipped, not retried; the next commit on `main` is deployed.
- Log: `/opt/nextup/hatua-autodeploy.log` (one line per decision); build output: `hatua-deploy.log`;
  history: `deploys.log` (`(auto)` or `(laptop)`).
- **Pause** (always before rolling back by hand, or the next run puts `main` back):
  `touch /opt/nextup/.hatua-autodeploy/paused`. **Resume:** `rm /opt/nextup/.hatua-autodeploy/paused`.
- **Roll back:** pause, then `deploy/kenet.sh <older commit>`. Resume once `main` has the fix.

**Install or update the script** (from a laptop with the KENET key, in the repo):
```sh
scp -i ~/.ssh/kenet_rsa deploy/kenet-autodeploy.sh user@197.137.65.49:/opt/nextup/hatua-autodeploy.sh
ssh -i ~/.ssh/kenet_rsa user@197.137.65.49 'chmod 755 /opt/nextup/hatua-autodeploy.sh
  (crontab -l | grep -v hatua-autodeploy; echo "*/5 * * * * /opt/nextup/hatua-autodeploy.sh >> /opt/nextup/hatua-autodeploy.log 2>&1") | crontab -'
```

## The sharp fix (why the API image has two steps)

KENET's CPUs lack SSE4.2/AVX. sharp's prebuilt binary needs them (x86-64-v2) and its Wasm
fallback needs SIMD, so photo uploads would fail. `/opt/nextup/hatua-api-kenet.Dockerfile` builds
libvips 8.18.7 and sharp from source for baseline x86-64 on top of `deploy/api.Dockerfile`'s
image, and the build fails if sharp can't make a WebP. When sharp is upgraded in `package.json`,
the deploy passes the new version and compiles once more (about 8 minutes); otherwise it is cached.

## To do (written down 22 Nov 2026, to look at later)

1. **Cloudflare: keep the proxy, fix what it breaks (decided 25 Nov, Kim and Wayler).** The proxy
   stays for attack protection. Three settings, done by Kim:
   (a) **Real addresses:** in the shared Caddy, `trusted_proxies` = Cloudflare's ranges and
   `client_ip_headers CF-Connecting-IP`, then `TRUST_PROXY_HOPS=3` for hatua-api. Check other apps
   behind that Caddy still see real addresses.
   (b) **Lock the origin:** vm-app accepts 80/443 only from Cloudflare's ranges (or a Cloudflare
   Tunnel), since 197.137.65.49 is public.
   (c) **SSL mode Full (strict).**
   The privacy policy names Cloudflare (25 Nov). Why (a) matters: the API sees Cloudflare's
   address instead of the member's (checked: it logged
   `104.22.77.136` for a request from `105.160.56.202`). Sign-in rate limits are per address, so
   members behind the same Cloudflare server share one limit and a few wrong codes can lock them
   all out. The other KENET sites are DNS only. The proxy also blocks one of Let's Encrypt's two
   checks (TLS-ALPN); the certificate was still issued through the other (HTTP). Nothing on the
   server needs to change. (The alternative, keeping the proxy and having the shared Caddy trust
   Cloudflare's `CF-Connecting-IP`, is a server-wide setting that touches every app.)
2. **Email (blocks every sign-in):** `EMAIL_MODE=log`. In production that mode refuses to send
   and never prints the code, so **nobody can sign in at all**, admins included: members get
   "We couldn't send your code" and the API logs `EMAIL IS NOT WORKING`. Decided 24 Nov: the
   team's Resend account, as `no-reply@nextup.co.ke` for now (docs/email.md, "Now (testing and
   beta)"). vm-app can't reach any SMTP port (checked 24 Nov: 25/465/587/2465/2587 blocked,
   HTTPS open), so use `EMAIL_MODE=resend`, `EMAIL_FROM` and `RESEND_API_KEY` in
   `/opt/nextup/env/hatua.env` (needs the commit that adds `resend` mode deployed), then
   `docker compose up -d --no-deps --force-recreate hatua-api`, and send a test:
   `docker compose exec hatua-api node dist/email/send-test.js <address>` (check spam too).
3. **First admin:** after that person has signed in once:
   `docker compose exec hatua-api node dist/admin/grant-admin.js <email>`.
4. **Commit** `deploy/kenet.sh` and this file (they are not in git yet).
5. **Test a real photo upload** on the site. sharp is checked to load and make WebP inside the
   running API, but no upload has gone through the site yet.
6. **Off-server backups** (restic, deploy/backup/README.md): the nightly dumps stay on KENET's
   file storage only.
7. **Automatic deploys** from GitHub Actions, like the other apps (`/opt/nextup/deploy.sh`).
8. **Server clean-up (not Hatua's):** `/opt/nextup/source.env` on vm-app still holds the old
   Railway database URLs with passwords, in plain text. Delete it if those Railway projects are gone.

Done on 22 Nov: DNS record added; the shared Caddy container recreated, so it reads the current
`/opt/nextup/Caddyfile` again. Before that it saw an old copy, and a restart would have dropped
9two5 and Hatua.
