#!/usr/bin/env bash
# Deploys a Git commit to the server (docs/deploy.md). By hand, from your own machine, in the repo:
#
#   DEPLOY_HOST=ubuntu@197.137.65.49 deploy/deploy.sh          # deploys origin/main
#   DEPLOY_HOST=ubuntu@197.137.65.49 deploy/deploy.sh v0.1.0   # a tag, branch or commit
#
# Only committed code is deployed (git archive), never your uncommitted changes.
# Optional: DEPLOY_SSH_KEY=~/.ssh/kenet_rsa, APP_DIR=/srv/hatua, WEB_DIR=/var/www/hatua
#
# On the server itself (the GitHub runner, .github/workflows/deploy.yml): DEPLOY_HOST=local runs every
# step locally instead of over SSH, and RELEASE_DIR=<folder> deploys a release already built elsewhere
# (the code, REVISION, and apps/web/dist), so the server never runs npm.
set -euo pipefail

HOST="${DEPLOY_HOST:?set DEPLOY_HOST, e.g. DEPLOY_HOST=ubuntu@197.137.65.49, or DEPLOY_HOST=local on the server}"
REF="${1:-origin/main}"
APP_DIR="${APP_DIR:-/srv/hatua}"   # folder name = Docker Compose project name ("hatua")
WEB_DIR="${WEB_DIR:-/var/www/hatua}"
SSH_OPTS=(-o ConnectTimeout=20)
[ -n "${DEPLOY_SSH_KEY:-}" ] && SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
RSH="ssh ${SSH_OPTS[*]}"

# on_server '<shell command>': on the server, over SSH or (DEPLOY_HOST=local) right here.
on_server() { if [ "$HOST" = local ]; then bash -c "$1"; else $RSH "$HOST" "$1"; fi; }
# copy_to_server <rsync options...> <source/> <server folder/>
copy_to_server() {
  local dest="${*: -1}" args=("${@:1:$#-1}")
  if [ "$HOST" = local ]; then rsync "${args[@]}" "$dest"; else rsync -e "$RSH" "${args[@]}" "$HOST:$dest"; fi
}

if [ -n "${RELEASE_DIR:-}" ]; then
  BUILD="$RELEASE_DIR"
  [ -s "$BUILD/REVISION" ] && [ -f "$BUILD/apps/web/dist/index.html" ] \
    || { echo "RELEASE_DIR=$BUILD is not a built release (needs REVISION and apps/web/dist)." >&2; exit 1; }
  COMMIT="$(cat "$BUILD/REVISION")"
  echo "Deploying release $COMMIT to $HOST"
else
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  [[ "$REF" == origin/* ]] && git fetch --quiet origin
  COMMIT="$(git rev-parse --verify --quiet "$REF^{commit}")" || { echo "Unknown ref: $REF" >&2; exit 1; }
  echo "Deploying $REF ($(git log -1 --format='%h %s' "$COMMIT")) to $HOST"

  BUILD="$(mktemp -d)"
  trap 'rm -rf "$BUILD"' EXIT
  git archive "$COMMIT" | tar -x -C "$BUILD"
  echo "$COMMIT" > "$BUILD/REVISION"

  echo "== Building the web app"
  (cd "$BUILD" && npm ci --silent --no-audit --no-fund && npm run build -w apps/web --silent)
fi

echo "== Checking the server"
on_server "test -f '$APP_DIR/.env' && test -w '$WEB_DIR'" \
  || { echo "Server not set up: $APP_DIR/.env and a writable $WEB_DIR are needed (docs/deploy.md, first time)." >&2; exit 1; }

echo "== Copying the code"
# .env (secrets) and backups/ live only on the server: never overwrite or delete them.
copy_to_server -az --delete \
  --exclude node_modules --exclude 'apps/*/dist' --exclude /.env --exclude /backups/ \
  "$BUILD/" "$APP_DIR/"

echo "== Building and restarting the API (runs database migrations first)"
on_server "cd '$APP_DIR' && docker compose --profile server up -d --build api && docker image prune -f >/dev/null"

echo "== Waiting for the API"
on_server "cd '$APP_DIR' && port=\$(grep -E '^API_PORT=' .env | cut -d= -f2); port=\${port:-3000};
  for i in \$(seq 1 30); do curl -fsS \"http://127.0.0.1:\$port/api/health\" >/dev/null 2>&1 && exit 0; sleep 2; done;
  echo 'API did not become healthy. Last log lines:' >&2; docker compose --profile server logs --tail 40 api >&2; exit 1"

echo "== Publishing the web app"
# New files land first and old ones are removed last, so open tabs keep working during the switch.
copy_to_server -az --delay-updates --delete-after "$BUILD/apps/web/dist/" "$WEB_DIR/"

echo "Deployed ${COMMIT:0:7}. Open the site and sign in to check (docs/deploy.md, after each deploy)."
