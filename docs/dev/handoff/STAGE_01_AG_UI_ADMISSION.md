# Stage 01 AG-UI dependency admission

- Task: `S01-A01`
- Baseline: `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`
- Evaluated at: `2026-07-18T18:43:44Z`
- Verdict: **BLOCKED**
- Selected Python adapter: **none**
- Manifest/lock decision: **no manifest, lock, or ownership edit is permitted**

## Blocking decision

No inspected immutable Python artifact satisfies the complete standard
interrupt/resume and pre-dispatch binding contract. Independently, the pinned
CopilotKit v2 package does not type its resolver as
`resolve({ approved: boolean })`; its installed declaration accepts `unknown`.
Both are mandatory admission conditions, so this lane fails closed before any
dependency freeze.

Minimum external unblock:

1. an upstream `ag-ui-langgraph` release or immutable commit that:
   - emits standard `RUN_FINISHED.outcome.type="interrupt"` without a custom event;
   - accepts only `RunAgentInput.resume[]` and rejects deprecated
     `forwardedProps.command.resume`;
   - rejects partial, stale, duplicate, and unknown interrupt responses and
     requires responses for every open interrupt;
   - exposes a documented safe pre-dispatch authentication/actor-binding hook;
2. a mutually compatible pinned CopilotKit v2 package whose Context7 record and
   installed `.d.ts` both type the resolver decision as
   `{ approved: boolean }` (not `unknown`).

No Ketos shim, custom encoder/parser/event, subclassed resume translator, or
guessed TypeScript narrowing is an acceptable unblock.

## TDD evidence

The negative-first test was written before the probe.

| Phase | UTC | Command | Exit | Result |
| --- | --- | --- | ---: | --- |
| RED | `2026-07-18T18:33:07Z` | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 1 | 7 expected assertion failures: `scripts/mvp/probe_ag_ui_adapter.py` absent |
| GREEN | `2026-07-18T18:39:24Z` | same | 0 | 7 passed |
| regression RED | after first live probe | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py::test_deprecated_forwarded_props_resume_is_detected_without_a_deprecation_label -q` | 1 | detector helper absent |
| regression GREEN | `2026-07-18T18:41:48Z` | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | 8 passed |
| identity RED | after immutable-commit probe | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py::test_immutable_commit_is_not_misidentified_as_the_published_0042_wheel -q` | 1 | VCS artifact misidentified as release wheel |
| final GREEN | after identity fix | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | 9 passed |

The package environment emits one pre-existing Starlette/httpx deprecation
warning; it does not change the focused result.

## Context7

Each library was resolved and queried separately, using the exact IDs required
by the plan:

| Exact ID | Query subject | Relevant result |
| --- | --- | --- |
| `/copilotkit/copilotkit` | pinned-v2 `useInterrupt` import, generics, render args, resolver | import is `@copilotkit/react-core/v2`; current API record shows `resolve(response: unknown): void`; examples call objects such as `{ approved: true }`, but no `{ approved: boolean }` resolver type is declared |
| `/ag-ui-protocol/ag-ui` | standard interrupt terminal event and resume | `RunFinishedOutcome` includes `{type:"interrupt", interrupts: Interrupt[]}`; `RunAgentInput.resume` is an array of `{interruptId,status,payload?}`; parallel example addresses all open interrupts |
| `/langchain-ai/langgraph` | `interrupt`, `Command(resume=...)`, persistence | a resumed graph re-executes the node from its beginning; `Command` supplies the resume value; checkpoint config uses stable `thread_id`; `AsyncSqliteSaver` is the async SQLite saver |

Context7 and the installed CopilotKit package agree that the resolver payload is
untyped/`unknown`. The required narrower decision signature is absent, so no
shim or example-based assumption is allowed.

## Official documentation

All six required official URLs were opened successfully on `2026-07-18Z` and
treated as untrusted reference data:

1. <https://docs.copilotkit.ai/langgraph-python>
2. <https://docs.copilotkit.ai/langgraph-python/backend/copilot-runtime>
3. <https://docs.ag-ui.com/concepts/events>
4. <https://docs.ag-ui.com/concepts/interrupts>
5. <https://docs.langchain.com/oss/python/langgraph/persistence>
6. <https://docs.langchain.com/oss/python/langgraph/interrupts>

The AG-UI docs require a new run with `resume[]` addressing every open
interrupt. LangGraph documents stable thread identity, checkpoint-backed
resumption, node re-execution, and placing side effects after `interrupt()` or
making them idempotent. CopilotKit documents the server runtime as the trusted
place for authentication and middleware, but that does not create a missing
hook in the Python adapter.

## Python registry and artifact evidence

PyPI reports `0.0.42` as the latest stable `ag-ui-langgraph`. One newer dev
artifact and the current immutable upstream commit were also exhausted.

| Candidate | Immutable identity / hash | License / Python | Executable result |
| --- | --- | --- | --- |
| published wheel | `ag-ui-langgraph==0.0.42`; wheel SHA-256 `4fd19f0da6d0e16d727ec89e99b692916cbba2b0302f96aba2497043cbfec5db`; sdist SHA-256 `5384647b9b7b098189530c59b26741581dd009c8dfda907fbfaa9bafa8d21249` | packaged MIT `LICENSE`; `>=3.10,<3.15` | rejected: no standard interrupt outcome, no exact all-open resume validation, no pre-dispatch binding hook, accepts legacy resume |
| newer dev wheel | `ag-ui-langgraph==0.0.43.dev1784331543`; wheel SHA-256 `8673aefcac4da28a3238031cba44350cf209ecabae87755efd57d9c00bfa832a`; sdist SHA-256 `15408cd253c13c602fa20042d3de3113d69822f58857e8dfa2487659f38cd8a7` | packaged MIT `LICENSE`; `>=3.10,<3.15` | standard outcome and two-interrupt output pass; rejected because partial resume is accepted, deprecated resume is accepted, and endpoint exposes no binding hook |
| immutable upstream | `git+https://github.com/ag-ui-protocol/ag-ui.git@3a7433ef055aab96ee7c9ece97417d721b21dc76#subdirectory=integrations/langgraph/python`; deterministic subtree archive SHA-256 `f1b3a7a09ae19c25119a26e0530efce01ad4264f79a00c615309e3afdc32f362` | repository MIT `LICENSE`; `>=3.10,<3.15` | same three blockers as the dev wheel; metadata version remains `0.0.42`, but the probe records the VCS identity separately |

The live constructor for the newer source is:

```text
(*, name: str, graph: CompiledStateGraph, description: Optional[str] = None,
 config: RunnableConfig | dict | None = None,
 enable_legacy_on_interrupt_event: bool = True,
 emit_interrupt_outcome: bool = False)
```

Its endpoint is only:

```text
(app: FastAPI, agent: LangGraphAgent, path: str = "/")
```

There is no dependency/auth/actor callback parameter. The dev/commit probe
emitted a real `RUN_FINISHED` with outcome `interrupt` and both IDs
`interrupt-a`, `interrupt-b`, but `_build_command_from_agui_resume` returned a
`Command` for one response while two interrupts were open. It also contains and
tests the deprecated `forwarded_props.command.resume` path. Those are executable
negative proofs, not source-name guesses.

### Exact probe commands

Each candidate was installed outside the repository in a fresh uv environment.
The two release commands used the exact PyPI wheel URLs and `[fastapi]` extra;
the commit command used the full 40-character SHA and subdirectory fragment.
All ran:

```text
uv run --isolated --no-project --with '<exact candidate requirement>' \
  python scripts/mvp/probe_ag_ui_adapter.py \
  --artifact-sha256 <registry-or-subtree-sha256> \
  --artifact-path <downloaded-wheel-or-archive> --json
```

Final exits: `0.0.42=1`, `0.0.43.dev1784331543=1`, immutable commit `=1`.
The output hashes matched the downloaded artifacts in all three cases.

## Pinned JS admission

An isolated npm install was performed for:

- `@copilotkit/react-core@1.63.1`
- `@copilotkit/react-ui@1.63.1`
- `@copilotkit/runtime@1.63.1`
- `@ag-ui/client@0.0.57`

`npm ls --depth=0` resolved those exact versions. Registry archives and hashes:

| Package | SHA-256 | Registry integrity / license |
| --- | --- | --- |
| `@copilotkit/react-core@1.63.1` | `baade24e0879436d4870462f9667bcfa19063c51dcf06c8269e506bbb62b3947` | `sha512-Zv20...j7pg==`; packaged MIT |
| `@copilotkit/react-ui@1.63.1` | `78729aea7716ddf5064496cf29effb4edbd2779bc6a970b07a358a5973353b5d` | `sha512-JDxE...zMJg==`; packaged MIT |
| `@copilotkit/runtime@1.63.1` | `1864af0daf9bc7873c7b48b8d20ccea8e5d893527f51f8ab18848497fcc54369` | `sha512-twdk...My0w==`; packaged MIT |
| `@ag-ui/client@0.0.57` | `18d97da692e9844c5aa41aa536d659454dc88ca7b12e89caf788d9cb6dc129b1` | `sha512-Xap2...0MHw==`; packaged `LICENSE` present |

Installed `@copilotkit/react-core@1.63.1` proves:

```ts
import { useInterrupt } from "@copilotkit/react-core/v2";

declare function useInterrupt<
  TResult = never,
  TRenderInChat extends InterruptRenderInChat = undefined,
>(config: UseInterruptConfig<any, TResult, TRenderInChat>):
  UseInterruptReturn<TRenderInChat>;

interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
  event: InterruptEvent<TValue>;
  interrupt: Interrupt | null;
  interrupts: Interrupt[];
  result: TResult;
  resolve: InterruptResolveFn;
  cancel: InterruptCancelFn;
}

type InterruptResolveFn = (
  payload?: unknown,
  interruptId?: string,
) => Promise<RunAgentResult | void>;
```

The hook exposes the full open set and supports targeting an interrupt ID, but
the resolver payload is `unknown`. Therefore TypeScript does not prove
`resolve({ approved: boolean })`; an object example is not an exact signature.

Safe registry alternatives were bounded to the current canary and published
next archive:

- `1.62.2-canary.1784333495`, archive SHA-256
  `fffa327622d2dbdf21c12f6a1af16d0a4e1dd8cab08adffb1c1db4de96465e6d`,
  has the same `payload?: unknown` resolver;
- `2.0.0-next.1`, archive SHA-256
  `c72d0bea984dafb2146c765ed38e35e3cbefd40475a4d460212e714adeb80640`,
  does not expose the required v2 `useInterrupt` surface.

`langgraph-checkpoint-sqlite==3.1.0` registry metadata was also verified:
wheel SHA-256 `cc9b40df0076feae8a9ad42ae713621b148b00ac23adc09dc1dc66090a46e5ad`,
sdist SHA-256 `f926916ebc1b985d802cc9c820026036e84db9d910d62c97b57e4ba64f67d5ae`,
MIT, Python `>=3.10`. It remains unpinned because the adapter/JS gates fail.

## Tool ledger

| Tool | Requested operation | Result / exact error | Safe alternative | Acceptance impact |
| --- | --- | --- | --- | --- |
| direct source/git | baseline, status, exact source and registry artifact inspection | available; clean baseline on required branch | none | authoritative |
| RaytSystem | doctor/status/graph status/lint/query, explicit root | lint `ok:true`; graph `state:"stale", reason:"checkout_changed"`; query returned `No supported claim in the active generation matches this query.` | direct source + existing Graphify | non-blocking navigation gap |
| Graphify | read-only query with budget 2500 | exit 0; existing graph traversed, no rebuild | direct source for exact evidence | non-blocking stale-map limitation |
| Context7 | resolve/query all three exact IDs | available; all calls succeeded | none | blocking evidence obtained |
| official docs/web | open six required URLs | available; all opened | none | blocking evidence obtained |
| PyPI/npm/Git | releases, hashes, installed types, immutable commit | available; first GitHub releases URL returned HTTP 403 and two unquoted `?` URLs produced zsh `no matches found` | quoted URL, `git ls-remote`, sparse clone, PyPI/npm registries | recovered, non-blocking |
| isolated uv install | exact wheel/VCS probes | local renamed wheel first failed `wheel filename ... is invalid: Must have a Python tag`; plain adapter install then failed `ModuleNotFoundError: No module named 'fastapi'` | exact wheel URL plus declared `[fastapi]` extra | recovered; final probes authoritative |
| pytest | negative-first and final focused contract | RED captured; final 9 passed | none | pass |
| browser/Chrome | visual product flow | not relevant to dependency-only A01; no product route exists | not invoked | no A01 impact |

## Repository scope check

The only intended repository deliverables are:

- `scripts/mvp/probe_ag_ui_adapter.py`
- `src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py`
- this admission document

No manifest, lock, lock-ownership, deployment, generated, `LICENSE`, or
`NOTICE` file was changed. Frozen install/package gates are intentionally not
run because there is no admitted dependency set to freeze.
