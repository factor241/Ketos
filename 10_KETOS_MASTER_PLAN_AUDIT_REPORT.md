# Аудит мастер-плана реализации Ketos

**Объект аудита:** [`09_KETOS_MASTER_IMPLEMENTATION_PLAN.md`](09_KETOS_MASTER_IMPLEMENTATION_PLAN.md)  
**Дата проверки:** 2026-07-17  
**Репозиторий:** `redesign/sidebar-account`  
**HEAD:** `80878261d07c21ad257de017d98069f211ada2c2`  
**Кодовый baseline Graphify:** `572fad8ea2223e342508ecf095133091c7714e1b`; различий в `src/**` между baseline и текущим HEAD не обнаружено.  
**Режим:** read-only-аудит кода и планов; исходный код и документы 01–09 не изменялись.

## 1. Итоговый вердикт

Мастер-план 09 правильно фиксирует основную продуктовую позицию Ketos: единый backend, разделение внешней доски и внутреннего Flow Editor, отделение сущности от её размещения, повторное использование Flow/KFX/LFX, безопасный типизированный слой команд до MCP и прототипирование наиболее рискованных решений. Эти положения следует сохранить.

Однако документ **пока не готов к прямому исполнению**. Его итоговый статус — **`NEEDS REVISION`**. Причина не в ошибочности концепции, а в сочетании нескольких архитектурных и программных дефектов:

1. CAS ошибочно привязан к immutable-снимку `FlowVersion`, хотя конфликтует изменяемая строка `Flow`.
2. Безопасность, наблюдаемость и совместимость вынесены слишком поздно, хотя их контракты нужны до Board Run, AI apply и миграции данных.
3. Модель данных не содержит канонической сущности запуска автоматизации, использует слабую полиморфную ссылку `object_type/object_id` и смешивает durable viewport с эфемерным фокусом.
4. Текущий Flow Editor — глобальный singleton; простое встраивание в окно доски приведёт к пересечению store, hotkeys, history, DOM ID и ReactFlow context.
5. Текущая история чатов durable лишь частично: Assistant одновременно зависит от `MessageTable`, process-local buffer и `localStorage`; восстановление контекста после restart отсутствует.
6. Текущий review UI не является серверной транзакцией подтверждения: headless Assistant умеет применять изменения немедленно.
7. Миграции, feature flags и rollback описаны взаимоисключающе: destructive contract-фаза названа additive, а rollback обещает невозможный downgrade после новых записей.
8. Project API уже реализован поверх `Folder`; план ошибочно создаёт впечатление, что адаптер ещё предстоит создать.
9. Критический путь излишне последовательный в одних местах и пропускает реальные блокеры в других.
10. Несколько требований R-01–R-40 привязаны к неверным или неполным фазам.

Исправленная программа реализации сформирована в [`11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md`](11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md).

## 2. Метод и достоверность

### 2.1 Что проверено

- структура и Git-состояние текущего checkout;
- семантическая карта Graphify всего репозитория;
- backend-модели, API, сервисы, миграции и тестовые контракты;
- frontend-маршруты, Flow Editor, stores, hotkeys, viewport, playground и Assistant;
- execution/Job/task/Celery paths;
- authz, audit, rate limit, SSRF, REPL и secret handling;
- KFX/LFX compatibility corpus и CI/migration gates;
- OpenSwarm checkout `/Volumes/Projects/OpenSwarm` и приложенные UI-референсы;
- документы 01–09, отчёт Claude и повторный аудит 08;
- все 40 строк матрицы R-01–R-40.

### 2.2 Graphify

Актуальность карты проверена, а не предположена:

- `graphify-out/graph.json`: 65 618 узлов и 131 157 связей;
- карта построена на commit `572fad8…`;
- `src/**` на текущем HEAD совпадает с этим commit;
- `graphify check-update .` не потребовал обновления;
- запросами и explain/path проверены связи `FlowPage → useFlowStore`, `activate_version → FlowVersion`, `stop_workflow → Job`, `rename_shared_session → MessageTable`, `MCPComposerService → Flow`.

Graphify использован как навигационная карта; итоговые утверждения перепроверены прямым чтением исходников. Перестроение карты не выполнялось, потому что кодовая часть checkout не изменилась и rebuild создал бы лишний churn в `graphify-out`.

RLM/Aleph также были проверены как возможные инструменты углублённой навигации: `command -v rlm` и `command -v aleph` вернули `UNAVAILABLE`. Поэтому заявлять об их применении нельзя; альтернативой стали Graphify query/explain/path, `rg`, Git и прямое восстановление call/data chains. RaytSystem был вызван read-only через `doctor/status`; он отметил собственный snapshot как `stale` по причине изменения checkout новыми документами, при этом сообщил `changed_files: 0` для своего code graph. RaytSystem graph не перестраивался: согласно `AGENTS.md`, он не заменяет Graphify и его rebuild не является побочным действием этого аудита.

### 2.3 Субагенты

Параллельно работали шесть независимых read-only направлений: backend/data, frontend/product, chat/AI, security/execution, delivery/testing и traceability/OpenSwarm. В итоговый вывод включались только факты с путями к файлам; противоречия разрешал основной агент по исходному коду. Подробный протокол выполнения будущего плана приведён в §6 документа 11.

### 2.4 Ограничения

- Полные build/test suites не запускались: задача — аудит плана, а пользователь установил общий лимит RSS 16 ГиБ. Наблюдавшийся максимум составил приблизительно 14,2 ГиБ и оставался ниже лимита.
- Состояние внешнего Tauri/Desktop build pipeline невозможно подтвердить из этого репозитория.
- Производительность вложенного Flow Editor, 500–1000 placements и 10–20 потоков нельзя доказать статически; для них сохранены экспериментальные гейты.
- Доступность и поведение интерфейса нельзя вывести только из скриншотов; они использованы как референс, а не как доказательство WCAG-соответствия.

## 3. Подтверждённая текущая архитектура

### 3.1 Project уже существует как API-адаптер над Folder

- `Folder` уже содержит `parent_id`, `user_id` и `workspace_id`: `src/backend/base/ketos/services/database/models/folder/model.py:22-41`.
- Канонический `/api/v1/projects` уже реализован: `src/backend/base/ketos/api/v1/projects.py:79`.
- `/folders` уже служит compatibility adapter: `src/backend/base/ketos/api/v1/folders.py:16`.
- Недостаёт cycle/depth/workspace validation; frontend-дерево остаётся плоским.

**Вывод:** в V1 доменный `Project` следует хранить в таблице `Folder`, расширив её additive-полями и проверками. Новая таблица `Project` или параллельный API не нужны.

### 3.2 FlowVersion не является точкой CAS

- `Flow` хранит изменяемый `data`, но не имеет revision: `src/backend/base/ketos/services/database/models/flow/model.py:191-219`.
- `FlowVersion` — снимок: `src/backend/base/ketos/services/database/models/flow_version/model.py:12-36`.
- activation копирует snapshot обратно в `Flow.data`: `src/backend/base/ketos/api/v1/flow_version.py:227-292`.
- `PATCH /flows/{id}` имеет authz/TOCTOU checks, но не `expected_revision`: `src/backend/base/ketos/api/v1/flows.py:313-414`.

**Вывод:** добавить `Flow.revision` и conditional update. `FlowVersion.source_flow_revision` допустим как provenance, но `FlowVersion.base_revision` не решает lost update.

### 3.3 Flow Editor не инстанцируем

- один глобальный `useFlowStore`: `src/frontend/src/stores/flowStore.ts:116`;
- один `reactFlowInstance`, AbortController и очередь node updates: `flowStore.ts:64,399,1258`;
- один `currentFlowId`, общие undo/redo history: `src/frontend/src/stores/flowsManagerStore.ts:17-35`;
- приложение обёрнуто одним `ReactFlowProvider`: `src/frontend/src/contexts/index.tsx:20`;
- глобальные hotkeys и `window` events: `src/frontend/src/pages/FlowPage/components/PageComponent/index.tsx:507-540,847-883`;
- фиксированный `id="react-flow-id"`: `PageComponent/index.tsx:939`.

**Вывод:** P0-B является настоящим stop/go экспериментом. До появления `FlowEditorInstance` boundary разрешён только один editable editor; остальные окна — thumbnails/previews.

### 3.4 Viewport Flow сохраняется, но не восстанавливается

- `getViewport()` записывается: `src/frontend/src/hooks/flows/use-save-flow.ts:30-48`;
- загрузка вызывает `fitView()`: `src/frontend/src/hooks/flows/use-apply-flow-to-canvas.ts:21-35`;
- `PageComponent` также вызывает `fitView`: `PageComponent/index.tsx:999`.

**Вывод:** BoardViewport — новая per-user сущность; применять её нужно через `setViewport` с ack/revision, debounce и обязательным flush.

### 3.5 NoteNode нельзя переименовать в BoardNote

`NoteNode` связан с `currentFlow`, Flow store, nodes/history и `Flow.data`: `src/frontend/src/CustomNodes/NoteNode/index.tsx:79` и `src/frontend/src/CustomNodes/GenericNode/components/NodeDescription/index.tsx:39`.

**Вывод:** переиспользовать можно только presentation primitives. BoardNote требует отдельной модели и revision policy.

### 3.6 Chat имеет несколько источников истины

- playground пишет сообщения через KFX ChatInput/ChatOutput в `MessageTable`;
- Assistant prompt history берёт из process-local singleton: `src/backend/base/ketos/agentic/services/conversation_buffer.py:1-30,122-133`;
- frontend сохраняет отдельную копию в `localStorage`: `src/frontend/src/components/core/assistantPanel/hooks/use-session-history.ts:30-113`;
- сообщения имеют обязательный `session_id`, но не `chat_id`: `src/backend/base/ketos/services/database/models/message/model.py:22-38,152-190`.

**Вывод:** нужен canonical `ChatThread`/`ChatTurn`, а buffer и localStorage могут быть только кэшем. Restart должен восстанавливать prompt из committed turns.

### 3.7 Rename session нарушает MemoryBase consistency

- rename меняет только `MessageTable.session_id`: `src/backend/base/ketos/api/v1/monitor.py:349-386,613-648`;
- тот же идентификатор хранится в четырёх MemoryBase SQL-моделях: `src/backend/base/ketos/services/database/models/memory_base/model.py:71-260`;
- Chroma metadata также содержит `session_id`: `src/backend/base/ketos/services/memory_base/task.py:363-405`.

**Вывод:** после введения ChatThread rename меняет только title. Миграция legacy identity требует mapping table, quarantine неоднозначностей и saga/outbox для внешнего vector store.

### 3.8 Review UI не является серверным Command Gateway

- Assistant tools создают raw action dictionaries и в headless режиме могут применять изменения сразу: `src/kfx/src/kfx/mcp/flow_builder_tools/edit_tools.py`, `mutate_tools.py`, `run_tools.py`;
- frontend держит proposal в React state и допускает `auto_apply`: `src/frontend/src/components/core/assistantPanel/hooks/use-assistant-chat.ts:387-520`;
- headless runner использует `apply_edits_immediately=True`: `src/backend/base/ketos/agentic/utils/assistant_runner.py:165-218`.

**Вывод:** validators и UX shape можно переиспользовать, transaction/security semantics — нельзя. Нужны durable proposal, canonical hash, confirmation token, CAS, idempotency и outbox.

### 3.9 Job/execution слой содержит обязательные pre-feature дефекты

- `Job.user_id` nullable: `src/backend/base/ketos/services/database/models/jobs/model.py:68`;
- NULL-owner разрешён любому actor: `src/backend/base/ketos/services/jobs/service.py:51-56,77-82,238-246,327-340`;
- тесты закрепляют fail-open: `src/backend/tests/unit/api/v2/test_workflow.py:1993-2065`;
- run каждый раз создаёт новый UUID; atomic idempotency нет;
- terminal state можно перезаписать CANCELLED;
- result reconstruction использует текущий `Flow.data`, а не executed revision: `src/backend/base/ketos/api/v2/workflow.py:675-700` и `workflow_reconstruction.py:45-80`;
- `get_jobs_by_flow_id` сортирует по отсутствующему `Job.created_at`, тогда как модель имеет `created_timestamp`.

**Вывод:** Board Run нельзя включать до fail-closed ownership, state machine, immutable execution snapshot/result и atomic idempotency.

### 3.10 Security primitives существуют, но coverage недостаточно

- authz action vocabulary уже существует: `src/backend/base/ketos/services/authorization/actions.py:8-72`; часть v2 workflow routes вызывает execute/read guards, но полный route coverage не измерен и не может выводиться только из наличия enum;
- default authorization service разрешает запросы, audit и authz default-off;
- rate limiting применяется в основном к login;
- raw HTTP paths обходят общий SSRF helper;
- Python REPL позволяет user-controlled `global_imports` и не является sandbox;
- public Flow может вернуть `Flow.data`, а redaction default-off.

**Вывод:** coverage matrix должна появиться в контрактной фазе, а не в финальном P9. P9 — независимая проверка уже реализованной защиты.

## 4. Построчный аудит структуры 09

### 4.1 Заголовок и вводная часть — изменить

| Положение 09 | Оценка | Проблема | Исправление |
| --- | --- | --- | --- |
| «10 фаз (P0–P10 + PS)» | Ошибка | P0–P10 — 11 номерных фаз плюс PS | Называть программой волн/гейтов; не использовать неверное число |
| Baseline `572fad8`, HEAD `8087826` | Подтверждено | Без пояснения выглядит как рассинхронизация | Явно указать, что `src/**` идентичен baseline Graphify |
| Каждый phase получает отдельный bite-sized plan | Сохранить | Это правильная граница master plan | Добавить обязательный evidence handoff и independent review |
| «без второго backend» | Изменить | Исходные требования допускают исключение после доказанной необходимости | Запретить второй business backend; внешние worker/scheduler adapters допустимы при Ketos system-of-record |

### 4.2 §0 «непересматриваемые инварианты» — изменить

| ID | Статус | Аудит |
| --- | --- | --- |
| INV-1 | Изменить | Сохранить единый backend, но не запрещать доказанную внешнюю инфраструктуру исполнения/расписаний |
| INV-2 | Сохранить | Board и Flow действительно разные домены/координаты |
| INV-3 | Сохранить | Entity/placement separation — фундамент модели |
| INV-4 | Переклассифицировать | «Один editor» — безопасный V1 default и guard, а не вечный инвариант; P0-B может изменить решение |
| INV-5 | Уточнить | Gateway обязателен для AI/MCP/новых рискованных мутаций; одномоментно переписать все legacy REST mutations нереалистично |
| INV-6 | Сохранить и усилить | Добавить auth-derived actor, schema version, proposal hash и execute-time checks |
| INV-7 | Исправить противоречие | До cutover изменения additive; destructive contract — отдельный поздний release |
| INV-8 | Сохранить | Добавить pseudo-locale и locale-specific plural rules |
| INV-9 | Переписать | Flag rollback не откатывает схемы и никогда не возвращает security fail-open; нужен app rollback на forward-compatible schema |

### 4.3 §1 traceability — исправить

Подтверждены четыре класса дефектов:

1. E-09 отсутствует, хотя footer заявляет покрытие E-00…E-16.
2. `§12.5-Celery` — неверная ссылка; правильно `Claude §12.1.6 / 08 §7.4 / E-15`.
3. E-15 прослежен частично: отсутствуют build heartbeat/watchdog, cross-worker cancel и часть event-delivery фактов.
4. Несколько R привязаны не к тем фазам; исправления приведены в §5.

Статус: **обязательная редакционная коррекция до использования как execution contract**.

### 4.4 §2 C0 — изменить подход

Исправлять исторические отчёты 01–07 «на месте» рискованно: будет потеряна доказательная история и станет невозможно понять, какие выводы действовали на каком commit.

Рекомендуемый подход:

- заморозить 01–09 как historical evidence;
- создать canonical errata/decision register;
- если исправляется factual citation, добавлять changelog и прежнее утверждение;
- валидировать ссылки отдельным скриптом;
- не требовать несуществующий repo-local `prettier --check` без pinned formatter.

Статус C0: **сохранить цель, заменить механизм**.

### 4.5 §3 target model — существенно изменить

| Элемент | Проблема | Рекомендация |
| --- | --- | --- |
| `Board` | Нет workspace boundary | Явный `workspace_id` или доказанное наследование через Project/Folder |
| `BoardViewport` | Смешивает durable viewport и transient focus | Разделить `BoardViewport`, `BoardUserState` и локальные selection/focus |
| `Placement.object_type/object_id` | Нет FK/cascade/RBAC integrity | Для V1 — typed nullable FK + exactly-one CHECK; generic registry только после ADR |
| `ChatThread.model config` | Не отделены identifiers и secrets | Хранить provider/model/settings refs; snapshot config на ChatRun/Turn |
| `Message.chat_id` | Наивный dual-write допускает collision | Добавить `ChatLegacySession` mapping, quarantine и dual-read telemetry |
| `BoardNote` | Нет conversion policy из NoteNode | Явный copy/move/link UX; не автоматическая миграция всех note nodes |
| `ExecutionResult` | Ссылается на незафиксированный execution contract | Расширить `Job` как persistence доменной/API-проекции `AutomationExecution`; второй execution store запрещён без ADR |
| `CommandExecution` | Нет state machine/outbox semantics | Добавить proposal/execution/outbox states, token hash, compensation class |
| `FlowVersion.base_revision` | CAS на неверной строке | `Flow.revision`; version хранит `source_flow_revision` |
| `Project adapter` | Уже существует | Расширять `/api/v1/projects` и `Folder`, не создавать заново |

### 4.6 §3.3 OpenSwarm — сохранить решение, уточнить лицензию

Решение не переносить Electron, JSON persistence, Redux, MUI, Agent/WS backend и BrowserCard webview обосновано.

Фраза «переносить паттерны с MIT-notice» слишком широкая. MIT notice нужен для скопированного или существенно адаптированного кода, но не для независимо реализованной идеи. Нужен provenance ledger с тремя категориями:

1. idea/spec reference — ссылка и ADR, без автоматического включения notice;
2. adapted code — file/hunk mapping, copyright/license notice;
3. copied dependency/code — license, notice, SBOM и transitive review.

### 4.7 §4 P0 prototypes — разделить на параллельные risk waves

Все эксперименты полезны, но единый Exit P0 создаёт исследовательский waterfall. Следует выделить независимые decision gates:

- X-A canvas/semantic zoom/virtualization;
- X-B editor instance/gesture isolation;
- X-C chat streams/recovery;
- X-D persistence/entity-placement/CAS;
- X-E AI IR/preview/confirmation;
- X-F scheduler viability.

P0-H зависит от A–E и не может честно выполняться одновременно с ними. Один disposable branch также не подходит: нужны изолированные worktrees/branches и отдельный integration harness.

Метрика `500-object p95 ≤16.7ms` недостаточна. Требуются hardware profile, fixture seed, visible/offscreen counts, FPS, input latency p50/p95/p99, long tasks, heap, mount count, restore time и payload size. Multi-chat должен проверяться на 1/5/10/20 потоках.

### 4.8 P1 — сохранить, расширить

P1 должна зафиксировать не только domain contracts, но и:

- action/resource/authn/authz/ownership/fail-mode/audit/rate/egress/secret matrix;
- Flow и Placement concurrency contracts;
- execution state machine и event envelope;
- idempotency namespace/fingerprint/replay;
- retention/deletion/export/privacy;
- desktop support decision;
- feature-flag и observability contracts;
- явное исключение realtime collaborative editing из V1.

### 4.9 P2 — разделить

Текущая P2 смешивает schema expand, backfill, dual-write, сервисы и cutover. Нужно:

- F1-E: expand schema и N-1-compatible code;
- F1-W/F1-B: compatible dual-write и resumable backfill + ambiguity ledger;
- F1-V/F1-C: parity window и контролируемый read cutover;
- поздний C7: validate/contract removal после observation window.

В P2 нужно расширить `Job` до канонического persistence для доменной/API-проекции `AutomationExecution`, а также добавить `ChatLegacySession`, Flow CAS, atomic idempotency store, durable audit/outbox и Job ownership cutover.

### 4.10 P3 Board shell — изменить gates

Сильные стороны: отдельный feature scope, per-user viewport, lazy/offscreen rendering, BoardNote отдельно от Flow.

Недочёты:

- «метрики удержаны в проде» невозможно до rollout; заменить representative staging;
- не задан deep-link/back/forward/not-found/forbidden contract;
- нет flush на `pagehide`/`visibilitychange`/pointer-up;
- нет semantic zoom;
- нет keyboard move/resize и focus return;
- generic placement integrity не определена.

### 4.11 P4 durable chat — изменить модель

P4 правильно отказывается от process-local истины, но `live-turn with DB check session ID` недостаточно. Нужны:

- immutable `chat_id`;
- `ChatTurn` или эквивалент с ordinal/status/idempotency;
- durable `ChatRun/StreamRun` и stable event IDs;
- restart/reconnect/cancel state machine;
- rename только title;
- legacy session migration saga;
- retention/privacy/cost policy.

### 4.12 P5 Automation/editor — сохранить после P0-B

Необходимо явно создать `FlowEditorInstance` boundary: per-instance store/history/provider/hotkeys/events/IDs/autosave. Fullscreen return context должен переживать reload/new tab. «Flag off — байт editor не изменён» заменить behavioral/API/serialized graph parity: isolation refactor неизбежно меняет исходники.

### 4.13 P6 Command Gateway — сохранить направление, усилить transaction contract

Обязательные добавления:

- versioned discriminated-union IR;
- actor только из authenticated context;
- server-generated canonical proposal hash;
- confirmation token хранится в виде hash/nonce, связан с actor/resource/revision/risk и expiry;
- apply atomically consumes token, checks idempotency and CAS, writes version/execution/audit/outbox;
- rollback — новая compensating revision;
- bypass inventory охватывает Assistant UI, headless runner, MCP, REST PATCH, version activation и filesystem save.

### 4.14 P7 execution/results — перенести фундамент раньше

State machine, idempotency, executed revision и durable result нужны до UI Board Run. P7 должна быть адаптером над готовым execution foundation, а не местом, где он впервые создаётся.

Добавить:

- доменную/API-проекцию `AutomationExecution` над расширенным `Job`;
- immutable input/flow snapshot hash;
- cancellation requested/acknowledged;
- terminal-state immutability;
- replay cursor/event envelope;
- result renderer registry + sanitization/sandbox;
- retention и provenance.

### 4.15 P8 projects/navigation/search — частично распараллелить

Project persistence mapping фиксируется уже в P1, потому что Board зависит от Project/Folder. Backend расширение `/projects` и search API может идти параллельно Board/Chat.

Search должен:

- фильтровать права до ranking/pagination;
- не раскрывать title/snippet/count запрещённых объектов;
- иметь PostgreSQL FTS/trigram и определённый SQLite fallback либо ADR;
- поддерживать incremental reindex/delete;
- учитывать ru/en tokenization;
- возвращать type-discriminated result со stable cursor.

### 4.16 P9 hardening — оставить как независимую проверку

Security, compatibility, observability и performance не должны впервые появляться в P9. Они являются cross-cutting gates каждой волны. P9 должен проводить adversarial audit, soak/chaos, backup/restore и финальную compatibility verification.

### 4.17 P10 rollout — разделить rollout и contract removal

Правильная схема:

1. Release N: expand schema + legacy-compatible code.
2. Release N+1: resumable backfill + dual-write/read.
3. Observation window: метрики и parity.
4. Progressive UI/API rollout.
5. Release N+2 или позднее: отдельный approved contract removal.

После начала новых writes rollback означает старое приложение на forward-compatible schema, а не DB downgrade. Security fixes не выключаются до fail-open состояния.

### 4.18 PS schedules — оставить отложенным

Celery в текущем виде не является готовым substrate:

- caller awaits sync `revoke_task`;
- `.delay` нужен для объектов, но call sites передают обычные async functions;
- pickle разрешён;
- beat/scheduler отсутствует;
- worker stub неполон.

Schedule допустим только после execution/idempotency/risk-policy foundations. Внешний scheduler может быть инфраструктурным адаптером, если Ketos остаётся system of record и единственным business API.

### 4.19 §6 legacy Job — повысить приоритет и запретить уязвимый rollback

Пункт подтверждён и должен стать W0 security gate. Неоднозначные NULL rows нельзя произвольно присваивать: их нужно quarantine/fail-closed. Feature flag допустим только как краткоживущий default-on cutover switch; возврат к публичному NULL-owner доступу запрещён.

Дополнительно исправить `Job.created_at` → `created_timestamp` и расширить actor matrix на GET/STOP/result/API key/admin policy.

### 4.20 §7 security matrix — перенести в P1

Матрица полезна, но её строка Authz неточна: action vocabulary и часть route guards уже существуют, тогда как полный endpoint coverage остаётся частичным и неизмеренным. Матрица должна показывать каждый route/action/resource с конкретным guard и заполняться до реализации фич. P9 только проверяет отсутствие пробелов.

### 4.21 §8 caveats — дополнить

- Desktop должен получить явный status: supported/excluded/blocked.
- OpenSwarm worktree уже не clean; зафиксированный commit остаётся валидным snapshot, но dirty state нужно отметить.
- message branching из OpenSwarm либо получает эксперимент/data contract, либо явно исключается из V1.
- «RLM недоступен» следует сопровождать точной попыткой/ошибкой в tool evidence; нельзя превращать отсутствие инструмента в архитектурный факт.

### 4.22 §9 quality gates — сделать исполнимыми

Недостатки:

- `make lint` фактически не является достаточным repo gate;
- root не содержит закреплённый docs Prettier contract;
- Playwright по умолчанию активирует только Chromium;
- coverage threshold не enforced;
- LFX tests не входят в root default suite;
- SLO и dataset denominators не определены.

Каждый phase plan должен фиксировать точные commands, fixture IDs, hardware/browser/DB profile, artifact paths и PASS/BLOCKED/FAIL semantics.

### 4.23 §11 handoff — изменить порядок

Нельзя запускать «весь P0 на одной disposable-ветке». Сначала baseline/security containment, затем параллельные эксперименты, затем contract freeze. Fail-closed Job fix не должен ждать P2 и не должен быть optional feature.

## 5. Аудит R-01–R-40

Все 40 ID присутствуют в 09 ровно по одному разу, а disposition в целом совпадает с 04. Колонку `Статус` следует назвать `Disposition`; отдельно вести execution state (`NOT_STARTED`, `IN_PROGRESS`, `PASS`, `BLOCKED`, `FAIL`).

| R | Оценка привязки 09 | Обязательная коррекция |
| --- | --- | --- |
| R-01 | Частично верно | X-A + Board phase; apply saved viewport через `setViewport`, semantic zoom и restore metrics |
| R-02 | Верно | Добавить URL/commit/license/provenance artifact |
| R-03 | Верно по направлению | Решение только после A/B/C baseline; notice зависит от фактического копирования |
| R-04 | Верно | UX reference, но Ketos transport/state; не копировать OpenSwarm backend |
| R-05 | Неполно | 1/5/10/20 streams, durable ChatRun, replay cursor и cross-tab/restart |
| R-06 | Неверная фаза | Chat lifecycle — Board+Chat phase, не Automation P5 |
| R-07 | Неполно | Immutable chat_id, ChatLegacySession mapping, model snapshot без secrets |
| R-08 | Верно | API должен различать remove placement и delete entity |
| R-09 | Верно | Sidebar recents/search/archive после durable ChatThread |
| R-10 | Верно как эксперимент | Добавить model/cost/latency eval и adversarial corpus |
| R-11 | Верно | 0–5 вопросов; сервер валидирует missing fields, UI не доверяется |
| R-12 | Верно | Flow.revision CAS, typed graph operations, no raw JSON patch from LLM |
| R-13 | Верно по цели | Existing review UI — только seed; proposal должен быть durable/server-generated |
| R-14 | Неполно | Token bound to actor/proposal hash/resource/base revision/risk/expiry; stored hashed |
| R-15 | Ошибка модели | CAS на Flow; FlowVersion хранит provenance; rollback создаёт новую revision |
| R-16 | Верно | Placement → Flow; no Board coordinates in Flow.data |
| R-17 | Верно как эксперимент | Один editable — V1 guard; per-instance store/provider/hotkeys обязателен |
| R-18 | Верно | Golden parity open/save/build/run и manual editing |
| R-19 | Верно | Fullscreen return context + fallback/forbidden/reload contract |
| R-20 | Перенести фундамент раньше | Atomic idempotency/execution snapshot до Board UI |
| R-21 | Неполно | Persisted state machine, cancellation race, event envelope, unknown только projection |
| R-22 | Неполно | Расширенный Job как AutomationExecution projection + Result registry/sanitization/retention |
| R-23 | Верно | BoardNote отдельно; reuse only presentation primitives |
| R-24 | Верно как эксперимент | Relation references placements; endpoint types; no execution semantics |
| R-25 | Верно | Regression: relation mutation не меняет Flow graph hash |
| R-26 | Верно | Project/Folder → many Boards; workspace scope обязателен |
| R-27 | Верно | Durable per-user viewport; focus/selection не хранить в той же noisy row |
| R-28 | Неверная фаза | Project adapter уже есть; contracts/data раньше, UI позже |
| R-29 | Верно | IA после route/domain contracts; добавить focus/keyboard/deep links |
| R-30 | Неполно | Permission-before-ranking, stable cursor, RU/EN indexing, zero metadata leak |
| R-31 | Верно отложено | Schedule только после execution/risk/idempotency; Celery не предрешён |
| R-32 | Верно | Automation list — projection existing Flow API; full editor остаётся каноническим |
| R-33 | Верно | Один avatar trigger; route/header ownership audit |
| R-34 | Верно | Telemetry + redirects + replacement gates; никакого bulk deletion |
| R-35 | Неполная фаза | Cross-cutting Board/Chat/Editor/IA; semantic zoom и accessible focus |
| R-36 | Неполная фаза | Restore покрывает Project/Board/placements/chat/editor; не только P4 |
| R-37 | Неполная фаза | Data + Command + Execution + final audit; durable ledger отдельно от authz diagnostics |
| R-38 | Неполная фаза | Contracts/security foundation + каждый API + final adversarial audit |
| R-39 | Неполная фаза | Risk/confirmation начинается в Command phase, capability/egress до execution |
| R-40 | Слишком поздно | Continuous compatibility lane во всех волнах + final release gate |

## 6. OpenSwarm и продуктовые референсы

### 6.1 Подтверждённые факты

- checkout: `/Volumes/Projects/OpenSwarm`;
- commit: `ab982afcea63dbc775f8a40b74a1b1339a28097f`;
- root license: MIT;
- live-webview budget применяется только к BrowserCard;
- WebSocket queue содержит `client_msg_id`, но outbound frame его не передаёт;
- sequence store process-local, поэтому restart epoch defect реален;
- vendored `backend/mcp-bundles/*` не содержат найденных LICENSE/NOTICE;
- OpenSwarm worktree содержит untracked Graphify artifacts.

### 6.2 Решение о повторном использовании

| Элемент | Решение |
| --- | --- |
| Canvas math, RAF batching, minimap, debounce+flush | Использовать как design/algorithm reference; перенос кода только после provenance review |
| Window/card visual grammar | Адаптировать к Ketos tokens и a11y contract |
| Chat layout/model menus | Использовать как UX reference, состояние и transport строить в Ketos |
| Redux/JSON persistence | Не переносить |
| Electron/CastLabs/webview | Не переносить в web MVP |
| Agent/WS backend | Не переносить |
| Restart/replay protocol | Использовать как отрицательный пример, не реализацию |

### 6.3 Выводы из приложенных скриншотов

Сильны пространственная иерархия, отдельные окна, minimap и локальные controls. Но видны риски, которые план 09 почти не формализует:

- глобальные dock/composer/zoom и локальные card controls конкурируют за focus/z-order;
- при zoom 32–111% нельзя просто масштабировать весь интерактивный DOM — нужен semantic zoom;
- окна могут оказаться обрезанными/потерянными за viewport;
- нужен `Find lost window`/`Fit selection`, keyboard move/resize и детерминированный focus return;
- model/thinking menus должны быть per-chat и иметь screen-reader/focus semantics;
- browser-like card остаётся референсом, не требованием web MVP.

## 7. Исправленная целевая позиция

Рекомендуемая V1-архитектура:

- `Project` — domain/API поверх существующего `Folder`;
- `Board` — workspace/project-scoped aggregate;
- `BoardViewport` — durable per-user camera;
- `BoardUserState` — active board/fullscreen/open context; selection/focus локальны;
- `Placement` — отдельная сущность с typed target FK и per-placement revision;
- `BoardRelation` — связи между placements, никогда не Flow edges;
- `ChatThread` + `ChatLegacySession` + durable `ChatTurn`/`ChatRun`;
- `Flow.revision` — concurrency token;
- расширенный `Job` как `AutomationExecution` projection + `ExecutionResult` — immutable provenance и results;
- `CommandProposal` + `CommandExecution` + `CommandOutbox` — stateful command boundary;
- один active embedded editor как V1 guard;
- optimistic concurrency, но не realtime CRDT/coediting в V1;
- MCP — allowlisted adapter поверх Command Gateway;
- schedules — отдельная поздняя capability.

## 8. Приоритет исправлений

### P0 — до feature implementation

1. Fail-close legacy NULL-owner Jobs.
2. Закрыть/изолировать опасные REPL, SSRF raw paths и secret leakage до расширения surface area.
3. Заморозить current evidence и выпустить errata/decision register.
4. Зафиксировать baseline test/compat/migration truth.
5. Выполнить обязательный X-core: независимые X-A…X-E, затем интеграционный X-G; X-F запускать отдельно только как optional gate для PS.

### P1 — contract freeze

1. Flow CAS и execution contracts.
2. Entity/placement and workspace boundaries.
3. Chat identity/migration/recovery.
4. Command IR/confirmation/idempotency/audit.
5. RBAC/egress/secret/rate/retention matrix.
6. Feature flags, observability и desktop support decision.

### P2+ — implementation waves

Выполнять по DAG документа 11: foundation → параллельные Board/Chat/Command/compat lanes → editor/execution/AI/IA → integration/hardening → staged rollout → поздний contract removal.

## 9. Условия, при которых мастер-план можно считать принятым

Переработанный план готов к исполнению, если:

- все блокирующие решения имеют owner, вход, выход и ADR;
- CAS указан на `Flow`, а не `FlowVersion`;
- Project не дублирует существующий `/projects`/Folder слой;
- execution и command state machines определены до Board Run;
- security/compat/observability являются cross-cutting gates;
- migration rollback не обещает невозможный downgrade;
- у каждой волны есть точные файлы, API, migration, tests, artifacts и rollback;
- зависимости отражают реальную параллельность;
- работа распределяется между изолированными субагентами с exclusive owners общих файлов;
- R-01–R-40 имеют одновременно disposition, owner phase и execution state;
- FAIL/BLOCKED на обязательном gate останавливает все зависимые задачи.

После закрытия собственных phase-gates и независимой проверки этим условиям должен соответствовать [`11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md`](11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md). Сам документ является исполняемым контрактом, но не доказательством готовности реализации.
