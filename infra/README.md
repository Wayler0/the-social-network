# Hatua infrastructure (`infra/`)

Owner: Peter (data, media & deployment).

## Start the development stack

```
cd infra
cp .env.example .env        # then change every password
docker compose up -d
docker compose run --rm migrate up
docker compose run --rm migrate seed-dev
```

| Service | Where | Notes |
|---|---|---|
| PostgreSQL 16 + PostGIS | `localhost:5432` | Database `hatua` |
| Redis 7 | `localhost:6379` | Password required |
| Object storage (S3 API) | `localhost:9000` (console `:9001`) | Bucket `hatua-media` is created automatically |
| Caddy | `http://localhost:8080` | `/healthz` returns `ok` |

Stop: `docker compose down`. Wipe all data: `docker compose down -v`.

## Object storage — MinIO, community build

`CLAUDE.md` section 12 chooses MinIO, and this stack runs MinIO. The official
`minio/minio` image can no longer be used: upstream stopped publishing
community Docker images in October 2025, removed the image from Docker Hub,
and archived the repository in 2026 (checked 12 Nov 2026). So the stack runs
the maintained community build of the same software, `pgsty/minio`, pinned to
an exact release. Same server, same S3 API, same console.

For the team to confirm at a Sunday briefing before the production deploy:
stay on this build, or move to another S3-compatible store (Garage,
SeaweedFS). It is a third-party build, so whoever deploys should review its
release notes before each version bump.

To keep that choice open, application code must use the **S3 API only**
(endpoint, access key, secret key, bucket from environment variables) and no
MinIO-specific features. Override the image with `MINIO_IMAGE` in `.env`.

## Not in this stack yet

- API and web app services (their source is not in the repo yet).
- Production Caddyfile: real domain, automatic HTTPS, TLS 1.3 only, HSTS.
- Backups (restic), monitoring (Uptime Kuma), email relay.

## Production differences (when we deploy)

- Do not publish the Postgres, Redis or storage ports; only Caddy on 80/443.
- Strong generated passwords; `.env` readable by the deploy user only.
- `APP_ENV=production` (blocks `seed-dev`).
- Images are pinned to exact versions in `docker-compose.yml`; update them on purpose, one at a time, and re-test.
