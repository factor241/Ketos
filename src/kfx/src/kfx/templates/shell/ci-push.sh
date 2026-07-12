#!/usr/bin/env bash
# ci-push.sh
#
# PURPOSE
#   Push (upsert) Ketos flow JSON files to a remote Ketos instance
#   using `kfx push`.  Stable flow IDs mean re-running always converges.
#
# USAGE
#   chmod +x ci-push.sh
#   export KETOS_URL=https://staging.ketos.example.com
#   export KETOS_API_KEY=<your-api-key>
#   ./ci-push.sh
#
# ENVIRONMENT VARIABLES — connection (pick one approach)
#
#   Approach A: direct URL + key (simplest)
#     KETOS_URL        URL of the target Ketos instance.
#     KETOS_API_KEY    API key for that instance.
#
#   Approach B: named environment from a TOML config
#     KETOS_ENV                 Name of the environment block.
#                                  e.g. staging  or  production
#     KETOS_ENVIRONMENTS_FILE   Path to environments TOML.
#                                  Default: ketos-environments.toml
#     <api_key_env var>            The env var named in api_key_env inside the
#                                  TOML block.  Must be exported separately.
#
#   The TOML format:
#
#     [environments.staging]
#     url         = "https://staging.ketos.example.com"
#     api_key_env  = "KETOS_STAGING_API_KEY"
#
#     [environments.production]
#     url         = "https://ketos.example.com"
#     api_key_env  = "KETOS_PROD_API_KEY"
#
# ENVIRONMENT VARIABLES — behaviour
#   FLOWS_DIR            Directory containing flow JSON files.
#                        Default: flows/
#   KETOS_PROJECT     Project (folder) name on the remote instance.
#                        Default: (no project — flows go to the default folder)
#   KETOS_PROJECT_ID  Project UUID.  Takes precedence over KETOS_PROJECT.
#   DRY_RUN              Set to "true" to show what would be pushed without
#                        making any changes.  Default: false
#   KFX_VERSION          kfx PEP 508 version specifier suffix appended directly
#                        to the package name, e.g. ">=0.4,<1" or "==1.2.3".
#                        Default: installs latest.
#
# EXIT CODES
#   0  All flows pushed (or dry-run completed) successfully
#   1  One or more flows failed to push
#
# INTEGRATIONS
#   Jenkins:          sh 'ci-push.sh'
#   CircleCI:         - run: bash ci-push.sh
#   Bitbucket:        - bash ci-push.sh
#   Azure Pipelines:  - script: bash ci-push.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────── #

FLOWS_DIR="${FLOWS_DIR:-flows/}"
KETOS_ENV="${KETOS_ENV:-}"
KETOS_ENVIRONMENTS_FILE="${KETOS_ENVIRONMENTS_FILE:-ketos-environments.toml}"
KETOS_URL="${KETOS_URL:-}"
KETOS_API_KEY="${KETOS_API_KEY:-}"
KETOS_PROJECT="${KETOS_PROJECT:-}"
KETOS_PROJECT_ID="${KETOS_PROJECT_ID:-}"
DRY_RUN="${DRY_RUN:-false}"
KFX_VERSION="${KFX_VERSION:-}"

# Normalise KFX_VERSION: if it looks like a bare version (starts with a digit),
# prepend "==" so the pip specifier is valid.
if [[ -n "${KFX_VERSION}" && "${KFX_VERSION}" =~ ^[0-9] ]]; then
  KFX_VERSION="==${KFX_VERSION}"
fi

# ── Install kfx ───────────────────────────────────────────────────────────── #

echo "==> Installing kfx${KFX_VERSION:+ ${KFX_VERSION}} ..."
pip install --quiet "kfx${KFX_VERSION}" ketos-sdk

# ── Build environments file if using Approach B ───────────────────────────── #

if [[ -n "${KETOS_ENV}" && ! -f "${KETOS_ENVIRONMENTS_FILE}" ]]; then
  ENV_UPPER="${KETOS_ENV^^}"
  ENV_UPPER="${ENV_UPPER//-/_}"
  URL_VAR="KETOS_${ENV_UPPER}_URL"
  KEY_VAR="KETOS_${ENV_UPPER}_API_KEY"

  echo "==> Writing ${KETOS_ENVIRONMENTS_FILE} for environment '${KETOS_ENV}' ..."
  printf '[environments.%s]\nurl = "%s"\napi_key_env = "%s"\n' \
    "${KETOS_ENV}" \
    "${!URL_VAR:-}" \
    "${KEY_VAR}" \
    > "${KETOS_ENVIRONMENTS_FILE}"
  export KETOS_ENVIRONMENTS_FILE
fi

# ── Build kfx push command ────────────────────────────────────────────────── #

PUSH_CMD=(kfx push --dir "${FLOWS_DIR}")

if [[ -n "${KETOS_ENV}" ]]; then
  PUSH_CMD+=(--env "${KETOS_ENV}")
elif [[ -n "${KETOS_URL}" ]]; then
  PUSH_CMD+=(--target "${KETOS_URL}")
  [[ -n "${KETOS_API_KEY}" ]] && PUSH_CMD+=(--api-key "${KETOS_API_KEY}")
else
  echo "ERROR: set KETOS_ENV (Approach B) or KETOS_URL (Approach A)" >&2
  exit 1
fi

if [[ -n "${KETOS_PROJECT_ID}" ]]; then
  PUSH_CMD+=(--project-id "${KETOS_PROJECT_ID}")
elif [[ -n "${KETOS_PROJECT}" ]]; then
  PUSH_CMD+=(--project "${KETOS_PROJECT}")
fi

[[ "${DRY_RUN}" == "true" ]] && PUSH_CMD+=(--dry-run)

# ── Push ──────────────────────────────────────────────────────────────────── #

echo "==> Pushing flows from ${FLOWS_DIR} ..."
[[ "${DRY_RUN}" == "true" ]] && echo "    (dry run — no changes will be made)"
echo "==> Running: ${PUSH_CMD[*]}"
"${PUSH_CMD[@]}"

echo "==> Done."
