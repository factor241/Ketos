#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
RUNTIME_ROOT="${REPOSITORY_ROOT}/src/copilot-runtime"
FRONTEND_ROOT="${REPOSITORY_ROOT}/src/frontend"
READY_TIMEOUT_SECONDS="${KETOS_MVP_READY_TIMEOUT_SECONDS:-120}"

BACKEND_PID=""
RUNTIME_PID=""
FRONTEND_PID=""
RUN_ROOT=""
BACKEND_DB=""
BINDING_DB=""
CHECKPOINT_DB=""
BACKEND_LOG=""
RUNTIME_LOG=""
FRONTEND_LOG=""

is_numeric_pid() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

stop_known_pid() {
  local label="$1"
  local pid="$2"
  local deadline

  if ! is_numeric_pid "$pid"; then
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid" 2>/dev/null || true
    return 0
  fi

  echo "Stopping ${label} (known PID ${pid})"
  kill -TERM "$pid"
  deadline=$((SECONDS + 10))
  while kill -0 "$pid" 2>/dev/null && ((SECONDS < deadline)); do
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid"
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  stop_known_pid "frontend" "$FRONTEND_PID"
  stop_known_pid "Copilot runtime" "$RUNTIME_PID"
  stop_known_pid "backend" "$BACKEND_PID"

  if [[ -n "$RUN_ROOT" ]]; then
    if ((status == 0)) && [[ "${KETOS_MVP_KEEP_TEMP:-0}" != "1" ]]; then
      # The actor/run binding DB is durable authorization authority. This
      # harness never deletes it or recursively deletes its parent directory.
      rm -f -- "$CHECKPOINT_DB" "$BACKEND_DB" "$BACKEND_LOG" "$RUNTIME_LOG" "$FRONTEND_LOG"
      rmdir -- "${RUN_ROOT}/checkpoint" "${RUN_ROOT}/backend" "${RUN_ROOT}/logs" 2>/dev/null || true
      if [[ -e "$BINDING_DB" ]]; then
        echo "Binding authority retained at ${BINDING_DB}"
      else
        rmdir -- "${RUN_ROOT}/binding" "$RUN_ROOT" 2>/dev/null || true
      fi
      if [[ -d "$RUN_ROOT" ]]; then
        echo "Named backend runtime artifacts retained at ${RUN_ROOT}"
      fi
    else
      echo "Stage-01 diagnostic artifacts retained at ${RUN_ROOT}" >&2
    fi
  fi

  return "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 2
  fi
}

assert_port_free() {
  local port="$1"
  local owner
  owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$owner" ]]; then
    echo "Port ${port} is already occupied; refusing to terminate its owner." >&2
    echo "$owner" >&2
    exit 2
  fi
}

wait_for_ready() {
  local label="$1"
  local url="$2"
  local pid="$3"
  local log_path="$4"
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS))

  while ((SECONDS < deadline)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "${label} exited before readiness." >&2
      tail -n 80 "$log_path" >&2 || true
      return 1
    fi
    if curl --fail --max-time 2 --silent --show-error "$url" >/dev/null 2>&1; then
      echo "${label} ready: ${url}"
      return 0
    fi
    sleep 0.25
  done

  echo "${label} readiness deadline exceeded: ${url}" >&2
  tail -n 80 "$log_path" >&2 || true
  return 1
}

assert_loopback_listener() {
  local port="$1"
  local listeners
  listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$listeners" ]] || ! grep -Fq "127.0.0.1:${port} (LISTEN)" <<<"$listeners"; then
    echo "Port ${port} is not bound to the required IPv4 loopback address." >&2
    echo "$listeners" >&2
    return 1
  fi
  if grep -Eq "(\*|\[::\]):${port} \(LISTEN\)" <<<"$listeners"; then
    echo "Port ${port} is exposed beyond IPv4 loopback." >&2
    echo "$listeners" >&2
    return 1
  fi
}

http_status() {
  curl --max-time 5 --silent --output /dev/null --write-out "%{http_code}" "$@"
}

for command_name in uv node npm curl lsof mktemp; do
  require_command "$command_name"
done
if [[ ! "$READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "KETOS_MVP_READY_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi
for port in 7860 8788 3000; do
  assert_port_free "$port"
done
for executable in "${RUNTIME_ROOT}/node_modules/.bin/tsc" "${FRONTEND_ROOT}/node_modules/.bin/vite"; do
  if [[ ! -x "$executable" ]]; then
    echo "Missing local dependency executable: ${executable}; run the runbook install commands." >&2
    exit 2
  fi
done

RUN_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ketos-stage01-chat.XXXXXX")"
install -d -m 0700 "${RUN_ROOT}/backend" "${RUN_ROOT}/binding" "${RUN_ROOT}/checkpoint" "${RUN_ROOT}/logs"
BACKEND_DB="${RUN_ROOT}/backend/ketos.sqlite3"
BINDING_DB="${RUN_ROOT}/binding/actor-run-binding.sqlite3"
CHECKPOINT_DB="${RUN_ROOT}/checkpoint/langgraph-checkpoints.sqlite3"
BACKEND_LOG="${RUN_ROOT}/logs/backend.log"
RUNTIME_LOG="${RUN_ROOT}/logs/runtime.log"
FRONTEND_LOG="${RUN_ROOT}/logs/frontend.log"

echo "Building current Copilot runtime TypeScript"
(cd "$RUNTIME_ROOT" && npm run build)

(
  cd "$REPOSITORY_ROOT"
  exec env \
    KETOS_DATABASE_URL="sqlite:///${BACKEND_DB}" \
    KETOS_CONFIG_DIR="${RUN_ROOT}/backend" \
    KETOS_DATA_DIR="${RUN_ROOT}/backend" \
    KETOS_TEMP_DIR="${RUN_ROOT}/backend" \
    KETOS_AG_UI_BINDING_DB="$BINDING_DB" \
    KETOS_AG_UI_CHECKPOINT_DB="$CHECKPOINT_DB" \
    KETOS_AUTO_LOGIN=true \
    KETOS_DEACTIVATE_TRACING=true \
    KETOS_FEATURE_MVP_WORKSPACE=true \
    KETOS_FEATURE_MVP_CHAT=true \
    KETOS_LOG_LEVEL=ERROR \
    LANGGRAPH_STRICT_MSGPACK=true \
    DO_NOT_TRACK=true \
    uv run uvicorn --factory ketos.main:create_app --host 127.0.0.1 --port 7860 \
      --loop asyncio --log-level error --no-access-log
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

(
  cd "$RUNTIME_ROOT"
  exec node --enable-source-maps dist/server.js
) >"$RUNTIME_LOG" 2>&1 &
RUNTIME_PID=$!

(
  cd "$FRONTEND_ROOT"
  exec env VITE_PROXY_TARGET=http://127.0.0.1:7860 \
    ./node_modules/.bin/vite --host 127.0.0.1 --port 3000 --strictPort
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

wait_for_ready "FastAPI backend" "http://127.0.0.1:7860/health" "$BACKEND_PID" "$BACKEND_LOG"
wait_for_ready "Copilot runtime" "http://127.0.0.1:8788/api/copilotkit/info" "$RUNTIME_PID" "$RUNTIME_LOG"
wait_for_ready "Vite frontend" "http://127.0.0.1:3000" "$FRONTEND_PID" "$FRONTEND_LOG"

for port in 7860 8788 3000; do
  assert_loopback_listener "$port"
done

direct_copilot_status="$(http_status "http://127.0.0.1:7860/api/copilotkit")"
if [[ "$direct_copilot_status" != "404" ]]; then
  echo "FastAPI must not own /api/copilotkit; got HTTP ${direct_copilot_status}." >&2
  exit 1
fi

proxied_runtime_status="$(http_status "http://127.0.0.1:3000/api/copilotkit/info")"
if [[ "$proxied_runtime_status" != "200" ]]; then
  echo "Frontend /api/copilotkit did not reach the Node runtime; got HTTP ${proxied_runtime_status}." >&2
  exit 1
fi

# A10 owns mounting the AG-UI registrar and proving flag-gated route behavior.
# A09 only verifies that this fixed upstream path reaches FastAPI (never Node).
ag_ui_status="$(http_status -X POST -H "content-type: application/json" --data '{}' \
  "http://127.0.0.1:7860/api/v1/agentic/ag-ui")"
case "$ag_ui_status" in
  400|401|403|404|405|422) ;;
  *)
    echo "FastAPI AG-UI path returned unexpected HTTP ${ag_ui_status}." >&2
    exit 1
    ;;
esac

for pid in "$BACKEND_PID" "$RUNTIME_PID" "$FRONTEND_PID"; do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "A known child exited during smoke verification: PID ${pid}." >&2
    exit 1
  fi
done

echo "Stage-01 three-process transport smoke passed."
