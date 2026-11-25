#!/usr/bin/env bash
# Continuous deployment for Hatua on KENET (deploy/KENET.md, "Automatic deploys"). Installed as
# /opt/nextup/hatua-autodeploy.sh on vm-app and run every 5 minutes from user's crontab:
#
#   */5 * * * * /opt/nextup/hatua-autodeploy.sh >> /opt/nextup/hatua-autodeploy.log 2>&1
#
# Pull, not push: the server asks GitHub for main's newest commit and deploys it once the CI workflow
# has passed on it. GitHub needs no key to the server and holds no secrets; nothing is opened to the
# internet. Deploying is what deploy/kenet.sh does from a laptop: the commit's files go to
# src/the-social-network, then deploy-hatua.sh builds, restarts, waits for /api/health and puts
# the previous images back if it fails.
#
#   touch /opt/nextup/.hatua-autodeploy/paused   # stop deploying (e.g. before rolling back by hand)
#   rm    /opt/nextup/.hatua-autodeploy/paused   # start again
#
# A commit whose CI or deploy failed is not tried again; the next commit on main is.
set -euo pipefail

REPO=${HATUA_REPO:-Wayler0/the-social-network}   # the overrides are only for testing
BRANCH=${HATUA_BRANCH:-main}
NEXTUP=${NEXTUP_DIR:-/opt/nextup}
STATE=$NEXTUP/.hatua-autodeploy

cd "$NEXTUP"
mkdir -p "$STATE"
[ -e "$STATE/paused" ] && exit 0
exec 8>"$STATE/lock"
flock -n 8 || exit 0                      # the previous run is still deploying

log() { printf '%s %s\n' "$(date -Is)" "$*"; }
# GitHub's public API (no token: 60 requests an hour from this address; a quiet check uses 1).
api() { curl -fsS -m 30 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/$1"; }
json() { python3 -c "import sys, json; d = json.load(sys.stdin); print($1)" 2>/dev/null; }

sha=$(api "commits/$BRANCH" | json 'd["sha"]') || { log "could not ask GitHub for $BRANCH (network?)"; exit 0; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { log "odd answer from GitHub: '$sha'"; exit 0; }

deployed=$(cat src/the-social-network/DEPLOYED_COMMIT 2>/dev/null || true)
[ "$sha" = "$deployed" ] && exit 0
[ -e "$STATE/failed-$sha" ] && exit 0

# The CI workflow's run for this push: wait while it runs, skip the commit if it failed.
ci=$(api "actions/runs?head_sha=$sha&event=push&per_page=20" | json '
next((r["status"] + " " + str(r["conclusion"]) for r in d["workflow_runs"] if r["name"] == "CI"), "none none")') \
  || { log "could not read CI for ${sha:0:7}"; exit 0; }
case "$ci" in
  "completed success") ;;
  completed*) log "skip ${sha:0:7}: CI ${ci#completed }"; touch "$STATE/failed-$sha"; exit 0 ;;
  *) exit 0 ;;                            # queued, running, or not started yet: next time
esac

log "deploy ${sha:0:7} (main, CI passed; was ${deployed:0:7})"
new=src/the-social-network.new
rm -rf "$new" && mkdir -p "$new"
curl -fsSL -m 300 "https://codeload.github.com/$REPO/tar.gz/$sha" | tar -xz --strip-components=1 -C "$new" \
  || { log "download of ${sha:0:7} failed; trying again next time"; rm -rf "$new"; exit 0; }
echo "$sha" > "$new/DEPLOYED_COMMIT"
rm -rf src/the-social-network && mv "$new" src/the-social-network

if ./deploy-hatua.sh > hatua-deploy.log 2>&1; then
  echo 0 > hatua-deploy.rc
  log "DEPLOYED ${sha:0:7}"
  echo "$(date -Is) DEPLOYED hatua $sha (auto)" >> deploys.log
  find "$STATE" -name 'failed-*' -mtime +30 -delete
else
  rc=$?; echo "$rc" > hatua-deploy.rc
  touch "$STATE/failed-$sha"
  log "FAILED ${sha:0:7} (exit $rc): see hatua-deploy.log. deploy-hatua.sh put the previous images back."
fi
