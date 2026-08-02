# Stage 01 CopilotKit / AG-UI local runbook

This runbook owns only S01-A09 orchestration: default-off flags, the fixed
Vite proxy, three loopback processes, readiness, and safe shutdown. S01-A10
owns registrar/page wiring and the final proof that the MVP route is
inaccessible off and available on. A09 does not claim that route gate.

## Fixed contract

| Process | Listener | Readiness |
| --- | --- | --- |
| FastAPI | `127.0.0.1:7860` | `http://127.0.0.1:7860/health` |
| CopilotKit Runtime v2 | `127.0.0.1:8788` | `http://127.0.0.1:8788/api/copilotkit/info` |
| Vite | `127.0.0.1:3000` | `http://127.0.0.1:3000` |

Vite routes `/api/copilotkit` only to the fixed Node target
`http://127.0.0.1:8788`. The generic `/api/v1`, `/api/v2`, and health proxies
continue to use the FastAPI target. Browser query/body/storage values cannot
override either target.

`mvp_workspace` and `mvp_chat` are both default-off. Their canonical variables
are `KETOS_FEATURE_MVP_WORKSPACE` and `KETOS_FEATURE_MVP_CHAT`. The downstream
page gate must require both stored values to be literal boolean `true`; strings,
numbers, objects, missing values, and a single enabled flag remain off.

## Install and focused verification

From the repository root:

```bash
uv sync --frozen --package ketos-base --package kfx
(cd src/copilot-runtime && npm ci --ignore-scripts)
(cd src/frontend && npm ci --ignore-scripts)

KFX_TEST_ALLOW_KETOS=1 uv run pytest --import-mode=importlib \
  src/kfx/tests/unit/services/settings/test_feature_flags_brand_env.py \
  src/kfx/tests/unit/services/settings/test_brand_env_inventory.py -q
uv run pytest src/backend/tests/unit/api/v1/test_endpoints.py -q
(cd src/frontend && npm test -- --runInBand src/stores/__tests__/utilityStore.test.ts)
(cd src/frontend && npm run type-check:production)
```

KFX and backend pytest scopes are intentionally separate because their
repository conftests cannot be collected safely in one root invocation.

## Deterministic smoke

Ensure ports `7860`, `8788`, and `3000` are free, then run:

```bash
bash scripts/mvp/chat_stack_smoke.sh
```

The harness performs these actions in order:

1. Refuses to continue when any fixed port is occupied; it never terminates the
   existing owner.
2. Creates one mode-`0700` temporary root with separate backend, binding,
   checkpoint, and log directories.
3. Builds the current `src/copilot-runtime` TypeScript before starting its
   compiled Node entrypoint.
4. Starts one backend worker, one Node runtime, and Vite, all on IPv4 loopback.
5. Sets `LANGGRAPH_STRICT_MSGPACK` true and enables both MVP flags only inside
   the on-path smoke environment.
6. Polls all three readiness URLs with bounded deadlines while also checking
   that each recorded child PID remains alive.
7. Verifies FastAPI returns `404` for direct `/api/copilotkit`, the same path
   through Vite reaches Node, and the frozen AG-UI upstream path reaches
   FastAPI. Registrar and flag-gated page availability remain S01-A10 evidence.
8. Sends TERM only to each known PID, waits for it, and sends KILL only to that
   same recorded PID if its deadline expires.

Set `KETOS_MVP_READY_TIMEOUT_SECONDS` to a positive number to change the
per-process readiness deadline. Set `KETOS_MVP_KEEP_TEMP` to `1` to retain all
diagnostic files. No credential value is required or printed by this transport
smoke; authenticated browser evidence is supplied separately by S01-A10.

## Playwright orchestration

`src/frontend/playwright.mvp.config.ts` contains exactly the same three
listeners, uses `reuseExistingServer: false`, one Chromium worker, loopback
URLs, and a current-runtime build before Node starts. The final S01-A10 story is
run from `src/frontend`:

```bash
npx playwright test -c playwright.mvp.config.ts \
  tests/core/integrations/copilotkit-ag-ui-probe.spec.ts --project=chromium
```

The config places local state under `KETOS_MVP_RUN_DIR` when supplied, otherwise
under a process-specific directory in the system temporary directory.

## Binding and checkpoint lifecycle

The harness passes two separate, explicit file paths:

- `KETOS_AG_UI_BINDING_DB`: `binding/run-bindings.ledger`;
- `KETOS_AG_UI_CHECKPOINT_DB`: `checkpoint/langgraph-checkpoints.sqlite3`.

They are not interchangeable. KETOS_AG_UI_BINDING_DB points to this ledger;
the environment-variable name is retained as a compatibility surface. The
descriptor-bound append-only binding authority ledger is durable authorization
authority for actor/thread/run ownership. Automatic harness cleanup never
deletes it and never recursively deletes its parent. The checkpoint remains a
SQLite database containing runtime replay state; after the backend has stopped,
successful smoke cleanup may delete only this exact temporary checkpoint file.
The owners must create both files as regular files with mode `0600` and keep
their parent directories at mode `0700`.

For a deliberately disposable local run, stop all three known PIDs first. Then
inspect and remove the exact checkpoint file and other named runtime artifacts.
Delete the exact binding ledger only after an explicit authorization-retention
decision; never use a recursive command against a config/data root. The harness
prints the retained ledger path when it exists. Ketos may create additional
named backend runtime files under the temporary backend directory; the harness
does not guess or recursively erase them and prints the retained root. On any
failed run it retains the full temporary root and prints its location for
diagnosis.

## Manual stop and recovery

If the shell receives INT or TERM, its EXIT trap performs the same known-PID
shutdown. It does not use process-name matching. If the controlling shell is
forcibly lost, use the printed PIDs and verify each command/listener before
signaling it; do not use broad `pkill`/`killall` cleanup.

Health and logs contain no credential values. Do not place access credentials,
cookies, API keys, or secret values in this runbook, command history, screenshots,
or handoff evidence.
