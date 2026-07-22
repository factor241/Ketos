#!/usr/bin/env bash
set -eu -o pipefail

: "${S09_RUN_DIR:?S09_RUN_DIR is required}"
if [[ -z "${MVP_POSTGRES_URI:-}" ]]; then
  printf 'BLOCKED: MVP_POSTGRES_URI is required for the Stage 09 backend package\n' >&2
  exit 2
fi
if [[ -n "${KETOS_TEST_DATABASE_URI:-}" && "$KETOS_TEST_DATABASE_URI" != "$MVP_POSTGRES_URI" ]]; then
  printf 'BLOCKED: KETOS_TEST_DATABASE_URI conflicts with MVP_POSTGRES_URI\n' >&2
  exit 2
fi
export MVP_POSTGRES_URI
export KETOS_TEST_DATABASE_URI="$MVP_POSTGRES_URI"

shards=(
  agentic alembic base brand_state components core custom events exceptions
  graph groq helpers initial_setup inputs interface io schema scripts
  serialization services utils
)

cleanup_success_root() {
  local target_root=$1
  case "$target_root" in
    /private/tmp/ketos-stage09-backend-?*) ;;
    *) printf 'refusing unexpected temp cleanup path: %s\n' "$target_root" >&2; return 64 ;;
  esac
  test "$(dirname -- "$target_root")" = /private/tmp \
    && test -d "$target_root" \
    && test ! -L "$target_root" || {
      printf 'refusing unsafe temp cleanup target: %s\n' "$target_root" >&2
      return 65
    }
  rm -rf -- "$target_root"
}

run_target() {
  local target=$1
  local label=$2
  local target_root target_log target_status
  index=$((index + 1))
  target_root=$(mktemp -d "/private/tmp/ketos-stage09-backend-${label}.XXXXXX")
  mkdir -p "$target_root/tmp" "$target_root/xdg-cache" \
    "$target_root/xdg-config" "$target_root/xdg-data" \
    "$target_root/xdg-state" "$target_root/pycache"
  target_log="$target_root/raw.log"
  printf '\n===== Stage 09 backend target %03d: %s =====\n' "$index" "$target"
  if TMPDIR="$target_root/tmp" \
    XDG_CACHE_HOME="$target_root/xdg-cache" \
    XDG_CONFIG_HOME="$target_root/xdg-config" \
    XDG_DATA_HOME="$target_root/xdg-data" \
    XDG_STATE_HOME="$target_root/xdg-state" \
    PYTHONPYCACHEPREFIX="$target_root/pycache" \
    PYTHONDONTWRITEBYTECODE=1 \
      uv run pytest "$target" \
        --instafail -ra -m "not api_key_required" -q -p no:cacheprovider \
        --basetemp="$target_root/pytest" >"$target_log" 2>&1; then
    target_status=0
  else
    target_status=$?
  fi
  cat "$target_log"
  if ((target_status == 5)) && tail -n 1 "$target_log" \
    | grep -Eq '^=+ [0-9]+ deselected(, [0-9]+ warnings?)? in [0-9]+(\.[0-9]+)?s =+$'; then
    printf 'STAGE09_DESELECTED_ONLY target=%s\n' "$target"
    target_status=0
  fi
  if ((target_status != 0)); then
    printf 'STAGE09_BACKEND_TARGET_FAILED status=%d target=%s temp=%s\n' \
      "$target_status" "$target" "$target_root" >&2
    return "$target_status"
  fi
  cleanup_success_root "$target_root"
}

index=0
for shard in "${shards[@]}"; do
  run_target "src/backend/tests/unit/$shard" "$shard"
done

if ! api_listing=$(find src/backend/tests/unit/api -type f -name 'test_*.py' -print | LC_ALL=C sort); then
  printf 'API backend test discovery failed\n' >&2
  exit 66
fi
test -n "$api_listing" || { printf 'API backend test selection is empty\n' >&2; exit 67; }
api_tests=()
while IFS= read -r api_test; do
  api_tests+=("$api_test")
done <<< "$api_listing"
for api_test in "${api_tests[@]}"; do
  api_name=${api_test#src/backend/tests/unit/api/}
  api_name=${api_name%.py}
  api_name=${api_name//\//-}
  run_target "$api_test" "api-$api_name"
done

shopt -s nullglob
root_tests=(src/backend/tests/unit/test_*.py)
((${#root_tests[@]} > 0)) || { printf 'root backend test glob is empty\n' >&2; exit 68; }
for root_test in "${root_tests[@]}"; do
  root_name=${root_test##*/}
  root_name=${root_name%.py}
  run_target "$root_test" "root-$root_name"
done

printf '\nSTAGE09_BACKEND_PACKAGE_TARGETS=%d\n' "$index"
