#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXAMPLE_PAGE="docs/docs/api/run-flow.mdx"
HOST="${KETOS_HOST:-127.0.0.1}"
PORT="${KETOS_PORT:-7860}"
SUITES="${SUITES:-curl,python,javascript}"
EXECUTE_MODE="${EXECUTE_MODE:-true}"

extract_fence() {
  local language="$1"
  awk -v opening="\`\`\`${language}" '
    $0 == "```" && capture { exit }
    $0 == opening { capture = 1; next }
    capture { print }
  ' "$EXAMPLE_PAGE"
}

validate_suites() {
  local suite
  IFS=',' read -ra SUITE_LIST <<< "$SUITES"
  for suite in "${SUITE_LIST[@]}"; do
    suite="${suite//[[:space:]]/}"
    case "$suite" in
      curl|python|javascript) ;;
      *)
        echo "Unknown suite: '$suite'. Valid values: curl, python, javascript" >&2
        exit 2
        ;;
    esac
  done
}

check_syntax() {
  local suite
  for suite in "${SUITE_LIST[@]}"; do
    suite="${suite//[[:space:]]/}"
    case "$suite" in
      curl) extract_fence bash | bash -n ;;
      python) extract_fence python | uv run python -c 'import sys; compile(sys.stdin.read(), "run-flow.mdx", "exec")' ;;
      javascript) extract_fence javascript | node --input-type=module --check ;;
    esac
  done
}

validate_suites
check_syntax
echo "API example syntax is valid for: $SUITES"

if [[ "$EXECUTE_MODE" != "true" ]]; then
  exit 0
fi

RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ketos-api-examples.XXXXXX")"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$RUN_ROOT"
}
trap cleanup EXIT

port_is_in_use() {
  uv run python - "$HOST" "$PORT" <<'PY'
import socket
import sys

with socket.socket() as sock:
    sock.settimeout(0.25)
    sys.exit(0 if sock.connect_ex((sys.argv[1], int(sys.argv[2]))) == 0 else 1)
PY
}

if port_is_in_use; then
  PORT="$(uv run python - "$HOST" <<'PY'
import socket
import sys

with socket.socket() as sock:
    sock.bind((sys.argv[1], 0))
    print(sock.getsockname()[1])
PY
)"
fi

export KETOS_BASE_URL="http://$HOST:$PORT"
export KETOS_API_KEY="${KETOS_API_KEY:-ketos-local-docs-smoke-key}"
export KETOS_API_KEY_SOURCE=env
export KETOS_AUTO_LOGIN=true
export KETOS_SUPERUSER=ketos
export KETOS_CONFIG_DIR="$RUN_ROOT/config"
export KETOS_DATABASE_URL="sqlite:///$RUN_ROOT/ketos.db"

uv run ketos run --backend-only --host "$HOST" --port "$PORT" >"$RUN_ROOT/server.log" 2>&1 &
SERVER_PID=$!

for _ in {1..90}; do
  if curl --silent --fail "$KETOS_BASE_URL/health_check" >/dev/null; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    sed -n '1,200p' "$RUN_ROOT/server.log" >&2
    exit 1
  fi
  sleep 1
done
curl --silent --fail "$KETOS_BASE_URL/health_check" >/dev/null

export KETOS_FLOW_ID="$(uv run python - <<'PY'
import json
import os
from pathlib import Path

import httpx

payload = json.loads(Path("src/backend/tests/data/MemoryChatbotNoLLM.json").read_text())
payload.pop("id", None)
payload.pop("user_id", None)
payload["name"] = "Ketos documentation API smoke"
response = httpx.post(
    f"{os.environ['KETOS_BASE_URL']}/api/v1/flows/",
    headers={"x-api-key": os.environ["KETOS_API_KEY"]},
    json=payload,
    timeout=60,
)
response.raise_for_status()
print(response.json()["id"])
PY
)"

for suite in "${SUITE_LIST[@]}"; do
  suite="${suite//[[:space:]]/}"
  case "$suite" in
    curl)
      extract_fence bash >"$RUN_ROOT/run-flow.sh"
      bash "$RUN_ROOT/run-flow.sh" >"$RUN_ROOT/curl.json"
      ;;
    python)
      extract_fence python >"$RUN_ROOT/run_flow.py"
      uv run python "$RUN_ROOT/run_flow.py" >"$RUN_ROOT/python.json"
      ;;
    javascript)
      extract_fence javascript >"$RUN_ROOT/run-flow.mjs"
      node "$RUN_ROOT/run-flow.mjs" >"$RUN_ROOT/javascript.json"
      ;;
  esac
done

echo "Extracted run-flow API examples passed against flow $KETOS_FLOW_ID for: $SUITES"
