#!/bin/sh
# Start Syncthing beside one Ketos Web instance inside the stand container.
set -eu

: "${DSH_HOME:=/data/ketos}"
: "${KETOS_PORT:=3080}"
: "${KETOS_SYNCTHING_GUI:=8384}"
export DSH_HOME KETOS_PORT

mkdir -p "$DSH_HOME" /data/syncthing /workspace/shared

# First start on an empty Syncthing volume: generate the key and stock config,
# then pin it to the team's private relay before Syncthing ever runs, so no
# public announce server or relay is contacted for this identity.
if [ ! -f /data/syncthing/config.xml ]; then
  syncthing generate --home=/data/syncthing
  node /usr/local/share/ketos-stand/syncthing-bootstrap.mjs
fi

syncthing serve \
  --home=/data/syncthing \
  --gui-address "0.0.0.0:${KETOS_SYNCTHING_GUI}" \
  --no-browser \
  --no-restart \
  >/data/syncthing/syncthing.log 2>&1 &
SYNCTHING_PID=$!

node /app/apps/cli/lib/bin.js web \
  --patch /usr/local/share/ketos-stand/stand.patch.yml \
  --no-open &
KETOS_PID=$!

shutdown() {
  kill "$KETOS_PID" "$SYNCTHING_PID" 2>/dev/null || true
  wait "$KETOS_PID" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

set +e
wait "$KETOS_PID"
code=$?
set -e
kill "$SYNCTHING_PID" 2>/dev/null || true
exit "$code"
