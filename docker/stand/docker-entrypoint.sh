#!/bin/sh
# Start Syncthing beside one Ketos Web instance inside the stand container.
set -eu

: "${DSH_HOME:=/data/ketos}"
: "${KETOS_PORT:=3080}"
: "${KETOS_SYNCTHING_GUI:=8384}"
export DSH_HOME KETOS_PORT

mkdir -p "$DSH_HOME" /data/syncthing /workspace/shared

# Syncthing does not synchronize `.stignore`, so each side seeds its own copy
# of the shared folder's ignore file; an existing file is left as it is.
node /usr/local/share/ketos-stand/ensure-stignore.mjs /workspace/shared

# Generate the key and stock config on an empty Syncthing volume, then pin the
# config to the team's private relay on EVERY start before Syncthing runs: a
# failed first start can no longer leave a stock config.xml (public discovery
# and relays) behind. A failed bootstrap stops the container (set -e) without
# starting Syncthing.
if [ ! -f /data/syncthing/config.xml ]; then
  syncthing generate --home=/data/syncthing
fi
node /usr/local/share/ketos-stand/syncthing-bootstrap.mjs

# Syncthing logs its relay URL with `token=` to stdout; the wrapper redacts the
# token before the line reaches the log file and execs Syncthing, so
# SYNCTHING_PID stays Syncthing's own process ID.
sh /usr/local/share/ketos-stand/run-with-redacted-log.sh /data/syncthing/syncthing.log \
  syncthing serve \
  --home=/data/syncthing \
  --gui-address "0.0.0.0:${KETOS_SYNCTHING_GUI}" \
  --no-browser \
  --no-restart &
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
