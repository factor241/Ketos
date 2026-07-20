# Ketos Stage 05 — durable chat handoff

## Control verdict

- User-facing status: **этап заблокирован**
- Internal gate: **BLOCKED**
- Transition S05 → S06: **NO-GO**
- Stage 06 started: **no**
- Stage-04 PASS base: `1ea57de7aa88dc8cff2cc2818af8e69d3420542c`
- Product candidate: `9ce671d064016148e739287630710002e55c95be`
- Candidate tree: `62a9fea7979c056f6540bd5606d3983d703bbe81`
- Integration branch/worktree: `codex/mvp-s05-integration` / `/Volumes/Projects/ketos-mvp-stage05-integration`

Admission passed: the Stage-04 transition and PostgreSQL attestation were present, the worktree was isolated and clean, the actual Stage-04 Alembic head was used, Graphify was query-only, and RaytSystem diagnostics were read-only.

## Exact blocker

The required pinned frontend dependency, `@copilotkit/react-core@1.63.1-ketos.1`, cannot keep two simultaneously mounted stock `CopilotChat` instances isolated when both use the mandated fixed agent ID `ketos-chat`.

Runtime evidence:

1. The browser clicked and submitted from the **Release evidence** region.
2. The outgoing AG-UI run body contained the **Operations notes** thread ID.
3. The assertion failed with expected `27f7ebf9-c455-46ac-806d-a1a9b111389b`, received `6d11fbf5-45d9-4462-bd30-d61940c2e686`.
4. Other repetitions showed the complementary race: the durable run could commit under the first chat while the answer did not appear in that chat's UI.

Installed-build evidence:

- `useAgent({ agentId, ... })` calls `copilotkit.getAgent(resolvedAgentId)`; `threadId` is not part of the cache key.
- every mounted chat effect assigns `agent.threadId = resolvedThreadId`.
- package source: `src/frontend/node_modules/@copilotkit/react-core/dist/copilotkit-wHkxJEK-.mjs:4391-4404,4488-4497,8190-8197`.

This contradicts the required distinct-thread behavior described by the official [CopilotChat reference](https://docs.copilotkit.ai/reference/v2/components/CopilotChat). Official documentation was used instead of Context7, as requested. Related official contracts: [CopilotKit runtime backend](https://docs.copilotkit.ai/a2a/backend/copilot-runtime), [AG-UI events](https://docs.ag-ui.com/concepts/events), [AG-UI messages](https://docs.ag-ui.com/concepts/messages), [AG-UI interrupts](https://docs.ag-ui.com/concepts/interrupts), [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).

Forbidden fallbacks were not applied:

- no second `CopilotKitProvider`;
- no per-card alternate agent ID;
- no wrapper/replacement chat body or custom agent surface;
- no custom AG-UI protocol;
- no package manifest or lock modification.

Minimal unblock: approve/admit a pinned CopilotKit build that isolates stock chat state by `(agentId, threadId)`, then rerun the complete exact gate on a new immutable candidate SHA. Dependency admission, not Stage-05 application code, owns that change.

## Task ledger

| Task | State | Gate | Evidence |
| --- | --- | --- | --- |
| S05-A01 | Выполнено | PASS | additive models/migration; SQLite and PostgreSQL parity |
| S05-A02 | Выполнено | PASS | CAS, atomic allocation, replay, conflict and two-writer tests |
| S05-A03 | Выполнено | PASS | ordered committed MessageTable snapshot and owner join |
| S05-A04 | Выполнено | PASS | owner CRUD/search/CAS and server-owned model/context |
| S05-A05 | Выполнено | PASS | standard AG-UI events, durable binding, replay and KFX tool |
| S05-A06 | Выполнено | PASS | one fixed runtime agent; test/typecheck/build |
| S05-A07 | Частично выполнено | BLOCKED | stock placement is implemented; external pinned package fails distinct-thread contract |
| S05-A08 | Выполнено | PASS | typed query/mutation seams, search, create/rename/open/re-place |
| S05-A09 | Выполнено | PASS | source boundary, i18n and legacy isolation |
| S05-A10 | Частично выполнено | FAIL | registrars/validator/wiring and screenshots 01–03 complete; real-browser story stops at upstream isolation defect |

Commits, in execution order:

```text
a701be3fb8126f8fc6cc5237d5901395f6f7f3f8  durable persistence
e177c3c8aa2afef245adbb7349351fe105715c7b  concurrency-safe repository
ad4594be0826170c0d3cc8aae43f3c3f59c28875  boundary fixtures
16d6c9cbf455c93e1d902272b858cda9b75e99cb  startup migration ordering
2ca62ea971553f3370596351e6d3ce5d207cc317  transcript adapter
b344700e26863fae1a74d00aee5bb8e69900b822  owner-scoped API
220f896414d8f63d3bd6397834d371a13445c356  durable AG-UI binder
bd5ccfea8eafa6a1d4a829212d5005a670cf0af5  fixed CopilotKit agent
1e9bda4830b11ff7bffca5424fa23a83a2755e34  stock placement
afb36b8078e6f9b1a2ae96073e583470327c34ff  legacy type compatibility
636ccdb33c3c8fd2aeda1d18c0043d5b73ed247a  durable list queries
dbf543f44a0440938f46a93fa58cdff78bb86104  legacy stack isolation
9ce671d064016148e739287630710002e55c95be  integrated candidate and browser evidence
```

Ten policy-compliant substantive subagent packets S05-A01…S05-A10 were used. Per repository policy, subagents received self-contained excerpts and returned only requested code/diff text; the main agent performed every tool call, patch, integration, test and review.

## Serial gate ledger

| Gate | Result | Exact/equivalent command | Evidence |
| --- | --- | --- | --- |
| Backend focused | PASS, exit 0 | `uv run pytest src/backend/tests/unit/services/chat_threads src/backend/tests/unit/services/board/test_placement_service.py src/backend/tests/unit/agentic/api/test_ag_ui_router.py src/backend/tests/unit/api/v1/test_chat_threads.py -q` | 46 passed |
| Ruff changed backend | PASS, exit 0 | `uv run ruff check <changed backend paths>` | all checks passed |
| SQLite migration/model | PASS, exit 0 | Plan §10.2 SQLite command | 11 passed, 5 skipped; required Stage-05 nodes passed |
| PostgreSQL migration/model | PASS, exit 0 | Plan §10.2 PostgreSQL command with local Stage-04 `MVP_POSTGRES_URI` | 15 passed, 1 skipped; required PostgreSQL nodes passed |
| Adapter/boundary | PASS, exit 0 | Plan §10.2 adapter + boundary command | 104 passed |
| Runtime exact command | FAIL, exit 1 | `npm test -- --runInBand ...` | Vitest 4 rejects unknown `--runInBand`; plan-command incompatibility |
| Runtime equivalent | PASS, exit 0 | `npm test -- src/__tests__/ketos-chat.test.ts` | 2 passed |
| Runtime typecheck/build | PASS, exit 0 | `npm run typecheck`; `npm run build` | both exit 0 |
| Frontend focused | PASS, exit 0 | Plan §10.2 Jest command | 77 passed |
| A10 focused frontend | PASS, exit 0 | five Board/chat suites | 22 passed |
| i18n | PASS, exit 0 | `npm run i18n:check` | en 2435, ru 2507, zero issues |
| Production TypeScript | PASS, exit 0 | `npm run type-check:production` | exit 0 |
| Full test TypeScript | inherited baseline FAIL, exit 2 | `npm run type-check` | same five pre-existing test-only errors reproduce on base SHA |
| Frontend build | PASS, exit 0 | `npm run build` | 14,450 modules transformed |
| Biome changed frontend | PASS, exit 0 | `npx biome check <changed frontend paths>` | 11 files, zero findings |
| Playwright real API/DB | BLOCKED, non-zero | controlled Chromium launch with real Ketos API/SQLite and deterministic local OpenAI-compatible provider | exact cross-thread mismatch in `src/frontend/test-results/.../error-context.md` |
| Product Design | BLOCKED | visual inspection | [audit](../../evidence/stage-05/product-design/audit.md), screenshots 01–03; 04–05 not reached |

The deterministic local provider supplied only the external OpenAI-compatible model stream. Ketos UI, API, auth, SQLite persistence, AG-UI adapter, LangGraph/KFX tool execution and browser interactions were real.

## Completion criteria C01–C17

| Criterion | Gate | Evidence/verdict |
| --- | --- | --- |
| C01 practical deliverables | BLOCKED | A07 external contract blocked; A10 browser story incomplete |
| C02 one exact SHA | PASS | all implementation and evidence files are present on one closure HEAD; tested product candidate `9ce671d064016148e739287630710002e55c95be` remains recorded separately |
| C03 stock CopilotKit | PASS | stock body/composer/messages; source/Jest guard green |
| C04 standard AG-UI | PASS | standard events/tool/snapshot tests and live tool run |
| C05 KFX/LangGraph only | PASS | boundary guard plus CurrentDate KFX tool |
| C06 MessageTable durable truth | PASS | ordered committed adapter and live DB rows |
| C07 distinct identities | BLOCKED | confirmed shared mutable frontend agent/thread |
| C08 auth/idempotency/reload | PASS | owner, foreign, replay and fingerprint gates green |
| C09 five UX states/focus | FAIL | Jest coverage green; complete E2E and captures 04–05 not reached |
| C10 tokens/UI-only flag | PASS | semantic tokens and controlled flag seam implemented |
| C11 CardFrame/Placement geometry | PASS | unit/integration contracts green |
| C12 chat target validation | PASS | existing/owner/same-project and negative tests green |
| C13 legacy isolation | PASS | named 77-test frontend gate and source guard green |
| C14 no custom stack | PASS | executable boundary guard green |
| C15 default-off data preservation | FAIL | implementation/tests exist; controlled full browser restore step not reached |
| C16 SQLite/PostgreSQL parity | PASS | both dialect gates exit 0 |
| C17 bounded clean range | PASS for candidate | no package/lock/generated/deployment/license/notice changes; candidate status clean |

## Security and review disposition

- owner/project scoping, forged authority rejection, IDOR negatives, bounded state and replay fingerprint conflicts are covered by passing backend tests;
- no secrets are committed or printed; PostgreSQL credentials were sourced without echoing values;
- no unapproved external side effect, promotion, notification or network exposure was performed;
- backend/frontend/security/run-review checklists found no open critical Stage-05 application-code defect besides the dependency contract blocker;
- RaytSystem security/run-review preflights passed read-only; Chrome and Computer Use MCP controllers were unavailable and are recorded as unavailable rather than simulated.

## Artifacts

- [Product Design audit](../../evidence/stage-05/product-design/audit.md)
- [01 empty](../../evidence/stage-05/product-design/01-empty.png)
- [02 search no results](../../evidence/stage-05/product-design/02-search-no-results.png)
- [03 two chats](../../evidence/stage-05/product-design/03-two-chats.png)
- Local Playwright failure: `src/frontend/test-results/core-integrations-board-co-87cd0-acement-lifecycle-and-focus-chromium/error-context.md`

Unrelated root checkout state was preserved; implementation stayed in the linked Stage-05 worktree. Stage 06 was not started.
