# Stage 01 CopilotKit / AG-UI bridge handoff

> This document is the exact-SHA handoff template owned by S01-A10. It is not
> a Stage 01 PASS declaration while Sync B, the independent coordinator review,
> and the full gate are still pending. The coordinator must replace every
> `*_from` field with the literal command output on one final integration commit.

## Finalization contract

```yaml
stage: 01
base_sha: 5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782
integration_start_sha: 1fb8d841c6af8f75706f4bb4fb4319732134cc12
candidate_sha_from: "git rev-parse HEAD"
candidate_tree_from: "git rev-parse HEAD^{tree}"
status: PRE_INTEGRATION_TEMPLATE
transition_allowed: false
```

The finalizer must run every recorded final command after all A01-A10 commits
and fixes are integrated, record the same 40-character `candidate_sha` beside
each result, and then change the status only if all criteria pass. A commit
cannot truthfully contain its own hash, so this contract deliberately obtains
the final hash from Git after the document is committed; it does not use a
placeholder SHA or a self-referential claim.

## Dependency and protocol identity

| Boundary | Admitted identity | Immutable evidence |
| --- | --- | --- |
| Python adapter | `ag-ui-langgraph==0.0.43+ketos.1` | fork `factor241/ag-ui` commit `85b94807e464c9b38f591938a41559923a712dbb`; wheel SHA-256 `5ae33b1bab5a9e0adfb1425c5e279476a7ba35a385019d71be2f3ee79e8913cc`; MIT |
| React core | `@copilotkit/react-core@1.63.1-ketos.1` | fork `factor241/CopilotKit` commit `c853ac2b78cb57481cc2ca58eda4a865908c532b`; tgz SHA-256 `64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa`; MIT |
| Runtime agent | `ketos-mvp-probe` | one fixed `HttpAgent`, Node loopback `127.0.0.1:8788` |
| Backend route | `/api/v1/agentic/ag-ui` | one shared registrar; authenticated before clone/dispatch |
| Frontend route | `/mvp/copilotkit-probe` | protected and available only when both literal boolean flags are true |

The wire contract remains standard AG-UI. Ketos adds no event, encoder, SSE
parser, resume translator, or browser-created actor/model authority. Resume is
only `RunAgentInput.resume[]`; the frontend resolves every open interrupt by
calling the admitted `useInterrupt<ApprovalDecision>` resolver with the exact
interrupt ID. Python revalidates payload, ownership, all-open completeness,
replay, and concurrency at the security boundary.

## S01-A10 deliverables

The finalizer resolves the A10 commit with:

```bash
git log -1 --format=%H -- docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_BRIDGE.md
```

Owned paths:

- `src/backend/base/ketos/agentic/api/router.py`
- `src/backend/base/ketos/agentic/services/ag_ui/stage01_runtime.py`
- `src/backend/base/ketos/main.py`
- `src/backend/tests/unit/agentic/api/test_ag_ui_stage01_runtime.py`
- `src/frontend/src/pages/CopilotKitProbePage/index.tsx`
- `src/frontend/src/routes.tsx`
- `src/frontend/src/pages/AppInitPage/index.tsx`
- `src/frontend/vite.config.mts`
- `src/frontend/postcss.config.js`
- `src/frontend/playwright.mvp.config.ts`
- `src/frontend/tests/core/integrations/copilotkit-ag-ui-probe.spec.ts`
- `scripts/mvp/check_stage01_source_boundaries.py`
- `scripts/mvp/tests/test_check_stage01_source_boundaries.py`
- `scripts/mvp/tests/test_stage01_harness_paths.py`
- this handoff

The runtime lifecycle opens exactly one file-backed saver, builds one combined
A07 tool plus A08 interrupt graph, registers the endpoint once, and closes the
saver on shutdown or construction failure. With both flags off it creates no
Stage 01 resource. The Vite proxy has one immutable Node target and preserves
the browser-facing Host (`changeOrigin: false`) so the runtime's Origin/Host
guard remains strict.

## A10 executable evidence ledger

No request headers, cookies, tokens, or trace secrets are retained here.

| Evidence ID | UTC | Command | Exit | Result |
| --- | --- | --- | ---: | --- |
| `A10-JEST-FOCUSED-20260719` | `2026-07-19T04:25:00Z` | `cd src/frontend && npm test -- --runInBand src/__tests__/stage01-copilotkit-proxy-boundary.test.ts src/__tests__/stage01-postcss-boundary.test.ts src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx src/pages/CopilotKitProbePage/__tests__/CopilotKitProbePage.test.tsx` | 0 | 4 suites, 12 tests passed |
| `A10-FRONTEND-BUILD-20260719` | `2026-07-19T04:27:00Z` | `cd src/frontend && npm run build` | 0 | Vite production build completed with the stock CopilotKit stylesheet |
| `A10-PY-BOUNDARY-20260719` | `2026-07-19T04:57:05Z` | `uv run pytest -q scripts/mvp/tests/test_check_stage01_source_boundaries.py scripts/mvp/tests/test_stage01_harness_paths.py src/backend/tests/unit/agentic/api/test_ag_ui_stage01_runtime.py` | 0 | 20 tests passed; final expanded guard-only adversarial rerun: 34 passed; committed-checkout executable guard PASS |
| `A10-CHROMIUM-APPROVE-20260719` | `2026-07-19T04:48:00Z` | `cd src/frontend && ./node_modules/.bin/playwright test --config=playwright.mvp.config.ts tests/core/integrations/copilotkit-ag-ui-probe.spec.ts --project=chromium` | 0 | all-approve: two distinct cards, one all-open resume, same thread, new run, one effect; double-click/reload/replay did not create another effect |
| `A10-CHROMIUM-REJECT-20260719` | same run | same command | 0 | separate fresh all-reject: exact IDs, same thread, new run, one rejected effect |
| `A10-CHROMIUM-CANCEL-20260719` | same run | same command | 0 | close and Escape emitted no resume or rejection; cards remained reopenable |
| `A10-CHROMIUM-LEGACY-20260719` | same run | same command | 0 | existing Basic Prompting opened `/flow/:id`; real `#react-flow-id` canvas visible |

The real backend lifecycle tests additionally proved bounded read-only KFX
state/tool execution before two interrupts, one full resume, one effect, a
new-app/process checkpoint resume, and replay denial. The E2E does not call
`fetch`, `page.request`, `request.fetch`, `evaluate`, `Command(resume=...)`, or
any custom transport path.

## Source and security boundary ledger

`scripts/mvp/check_stage01_source_boundaries.py` fails closed on:

- missing or non-ancestor exact baseline/integration-start commits;
- duplicate registrars, including imported aliases and attribute calls;
- deprecated `forwardedProps` or `forwarded_props` command resume access,
  including bracket/attribute chains propagated through local aliases;
- aliased or module-qualified `Command(resume=...)` construction;
- custom event/encoder imports and local AG-UI parser/encoder functions;
- manual browser `fetch`, `page.request`, `request.fetch`, `evaluate`, or
  `dispatchEvent` transport;
- parse/read failures, unexpected interrupt-probe importers, duplicate routes,
  and changed paths outside the Stage 01 allowlist.

The adversarial self-tests inject every class above. A final committed-checkout
run is mandatory because the ownership scan compares Git commits, not the
working tree.

## Tool ledger

| Capability | A10 use and exact evidence | Status |
| --- | --- | --- |
| Source inspection | `rg`, `sed`, AST inspection, Git diff/status, executable guard | PASS |
| Test runner | pytest, Jest, TypeScript production/build gate, Playwright Chromium | PASS |
| Browser | Playwright controlled real Chromium against `7860/8788/3000` | PASS |
| Graphify | read-only router-first query from the existing root graph: `graphify query "Trace the Stage 01 AG-UI and CopilotKit bridge boundaries from frontend route through runtime and backend; identify registrar duplication or custom protocol paths." --budget 1800` | PARTIAL: the existing graph predates A10; the plan-required temporary post-integration graph remains coordinator-owned |
| Context7 and official docs | dependency/public-contract evidence is recorded in `STAGE_01_AG_UI_ADMISSION.md`; A10 did not substitute it with inference | PASS via A01 evidence |
| Product Design | coordinator live narrow audit: two independent cards, no horizontal overflow, exact Close/Reopen behavior; no redesign | PASS |
| Chrome plugin | live loopback UI audit and post-fix repeat: Reopen returned `activeElement` to the exact card Close button | PASS |
| Computer plugin | visual check is coordinator-owned; exact call/result must be appended before final PASS | PENDING |

## Task and review ledger

The implementation branch heads below identify handoff sources, not the final
integration verdict. The coordinator must replace them with the reviewed
commits actually present in `candidate_sha` and append reviewer findings and
focused reruns.

| Task | Handoff branch head at template creation | Final reviewed SHA/status |
| --- | --- | --- |
| S01-A01 | `5d8a43017b7282afacd0bbde3aa625484f3d14f2` | `reviewed_sha_from: coordinator ledger` |
| S01-A02 | `c77fa7f7f804fcaff36f4355801692429f6efcb4` | `reviewed_sha_from: coordinator ledger` |
| S01-A03 | `dad640cb85345fc67cd62db4ced6e8fe632bc9ca` | `reviewed_sha_from: coordinator ledger` |
| S01-A04 | `e499a55a221067d2c794fad948abf6ba770991a9` | `reviewed_sha_from: coordinator ledger` |
| S01-A05 | `aac220f233a3d1954d6ccd1af45fb9a6c3a1217d` | `reviewed_sha_from: coordinator ledger` |
| S01-A06 | `7cf889f000c03253011a59632eaf899f65058972` | `reviewed_sha_from: coordinator ledger` |
| S01-A07 | `ae4f7eab77b94f1e70a574e12d8c8693143851a6` | `reviewed_sha_from: coordinator ledger` |
| S01-A08 | `701ffb4693368c489177a3126b63f38379b8dd82` | `reviewed_sha_from: coordinator ledger` |
| S01-A09 | `96a06cd23580a05488c0d9fe6f2681c40109700a` | `reviewed_sha_from: coordinator ledger` |
| S01-A10 | runtime lifecycle `83fb2827a994361794e0e2be643ef63ef8df722c`; vertical proof and guard `a59b87a72360dfa71401196535afc71392407e71` | independent coordinator review pending |

## Final gate template

```yaml
completed_from: "coordinator A01-A10 commit and review matrix"
not_completed: []
partial: []
defects:
  blocking: []
  non_blocking: []
blockers: []
tests_from: "all commands in Stage 01 section 10.2, each with UTC, exit code, and identical candidate_sha"
criteria:
  artifact_admission: PENDING_FINAL_GATE
  frontend_interrupt_api_admission: PENDING_FINAL_GATE
  standard_text: PENDING_FINAL_GATE
  standard_tool_lifecycle: PENDING_FINAL_GATE
  bounded_state: PENDING_FINAL_GATE
  standard_interrupt_resume: PENDING_FINAL_GATE
  all_open_interrupts: PENDING_FINAL_GATE
  frontend_all_open_interrupt_renderer: PENDING_FINAL_GATE
  ui_approve_reject_same_thread_new_run_one_effect: PASS_A10_FOCUSED
  cancel_abandon_no_resume_or_reject: PASS_A10_FOCUSED
  auth_actor_binding: PENDING_FINAL_GATE
  checkpoint_new_app: PASS_A10_FOCUSED
  job_exact_owner: PENDING_FINAL_GATE
  feature_flags_default_off: PASS_A10_FOCUSED
  three_process_chromium: PASS_A10_FOCUSED
  legacy_flow_route: PASS_A10_FOCUSED
  source_boundaries: PENDING_COMMITTED_RERUN
  locks_and_ownership: PENDING_FINAL_GATE
  docs_and_tool_ledger: PENDING_COORDINATOR_TOOLS
verdict: PENDING_SYNC_B
transition_allowed: false
```

Stage 02 is outside this work and remains prohibited until the coordinator has
filled this handoff from one exact integration SHA, completed the independent
reviews and tool ledger, rerun the full gate, and changed every criterion to
`PASS` without open Critical or Important findings.
