# Unified Board Workspace — Block A status

| Field | Value |
| --- | --- |
| Date | `2026-07-25` |
| Candidate SHA | `ef9bfaf9254d8f19b16336efcdef9e67d7ab720a` |
| Scope | Block A, Tasks A1–A3 only |
| Technical status | `EXACT-SHA PASS` |
| Next block | `NOT STARTED` |

## Delivered

- One declarative product version family and a fail-closed check/bump tool.
- Exact version-owned path validation in `make patch`; raw `python -c`
  mutation and the numeric changed-file heuristic are removed.
- Workspace and chat default on, with independent explicit `false` kill
  switches retained.
- One current-experience profile for backend, frontend, and copilot runtime.
- Read-only preflight of the effective environment, version family, sole
  Alembic head/current database revision, required artifact, and ports.
- One process supervisor with readiness checks and bounded process-group
  cleanup.
- Runtime proof of health, version, public feature flags, frontend HTTP, and
  copilot TCP readiness.

## Evidence

- `uv run pytest scripts/ci/test_version_contract.py
  scripts/ci/test_current_experience.py -q -o log_cli=false --tb=short`:
  `33 passed`.
- Final post-audit combined run, including the bundle pin planner:
  `54 passed, 1 warning`.
- `LANGGRAPH_STRICT_MSGPACK=true uv run pytest
  src/backend/tests/unit/api/v1/test_endpoints.py
  src/backend/tests/unit/api/utils/mcp/test_agentic_mcp.py -q`:
  `37 passed, 1 warning`.
- Isolated `src/kfx` feature-flag suite: `15 passed`.
- Focused Ruff and format checks: PASS.
- `make version-check`: PASS for product/KFX/frontend `1.10.2`, backend
  `0.10.2`, copilot runtime `0.0.0-private`, and both dependency pins.
- `make current-preflight`: PASS with Alembic head/current
  `s08c0mmand01` and all three ports initially free.
- Live `make run-current`: PASS for services on `7860`, `3000`, and `8788`.
- Concurrent `make current-proof`: PASS for version `1.10.2`,
  workspace/chat/agentic `true`, and strict msgpack `true`.
- Supervisor shutdown: expected exit `130`; all three ports were free
  afterward.
- Independent A1/A3 review: initial A1 findings about a diff-derived bundle
  expectation and untracked side effects were fixed; repeat A1 and A3 verdicts
  were `PASS`.
- Chrome read-only check: Boards opened as the default current workspace;
  no console errors and no product data creation.

## Exact-SHA boundary

The user authorized a candidate commit and continuation. The initial candidate
`fa7bda46cee841ba13b240cfeb974b53b63c4f35` exposed a real cold-start timeout:
the backend completed startup just after the configured 120-second deadline.
The supervisor failed closed with exit `21` and cleaned up all children.

A RED regression was added, the backend startup budget was raised to 180
seconds, and the correction was committed as
`ef9bfaf9254d8f19b16336efcdef9e67d7ab720a`. On that exact SHA:

- `54`, `37`, and `15` test groups passed;
- version and Alembic preflight passed;
- live `run-current` and second-terminal `current-proof` passed;
- the proof printed the exact candidate SHA;
- Ctrl+C returned the expected `130` and released all three ports;
- Git status returned to the sole pre-existing user-owned `outputs/`.

This is the Block A technical PASS that admits Block B. Predecessor stages
remain accepted for transition under the separate user decision and do not
re-enter admission.

The pre-existing untracked `outputs/` content was not changed. No raw
historical evidence was edited.
