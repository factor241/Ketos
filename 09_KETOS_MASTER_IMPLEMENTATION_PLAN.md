# Ketos: мастер-план реализации пространственной рабочей среды

> **Для агентных исполнителей:** это **программный** план 10 фаз (P0–P10 + PS). Он задаёт границы, порядок, риски и измеримые гейты. Он НЕ разворачивается здесь в bite-sized TDD-шаги: каждая фаза при старте получает собственный исполняемый план в `docs/superpowers/plans/YYYY-MM-DD-<phase>.md`, написанный через `superpowers:writing-plans` и выполняемый через `superpowers:subagent-driven-development` или `superpowers:executing-plans`. Шаги-гейты помечены чекбоксами (`- [ ]`) для трекинга на уровне фаз.

**Дата:** 2026-07-17
**Основание:** требования [01](01_KETOS_REQUIREMENTS.md), аудит [02](02_KETOS_CURRENT_ARCHITECTURE_AUDIT.md), OpenSwarm [03](03_OPENSWARM_REUSE_ASSESSMENT.md), критический отчёт [04](04_KETOS_CRITICAL_ARCHITECTURE_REPORT.md), исходный план [05](05_KETOS_IMPLEMENTATION_PLAN.md), независимая проверка [KETOS_CODEX_AUDIT_VERIFICATION_CLAUDE.md](KETOS_CODEX_AUDIT_VERIFICATION_CLAUDE.md) (E-00…E-16, §12), повторный аудит [08](08_KETOS_AUDIT_CRITIQUE_ASSESSMENT.md).
**Baseline кода:** `redesign/sidebar-account` @ `572fad8…`; `src/**` на текущем HEAD `8087826…` не менялся.
**Статус документа:** план. Реализация не выполнялась. Настоящий файл **консолидирует и заменяет** план [05](05_KETOS_IMPLEMENTATION_PLAN.md) с учётом всех подтверждённых замечаний; исходные документы 01–08 не изменяются.

**Цель:** превратить Ketos из редактора одного Flow в единую пространственную рабочую среду (доски, окна-чаты, автоматизации, результаты, заметки, проекты) с безопасным AI-управлением через единый backend — без потери совместимости Langflow/KFX/LFX и без второго backend.

**Архитектура:** новый продуктовый слой оркеструет существующую исполнительную платформу Ketos, а не заменяет её. Внешняя пространственная доска и внутренний исполнительный граф Flow — разные координатные и семантические пространства. Все мутации проходят через типизированный Command Gateway с preview/confirmation/audit/idempotency/rollback; MCP — ограниченный адаптер поверх него, не ядро.

**Технологии:** Python/FastAPI + SQLModel/Alembic (SQLite + PostgreSQL); React/TypeScript (React Query + Zustand); KFX/LFX SDK и executor; собственный DOM/CSS-compositor **или** outer XYFlow (решается в P0).

---

## 0. Глобальные инварианты (зафиксированы; выдержали обе проверки — не пересматриваются)

Требования каждой задачи неявно включают этот раздел.

- **INV-1 — единый backend (AC-03).** Канвас, чаты, автоматизации и AI-команды используют единый backend Ketos. Второй backend/runtime запрещён.
- **INV-2 — Board ≠ Flow Editor (AC-06).** Внешняя доска (pan/zoom, placements, смысловые связи) и внутренний XYFlow-граф Flow — разные пространства. Координаты доски никогда не хранятся в `Flow.data`; смысловая связь никогда не интерпретируется как исполнительное ребро Flow.
- **INV-3 — сущность ≠ размещение (AC-07).** `ChatThread`, `Automation`(=`Flow`), `BoardNote`, `ExecutionResult` независимы от своих `Placement`. Удаление размещения ≠ удаление сущности; это разные команды с разными правами.
- **INV-4 — один активный editable Flow Editor.** Остальные автоматизации на доске монтируются как read-only/compact preview. Несколько одновременно editable редакторов допускаются только после успешного P0-B.
- **INV-5 — Command Gateway до MCP.** Единая мутационная граница внутри backend. REST/Assistant/MCP — адаптеры. Немедленное headless-применение мутаций к production запрещено.
- **INV-6 — AI не имеет произвольного доступа (AC-08/AC-09).** Только типизированные разрешённые команды; каждая изменяющая команда проходит authn, authz, валидацию, оценку риска, аудит, обработку ошибок; рискованные — preview + одноразовое подтверждение (AC-10).
- **INV-7 — совместимость и миграции (AC-04/AC-05/AC-11).** Имена классов KFX — сохранённые идентификаторы, не переименовываются. Все миграции additive: expand → backfill/dual-read → validate → contract, проверяются на SQLite и PostgreSQL. `session_id` и legacy-маршруты не удаляются до отдельного contract-релиза.
- **INV-8 — ru/en parity (AC-02, NFR-06).** Никаких новых hardcoded system-owned English-строк; plural/interpolation parity ru/en.
- **INV-9 — откат (NFR-10).** Каждая фаза за feature flag; выключение флага возвращает legacy-поведение без потери новых данных.

---

## 1. Как читать этот план: прослеживаемость замечаний → фазы

Каждое подтверждённое замечание проверки имеет адрес в этом плане. Таблица гарантирует, что «на основе всех замечаний» выполнено буквально.

| Замечание (источник) | Суть                                                                                                                                            | Куда вшито                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| E-00 (§12.5)         | silent lost update при активации версии без CAS                                                                                                 | P0-I (прототип), P2 (revision/CAS), R-15                |
| E-01                 | вымышленное `FlowVersion.active`                                                                                                                | Precondition C0 (правка доков), модель версий в P2/R-15 |
| E-02                 | 5 несуществующих frontend-путей (6 ссылок)                                                                                                      | C0                                                      |
| E-03                 | 10 из 16 неверных каталогов OpenSwarm                                                                                                           | C0                                                      |
| E-04                 | неверный диапазон read-only preview                                                                                                             | C0                                                      |
| E-05                 | преувеличение про возврат API-ключей                                                                                                            | C0, security workstream §7                              |
| E-06                 | `DashboardViewCard` ≠ вложенная доска                                                                                                           | C0, P0-A ограничение                                    |
| E-07                 | Tauri: только контракты, не дистрибутив                                                                                                         | C0, §8 desktop-оговорка                                 |
| E-08                 | Graphify-blocker не подтверждён                                                                                                                 | C0 (пересмотр статуса 07)                               |
| E-10                 | существует `src/compat/lfx` (LFX corpus частично)                                                                                               | §3 «переиспользовать», P9/R-40                          |
| E-11                 | неполный каталог моделей                                                                                                                        | §3, P2                                                  |
| E-12 (§12.5)         | rename не синхронизирует Memory Base/Chroma                                                                                                     | P0-J (прототип), P2/P4 backfill-контракт, R-07/R-36     |
| E-13                 | спящая `authz_edit_lock`                                                                                                                        | P0-I, P2 (сравнить lease vs CAS)                        |
| E-14                 | authz-audit/rate-limit/SSRF/REPL — фундамент, не готовность                                                                                     | §7 coverage matrix, P9                                  |
| E-15                 | legacy playground `/playground/:id`, persisted viewport, `cmdk`, review-gate, durable assistant                                                 | R-34/R-01/R-29/R-13/R-36 в фазах                        |
| E-16                 | OpenSwarm: branching/cloud/notices; WS не зрелый (restart-epoch, `client_msg_id` не шлётся); webview budget только BrowserCard; README vs cloud | §3, P0-C/P4 (stream-epoch), §8                          |
| §12.2                | legacy Job `user_id IS NULL` → unauthorized stop                                                                                                | **Немедленный fix (§6)**, P2/P9, R-38                   |
| §12.5-Celery         | async/sync revoke mismatch, нет beat                                                                                                            | P0-K (viability), R-31/PS                               |

---

## 2. Precondition C0 — обязательные исправления исходных документов (до кода)

Дешёвый, но обязательный вход: пока доки 01–07 содержат ошибки, спецификация ненадёжна. C0 не трогает код; правит только доки 01–07 по §10+§12 отчёта проверки.

- [ ] **C0.1** Удалить `FlowVersion.active` из 02 §6/§8 и 04 R-15; описать активацию как restore-by-copy + auto-snapshot; добавить отсутствие CAS/base_revision (E-01, E-00).
- [ ] **C0.2** Исправить 5 frontend-путей Ketos (E-02) и 10 каталогов OpenSwarm с знаменателем 16 (E-03).
- [ ] **C0.3** Исправить диапазон read-only (E-04); переклассифицировать `DashboardViewCard` как embedded-поверхность (E-06).
- [ ] **C0.4** Сузить формулировку об API-ключах (E-05); переформулировать Tauri как контракты, а не дистрибутив (E-07); снять Graphify как основание BLOCKED (E-08).
- [ ] **C0.5** Добавить в 02 §3/§6 деревья `src/compat/*`, `src/sdk`, `src/ketos-stepflow` и модели transactions/vertex_builds/traces/deployment*/memory_base/knowledge_base/ingestion_run, workspace_id-колонки, `authz_edit_lock` (E-10/E-11/E-13).
- [ ] **C0.6** Отразить активный `/playground/:id` (R-34), persisted-но-неприменяемый viewport (R-01/R-27), существующий review-gate `ProposeFieldEdit`/`ProposePlan`, вероятный durable-след ассистента в MessageTable (E-15).
- [ ] **C0.7** OpenSwarm: добавить branching/cloud/vendored-notices; пометить WS как незрелый (restart-epoch + `client_msg_id` не шлётся); ограничить webview-budget до BrowserCard; зафиксировать README-vs-cloud расхождение; `trafilatura==2.0.0` = Apache-2.0 (E-16).
- [ ] **Гейт C0:** все ссылки на пути валидны (`git ls-files`/`ls`), каждый R-01…R-40 имеет верную доказательную базу, `prettier --check` на доках проходит.

---

## 3. Целевая модель данных и что переиспользовать (не строить с нуля)

Ключевой урок проверки: **инвентаризация существующих активов до проектирования** — иначе P1–P2 дублируют то, что уже есть.

### 3.1 Новые сущности (additive)

| Сущность           | Ключевые поля/ограничения                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `Board`            | project_id, title, revision, archived, owner, timestamps                                            |
| `BoardViewport`    | (board_id,user_id) unique, x/y/zoom, active/focused placement, revision                             |
| `Placement`        | board_id, object_type/object_id (полиморфно, проверка сервисом), x/y/w/h/z, display_state, revision |
| `ChatThread`       | immutable id, title, model config (versioned), context policy, owner/project, archived, revision    |
| `Message.chat_id`  | новый nullable FK; legacy flow/session — compat-поля на время миграции                              |
| `BoardNote`        | content/version/format, независимо от Flow.data                                                     |
| `BoardRelation`    | typed source/target refs; никогда не исполняемо                                                     |
| `ExecutionResult`  | execution_id, type/schema, storage_ref/redacted payload, provenance, status                         |
| `CommandProposal`  | actor/scope/type/version, base_revision, diff, risk, expires_at, status                             |
| `CommandExecution` | idempotency_key, confirmation use, before/after revision, outcome/audit/outbox                      |

### 3.2 Переиспользовать (подтверждённые активы — адаптировать, не создавать заново)

| Актив                                   | Путь/факт                                                                                                   | Как использовать                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Folder` → `Project`                    | `folder/model.py:22-30` (есть `parent_id`)                                                                  | адаптер, additive поля pin/archive/order; без destructive rename                        |
| `FlowVersion`                           | `flow_version/model.py:12-36` (нет `active`; restore-by-copy)                                               | добавить `base_revision`/CAS (E-00); учесть `FlowVersionDeploymentAttachment` и pruning |
| `authz_edit_lock`                       | `auth/authz.py:252-267` (спящая)                                                                            | P0-I: сравнить lease поверх неё vs revision/CAS                                         |
| `AuthzAuditLog` + pipeline              | `authorization/audit.py`, retention `services/utils.py:490`, read-API `api/v1/authz_audit.py`               | фундамент R-37; расширить до command/execution-ledger (это authz-лог, не командный)     |
| `transactions`/`vertex_builds`/`traces` | `models/transactions`, `vertex_builds`, `traces`                                                            | частичный execution-provenance для R-20/R-22                                            |
| `memory_base`/`MemoryBaseSession`       | `memory_base/model.py`                                                                                      | образец durable session-персистентности; **consumer `session_id`** (см. E-12)           |
| review-gate                             | `ProposeFieldEdit`/`ProposePlan`/`_propose_existing_edits` (`kfx/mcp/flow_builder_tools`)                   | seed для durable proposal R-13                                                          |
| security primitives                     | rate-limit `services/rate_limit`, SSRF `ssrf_protection.py` (on-by-default), REPL `python_repl_security.py` | вход в §7; расширить покрытие, не изобретать                                            |
| LFX compat                              | `src/compat/lfx` (пакет `lfx==1.10.2`, тесты `9 passed`)                                                    | R-40: расширить corpus, не создавать с нуля                                             |

### 3.3 НЕ переносить из OpenSwarm

Electron shell, JSON-persistence, Redux slices, MUI subsystem, Agent/WebSocket backend, BrowserCard `<webview>`. Переносить только паттерны (RAF-батчинг, viewport-math, minimap, debounce+flush, bring-to-front no-op) с MIT-notice. WS-resume — брать идеи контракта, но добавить stream-epoch (реализация OpenSwarm имеет restart-epoch defect и не шлёт `client_msg_id`).

---

## 4. Реестр рисков и P0-прототипы (то, что кодовый аудит доказать не может)

P0 принимает решения, которые нельзя доказать чтением кода. Прототипы одноразовые, без production-миграций.

**Исходные (из 05, подтверждены S-14):**

- **P0-A** Canvas A/B: custom DOM compositor (паттерны OpenSwarm) vs outer XYFlow на 100/500/1000 placements. Ограничение: `DashboardViewCard` — embedded HTML-приложение, не вложенная доска (E-06); webview-budget OpenSwarm покрывает только BrowserCard (E-16) — общей виртуализации у референса нет.
- **P0-B** Nested editor: изоляция `PageComponent`/stores/DOM-id/hotkeys/wheel/pinch/drag; один active editor + два preview. Гейт: 0 gesture-leakage на 100 сценариях.
- **P0-C** Multi-chat: 10 per-window контроллеров; cancel/reconnect/order. **Дополнено:** reconnect-протокол обязан нести stream-epoch/server-instance-id и сбрасывать high-water при снижении serverseq (урок OpenSwarm restart-epoch, E-16), плюс фактический idempotency/dedup key (не как `client_msg_id`, который не отправляется).
- **P0-D** Board persistence: revisioned patches, debounce/flush, stale-tab, backend restart.
- **P0-E** Entity/placement: close placement vs delete entity на двух досках.
- **P0-F** AI workflow: typed generate/edit proposal, server diff, stale revision, confirm-once, rollback (поверх `ProposeFieldEdit` review-gate).
- **P0-G** Control plane: CommandGateway-only vs MCP-adapter; threat model, transaction trace.
- **P0-H** Restore/scale: reload/restart с 100/500/1000 объектами, 10 chats, 3 preview, 1 editor.

**Новые обязательные прототипы (из проверки):**

- **P0-I — FlowVersion CAS / lost update (E-00, E-13).** Две конкурентные транзакции: `activate_version` × ручной `PATCH /flows/{id}` (перезапись `Flow.data`). Показать, что без base_revision побеждает последняя запись молча (`IntegrityError` не срабатывает). Сравнить revision/CAS vs lease поверх `authz_edit_lock` vs гибрид. **Гейт:** stale base → 409/no-mutation; выбранный механизм задокументирован ADR.
- **P0-J — session rename × Memory Base/Chroma (E-12).** Воспроизвести: `update_session_id` (`monitor.py:349-386`) меняет `MessageTable`, но не вызывает `_purge_memory_base_session_data` (вызывается только на delete `:411,485`) → memory-base tracking и Chroma остаются на старом id. **Гейт:** миграционный контракт `session_id`→`chat_id`, покрывающий Memory Base и внешнее хранилище; 0 ghost-embeddings в тесте rename→ingest→query.
- **P0-K — Celery viability или отказ (R-31, §12.5).** Зафиксированы дефекты: `TaskService.revoke_task` делает `await backend.revoke_task`, а `CeleryBackend.revoke_task` синхронный (`celery.py:49`); `launch_task` требует `.delay`; beat/cron отсутствуют. **Гейт:** либо рабочий scheduler-substrate с исправленным async/sync-контрактом и beat, либо обоснованный отказ от Celery как основы R-31 (внешний scheduler-адаптер).

**Exit P0:** ADR по canvas, editor-lifecycle, chat-controller (+stream-epoch), persistence, CommandGateway/MCP, FlowVersion-CAS, session-migration, scheduler. R-01/R-05/R-10/R-17/R-36 переходят из гипотезы в выбранный дизайн. Метрики: viewport ≤1px/0.01; 0 gesture-leakage/100; 10 streams 0 cross-events; confirm-replay ≤1 apply; 500-object p95 ≤16.7ms на объявленном профиле; stale-base 409; rename→0 ghost-embeddings.

---

## 5. Фазы P1–P10 + PS (порядок, границы, вшитые задачи, гейты)

Критический путь (S-14, подтверждён): P0 → P1 → P2 → {P3, P4} → P5 → P6 → P7 → P8 → P9 → P10. P4 параллелен P3 после P2. PS (расписания) вне первого критического пути.

### P1 — доменные контракты

**Цель:** формально закрепить границы Board/Placement/Chat/Flow/Execution/Command.
**Задачи:** OpenAPI/event-схемы; state-machines; RBAC actions (включая новые Board/Chat/place/run/share); risk-классы (`allow`/`review`/`confirm_each_time`/`deny`); i18n-ключи; Project-over-Folder адаптер; audit/redaction/retention; SLO/поддерживаемые браузеры/concurrency.
**Вшито:** реестр ресурсов должен включать legacy-Job policy (см. §6); envelope стрима с `request_id/sequence/stream_epoch` (P0-C).
**Гейт P1:** каждый R → owner/API/data/test; 0 неразрешённых identity/title/entity-placement неоднозначностей; security-review подписывает контракт команды.

### P2 — данные, сервисы, additive API

**Цель:** backward-compatible persistence без UI-cutover.
**Задачи:** SQLModel-модели/сервисы Board/Viewport/Placement/ChatThread/BoardNote/Relation/Result/Proposal/Execution; `Message.chat_id` nullable; Project-адаптер; CommandGateway-скелет; индексы/outbox.
**Вшито:**

- **FlowVersion `base_revision`/CAS** по выбору P0-I (E-00);
- backfill-контракт `session_id`, покрывающий Memory Base/Chroma (P0-J, E-12) — never silent merge, quarantine/report неоднозначных;
- **fix legacy Job NULL-owner** (§6) как отдельная миграция + policy.
  **Миграции:** A: создать таблицы/nullable-колонки/индексы. Backfill A: группировать legacy messages по owner+flow+session с явным отчётом о неоднозначности. Dual write/read; без удаления `session_id`/legacy-маршрутов.
  **Гейт P2:** старые API/тесты проходят; новые контракты проходят; checksum 100%; duplicate idempotency → один эффект; stale revision → 409; SQLite+PostgreSQL матрица; без destructive-миграций.

### P3 — Board shell, placements, восстановление

**Цель:** первая usable-доска без embedded full editor.
**Задачи:** Board route/store/query; CardFrame; pan/zoom/minimap (по выбору P0-A); create/open/archive; generic placements; move/resize/z/close; BoardNote; per-user viewport; lazy/offscreen rendering; feature flag. Scope: новый `features/boards`.
**Вшито:** viewport — новый per-user/Board (E-15: существующий per-Flow `Flow.data.viewport` персистится, но не применяется; не переиспользовать как Board-состояние).
**Гейт P3:** метрики P0 удержаны в проде; нет потерянных ack-placement; reload-точность; axe critical/serious 0; legacy-flows не затронуты (flag off/on).

### P4 — durable multi-chat (параллельно P3 после P2)

**Цель:** независимые ChatThread/окна без process-local истины.
**Задачи:** выбрать одну каноничную playground-презентацию; per-chat контроллер; `Message.chat_id`; durable Assistant context; model/context на ChatThread; rename/delete/archive; unify stream-envelope + cancellation; WebSocket оставить только для voice.
**Вшито:**

- **assistant context recovery** (R-36, E-15): process-local buffer (`conversation_buffer.py` 10/100) не переживает restart — durable transcript в MessageTable сам по себе контекст не восстанавливает; нужен live-turn с DB-проверкой session id и отсутствия дублей input/output;
- rename использует backfill-контракт P0-J (Memory Base/Chroma consistency);
- reconnect с stream-epoch (P0-C).
  **Гейт P4:** 0 cross-events; контекст после restart = prompt-контекст; replay детерминирован; legacy KFX ChatInput/Output corpus проходит.

### P5 — Automation windows и editor isolation

**Цель:** Automation placements, запуск/fullscreen, безопасный embedded editor.
**Задачи:** AutomationCard/preview/status; один Flow на нескольких досках; каноничный fullscreen FlowPage + возврат Board-контекста; один active embedded editor (если P0-B прошёл); scope IDs/hotkeys/store; lazy previews; ручной путь без изменений.
**Гейт P5:** 0 outer/inner gesture-leakage; мутирует только активный Flow; Board-состояние переживает поход в editor; flag off — байт/контракт текущего editor не изменён.

### P6 — Command Gateway и безопасные AI-изменения

**Цель:** единая мутационная граница для Assistant/REST/restricted MCP.
**Задачи:** typed command registry; graph planner/validator/diff; clarify-state; preview/risk; confirmation tokens (one-time, expiring, bound to proposal/revision/actor); apply-once транзакция; FlowVersion provenance/rollback; audit/outbox; удалить немедленный production-apply (INV-5).
**Вшито:** rollback создаёт новую аудируемую ревизию, не стирает историю; **FlowVersion CAS из P2** обязателен на apply-пути (E-00); MCP-адаптер allowlisted, `mcp_enabled` проверяется на execute (сейчас не проверяется — S-01).
**Гейт P6:** в code-search/contract-test нет mutating Assistant/MCP bypass; ≥90% curated corpus schema-valid/buildable (или порог явно пересмотрен); каждый исход аудируем; confirmed revision hash точен; replay ≤1.

### P7 — execution, results, relations, risk-controls

**Цель:** запуск Automation с доски + status/result/provenance; смысловые связи.
**Задачи:** execution-adapter над build/run/Job; каноничная state-machine/reconnect; ResultCard/type-registry; placement результата; BoardRelation renderer/API; component capability manifests, egress/sandbox по развёртыванию.
**Вшито:**

- **R-21 корректно:** фактический `JobStatus` = queued/in_progress/completed/failed/cancelled/timed_out — нет `waiting_confirmation`/`unknown`; internal `event_id` не доставляется клиенту → добавить в envelope для replay;
- run-эндпоинты получают idempotency key (сейчас `job_id=uuid4()` на каждый вызов — C-13);
- **legacy Job ownership** закрыт (§6) до включения board-run.
  **Гейт P7:** executed revision записан; disconnect → recovered terminal или явный `unknown`; unsafe corpus denied/confirmed; результаты переживают reload; BoardRelation не меняет Flow hash.

### P8 — проекты, навигация, поиск, интеграция

**Цель:** цельная IA; убрать дублирование только при наличии replacement.
**Задачи:** Project-дерево над Folder; archive/pin; целевой sidebar; Chat/Automation списки; federated search phase 1 (переиспользовать `cmdk`-примитив, E-15); один avatar-меню; deprecation-инвентарь.
**Вшито:** **R-34** — legacy `/playground/:id` активен публично; удаление требует telemetry/redirects/regression-gates, не bulk-delete по виду (E-15).
**Гейт P8:** все авторизованные объекты достижимы; forbidden search fixture = 0; 5-уровневое дерево проектов; без нового hardcoded English; каждый удалённый элемент имеет replacement/rollback.

### P9 — безопасность, масштаб, совместимость (hardening)

**Цель:** доказать production-readiness до cutover. **Инвентаризация ≠ готовность** (E-14).
**Обязательный первый артефакт — coverage matrix** (§7). Далее: granular RBAC/revocation; audit durability/redaction; rate/size limits на **всех** AI/MCP/run-путях (сейчас — преимущественно login); sandbox/egress; multi-worker stream/replay; DB-планы; load/soak; chaos/recovery; browser-matrix; KFX/LFX/API/extension corpus (расширить существующий `src/compat`, E-10); backup/restore.
**Гейт P9:** 0 P0/P1 security-дефектов; SLO пройдены; compatibility corpus 100%; rollback-репетиция; остаточные риски подписаны.

### P10 — миграция и staged rollout

**Цель:** включить продукт без потери legacy-данных.
**Задачи:** canary; прогрессивные флаги; backfill-волны; dual-read метрики; checksum; freeze-критерии; contract-removal — отдельный релиз после окна совместимости.
**Гейт P10:** error/SLO/data-mismatch ниже порогов на окне наблюдения; 100% backfill с разрешённым ledger неоднозначностей; rollback-drill актуален.

### PS — запланированные процессы (отложено, после P7 + отдельное подтверждение)

Требует Schedule model/engine. **Целиком зависит от P0-K:** Celery в текущем виде не substrate (async/sync revoke mismatch, нет beat, disabled-by-default — §12.5). Либо исправленный Celery+beat, либо внешний scheduler-адаптер. Гейт: DST/timezone-матрица; повтор доставки → один эффективный запуск; dangerous scheduled run по approved capability policy.

---

## 6. Немедленный fix вне очереди фаз — legacy Job NULL-owner (§12.2)

Не прототип, а дефект безопасности, найденный проверкой. Может и должен быть закрыт в P2 (или раньше отдельным PR за флагом), не дожидаясь board-фич.

**Дефект:** `services/jobs/service.py:55,80,245` добавляют `| Job.user_id.is_(None)` в выборки, `_validate_ownership:337` пропускает проверку при NULL-владельце. Путь эксплуатации: `POST /api/v2/workflow/stop` → `stop_workflow` (`workflow.py:762`, гейт только `api_key_security`) → `get_job_by_job_id(job_id, user_id)` возвращает чужой legacy-job → `revoke_task` → unauthorized stop.
**Severity:** средний–высокий (целостность/доступность; условность — знание UUIDv4 и наличие legacy-строк).

- [ ] **6.1** Backfill/миграция: присвоить владельца legacy-jobs либо запретить `user_id IS NULL` (INV-7: expand→backfill→validate→contract).
- [ ] **6.2** Убрать fail-open OR из `get_job_by_job_id`/`get_jobs_by_flow_id`/`cancel_in_flight_jobs_by_asset` после backfill; `_validate_ownership` — fail-closed.
- [ ] **6.3** Регресс-тест: пользователь A не может прочитать/остановить Job пользователя B и legacy-Job с NULL-владельцем.
- [ ] **Гейт 6:** actor×job-matrix тест зелёный; измерено число legacy NULL-строк в целевом развёртывании (severity финализируется по факту).

---

## 7. Security workstream — coverage matrix (обязательный вход P9)

Существующие механизмы (`AuthzAuditLog`, rate-limit, SSRF, REPL-hardening) — фундамент, **не** готовность (E-14). P9 начинается с заполнения матрицы; сокращать объём P9 их наличием запрещено.

| Механизм             | Покрытые endpoints/компоненты | Непокрытые                                                | Fail-open/closed       | Аудируется                                     |
| -------------------- | ----------------------------- | --------------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| Authz (`enforce`)    | —                             | Board/Chat-действий нет; OSS pass-through → True          | fail-open по умолчанию | зависит от `AUTHZ_AUDIT_ENABLED` (default off) |
| Rate limit           | login                         | AI/MCP/run — не подтверждено                              | —                      | —                                              |
| SSRF                 | ssrf_requests/httpx           | не каждый raw-client                                      | on-by-default          | —                                              |
| REPL hardening       | python_repl_security          | не sandbox                                                | —                      | —                                              |
| Secret handling      | list-пути маскируют           | GENERIC vars/v2 MCP/Flow.data при `remove_api_keys=False` | —                      | —                                              |
| Command confirmation | нет общей                     | execute/publish/delete/external                           | —                      | —                                              |
| Job ownership        | owned jobs                    | legacy NULL-owner (§6)                                    | fail-open (до fix)     | —                                              |

Ни один механизм не заменяет typed Command Gateway + preview + confirmation + idempotency + rollback. Заполнение и закрытие «непокрытых» — часть exit-гейта P9.

---

## 8. Оговорки, зафиксированные проверкой (учитывать в фазах, не терять)

- **Desktop/Tauri (E-07):** код содержит compatibility-контракты Ketos Desktop/Tauri (`customization/constants.ts:1-2`, regression-тесты), но **не** доказывает актуальный дистрибутив/версию/pipeline. Не ломать эти контракты при UI-изменениях; состояние внешнего билда — вне репозитория.
- **OpenSwarm как референс (E-16):** брать паттерны и отрицательные уроки. WS-resume незрелый (restart-epoch, `client_msg_id` не шлётся) — переносить идеи контракта + stream-epoch, не реализацию. Webview-budget `MAX_LIVE_WEBVIEWS=8` только для BrowserCard — общей виртуализации нет. README заявляет локальность, код содержит cloud/billing/diagnostics — до использования как продуктового референса разделить локальный runtime, опциональные cloud-сервисы и обязательные outbound-соединения. `trafilatura==2.0.0` = Apache-2.0 (не copyleft-блокер); vendored mcp-bundles без notices и castlabs/Widevine — в SBOM.
- **Graphify/RLM (E-08):** Graphify не блокирует работу по коду (`src/**` не менялся). RLM/Aleph в текущем окружении недоступен — выводы получены альтернативной проверкой. Сессионные метрики (счётчики субагентов, разовые прогоны) помечать как session evidence и сохранять логи.

---

## 9. Общие quality gates (из 05 §3, подтверждены S-14 — применяются к каждой фазе)

| Gate          | Условие                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Compatibility | зафиксированный legacy Flow corpus открывается/сохраняется/build/run; 0 непредусмотренных graph/hash/API-изменений |
| Unit          | изменённые domain/services ≥90% branch coverage (порог утверждён в P1)                                             |
| API           | OpenAPI diff review; actor/resource/action negative-тесты; idempotency и 409-тесты                                 |
| Migration     | upgrade/downgrade и прерванный backfill на SQLite/PostgreSQL; row counts/checksums                                 |
| E2E           | Chromium + второй engine (определён P1); ru/en; keyboard; reload/restart; concurrent chat; nested editor           |
| Visual/a11y   | approved screenshots на фиксированных viewport/theme/locale; axe critical/serious = 0                              |
| Performance   | опубликованный hardware/data-профиль; p50/p95/p99, FPS/long-tasks/heap, DB-план; без «быстро» без чисел            |
| Security      | permission-matrix, confirmation-replay, SSRF/egress/custom-code corpus, audit redaction, revocation, §6/§7         |
| Rollback      | flag off → legacy UI; downgrade/forward-recovery отрепетированы; без потери новых данных                           |

---

## 10. Требования R-01–R-40 → фаза / статус / корректная база

Статусы из 04 (сверены S-13 — полны и согласованы). «База» отражает поправки проверки.

| R    | Фаза       | Статус      | Корректная база (поправка)                                                          |
| ---- | ---------- | ----------- | ----------------------------------------------------------------------------------- |
| R-01 | P0-A,P3    | эксперимент | per-Flow viewport персистится, но не применяется; per-user/Board — новый            |
| R-02 | P0         | сохранить   | OpenSwarm клонирован `ab982af`; референс паттернов                                  |
| R-03 | P0-A       | изменить    | переносить math/RAF/minimap после A/B; не Electron/Redux                            |
| R-04 | P4         | изменить    | Ketos ChatWindow по UX; не WS-backend OpenSwarm                                     |
| R-05 | P0-C,P4    | эксперимент | per-window controller; stream-epoch reconnect                                       |
| R-06 | P3,P5      | разделить   | move/resize/z → collapse/maximize/fullscreen                                        |
| R-07 | P2,P4      | изменить    | `chat_id`; rename-контракт покрывает Memory Base/Chroma (E-12)                      |
| R-08 | P3         | сохранить   | placement ≠ entity                                                                  |
| R-09 | P4,P8      | разделить   | sidebar recents → search/archive                                                    |
| R-10 | P0-F,P6    | эксперимент | typed proposal поверх review-gate                                                   |
| R-11 | P6         | изменить    | 0–5 вопросов по validated missing fields                                            |
| R-12 | P6         | разделить   | base_revision + server graph validation                                             |
| R-13 | P6         | сохранить   | durable proposal (seed — `ProposeFieldEdit`)                                        |
| R-14 | P6         | сохранить   | one-time confirmation token                                                         |
| R-15 | P0-I,P2,P6 | изменить    | restore-by-copy, нет `active`, добавить CAS (E-00), deployment attachments, pruning |
| R-16 | P5         | сохранить   | Placement → Flow id, без координат в Flow.data                                      |
| R-17 | P0-B,P5    | эксперимент | один active editor + preview                                                        |
| R-18 | P5         | сохранить   | ручной путь без изменений                                                           |
| R-19 | P5         | сохранить   | FlowPage — каноничный fullscreen                                                    |
| R-20 | P7         | сохранить   | idempotency key на run (сейчас нет); legacy-Job fix (§6)                            |
| R-21 | P7         | сохранить   | JobStatus без waiting_confirmation/unknown; event_id не доставляется — добавить     |
| R-22 | P7         | разделить   | ExecutionResult; частичный provenance в transactions/vertex_builds/traces           |
| R-23 | P3         | изменить    | BoardNote отдельно от NoteNode                                                      |
| R-24 | P0,P7      | эксперимент | BoardRelation + отдельный слой                                                      |
| R-25 | P7         | сохранить   | связь ≠ ребро Flow                                                                  |
| R-26 | P3         | сохранить   | Project → many Boards                                                               |
| R-27 | P3         | сохранить   | per-user viewport (E-15)                                                            |
| R-28 | P8         | разделить   | Project-адаптер над Folder; cycle-validation (сейчас нет)                           |
| R-29 | P8         | изменить    | IA после domain-routes; `cmdk` уже есть                                             |
| R-30 | P8         | разделить   | federated search; permission-first                                                  |
| R-31 | PS         | отложить    | Celery не substrate (P0-K); beat/контракт отсутствуют                               |
| R-32 | P8         | разделить   | rename/projection Flow-списка                                                       |
| R-33 | P8         | сохранить   | один avatar-триггер; дубли выводимы из `header-visibility.ts`                       |
| R-34 | P8         | разделить   | legacy `/playground/:id` активен публично (E-15)                                    |
| R-35 | P3,P8      | сохранить   | Ketos tokens/CardFrame; ru/en                                                       |
| R-36 | P4         | эксперимент | durable MessageTable/MemoryBase есть; assistant context recovery отсутствует        |
| R-37 | P6         | изменить    | AuthzAuditLog — фундамент, но authz-лог, не command/execution ledger                |
| R-38 | P2,P6,P9   | разделить   | новые Board/Chat actions; legacy-Job fix (§6); coverage matrix                      |
| R-39 | P7,P9      | изменить    | capability manifest + risk policy; SSRF on-by-default учесть                        |
| R-40 | P9         | сохранить   | compat corpus частично существует (`src/compat/lfx`, `9 passed`) — расширить        |

---

## 11. Немедленные действия и хендофф

1. Выполнить **C0** (правки доков 01–07) — дешёвый разблокирующий вход; без него спецификация ненадёжна.
2. Закрыть **§6** (legacy Job NULL-owner) отдельным PR за флагом — не ждать board-фич.
3. Запустить **P0** (все прототипы, включая новые I/J/K) на disposable-ветке; принять ADR.
4. Для каждой стартующей фазы — авторинг исполняемого bite-sized плана в `docs/superpowers/plans/YYYY-MM-DD-p<n>-<name>.md` через `superpowers:writing-plans`, выполнение через `superpowers:subagent-driven-development` или `superpowers:executing-plans`.
5. После каждой фазы — сверка по §9 (quality gates) и по матрице §10; при FAIL/BLOCKED зависимые фазы остановлены.

**Что план не меняет (подтверждено обеими проверками):** единый backend; Board≠Flow; ChatThread≠Placement; Automation≠окно; один active editor + previews; typed Command Gateway; preview/confirmation/audit/idempotency/rollback; MCP как адаптер; additive-миграции; отказ от переноса OpenSwarm backend/Electron/Redux/JSON; prototype-first порядок; статусы большинства R-01–R-40.

---

_Консолидирует 01–08 + отчёт проверки (E-00…E-16, §12). Все подтверждённые замечания прослежены в §1. Реализация не начиналась; каждая фаза за feature flag с отрепетированным откатом. Исходные документы 01–08 и `src/**` не изменялись настоящим планом._
