# Ketos: журнал исследований субагентов

**Baseline:** `redesign/sidebar-account` @ `572fad8ea2223e342508ecf095133091c7714e1b`  
**Засчитано:** 10 самостоятельных исследовательских задач, не считая основного агента.  
**Правило:** отчёты не объединялись механически; основной агент перепроверял ключевые пути по source, Graphify queries, тестам и cross-report contradictions.

## 1. Организация работы

Платформа разрешала одновременно четыре agent slots, включая основного агента. Первые направления выполнялись встроенными team agents; после системной ошибки `agent thread limit reached` независимые read-only исследования запускались последовательными изолированными Codex research sessions с тем же checkout. Они получали разграниченный scope, запрет на edits и одинаковый формат доказательств. Эта техническая смена транспорта не меняла самостоятельность задач; неудачные/пустые попытки ниже не засчитаны.

## 2. Засчитанные исследования

### FE-01 — frontend, внешний canvas и Flow Editor

- **Объём:** routes, FlowPage/PageComponent, stores, viewport/save/load, NoteNode, navigation, nested canvas risks.
- **Изучено:** `src/frontend/src/pages/FlowPage/**`, `components/PageComponent`, `stores/flowStore.ts`, save/apply hooks, NoteNode, router/sidebar/MainPage.
- **Факты/цепочки:** editable ReactFlow монтируется в `PageComponent`; `FlowPage → useFlowStore`; graph/undo/build singleton; load uses fitView; NoteNode persists in Flow; outer Board отсутствует.
- **Риски/противоречия:** global IDs/document hotkeys/body cursor and singleton stores делают multi-editor mount небезопасным; Flow viewport ≠ Board viewport.
- **Рекомендация:** separate Board/Placement; one active full editor + previews; POC gesture/store isolation.
- **Уверенность:** высокая о текущем состоянии, средняя о выбранной compositor strategy.
- **Нужна проверка:** memory/gesture benchmark and feasibility of scoping current store.
- **Проверка основным агентом:** Graphify `FlowPage`, `useFlowStore`, `PageComponent`, direct source slices и live Flow UI.

### CHAT-02 — chats, messages и streaming

- **Объём:** Assistant, Playground new/legacy, KFX ChatInput/Output, Message model, build/run/SSE/WebSocket.
- **Изучено:** `assistantPanel/**`, `use-post-assist-stream.ts`, agentic router/service/buffer/SSE; `flow-page-sliding-container.tsx`; `IOModal`; `sessionManagerStore.ts`; `messagesStore.ts`; KFX chat components; message model/crud; monitor/build/run/v2 routes.
- **Факты/цепочки:** Assistant has one controller/session/AbortController; backend context process-local; Playground stores singleton; no Chat entity; session rename rewrites identity; four incompatible stream dialects.
- **Риски:** cross-chat state/cancel leakage; cross-flow session mutation; restart context divergence; no sequence/replay/idempotency.
- **Рекомендация:** ChatThread + Message.chat_id + Placement; per-chat controller; unified stream envelope.
- **Уверенность:** высокая; retry duplication/voice metadata disclosure — средняя until runtime test.
- **Нужна проверка:** proxy/multi-worker behavior and million-message query plans.
- **Проверка основным агентом:** focused assistant tests 25 PASS; source traces and Graphify chat/message queries.

### DA-03 — модели данных, DB и миграции

- **Объём:** Flow, Folder, Message, FlowVersion, Job, User/RBAC, Alembic constraints and concurrency.
- **Изучено:** `src/backend/base/ketos/services/database/models/**`, migration tree, CRUD/services and selected FlowVersion tests.
- **Факты:** Folder has parent_id; Message lacks immutable Chat FK; Flow FK removal and indexes do not match chat history; Job logical refs often lack FK; dedupe check-then-insert; FlowVersion has useful constraints but version race/retry.
- **Риски:** ambiguous backfill, lost metadata update, orphan logical refs, activation-derived-state drift.
- **Рекомендация:** additive Board/Placement/Chat/Result/Proposal tables; expand→dual-write/backfill→validate→contract; CAS/idempotency/outbox.
- **Уверенность:** высокая on schema; medium on PostgreSQL runtime impact.
- **Нужна проверка:** production cardinalities/query plans and exact old session collision rate.
- **Проверка основным агентом:** direct models/migrations; selected FlowVersion 2 PASS; backend migration run behavior.

### SEC-04 — security, RBAC, audit and confirmation

- **Объём:** auth dependencies, authorization services/tables, ownership, audit, API keys, assistant confirmations, component risk.
- **Изучено:** backend auth/authz services, RBAC/share models, assistant API/service, audit paths, component scanner, MCP/run routes.
- **Факты:** OSS authorization can be permissive under config; owner override is not granular policy; Flow.locked is not CAS/lease; confirmations are not universal; AST scan is not sandbox/egress control; audit can be best-effort.
- **Риски:** confused deputy, SSRF/custom code/data exfiltration, confirmation replay, audit gaps, secret exposure.
- **Рекомендация:** central CommandGateway/policy; resource-action matrix; capability/risk manifest; one-time confirmation; transactional outbox/redaction.
- **Уверенность:** high on code paths, medium on deployment-specific exposure.
- **Нужна проверка:** actual production AUTHZ/audit/sandbox configuration.
- **Проверка основным агентом:** focused authz/headless 19 PASS; compared MCP/AI/data reports.

### FLOW-05 — Flow Editor, FlowVersion, KFX and AI edits

- **Объём:** Flow serialization/execution, component registry, assistant edit/apply, version/activation, manual build.
- **Изучено:** FlowPage/store, agentic assistant service/edit chain, FlowVersion model/service/routes, build/run, `src/kfx` graph/components.
- **Факты:** AI incremental edits can directly mutate Flow.data; preview is not persisted proposal; activation may not cover webhook/cache/deployment derived states; build may execute request graph rather than persisted revision.
- **Риски:** lost manual edit, invalid handles/params, executed provenance ambiguity, incomplete rollback.
- **Рекомендация:** base-revision proposal, canonical server diff/validation, confirm-once, FlowVersion provenance, one full editor.
- **Уверенность:** high on write paths; medium on complete derived-state inventory.
- **Нужна проверка:** production extension corpus and activation side effects.
- **Проверка основным агентом:** source cross-check with FE/SEC; FlowVersion selected tests.

### MCP-06 — MCP and alternative control plane

- **Объём:** MCP discovery/execution, assistant/headless mutation, batch semantics; comparison with REST/application service/hybrid.
- **Изучено:** Ketos MCP project/tool APIs/services, KFX MCP tools, agentic headless path, batch/permission code.
- **Факты:** `mcp_enabled` filters discovery but is not proven universal execute enforcement; headless can apply immediately; destructive tools lack common preview; batch is nontransactional.
- **Риски:** tool allowlist bypass, partial mutation, duplicated authorization, no rollback.
- **Рекомендация:** `REST/Assistant/MCP → CommandGateway → policy/preview/confirm/UoW/outbox/audit`; MCP optional restricted adapter.
- **Уверенность:** high on architectural comparison, medium on every edition-specific MCP path.
- **Нужна проверка:** external MCP clients and complete tool registry inventory before exposure.
- **Проверка основным агентом:** compared SEC/FLOW findings and direct router/service search.

### PERF-07 — persistence, recovery, concurrency and scale

- **Объём:** state ownership across DB/Zustand/React Query/local/session storage/process RAM; save patterns; concurrency/idempotency/performance.
- **Изучено:** frontend stores/save hooks, assistant buffer/history, Message/Job/FlowVersion CRUD, OpenSwarm save/layout controllers.
- **Факты:** no revisioned Board snapshot; Flow load fitView; process-local assistant context; write-race patterns; no heavy window virtualization; OpenSwarm has debounce/flush/RAF patterns.
- **Риски:** write amplification, stale tabs, memory from editors/chats, reconnect uncertainty, check-then-insert races.
- **Рекомендация:** server authoritative revisions, CAS patches, debounce+flush, lazy/suspend, sequence/replay, measured 100/500/1000 corpus.
- **Уверенность:** high on structural risks, low-to-medium on capacity until benchmarks.
- **Нужна проверка:** hardware profile, Postgres, proxy/multi-worker, production data.
- **Проверка основным агентом:** cross-checked FE/CHAT/DA and OpenSwarm source.

### DESIGN-08 — design, navigation, projects, search and i18n

- **Объём:** current sidebar/routes/account, Folder/project UX, search, localization, six visual references.
- **Изучено:** sidebar/MainPage/router/hooks, locale resources/config/migration/tests; screenshots at original resolution and current Chrome UI.
- **Факты:** RU/EN infrastructure is mature; RU 2417 vs EN 2345 keys, 72 EN gaps; live `New Project`; Folder hierarchy underused; references show canvas/minimap/cards/dock but not implementation facts.
- **Риски:** pixel-copying a foreign design, navigation overload, hardcoded strings, inaccessible nested zoom/focus.
- **Рекомендация:** Ketos tokens/CardFrame/state matrix; phased IA; Project compatibility adapter; permission-aware federated search.
- **Уверенность:** high on current files/visual facts, medium on final IA without usability test.
- **Нужна проверка:** user testing, responsive targets, approved visual direction.
- **Проверка основным агентом:** Computer Use + Chrome live page; `test:i18n` 111 total checks PASS; direct key audit.

### TEST-09 — testing, compatibility, migrations and delivery plan

- **Объём:** test inventory, CI/package gates, Alembic, Playwright/Jest/pytest, visual/Tauri/compatibility gaps.
- **Изучено:** test trees/config/package scripts/workflows; backend/KFX/frontend/migration/E2E suites.
- **Факты:** substantial suites (~599 backend pytest, ~258 KFX, ~442 Jest, ~170 Playwright, ~80 Alembic files/tests by inventory), no adequate board/concurrent-chat/nested-editor gates, limited visual regression, Tauri absent.
- **Риски:** green unit tests falsely signaling spatial readiness; migration setups are costly; Chromium-only/skip coverage gaps.
- **Рекомендация:** prototype-first critical path; dual DB migration gates; legacy Flow corpus; browser/restart/load/security matrices.
- **Уверенность:** high on inventory/gaps, medium on CI runtime due incomplete broad run.
- **Нужна проверка:** full uninterrupted package gates in implementation branch and supported browser matrix.
- **Проверка основным агентом:** executed focused suites; broad backend run recorded INCONCLUSIVE, not mislabeled FAIL/PASS.

### OPEN-10 — OpenSwarm architecture and license

- **Объём:** repository identification, clone/provenance, MIT license, stack, canvas/cards/chat/state/persistence/tests and reuse matrix.
- **Изучено:** `/Volumes/Projects/OpenSwarm` frontend Dashboard canvas/cards/stores/hooks, backend dashboards/layout/chat/workflow models/services, tests, package manifests, LICENSE.
- **Факты:** exact repo `openswarm-ai/openswarm@ab982af`; Electron/React/Redux/MUI/FastAPI; custom CSS transform; JSON atomic persistence; WebSocket chat; multi-window stress tests; fullscreen not confirmed as complete component.
- **Риски:** architecture/license confusion, second backend, Electron webview, MUI/Redux coupling, no Ketos nested editor solution.
- **Рекомендация:** adapt RAF/viewport/minimap/debounce patterns; rewrite cards/state/data; reject backend/Electron/browser webview in MVP; retain MIT notice for copied substantial code.
- **Уверенность:** high.
- **Нужна проверка:** transitive SBOM/legal review if code is actually copied.
- **Проверка основным агентом:** Git remote/commit/clean, direct source/model/license inspection and visual comparison.

## 3. Незасчитанные попытки

| Попытка                                                 | Почему не засчитана                                                                                 | Влияние                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `repo_architecture` team agent                          | Не завершил содержательный отчёт в отведённом цикле и был остановлен.                               | Его утверждения не использованы. Архитектурный обзор собран основным агентом из 10 отчётов и source. |
| Первая экспериментальная CLI research session           | Патологически долго выполнялась и была прервана без bounded deliverable.                            | Не использована и не засчитана.                                                                      |
| Попытка FE-агента делегировать дополнительный Flow task | `agent thread limit reached`; итоговая запись статуса перезаписала его ранее доставленный FE-аудит. | Дополнительная задача не засчитана; ранее доставленные FE evidence перепроверены основным агентом.   |

## 4. Разрешённые противоречия

| Тема                   | Различающиеся выводы                                      | Проверка основного агента                                                              | Итог                                                                             |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Project vs Folder      | «Проекты уже есть» / «Project model отсутствует»          | Model has Folder+parent_id; UI calls it Project; no separate Project table/pin/archive | Product Project partially exists as Folder adapter; extend additively.           |
| Chat persistence       | Message history exists / durable chat absent              | Message model and session CRUD examined; no ChatThread                                 | Reuse Message payload, add ChatThread and chat_id.                               |
| Flow viewport restore  | Coordinates saved / workspace restore absent              | Save graph vs load fitView paths compared                                              | Node coordinates reusable; exact Board/per-user viewport absent.                 |
| Assistant confirmation | Preview UI exists / unsafe immediate apply exists         | UI events and headless service paths compared                                          | Treat as prototype only; require server proposal/confirm transaction.            |
| OpenSwarm reuse        | MIT allows copying / architecture is incompatible         | License and component/backend coupling inspected                                       | Legal permission does not imply rational full transfer; selective patterns only. |
| MCP necessity          | Existing MCP suggests reuse / MCP batch lacks transaction | Tool paths compared with service/UoW requirements                                      | MCP adapter after CommandGateway, not business core.                             |
| Fullscreen OpenSwarm   | Screenshot affordance / source capability                 | Exact repo card paths checked                                                          | Do not claim finished reusable fullscreen module.                                |
| Broad backend health   | 77 tests passed / teardown errors after interrupt         | Command lifecycle/output separated                                                     | Gate is INCONCLUSIVE; errors after Ctrl-C are not product failures.              |

## 5. Как основной агент проверял evidence

1. Зафиксировал branch/commit/clean status до работы.
2. Сопоставил Graphify nodes/paths с текущими source; stale graph не использован как окончательное доказательство.
3. Повторно открыл ключевые frontend/backend/KFX/model/migration files и проверил цепочки.
4. Запустил focused frontend/backend/version/i18n tests.
5. Проверил реальный UI через Chrome/Computer Use и все шесть screenshots.
6. Отдельно клонировал/проверил OpenSwarm remote/commit/license/source.
7. Не включил незавершённые agents и не повысил уровень уверенности для runtime-only hypotheses.

Подробный журнал инструментов и точные ограничения: [07_TOOL_USAGE_AND_EVIDENCE.md](07_TOOL_USAGE_AND_EVIDENCE.md).
