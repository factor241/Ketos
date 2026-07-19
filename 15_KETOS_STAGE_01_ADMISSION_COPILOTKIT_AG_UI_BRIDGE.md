# Этап 01 — Admission и доказательство CopilotKit/AG-UI vertical bridge

> **Обязательный режим исполнения:** этап выполняется через `superpowers:subagent-driven-development` либо `superpowers:executing-plans` с десятью практическими субагентами `S01-A01…S01-A10`. Одновременно работают 3–5 субагентов, если существуют хотя бы три независимые задачи. Каждый субагент обязан использовать все доступные и релевантные инструменты, а недоступность инструмента зафиксировать с точным вызовом, ошибкой и влиянием на verdict. Следующий этап запрещён до полного `PASS` этого этапа.

**Нормативный источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`.  
**Baseline входа:** `main@5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`, Alembic head `9a6e34f1c2d8`.  
**Выход этапа:** один доказанный, default-off, не продуктовый bridge `CopilotKit React → CopilotKit Runtime v2 → HttpAgent → authenticated FastAPI → proven ag-ui-langgraph artifact → KFX AgentComponent/LangGraph` и fail-closed floor для защищённых Job reads/cancel paths.  
**Строгая семантика:** только `PASS`, `FAIL` или `BLOCKED`. `PARTIAL` как статус запрещён. Русская фраза «этап выполнен частично» является только отображением `FAIL`, а не четвёртым статусом.

---

## 1. Номер и название этапа

**Номер:** 01 из 10.  
**Название:** Admission и доказательство CopilotKit/AG-UI vertical bridge.  
**Позиция в программе:** первый обязательный admission-stage; формирует transport contract для Этапа 05 и authorization floor для последующих Job-сценариев.  
**Вход:** только baseline repository и доступная локальная среда.  
**Выход:** проверяемый transport fixture и handoff; продуктовый `ChatThread`, `ChatRun`, `Board`, `Placement`, `CommandProposal` и новый product Chat здесь не создаются.  
**Переход:** Этап 02 разрешён только после `Status: PASS` на одном integration SHA.

### 1.1 Границы этапа

В scope:

- admission совместимого immutable Python adapter artifact;
- точные JS/Python dependencies и принадлежащие им locks;
- transport-only Node runtime;
- authenticated FastAPI AG-UI endpoint;
- реальный KFX/LangGraph text/tool/state/HITL probe;
- file-backed checkpoint и standard interrupt/resume;
- default-off `mvp_workspace` и `mvp_chat`;
- Vite proxy и трёхпроцессный Chromium smoke;
- fail-closed Job ownership для защищённых операций;
- source guards, security checks, runbook и evidence handoff.

Вне scope:

- product Chat persistence и MessageTable migration;
- Board/Placement/BoardNote;
- собственный message list/composer/streaming UI;
- generic tool renderer;
- custom SSE/WebSocket/event protocol;
- второй agent runtime, второй LangGraph, model router или MCP orchestrator;
- AI Flow mutation, Command Kernel и business confirmation effect;
- Electron/OpenSwarm backend/state;
- embedded Flow Editor;
- production rollout, load/soak, full security route audit и full browser matrix.

---

## 2. Контекст

### 2.1 Подтверждённое текущее состояние

- CopilotKit отсутствует в `src/frontend/package.json`.
- `src/frontend/src/components/core/assistantPanel/assistant-panel.tsx`, `src/frontend/src/components/core/assistantPanel/hooks/use-assistant-chat.ts` и `src/frontend/src/controllers/API/queries/agentic/use-post-assist-stream.ts` образуют legacy Assistant stack с собственным UI и custom POST/SSE parsing. Этот stack сохраняется и не импортируется новым probe.
- Legacy endpoint находится в `src/backend/base/ketos/agentic/api/router.py` под `/api/v1/agentic/assist/stream` и возвращает `text/event-stream`. Новый path не переиспользует его protocol/parser.
- Готового AG-UI endpoint нет.
- `src/kfx/src/kfx/components/models_and_agents/agent.py` содержит persisted `AgentComponent` и строит LangGraph через `langchain.agents.create_agent`; class name, graph identifiers и KFX ABI менять запрещено.
- `src/kfx/src/kfx/mcp/flow_builder_tools/read_tools.py` содержит реальные read-only KFX tools. Для probe допускается только безопасный read-only seam.
- `src/kfx/pyproject.toml` уже содержит `ag-ui-protocol`, но наличие schema package не доказывает совместимый FastAPI/LangGraph adapter.
- `src/backend/base/ketos/services/jobs/service.py` сейчас допускает `Job.user_id IS NULL` в защищённых lookups/cancel filters и сортирует через несуществующий `Job.created_at` вместо канонического `Job.created_timestamp`.
- `src/backend/base/ketos/api/v2/workflow.py` использует защищённые get/stop paths через API-key user; эти routes должны стать exact-owner fail-closed, не меняя developer API contract.
- `src/kfx/src/kfx/services/settings/feature_flags.py`, backend `/config` и `src/frontend/src/stores/utilityStore.ts` уже образуют feature-flag seam.
- `src/frontend/vite.config.mts` сейчас proxy-ит backend API, но отдельного fixed Copilot runtime target нет.
- `src/backend/base/ketos/api/router.py` уже монтирует `ketos.agentic.api.router`; root router повторно менять для AG-UI endpoint не требуется.

### 2.2 Зафиксированный transport contract

```mermaid
flowchart LR
    UI["Stock CopilotKit probe UI"] --> VP["same-origin /api/copilotkit"]
    VP --> NR["CopilotKit Runtime v2 /v2/node"]
    NR --> HA["HttpAgent with fixed server target"]
    HA --> FA["/api/v1/agentic/ag-ui"]
    FA --> UA["Proven upstream ag-ui-langgraph adapter"]
    UA --> KA["Existing KFX AgentComponent assembly"]
    KA --> LG["Single LangGraph runtime"]
    LG --> RT["Read-only KFX tool + bounded state + core interrupt"]
    LG --> CP["File-backed AsyncSqliteSaver"]
```

### 2.3 Admission problem

Опубликованный `ag-ui-langgraph 0.0.42` отклонён: он не закрывает нормативный standard `RUN_FINISHED.outcome.type="interrupt"` + `RunAgentInput.resume[]` + all-open-interrupt contract без deprecated/custom resume path. Этап не имеет права «дописать совместимость» собственным wrapper/protocol. `S01-A01` обязан найти более новый release или immutable upstream commit и доказать hash, LICENSE, API и behavior executable probe. Если такого artifact нет либо registry/source недоступны, этап получает `BLOCKED` до package edits.

---

## 3. Цель

### 3.1 Основная цель

На одном exact integration SHA доказать путь:

`CopilotKit React /v2 → same-origin /api/copilotkit → CopilotKit Runtime v2 /v2/node → HttpAgent → authenticated /api/v1/agentic/ag-ui → proven upstream adapter → existing KFX AgentComponent/LangGraph`.

Доказательство обязано включать:

1. standard text streaming;
2. lifecycle реального read-only KFX tool;
3. bounded `STATE_SNAPSHOT`/`STATE_DELTA`;
4. standard interrupt outcome;
5. resume тем же `threadId`, новым `runId` и responses для всех открытых interrupts;
6. approve и reject;
7. invalid, partial, stale и deprecated resume denial;
8. повторную authentication/authorization на каждом run/resume;
9. file-backed checkpoint, переживающий новый app object;
10. default-off feature flags;
11. exact-owner Job access с `NULL deny`;
12. Chromium proof через три реальных процесса.

### 3.2 Цель безопасности

- FastAPI auth выполняется до adapter invocation.
- Actor всегда server-derived.
- Browser/body/header values `actor_id`, role, model, target URL и API key не являются authority.
- Node forward-ит только Bearer или sanitized `access_token_lf`.
- `refresh_token_lf`, `apikey_tkn_lflw`, `x-api-key` и произвольные cookies не уходят в FastAPI и не попадают в logs.
- Foreign/NULL-owned Job, thread и run недоступны.

### 3.3 Цель handoff

Этап 05 получает frozen dependency contract, executable fixtures, fixed ports/routes/flags, security boundary и точные reproduction commands. Этап 05 не повторяет архитектурное исследование и не создаёт альтернативный chat/runtime stack.

---

## 4. Подробное техническое задание

### 4.1 Нормативные protocol semantics

- JS shape: `@copilotkit/react-core/v2` → `@copilotkit/runtime/v2` + `@copilotkit/runtime/v2/node` → `HttpAgent` from `@ag-ui/client`.
- FastAPI path: `/api/v1/agentic/ag-ui`.
- Node public path behind Vite: `/api/copilotkit`.
- Agent registration name: `ketos-mvp-probe`; request/body target injection игнорируется.
- AG-UI interrupt:
  - snapshots отправляются до terminal event;
  - terminal event — standard `RUN_FINISHED` с `outcome.type="interrupt"`;
  - reason — core `confirmation`;
  - сохраняются `interruptId` и полный набор open interrupts.
- Resume:
  - новый `RunAgentInput`;
  - тот же `threadId`;
  - новый `runId`;
  - один response на каждый open interrupt;
  - partial/stale/invalid resume → standard `RUN_ERROR`;
  - `forwarded_props.command.resume` запрещён.
- LangGraph:
  - stable thread identity;
  - `AsyncSqliteSaver` с реальным file path, не `:memory:`;
  - `LANGGRAPH_STRICT_MSGPACK=true`;
  - `interrupt(...)` и `Command(resume=...)`;
  - node после resume выполняется заново;
  - business effect до interrupt отсутствует.

### 4.2 Dependency admission

До изменения manifests/locks `S01-A01` выполняет:

1. Context7 resolve/query отдельно для:
   - `/copilotkit/copilotkit`;
   - `/ag-ui-protocol/ag-ui`;
   - `/langchain-ai/langgraph`.
2. Сверку с official docs:
   - https://docs.copilotkit.ai/langgraph-python
   - https://docs.copilotkit.ai/langgraph-python/backend/copilot-runtime
   - https://docs.ag-ui.com/concepts/events
   - https://docs.ag-ui.com/concepts/interrupts
   - https://docs.langchain.com/oss/python/langgraph/persistence
   - https://docs.langchain.com/oss/python/langgraph/interrupts
3. Изолированную установку candidate artifact без правки repository.
4. Hash и LICENSE proof.
5. Executable behavior probe против standard event/input types.
6. Explicit negative proof для `0.0.42`.

Подтверждённые candidates из master-plan:

- `@copilotkit/react-core`: `1.63.1`;
- `@copilotkit/react-ui`: `1.63.1`;
- `@copilotkit/runtime`: `1.63.1`;
- `@ag-ui/client`: `0.0.57`;
- `langgraph-checkpoint-sqlite`: `3.1.0`.

Эти версии всё равно проходят live Context7/official-doc/registry proof. Версия или commit Python adapter не назначается по памяти: её значение берётся только из прошедшего probe immutable artifact. Если значение невозможно доказать, результат `BLOCKED`, а manifests и locks остаются неизменными.

### 4.3 FastAPI/KFX assembly

- Новый subrouter создаётся отдельно и монтируется только через существующий `src/backend/base/ketos/agentic/api/router.py`.
- `src/backend/base/ketos/api/router.py` не меняется: он уже mounts agentic router.
- A02 сначала ставит существующий active-user dependency перед adapter; A06 заменяет его на access-token-only `CurrentAgUiUser`, который переиспользует `oauth2_login`/existing auth service, принимает только Bearer либо `access_token_lf` и не принимает API key.
- Нельзя писать локальный AG-UI encoder, SSE parser, custom event enum или compatibility wrapper.
- KFX seam переиспользует `AgentComponent` и его LangGraph runnable; persisted class name не меняется.
- Adapter invocation невозможен до успешной auth dependency.
- Probe model/provider разрешается только существующим server-side Ketos configuration; request override игнорируется.

### 4.4 Node transport

- Runtime target задаётся server-side fixed environment/config и не читается из query/body/browser storage.
- Origin/Host policy:
  - при наличии `Origin` его normalized origin обязан совпасть с normalized `Host`/forwarded host, разрешённым orchestration config;
  - mismatch возвращает deny до upstream call;
  - body/query `url`, `target`, `agentUrl` игнорируются.
- Forward allowlist:
  - разрешён `Authorization: Bearer …`;
  - из `Cookie` разрешён только `access_token_lf`;
  - `refresh_token_lf`, `apikey_tkn_lflw` и остальные cookies удаляются;
  - `x-api-key`/`api_key` не forward-ятся;
  - secrets не логируются.
- Runtime остаётся transport-only: без DB, Ketos domain logic, model selection, tools или MCP.

### 4.5 Auth/actor/thread/run binding

- Каждый run и resume повторно проходит Ketos authentication через access-token-only dependency.
- Прямой `x-api-key`, query `api_key` и cookie `apikey_tkn_lflw` отклоняются, даже если другие Ketos routes поддерживают API-key auth.
- `actor_id` берётся только из `CurrentActiveUser.id`.
- Стандартные `threadId`/`runId` связываются с actor через server-side adapter/checkpoint metadata hook; foreign binding отклоняется до execution.
- Если proven adapter не предоставляет безопасный hook для pre-dispatch binding, задача `S01-A06` и этап получают `BLOCKED`; локальный parser/protocol не создаётся.
- Body/header `actor`, `actor_id`, `user_id`, `role`, `model` не влияют на authority/model selection.

### 4.6 Read-only KFX tool и bounded state

- Probe подключает реальный read-only KFX tool из `src/kfx/src/kfx/mcp/flow_builder_tools/read_tools.py`, предпочтительно `SearchComponentTypes` или другой admission-доказанный read-only tool без mutation side effect.
- Mutating tools, filesystem, MCP, arbitrary egress и model configuration tools запрещены.
- Shared state содержит только bounded probe fields: stage marker, tool lifecycle/result count и confirmation status; secrets, full Flow и actor credentials отсутствуют.
- Tests декодируют events только официальными AG-UI types; production event parser/guard не создаётся.
- Custom `flow_update` и generic renderer запрещены.

### 4.7 Job safe floor

В `src/backend/base/ketos/services/jobs/service.py`:

- `get_jobs_by_flow_id(..., user_id=...)` фильтрует только `Job.user_id == user_id`;
- `get_job_by_job_id(..., user_id=...)` фильтрует только exact owner;
- protected cancellation с user context не допускает `user_id IS NULL`;
- `_validate_ownership` отклоняет foreign и `NULL` owner;
- list ordering использует `Job.created_timestamp`;
- системный внутренний вызов без user context остаётся отдельным internal path и не маскируется под user-authorized operation.

В `src/backend/base/ketos/api/v2/workflow.py`:

- developer API shape сохраняется;
- get/stop для foreign/NULL jobs возвращают not-found/deny до revoke/result;
- rows не удаляются;
- owner success и current response shapes сохраняются.

### 4.8 Feature flags и orchestration

- В `FeatureFlags` добавляются `mvp_workspace: bool = False` и `mvp_chat: bool = False`.
- Canonical env:
  - `KETOS_FEATURE_MVP_WORKSPACE=true|false`;
  - `KETOS_FEATURE_MVP_CHAT=true|false`.
- Brand-env inventory и tests обновляются в той же задаче.
- Backend `/config` отдаёт flags через существующий `feature_flags` object.
- Frontend читает их только через `useUtilityStore(state => state.featureFlags...)`.
- Probe route/component скрыты и недоступны при любом flag не равном literal `true`.
- Vite proxy отправляет `/api/copilotkit` только в fixed Node runtime и не в FastAPI.
- `playwright.mvp.config.ts` поднимает ровно три процесса: backend `7860`, Copilot runtime `8788`, frontend `3000`.

### 4.9 Матрица точных путей

Обозначения: **существует** — authoritative source; **изменить** — запланированная правка; **создать** — новый файл/каталог этого этапа.

| Статус | Путь | Назначение / владелец |
| --- | --- | --- |
| существует | `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md` | нормативный master-plan; read-only для lanes |
| существует | `src/kfx/src/kfx/components/models_and_agents/agent.py` | existing `AgentComponent` seam; не переименовывать |
| существует | `src/kfx/src/kfx/mcp/flow_builder_tools/read_tools.py` | real read-only KFX tools |
| изменить | `src/backend/base/pyproject.toml` | proven adapter + SQLite saver dependency; A01 only |
| изменить | `uv.lock` | Python frozen lock; A01 only |
| изменить | `src/frontend/package.json` | CopilotKit React/UI + AG-UI client; A01 only |
| изменить | `src/frontend/package-lock.json` | primary frontend npm lock; A01 only |
| изменить | `src/frontend/pnpm-lock.yaml` | verification-only attestation; A01 only |
| создать | `src/copilot-runtime/package.json` | transport runtime manifest; A01 only |
| создать | `src/copilot-runtime/package-lock.json` | runtime primary lock; A01 only |
| изменить | `scripts/ci/release-lock-ownership.json` | declare runtime lock ownership; A01 only |
| изменить | `scripts/ci/test_release_lock_ownership.py` | lock-set/producer assertion; A01 only |
| создать | `scripts/mvp/probe_ag_ui_adapter.py` | executable artifact behavior probe; A01 |
| создать | `src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py` | reject 0.0.42 + require standard interrupt/resume; A01 |
| создать | `docs/dev/handoff/STAGE_01_AG_UI_ADMISSION.md` | versions/commit/hash/LICENSE/API/behavior decision; A01 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/__init__.py` | package boundary; A02 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/assembly.py` | KFX/LangGraph assembly over proven adapter; A02 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/adapter.py` | thin official-adapter invocation seam, no event implementation; A02 |
| создать | `src/backend/base/ketos/agentic/api/ag_ui_router.py` | authenticated `/ag-ui` subrouter; A02 |
| создать | `src/backend/tests/unit/agentic/api/test_ag_ui_probe.py` | auth-before-adapter, text and standard events; A02 |
| создать | `src/copilot-runtime/tsconfig.json` | Node TS build contract; A03 |
| создать | `src/copilot-runtime/src/server.ts` | Runtime v2 listener and fixed `HttpAgent` registration; A03 |
| создать | `src/copilot-runtime/src/credential-forwarding.ts` | header/cookie allowlist and redaction; A03 |
| создать | `src/copilot-runtime/src/origin-guard.ts` | Origin/Host/target-injection guard; A03 |
| создать | `src/copilot-runtime/src/__tests__/runtime-transport.test.ts` | bearer/cookie/expiry/target/log tests; A03 |
| создать | `src/frontend/src/components/core/assistantPanel/copilotkit-probe.tsx` | one provider + stock Chat probe, no legacy imports; A04 |
| создать | `src/frontend/src/components/core/assistantPanel/copilotkit-interrupt-probe.tsx` | test-only official pinned-v2 `useInterrupt` renderer; all open interrupts; explicit approve/reject only; A04 |
| создать | `src/frontend/src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx` | provider/runtime/stock-body/source boundary; A04 |
| создать | `src/frontend/src/components/core/assistantPanel/__tests__/copilotkit-interrupt-probe.test.tsx` | actual-type Jest contract for open interrupts, official `resolve` payloads and cancel/abandon; A04 |
| изменить | `src/backend/base/ketos/services/jobs/service.py` | exact-owner/NULL-deny/created_timestamp; A05 |
| изменить | `src/backend/tests/unit/api/v2/test_workflow.py` | invert legacy NULL access expectations; A05 |
| создать | `src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py` | owner/foreign/NULL/list/get/cancel matrix; A05 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/auth.py` | access-token-only `CurrentAgUiUser`, server-derived actor и API-key deny; A06 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/run_binding.py` | actor/thread/run binding via proven hook; A06 |
| создать | `src/backend/tests/unit/agentic/api/test_ag_ui_auth.py` | reload/Bearer/actor swap/foreign/expired/forged tests; A06 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/probe_tools.py` | bind real read-only KFX tool only; A07 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/probe_state.py` | bounded state schema; A07 |
| создать | `src/backend/tests/unit/agentic/api/ag_ui_contract_fixtures.py` | official-type-only test decoder/fixtures; A07 |
| создать | `src/backend/tests/unit/agentic/api/test_ag_ui_tool_state.py` | tool lifecycle/state/custom-event negative tests; A07 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/checkpoint.py` | file-backed saver lifecycle and strict msgpack; A08 |
| создать | `src/backend/base/ketos/agentic/services/ag_ui/hitl_probe.py` | core confirmation interrupt graph seam; A08 |
| создать | `src/backend/tests/unit/agentic/api/test_ag_ui_interrupt_resume.py` | all-open/approve/reject/invalid/stale/replay/new-app tests; A08 |
| изменить | `src/kfx/src/kfx/services/settings/feature_flags.py` | add default-off flags; A09 |
| изменить | `src/kfx/src/kfx/brand_env.py` | canonical env inventory; A09 |
| изменить | `src/kfx/tests/unit/services/settings/test_feature_flags_brand_env.py` | legacy/canonical/conflict/default tests; A09 |
| изменить | `src/kfx/tests/unit/services/settings/test_brand_env_inventory.py` | inventory counts/suffixes; A09 |
| изменить | `brand/compatibility/stage5-env-contract-v1.yaml` | reviewed env contract inventory; A09 |
| изменить | `src/backend/tests/unit/api/v1/test_endpoints.py` | `/config` flag exposure/default tests; A09 |
| изменить | `src/frontend/src/controllers/API/queries/config/use-get-config.ts` | existing config→store seam characterization; A09 |
| изменить | `src/frontend/src/stores/__tests__/utilityStore.test.ts` | literal-true/default-off store behavior; A09 |
| изменить | `src/frontend/vite.config.mts` | fixed `/api/copilotkit` proxy; A09 |
| создать | `src/frontend/playwright.mvp.config.ts` | three-process orchestration; A09 |
| создать | `scripts/mvp/chat_stack_smoke.sh` | deterministic process/readiness/smoke orchestration; A09 |
| создать | `docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_RUNBOOK.md` | ports/env/start/stop/reproduce; A09 |
| изменить | `src/backend/base/ketos/agentic/api/router.py` | include AG-UI subrouter once; A10 only |
| создать | `src/frontend/src/pages/CopilotKitProbePage/index.tsx` | runtime-flag guard and probe page; A10 |
| изменить | `src/frontend/src/routes.tsx` | authenticated default-off probe route; A10 only |
| создать | `src/frontend/tests/core/integrations/copilotkit-ag-ui-probe.spec.ts` | real Chromium vertical proof; A10 |
| создать | `scripts/mvp/check_stage01_source_boundaries.py` | forbidden stack/import/protocol/source scan; A10 |
| создать | `docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_BRIDGE.md` | final exact-SHA evidence/compliance handoff; A10 |

Если proven upstream API требует иное имя внутреннего adapter import file, `S01-A01` фиксирует его в admission document до Wave A consumers; изменение перечисленного domain scope запрещено. Любая новая shared registrar/lock path должна быть добавлена в ownership matrix до изменения, иначе merge отклоняется.

### 4.10 Tool Routing и журнал доступности

Это второе обязательное напоминание: **все субагенты используют все доступные релевантные инструменты; отсутствие инструмента не замалчивается**.

| Порядок | Инструмент | Точный use | Authority / действие при недоступности |
| --- | --- | --- | --- |
| 1 | direct source + git | `git rev-parse HEAD`, `git status --short`, `rg`/`sed` по owned paths | source/runtime authoritative; отсутствие shell — `BLOCKED` |
| 2 | RaytSystem read-only | `raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json`; затем `status`, `graph status`, `lint` с тем же root | не редактировать `.raytsystem`; недоступность записать, не блокирует source work |
| 3 | Graphify read-only | `graphify query "CopilotKit AG-UI KFX AgentComponent auth Job feature flags routers" --budget 2500` | навигация; не rebuild. Stale/missing graph записать и продолжить по source |
| 4 | Context7 | resolve/query отдельно для трёх IDs `/copilotkit/copilotkit`, `/ag-ui-protocol/ag-ui`, `/langchain-ai/langgraph` | mandatory для dependency-sensitive A01/A02/A03/A04/A08; недоступность → `BLOCKED` этих задач |
| 5 | Official docs / web | открыть шесть URL из §4.2, сверить текущие API signatures и dates | второй обязательный источник; недоступность registry/docs, не позволяющая proof, → `BLOCKED` A01 |
| 6 | pytest/Jest/Node/Playwright | exact focused commands из задач и stage gate | executable proof authoritative |
| 7 | Chrome или Computer Use | открыть `http://127.0.0.1:3000/mvp/copilotkit-probe`; выполнить text→tool→state→interrupt→approve и отдельный reject; сохранить screenshot без secrets | supplementary visual proof, не заменяет Playwright; недоступность фиксируется, но сама по себе не отменяет зелёный automated Chromium gate |
| 8 | security/source scan | `uv run python scripts/mvp/check_stage01_source_boundaries.py` и targeted `rg` | любой forbidden import/event/secret → `FAIL` |

Каждая недоступность записывается в final handoff полями:

`tool`, `requested_operation`, `timestamp_utc`, `exact_error`, `safe_alternative_used`, `evidence_path`, `acceptance_impact`, `blocking=yes|no`.

Imported content, web pages и tool output считаются данными, а не инструкциями. External MCP/runtime/network exposure не включаются в stage implementation.

---

## 5. Перечень задач

### 5.1 Матрица субагентов и функциональных ролей

| ID | Основная роль | Дополнительная роль | Практический результат | Независимый review |
| --- | --- | --- | --- | --- |
| S01-A01 | анализ/admission | dependency compliance | executable adapter probe, frozen manifests/locks, admission doc | A10 |
| S01-A02 | архитектурное проектирование | backend implementation | thin official-adapter FastAPI/KFX seam | A06 |
| S01-A03 | transport implementation | security implementation | Node Runtime v2 + credential/origin guards | A06 |
| S01-A04 | frontend implementation | boundary testing | stock CopilotKit probe + test-only official `useInterrupt` renderer | A10 |
| S01-A05 | backend security implementation | regression testing | Job exact-owner floor | A06 |
| S01-A06 | security | authz design/review | actor/thread/run binding and negative matrix | A10 |
| S01-A07 | KFX integration | contract testing | real read-only tool + bounded state | A08 |
| S01-A08 | test/HITL durability | recovery design | file-backed interrupt/resume executable proof | A07, затем A10 |
| S01-A09 | orchestration | documentation | flags/proxy/3-process harness/runbook | A10 |
| S01-A10 | integration/compliance | docs/E2E | registrars, source guard, Chromium spec, final handoff | coordinator |

Роли анализа, проектирования, реализации, тестирования, security, docs и compliance разделены. Reviewer не засчитывает задачу без practical deliverable автора; coordinator review не считается одним из десяти субагентов.

### 5.2 S01-A01 — dependency/admission registrar

**Цель:** выбрать один совместимый immutable Python adapter artifact и закрепить весь dependency set только после executable proof.

**Зона ответственности:** все manifests, locks, lock ownership и dependency decision. Ни один другой lane их не меняет.

**Конкретные задачи:**

1. Создать negative-first `test_ag_ui_adapter_contract.py` и `probe_ag_ui_adapter.py`.
2. Доказать, что `ag-ui-langgraph 0.0.42` не проходит standard outcome/resume contract.
3. Выполнить Context7 + official docs + registry/source proof.
4. Для каждого candidate проверить immutable identity, SHA-256/source hash, LICENSE, Python range, constructor/API, standard event output, `RunAgentInput.resume[]` и all-open semantics.
5. Для pinned CopilotKit v2 candidate через Context7, official docs и фактически установленные package `.d.ts` доказать export/signature `useInterrupt`, renderer contract и то, что официальный `resolve` принимает ровно decision object `{ approved: boolean }`; записать exact import, generic parameters, render arguments и resolve type в admission document. Если Context7 и package types не подтверждают одну и ту же применимую signature, admission завершается `BLOCKED`: shim, wrapper, custom event или предположение по памяти запрещены.
6. При первом полном candidate PASS записать exact release либо exact commit в `STAGE_01_AG_UI_ADMISSION.md`.
7. Только после proof изменить `src/backend/base/pyproject.toml`, frontend/runtime manifests, locks и lock ownership.
8. Проверить frozen installs обоих JS packages и Python workspace.

**Deliverable:** commit с executable contract test, probe, admission document, manifests/locks и ownership test. Если candidate не найден — commit только с test/probe/admission failure evidence без package edits и verdict `BLOCKED`.

**Focused verification:**

```bash
uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q
uv lock --check
uv sync --frozen --package ketos-base --package kfx
uv run pytest scripts/ci/test_release_lock_ownership.py -q
cd src/copilot-runtime && npm ci --ignore-scripts && npm test && cd ../..
cd src/frontend && npm ci --ignore-scripts && cd ../..
npx --yes --package=node@22.22.0 --package=pnpm@11.8.0 -- \
  pnpm --dir src/frontend install --lockfile-only --ignore-scripts --frozen-lockfile
```

**Блокирует:** A02, A03, A04, A06–A10.

### 5.3 S01-A02 — FastAPI/KFX probe

**Цель:** создать thin endpoint над proven upstream adapter и existing KFX `AgentComponent`.

**Зона ответственности:** `agentic/services/ag_ui/{assembly,adapter}.py`, `agentic/api/ag_ui_router.py`, `test_ag_ui_probe.py`; shared registrar не менять.

**Конкретные задачи:**

1. Импортировать только proven API, зафиксированный A01.
2. Собрать KFX/LangGraph runnable через existing `AgentComponent` seam.
3. Создать subrouter path `/ag-ui` с `CurrentActiveUser` dependency до adapter call.
4. Доказать unauthenticated deny и нулевой adapter invocation.
5. Доказать standard text events и absence legacy/custom event path.
6. Не создавать локальный event encoder/parser.

**Deliverable:** importable subrouter + assembly + focused backend test; registrar patch передаётся A10.

**Focused verification:**

```bash
uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_probe.py -q
```

**Блокирует:** A06, A07, A08, A10.

### 5.4 S01-A03 — transport bridge

**Цель:** реализовать stateless Node listener с fixed `HttpAgent` target и строгим credential/origin allowlist.

**Зона ответственности:** `src/copilot-runtime/tsconfig.json` и `src/copilot-runtime/src/**`; package manifest/lock не менять.

**Конкретные задачи:**

1. Создать Runtime v2 listener через proven `/v2/node` API.
2. Зарегистрировать ровно один agent `ketos-mvp-probe` с fixed FastAPI URL.
3. Реализовать Bearer/`access_token_lf` forwarding.
4. Удалить refresh/API-key/other cookies и `x-api-key`.
5. Проверить Origin/Host и отклонить mismatch до upstream.
6. Игнорировать browser target/model/agent URL overrides.
7. Redact secrets из error/access logs.
8. Написать tests на cookie-only reload, Bearer, expired/deny propagation, target injection и log leakage.

**Deliverable:** buildable/tested Node transport без domain/model/tool logic.

**Focused verification:**

```bash
cd src/copilot-runtime
npm test
npm run typecheck
npm run build
```

**Блокирует:** A06, A09, A10.

### 5.5 S01-A04 — React probe и официальный interrupt renderer

**Цель:** создать минимальный default-off probe на одном CopilotKit v2 provider и stock Chat, а также узкий test-only renderer, который через официальный pinned-v2 `useInterrupt` завершает HITL без собственного протокола.

**Зона ответственности:** `copilotkit-probe.tsx`, planned-new `copilotkit-interrupt-probe.tsx` и два их Jest tests из §4.9; routes, package files, backend HITL graph и product Chat files не менять. A04 является единственным owner frontend interrupt render/resolve semantics.

**Конкретные задачи:**

1. Использовать proven v2 imports из A01 handoff.
2. Runtime URL зафиксировать как same-origin `/api/copilotkit`.
3. Agent name зафиксировать как `ketos-mvp-probe`.
4. Рендерить stock CopilotKit body/composer/message list.
5. Не импортировать `assistant-panel.tsx`, `use-assistant-chat.ts`, `use-post-assist-stream.ts`, `apply-flow-update.ts`.
6. В test-only `copilotkit-interrupt-probe.tsx` вызвать официальный `useInterrupt` ровно по signature, доказанной Context7 + installed package types в A01; renderer обязан показывать отдельную доступную карточку для каждого open interrupt и stable interrupt ID/summary только из official render arguments.
7. Кнопка `Approve` вызывает только переданный official callback `resolve({approved:true})`; кнопка `Reject` вызывает только `resolve({approved:false})`. Эти exact calls допустимы лишь если их type signature фактически доказана A01. Не создавать transport callback, DOM/custom event, AG-UI parser, manual `RunAgentInput`, fetch resume либо локальный event encoder.
8. `Escape` и кнопка close трактуются как cancel/abandon UI probe: не вызывают `resolve`, особенно не подменяются `resolve({approved:false})`, не создают новый run и оставляют backend interrupt незавершённым; повторное открытие probe снова показывает всё ещё open interrupt.
9. Jest contract на фактических pinned package types передаёт минимум два open interrupts и доказывает: оба видимы; approve вызывает один resolver ровно с `{ approved: true }`; отдельный reject вызывает соответствующий resolver ровно с `{ approved: false }`; Escape/close вызывает zero resolver; double-click disabled после первого explicit decision; custom events/parsers отсутствуют.
10. Проверить единственный provider и отсутствие custom message/tool renderer. Probe импортируется только default-off MVP route/page и не создаёт Chat persistence, Chat domain/API, reusable product composer или Stage 05 UI.

**Deliverable:** stock probe component, test-only official interrupt renderer и два focused Jest/source-boundary tests. Если exact `useInterrupt`/`resolve` API не подтверждён Context7 и package types, A04 не пишет substitute implementation и возвращает `BLOCKED`, блокируя Sync A и A10.

**Focused verification:**

```bash
cd src/frontend
npm test -- --runInBand \
  src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx \
  src/components/core/assistantPanel/__tests__/copilotkit-interrupt-probe.test.tsx
npm run type-check:production
```

**Блокирует:** Sync A, A09, A10.

### 5.6 S01-A05 — Job safe floor

**Цель:** закрыть reachable fail-open ownership и canonical timestamp defect без изменения Job domain/API shape.

**Зона ответственности:** Job service, focused ownership test и затронутые v2 workflow expectations.

**Конкретные задачи:**

1. Сначала написать owner/foreign/NULL/list/get/stop/cancel failing tests.
2. Удалить `OR user_id IS NULL` из user-authorized filters.
3. Сделать `_validate_ownership` fail-closed для NULL.
4. Использовать `created_timestamp` в ordering.
5. Сохранить system-internal no-user path отдельно.
6. Проверить, что stop/cancel foreign/NULL не вызывает revoke/update и не удаляет rows.
7. Сохранить owner success и developer API response contract.

**Deliverable:** exact-owner Job floor + focused test + updated v2 regression.

**Focused verification:**

```bash
uv run pytest \
  src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py \
  src/backend/tests/unit/api/v2/test_workflow.py -q
```

**Блокирует:** Sync A и весь stage PASS.

### 5.7 S01-A06 — auth/actor binding

**Цель:** повторно аутентифицировать каждый run/resume и связать actor с thread/run server-side.

**Зона ответственности:** `auth.py`, `run_binding.py` и `test_ag_ui_auth.py`; Node source получает только review comments, не правки. Узкий patch, заменяющий A02 admission dependency в `ag_ui_router.py` на `CurrentAgUiUser`, передаётся A10 и применяется только при integration wiring.

**Конкретные задачи:**

1. Создать `CurrentAgUiUser` поверх existing `oauth2_login`, DB dependency и auth service; не писать свой JWT verifier.
2. Принимать forwarded Bearer либо sanitized `access_token_lf`.
3. Явно отклонять `x-api-key`, query `api_key` и `apikey_tkn_lflw` как AG-UI credentials.
4. Сохранять actor/thread/run binding через proven adapter pre-dispatch/checkpoint metadata hook.
5. Игнорировать forged actor/role/model fields.
6. Повторять auth на resume, включая reload.
7. Отклонять expired credential, actor swap, foreign thread/run и reused foreign run ID.
8. Security-review A03 forwarding и A05 protected ownership.
9. Если safe hook отсутствует — зафиксировать exact blocker, не писать parser.

**Deliverable:** server-derived auth/binding seam + negative matrix + security review notes.

**Focused verification:**

```bash
uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_auth.py \
  src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py -q
cd src/copilot-runtime && npm test
```

**Блокирует:** A10.

### 5.8 S01-A07 — KFX tool/state probe

**Цель:** доказать standard tool lifecycle и bounded shared state на реальном read-only KFX tool.

**Зона ответственности:** `probe_tools.py`, `probe_state.py`, official-type test fixtures и `test_ag_ui_tool_state.py`.

**Конкретные задачи:**

1. Подключить admission-одобренный read-only component/tool из KFX.
2. Не подключать mutating/filesystem/MCP/egress tools.
3. Определить bounded state schema без secrets/full Flow.
4. Декодировать test stream только official AG-UI types.
5. Проверить standard tool start/args/result/end и state snapshot/delta order.
6. Source-negative проверить отсутствие `flow_update`, generic renderer и custom event classes.

**Deliverable:** real KFX tool/state integration + official-type fixture + tests.

**Focused verification:**

```bash
uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_probe.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_tool_state.py -q
```

**Блокирует:** A10.

### 5.9 S01-A08 — interrupt/resume probe

**Цель:** доказать durable standard HITL contract, включая all-open interrupts и replay safety.

**Зона ответственности:** `checkpoint.py`, `hitl_probe.py` и `test_ag_ui_interrupt_resume.py`.

**Конкретные задачи:**

1. Создать file-backed `AsyncSqliteSaver` lifecycle.
2. Enforce `LANGGRAPH_STRICT_MSGPACK=true`.
3. Сформировать core `confirmation` interrupt с snapshots до `RUN_FINISHED`.
4. Доказать approve и reject через `Command(resume=...)`.
5. Доказать all-open responses.
6. Отклонить partial/invalid/stale/duplicate/deprecated resume.
7. Проверить same thread/new run/new app object и один post-confirmation state effect.
8. Проверить zero effect до interrupt и node re-entry behavior.

**Deliverable:** durable HITL implementation seam + exhaustive focused contract test в пределах master acceptance.

**Focused verification:**

```bash
LANGGRAPH_STRICT_MSGPACK=true uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_interrupt_resume.py -q
```

**Блокирует:** A10.

### 5.10 S01-A09 — feature/proxy/orchestration/docs

**Цель:** провести default-off flags end-to-end и создать воспроизводимый three-process harness.

**Зона ответственности:** feature flags/brand-env/config tests, Vite proxy, Playwright MVP config, smoke script и runbook. Shared routes/agentic registrar не менять.

**Конкретные задачи:**

1. Добавить `mvp_workspace`/`mvp_chat` defaults и canonical env inventory.
2. Проверить `/config` и `useUtilityStore`.
3. Добавить fixed `/api/copilotkit` proxy to `127.0.0.1:8788`.
4. Доказать, что route не попадает в FastAPI proxy.
5. Создать `playwright.mvp.config.ts` с backend/runtime/frontend.
6. Создать readiness-aware `chat_stack_smoke.sh` без blocking sleep >60s.
7. Документировать exact env/ports/start/stop/cleanup и отсутствие secrets.
8. Проверить flag off/inaccessible и on/available.

**Deliverable:** flags + proxy + orchestration + runbook.

**Focused verification:**

```bash
uv run pytest \
  src/kfx/tests/unit/services/settings/test_feature_flags_brand_env.py \
  src/kfx/tests/unit/services/settings/test_brand_env_inventory.py \
  src/backend/tests/unit/api/v1/test_endpoints.py -q
cd src/frontend
npm test -- --runInBand src/stores/__tests__/utilityStore.test.ts
npm run type-check:production
cd ../..
bash scripts/mvp/chat_stack_smoke.sh
```

**Блокирует:** A10.

### 5.11 S01-A10 — integration/compliance owner

**Цель:** соединить deliverables, добавить единственные shared registrars, доказать vertical path через официальный A04 interrupt UI и выпустить exact-SHA handoff.

**Зона ответственности:** `agentic/api/router.py`, `routes.tsx`, probe page, Playwright spec, source-boundary script и final handoff.

**Конкретные задачи:**

1. После merge A06–A09 зарегистрировать AG-UI subrouter ровно один раз.
2. Применить A06 registrar patch: final `/ag-ui` route использует `CurrentAgUiUser`, а direct API-key auth получает deny.
3. Добавить authenticated runtime-flagged probe route/page.
4. Создать source boundary scan для:
   - legacy Assistant imports;
   - custom event/protocol;
   - Electron/OpenSwarm code;
   - second runtime/model router/MCP orchestrator;
   - browser target/model/actor authority;
   - deprecated resume path.
5. Написать real-API/real-process Chromium story без custom events/parser и без прямого вызова resume из test code:
   - cookie-only auth after reload;
   - text;
   - read-only tool;
   - state;
   - interrupt;
   - увидеть все open interrupts в A04 `useInterrupt` probe и нажать его `Approve`;
   - на отдельном свежем interrupt нажать именно его `Reject`;
   - для approve и reject захватить official browser request metadata и доказать: resume сохраняет исходный `threadId`, создаёт новый отличный `runId` и содержит ровно официальный decision response, сформированный SDK;
   - через standard AG-UI state/tool result и durable backend evidence доказать один effect после explicit decision; double-click/reload/replay не создаёт второй effect; reject не превращается в approve effect;
   - invalid resume deny.
6. Отдельно проверить Escape и close: request resume отсутствует, reject response отсутствует, interrupt остаётся open после повторного открытия; эти действия не засчитываются как reject story.
7. Source guard обязан отклонять `CustomEvent`, `dispatchEvent`, ручной resume/fetch, AG-UI SSE/event parser и импорт test-only probe вне MVP probe page/test; отсутствие product Chat persistence/domain также обязательно.
8. Выполнить legacy `/flow/:id` smoke.
9. Выполнить Chrome/Computer visual check, если инструмент доступен.
10. Собрать exact SHA, commits, paths, versions/hashes/licenses, commands/exit codes, tool availability, `useInterrupt`/`resolve` type evidence, approve/reject thread/run/effect evidence и defects в final handoff.

**Deliverable:** integration commit + source guard + Chromium spec + final compliance/evidence document.

**Focused verification:**

```bash
uv run python scripts/mvp/check_stage01_source_boundaries.py
cd src/frontend
npx playwright test -c playwright.mvp.config.ts \
  tests/core/integrations/copilotkit-ag-ui-probe.spec.ts --project=chromium
```

**Блокирует:** Sync B, stage verdict и Этап 02.

---

## 6. Подэтапы и шаги выполнения

### 6.1 Обязательный DAG

```mermaid
flowchart TD
    P["Preflight: clean integration worktree + tool ledger"] --> A01["S01-A01 admission"]
    P --> A05["S01-A05 Job floor"]
    A01 --> A02["S01-A02 FastAPI/KFX"]
    A01 --> A03["S01-A03 Node transport"]
    A01 --> A04["S01-A04 React probe"]
    A02 --> SA["Sync A"]
    A03 --> SA
    A04 --> SA
    A05 --> SA
    SA --> A06["S01-A06 auth/binding"]
    SA --> A07["S01-A07 tool/state"]
    SA --> A08["S01-A08 HITL/checkpoint"]
    SA --> A09["S01-A09 flags/proxy/harness"]
    A06 --> A10["S01-A10 integration"]
    A07 --> A10
    A08 --> A10
    A09 --> A10
    A04 --> A10
    A10 --> SB["Sync B + full gate"]
    SB --> V{"All criteria PASS?"}
    V -->|yes| S02["Allow Stage 02"]
    V -->|no| STOP["Stop: FAIL or BLOCKED"]
```

### 6.2 Таблица подэтапов

| Подэтап | Parallel | Prerequisites | Owner | Output | Verification | Blocked downstream |
| --- | --- | --- | --- | --- | --- | --- |
| Preflight | no | exact baseline, clean integration worktree | coordinator | base SHA, dirty-state inventory, tool ledger, lane map | `git rev-parse HEAD`; `git status --short`; RaytSystem/Graphify read-only | все задачи |
| Wave A.1 | yes, 2 lanes; третьей независимой задачи нет | preflight | A01 + A05 | admission proof/locks и independent Job floor | A01/A05 focused commands | A02–A10, Sync A |
| Dependency micro-sync | no | A01 PASS; package edits only after artifact proof | coordinator | frozen dependency SHA | contract test, lock ownership, frozen installs | A02/A03/A04 |
| Wave A.2 | yes, 3 lanes | dependency micro-sync SHA with proven `useInterrupt`/`resolve` types | A02 + A03 + A04 | backend seam, Node bridge, stock React probe + test-only official interrupt renderer | backend probe; Node test/type/build; both A04 Jest contracts + frontend typecheck | Sync A |
| Sync A | no | A02/A03/A04 + A05 deliverables | coordinator | one Sync-A SHA, frozen wire fixtures | merged focused suite + diff/ownership review | Wave B |
| Wave B.1 | yes, 4 lanes | Sync-A SHA | A06 + A07 + A08 + A09 | auth, tool/state, HITL/checkpoint, flags/harness | четыре independent focused commands по frozen Sync-A interfaces | A10 |
| Wave B.2 | no | A04 official interrupt renderer and A06–A09 merged/reviewed | A10 | registrars, route, official-UI approve/reject E2E, source guard, handoff | A10 Playwright approve/reject thread/run/effect evidence + source guard | Sync B |
| Sync B | no | A01–A10 practical deliverables | coordinator | one stage candidate SHA | full gate, independent review, transition ledger | Stage 02 |
| Verdict | no | Sync-B evidence complete | coordinator | PASS/FAIL/BLOCKED | algorithm §14.5 | transition |

### 6.3 Preflight

1. Создать clean integration worktree от exact baseline; dirty root checkout не использовать.
2. Создать максимум пять reusable lane worktrees.
3. Для каждой lane записать:
   - base SHA;
   - одну exact branch из списка:
     - `codex/mvp-s01-a01-admission`;
     - `codex/mvp-s01-a02-fastapi-kfx`;
     - `codex/mvp-s01-a03-runtime-bridge`;
     - `codex/mvp-s01-a04-react-probe`;
     - `codex/mvp-s01-a05-job-floor`;
     - `codex/mvp-s01-a06-auth-binding`;
     - `codex/mvp-s01-a07-tool-state`;
     - `codex/mvp-s01-a08-hitl-checkpoint`;
     - `codex/mvp-s01-a09-orchestration`;
     - `codex/mvp-s01-a10-integration`;
   - writable paths;
   - forbidden paths;
   - expected deliverable;
   - focused command;
   - dependency interface.
4. Запустить Tool Routing из §4.10.
5. Запретить Graphify rebuild, RaytSystem writes и изменения generated/deployment/license/notice paths.

### 6.4 Wave A

#### Wave A.1

- A01 и A05 стартуют одновременно.
- A01 не редактирует package files до artifact probe PASS.
- A05 не зависит от CopilotKit и завершает Job floor независимо.
- Если A01 получает `BLOCKED`, A05 может завершить commit/evidence, но stage verdict остаётся `BLOCKED` и A02+ не стартуют.

#### Dependency micro-sync

Coordinator:

1. проверяет admission doc против test output;
2. убеждается, что 0.0.42 отклонён;
3. проверяет exact hashes/licenses;
4. проверяет только назначенные manifests/locks;
5. запускает frozen install commands;
6. фиксирует dependency SHA;
7. передаёт A02/A03/A04 exact imports/signatures, не документационные предположения.

#### Wave A.2

- A02, A03 и A04 стартуют от dependency SHA.
- Они не меняют shared manifests/locks/registrars.
- Их fixtures используют frozen `agent name`, endpoint URL, Runtime URL и standard IDs.

### 6.5 Sync A

Merge order:

1. A01 dependency commit;
2. A02 backend seam;
3. A03 Node runtime;
4. A04 React probe;
5. A05 Job floor.

Sync-A обязательные checks:

```bash
uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_probe.py \
  src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py \
  src/backend/tests/unit/api/v2/test_workflow.py -q
uv run pytest scripts/ci/test_release_lock_ownership.py -q
cd src/copilot-runtime && npm test && npm run typecheck && npm run build
cd ../frontend && npm test -- --runInBand \
  src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx
```

Wave B открывается только если:

- adapter contract PASS;
- authenticated KFX text path PASS;
- Node credential/origin tests PASS;
- React probe boundary PASS;
- Job exact-owner PASS;
- no unresolved merge conflict/shared-file ownership violation.

### 6.6 Wave B

- A06, A07, A08 и A09 работают параллельно от одного Sync-A SHA по frozen adapter/wire fixtures.
- Они владеют разными source/test files; cross-lane замечания передаются review notes и не создают скрытого merge dependency.
- Heavy frontend build/Playwright не запускаются параллельно.
- A10 стартует только после merge/review A06–A09.

### 6.7 Sync B

Merge order:

1. A06 auth/binding;
2. A07 tool/state;
3. A08 HITL/checkpoint;
4. A09 flags/proxy/orchestration/docs;
5. A10 registrars/E2E/compliance.

Coordinator затем:

1. запускает полный gate §10.2 на одном SHA;
2. повторяет security/source scan;
3. проверяет exact changed paths against assignment;
4. проверяет tool-unavailability ledger;
5. проверяет все десять reviews;
6. заполняет transition control §14.3;
7. присваивает только PASS/FAIL/BLOCKED.

---

## 7. Зависимости

### 7.1 Входные

- exact baseline `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`;
- clean integration worktree;
- Node `>=20.19.0`; lock producers используют версии из `release-lock-ownership.json`;
- Python только через `uv run`;
- локальные SQLite file paths для checkpoint/tests;
- Chromium, поставляемый Playwright;
- существующий Ketos auth/config/provider setup.

### 7.2 External admission dependencies

- Context7 доступен для трёх IDs;
- official docs и artifact registry/upstream source доступны;
- найден immutable compatible Python adapter;
- license совместима с repository policy;
- artifact поддерживает standard outcome/resume contract без custom fallback.
- pinned CopilotKit v2 Context7 material и installed package types согласованно подтверждают официальный `useInterrupt` renderer и `resolve({ approved: boolean })` contract.

Отсутствие любого из последних пяти prerequisites, если безопасной подтверждённой альтернативы нет, даёт `BLOCKED`.

### 7.3 Внутренние зависимости задач

- A02/A03/A04 зависят от A01.
- A06 зависит от A02+A03.
- A07 зависит от A02.
- A08 зависит от A02 и frozen Sync-A adapter contract.
- A09 зависит от A03+A04 и Sync-A interfaces.
- A10 зависит от A04 official interrupt renderer + A06+A07+A08+A09 и merged A05; backend `Command(resume)` proof A08 не заменяет frontend resolve proof A04.

### 7.4 Downstream

- Этап 02 зависит от полного S01 `PASS`.
- Этап 05 зависит от frozen transport fixture.
- Этап 07 зависит от Job safe floor.
- Этапы 08–09 зависят от interrupt/checkpoint contract.

Ни одна downstream-задача не оправдывает расширение S01 scope.

---

## 8. Ожидаемые результаты

### 8.1 Функциональные

- один official/proven AG-UI deployment contract;
- authenticated FastAPI endpoint;
- transport-only Node Runtime v2;
- default-off stock CopilotKit probe + test-only official `useInterrupt` renderer for every open interrupt;
- text/tool/state/interrupt/resume vertical proof with separate UI approve/reject, same thread/new run/one effect and cancel/abandon without false reject;
- file-backed strict-msgpack checkpoint;
- exact-owner Job protected paths;
- three-process Chromium story;
- legacy `/flow/:id` route остаётся рабочим.

### 8.2 Security

- no-auth deny before adapter;
- cookie/Bearer allowlist;
- refresh/API-key cookies stripped;
- actor/model/target injection ignored;
- foreign thread/run/job deny;
- no secrets in logs/screenshots/handoff.

### 8.3 Documentation/evidence

- `STAGE_01_AG_UI_ADMISSION.md`;
- `STAGE_01_COPILOTKIT_AG_UI_RUNBOOK.md`;
- `STAGE_01_COPILOTKIT_AG_UI_BRIDGE.md`;
- exact versions/commit/hashes/LICENSE;
- exact commands, timestamps, exit codes и one-SHA proof;
- tool availability ledger;
- changed-path ledger и subagent commit/review ledger.

### 8.4 Что не должно появиться

- product Chat tables/API;
- custom chat body/parser/events;
- second runtime/model router/MCP;
- browser-authoritative actor/model/target;
- Electron/OpenSwarm code;
- Flow mutation;
- KFX class rename;
- changes to deployment config, `LICENSE`, `NOTICE` или unrelated dirty files.

---

## 9. Критерии выполнения каждой задачи

| Задача | PASS | FAIL | BLOCKED |
| --- | --- | --- | --- |
| A01 | compatible immutable artifact proven; exact dependency/lock/ownership PASS; pinned `useInterrupt`/`resolve({approved:boolean})` signature proven by Context7 + package types | unproven version pinned, 0.0.42 accepted, lock drift or signature guessed | registry/docs/Context7/artifact/types unavailable or disagree after safe alternatives |
| A02 | auth-before-adapter + standard text/KFX events; no local protocol | custom encoder/parser, unauthenticated invocation, duplicate agent | proven adapter lacks required FastAPI/KFX integration seam |
| A03 | fixed target; Bearer/cookie success; sensitive data stripped; build PASS | target injection, secret log, API-key/refresh forwarding | proven Runtime API cannot implement required fixed bridge |
| A04 | one provider, same-origin URL, stock Chat; every open interrupt rendered by official `useInterrupt`; approve/explicit reject call exact official resolver once; Escape/close resolve nothing; Jest/typecheck PASS | custom body/composer/parser/event/resume, multiple providers, false reject on cancel, dropped open interrupt or probe used as product Chat | exact pinned-v2 `useInterrupt`/resolve API is not jointly confirmed by Context7 and package types |
| A05 | owner success; foreign/NULL deny; `created_timestamp`; rows preserved | any fail-open access, row delete, v2 regression | local DB/test environment genuinely unavailable |
| A06 | run/resume re-auth; actor/thread/run binding; forged fields ignored | actor swap/foreign access, custom parser/JWT verifier | adapter lacks safe pre-dispatch binding hook |
| A07 | real read-only KFX tool + standard lifecycle + bounded state | mutation tool, custom event, secret/full Flow state | KFX read-only seam cannot bind through proven adapter |
| A08 | file-backed new-app backend `Command(resume)`; all-open; approve/reject; invalid deny; one effect | `:memory:`, deprecated resume, duplicate effect, partial accepted | saver/adapter contract incompatible despite admitted artifact |
| A09 | flags default-off end-to-end; fixed proxy; 3-process smoke; runbook | route visible off, proxy to FastAPI, non-reproducible harness | required local port/process runner unavailable without safe replacement |
| A10 | source guard + Chromium uses A04 official UI for separate approve/reject; same thread/new run/one effect proven for both; cancel sends no reject; legacy Flow smoke + complete handoff | direct/custom resume in test, custom parser/event, false reject, duplicate effect, missing thread/run proof or any acceptance gap | external browser/process prerequisite unavailable after local alternatives, or A04 admission is BLOCKED |

Любой `FAIL` задачи исправляется и перепроверяется в её scope. Наличие хотя бы одного `FAIL` или `BLOCKED` запрещает `PASS` этапа.

---

## 10. Общие критерии и stage gate

### 10.1 Общие критерии

1. A01…A10 имеют practical deliverable, commit SHA, changed paths и focused command.
2. Все deliverables объединены на одном integration SHA.
3. Dependency decision подтверждён executable artifact probe.
4. Standard text/tool/state/interrupt/resume проходит end-to-end; Chromium инициирует approve и отдельный reject только через официальный A04 `useInterrupt` UI, сохраняя thread, меняя run и создавая ровно один effect.
5. Auth, actor binding, checkpoint и Job ownership проходят negative matrix.
6. Flags default-off; off скрывает UI/route, не удаляя data.
7. Нет custom chat/protocol/runtime и forbidden imports.
8. Existing Flow route и v2 developer workflow API не сломаны.
9. Unrelated dirty/generated/deployment/license/notice files не изменены.
10. Final handoff содержит exact evidence и tool availability.

### 10.2 Общий gate

Запускать последовательно, не параллельно:

```bash
uv run pytest \
  src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_probe.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_auth.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_tool_state.py \
  src/backend/tests/unit/agentic/api/test_ag_ui_interrupt_resume.py \
  src/backend/tests/unit/services/jobs/test_mvp_job_ownership.py \
  src/backend/tests/unit/api/v2/test_workflow.py -q

uv run pytest \
  src/kfx/tests/unit/services/settings/test_feature_flags_brand_env.py \
  src/kfx/tests/unit/services/settings/test_brand_env_inventory.py \
  src/backend/tests/unit/api/v1/test_endpoints.py -q

uv run pytest scripts/ci/test_release_lock_ownership.py -q
uv run python scripts/mvp/check_stage01_source_boundaries.py

bash scripts/mvp/chat_stack_smoke.sh

cd src/copilot-runtime
npm test
npm run typecheck
npm run build

cd ../frontend
npm test -- --runInBand \
  src/components/core/assistantPanel/__tests__/copilotkit-probe.test.tsx \
  src/components/core/assistantPanel/__tests__/copilotkit-interrupt-probe.test.tsx \
  src/stores/__tests__/utilityStore.test.ts
npm run type-check:production
npx playwright test -c playwright.mvp.config.ts \
  tests/core/integrations/copilotkit-ag-ui-probe.spec.ts --project=chromium

cd ../..
git diff --check "$S01_BASE_SHA"...HEAD
git status --short
```

`S01_BASE_SHA` в evidence должен равняться actual pre-stage integration base; для нормативного clean baseline это `5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782`. Если execution начинается с разрешённого более нового base, coordinator сначала обновляет master-derived baseline record и доказывает scope drift; тихая подмена SHA запрещена.

### 10.3 PASS definition

`PASS` присваивается только если:

- все команды §10.2 exit 0;
- compatible artifact и all-open HITL proof существуют;
- official pinned-v2 frontend interrupt signature, Jest contract и browser approve/reject paths доказаны;
- A01…A10 task criteria PASS;
- нет Critical/blocking defect;
- changed paths соответствуют assignments;
- tool/evidence/review ledgers полны;
- verdict получен на том же SHA, что Playwright и build.

---

## 11. Риски, блокеры и устранение

| Риск/блокер | Ранний сигнал | Устранение в scope | Verdict при неустранении |
| --- | --- | --- | --- |
| Нет compatible Python artifact | probe не видит standard outcome/resume | исследовать newer release и immutable upstream commit; не писать wrapper | BLOCKED |
| Context7/official docs недоступны | нет подтверждённых signatures | повторить через доступный official endpoint; сохранить exact errors | BLOCKED A01 |
| API drift JS packages | typecheck/build errors на pinned candidate | вернуться к A01 admission, выбрать только proven mutually compatible set | FAIL до исправления; BLOCKED если artifact отсутствует |
| `useInterrupt` signature не доказана | Context7 example расходится с installed pinned `.d.ts`, export/render args/resolve type отсутствуют | остановить A04; вернуть admission в A01; выбрать совместимый pinned v2 set и повторить type/Jest proof; не писать shim | BLOCKED |
| Auth выполняется после adapter | unauth test вызывает adapter mock | перенести `CurrentActiveUser`/middleware before invocation | FAIL |
| Cookie leakage | upstream mock/log содержит refresh/API-key | allowlist/reconstruct cookie, redact logs, rerun tests | FAIL |
| Origin bypass | mismatched Origin reaches upstream | canonicalize origin/host and deny pre-forward | FAIL |
| Actor/thread swap | foreign resume проходит | bind via verified hook/checkpoint metadata; re-auth each run | FAIL или BLOCKED при отсутствии hook |
| Checkpoint process-local | new app object не resumes | file-backed saver + app lifetime context + strict msgpack | FAIL |
| Duplicate effect after resume | replay increments state twice | one-use interrupt response/idempotent state transition | FAIL |
| Job NULL fail-open | NULL row виден/отменяется | exact equality filters and ownership guard | FAIL |
| Wrong timestamp | list crashes/sorts by `created_at` | use `created_timestamp` and regression test | FAIL |
| Vite proxy sends to FastAPI | backend receives `/api/copilotkit` | explicit highest-specificity fixed runtime proxy | FAIL |
| Probe becomes product Chat | durable Chat domain/custom UI или test-only interrupt renderer импортирован вне MVP probe route/tests | удалить out-of-scope code/import; retain only default-off test probe; product Chat оставить Stage 05 | FAIL |
| Cancel falsely rejects | Escape/close отправляет `{approved:false}` или создаёт новый run | убрать resolve из cancel/abandon path; Jest zero-call + Playwright no-request rerun | FAIL |
| Browser bypasses official resolve | Playwright вызывает fetch/resume/custom event/parser напрямую | выполнять decision только кликом A04 UI; source guard + request metadata доказательство | FAIL |
| Legacy imports/events | source guard match | delete bridge dependency on legacy stack/custom names | FAIL |
| Shared-file conflicts | multiple lanes edit registrar/locks | exclusive owner, registrar patches, sequential merge | FAIL until resolved |
| Dirty/generated drift | `git status` shows unowned files | preserve user state; remove only lane-owned accidental output safely | FAIL |
| Chrome/Computer unavailable | tool call unavailable | record exact error; rely on Playwright Chromium for normative functional proof | non-blocking if automated gate PASS |
| Playwright process/port failure | readiness timeout | explicit ports/PIDs/log tails; terminate only known harness PIDs; rerun | FAIL либо BLOCKED при external local limitation |

Test failure сам по себе не является blocker. Он является `FAIL` до исправления, если причина находится в code/scope.

---

## 12. Тестирование, проверка и документация

### 12.1 Универсальный цикл каждой задачи

1. Написать focused failing test/smoke.
2. Запустить exact command и сохранить expected failure reason.
3. Реализовать минимальный код.
4. Запустить focused command.
5. Исправить Critical/blocking defect.
6. Повторить focused command.
7. Передать commit SHA, changed paths, commands, exit codes и interface notes.
8. Выполнить независимый review из §5.1.

### 12.2 Уровни тестирования

- **Artifact contract:** reject 0.0.42; accept only standard outcome/resume.
- **Backend unit:** auth-before-adapter, actor binding, KFX tool/state, checkpoint/HITL.
- **Job regression:** owner/foreign/NULL/list/get/stop/cancel + v2 API.
- **Node unit/build:** origin, credentials, targets, logs, typecheck/build.
- **Frontend Jest/type contract:** one provider, stock Chat, flags, legacy isolation; all-open official `useInterrupt`; exact approve/reject resolve objects; cancel/abandon zero-call.
- **Source compliance:** forbidden imports/protocol/runtime/Electron/OpenSwarm.
- **Process smoke:** backend + runtime + frontend readiness.
- **Browser integration:** separate Chromium approve and reject via A04 official UI; same `threadId`, new `runId`, one effect; Escape/close produces no resume/reject; legacy Flow route.
- **Supplementary visual:** Chrome/Computer screenshot without secrets when available.

Coverage percentage, full package suites, multi-browser matrix, soak/load и production telemetry не входят в S01.

### 12.3 Обязательная документация

`docs/dev/handoff/STAGE_01_AG_UI_ADMISSION.md`:

- Context7 library IDs и queries;
- official URLs и access dates;
- candidate list;
- rejected 0.0.42 evidence;
- selected version/commit;
- source/wheel/archive SHA-256;
- LICENSE identifier/source;
- constructor/API signatures;
- pinned CopilotKit v2 `useInterrupt` exact import/generics/render arguments and installed `.d.ts` proof for `resolve({ approved: boolean })`;
- probe command/output/exit code.

`docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_RUNBOOK.md`:

- environment variables без secret values;
- ports `7860/8788/3000`;
- exact install/start/readiness/test/stop commands;
- checkpoint temp path contract;
- flag off/on commands;
- known safe cleanup limited to harness-owned PIDs/files.

`docs/dev/handoff/STAGE_01_COPILOTKIT_AG_UI_BRIDGE.md`:

- base SHA и final SHA;
- A01…A10 commits/reviews;
- changed paths;
- route/agent/flag contract;
- frontend interrupt contract: exact test-only path, official hook signature, all-open render, explicit approve/reject and cancel/abandon semantics;
- dependency/hash/license table;
- commands/exit codes/timestamps;
- test/entity/thread/run/checkpoint evidence IDs без secrets, включая отдельные approve/reject old-thread/new-run/one-effect records и cancel no-request record;
- security/source scan;
- tool availability;
- completed/not completed/partial/defects/blockers;
- final criteria map и verdict.

### 12.4 Инструментальная обязательность

Каждый субагент повторно подтверждает в handoff: `source`, `Graphify`, `Context7`, official docs, test runner и browser/Chrome/Computer были использованы при релевантности; недоступность зафиксирована по schema §4.10. Нельзя подменять exact verification неопределённой проверкой или писать «инструмент не работал»/«docs consulted» без exact call/URL/error/evidence.

---

## 13. Условия невыполнения

### 13.1 Этап заблокирован — BLOCKED

Используется только когда после исчерпания безопасных in-scope alternatives отсутствует prerequisite:

- нет compatible immutable adapter artifact;
- Context7 и official/registry sources недоступны настолько, что API/behavior нельзя доказать;
- pinned CopilotKit v2 `useInterrupt`/`resolve({ approved: boolean })` contract не подтверждён одновременно Context7 и installed package types либо эти источники расходятся;
- proven adapter не имеет auth binding/FastAPI/resume seam, а custom fallback запрещён;
- обязательная локальная runtime dependency объективно недоступна и не может быть восстановлена в scope.

При `BLOCKED`:

1. зафиксировать exact attempted calls/errors;
2. перечислить completed work;
3. не изменять manifests/locks, если admission не прошёл;
4. назвать минимальное внешнее unblock condition;
5. не начинать A02+ или Stage 02.

### 13.2 Этап выполнен частично — FAIL

Фраза отображает `FAIL`, если execution начат, но acceptance не достигнут:

- любой test/build/Playwright/source guard nonzero;
- один из A01…A10 не имеет practical deliverable;
- есть unresolved Critical/blocking defect;
- найден custom chat/protocol/runtime;
- A04 renderer теряет open interrupt, использует неофициальный resolver/event/parser или Escape/close отправляет reject;
- A10 не доказывает через официальный UI отдельные approve/reject с same thread/new run/one effect;
- auth/ownership/checkpoint/replay criteria нарушены;
- evidence/review incomplete;
- unowned/forbidden path changed.

При `FAIL` команда продолжает цикл fix→reverify внутри S01. Переход запрещён.

### 13.3 Недопустимые способы «закрытия»

- объявить PASS по historical artifact;
- заменить executable probe ссылкой/памятью модели;
- принять 0.0.42;
- замаскировать test failure как blocker;
- использовать `PARTIAL` как статус;
- пропустить unavailable-tool log;
- перенести Critical defect в Post-MVP;
- начать product Chat/Stage 02 до PASS.

---

## 14. Условия и контроль перехода

### 14.1 Условия перехода к Этапу 02

Все условия обязательны:

1. A01…A10 = PASS.
2. Sync-B candidate содержит все deliverables.
3. Полный gate §10.2 = PASS на одном SHA.
4. Compatible adapter immutable identity доказана.
5. Context7 + pinned installed package types подтверждают exact official `useInterrupt` renderer и `resolve({ approved: boolean })` signature; A04 Jest/typecheck = PASS.
6. Standard text/tool/state/interrupt/resume = PASS; browser выполняет отдельные approve/reject только через A04 UI, сохраняя thread, меняя run и создавая один effect.
7. Escape/close = cancel/abandon: resume/reject request отсутствует, interrupt остаётся open.
8. Auth/actor/thread/run/Job negative matrix = PASS.
9. Checkpoint new-app resume = PASS.
10. Flags/proxy/3-process Chromium/legacy Flow = PASS.
11. Security/source/compliance review = PASS и custom events/parser/manual resume отсутствуют.
12. `not_completed`, `partial`, `blocking_defects` и `blockers` пусты.

Любой non-PASS запрещает переход.

### 14.2 Subagent review gate

Для каждого Axx coordinator требует:

- implementer handoff;
- reviewer ID;
- reviewed commit SHA;
- spec verdict;
- code/security/test findings;
- disposition каждого finding;
- rerun command после исправления.

A10 получает независимый coordinator review. Review без чтения diff и rerun focused command не принимается.

### 14.3 Подробный контроль перехода

Заполняется дословно в final handoff:

```yaml
stage: 01
base_sha: 5fe1cb74fe8b2db8b48f66859cfbf72e56cf3782
candidate_sha_from: "git rev-parse HEAD; записать фактический 40-символьный stdout"

completed:
  - task_id: S01-A01
    commit_from: "git rev-parse codex/mvp-s01-a01-admission"
    deliverable_paths_from: "git diff-tree --no-commit-id --name-only -r $(git rev-parse codex/mvp-s01-a01-admission)"
    evidence_rule: "перечислить фактически запущенные команды A01, exit codes и docs/dev/handoff/STAGE_01_AG_UI_ADMISSION.md"

not_completed: []

partial: []

defects:
  blocking: []
  non_blocking: []

blockers: []

tests:
  - command: "uv run pytest src/backend/tests/unit/agentic/api/test_ag_ui_adapter_contract.py -q"
    exit_code: 0
    timestamp_utc_from: "date -u +%Y-%m-%dT%H:%M:%SZ; записать фактический stdout"
    sha_from: "git rev-parse HEAD; записать тот же SHA, что candidate_sha"
  - command: "cd src/frontend && npm test -- --runInBand src/components/core/assistantPanel/__tests__/copilotkit-interrupt-probe.test.tsx && npm run type-check:production"
    exit_code: 0
    timestamp_utc_from: "date -u +%Y-%m-%dT%H:%M:%SZ; записать фактический stdout"
    sha_from: "git rev-parse HEAD; записать тот же SHA, что candidate_sha"
  - command: "npx playwright test -c playwright.mvp.config.ts tests/core/integrations/copilotkit-ag-ui-probe.spec.ts --project=chromium"
    exit_code: 0
    timestamp_utc_from: "date -u +%Y-%m-%dT%H:%M:%SZ; записать фактический stdout"
    sha_from: "git rev-parse HEAD; записать тот же SHA, что candidate_sha"

subagent_reviews:
  - task_id: S01-A01
    reviewer: S01-A10
    reviewed_sha_from: "git rev-parse codex/mvp-s01-a01-admission"
    verdict: PASS
    findings_open: []

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

Поля с суффиксом `_from` являются точными командами получения evidence: в completed report их заменяют фактическим stdout и сохраняют саму команду рядом. Если фактическое значение получить невозможно, соответствующая задача переносится в `not_completed` или `blockers`, а verdict становится FAIL/BLOCKED.

### 14.4 Обязательный журнал контроля перехода

**Контроль выполняется субагентами с использованием всех доступных релевантных инструментов.**

Журнал заполняется на candidate SHA после Sync B и до вычисления итогового verdict. Ни одно поле нельзя опустить, заменить ссылкой на устное резюме или свернуть в формулировку без проверяемого evidence. Для каждого поля обязательны:

- `evidence` — exact path, commit SHA, команда с exit code, test output, screenshot либо source/runtime observation;
- `owner` — конкретный `S01-A01…S01-A10` или coordinator, отвечающий за полноту поля;
- `verdict` — только `PASS`, `FAIL` или `BLOCKED`.

```yaml
Обязательный журнал контроля перехода:
  Выполненные задачи:
    evidence: "Фактический список S01-Axx с commit SHA, exact deliverable paths и прошедшими focused commands"
    owner: coordinator
    verdict: PASS

  Невыполненные задачи:
    evidence: "Фактический список S01-Axx; при отсутствии записать пустой список и сослаться на полную A01–A10 commit/review matrix"
    owner: coordinator
    verdict: PASS

  Частично выполненные задачи:
    evidence: "Фактический список S01-Axx и незакрытые acceptance items; при отсутствии записать пустой список с evidence полного task criteria PASS"
    owner: coordinator
    verdict: PASS

  Обнаруженные дефекты:
    evidence: "Stable defect IDs, severity, exact reproduction, affected paths, disposition и rerun result; при отсутствии приложить source/security scan и test gate"
    owner: S01-A10
    verdict: PASS

  Активные блокеры:
    evidence: "Exact unavailable prerequisite, attempted calls, errors, safe alternatives и minimal unblock; при отсутствии приложить tool-availability ledger"
    owner: S01-A01
    verdict: PASS

  Результаты тестирования:
    evidence: "Все команды §10.2 с timestamps UTC, exit codes и candidate SHA; отдельно A04 Jest/typecheck, A08 backend resume и A10 Chromium approve/reject/cancel evidence; failed/skipped command перечисляется явно"
    owner: S01-A10
    verdict: PASS

  Результаты проверки субагентами:
    evidence: "Для A01–A10: reviewer ID, reviewed commit SHA, findings, disposition и focused rerun"
    owner: S01-A10
    verdict: PASS

  Соответствие критериям завершения:
    evidence: "Построчный mapping criteria §9 и §10.1 на exact tests, paths, source/runtime proof и dependency admission"
    owner: S01-A10
    verdict: PASS

  Вывод о возможности перехода к следующему этапу:
    evidence: "Candidate SHA, итоговые verdict всех восьми предшествующих полей и вычисление по алгоритму §14.5"
    owner: coordinator
    verdict: PASS
```

Значения `verdict: PASS` в шаблоне являются требуемым состоянием успешного перехода, а не заранее присвоенным результатом: completed report обязан заменить их фактическими verdict. Если хотя бы одно из девяти полей имеет `FAIL` или `BLOCKED`, если evidence отсутствует либо owner не указан, итоговый `transition_allowed` равен `false`.

**Stage 02 запрещено начинать без полного `PASS` Этапа 01. Любой `FAIL`, `BLOCKED`, незаполненное поле журнала, отсутствующее evidence или незакрытый subagent review безусловно запрещает Stage 02.**

### 14.5 Алгоритм verdict

```text
если есть внешний/локально неустранимый prerequisite blocker
  -> BLOCKED
иначе если not_completed не пуст
  или partial не пуст
  или blocking defects не пуст
  или blockers не пуст
  или любой task/review/criterion/test не PASS
  -> FAIL
иначе
  -> PASS
```

`transition_allowed=true` допустим только при `verdict=PASS`.

---

## 15. Итоговый формат отчёта

Итоговый пользовательский verdict должен быть ровно одной из трёх фраз:

Строгий mapping: `PASS` = «этап выполнен»; `FAIL` = «этап выполнен частично»; `BLOCKED` = «этап заблокирован». `PARTIAL` запрещён.

| Фраза | Status | Переход |
| --- | --- | --- |
| **этап выполнен** | PASS | разрешён |
| **этап выполнен частично** | FAIL | запрещён |
| **этап заблокирован** | BLOCKED | запрещён |

`PARTIAL` как Status не существует.

После verdict-фразы отчёт обязан содержать:

1. `Status: PASS|FAIL|BLOCKED`;
2. base SHA и candidate SHA;
3. completed/not completed/partial;
4. defects и blockers;
5. A01…A10 commit/deliverable/review matrix;
6. exact tests/exit codes/timestamps;
7. criteria map;
8. dependency versions/commit/hashes/LICENSE;
9. route/agent/flag/checkpoint contract и frontend official interrupt contract (`useInterrupt` type proof, all-open render, approve/reject request metadata, same-thread/new-run/one-effect, cancel no-request);
10. security/source evidence;
11. tool availability/unavailability;
12. `transition_allowed: true|false`.

Запрещены формулировки «почти PASS», «PASS с оговорками», «условный PASS» и переход при любом non-PASS. Если deterministic code частично готов, но admission artifact отсутствует, итог — **этап заблокирован / BLOCKED**, а не PASS. Если artifact выбран, но проверка падает или остался blocking defect, итог — **этап выполнен частично / FAIL**.
