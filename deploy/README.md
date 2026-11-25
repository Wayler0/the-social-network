# Deploying to the server

Target: the **campus KENET server** (CLAUDE.md section 1, DECIDED). Don't deploy to team members' personal droplets or VPSs.

What runs: `db` (PostgreSQL + PostGIS), `api` (Node), `web` (Caddy: the app, HTTPS, forwarding of `/api` and
`/media`). Everything is in `docker-compose.yml`, under the `server` profile. Backups: `deploy/backup/README.md`.

## What the server needs

- Linux with Docker Engine and the Compose plugin (`docker compose version` works). 1 GB RAM is enough for the pilot.
- A domain or subdomain whose DNS **A record points at the server's public IP**. Not a `tharaka.ac.ke` subdomain.
- Ports **80 and 443 open** to the internet (80 is needed for the HTTPS certificate). Nothing else open:
  the database and API listen on 127.0.0.1 only.
- An SMTP account for sign-in emails (`docs/email.md`).

**Does the server already run nginx or another web server on 80/443?** Then use the "Behind another web server"
section below instead of letting Caddy take those ports.

## First deploy

```
git clone git@github.com:Wayler0/the-social-network.git hatua && cd hatua
cp deploy/env.production.example .env && chmod 600 .env
nano .env                                   # fill every <...>
docker compose --profile server up -d --build
docker compose --profile server ps          # db healthy, api and web up
docker compose --profile server logs -f web # watch for "certificate obtained successfully"
```

Then check, in this order:
1. `https://<your domain>/api/health` answers.
2. **Email:** `docker compose --profile server exec api node dist/email/send-test.js you@student.tharaka.ac.ke`.
   Check the inbox **and the spam folder**. If it's in spam, fix SPF/DKIM before inviting anyone (`docs/email.md`).
3. Sign in on a phone. Install the app from Settings → "Install".
4. **First admin:** after that person has signed in once:
   `docker compose --profile server exec api node dist/admin/grant-admin.js <their email>`.
   Then give moderators their role in Admin → Members.
5. Backups: `deploy/backup/README.md` (init, run, restore test, cron).

## Updating

```
git pull
docker compose --profile server up -d --build   # migrations run automatically when the API starts
```

Members with the installed app see "A new version is ready. Reload".

## Behind another web server (shared server)

Caddy then listens only on `127.0.0.1:8080` and the existing web server keeps HTTPS for our domain:

```
docker compose -f docker-compose.yml -f deploy/behind-proxy.yml --profile server up -d --build
```

Use the same `-f … -f …` on every `docker compose` command (or set
`COMPOSE_FILE=docker-compose.yml:deploy/behind-proxy.yml` in `.env`). nginx example for our domain:

```
server {
    listen 443 ssl http2;
    server_name pilot.your-domain.example;
    # ssl_certificate … (certbot or the server's usual way)
    client_max_body_size 10m;                     # photo uploads
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-For` matters: without it every member looks like the same address and sign-in rate limits lock
everyone out together.

## Useful commands

| Task | Command |
|---|---|
| Status | `docker compose --profile server ps` |
| Logs | `docker compose --profile server logs -f api` (or `web`, `db`) |
| Restart the API | `docker compose --profile server restart api` |
| Database shell | `docker compose exec db psql -U hatua hatua` |
| Memory use | `docker stats --no-stream` |

## Security check (before real members)

- Only 22 (SSH), 80 and 443 reachable from outside: `sudo ss -tlnp` on the server, and a port scan from outside.
- SSH with keys only, no password login; admin access limited and listed in the handover notes.
- `.env` is `chmod 600` and a copy is in the password manager.
- HTTPS grade and post-quantum key exchange: check the site in an SSL test and in Chrome DevTools → Security.
