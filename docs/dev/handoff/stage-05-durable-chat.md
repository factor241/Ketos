# Ketos Stage 05 — durable chat handoff

## Control verdict

- User-facing status: **этап выполнен**
- Internal gate: **PASS**
- Transition S05 -> S06: **GO**
- Stage 06 started: **no**
- Stage-04 PASS base: `1ea57de7aa88dc8cff2cc2818af8e69d3420542c`
- Original blocked candidate: `9ce671d064016148e739287630710002e55c95be`
- Original blocked tree: `62a9fea7979c056f6540bd5606d3983d703bbe81`
- Recovery design commit: `3070a079cdb76ba3d25abdf3f7f8f5cfda84c787`
- Recovery plan commit: `4d5e96c202039473be234189f3b0ea746506aeca`
- Frozen product candidate: `2653920a3dfef279f4221443bcf31d6a2dc396f3`
- Frozen product tree: `e1533e2077b684085fa85dd4028acb54c28aa50c`
- Integration branch/worktree: `codex/mvp-s05-integration` / `/Volumes/Projects/ketos-mvp-stage05-integration`

Admission was proved before implementation: the Stage-04 base is an ancestor of the candidate, the matching PostgreSQL 16.14 attestation reported `accepting connections`, and the worktree was clean. Graphify was used query-only; its stale/noisy graph was not rebuilt and direct source remained authoritative.

The closure documentation commit is intentionally not self-referential. Its immutable SHA and tree are captured by the final external acceptance run after this handoff is committed.

## Blocker resolution and architecture

The shared mutable CopilotKit identity defect is resolved with the official proxy contract:

```ts
copilotkit.registerProxiedAgent({
  agentId: `ketos-chat--${chatId}`,
  runtimeAgentId: CHAT_RUNTIME_AGENT_ID,
});
```

Each durable Chat Placement therefore owns a deterministic browser-local `agentId`, while every proxy still routes to the one required remote runtime agent `ketos-chat`. Stock `CopilotChat` receives the local ID and durable Chat UUID as `threadId`. The lifecycle is effect-owned, validates UUIDs, unregisters on cleanup and prop changes, fails closed on collision, and exposes retry without introducing a second provider or custom chat body.

This follows the official [ProxiedCopilotRuntimeAgent reference](https://docs.copilotkit.ai/reference/core/classes/ProxiedCopilotRuntimeAgent) and the official [CopilotKit replacement PR](https://github.com/CopilotKit/CopilotKit/pull/4629). Official documentation was used instead of Context7. The installed pinned package declarations and runtime were also checked directly. No dependency manifest or lock file was changed.

Ketos remains the authorization and durable-truth boundary: owner-scoped APIs validate project/placement targets, `ChatRun` enforces idempotency, ordered committed `MessageTable` rows hydrate transcripts, and the fixed CopilotKit route reaches only the KFX/LangGraph implementation.

## Recovery commit ledger

| Commit | Purpose |
| --- | --- |
| `a701be3fb8126f8fc6cc5237d5901395f6f7f3f8` | durable chat persistence |
| `e177c3c8aa2afef245adbb7349351fe105715c7b` | concurrency-safe repository |
| `ad4594be0826170c0d3cc8aae43f3c3f59c28875` | boundary fixtures |
| `16d6c9cbf455c93e1d902272b858cda9b75e99cb` | startup migration ordering |
| `2ca62ea971553f3370596351e6d3ce5d207cc317` | committed transcript adapter |
| `b344700e26863fae1a74d00aee5bb8e69900b822` | owner-scoped chat API |
| `220f896414d8f63d3bd6397834d371a13445c356` | durable AG-UI binder |
| `bd5ccfea8eafa6a1d4a829212d5005a670cf0af5` | fixed remote CopilotKit agent |
| `1e9bda4830b11ff7bffca5424fa23a83a2755e34` | stock Chat placement |
| `afb36b8078e6f9b1a2ae96073e583470327c34ff` | legacy type compatibility |
| `636ccdb33c3c8fd2aeda1d18c0043d5b73ed247a` | durable list queries |
| `dbf543f44a0440938f46a93fa58cdff78bb86104` | legacy stack isolation |
| `9ce671d064016148e739287630710002e55c95be` | original integrated candidate and reproduced blocker |
| `d6d97b9` | exact blocker handoff |
| `3070a079cdb76ba3d25abdf3f7f8f5cfda84c787` | recovery design |
| `4d5e96c202039473be234189f3b0ea746506aeca` | recovery execution plan |
| `de33918` | thread-scoped proxy binding |
| `699040a` | isolated stock placement identities |
| `a75cc80` | two durable threads in the browser story |
| `19fdeea` | durable transcript hydration |
| `1828f9cde0e` | collision-free replacement placement |
| `aec60c0` | current-run Product Design evidence |
| `f9f5ae7` | executable Vitest gate command |
| `2653920a3dfef279f4221443bcf31d6a2dc396f3` | deterministic serial recovery gate |

The bounded range changes 74 paths spanning the Stage-05 backend model/repository/API/migration, AG-UI and runtime adapter, stock frontend integration, focused tests, browser proof, locales, evidence, plan/handoff, and the serial gate runner. It contains no package lock, generated deployment output, `LICENSE`, `NOTICE`, vendor, deployment, or `graphify-out` change.

Substantive task and review packets were delegated under repository policy. Subagents received self-contained source slices and returned only requested code/diff or review text; the main agent alone inspected the workspace, called tools, applied every patch, ran every command, integrated findings, and verified the result.

## Serial gate ledger

Candidate gate command:

```bash
source /Volumes/Projects/.ketos-stage04-runtime-20260719/connection.env
export MVP_POSTGRES_URI
./scripts/mvp/run_stage05_recovery_gate.sh /Volumes/Projects/.ketos-stage05-gate.2653920a3dfe.1EJUWy
```

- Tested SHA: `2653920a3dfef279f4221443bcf31d6a2dc396f3`
- Tested tree: `e1533e2077b684085fa85dd4028acb54c28aa50c`
- Started: `2026-07-20T12:57:06Z`
- Finished: `2026-07-20T13:04:18Z`
- Exit code: `0`
- External root: `/Volumes/Projects/.ketos-stage05-gate.2653920a3dfe.1EJUWy`
- Full log: `/Volumes/Projects/.ketos-stage05-gate.2653920a3dfe.1EJUWy/final-gate.log`

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend focused | PASS | 47 passed |
| SQLite migration/model | PASS | 11 passed, 5 skipped; required Stage-05 nodes executed |
| PostgreSQL migration/model | PASS | 15 passed, 1 skipped; required Stage-05 nodes executed against PostgreSQL 16.14 |
| AG-UI adapter and boundary guard | PASS | 105 passed |
| Runtime Vitest | PASS | 2 passed |
| Runtime typecheck/build | PASS | both exit 0 |
| Frontend focused Jest | PASS | 10 suites, 91 tests |
| Locales | PASS | zero blocking consistency errors |
| Production TypeScript | PASS | exit 0 |
| Frontend build | PASS | exit 0; 30.73 seconds |
| Browser main story | PASS | 1 passed; 1.8 minutes |
| Browser flag-off story | PASS | 1 passed; 45.1 seconds |
| Browser restore story | PASS | 1 passed; 45.4 seconds |
| Bounded diff and cleanliness | PASS | `git diff --check`, prohibited-path scan, and clean status |

The corrected runtime command is `npm test -- src/__tests__/ketos-chat.test.ts`; the former Jest-only `--runInBand` argument is not accepted by Vitest 4. Both plan occurrences and the serial gate use the executable command.

Changed frontend files also pass focused Biome. Full `npm run lint` exits 0 with 38 warnings in unchanged baseline files; no Stage-05 warning remains in the changed frontend set.

## S05-A01–A10

| Task | Gate | Evidence |
| --- | --- | --- |
| S05-A01 | PASS | additive chat models and migration; SQLite/PostgreSQL parity green |
| S05-A02 | PASS | atomic allocation, CAS, replay, conflict, and simultaneous-writer tests |
| S05-A03 | PASS | exact ordered committed `MessageTable` snapshot with owner join |
| S05-A04 | PASS | owner CRUD/search/CAS; server-owned provider/model/context |
| S05-A05 | PASS | standard AG-UI events, durable binding/replay, KFX tool path |
| S05-A06 | PASS | one fixed remote runtime; corrected test, typecheck, and build gate |
| S05-A07 | PASS | distinct local proxy identities, stock Chat, cleanup/collision/malformed-ID/retry tests |
| S05-A08 | PASS | typed query/mutation seams, search, create, rename, open, close, and re-place |
| S05-A09 | PASS | source boundary, i18n, and legacy isolation guards |
| S05-A10 | PASS | registrars/validator/wiring plus complete real-browser and five-state evidence |

## Completion criteria C01–C17

| Criterion | Gate | Evidence |
| --- | --- | --- |
| C01 practical deliverables | PASS | A01–A10 are complete on the frozen candidate |
| C02 one exact SHA | PASS | candidate SHA/tree and external serial evidence are immutable |
| C03 stock CopilotKit | PASS | stock body/composer/messages and executable source guard |
| C04 standard AG-UI | PASS | standard events/tool/snapshot tests and live browser tool run |
| C05 KFX/LangGraph only | PASS | boundary guard and live CurrentDate KFX tool path |
| C06 durable MessageTable truth | PASS | ordered committed adapter and browser-verified database rows |
| C07 distinct identities | PASS | two local proxy IDs, one remote `ketos-chat`, correct thread IDs in both bodies |
| C08 auth/idempotency/reload | PASS | owner/foreign/replay/fingerprint gates and restore run |
| C09 five UX states/focus | PASS | five screenshots, error/reconnect, restored focus, and non-overlap assertion |
| C10 tokens and UI-only flag | PASS | semantic tokens and controlled `mvp_chat` seam |
| C11 CardFrame/placement geometry | PASS | unit contracts and real bounding-box non-intersection |
| C12 chat target validation | PASS | existing owner/same-project and negative target tests |
| C13 legacy isolation | PASS | focused 91-test gate and boundary source guard |
| C14 no custom stack | PASS | one provider, stock Chat, standard AG-UI, fixed runtime, no fallback renderer |
| C15 default-off data preservation | PASS | flag-off and re-enable runs preserve IDs and transcripts |
| C16 SQLite/PostgreSQL parity | PASS | both dialect gates exit 0 |
| C17 bounded clean range | PASS | 74 paths, no prohibited changes, clean candidate status |

## Browser and durable evidence

The deterministic local provider supplied only the external OpenAI-compatible model stream. Ketos UI, API, auth, SQLite persistence, CopilotKit transport, AG-UI adapter, LangGraph/KFX execution, focus, geometry, and user interactions were real.

The main browser run proved both directions of isolation: two stock Chat regions submitted distinct prompts; two intercepted primary request bodies carried their own durable UUID; each answer appeared only in its originating region; each Chat persisted one `ChatRun` and ordered message sequences `1, 2`; exact replay made zero new provider calls. Collapse/remount, close/re-place, controlled error/reconnect, feature-flag disable, and restore preserved the independent histories.

The in-flight UI assertion proves the stock composer enters its Stop state and emits only one primary browser request while the provider is pending. The repository test independently proves simultaneous identical idempotency keys coalesce to one durable row, and the later browser replay proves no provider call. An exploratory uncommitted duplicate Node transport experiment serialized/retried and was unsuitable as an acceptance assertion; it was reverted completely and did not alter the candidate. No second provider call or product defect was observed.

## Security, code review, and audit disposition

- Owner/project joins and target validation prevent cross-owner placement or transcript access; foreign and forged-authority negatives pass.
- Provider, model, prompt/context, durable sequence, and replay fingerprints remain server-owned; disallowed overrides fail closed.
- UUID validation, bounded snapshots, collision handling, effect cleanup, StrictMode behavior, and idempotent replay have focused tests.
- No secret is committed or printed. PostgreSQL credentials were sourced from the Stage-04 environment without echoing their values.
- Backend, frontend, security, run-review, and adversarial review found no open Critical, High, or Medium Stage-05 product defect.
- RaytSystem security and run-review preflights passed read-only with a clean checkpoint; Graphify was not modified.

## Product Design artifacts and limits

- [Product Design audit](../../evidence/stage-05/product-design/audit.md)
- [01 empty](../../evidence/stage-05/product-design/01-empty.png)
- [02 search no results](../../evidence/stage-05/product-design/02-search-no-results.png)
- [03 two chats](../../evidence/stage-05/product-design/03-two-chats.png)
- [04 error and reconnect](../../evidence/stage-05/product-design/04-error-reconnect.png)
- [05 close, replace, and focus](../../evidence/stage-05/product-design/05-close-replace-focus.png)

All five current-run images were inspected at original resolution. Computer Use additionally opened `03-two-chats.png` in macOS Preview. Chrome was initialized and finalized, but its URL policy rejected the local `file://` image; no Chrome image-inspection claim is made. Playwright assertions are authoritative and screenshots supplement them. The focused audit does not claim full WCAG conformance.

## Rollback and stage boundary

Setting `mvp_chat=false` hides the Stage-05 UI without deleting durable Chat, run, or message data; the controlled off/on browser runs prove survival. Code rollback requires reverting the Stage-05 recovery commits and necessarily revokes the Stage-05 PASS until the full gate is rerun.

The unrelated root checkout state was preserved because all implementation occurred in the linked integration worktree. No merge, rebase, push, worktree deletion, promotion, or Stage-06 implementation was performed.

Transition S05 -> S06: GO

Stage 06 started: no
