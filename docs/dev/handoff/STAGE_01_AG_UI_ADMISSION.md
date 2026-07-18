# Stage 01 AG-UI dependency admission

- Task: `S01-A01`
- Baseline: `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`
- Evaluated at: `2026-07-19T05:45:00+07:00`
- Verdict: **PASS**
- Selected Python adapter: `ag-ui-langgraph==0.0.43+ketos.1`
- Selected frontend package: `@copilotkit/react-core@1.63.1-ketos.1`
- Manifest/lock decision: **exact vendored artifacts admitted and locked**
- Temporary fork evidence: **PASS**

## Temporary fork evidence

`STAGE_01_TEMPORARY_FORK_DECISION.md` narrowly permits an immutable
`factor241`-owned fork to enter the existing admission probe. It does not relax
any protocol, all-open resume, standard outcome, pre-dispatch, security,
license, type, or frozen dependency gate and does not grant PASS.

The admitted AG-UI wheel is pinned to fork commit
`85b94807e464c9b38f591938a41559923a712dbb` with SHA-256
`5ae33b1bab5a9e0adfb1425c5e279476a7ba35a385019d71be2f3ee79e8913cc`.
Its separately retained source archive has SHA-256
`afff88bf8ee2d9ffc515052b3c9924610b78cfe1d6b6df9f093845c8c5604cdb`.
The executable probe returned:

```json
{"admitted": true, "reasons": []}
```

All six normative contracts passed, including the real FastAPI dependency,
clone, three-argument hook, actor binding, and dispatch order. Provenance was
bound to the live approved remote, exact commits and ancestry, exact Git diff,
source tree, wheel bytes, runtime metadata, installed source bytes, and MIT
license. The negative `0.0.42` control remained rejected with the deprecated
resume path and missing standard gates detected.

The admitted CopilotKit archive is pinned to fork commit
`c853ac2b78cb57481cc2ca58eda4a865908c532b` with SHA-256
`64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa`
and npm integrity
`sha512-ZHIeQdU9Iy+MoFKTfm5orw2Yy0aiG0FM3JIs4c1OtxfCG70TUpmUDqzt3lPx6GJkn3lrYwbSxFnIiSCv1CdVAQ==`.
The archive audit admitted all 60 regular allowlisted members, both CJS and ESM
typed resolver declarations, exact package/license identity, and exactly one
installed runtime copy.

The separate CopilotKit source-provenance audit processed the retained Git
archive without extraction under compressed/member/member-size/total resource
ceilings. It bound all 22,732 entries (including 50 exact Git symlink records)
byte-for-byte and mode-for-mode to the fork commit, verified the live fixed
`factor241/CopilotKit` fork and official upstream base, proved ancestry and the
exact 13-file delta, and bound the package hash plus clean build/check/pack
command to the same manifest record.

The alternate CopilotKit SHA-256
`c3f93fb5eab13bd9eb4d2165a0866ede4da5e831f0a3379acd02722dbd5d8509`
used `SOURCE_DATE_EPOCH=1784431200`; because the deterministic tar metadata
includes that epoch, it is a different, noncanonical artifact. Stage 01 admits
only epoch `1784227404` and SHA-256 `64711f7e...` recorded above.

Two AG-UI builds from a clean exact-commit clone under uv `0.11.21` and Python
`3.13.14` reproduced the wheel hash. A fresh remote CopilotKit clone was
installed, type-checked, built and packed under the manifest-selected Node
`22.23.1`, Corepack pnpm `10.33.4`, and epoch `1784227404`; it reproduced SHA-256
`64711f7e...` byte-for-byte. `uv sync --frozen
--offline` installed the exact local wheel; `npm ci --offline` installed the
exact local tgz and integrity. `uv.lock` and `package-lock.json` contain the
same artifact hashes.

## Historical blocking decision (superseded by the PASS above)

At that historical checkpoint, no inspected unmodified upstream Python
artifact satisfied the complete standard interrupt/resume and pre-dispatch
binding contract. Independently, the then-pinned unmodified upstream
CopilotKit v2 package did not type its resolver as
`resolve({ approved: boolean })`; its then-installed declaration accepted
`unknown`. Both were mandatory admission conditions, so the upstream-only lane
failed closed before dependency freeze at that time. The temporary-fork PASS
at the top of this document supersedes this decision and supplies both missing
contracts.

The minimum external unblock recorded at that time was:

1. an upstream `ag-ui-langgraph` release, immutable upstream commit, or
   provenance-bound `factor241` fork admitted under the temporary decision that:
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
guessed TypeScript narrowing was or is an acceptable unblock.

## Historical upstream TDD evidence (superseded)

The negative-first test was written before the probe.

| Phase | UTC | Command | Exit | Result |
| --- | --- | --- | ---: | --- |
| RED | `2026-07-18T18:33:07Z` | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 1 | 7 expected assertion failures: `scripts/mvp/probe_ag_ui_adapter.py` absent |
| GREEN | `2026-07-18T18:39:24Z` | same | 0 | 7 passed |
| regression RED | after first live probe | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py::test_deprecated_forwarded_props_resume_is_detected_without_a_deprecation_label -q` | 1 | detector helper absent |
| regression GREEN | `2026-07-18T18:41:48Z` | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | 8 passed |
| identity RED | after immutable-commit probe | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py::test_immutable_commit_is_not_misidentified_as_the_published_0042_wheel -q` | 1 | VCS artifact misidentified as release wheel |
| initial identity GREEN | after immutable identity fix | `uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | 9 passed |
| A10 audit RED | before archive/resume/source evidence hardening | same focused file | 1 | 11 expected failures |
| A10 audit GREEN | after first audit correction | same focused file | 0 | 20 passed |
| A10 re-review binding RED | before executable dependency proof | `uv run pytest ... -q -k 'binding_gate_proves or binding_gate_rejects_documented'` | 1 | 2 expected failures |
| historical pre-fork GREEN | after the earlier executable binding correction | `PYTHONDONTWRITEBYTECODE=1 uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | historical final 22 passed |
| fork-review RED | before exact public API, Git-tree provenance, and adversarial-flow corrections | selected reviewer regression set | 1 | 16 expected failures, 1 passed |
| R1 fork-review GREEN | after exact public API and Git-tree corrections | `PYTHONDONTWRITEBYTECODE=1 uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | historical 62 passed |
| R2 fork-review RED | before source-origin and resource-bound corrections | selected R2 regression set | 1 | 6 expected failures, 2 passed |
| R2 fork-review GREEN | after source-origin and resource-bound corrections | `PYTHONDONTWRITEBYTECODE=1 uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | historical 75 passed |
| R3 fork-review RED | before upstream, registry, ZIP, and streaming-process corrections | selected R3 regression set | 1 | 11 expected failures, 1 passed |
| current R3 fork-review GREEN | after R3 corrections and exact interrupts-doc allowlist | `PYTHONDONTWRITEBYTECODE=1 uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q` | 0 | 89 passed |

The package environment emits one pre-existing Starlette/httpx deprecation
warning; it does not change the focused result.

## Historical upstream Context7 evidence (superseded)

Current re-review used the exact callable `mcp__context7__query_docs` three
times with these literal inputs:

```text
libraryId=/copilotkit/copilotkit
query=At pinned CopilotKit v2, document the exact import path, generic signature, render arguments, and resolver payload type for useInterrupt, especially whether resolve is typed as { approved: boolean } or unknown.

libraryId=/ag-ui-protocol/ag-ui
query=Document standard interrupt termination and resume contracts: RUN_FINISHED outcome type interrupt, RunAgentInput.resume array shape, and requirement to answer every open interrupt.

libraryId=/langchain-ai/langgraph
query=Document interrupt and Command(resume=...) semantics, node re-execution, stable thread_id persistence, and AsyncSqliteSaver checkpoint usage.
```

All three `mcp__context7__query_docs` calls succeeded. Relevant retained result
excerpts:

```text
/copilotkit/copilotkit:
  import { useInterrupt } from "@copilotkit/react-core/v2";
  render receives event/resolve in the example; examples pass object payloads,
  but the result contains no exact { approved: boolean } resolver declaration.

/ag-ui-protocol/ag-ui:
  RUN_FINISHED outcome.type is "interrupt" with interrupts[].
  RunAgentInput.resume is Array<{interruptId,status,payload?}>.
  "A single resume array must address all open interrupts."

/langchain-ai/langgraph:
  interrupt resumes through Command; the node starts again and re-executes.
  AsyncSqliteSaver imports from langgraph.checkpoint.sqlite.aio.
```

For completeness, `mcp__context7__resolve_library_id` was called with literal
`libraryName` values `CopilotKit`, `AG-UI Protocol`, and `LangGraph` and the
same scoped subjects. All three resolver calls returned the exact error
`Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests`.
This does not erase the evidence: the plan already supplies the exact IDs, and
all three direct ID queries succeeded after the resolver error.

| Exact ID | Query subject | Relevant result |
| --- | --- | --- |
| `/copilotkit/copilotkit` | upstream pinned-v2 `useInterrupt` import, generics, render args, resolver | import is `@copilotkit/react-core/v2`; examples call objects such as `{ approved: true }`, but the upstream result contained no exact `{ approved: boolean }` resolver declaration; the then-installed upstream types below were authoritative for that historical candidate |
| `/ag-ui-protocol/ag-ui` | standard interrupt terminal event and resume | `RunFinishedOutcome` includes `{type:"interrupt", interrupts: Interrupt[]}`; `RunAgentInput.resume` is an array of `{interruptId,status,payload?}`; parallel example addresses all open interrupts |
| `/langchain-ai/langgraph` | `interrupt`, `Command(resume=...)`, persistence | a resumed graph re-executes the node from its beginning; `Command` supplies the resume value; checkpoint config uses stable `thread_id`; `AsyncSqliteSaver` is the async SQLite saver |

Context7 provided object examples but no exact narrower resolver declaration.
The then-installed unmodified upstream CopilotKit declaration used `unknown`,
so that historical candidate lacked the required narrower decision signature.
The admitted fork replaces that declaration and passes executable type tests;
no example-based assumption or local Ketos shim is used.

## Historical upstream official-documentation evidence (superseded)

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

## Historical upstream Python registry and artifact evidence (superseded)

PyPI reports `0.0.42` as the latest stable `ag-ui-langgraph`. One newer dev
artifact and the current immutable upstream commit were also exhausted.

| Candidate | Immutable identity / hash | License / Python | Executable result |
| --- | --- | --- | --- |
| published wheel | archive-derived `ag-ui-langgraph==0.0.42`; wheel SHA-256 `4fd19f0da6d0e16d727ec89e99b692916cbba2b0302f96aba2497043cbfec5db`; sdist SHA-256 `5384647b9b7b098189530c59b26741581dd009c8dfda907fbfaa9bafa8d21249` | `ag_ui_langgraph-0.0.42.dist-info/licenses/LICENSE`, SHA-256 `06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241`; METADATA `License-Expression: MIT`; `<3.15,>=3.10` | rejected: no standard interrupt outcome; no resume-matrix hook; no executable binding hook; deprecated resume source present |
| newer dev wheel | archive-derived `ag-ui-langgraph==0.0.43.dev1784331543`; wheel SHA-256 `8673aefcac4da28a3238031cba44350cf209ecabae87755efd57d9c00bfa832a`; sdist SHA-256 `15408cd253c13c602fa20042d3de3113d69822f58857e8dfa2487659f38cd8a7` | `ag_ui_langgraph-0.0.43.dev1784331543.dist-info/licenses/LICENSE`, SHA-256 `06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241`; METADATA `License-Expression: MIT`; `<3.15,>=3.10` | standard outcome and full two-interrupt success passed; partial/stale/duplicate/unknown/invalid were accepted instead of standard `RUN_ERROR`; deprecated resume remained; no executable binding hook existed |
| immutable upstream | archive-derived `git:3a7433ef055aab96ee7c9ece97417d721b21dc76#subdirectory=integrations/langgraph/python`; git-archive SHA-256 `03bb89a6c73228c4a3d0a196ed106fce701655428b866387a3f45d986ae3dc76` | `integrations/langgraph/python/LICENSE`, SHA-256 `06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241`; `pyproject.toml` license `MIT`; `>=3.10,<3.15` | same protocol blockers as dev; git pax `comment` binds the full commit, and installed source hashes match archive source hashes |

The live constructor for the newer source is:

```text
(*, name: str, graph: CompiledStateGraph, description: Optional[str] = None,
 config: RunnableConfig | dict | None = None,
 enable_legacy_on_interrupt_event: bool = True,
 emit_interrupt_outcome: bool = False)
```

Its endpoint at that historical commit was only:

```text
(app: FastAPI, agent: LangGraphAgent, path: str = "/")
```

That historical upstream endpoint had no dependency/auth/actor callback
parameter. The dev/commit probes emitted a real `RUN_FINISHED` with outcome
`interrupt` and both IDs `interrupt-a`, `interrupt-b`. Their full two-entry
resume succeeded, but the same method also accepted partial, stale, duplicate,
unknown-ID, and invalid-status cases. None returned a standard `RUN_ERROR`.
Source inspection also proved the deprecated `forwarded_props.command.resume`
path in those candidates. The admitted fork no longer has these failures.

### Exact probe commands

Each candidate was installed outside the repository in a fresh uv environment.
The probe accepts only a mandatory archive path. Identity, SHA-256, METADATA or
git commit, LICENSE path/hash, Python range, and source hashes are derived from
that archive; installed metadata and `agent.py`/`endpoint.py` bytes must match.
There are no identity/hash assertion flags.

Registry URL/hash lookup and archive binding:

```bash
curl -fsSL https://pypi.org/pypi/ag-ui-langgraph/0.0.42/json \
  | jq -r '.urls[] | select(.packagetype=="bdist_wheel") | [.url,.digests.sha256] | @tsv'
curl -fsSL https://pypi.org/pypi/ag-ui-langgraph/0.0.43.dev1784331543/json \
  | jq -r '.urls[] | select(.packagetype=="bdist_wheel") | [.url,.digests.sha256] | @tsv'
git -C /tmp/ketos-s01-a01-agui-src.Dijva4 archive --format=tar \
  --output=/tmp/ketos-s01-a01-artifacts/ag-ui-3a7433ef-langgraph-python.tar \
  3a7433ef055aab96ee7c9ece97417d721b21dc76 integrations/langgraph/python
git get-tar-commit-id \
  < /tmp/ketos-s01-a01-artifacts/ag-ui-3a7433ef-langgraph-python.tar
shasum -a 256 \
  /tmp/ketos-s01-a01-artifacts/ag_ui_langgraph-0.0.42.whl \
  /tmp/ketos-s01-a01-artifacts/ag_ui_langgraph-0.0.43.dev1784331543.whl \
  /tmp/ketos-s01-a01-artifacts/ag-ui-3a7433ef-langgraph-python.tar
```

Exact probe invocations:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --isolated --no-project \
  --with 'ag-ui-langgraph[fastapi] @ https://files.pythonhosted.org/packages/62/c0/32fea8de7ac50a90ea150f999318f4d121cd22d58e446c8fdb420fc2a11e/ag_ui_langgraph-0.0.42-py3-none-any.whl' \
  python scripts/mvp/probe_ag_ui_adapter.py \
  --artifact-path /tmp/ketos-s01-a01-artifacts/ag_ui_langgraph-0.0.42.whl \
  --json > /tmp/ketos-s01-a01-v0042-probe-rereview.json

PYTHONDONTWRITEBYTECODE=1 uv run --isolated --no-project \
  --with 'ag-ui-langgraph[fastapi] @ https://files.pythonhosted.org/packages/0b/1a/dc28490d7a20b338089a1da8b6c29505aeddcadad94baf29dc5c29ae554d/ag_ui_langgraph-0.0.43.dev1784331543-py3-none-any.whl' \
  python scripts/mvp/probe_ag_ui_adapter.py \
  --artifact-path /tmp/ketos-s01-a01-artifacts/ag_ui_langgraph-0.0.43.dev1784331543.whl \
  --json > /tmp/ketos-s01-a01-v0043dev-probe-rereview.json

PYTHONDONTWRITEBYTECODE=1 uv run --isolated --no-project \
  --with 'ag-ui-langgraph[fastapi] @ git+https://github.com/ag-ui-protocol/ag-ui.git@3a7433ef055aab96ee7c9ece97417d721b21dc76#subdirectory=integrations/langgraph/python' \
  python scripts/mvp/probe_ag_ui_adapter.py \
  --artifact-path /tmp/ketos-s01-a01-artifacts/ag-ui-3a7433ef-langgraph-python.tar \
  --json > /tmp/ketos-s01-a01-commit-probe-rereview.json
```

All three commands exited `1` as a fail-closed rejection. The two wheel hashes
equal their PyPI JSON digests. `git get-tar-commit-id` returned the exact
40-character commit, and the archive SHA-256 was
`03bb89a6c73228c4a3d0a196ed106fce701655428b866387a3f45d986ae3dc76`.

### Retained redacted probe JSON

These are direct projections regenerated after the executable binding change.
All three exact probe commands above exited 1. Only verbose emitted events and
absolute installed-runtime paths are omitted. Exact projection commands:

```bash
jq '{artifact,contracts,resume_matrix:.details.resume_matrix,source_inspection:.details.source_inspection,pre_dispatch_binding:.details.pre_dispatch_binding,decision}' /tmp/ketos-s01-a01-v0042-probe-rereview.json
jq '{artifact,contracts,resume_matrix:.details.resume_matrix,source_inspection:.details.source_inspection,pre_dispatch_binding:.details.pre_dispatch_binding,decision}' /tmp/ketos-s01-a01-v0043dev-probe-rereview.json
jq '{artifact,contracts,resume_matrix:.details.resume_matrix,source_inspection:.details.source_inspection,pre_dispatch_binding:.details.pre_dispatch_binding,decision}' /tmp/ketos-s01-a01-commit-probe-rereview.json
```

#### Published wheel 0.0.42

```json
{
  "artifact": {
    "archive_identity_bound": true,
    "archive_kind": "wheel",
    "identity": "ag-ui-langgraph==0.0.42",
    "license": "MIT",
    "license_path": "ag_ui_langgraph-0.0.42.dist-info/licenses/LICENSE",
    "license_sha256": "06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241",
    "license_source": "artifact",
    "metadata_path": "ag_ui_langgraph-0.0.42.dist-info/METADATA",
    "name": "ag-ui-langgraph",
    "path": "ag_ui_langgraph-0.0.42.whl",
    "requires_python": "<3.15,>=3.10",
    "runtime_identity_bound": true,
    "runtime_source_bound": true,
    "sha256": "4fd19f0da6d0e16d727ec89e99b692916cbba2b0302f96aba2497043cbfec5db",
    "source_sha256": {
      "ag_ui_langgraph/agent.py": "c4b87d5d1e98b32d1be0e040f620b830e7864dc9ed3705636c813c608da2794b",
      "ag_ui_langgraph/endpoint.py": "962952b33b4c64208dc91db6551b9f293bdd8a0a655fed8aebbf54c7e514566d"
    },
    "version": "0.0.42"
  },
  "contracts": {
    "all_open_interrupts": false,
    "constructor_api": true,
    "deprecated_forwarded_props_resume_absent": false,
    "run_agent_input_resume_array": true,
    "safe_pre_dispatch_binding": false,
    "standard_run_finished_interrupt": false
  },
  "resume_matrix": {
    "all_invalid_standard_run_error": false,
    "cases": {},
    "full_all_open_success": false
  },
  "source_inspection": {
    "agent": true,
    "endpoint": true
  },
  "pre_dispatch_binding": {
    "agent_dispatched": false,
    "dependency_called": false,
    "documented_dependencies": false,
    "reason": "no documented FastAPI dependencies parameter",
    "signature": "(app: fastapi.applications.FastAPI, agent: ag_ui_langgraph.agent.LangGraphAgent, path: str = '/')",
    "source_available": true
  },
  "decision": {
    "admitted": false,
    "reasons": [
      "0.0.42",
      "standard_run_finished_interrupt",
      "all_open_interrupts",
      "safe_pre_dispatch_binding",
      "deprecated_forwarded_props_resume_absent"
    ]
  }
}
```

#### Development wheel 0.0.43.dev1784331543

```json
{
  "artifact": {
    "archive_identity_bound": true,
    "archive_kind": "wheel",
    "identity": "ag-ui-langgraph==0.0.43.dev1784331543",
    "license": "MIT",
    "license_path": "ag_ui_langgraph-0.0.43.dev1784331543.dist-info/licenses/LICENSE",
    "license_sha256": "06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241",
    "license_source": "artifact",
    "metadata_path": "ag_ui_langgraph-0.0.43.dev1784331543.dist-info/METADATA",
    "name": "ag-ui-langgraph",
    "path": "ag_ui_langgraph-0.0.43.dev1784331543.whl",
    "requires_python": "<3.15,>=3.10",
    "runtime_identity_bound": true,
    "runtime_source_bound": true,
    "sha256": "8673aefcac4da28a3238031cba44350cf209ecabae87755efd57d9c00bfa832a",
    "source_sha256": {
      "ag_ui_langgraph/agent.py": "e434202c6dce696bb93c0e4bcee8152cc31410ef5b6cb1379bd4f8e2da789c97",
      "ag_ui_langgraph/endpoint.py": "99c9eb8d25f4767b42ba195cfd54e18a5eb9e119e227cd8da5ced3ec6ee023ef"
    },
    "version": "0.0.43.dev1784331543"
  },
  "contracts": {
    "all_open_interrupts": false,
    "constructor_api": true,
    "deprecated_forwarded_props_resume_absent": false,
    "run_agent_input_resume_array": true,
    "safe_pre_dispatch_binding": false,
    "standard_run_finished_interrupt": true
  },
  "resume_matrix": {
    "all_invalid_standard_run_error": false,
    "cases": {
      "duplicate": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "full_all_open": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "invalid": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": true}, \"status\": \"invalid\"}}}"
      },
      "partial": {
        "outcome": "accepted",
        "resume": "{\"approved\": true}"
      },
      "stale": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "unknown": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-unknown\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}}}"
      }
    },
    "full_all_open_success": true
  },
  "source_inspection": {
    "agent": true,
    "endpoint": true
  },
  "pre_dispatch_binding": {
    "agent_dispatched": false,
    "dependency_called": false,
    "documented_dependencies": false,
    "reason": "no documented FastAPI dependencies parameter",
    "signature": "(app: fastapi.applications.FastAPI, agent: ag_ui_langgraph.agent.LangGraphAgent, path: str = '/')",
    "source_available": true
  },
  "decision": {
    "admitted": false,
    "reasons": [
      "all_open_interrupts",
      "safe_pre_dispatch_binding",
      "deprecated_forwarded_props_resume_absent"
    ]
  }
}
```

#### Immutable upstream commit 3a7433ef055aab96ee7c9ece97417d721b21dc76

```json
{
  "artifact": {
    "archive_identity_bound": true,
    "archive_kind": "git-archive",
    "git_commit": "3a7433ef055aab96ee7c9ece97417d721b21dc76",
    "identity": "git:3a7433ef055aab96ee7c9ece97417d721b21dc76#subdirectory=integrations/langgraph/python",
    "license": "MIT",
    "license_path": "integrations/langgraph/python/LICENSE",
    "license_sha256": "06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241",
    "license_source": "artifact",
    "metadata_path": "integrations/langgraph/python/pyproject.toml",
    "name": "ag-ui-langgraph",
    "path": "ag-ui-3a7433ef-langgraph-python.tar",
    "requires_python": ">=3.10,<3.15",
    "runtime_identity_bound": true,
    "runtime_source_bound": true,
    "sha256": "03bb89a6c73228c4a3d0a196ed106fce701655428b866387a3f45d986ae3dc76",
    "source_sha256": {
      "ag_ui_langgraph/agent.py": "45a242fb5a8dffa9a98ba845feddc433800503494ffd9e2011d7fe0fdbd51a9a",
      "ag_ui_langgraph/endpoint.py": "99c9eb8d25f4767b42ba195cfd54e18a5eb9e119e227cd8da5ced3ec6ee023ef"
    },
    "version": "0.0.42"
  },
  "contracts": {
    "all_open_interrupts": false,
    "constructor_api": true,
    "deprecated_forwarded_props_resume_absent": false,
    "run_agent_input_resume_array": true,
    "safe_pre_dispatch_binding": false,
    "standard_run_finished_interrupt": true
  },
  "resume_matrix": {
    "all_invalid_standard_run_error": false,
    "cases": {
      "duplicate": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "full_all_open": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "invalid": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": true}, \"status\": \"invalid\"}}}"
      },
      "partial": {
        "outcome": "accepted",
        "resume": "{\"approved\": true}"
      },
      "stale": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-b\": {\"payload\": {\"approved\": false}, \"status\": \"resolved\"}}}"
      },
      "unknown": {
        "outcome": "accepted",
        "resume": "{\"__agui_resume_map__\": {\"interrupt-a\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}, \"interrupt-unknown\": {\"payload\": {\"approved\": true}, \"status\": \"resolved\"}}}"
      }
    },
    "full_all_open_success": true
  },
  "source_inspection": {
    "agent": true,
    "endpoint": true
  },
  "pre_dispatch_binding": {
    "agent_dispatched": false,
    "dependency_called": false,
    "documented_dependencies": false,
    "reason": "no documented FastAPI dependencies parameter",
    "signature": "(app: fastapi.applications.FastAPI, agent: ag_ui_langgraph.agent.LangGraphAgent, path: str = '/')",
    "source_available": true
  },
  "decision": {
    "admitted": false,
    "reasons": [
      "all_open_interrupts",
      "safe_pre_dispatch_binding",
      "deprecated_forwarded_props_resume_absent"
    ]
  }
}
```

## Historical upstream pinned-JS admission (superseded)

An isolated npm install was performed for:

- `@copilotkit/react-core@1.63.1`
- `@copilotkit/react-ui@1.63.1`
- `@copilotkit/runtime@1.63.1`
- `@ag-ui/client@0.0.57`

`npm ls --depth=0` resolved those exact versions. Registry archives and hashes:

| Package | SHA-256 | Registry integrity / license |
| --- | --- | --- |
| `@copilotkit/react-core@1.63.1` | `baade24e0879436d4870462f9667bcfa19063c51dcf06c8269e506bbb62b3947` | `sha512-Zv20Rebsh6VcvO00HDbh9B0Q6XnmEYygv8BKur0+OS4eRb1gR4QmWjff/+sjJgweFpgb645jY1i0FB4MU7j7pg==`; `package/LICENSE`, SHA-256 `15a0e5343aea872c0573ad72feb6044b336f162d724cc1673c608e6b37ea071b`; package metadata MIT |
| `@copilotkit/react-ui@1.63.1` | `78729aea7716ddf5064496cf29effb4edbd2779bc6a970b07a358a5973353b5d` | `sha512-JDxEMBdT5k477iS+mOBMBePXnE+Z0stUGC4wUC/a5z2C3EqOS7OuYHHy370Qh+g6tkvL4DtRNl2XZ8gYn0zMJg==`; `package/LICENSE`, SHA-256 `15a0e5343aea872c0573ad72feb6044b336f162d724cc1673c608e6b37ea071b`; package metadata MIT |
| `@copilotkit/runtime@1.63.1` | `1864af0daf9bc7873c7b48b8d20ccea8e5d893527f51f8ab18848497fcc54369` | `sha512-twdk0ax0VfiuGG3zg5xcpYr44n8VMeBjWv0aW0a5xOo+CFgG3GSMu8e3vzz6Vgblmq0p+k6Z43sQuwFC32My0w==`; `package/LICENSE`, SHA-256 `15a0e5343aea872c0573ad72feb6044b336f162d724cc1673c608e6b37ea071b`; package metadata MIT |
| `@ag-ui/client@0.0.57` | `18d97da692e9844c5aa41aa536d659454dc88ca7b12e89caf788d9cb6dc129b1` | `sha512-Xap2alG9Z0/j5kb3x4D7oTpe2sw1dfrC9rgJJr2NZu5vKcm8dzIPNd31mF2B4zS3BKqYIu245yxKPhEtT30MHw==`; `package/LICENSE`, SHA-256 `06dcddbb6908a0c6dd4a9e8ec822eea41d5a460a53089fecccc8a68049e99241`; package metadata has no license field, LICENSE text is MIT |

Exact registry/license inspection commands:

```bash
npm view @copilotkit/react-core@1.63.1 dist.integrity dist.tarball license --json
npm view @copilotkit/react-ui@1.63.1 dist.integrity dist.tarball license --json
npm view @copilotkit/runtime@1.63.1 dist.integrity dist.tarball license --json
npm view @ag-ui/client@0.0.57 dist.integrity dist.tarball license --json
shasum -a 256 /tmp/ketos-s01-a01-pinned.lRxvfO/*.tgz
for archive in /tmp/ketos-s01-a01-pinned.lRxvfO/*.tgz; do
  tar -xOf "$archive" package/package.json | jq -r '.name + "@" + .version + " license=" + (.license // "<absent>")'
  tar -xOf "$archive" package/LICENSE | shasum -a 256
done
```

The then-installed upstream package did not ship a literal top-level `.d.ts`; its declaration
bundle is `.d.cts`/`.d.mts` and contains the source region
`src/v2/lib/react-core.d.ts`. Exact inspected paths:

- absolute: `/tmp/ketos-s01-a01-js.GlAscE/node_modules/@copilotkit/react-core/dist/v2/headless.d.cts`;
- package-relative: `node_modules/@copilotkit/react-core/dist/v2/headless.d.cts`.

Exact inspection command and line results:

```bash
rg -n 'type InterruptResolveFn|interface InterruptRenderProps|declare function useInterrupt' \
  /tmp/ketos-s01-a01-js.GlAscE/node_modules/@copilotkit/react-core/dist/v2/headless.d.cts
# 188:type InterruptResolveFn = (payload?: unknown, interruptId?: string) => Promise<RunAgentResult | void>;
# 211:interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
# 556:declare function useInterrupt<TResult = never, TRenderInChat extends InterruptRenderInChat = undefined>(config: UseInterruptConfig<any, TResult, TRenderInChat>): UseInterruptReturn<TRenderInChat>;

sed -n '188,220p' \
  /tmp/ketos-s01-a01-js.GlAscE/node_modules/@copilotkit/react-core/dist/v2/headless.d.cts
sed -n '550,558p' \
  /tmp/ketos-s01-a01-js.GlAscE/node_modules/@copilotkit/react-core/dist/v2/headless.d.cts
```

The historical upstream `@copilotkit/react-core@1.63.1` inspection proved:

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

That upstream hook exposed the full open set and supported targeting an
interrupt ID, but its resolver payload was `unknown`. It therefore did not
prove `resolve({ approved: boolean })`. The admitted fork now supplies the
narrower generic resolver and passes positive and negative compile-time tests.

Safe registry alternatives were bounded to the current canary and published
next archive:

- `1.62.2-canary.1784333495`, archive SHA-256
  `fffa327622d2dbdf21c12f6a1af16d0a4e1dd8cab08adffb1c1db4de96465e6d`,
  has the same `payload?: unknown` resolver;
- `2.0.0-next.1`, archive SHA-256
  `c72d0bea984dafb2146c765ed38e35e3cbefd40475a4d460212e714adeb80640`,
  does not expose the required v2 `useInterrupt` surface.

At that historical blocked snapshot, `langgraph-checkpoint-sqlite==3.1.0`
registry metadata was also verified:
wheel SHA-256 `cc9b40df0076feae8a9ad42ae713621b148b00ac23adc09dc1dc66090a46e5ad`,
sdist SHA-256 `f926916ebc1b985d802cc9c820026036e84db9d910d62c97b57e4ba64f67d5ae`,
MIT, Python `>=3.10`. It was not pinned at that time because the upstream
adapter/JS gates failed; that statement is not the current temporary-fork
decision.

## Historical investigation tool ledger (superseded)

| Tool | Requested operation | Result / exact error | Safe alternative | Acceptance impact |
| --- | --- | --- | --- | --- |
| direct source/git | baseline, status, exact source and registry artifact inspection | available; clean baseline on required branch | none | authoritative |
| RaytSystem | doctor/status/graph status/lint/query, explicit root | lint `ok:true`; graph `state:"stale", reason:"checkout_changed"`; query returned `No supported claim in the active generation matches this query.` | direct source + existing Graphify | non-blocking navigation gap |
| Graphify | read-only query with budget 2500 | exit 0; existing graph traversed, no rebuild | direct source for exact evidence | non-blocking stale-map limitation |
| Context7 | `mcp__context7__query_docs` on all three exact IDs; then `mcp__context7__resolve_library_id` audit calls | all three exact-ID queries succeeded; all three later resolver calls returned `Monthly quota exceeded...` | direct exact IDs supplied by the authoritative plan | query evidence obtained; resolver limitation recorded, non-blocking |
| official docs/web | open six required URLs | available; all opened | none | blocking evidence obtained |
| PyPI/npm/Git | releases, hashes, installed types, immutable commit | available; first GitHub releases URL returned HTTP 403 and two unquoted `?` URLs produced zsh `no matches found` | quoted URL, `git ls-remote`, sparse clone, PyPI/npm registries | recovered, non-blocking |
| isolated uv install | exact wheel/VCS probes | local renamed wheel first failed `wheel filename ... is invalid: Must have a Python tag`; plain adapter install then failed `ModuleNotFoundError: No module named 'fastapi'` | exact wheel URL plus declared `[fastapi]` extra | recovered; final probes authoritative |
| pytest | negative-first and focused contract history | historical 22/62/75 passed; current R3 fork-review 89 passed | none | pass |
| browser/Chrome | visual product flow | not relevant to dependency-only A01; no product route exists | not invoked | no A01 impact |

## Repository scope check

The admitted A01 repository deliverables are:

- `scripts/mvp/probe_ag_ui_adapter.py`
- `scripts/mvp/audit_copilotkit_artifact.py`
- `src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py`
- focused artifact audit tests;
- `docs/dev/handoff/STAGE_01_TEMPORARY_FORK_DECISION.md`
- this admission document;
- `vendor/stage01/` immutable artifacts, sources, provenance, and manifest;
- the owned Python/frontend manifests and `uv.lock`/`package-lock.json`.

No deployment, generated, Ketos `LICENSE`, Ketos `NOTICE`, or unrelated dirty
file was changed. The manifest/lock edits are limited to the two exact local
fork artifacts. Frozen and offline install gates were run after admission.
