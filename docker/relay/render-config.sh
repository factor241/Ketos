#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${IROH_RELAY_HOST:?Variable IROH_RELAY_HOST must be set}"
: "${ACME_CONTACT:?Variable ACME_CONTACT must be set}"

if command -v envsubst >/dev/null 2>&1; then
  envsubst '${IROH_RELAY_HOST} ${ACME_CONTACT}' < iroh-relay.toml.template > iroh-relay.toml
else
  sed -e "s|\${IROH_RELAY_HOST}|${IROH_RELAY_HOST}|g" \
      -e "s|\${ACME_CONTACT}|${ACME_CONTACT}|g" \
      iroh-relay.toml.template > iroh-relay.toml
fi

echo "Generated iroh-relay.toml for host ${IROH_RELAY_HOST}"
