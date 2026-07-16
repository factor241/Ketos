# Ketos: журнал инструментов и доказательств

**Baseline:** `redesign/sidebar-account` @ `572fad8ea2223e342508ecf095133091c7714e1b`  
**Назначение:** отделить фактически выполненные действия от заявленных возможностей и честно зафиксировать ограничения.

## 1. Git и состояние workspace

Фактически выполнены `git status --short --branch`, `git branch --show-current`, `git rev-parse HEAD`, просмотр recent log/diff и проверка submodules. Исходная точка:

```text
branch: redesign/sidebar-account
HEAD:   572fad8ea2223e342508ecf095133091c7714e1b
status: clean, tracking origin/redesign/sidebar-account
submodules: none
```

Graphify snapshot относится к `82510d5df3f1959d7eb62332894353242469ed2d`; текущая ветка отличается четырьмя commits и примерно 143 files, в основном sidebar/localization changes. В ходе исследования исходный код, generated artifacts, locks, deployment, LICENSE и NOTICE Ketos не изменялись. Созданы только семь запрошенных `.md`; отдельно клонирован OpenSwarm.

## 2. Поиск и статический анализ

Использовались `rg`, `rg --files`, `find` только когда требовался inventory, `sed`/`nl` для source slices, `jq` для JSON metadata, Git diff/log, package/pytest/Jest/Playwright inventory. Поиск охватывал:

- frontend routes, FlowPage/PageComponent, stores, assistant/playground/sidebar/i18n;
- backend routers/services/models/migrations/authz/audit/MCP/jobs;
- KFX graph/components/events/chat input-output;
- tests/config/build and desktop/Tauri markers;
- Graphify output metadata;
- отдельную копию OpenSwarm.

`rg` по Tauri manifests/runtime entries не обнаружил Tauri shell; случайные строки в test data не считались архитектурой.

## 3. Graphify — фактическое применение

### 3.1 Проверка карты

Файл `graphify-out/graph.json` существует и содержит:

```text
graphify_version: 0.8.40
built_at_commit: 82510d5df3f1959d7eb62332894353242469ed2d
nodes: 63,720
links: 128,403
hyperedges: 27
```

Карта охватывает frontend/backend/KFX на commit её построения. Она **не соответствует текущему HEAD**, поэтому не названа актуальной.

### 3.2 Выполненные Graphify-команды

Фактически выполнены, среди прочего:

```bash
graphify query "FlowPage"
graphify query "useFlowStore"
graphify query "Message"
graphify query "Project"
graphify explain "PageComponent"
graphify path "FlowPage" "useFlowStore"
```

Последняя команда дала однопереходную связь `FlowPage() --calls--> useFlowStore`. Subagent chat audit дополнительно использовал graph queries для assistant/message/session/stream и восстановил маршрут:

```text
api_router_assist_stream
 → _resolve_assistant_context
 → AssistantRequest
 → execute_flow_with_validation_streaming
```

Graphify применялся до распределения final evidence: он сузил области `FlowPage/store`, assistant route/service, Message/session and Project/Folder. После этого каждый вывод проверялся source-of-truth.

### 3.3 Почему карта не перестроена

Обязательный для этого turn локальный Graphify skill разрешает read-only `query/path/explain`, но прямо запрещает rebuild/update `graphify-out`. Пользователь одновременно потребовал актуализировать карту. Более высокий по приоритету инструментальный контракт не позволил выполнить rebuild.

Зафиксированный blocker:

- **Причина:** запрет skill на изменение graph artifacts.
- **Попытки:** metadata/current commit comparison, CLI read-only queries, source verification; rebuild не запускался, чтобы не нарушить запрет.
- **Альтернатива:** `rg`/direct source, Git diff since built commit, independent subagents, focused tests.
- **Влияние:** высокий уровень уверенности у source-backed conclusions сохранён; требование «построить актуальную semantic map current commit» формально не выполнено. Поэтому весь пакет не должен получать безусловный итоговый PASS.
- **Минимальный unblock:** отдельная разрешённая сессия/изменение Graphify policy, после чего rebuild на `572fad8...` и rerun query/path validation.

## 4. RLM/Aleph — фактическое применение и деградация

RLM skill был прочитан полностью. Локальная команда `alef` доступна и сообщила Aleph `0.9.4` (alias deprecated). Выполнены реальные RLM попытки углублённой навигации:

1. Контекст `PageComponent/index.tsx`, `max_iterations=3`, `max_tokens=6000`: после ~133 s — `Token budget exceeded: used 7711 > max 6000`, затем MCP shutdown warnings.
2. Контекст `MemoizedComponents.tsx`, `max_iterations=1`, `max_tokens=3000`: ответ `Unknown; isolated ctx contents not exposed`; полезных evidence не получено.
3. Независимый frontend audit RLM вызов: `Wall-time budget exceeded during provider call; iterations:1; tokens:0`.

Таким образом, RLM **фактически применён**, но в этой среде оказался непригоден для доказательных выводов. Запрещено утверждать, что он восстановил цепочки. Его отказ повлиял на способ работы: цепочки восстановлены Graphify read-only + direct source + subagents. Уровень уверенности runtime hypotheses не повышался.

Минимальный unblock: исправить provider/context exposure и дать bounded RLM budget, затем повторить на curated slices `PageComponent+flowStore`, `assistant router+service+buffer`, `MCP router+execution`, `FlowVersion activation`.

## 5. Chrome и Computer Use

### 5.1 Visual references

Computer Use применён к шести приложенным PNG в оригинальном разрешении. Зафиксированы только видимые факты:

- dotted spatial canvas, pan/zoom/minimap controls;
- multiple card/window surfaces;
- chat header/history/composer/model/thinking selectors;
- workflow/calendar, browser-like, note and document/form cards;
- header actions, expand/close/resize affordances;
- bottom launcher/dock and Dashboard selector.

Не выводилось из screenshots: библиотека canvas, persistence, streaming protocol, license, actual fullscreen implementation или performance.

### 5.2 Live Ketos

Chrome plugin initialized session `OpenSwarm reference audit` и проверил `http://localhost:7860/flows`. Текущий UI показал project/flow list и sidebar:

```text
Проекты
Мои проекты
New Project
Starter Project
MCP-сервер
Сценарии
Новый сценарий
```

Это подтвердило отсутствие внешнего Board Canvas на current route и смешанную RU/EN строку, позднее найденную в source. Live interaction использовался как UI evidence, не как замена source audit. Перед завершением Chrome research tabs/session закрываются через plugin finalize.

## 6. Product Design и Superpowers skills

Фактически прочитаны и применены:

- Superpowers `using-superpowers`, `dispatching-parallel-agents`, `brainstorming`, `writing-plans` — задали bounded research tasks, evidence-first synthesis и prototype-first plan.
- Product Design `index`/`audit` и его context/framework — screenshots трактовались как desired UX evidence; выполнена проверка сохранённого design context (не обнаружен), current UI и accessibility/interaction risks.
- Chrome control и Computer Use skills — live UI and reference inspection.
- Graphify и Aleph-RLM skills — с ограничениями выше.

Навязанный brainstorming pause не использовался для запроса повторного подтверждения, потому что пользователь дал подробный brief и запретил implementation; результатом является аналитика, не product mutation.

## 7. OpenSwarm: internet/Git и локальная копия

Использованы web/Git search and repository metadata для различения одноимённых candidates. Точный repository затем клонирован **отдельно**:

```text
path:   /Volumes/Projects/OpenSwarm
origin: https://github.com/openswarm-ai/openswarm.git
branch: main
commit: ab982afcea63dbc775f8a40b74a1b1339a28097f
status: clean
```

Проверены README, LICENSE, package manifests, Dashboard frontend, dashboard_layout/dashboards backend, chat/WebSocket/workflow modules and tests. Ketos `.git`, dependencies and history не затронуты. Source-level conclusions in [03](03_OPENSWARM_REUSE_ASSESSMENT.md) are pinned to this commit.

## 8. Выполненные тесты

| Команда/область                   | Результат                                    | Интерпретация                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:i18n`               | PASS: Node 44 tests + Jest 5 suites/67 tests | i18n contracts healthy; не опровергает live hardcoded string.                                                                                                                                 |
| Focused assistant frontend suites | PASS: 4 suites/25 tests                      | Current assistant unit behavior; не multi-window proof.                                                                                                                                       |
| Focused backend headless/authz    | PASS: 19 tests, 1 warning                    | Selected security/headless paths; не полный security audit.                                                                                                                                   |
| Selected FlowVersion tests        | PASS: 2 tests, 1 warning                     | Selected model/service behavior; не derived-state rollback proof.                                                                                                                             |
| Broad backend selection           | INCONCLUSIVE                                 | Прерван вручную около 25% после 77 PASS из-за повторного полного migration setup. 66 teardown errors after interrupt относятся к pytest-asyncio/Ctrl-C lifecycle и не объявлены product FAIL. |

Полный lint/build/test suite не требовался для source changes, поскольку source не менялся, но для текущей readiness broad run остаётся незакрытым. Это отражено в плане P9.

## 9. Evidence hierarchy и уверенность

При конфликте использован порядок:

1. current commit source/schema/migration/API;
2. focused current tests/runtime UI;
3. Graphify hypothesis, подтверждённая source;
4. pinned OpenSwarm source;
5. screenshot visual facts;
6. вывод/гипотеза.

Subagent claims без file path/source confirmation не переносились в final recommendations. Старые memory summaries использовались только для выбора audit workflow, не как current Ketos truth.

## 10. Невыполненное и влияние

| Требование                                     | Статус                 | Причина/влияние                                                                                                                    |
| ---------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Актуализировать Graphify map на current commit | **BLOCKED**            | Skill prohibits rebuild; current map stale by 4 commits. Source-backed audit остаётся полезным, strict completion condition — нет. |
| Получить полезный RLM analysis                 | **BLOCKED/DEGRADED**   | Реальные вызовы завершились budget/provider/context failures. RLM применён, но выводов не дал.                                     |
| Полный uninterrupted repository test baseline  | **Не завершено**       | Broad backend setup слишком долгий и был прерван; focused evidence only.                                                           |
| Production scale claims                        | **Не проверено**       | Нет representative data/hardware/deployment; вынесено в P0/P9.                                                                     |
| Legal opinion                                  | **Не предоставляется** | MIT facts checked; formal legal/SBOM review нужен при copying.                                                                     |

## 11. Воспроизводимый минимальный refresh

После снятия blocker следует:

1. убедиться, что checkout остаётся `572fad8...` или зафиксировать новый baseline;
2. разрешённым Graphify workflow построить map и убедиться `built_at_commit == HEAD`;
3. повторить перечисленные `query/path/explain`, сверить node/link deltas;
4. исправить Aleph provider/context и повторить четыре curated slices;
5. обновить только evidence/status sections в [02](02_KETOS_CURRENT_ARCHITECTURE_AUDIT.md), [04](04_KETOS_CRITICAL_ARCHITECTURE_REPORT.md) и этом журнале;
6. запустить full gates в отдельном длительном CI/job, не смешивая interrupt errors с product failures.

## 12. Итог статуса исследования

Семь аналитических документов, 40 requirement assessments, OpenSwarm component/license audit, 10 independent research tasks and source-backed plan подготовлены. Строгий итог по пользовательскому чек-листу — **BLOCKED**, а не PASS: current-commit Graphify rebuild запрещён, RLM calls degraded, full baseline tests incomplete. Это не отменяет пригодность документов как pre-project basis, но требует refresh перед формальным архитектурным sign-off.
