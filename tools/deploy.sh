#!/usr/bin/env bash
# Builds and deploys the app to the frag-daniel server. Only after Daniel's yes (AGENTS.md), and only once Caddy,
# container and backup are set up in the frag-daniel repository (infra/frag-daniel.md).
#   tools/deploy.sh            checks (types, tests), build, upload dist/ and dist-server/, restart the backend
# KK_SSH: ssh host alias (default frag-daniel).
set -euo pipefail
host="${KK_SSH:-frag-daniel}"
container="frag-daniel-kofferklar-api-1"
base=/mnt/frag-daniel/kofferklar
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "Uncommittete Änderungen – bitte erst committen." >&2; exit 1; fi
npm run --silent typecheck
npm test --silent >/dev/null
npm run --silent build
upload() {
  tar -C "$1" -czf - . | ssh "$host" "set -e
    rm -rf '$2.new' '$2.old'
    mkdir -p '$2.new'
    tar -C '$2.new' -xzf -
    [ ! -e '$2' ] || mv '$2' '$2.old'
    mv '$2.new' '$2'
    rm -rf '$2.old'"
}
upload dist "$base/app"
upload dist-server "$base/server"
ssh "$host" "docker restart $container >/dev/null && sleep 2 && docker exec $container wget -qO- http://127.0.0.1:8080/api/health"
echo
echo "Deployed $(git rev-parse --short HEAD)"
