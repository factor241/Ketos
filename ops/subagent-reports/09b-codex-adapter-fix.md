# Agent 9b — Codex adapter confinement fix

Date: 2026-07-17  
Workspace: `/Volumes/Projects/ketos_canvas_mod_main`  
Scope: nested `raytsystem` Codex adapter, focused execution tests, live disposable canaries  
Overall result: **PASS WITH ONE BLOCKED PROBE**

## Outcome

The confirmed host-state leak from fresh Codex runs is fixed without enabling
the runtime:

- every approved fresh Codex command now includes `--ephemeral`;
- the complete fixed argv validator requires `--ephemeral`;
- provider-session resume fails closed with `InvalidRuntimeRequest` because an
  ephemeral run cannot safely persist the provider session;
- Codex no longer advertises the unsupported `resume` capability;
- usage parsing accepts current `cached_input_tokens` and legacy
  `cached_tokens`;
- fixed argv, no-shell execution, managed cwd and sandbox selection remain
  unchanged apart from the mandatory ephemeral flag.

No project runtime flag, adapter state or employee assignment was enabled or
changed.

## Root cause

The pre-fix command grammar allowed only:

```text
codex exec --json --sandbox ... -
codex exec --json --sandbox ... resume <session> -
```

Fresh runs therefore wrote a rollout file below `~/.codex/sessions`. The CLI
already supports `--ephemeral`, but RaytSystem rejected it. Resume depends on
that persisted provider state and cannot satisfy the same confinement
boundary, so resume is now rejected before executable invocation.

The usage parser also treated `cached_tokens` as the only cache field. Codex
CLI `0.144.5` emits `cached_input_tokens`; the parser now prefers that current
field and falls back to the legacy field.

## TDD evidence

RED was observed before source changes:

```text
2 failed, 12 deselected
```

The failures showed that fresh argv lacked `--ephemeral` and resume did not
raise. A separate parser RED showed:

```text
expected cached_tokens == 42, observed 2
```

After the minimal implementation, the focused adapter/service suite passed:

```text
20 passed in 1.45s
```

## Regression gates

Command:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main/raytsystem
uv run pytest -q \
  tests/test_execution_config.py \
  tests/test_execution_policy.py \
  tests/test_execution_adapters.py \
  tests/test_execution_workspace.py \
  tests/test_execution_service.py \
  tests/test_execution_sessions.py \
  tests/test_execution_leases.py \
  tests/test_execution_store.py \
  tests/test_m3_agent_policy.py \
  tests/test_platform_policy_simulator.py
```

Result:

```text
70 passed in 10.03s
```

Ruff command:

```bash
uv run ruff check \
  src/raytsystem/execution/adapters.py \
  src/raytsystem/execution/service.py \
  tests/test_execution_adapters.py \
  tests/test_execution_service.py
```

Result: **PASS — All checks passed**.

## Live adapter canary

The successful canary used a disposable initialized Git repository and the
real `CodexLocalAdapter`. Exact safety-relevant argv:

```text
/Applications/ChatGPT.app/Contents/Resources/codex
exec
--json
--ephemeral
--sandbox read-only
-C <disposable-managed-workspace>
--ignore-user-config
-c shell_environment_policy.inherit=none
-
```

Observed:

| Gate | Status | Evidence |
|---|---|---|
| Real Codex execution | PASS | exit `0`, termination `completed` |
| Managed read | PASS | exact canary token observed |
| Provider thread parsing | PASS | `019f6c24-23d8-70a2-91f4-4f982cf900f1` |
| Current cache parsing | PASS | non-zero `cached_input_tokens` recorded as `cached_tokens` |
| Session persistence | PASS | no matching file below `~/.codex/sessions` |
| Runtime/config enablement | PASS | no flags or adapter states changed |

A second read-only sandbox canary emitted thread
`019f6c25-118e-72c1-a9c2-9867520a2c6a`; it also had no matching persisted
session file. A fresh post-process scan confirmed neither thread ID exists
below `~/.codex/sessions`. No user-global session file was deleted.

The first diagnostic attempt exited before model invocation because its
disposable directory was not a Git repository:

```text
Not inside a trusted directory and --skip-git-repo-check was not specified.
```

The actual canaries initialized disposable Git repositories; the production
allowlist was not weakened with `--skip-git-repo-check`.

## Remaining blocker

**BLOCKED — direct operating-system write-denial observation.**

The second canary explicitly requested one `touch` inside the disposable
read-only workspace. Codex produced no `command_execution` event and the
target remained absent. This proves no write occurred, but it does not prove
that the OS sandbox denied an actually spawned write process. The original
probe blocker therefore remains honest `BLOCKED`, not `PASS`.

This blocker does not invalidate the fixed ephemeral confinement result, but
the parent acceptance gate should decide whether an observed OS-level denial
is mandatory before enabling the adapter.

## Files changed

- `raytsystem/src/raytsystem/execution/adapters.py`
- `raytsystem/src/raytsystem/execution/service.py`
- `raytsystem/tests/test_execution_adapters.py`
- `raytsystem/tests/test_execution_service.py`
- `ops/subagent-reports/09b-codex-adapter-fix.md`

