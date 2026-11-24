#!/usr/bin/env bash
# Deploys Hatua to the KENET server (vm-app, 197.137.65.49), where it runs next to the NextUp apps
# and 9two5 behind their shared Caddy (HTTPS): https://hatua.nextup.co.ke
#
#   deploy/kenet.sh              # origin/main
#   deploy/kenet.sh <ref>        # a tag, branch or commit
#
# Only committed code is shipped (git archive), never uncommitted edits. It goes to
# /opt/nextup/src/the-social-network; /opt/nextup/deploy-hatua.sh then builds the images on the VM,
# restarts hatua-api (migrations run first) and hatua-web, waits for /api/health and puts the
# previous images back if they don't come up. Secrets live only on the VM (/opt/nextup/env/hatua.env,
# HATUA_DB_PASSWORD in /opt/nextup/.env). Needs the KENET admin key ~/.ssh/kenet_rsa.
set -euo pipefail

VM=${KENET_VM:-197.137.65.49}
SSH=(ssh -i "${KENET_KEY:-$HOME/.ssh/kenet_rsa}" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 "user@$VM")
REF=${1:-origin/main}

cd "$(git rev-parse --show-toplevel)"
[[ "$REF" == origin/* ]] && git fetch --quiet origin
sha=$(git rev-parse --verify --quiet "$REF^{commit}") || { echo "Unknown ref: $REF" >&2; exit 1; }
echo "== 1. copy $REF ($(git log -1 --format='%h %s' "$sha")) to vm-app"
git archive --format=tar "$sha" | "${SSH[@]}" "
  set -e; cd /opt/nextup/src
  rm -rf the-social-network.new; mkdir the-social-network.new; tar -x -C the-social-network.new
  echo $sha > the-social-network.new/DEPLOYED_COMMIT
  rm -rf the-social-network; mv the-social-network.new the-social-network"

echo "== 2. build and restart on vm-app (in the background, so a dropped SSH session can't stop it)"
"${SSH[@]}" 'cd /opt/nextup; rm -f hatua-deploy.rc
  nohup sh -c "./deploy-hatua.sh > hatua-deploy.log 2>&1; echo \$? > hatua-deploy.rc" >/dev/null 2>&1 &'
rc=
for _ in $(seq 90); do
  rc=$("${SSH[@]}" 'cat /opt/nextup/hatua-deploy.rc 2>/dev/null' || true)
  [ -n "$rc" ] && break
  sleep 10
done
"${SSH[@]}" 'tail -15 /opt/nextup/hatua-deploy.log'
[ "${rc:-}" = 0 ] || { echo "DEPLOY FAILED (exit ${rc:-timeout})"; exit 1; }

echo "== 3. from the internet"
curl -fsS -m 20 "https://hatua.nextup.co.ke/api/health" && echo || echo "(not reachable from here yet: DNS or certificate?)"
