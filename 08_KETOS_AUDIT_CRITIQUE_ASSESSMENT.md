# Повторная проверка критики предпроектного аудита Ketos

**Дата:** 2026-07-17

**Проверяемый документ:** `KETOS_CODEX_AUDIT_VERIFICATION_CLAUDE.md`

**Текущая ветка Ketos:** `redesign/sidebar-account`

**Текущий HEAD Ketos:** `80878261d07c21ad257de017d98069f211ada2c2`

**Baseline исходного аудита:** `572fad8ea2223e342508ecf095133091c7714e1b`

**OpenSwarm:** `/Volumes/Projects/OpenSwarm`, `main @ ab982afcea63dbc775f8a40b74a1b1339a28097f`

**Режим:** повторный read-only аудит исходного кода; исходные семь документов и код проекта не изменялись.

---

## 1. Итоговый вывод

Критика в `KETOS_CODEX_AUDIT_VERIFICATION_CLAUDE.md` **высоко полезна и в основном технически обоснована**. Она правильно выявляет:

- вымышленное поле `FlowVersion.active`;
- несколько никогда не существовавших frontend-путей;
- систематически неверные каталоги компонентов OpenSwarm;
- ошибочную интерпретацию `DashboardViewCard`;
- неполный инвентарь моделей, compat-пакетов, SDK и security-механизмов;
- наличие `memory_base` и неиспользуемой `AuthzEditLock`;
- слишком широкую формулировку исходного аудита о возврате API-ключей;
- неполное описание persisted viewport, публичного legacy playground и review-механизмов ассистента.

Главный вывод критики — **«исходный аудит пригоден после обязательных исправлений»** — подтверждён.

Однако критика не должна приниматься буквально без собственной правки. В ней:

- неверно посчитаны ошибочные OpenSwarm-пути: **10 из 16**, а не 10 из 15;
- не доказано существование актуального внешнего Tauri-дистрибутива, доказаны только репозиторные compatibility-контракты Ketos Desktop;
- отсутствие запрета в текущем Graphify skill не доказывает, что такого ограничения не было в исходной сессии;
- текущая карта Graphify уже не является точным снимком всего HEAD, несмотря на сохранённый `built_at_commit`;
- существующие audit/rate-limit/SSRF/REPL-механизмы не делают security-этап почти готовым;
- durable-запись сообщений ассистента не равна восстановлению его model context после перезапуска;
- WebSocket resume OpenSwarm нельзя называть зрелым и готовым к переносу;
- `trafilatura==2.0.0` имеет лицензию Apache-2.0, поэтому её старая copyleft-история не является текущим лицензионным блокером;
- Celery в Ketos нельзя считать готовым фундаментом планировщика: обнаружены несовместимые async/sync и task-dispatch контракты.

### Исправленный общий вердикт

| Объект                           | Вердикт                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Исходные семь документов аудита  | Архитектурно полезны, но пока ненадёжны как строгая доказательная база                                      |
| Критика Claude                   | В основном верна и обязательна к учёту, но сама требует нескольких технических оговорок                     |
| Центральная архитектура Ketos    | Подтверждена повторным аудитом                                                                              |
| Graphify-блокер исходного аудита | Больше не является действующим блокером, но историческая причина исходного решения не опровергнута          |
| RLM/Aleph                        | В текущем окружении недоступен; выводы получены альтернативной проверкой                                    |
| OpenSwarm                        | Использовать как источник паттернов и отрицательных уроков, не переносить как подсистему или второй backend |
| Готовность начать реализацию     | Нет: сначала необходимо исправить аудит и выполнить рискованные прототипы                                   |

---

## 2. Что было перепроверено

### 2.1 Состояние репозитория

Между baseline `572fad8...` и текущим HEAD `8087826...` нет изменений в `src/**`. Следовательно, критика исходного кода, сделанная относительно baseline, не устарела.

После baseline изменялись документы, настройки и инструменты workspace, поэтому утверждения о текущем состоянии Graphify, RaytSystem и служебных файлов нельзя автоматически переносить с 2026-07-16 на текущий HEAD.

### 2.2 Применённые инструменты

- Git: ветка, commit, status, история ошибочных путей, diff `src/**`.
- Graphify 0.9.16:
  - `graphify path FlowPage useFlowStore`;
  - запросы `FlowVersion`, `AuthzEditLock`, `MemoryBaseSession`;
  - проверка `graph.json`, `manifest.json`, `cost.json`.
- RaytSystem:
  - `doctor`;
  - `status`;
  - `graph status`;
  - `lint`.
- `rg`, `jq`, `find`, построчное чтение файлов.
- `uv run pytest` для compat/LFX.
- независимые субагенты:
  - frontend, Flow Editor, навигация и состояние;
  - backend, модели, API, безопасность и выполнение;
  - OpenSwarm, WebSocket, persistence и лицензирование.
- внешняя проверка метаданных лицензий OpenSwarm-зависимостей.

### 2.3 Состояние Graphify

Текущий `graphify-out/graph.json` сообщает:

- `built_at_commit = 572fad8...`;
- 65 618 nodes;
- 131 157 links;
- 22 hyperedges.

`cost.json` подтверждает инкрементальное обновление 168 файлов 2026-07-16. Но `manifest.json` уже содержит файлы, добавленные после baseline, включая документы RaytSystem и `01_KETOS_REQUIREMENTS.md`.

Следовательно:

1. Graphify фактически применим для навигации по коду.
2. Код `src/**` не менялся, поэтому найденные связи по исходникам актуальны.
3. Поле `built_at_commit` не доказывает, что весь corpus является точным снимком указанного commit.
4. Текущая карта представляет смешанный корпус: исходный код baseline плюс более поздние документы и tooling-файлы.
5. Утверждение критики «карта точно на HEAD, rebuild был бы no-op» сейчас неверно.

RaytSystem отдельно сообщает собственный code graph как `stale` с причиной `checkout_changed`, при этом `raytsystem lint` проходит без замечаний.

### 2.4 RLM/Aleph

Команды `alef` и `rlm` в текущем окружении отсутствуют. Поэтому сессионные утверждения исходного аудита о RLM нельзя воспроизвести.

Альтернатива:

- Graphify для структурной ориентации;
- прямое чтение исходников;
- `rg` для поиска consumers и отрицательных доказательств;
- Git для проверки истории;
- RaytSystem для дополнительной проверки состояния workspace;
- независимые субагентные проверки.

Это снижает уверенность именно в воспроизводимости старого RLM-журнала, но не препятствует проверке рассмотренных кодовых утверждений.

---

## 3. Матрица оценки E-01–E-16

| ID   | Вердикт по критике                         | Существенность для исходного аудита    | Итог повторной проверки                                                                    |
| ---- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| E-01 | Подтверждено                               | Средняя/высокая для R-15               | `FlowVersion.active` не существует; activation делает restore-by-copy                      |
| E-02 | Подтверждено и усилено                     | Средняя                                | Найдено не менее шести неверных Ketos-путей, а не пяти                                     |
| E-03 | Подтверждено с исправлением                | Средняя                                | Неверны 10 из 16 frontend-записей OpenSwarm                                                |
| E-04 | Подтверждено                               | Низкая                                 | Диапазон read-only был неверен; механизм существует в других строках                       |
| E-05 | Подтверждено с оговорками                  | Средняя для security wording           | Management list маскирует ключи; реальные secret paths находятся в Variables/MCP/Flow data |
| E-06 | Подтверждено                               | Средняя                                | `DashboardViewCard` — embedded Output, не nested board                                     |
| E-07 | Частично подтверждено                      | Средняя                                | Tauri shell отсутствует, compatibility-контракты Ketos Desktop существуют                  |
| E-08 | Частично подтверждено                      | Высокая для статуса 07                 | Текущий Graphify-блокер снят; исторический запрет невозможно подтвердить или опровергнуть  |
| E-09 | Подтверждено                               | Редакционная                           | Все основные перечисленные неточности воспроизводятся                                      |
| E-10 | Подтверждено                               | Высокая для R-40                       | Compat/LFX/SDK corpus реально существует и работает                                        |
| E-11 | Подтверждено                               | Средняя/высокая                        | Каталог моделей исходного аудита неполон                                                   |
| E-12 | Подтверждено                               | Средняя/высокая                        | `memory_base` — реальная durable session-инфраструктура                                    |
| E-13 | Подтверждено                               | Средняя                                | `AuthzEditLock` существует как схема, но не участвует в production-потоках                 |
| E-14 | Подтверждено с существенными ограничениями | Средняя                                | Механизмы существуют, но их coverage уже, чем предполагает критика                         |
| E-15 | В основном подтверждено                    | Низкая–высокая в зависимости от пункта | Несколько активов пропущены; часть требует runtime-проверки                                |
| E-16 | Смешанный результат                        | Средняя                                | Branching/cloud/notices подтверждены; зрелость WS и часть license-аргументов переоценены   |

---

## 4. Подробная проверка существенных пунктов

### 4.1 E-01 — `FlowVersion.active`

**Критика верна полностью.**

Факты:

- `src/backend/base/ketos/services/database/models/flow_version/model.py:12-36` не содержит `active`.
- Модель содержит `id`, `flow_id`, `user_id`, `data`, `version_number`, `description`, `created_at`.
- `src/backend/base/ketos/api/v1/flow_version.py:227-292`:
  - при необходимости создаёт auto-snapshot текущего `Flow.data`;
  - копирует `target_entry.data` в `Flow.data`;
  - не переключает active pointer.
- `is_deployed` — вычисляемое состояние через deployment attachments, а не признак активной версии.

Исправление исходного аудита обязательно. R-15 должен описывать:

- immutable snapshot;
- restore-by-copy;
- auto-snapshot перед восстановлением;
- deployment attachments;
- отсутствие CAS/base revision;
- риск silent lost update при конкурентном редактировании.

`IntegrityError` в endpoint не является полноценной защитой от lost update: обычное конкурентное обновление `Flow.data` может не нарушить constraint.

### 4.2 E-02 — неверные frontend-пути

**Критика верна, но недосчитала один дефект.**

Подтверждённые замены:

| Ошибочный путь                                                      | Фактический путь                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `components/core/sidebar/components/sideBarFolderButtons/index.tsx` | `components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx`                 |
| `i18n/languages.ts`                                                 | `constants/languages.ts`                                                                           |
| `i18n/i18n.ts`                                                      | `i18n.ts`                                                                                          |
| `pages/FlowPage/components/flow-page-sliding-container.tsx`         | `components/core/playgroundComponent/sliding-container/components/flow-page-sliding-container.tsx` |
| `stores/buildUtils.ts`                                              | `utils/buildUtils.ts`                                                                              |

Дополнительно `02_KETOS_CURRENT_ARCHITECTURE_AUDIT.md` ссылается на несуществующий общий каталог:

- `src/frontend/src/components/core/sidebar`;

фактический основной sidebar находится в:

- `src/frontend/src/components/core/folderSidebarComponent`.

Git-история не показывает существование ошибочных путей. Это не архитектурная ошибка, но системный дефект доказательности.

### 4.3 E-03 — карта каталогов OpenSwarm

**Суть критики верна, подсчёт неверен.**

В таблице исходного `03_OPENSWARM_REUSE_ASSESSMENT.md` 16 frontend-записей. Из них:

- 6 имеют правильный путь;
- 10 имеют неверный каталог.

Правильные группы:

- interaction hooks: `frontend/src/app/pages/Dashboard/hooks/interaction/`;
- state hook: `frontend/src/app/pages/Dashboard/hooks/state/`;
- controls: `frontend/src/app/pages/Dashboard/controls/`;
- Redux state: `frontend/src/shared/state/`.

Правильная формулировка: **«10 из 16 frontend-путей указаны с неверными каталогами»**.

### 4.4 E-04 — read-only Flow Editor

**Критика верна.**

- `PageComponent/index.tsx:166` вычисляет `isCanvasReadOnly`.
- Реальный гейтинг React Flow находится примерно в `:953-1018`.
- `ViewPage/index.tsx:59-67` передаёт view-mode.
- `/flow/:id/view` зарегистрирован в `routes.tsx:187-193`.
- Старый диапазон `:184-206` относится к баннеру agent-working.

Архитектурный вывод сохраняется: read-only preview есть, но это не доказательство безопасного одновременного монтирования нескольких editable Flow Editor.

### 4.5 E-05 — API keys и секреты

**Критика корректно сужает исходную формулировку.**

Подтверждено:

- `ApiKeyRead.mask_api_key` маскирует management-read;
- полный API key возвращается при создании;
- `VariableService.get_all()` возвращает расшифрованные GENERIC values;
- v2 MCP check/tool-discovery собирает расшифрованные variables, включая CREDENTIAL;
- `remove_api_keys=False` остаётся дефолтным поведением для части flow serialization.

Не следует писать, что все management paths возвращают API key в открытом виде.

Но критика тоже требует точности:

- доказана передача secrets в MCP check/discovery path;
- не доказано, что каждый execution path передаёт все CREDENTIAL внешнему серверу;
- P9/security workstream остаётся обязательным.

### 4.6 E-06 — `DashboardViewCard`

**Критика верна полностью.**

`DashboardViewCard`:

- разрешает `Output`;
- передаёт его в `ViewPreview`;
- отображает пользовательское HTML/JS-приложение через webview/iframe;
- не содержит child dashboard ID;
- не реализует nested-board relation;
- не реализует recursion policy.

Правильная классификация: референс тяжёлой embedded-поверхности, а не вложенной доски.

### 4.7 E-07 — Tauri/Ketos Desktop

**Критика полезна, но её категоричность избыточна.**

Подтверждено:

- Tauri shell, `src-tauri`, Cargo manifest и desktop packaging в текущем репозитории отсутствуют;
- `src/frontend/src/customization/constants.ts` содержит явный Ketos Desktop compatibility comment;
- frontend regression test описывает Tauri-origin bug;
- backend test фиксирует desktop flow-preparation contract;
- telemetry имеет desktop platform switch;
- Git-история содержит Desktop/Tauri fixes.

Не подтверждено только по этому репозиторию:

- существует ли сейчас распространяемый desktop build;
- какая версия Tauri используется;
- какая версия compatibility contract поддерживается;
- как устроены signing, auto-update и release pipeline.

Исправленная формулировка:

> В этом репозитории Tauri-оболочка отсутствует, но код содержит явные compatibility-контракты и regression-тесты для Ketos Desktop/Tauri. Desktop compatibility необходимо учитывать; текущее состояние внешнего дистрибутива требует отдельной проверки.

### 4.8 E-08 — Graphify blocker

**Критика верно снимает текущий blocker, но не доказывает ложность исторического отчёта.**

Факты текущей сессии:

- Graphify установлен и работает;
- `path` и `query` выполняются;
- инкрементальное обновление действительно было выполнено;
- текущий skill документирует update/rebuild;
- исходный код не изменился после baseline.

Ограничения критики:

- точный текст skill во время исходной сессии невоспроизводим;
- текущая карта содержит более поздние документы при старом `built_at_commit`;
- поэтому её нельзя называть точным снимком всего текущего HEAD;
- текущий `AGENTS.md` отдельно запрещает перестраивать Graphify как побочный эффект RaytSystem-работ.

Итог:

- Graphify больше не блокирует повторную проверку кода;
- исходный статус `BLOCKED` нельзя продолжать обосновывать только Graphify;
- нельзя утверждать, что исходный агент заведомо выдумал ограничение;
- RLM и broad/runtime проверки по-прежнему остаются незакрытыми.

### 4.9 E-10 — compat, LFX и SDK

**Критика верна и существенно улучшает картину R-40.**

Найдены:

- `src/compat/lfx`;
- `src/compat/langflow`;
- `src/compat/langflow-base`;
- `src/compat/langflow-sdk`;
- `src/compat/langflow-stepflow`;
- `src/sdk`;
- `src/ketos-stepflow`.

`src/compat/lfx` реализует:

- пакет `lfx==1.10.2`;
- aliases на KFX;
- CLI compatibility;
- frozen module inventory;
- canonical module aliases;
- compat tests.

Повторный прогон:

```text
uv run pytest -q tests/test_lfx_compatibility.py
9 passed
```

Правильный блокер R-40:

> Существующий compat corpus необходимо расширить serialized-flow, component-identifier и production-like runtime fixtures.

Неправильно:

> LFX compatibility corpus отсутствует и должен быть создан с нуля.

### 4.10 E-11/E-12 — модели и durable memory

**Критика верна.**

Исходный аудит не дал полного инвентаря:

- `TransactionTable`;
- `VertexBuildTable`;
- `TraceTable`/`SpanTable`;
- `Deployment`;
- `DeploymentProviderAccount`;
- `FlowVersionDeploymentAttachment`;
- knowledge-base и ingestion models;
- file/variable models;
- workspace-scoped columns;
- `MemoryBase`;
- `MemoryBaseSession`;
- `MemoryBaseWorkflowRun`;
- `MessageIngestionRecord`;
- `MemoryBasePreprocessingOutput`.

Практическое влияние:

- execution provenance не начинается с нуля;
- deployment/version relation уже формализована;
- `session_id` уже имеет несколько durable consumers;
- rename/delete ChatThread нельзя проектировать только вокруг `MessageTable`;
- backfill и migration должны учитывать Memory Base и внешнее vector storage.

Дополнительная обнаруженная проблема:

- rename session обновляет `MessageTable`;
- memory-base tracking и Chroma state могут остаться со старым `session_id`;
- delete path имеет отдельную purge-логику;
- возможны ghost embeddings и рассинхронизация ingestion.

### 4.11 E-13 — `AuthzEditLock`

**Критика верна, но схема не является готовой concurrency capability.**

`AuthzEditLock` содержит:

- unique `flow_id`;
- `holder_user_id`;
- `acquired_at`;
- `expires_at`.

Найдены:

- модель;
- миграция;
- persistence unit test.

Не найдены production consumers:

- acquire;
- renew;
- check;
- release;
- expired-lock sweeper;
- API/service integration.

Рекомендация:

1. Не проектировать concurrency без инвентаризации этой таблицы.
2. Не считать её готовым решением.
3. В прототипе сравнить:
   - полноценный lease lifecycle поверх `AuthzEditLock`;
   - revision/CAS;
   - гибрид CAS + presence/lease.

### 4.12 E-14 — существующие security-механизмы

**Инвентарь критики в основном верен, оценка готовности требует снижения.**

Существуют:

- `AuthzAuditLog`;
- bounded background writer;
- retention cleanup;
- superuser read API;
- rate-limit service;
- SSRF helpers;
- REPL hardening;
- MCP ownership/path traversal fixes.

Но:

- Authz audit по умолчанию выключен;
- при переполнении очереди записи теряются;
- журналирует authorization decisions, а не все application commands и execution effects;
- rate limiting фактически подключён к login, а не ко всем AI/MCP/run endpoints;
- SSRF защита не гарантирует покрытие каждого raw HTTP client;
- REPL hardening прямо не является sandbox;
- security controls не заменяют typed Command Gateway, preview, confirmation, idempotency и rollback.

Поэтому P9 нельзя считать почти готовым. Его следует начинать с coverage matrix:

| Механизм             | Какие endpoints/components покрыты | Какие не покрыты | Fail-open/fail-closed | Аудит |
| -------------------- | ---------------------------------- | ---------------- | --------------------- | ----- |
| Authz                |                                    |                  |                       |       |
| Rate limit           |                                    |                  |                       |       |
| SSRF                 |                                    |                  |                       |       |
| REPL                 |                                    |                  |                       |       |
| Secret handling      |                                    |                  |                       |       |
| Command confirmation |                                    |                  |                       |       |

### 4.13 E-15 — прочие пропуски

#### Публичный legacy playground

Подтверждено:

- `/playground/:id` — активный route;
- `Playground` рендерит `CustomIOModal`;
- wrapper использует legacy `IOModal`.

Это меняет порядок R-34: удаление требует telemetry, redirects, compatibility и regression gates.

#### Viewport

Подтверждено:

- viewport сохраняется в `Flow.data`;
- при загрузке nodes/edges применяются;
- затем выполняется `fitView`;
- сохранённый viewport явно не восстанавливается;
- Board-level/per-user viewport отсутствует.

Критика уменьшает объём R-01/R-27, но не отменяет требования.

#### `cmdk`

Подтверждено:

- dependency и reusable command primitives существуют;
- используются локальными selectors.

Не существует:

- глобальный cross-domain index;
- единый search API;
- ranking;
- permission-aware global command palette.

#### Proposal/review

Подтверждено:

- `ProposeFieldEdit`;
- `ProposePlan`;
- `_propose_existing_edits`;
- условный review gate;
- preview events.

Не существует в общем виде:

- durable proposal table;
- immutable diff;
- apply-once token;
- stale-base check;
- единый confirmation transaction;
- rollback command.

#### Durable assistant messages

Статический путь записи подтверждён:

- ChatInput/ChatOutput могут сохранять сообщения;
- `KetosAssistant.json` включает storage;
- `astore_message` пишет в `MessageTable`.

Но:

- agentic assistant формирует контекст из process-local conversation buffer;
- durable transcript не гарантирует восстановление контекста после restart;
- нужен live turn с DB-проверкой session IDs и отсутствия дублей input/output.

#### Build/runtime

Подтверждены:

- heartbeat;
- watchdog/disconnect handling;
- cross-worker cancellation foundation;
- internal event ID;
- v2 background branch;
- stream path с 501.

Новая поправка к критике:

- internal event ID не доставляется клиенту, поэтому replay/resume gap сохраняется;
- v2 background не следует считать полноценно durable;
- Celery backend не готов к роли scheduler substrate.

### 4.14 E-16 — OpenSwarm

#### Что критика правильно добавляет

- message branching и branch navigation;
- sequence/high-water/replay/gap/heartbeat mechanics;
- cloud/service/billing/publishing paths;
- `openswarm-edge`;
- vendored MCP bundles;
- BrowserCard webview suspension budget.

#### Что критика переоценивает

**WebSocket нельзя называть зрелым и готовым к переносу.**

Обнаружен restart-epoch defect:

1. Server sequence хранится process-local и после restart начинается заново.
2. Client сохраняет старый high-water.
3. Server не обрабатывает ситуацию `last_seq > newest`.
4. Client игнорирует снижение server current sequence.
5. Новые события с малыми sequence могут быть пропущены при следующем reconnect.

Также `client_msg_id` объявлен, но не передаётся в фактическом frame, поэтому end-to-end deduplication не реализована.

Правильная рекомендация:

- брать идеи protocol contract;
- добавить stream epoch/server instance ID;
- формализовать replay window;
- при снижении high-water делать reset + REST refresh;
- реализовать фактический idempotency/dedup key;
- не переносить текущую реализацию без исправлений.

**Webview budget ограничен.**

`MAX_LIVE_WEBVIEWS=8` применяется к BrowserCard webviews. Он не доказывает общую виртуализацию DashboardViewCard и всех embedded surfaces.

**Лицензия.**

- root OpenSwarm license — MIT;
- vendored bundles и удаление legal comments создают реальный third-party notices/SBOM риск;
- castlabs/Widevine требует отдельной юридической проверки;
- pinned `trafilatura==2.0.0` имеет Apache-2.0:
  - <https://pypi.org/project/trafilatura/2.0.0/>

Старая GPL-история `trafilatura` полезна для provenance-review, но не является текущим copyleft-блокером версии 2.0.0.

#### Дополнительный существенный вывод

OpenSwarm README заявляет локальность/no telemetry, но pinned code содержит:

- cloud state reconciliation;
- billing;
- installation attribution;
- diagnostics/events;
- publishing;
- metered model proxy.

Перед использованием OpenSwarm как продуктового референса необходимо разделить:

- локальный desktop runtime;
- optional cloud services;
- обязательные outbound connections;
- telemetry/diagnostics;
- billing/publishing paths.

---

## 5. Что в критике действительно меняет исходный аудит

### 5.1 Обязательные изменения

1. Удалить `FlowVersion.active` из всех документов.
2. Описать R-15 как restore-by-copy и добавить CAS/revision risk.
3. Исправить минимум шесть неверных Ketos frontend-путей.
4. Исправить 10 неверных OpenSwarm-каталогов.
5. Переклассифицировать `DashboardViewCard`.
6. Исправить read-only evidence range.
7. Сузить формулировку об API-key management.
8. Добавить compat/LFX/SDK/stepflow деревья.
9. Дополнить data-model inventory.
10. Добавить `memory_base` в ChatThread/session migration analysis.
11. Добавить `AuthzEditLock` как неактивный schema asset.
12. Добавить существующую authz/security инфраструктуру с coverage-ограничениями.
13. Отразить активный публичный legacy playground.
14. Исправить описание viewport persistence.
15. Отразить третий durable message path ассистента.
16. Пересмотреть Graphify blocker.
17. Дополнить OpenSwarm branching/cloud/notices.
18. Не называть OpenSwarm WS зрелым без описания restart-epoch defect.
19. Не считать Celery готовым scheduler foundation.
20. Добавить session rename/memory-base consistency risk.

### 5.2 Что не меняется

Повторный аудит не опроверг:

- требование единого backend Ketos;
- необходимость отделить Board от Flow;
- необходимость отделить ChatThread от Placement;
- необходимость отделить Automation/Flow от её окна;
- решение «один активный editable Flow Editor + previews/lazy mounting»;
- риск нескольких одновременно editable Flow Editor;
- необходимость typed Command Gateway;
- необходимость preview/confirmation/audit/idempotency/rollback;
- вывод, что MCP должен быть адаптером, а не базовой application architecture;
- необходимость additive data migrations;
- отказ от прямого переноса OpenSwarm backend, Electron shell, Redux state и JSON persistence;
- prototype-first последовательность;
- статусы большинства R-01–R-40.

### 5.3 Какие статусы требований требуют уточнения

| Требование | Исправление основания                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| R-01/R-27  | Flow viewport частично сохраняется, но не восстанавливается; Board/per-user state отсутствует |
| R-13/R-14  | Review primitives существуют, но нет durable proposal/confirmation transaction                |
| R-15       | Restore-by-copy, deployment attachments, no active flag, no CAS                               |
| R-21       | Internal event IDs и heartbeat есть, клиентского replay contract нет                          |
| R-31       | Celery package существует, но scheduler/beat и корректный task contract отсутствуют           |
| R-34       | Legacy playground — активная публичная поверхность                                            |
| R-36       | Durable MessageTable/MemoryBase assets есть, assistant context recovery отсутствует           |
| R-37       | Authz audit foundation есть, но это не command/execution ledger                               |
| R-38/R-39  | Security primitives есть, coverage неполный                                                   |
| R-40       | Compat corpus частично существует и проходит focused test                                     |

---

## 6. Что в критике неверно или требует оговорки

### 6.1 Фактические ошибки

1. OpenSwarm: 10 неверных путей из 16, а не из 15.
2. Текущую карту Graphify нельзя доказательно называть точным снимком HEAD только по `built_at_commit`.
3. `trafilatura==2.0.0` — Apache-2.0, не текущая copyleft dependency.

### 6.2 Чрезмерно сильные выводы

1. Репозиторные Tauri-контракты не доказывают текущее состояние внешнего desktop-дистрибутива.
2. Наблюдаемые версии Graphify skill не доказывают содержимое skill в исходной сессии.
3. Наличие rate limiting не означает общую защиту API: прямое применение найдено прежде всего на login.
4. Наличие SSRF utilities не доказывает покрытие всех исходящих HTTP-клиентов.
5. Наличие Authz audit не означает готовый журнал AI-команд и execution effects.
6. Наличие MessageTable persistence не означает durable assistant context.
7. WebSocket OpenSwarm имеет полезные механизмы, но не зрелый replay protocol.
8. Celery является package/backend option, но не готовым scheduler/job substrate.

### 6.3 Непроверяемые сессионные утверждения

По репозиторию невозможно независимо подтвердить:

- фактически выбранные модели Claude;
- число токенов субагентов;
- точное содержание исходного Graphify skill в прошедшей сессии;
- старые RLM/Aleph tool results;
- старые broad test counters без сохранённого machine-readable artifact.

Это не делает технические выводы критики неверными, но такие пункты должны маркироваться как session metadata, а не repository evidence.

---

## 7. Дополнительные риски, не отражённые полностью ни в исходном аудите, ни в критике

### 7.1 FlowVersion lost update

Activation делает атомарный savepoint, но не проверяет base revision. Необходимо отдельно тестировать две конкурентные транзакции.

### 7.2 Legacy Job access

Backend-проверка выявила, что legacy Job с `user_id IS NULL` может быть доступен API-key пользователю по UUID, включая stop path. Требуется отдельный security review и migration policy для legacy jobs.

### 7.3 Session rename inconsistency

Rename обновляет message session, но durable Memory Base/vector state может остаться на старом ID. Это блокирует простую замену `session_id` на `chat_id` без миграционного контракта.

### 7.4 Celery contract defects

Обнаружены:

- передача обычного bound async method туда, где ожидается Celery task с `.delay`;
- `await` для sync revoke;
- отсутствие beat/schedule;
- disabled-by-default configuration.

До отдельного прототипа Celery нельзя использовать как доказательство готовности R-31.

### 7.5 OpenSwarm WebSocket restart epoch

Без stream epoch и reset protocol клиент может удерживать high-water из предыдущей жизни backend-процесса и терять события.

### 7.6 OpenSwarm documentation/privacy mismatch

README и implementation расходятся по cloud/telemetry/billing. Это риск не только лицензии, но и privacy/product due diligence.

---

## 8. Оценка двенадцати обязательных исправлений критики

Все двенадцать пунктов §10 критики указывают на реальную проблему или пропуск. При этом:

- девять можно принять по существу почти без изменения;
- три требуют квалифицированной формулировки:
  - Graphify: снять текущий blocker, но не объявлять историческое утверждение доказанно ложным;
  - Tauri: фиксировать compatibility-контракт, но не утверждать без внешней проверки текущее состояние дистрибутива;
  - security: инвентаризировать существующие механизмы, но не уменьшать P9 до доработки coverage matrix.

Дополнительно к этим двенадцати необходимо:

- исправить знаменатель OpenSwarm paths на 16;
- добавить шестой неверный Ketos frontend path;
- добавить FlowVersion CAS risk;
- добавить session rename/Memory Base risk;
- добавить Celery defects;
- добавить OpenSwarm WS restart-epoch defect;
- уточнить лицензию `trafilatura==2.0.0`;
- добавить README/cloud contradiction OpenSwarm.

---

## 9. Проверки и ограничения

### Выполнено

- подтверждено отсутствие изменений `src/**` после baseline;
- Graphify path/query выполнены;
- Graphify metadata и manifest проверены;
- RaytSystem status/lint проверены;
- все E-01–E-16 повторно сопоставлены с кодом;
- frontend и backend paths перепроверены;
- OpenSwarm commit и конкретные компоненты перепроверены;
- compat/LFX focused suite: 9 passed;
- выводы субагентов сопоставлены и конфликтующие формулировки исправлены.

### Не выполнено

- полный backend test suite;
- frontend full test suite;
- live browser проверка всех route/customization вариантов;
- runtime turn ассистента с DB inspection;
- multi-process/Celery runtime;
- конкурентный FlowVersion activation test;
- production-scale нагрузка;
- юридическое заключение по всем transitive dependencies OpenSwarm;
- проверка внешнего Ketos Desktop репозитория/release pipeline;
- RLM/Aleph, поскольку инструменты отсутствуют.

Поэтому этот документ является доказательным source-level повторным аудитом, но не production-readiness сертификатом.

---

## 10. Финальная рекомендация

1. Принять критику как обязательный вход для исправления исходных семи документов.
2. Не заменять исходный аудит критикой механически.
3. Исправить исходные документы по матрице этого отчёта.
4. После исправления повторно проверить:
   - все file paths;
   - модельный инвентарь;
   - статусы R-01–R-40;
   - blockers P0–P10;
   - Graphify/tool evidence;
   - OpenSwarm reuse matrix;
   - security coverage.
5. До реализации выполнить прототипы:
   - editable nested Flow Editor;
   - multi-chat streaming;
   - Board persistence/restore;
   - ChatThread/Placement split;
   - proposal/confirmation transaction;
   - Flow revision/CAS;
   - session rename/backfill с Memory Base;
   - OpenSwarm-inspired reconnect с stream epoch;
   - Celery/scheduler viability либо отказ от Celery.

**Окончательный вердикт:** критика действительно улучшает аудит и выявляет реальные существенные проблемы. Она не разрушает рекомендуемую архитектуру Ketos, но показывает, что исходные документы нельзя использовать как строгую доказательную спецификацию до исправления путей, модели версий, compat/data/security inventory и инструментальных статусов. Сама критика также нуждается в правках по Graphify, Tauri, OpenSwarm WebSocket, webview scope, Celery и лицензии `trafilatura`.
