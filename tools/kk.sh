#!/usr/bin/env bash
# Runs the Kofferklar command line on the server, e.g.
#   tools/kk.sh items > liste.txt
#   tools/kk.sh import --probe < meine-liste.txt
#   tools/kk.sh invite --name Daniel --role owner
# KK_SSH: ssh host alias (default frag-daniel), KK_CONTAINER: container name.
set -euo pipefail
host="${KK_SSH:-frag-daniel}"
container="${KK_CONTAINER:-frag-daniel-kofferklar-api-1}"
args=""
for a in "$@"; do args="$args $(printf '%q' "$a")"; done
exec ssh "$host" "docker exec -i $container node /srv/server/cli.mjs$args"
