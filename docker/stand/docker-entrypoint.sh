#!/bin/sh
# Start Syncthing beside one Ketos Web instance inside the stand container.
set -eu

: "${DSH_HOME:=/data/ketos}"
: "${KETOS_PORT:=3080}"
: "${KETOS_SYNCTHING_GUI:=8384}"
export DSH_HOME KETOS_PORT

mkdir -p "$DSH_HOME" /data/syncthing /workspace

syncthing \
  -home /data/syncthing \
  -gui-address "0.0.0.0:${KETOS_SYNCTHING_GUI}" \
  -no-browser \
  -no-restart \
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
