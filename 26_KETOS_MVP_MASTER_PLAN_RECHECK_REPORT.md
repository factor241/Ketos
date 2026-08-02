# Ketos MVP — повторная проверка и пересборка мастер-плана

**Дата:** 2026-07-18
**Проверяемый документ:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`
**Baseline:** `main@5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`
**Итог:** `PASS — план пересобран и готов к реализации MVP`
**Важно:** этот статус относится к качеству и исполнимости плана. Product code десяти этапов ещё не реализован.

## 1. Что перепроверено

Повторная проверка выполнена с нуля по текущему checkout, обновлённому Graphify snapshot, нормативному `01_KETOS_REQUIREMENTS.md`, исходникам backend/frontend/KFX и актуальной документации CopilotKit, AG-UI и LangGraph.

Проверены:

- точность baseline, Alembic head, dirty state и Graphify provenance;
- все R-01…R-40, исходные AC-01…AC-12 и NFR-01…NFR-10;
- все 10 этапов, 100 практических agent assignments, dependency DAG и лимит 3–5 активных агентов;
- реальные source paths, registrars, package/lock ownership, test commands и Playwright orchestration;
- Project/Folder, Board/Placement/Note, Chat/MessageTable, Flow/FlowVersion, Job и Command boundaries;
- CopilotKit/AG-UI/KFX/LangGraph deployment, auth, interrupt/resume и restart contracts;
- Post-MVP отделение coverage, длительной телеметрии, полного route audit, load/soak и release engineering.

## 2. Baseline и Graphify evidence

| Evidence | Значение |
| --- | --- |
| Branch / HEAD | `main` / `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782` |
| Alembic head | `9a6e34f1c2d8` |
| Historical audited SHA | `80878261d07c21ad257de017d98069f211ada2c2` |
| Historical → current `src/**` diff | `git diff --quiet ... -- src` → `PASS` |
| Graphify `built_at_commit` | `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782` |
| Graphify graph | `66 028` nodes / `131 650` links |
| `graphify-out/graph.json` | `93 045 494` bytes; SHA-256 `03c2ececa6d6a2e93f0afa8b80828f67cc52dedf4c355c9df51572467fb1298b` |
| `graphify-out/GRAPH_REPORT.md` | `677 607` bytes; SHA-256 `9d2768dcfb93bc47e700217d7cff2baeaa59264ed896130bef30b190a71fbc2f` |

Graphify использован read-only для BFS/DFS-навигации по семействам `project/folder`, `board/placement`, `chat/message/agentic`, `flow/job/execution` и `command/runtime`. Граф не перестраивался и не изменялся. Источники подтвердили важное различие: Board/Placement/ChatThread пока представлены в документах, но отсутствуют в product source; Job/Flow/AssistantPanel/KFX AgentComponent уже существуют.

RaytSystem применён только как дополнительная read-only проверка. Его собственный code graph сообщает `stale: checkout_changed`, поэтому он не использован как source authority; `raytsystem lint` при этом не нашёл findings. Обновлять RaytSystem/Graphify generated stores в рамках документационной задачи не требовалось.

## 3. Подтверждённые source facts

| Область | Подтверждённая текущая истина | Влияние на новый план |
| --- | --- | --- |
| Project | `Folder` и `/api/v1/projects` уже содержат encryption, MCP reconciliation, deployment guards и Flow move side effects. | Запрещён новый урезанный Project CRUD/service; переиспользуется существующий route/UI/cache. |
| Project auth | Project list допускает NULL-owner, тогда как direct read owner-scoped. | MVP зафиксирован owner-only; NULL не означает public; list/open/rename согласуются. |
| Frontend Project | Sidebar уже реализует create/list/rename/navigation и один project/folder cache. | Удалено дублирование ProjectList/dialog/query namespace; добавляется только Board shell. |
| Assistant | Текущий AssistantPanel и `use-post-assist-stream.ts` используют собственные widgets/SSE dialect. | Legacy path остаётся изолированным; новый Board Chat использует только CopilotKit/AG-UI. |
| Agent runtime | `AgentComponent` создаёт LangGraph graph; внешний Flow Builder остаётся KFX Graph. Готового AG-UI endpoint нет. | Stage 01 создаёт новый официальный bridge; Stage 08 — отдельную HITL assembly, а не node во внешнем KFX Graph. |
| Auth session | Browser auth cookie-first через HttpOnly `access_token_lf`; Authorization после reload не гарантирован. | Runtime forward-ит Bearer либо sanitized access cookie, но не refresh/API-key cookies. |
| MessageTable | Реальное content field — `text`; owner отсутствует; `session_metadata` client-provided. | Chat auth идёт `Message → ChatThread → Folder`; metadata не доверяется; добавлены nullable FKs и sequence uniqueness. |
| Flow/Version | У Flow нет DB revision; FlowVersion content snapshot может удаляться/prune-иться. | Добавлены `Flow.revision` CAS, pinned snapshot и минимальный restore pre-AI version. |
| Job | `user_id` nullable, protected reads допускают NULL, sort использует несуществующий `created_at`, dedupe race-prone. | Job safe floor перенесён в Stage 01; Stage 07 добавляет atomic claim/finalize и strict owner chain. |
| Workflow API | `/api/v2/workflows` требует `x-api-key`. | Browser использует mandatory session-authenticated v1 Board adapter; API key никогда не попадает во frontend. |
| Flow header | Safe `FlowHeader` не содержит status/node count и скрывает raw data. | Automation card показывает только name/description до появления Job status. |
| Frontend runtime | Vite не proxy-ит `/api/copilotkit`, Playwright запускает только два процесса. | Stage 01 добавляет отдельный proxy и dedicated three-process MVP config. |

## 4. Документационный contract после Context7

Context7 использован по library IDs:

- CopilotKit: `/copilotkit/copilotkit`;
- AG-UI: `/ag-ui-protocol/ag-ui`;
- LangGraph: `/langchain-ai/langgraph`.

Проверенные dependency facts на дату проверки:

- `@copilotkit/react-core 1.63.1`;
- `@copilotkit/runtime 1.63.1`;
- `@ag-ui/client 0.0.57`;
- `langgraph-checkpoint-sqlite 3.1.0`;
- уже закреплённые `ag-ui-protocol 0.1.19`, `langgraph 1.2.8`, `langgraph-checkpoint 4.1.1` удовлетворяют saver constraints;
- опубликованный `ag-ui-langgraph 0.0.42` **не совместим** с требуемым standard interrupt contract.

Свежий artifact probe 0.0.42 подтвердил: constructor не имеет документированных flags standard interrupt outcome, adapter читает resume через deprecated `forwarded_props.command.resume` и формирует `RUN_FINISHED` без standard interrupt outcome. Поэтому версия отклонена и не называется совместимой.

План теперь требует повторной проверки и pin точных artifacts в Stage 01. Зафиксированный путь:

```text
@copilotkit/react-core/v2
→ same-origin /api/copilotkit
→ @copilotkit/runtime/v2 + /v2/node
→ HttpAgent from @ag-ui/client
→ authenticated FastAPI middleware
→ только executable-proven upstream AG-UI/LangGraph adapter artifact
→ KFX AgentComponent / dedicated LangGraph assembly
```

Stage 01 теперь является честным admission gate: он сначала ищет released package либо immutable upstream commit, который executable probe подтверждает на standard outcome/resume. Если такого artifact нет, статус этапа `BLOCKED`, а Stage 02 не начинается; custom wrapper/protocol fallback запрещён. Требуемый contract: snapshots до `RUN_FINISHED(interrupt)`, core reason `confirmation`, все open interrupts, тот же thread/new run, `useInterrupt`, `resolve({approved:true|false})`, invalid/partial/stale resume → `RUN_ERROR`. Restart использует file-backed `AsyncSqliteSaver`, не memory saver.

Primary references:

- [CopilotKit v2 reference](https://docs.copilotkit.ai/reference/v2)
- [CopilotKit runtime server adapters](https://docs.copilotkit.ai/langgraph-python/runtime-server-adapter)
- [CopilotKit useInterrupt](https://docs.copilotkit.ai/reference/hooks/useInterrupt)
- [AG-UI interrupts](https://docs.ag-ui.com/concepts/interrupts)
- [AG-UI LangGraph integration](https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [LangGraph SQLite saver](https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-sqlite)

Отдельно обнаружена license metadata inconsistency между registry artifacts и продуктовой страницей CopilotKit. План не делает предположение: dependency registrar сохраняет LICENSE/hash конкретных pinned artifacts в decision record и не изменяет repo `LICENSE`/`NOTICE`.

## 5. Что именно пересобрано в мастер-плане

1. Baseline и Graphify metadata обновлены до текущего exact SHA.
2. Зафиксирован один OSS transport shape и executable adapter admission; несовместимый 0.0.42, Enterprise/dev-only и custom fallbacks отклонены.
3. Project/Board/Chat/Automation MVP ограничен owner-only model с единым parent Project guard.
4. Добавлены нормативные карты 40/40 R, 12/12 AC и 10/10 NFR без переопределения исходных ID.
5. Agent orchestration заменена на dependency DAG с producer micro-sync; producer/consumer больше не стартуют фиктивно от одного SHA.
6. Stage 01 теперь включает real KFX seam, SQLite checkpoint, cookie-safe auth, three-process browser probe, runtime feature flags и ранний Job safe floor.
7. Project stage переиспользует существующие backend/UI/cache seams и закрывает NULL-owner/header/Settings scope traps.
8. Board/Placement/Note/Chat updates требуют conditional DB-CAS; Note получает минимальный sanitized Markdown; Chat — exact MessageTable integrity и durable model/context.
9. Automation card больше не выдумывает status/node count; create всегда получает explicit target Project.
10. Stage 07 использует mandatory v1 session adapter, atomic one-enqueue claim, atomic terminal result и нормативную UI status projection.
11. Stage 08 добавляет `Flow.revision`, base revision+hash, pinned FlowVersion, одну обязательную DB transaction, opt-in proposal toolkit, standard `useInterrupt` и минимальный restore.
12. Stage 09 требует restart между разными PID и честную reconciliation nonterminal ChatRun/Job.
13. Stage 10 теперь проверяет Note formatting, UI statuses, Settings, feature-flag data preservation, PostgreSQL dialect, isolated KFX и LFX compatibility.
14. Coverage, 24-hour telemetry, full route audit, load/soak, full accessibility matrix и commercial rollout остались только Post-MVP.

## 6. Субагенты и независимые аудиты

Core-аудит проведён двумя bounded waves, не более пяти одновременно: 10 lanes, девять содержательных final reports и один остановленный зависший frontend lane. Его scope полностью повторил `recheck_frontend_paths`, который дал `PASS`. Затем отдельно запущены три финальных read-only gate; они нашли Python adapter drift, report whitespace/status mismatch и три формальных противоречия. Все findings интегрированы, после чего проверки повторены локально.

| Lane | Scope | Итог |
| --- | --- | --- |
| backend/domain | Project/Folder/Flow/FlowVersion/registrars | Must-fix findings integrated |
| data/jobs | Job ownership, idempotency, migration, CAS, restart | Must-fix findings integrated |
| agent runtime | Actual KFX/LangGraph/legacy Assistant boundary | Must-fix findings integrated |
| plan contract | 10 stages, 100 tasks, commands, contradictions | Must-fix findings integrated |
| initial frontend | UI/routes | Stopped after hang; no edits |
| docs contract | Context7 + primary CopilotKit/AG-UI/LangGraph | Exact contract integrated |
| frontend paths | UI/cache/routes/flags/status/Settings | Final `PASS` |
| security boundaries | auth, ownership, CAS, API-key boundary | Must-fix findings integrated |
| commands/paths | pytest/KFX/LFX/Playwright/locks/migrations | Must-fix findings integrated |
| adversarial plan | requirements, DAG, status semantics, Post-MVP | Findings integrated; rechecked structurally |
| final plan gate | Current structure/status/wave semantics | Findings integrated |
| final source gate | Highest-risk source/package seams | Adapter drift integrated |
| final report gate | Hashes/counts/dirty-state/overclaims | Findings integrated |

Все агенты работали read-only; product source, locks, generated artifacts и deployment files ими не менялись.

## 7. Structural verification новой редакции

| Check | Result |
| --- | --- |
| MVP stages | `10/10` — 01…10 |
| Practical subagent tasks | `100/100` — ровно A01…A10 на каждом этапе |
| Per-task verification cells | `100/100` непустые |
| R requirements | `40/40` |
| Normative AC | `12/12` |
| Normative NFR | `10/10` |
| TODO/TBD/FIXME | `0` |
| Старые KFX nonexistent paths | `0` |
| Enterprise/dev-only fallback references | `0` |
| Fourth completion status | `0`; только PASS/BLOCKED/FAIL |
| `git diff --check` | `PASS` |
| Plan diff | `291 insertions / 206 deletions` |
| Current plan SHA-256 | `5ba86b26e4fad69eb8bc2850181dc6f3f0279862abef96ea3e686e87e817663c` |

## 8. Tool limits и честные исключения

- Product Design skill применён к структуре будущего focused Stage-10 audit. Actual screenshot audit сейчас не выполнялся: Board MVP surface ещё не существует, и browser evidence было бы выдуманным.
- По той же причине Chrome/Computer Use не запускались для несуществующего UI. В плане они назначены после реализации vertical slice, когда проверка сможет дать реальное доказательство.
- Product tests не запускались: текущая задача изменяет только Markdown plan/report. Проверялись current source paths, test collection facts, docs contracts и структура документа.
- PostgreSQL MVP gate добавлен в план, но не запускался сейчас, поскольку migrations MVP ещё не написаны.
- Graphify не перестраивался после пользовательского обновления и не изменял generated files.

## 9. Dirty-state и scope

До начала проверки worktree был clean. После пересборки ожидаются только:

```text
modified: 14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md
untracked: 26_KETOS_MVP_MASTER_PLAN_RECHECK_REPORT.md
```

Product source, lock files, `.playwright-mcp/`, Graphify outputs, RaytSystem stores, deployment config, `LICENSE` и `NOTICE` не изменены.

## 10. Финальный вердикт

`PASS — мастер-план пересобран и готов к поэтапной реализации MVP.`

План теперь описывает быстрый, но фактически проверяемый vertical slice. Он не требует commercial-release программы в основном потоке, но не маскирует как Post-MVP те минимальные invariants, без которых demo было бы небезопасным или недостоверным: owner-only access, one-effect idempotency, DB-CAS, explicit confirmation, safe browser auth, durable restart и real API/KFX/LFX compatibility.

Известный admission risk указан прямо: `ag-ui-langgraph 0.0.42` Stage 01 не проходит. Реализация либо закрепит иной upstream artifact после executable proof и продолжит с `PASS`, либо честно остановится со статусом `BLOCKED`. Это не дефект планирования и не разрешение на самописный protocol fallback.
