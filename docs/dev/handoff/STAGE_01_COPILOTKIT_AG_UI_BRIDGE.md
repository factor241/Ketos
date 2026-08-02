# Stage 01 CopilotKit / AG-UI bridge handoff

> This is the finalized Stage 01 handoff owned by S01-A10. The immutable Git
> commit and tree are intentionally supplied by the external final attestation:
> a commit cannot contain its own hash. Every gate below was rerun from the
> clean integration checkout immediately before that attestation.

## Finalization contract

```yaml
stage: 01
base_sha: 5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782
integration_start_sha: 1fb8d841c6af8f75706f4bb4fb4319732134cc12
candidate_sha_from: "external final attestation: git rev-parse HEAD"
candidate_tree_from: "external final attestation: git rev-parse HEAD^{tree}"
status: PASS
transition_allowed: true
```

The external final attestation records one 40-character `candidate_sha` and its
tree after this document is committed. It is valid only when the checkout is
clean, this handoff is present in that commit, every recorded command exits
zero on that exact SHA, and no Critical or Important finding remains.

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
| `S01-FINAL-BACKEND-KFX-20260719` | `2026-07-19T06:20:00Z` | Stage 01 combined backend, KFX, ownership, API v1, release-lock, artifact and source-boundary pytest gates | 0 | all selected suites passed; artifact/source-boundary block: 129 tests; API v1 block: 34 tests |
| `S01-FINAL-STACK-RUNTIME-FRONTEND-20260719` | `2026-07-19T06:24:00Z` | three-process smoke; runtime test/typecheck/build; focused frontend Jest; production typecheck/build | 0 | smoke PASS; runtime 16 tests; frontend 7 suites / 90 tests; both production builds PASS |
| `S01-FINAL-CHROMIUM-20260719` | `2026-07-19T06:27:00Z` | canonical Playwright Chromium command above | 0 | 4/4: approve, reject, close/Escape, reload/replay and legacy flow |
| `S01-FINAL-SUPPLY-CHAIN-20260719` | `2026-07-19T06:36:00Z` | executable admission probes, two AG-UI rebuilds, two CopilotKit rebuilds, frozen/offline Python and npm installs | 0 | both independent rebuild pairs equal their vendored SHA; one runtime package copy each; offline installs PASS |

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
| Graphify | temporary exact-SHA clone; 69-file Stage 01 code-only extraction; 1,545 nodes / 3,523 edges; route paths `register_stage01_ag_ui()` -> `create_ag_ui_router()` -> `register_langgraph_endpoint()` | PASS; graph stayed outside the repository and was not committed |
| Context7 and official docs | dependency/public-contract evidence is recorded in `STAGE_01_AG_UI_ADMISSION.md`; A10 did not substitute it with inference | PASS via A01 evidence |
| Product Design | coordinator live narrow audit: two independent cards, no horizontal overflow, exact Close/Reopen behavior; no redesign | PASS |
| Chrome plugin | live loopback UI audit and post-fix repeat: Reopen returned `activeElement` to the exact card Close button | PASS |
| Computer plugin | OS-level visual check was attempted, but the Mac session was locked; no product evidence was inferred from the failed attempt | NON-NORMATIVE; Chrome and Playwright provided the required real-browser proof |

## Task and review ledger

The implementation branch heads below identify the reviewed handoff sources.
All are ancestors or integrated equivalents of the externally attested final
candidate. Coordinator review and focused reruns found no remaining Critical or
Important issue.

| Task | Handoff branch head at template creation | Final reviewed SHA/status |
| --- | --- | --- |
| S01-A01 | `5d8a43017b7282afacd0bbde3aa625484f3d14f2` plus final admission hardening | PASS |
| S01-A02 | `c77fa7f7f804fcaff36f4355801692429f6efcb4` | PASS |
| S01-A03 | `dad640cb85345fc67cd62db4ced6e8fe632bc9ca` | PASS |
| S01-A04 | `e499a55a221067d2c794fad948abf6ba770991a9` | PASS |
| S01-A05 | `aac220f233a3d1954d6ccd1af45fb9a6c3a1217d` | PASS; exact-owner floor reverified unchanged |
| S01-A06 | `7cf889f000c03253011a59632eaf899f65058972` | PASS |
| S01-A07 | `ae4f7eab77b94f1e70a574e12d8c8693143851a6` | PASS |
| S01-A08 | `701ffb4693368c489177a3126b63f38379b8dd82` | PASS |
| S01-A09 | `96a06cd23580a05488c0d9fe6f2681c40109700a` | PASS |
| S01-A10 | runtime lifecycle `83fb2827a994361794e0e2be643ef63ef8df722c`; vertical proof and guard `a59b87a72360dfa71401196535afc71392407e71`; integrated hardening | PASS |

## Final gate template

```yaml
completed: [S01-A01, S01-A02, S01-A03, S01-A04, S01-A05, S01-A06, S01-A07, S01-A08, S01-A09, S01-A10]
not_completed: []
partial: []
defects:
  blocking: []
  non_blocking: []
blockers: []
tests_from: "all Stage 01 section 10.2 commands; exact SHA supplied by external final attestation"
criteria:
  artifact_admission: PASS
  frontend_interrupt_api_admission: PASS
  standard_text: PASS
  standard_tool_lifecycle: PASS
  bounded_state: PASS
  standard_interrupt_resume: PASS
  all_open_interrupts: PASS
  frontend_all_open_interrupt_renderer: PASS
  ui_approve_reject_same_thread_new_run_one_effect: PASS
  cancel_abandon_no_resume_or_reject: PASS
  auth_actor_binding: PASS
  checkpoint_new_app: PASS
  job_exact_owner: PASS
  feature_flags_default_off: PASS
  three_process_chromium: PASS
  legacy_flow_route: PASS
  source_boundaries: PASS
  locks_and_ownership: PASS
  docs_and_tool_ledger: PASS
verdict: PASS
transition_allowed: true
```

Stage 02 is outside this work and was not started. Its separate authorization
is still required even though Stage 01 is now eligible for transition.
