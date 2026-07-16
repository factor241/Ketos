# Независимая проверка аудита Codex по проекту Ketos

**Дата проверки:** 2026-07-16
**Проверяющий:** Claude Code — основной агент Fable 5 + пять субагентов Sonnet 5
**Режим:** строго read-only; исходный аудит Codex и код Ketos/OpenSwarm не изменялись; создан только этот файл.

---

## 1. Сведения о проверенном аудите и состоянии репозитория

### 1.1 Проверенные файлы аудита

Семь незакоммиченных файлов в корне репозитория (созданы 2026-07-15 19:59):

| Файл | Содержание |
| --- | --- |
| `01_KETOS_REQUIREMENTS.md` | нормализованные требования R-01–R-40, AC, NFR |
| `02_KETOS_CURRENT_ARCHITECTURE_AUDIT.md` | аудит текущей архитектуры |
| `03_OPENSWARM_REUSE_ASSESSMENT.md` | оценка повторного использования OpenSwarm |
| `04_KETOS_CRITICAL_ARCHITECTURE_REPORT.md` | критический отчёт, статусы всех 40 требований |
| `05_KETOS_IMPLEMENTATION_PLAN.md` | план реализации P0–P10 + PS |
| `06_SUBAGENT_RESEARCH_LOG.md` | журнал 10 исследовательских задач Codex |
| `07_TOOL_USAGE_AND_EVIDENCE.md` | журнал инструментов и ограничений |

### 1.2 Состояние репозиториев

| Параметр | Значение |
| --- | --- |
| Ветка Ketos | `redesign/sidebar-account` |
| HEAD Ketos | `572fad8ea2223e342508ecf095133091c7714e1b` |
| Baseline аудита Codex | `572fad8ea2223e342508ecf095133091c7714e1b` — **совпадает с HEAD** |
| Незакоммиченные изменения | на момент фиксации baseline (начало верификации): только 7 `.md` самого аудита (untracked), tracked-дерево чистое. К моменту завершения верификации параллельная сессия (настройка RaytSystem-workspace) добавила untracked-файлы и изменила 4 tracked-файла вне исходников (`.gitignore`, `AGENTS.md`, `CLAUDE.md`, `scripts/codex-skill-policy.test.mjs`); каталог `src/**` не затронут (`git diff --name-only | grep ^src/` — 0), поэтому все доказательства верификации остаются валидными |
| OpenSwarm | `/Volumes/Projects/OpenSwarm`, `main @ ab982afcea63dbc775f8a40b74a1b1339a28097f` — совпадает с заявленным; origin `https://github.com/openswarm-ai/openswarm.git`; дерево чистое, кроме untracked `graphify-out/` (артефакт нашей стороны) |

**Ключевое следствие:** код не изменился после составления аудита, поэтому категория «устарело» к утверждениям о коде неприменима — каждое расхождение является первоначальной ошибкой Codex. Исключение — утверждения о состоянии инструментов (карта Graphify была актуализирована 2026-07-16, уже после аудита; см. M-01/M-02).

### 1.3 Исходное задание

Прямой текст исходного задания в репозитории отсутствует; в качестве нормативного прокси использована нормализованная спецификация `01_KETOS_REQUIREMENTS.md` (R-01–R-40, AC-01–AC-12, NFR-01–NFR-10) и перечень обязательных направлений проверки из задания на данную верификацию.

---

## 2. Подтверждение использования Fable 5, Sonnet 5 и Graphify

- **Основной агент:** Claude Fable 5 (model id `claude-fable-5`) — координация, фиксация baseline, ~20 личных якорных проверок по исходникам, выборочная перепроверка доказательств каждого субагента, разрешение противоречий, итоговый синтез.
- **Субагенты:** пять, каждый запущен через Agent tool с параметром `model: "sonnet"` (Sonnet 5, `claude-sonnet-5`). Все пять выполнили реальные исследовательские задачи с доказательствами file:line; суммарный объём субагентной работы ≈ 1,0 млн токенов (156 755 + 177 419 + 207 298 + 216 933 + 241 496).
- **Graphify — фактическое применение:**
  - карта `graphify-out/graph.json` проверена: `built_at_commit == 572fad8…` (равен HEAD), 63 467 узлов / 128 069 рёбер; актуализирована инкрементально 2026-07-16 (168 файлов, по `cost.json`). Требование «построй или актуализируй карту» выполнено: карта актуальна ровно на проверяемом commit, повторный rebuild был бы no-op;
  - выполнены команды: `graphify path "FlowPage" "useFlowStore"` (воспроизведён результат Codex: 1 hop, `--calls [EXTRACTED]-->`), `graphify explain "PageComponent"`, `graphify query` по цепочке assistant→backend→execution и по Board/Placement/ChatThread-моделям;
  - карта подтвердила связи frontend↔backend↔Flow Editor↔чаты↔API↔модели↔исполнение, заявленные в аудите (узлы `execute_flow_with_validation_streaming` @ `assistant_service.py:513`, `use-assistant-chat.ts`, `flowStore.ts`, `playground-modal.tsx` и др.);
  - карта подтвердила **отсутствие** Board/Placement/ChatThread в коде: узлы «Board (пространственная доска)» и «Placement (размещение)» приходят в граф только из самих документов аудита, попавших в корпус, а не из исходников.

---

## 3. Распределение задач между субагентами и перепроверка

| Субагент | Модель | Зона | Проверенные утверждения |
| --- | --- | --- | --- |
| V1 | Sonnet 5 | frontend, канвас, интерфейс, навигация, i18n | F-01…F-16 + 5 доп. |
| V2 | Sonnet 5 | backend, API, модели данных, миграции | B-01…B-14 + Д-1…Д-7 |
| V3 | Sonnet 5 | чаты, Flow Editor, KFX/LFX, исполнение | C-01…C-15 + 6 доп. |
| V4 | Sonnet 5 | OpenSwarm, лицензия, перенос, совместимость | O-01…O-16 |
| V5 | Sonnet 5 | MCP, безопасность, RBAC, тесты, план | S-01…S-16 |

Основной агент (Fable 5) до и параллельно с субагентами лично верифицировал ~20 опорных утверждений (в т.ч. `apply_edits_immediately`, permissive `enforce()`, 501 у v2-stream, константы буфера, счётчики локалей, cross-flow rename, согласованность статусов R-01–R-40), а после получения каждого отчёта повторно вскрывал ключевые file:line субагентов. Все выборочные перепроверки совпали с отчётами дословно.

### 3.1 Разрешённые противоречия между субагентами (арбитраж основного агента)

| № | Противоречие | Решение и доказательство |
| --- | --- | --- |
| 1 | **MCP batch:** V5 — «не подтверждено» (batch не найден), V2 — «подтверждено» | **Подтверждено.** V5 искал только в backend Ketos; инструмент `batch` существует в KFX MCP-сервере: `src/kfx/src/kfx/mcp/server.py:1538-1584` — `@mcp.tool() async def batch(actions…)`, последовательный `await tool_map[tool_name](…)`; исключение на шаге *i* оставляет шаги 0…i−1 применёнными, отката нет. Формулировка Codex «batch не общая DB-транзакция, допускает partial success» верна. |
| 2 | **«Устаревшие» или «вымышленные» пути:** V5 отнёс неверные пути к отставанию карты Graphify | **Вымышленные.** Проверка `git log --all` основным агентом: пути `components/core/sidebar/…`, `i18n/languages.ts`, `pages/FlowPage/components/flow-page-sliding-container.tsx`, `stores/buildUtils.ts` не существовали **ни в одном commit истории** — они не могли прийти из устаревшей карты этого репозитория. Это реконструированные «правдоподобные» пути при верной сути и верных номерах строк. |
| 3 | **Существенность пропуска `AuthzEditLock`:** высокий (V5) или средний (V2) | **Средний.** Таблица `authz_edit_lock` — «спящая» схема: кроме модели (`auth/authz.py:252-267`), миграции `7c8d9e0f1a2b` и одного unit-теста, ни одного acquire/check в api/services нет. Операционный вывод аудита («редактирование Flow не защищено от гонок») остаётся верным; пропущен лишь неинвентаризированный актив для плана. |
| 4 | **Реальное место регистрации локалей:** `i18n.ts` (V5) или `constants/languages.ts` (V1) | Принята версия V1 (перепроверено построчно): список `SHIPPED_LANGUAGES` (en + ru) — `src/frontend/src/constants/languages.ts:24-43` (диапазон строк из аудита совпадает, перепутан только путь), `DEFAULT_LANGUAGE = "ru"` — там же :3; `fallbackLng: "en"` — `src/frontend/src/i18n.ts:73`. |

---

## 4. Итоговый вердикт

> ## Статус аудита Codex: **«пригоден после обязательных исправлений»**

**Обоснование.** Все центральные архитектурные тезисы аудита подтверждены исходниками, многие — в более сильной форме, чем заявлено (например, `mcp_enabled` вообще не проверяется на execute-пути; permissive-авторизация — это дефолт OSS, а не «отдельные конфигурации»). Классификация R-01–R-40 полна и внутренне согласована; план P0–P10 имеет корректный граф зависимостей и измеримые exit-критерии; численные утверждения (счётчики локалей, инвентарь тестов) воспроизведены с точностью до единиц. Однако комплект содержит: пять никогда не существовавших путей в Ketos и системно неверную карту каталогов OpenSwarm (10 из 15 путей), одно вымышленное поле модели (`FlowVersion.active`), одно неподтверждённое заявление о блокирующем запрете инструмента (Graphify rebuild) и ряд пропусков полноты (`src/compat` с реальным LFX-пакетом, `memory_base`, спящая `AuthzEditLock`, существующие security-механизмы), два из которых напрямую влияют на блокеры плана. Архитектурные выводы переработки не требуют; до использования комплекта как доказательной базы обязательны точечные правки из §10.

**Сводка по 93 проверенным утверждениям:**

| Статус | Количество |
| --- | ---: |
| подтверждено | 60 |
| подтверждено с оговорками | 20 |
| частично подтверждено | 7 |
| не подтверждено | 1 |
| противоречит кодовой базе | 1 |
| устарело | 1 |
| невозможно проверить | 3 |

---

## 5. Матрица проверенных утверждений

Способ проверки для всех строк: чтение исходников на HEAD (`Read`/`rg`), git-история для проверки существования путей, read-only запросы Graphify для цепочек; для OpenSwarm — исходники пиновой копии `ab982af`. Точные исправления ошибочных строк — в §10.

### 5.1 Frontend, канвас, интерфейс, навигация (V1)

| ID | Место | Утверждение (кратко) | Статус | Ключевое доказательство | Существенность |
| --- | --- | --- | --- | --- | --- |
| F-01 | 02 §4.1 | editable ReactFlow в `PageComponent` :935-1050; read-only preview :184-206 | частично подтверждено | mount :939-1021 верен; на :184-206 — баннер agent-working, реальный read-only: `isCanvasReadOnly` :166 + `ViewPage` | низкий |
| F-02 | 02 §4.1 | `flowStore` — один граф, undo/redo | подтверждено с оговорками | `flowStore.ts:116,176-178`; undo/redo — в `flowsManagerStore.ts:17-18,62-127` (тоже singleton) | редакционный |
| F-03 | 02 §4.1 | `react-flow-id`, document hotkeys, body cursor — один editor context | подтверждено | `index.tsx:939`; hotkeys :518-540; body cursor `simple-sidebar.tsx:259-312` | — |
| F-04 | 02 §4.1 | сохранение координат + fitView вместо восстановления viewport | подтверждено | `use-save-flow.ts:43-47`; `use-apply-flow-to-canvas.ts:34`; `setViewport` не вызывается нигде | — |
| F-05 | 02 §4.2 | NoteNode — узел Flow.data, не самостоятельная заметка | подтверждено | `types/flow/index.ts:41-43`; BoardNote отсутствует | — |
| F-06 | 02 §4.3 | hardcoded «New Project»: sidebar :225 и `use-add-flow.ts:86` | частично подтверждено | строки точны, но путь sidebar вымышлен: реально `core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx:225` | средний |
| F-07 | 02 §2,§4 | внешней Board/Placement-модели в frontend нет | подтверждено | активный поиск опровержения пуст; маршрутов boards нет (`routes.tsx:53-193`) | — |
| F-08 | 02 §11 | `i18n/languages.ts:24-43` (en+ru, default RU); `i18n/i18n.ts` (fallback EN) | подтверждено с оговорками | суть верна, оба пути вымышлены: реально `constants/languages.ts:24-43` и `i18n.ts:73` | средний |
| F-09 | 02 §11 | RU 2417 / EN 2345 / 72 нет в EN / 0 в RU / 16 идентичных | подтверждено | независимый пересчёт: все пять чисел совпали до единицы | — |
| F-10 | 02 §11 | миграция `9a6e34f1c2d8` ограничивает locale до ru/en | подтверждено | файл существует; data-cleanup (UPDATE), CHECK-constraint не добавляется | — |
| F-11 | 02 §4.3 | поиск фрагментирован, единого нет | подтверждено | отдельные пути flows/components/mcp/files/knowledge; `cmdk` есть в deps, но палитры нет | — |
| F-12 | 02 §5.2 | сосуществуют новый sliding-container и legacy playground-modal | подтверждено с оговорками | оба существуют; путь нового вымышлен (реально `components/core/playgroundComponent/sliding-container/components/…`); legacy активен на публичном `/playground/:id` | низкий |
| F-13 | 02 §2,§14 | Tauri-оболочка не обнаружена | подтверждено с оговорками | в репо Tauri нет; но существуют следы внешнего продукта «Ketos Desktop» (Tauri): тесты, `customization/constants.ts:1-2`, telemetry DESKTOP | средний |
| F-14 | 04 R-33 | account/settings actions существуют | подтверждено | `sidebarAccountComponent` (один триггер) + legacy `AccountMenu` c условной видимостью (`header-visibility.ts:9-23`) | — |
| F-15 | 04 R-17 | multi-mount нескольких Flow Editors небезопасен | подтверждено | singleton store + глобальный DOM id + document-listeners; вторые mounts только read-only | — |
| F-16 | 04 R-01 | внешнего per-user viewport-restore нет | подтверждено с оговорками | верно; но per-Flow viewport уже персистится (`use-save-flow.ts:43-47`) и не применяется | редакционный |

### 5.2 Backend, API, модели данных, миграции (V2)

| ID | Место | Утверждение (кратко) | Статус | Ключевое доказательство | Существенность |
| --- | --- | --- | --- | --- | --- |
| B-01 | 02 §6 | состав моделей Flow/Folder/FlowVersion/Message/Job/User/RBAC | подтверждено с оговорками | все существуют; у Flow только `updated_at`; каталог §6 неполон (см. E-11) | низкий |
| B-02 | 02 §6 | нет `chat_id`; FK message→flow удалён; нет chat-индекса | подтверждено | `chat_id` — 0 совпадений; FK удалён миграцией `1b8b740a6fa3`; `flow_id` без `foreign_key` (`message/model.py:170`) | — |
| B-03 | 02 §6 | rename/delete сессий owner-scoped, не flow-scoped → cross-flow mutation | подтверждено | `monitor.py:349-413`; `message/crud.py:13-29` — фильтра по flow нет | — |
| B-04 | 02 §6,§9 | `Flow.locked` — UI flag, не lease/CAS | подтверждено с оговорками | `flow/model.py:64,198`; revision-поля нет; но существует спящая `AuthzEditLock` (E-13) | средний |
| B-05 | 02 §6, 04 R-15 | race нумерации версий; activation не синхронизирует derived state | подтверждено с оговорками | `flow_version/crud.py:32-35` check-then-insert + retry ≤3; activation = copy `flow.data` (`flow_version.py:262-276`) без cache/webhook refresh; поля `active` нет (B-15) | средний |
| B-06 | 02 §6 | Job: логические ID без FK; dedupe check-then-insert | подтверждено | `jobs/model.py:41-90` (без FK, `dedupe_key` не unique); `services/jobs/service.py:115-140` | — |
| B-07 | 02 §5.3 | пять контуров стриминга с несовместимыми форматами | подтверждено | build NDJSON-заявка при `\n\n`-фрейминге (`build.py:211,321` + `event_manager.py:87`); `/run` SSE без `data:`; vertex `event:/data:` (`chat.py:580-704`); v2 stream → 501 (`workflow.py:215-223`); voice WebSocket (`voice_mode.py:707,724,1136,1153`) | — |
| B-08 | 02 §7 | reusable seams backend (CRUD/build/run/v2/authn/MCP/jobs/Alembic dual-DB) | подтверждено | пути перечислены в отчёте V2; `alembic/env.py:64-131` — обе СУБД | — |
| B-09 | 02 §7 | общего command layer нет; три пути мутаций | подтверждено | proposal/command-таблиц нет; REST PATCH + headless commit (`assistant_runner.py:207-217`) + MCP | — |
| B-10 | 02 §6 | Board/Placement/ChatThread/Result/Relation/Schedule моделей нет | подтверждено | 0 совпадений в моделях и миграциях; celery есть, beat/cron нет | — |
| B-11 | 02 §11 | locale-миграция и `preferred_locale` | подтверждено | `user/model.py:34`; миграция существует | — |
| B-12 | 04 H-03/R-28 | Folder: parent_id есть; pin/archive нет; create без parent | подтверждено | `folder/model.py:24-30,44-46`; `use-post-folders.ts:18-23`; PATCH умеет parent_id; проверки циклов нет | — |
| B-13 | 02 §12 | инвентарь тестов ~599/258/442/170/80 | подтверждено | пересчёт: 597/257/442/170/80 (файлы); `def test_` ≈ 10 200 | — |
| B-14 | 02 §9 | API key может быть расшифрован и возвращён по управленческим paths | частично подтверждено | list-пути маскируют (`ApiKeyRead.mask_api_key`); полный материал — только при создании; реальные утечки: GENERIC variables (`variable/service.py:226-244`), v2 MCP расшифровывает все, включая CREDENTIAL (`api/v2/mcp.py:240-256`), `remove_api_keys=False` по умолчанию | низкий |
| B-15 | 02 §6,§8; 04 R-15 | у FlowVersion есть поле `active`; activation переключает active state | **противоречит кодовой базе** | `flow_version/model.py:12-36` — поля нет; активация = перезапись `Flow.data` с auto-snapshot | средний |

Дополнительные проверки V2 (Д-1…Д-7): headless-запись `Flow.data` (`assistant_runner.py:203,207-217`) — подтверждено; KFX MCP `batch` без транзакции (`kfx/mcp/server.py:1538-1584`) — подтверждено; `mcp_enabled` не проверяется на execute (`kfx/base/mcp/util.py:726-747`) — подтверждено, сильнее заявленного; буфер 10/100 (`conversation_buffer.py:29-30`) — подтверждено; permissive authz (`authorization/service.py:61-82`) — подтверждено; v2 501 — подтверждено; audit off-by-default + drop-on-saturation (`audit.py:245-246,261-277`) — подтверждено. Итого 7/7 подтверждено.

### 5.3 Чаты, Flow Editor, KFX/LFX, исполнение (V3)

| ID | Место | Утверждение (кратко) | Статус | Ключевое доказательство | Существенность |
| --- | --- | --- | --- | --- | --- |
| C-01 | 02 §5.1 | цепочка Assistant panel→hook→SSE→router→service | подтверждено с оговорками | все диапазоны строк точны; route `POST /api/v1/agentic/assist/stream` (`router.py:40,304`); экспортируется `postAssistStream`, не hook | редакционный |
| C-02 | 02 §5.1 | буфер: 10 turns / 100 sessions на процесс | подтверждено | `conversation_buffer.py:29-30,84-89,125-133` | — |
| C-03 | 02 §5.1 | data-only SSE без id/sequence/heartbeat/replay | подтверждено | `sse.py`: 8 функций `f"data: {json}\n\n"`; `Last-Event-ID` — 0 совпадений | — |
| C-04 | 02 §5.1 | один AbortController/sessionId/model; isProcessing; история в localStorage | подтверждено с оговорками | `use-assistant-chat.ts:121-155,218`; localStorage-ключи; опция `internal` обходит блокировку (внутренний мост) | редакционный |
| C-05 | 02 §5.2 | KFX-цепочка chat→chat_output→component.py:1830-2074 | подтверждено | `send_message` :1830, `astore_message` :1924-1949, `on_token` :2067-2073 | — |
| C-06 | 02 §5.2 | singleton stores; один isBuilding/buildController; финал в legacy Zustand | подтверждено | `sessionManagerStore.ts:31`, `messagesStore.ts:5`, `flowStore.ts:178,1258`; `buildUtils.ts:712-807` | — |
| C-07 | 02 §7,§8 | `apply_edits_immediately=True` — прямая запись Flow.data без подтверждения | подтверждено | полная цепочка: `assistant_service.py:525,705,754` → `_state.py:102-109` → `edit_tools.py:173-175` → `assistant_runner.py:203,207-218` (commit); триггер — MCP `run_assistant` | — |
| C-08 | 02 §8 | preview-события есть, persisted proposal/apply-once нет | подтверждено | `flow_preview`/`flow_update`/`flow_proposal_ready` — эфемерные SSE; таблиц proposal нет; guard — клиентский ref | — |
| C-09 | 02 §8 | build может исполнять request graph data | подтверждено с оговорками | `build.py:419-444`; для не-владельца инъекция запрещена (`chat.py:273-280`) — риск остаётся для владельца | низкий |
| C-10 | 02 §5.3 | `stores/buildUtils.ts:157-445` парсит поток | частично подтверждено | путь вымышлен (никогда не существовал); реально `src/frontend/src/utils/buildUtils.ts` (`buildFlowVertices` :207-447, `onEvent` :683+) | средний |
| C-11 | 01 AC-04, 04 R-40 | термин «KFX/LFX» | подтверждено | LFX — реальный legacy-alias-пакет: `src/compat/lfx/pyproject.toml` (name="lfx", v1.10.2, alias на kfx), CLI `lfx`/`lfx-mcp`; сам аудит `src/compat` не упоминает (E-10) | — |
| C-12 | 04 R-21 | словари статусов не совпадают с требуемыми; disconnect не формализован | подтверждено с оговорками | `JobStatus`: queued/in_progress/completed/failed/cancelled/timed_out (`jobs/model.py:17-23`) — нет waiting_confirmation/unknown; build-события — третий словарь; v2 background реализован вопреки docstring | низкий |
| C-13 | 04 R-20 | run/build API есть; idempotency key на run-путях нет | подтверждено | `endpoints.py:792`, `workflow.py:137-183` (`job_id = uuid4()` на каждый вызов); `dedupe_key` используется только KB-ingestion | — |
| C-14 | 02 §5.1 | localStorage vs RAM расходятся после restart | подтверждено с оговорками | оба хранилища подтверждены; но статически открыт третий, durable след: `KetosAssistant.json` с `should_store_message=True` + `flow_executor.py:118-128` → `astore_message` в MessageTable (runtime не прогонялся) | средний |
| C-15 | 06 CHAT-02 | voice — отдельный duplex WebSocket | подтверждено | `voice_mode.py:40,310-318,707,724,1136,1153`; `voice-assistant.tsx:59` | — |

### 5.4 OpenSwarm (V4)

| ID | Место | Утверждение (кратко) | Статус | Ключевое доказательство | Существенность |
| --- | --- | --- | --- | --- | --- |
| O-01 | 03 §1 | README: Spatial Dashboard, infinite canvas, cards, dashboards, WS chat | подтверждено | `README.md:35,44,46` — дословно | — |
| O-02 | 03 §2 | стек Electron/React 18/RTK/MUI 7/Framer Motion/Webpack/FastAPI/JSON; без React Flow | подтверждено | `frontend/package.json`; `electron/package.json` (castlabs v42); `requirements.txt:12`; @xyflow — 0 вхождений | — |
| O-03 | 03 §2 | LICENSE: MIT, copyright 2026 Haik Decie | подтверждено | `LICENSE:1-3` дословно (перепроверено дважды) | — |
| O-04 | 03 §3 | список ключевых frontend/backend путей | частично подтверждено | все файлы существуют, но 10 из 15 frontend-путей — с неверными каталогами; `frontend/src/app/store/` не существует (реально `shared/state/`, `hooks/interaction/`, `hooks/state/`, `controls/`) | средний |
| O-05 | 03 §4 | CSS-transform-канвас, dotted background, minimap/controls | подтверждено | `DashboardCanvas.tsx:222-236`; controls через `DashboardOverlays` | — |
| O-06 | 03 §4 | RAF-батчинг, zoom-to-point, no-op bring-to-front, debounce+flush, minimap, suspend | подтверждено | все шесть паттернов с file:line (в т.ч. `dashboardLayoutSlice.ts:504` — no-op дословно; `useWebviewSuspend.ts`, бюджет `MAX_LIVE_WEBVIEWS=8`) | — |
| O-07 | 03 §4,§7 | fullscreen не законченная capability; expand есть | подтверждено | только `expandedSessionIds` + иконки; отдельного fullscreen-режима нет | — |
| O-08 | 03 §5 | модели CardPosition/DashboardLayout/Dashboard | подтверждено с оговорками | поля совпадают; контейнеры — dict, а не «массивы»; atomic write + миграция старого layout подтверждены | редакционный |
| O-09 | 03 §5 | нет FK/RBAC/CAS/транзакций | подтверждено | PUT перезаписывает без revision; файлы `{id}.json`; понятие пользователя в моделях отсутствует | — |
| O-10 | 03 §6 | AgentCard/AgentChat + общий WebSocketManager | подтверждено | `WebSocketManager.ts:54-59` envelope; связка с ~25 action creators | — |
| O-11 | 03 §8 | тесты, включая multi-window-stress.spec.ts | подтверждено | файл существует (Electron webviews stress, gated `OPENSWARM_E2E_HEAVY=1`); backend — 84 test-файла | — |
| O-12 | 03 §2 | собственный DOM/CSS compositor | подтверждено | без konva/pixi/fabric; pan/zoom — CSS transform, minimap — SVG | — |
| O-13 | 03 §7 | выборка 5 строк матрицы переноса | частично подтверждено | 4 из 5 подтверждены; `DashboardViewCard` — не «вложенные дашборды», а карточка встроенного HTML-приложения (Output); nested-boards в OpenSwarm нет | средний |
| O-14 | 02 §2,§14 | OpenSwarm — Electron, Ketos — нет; window virtualization нет | подтверждено | `DashboardCardLayer.tsx` рендерит все карточки без culling; suspend только для webview | — |
| O-15 | 03 §1 | идентификация именно spatial-dashboard-продукта | подтверждено | product name OpenSwarm; 7 типов карточек (`CardType`); совпадение с референсами | — |
| O-16 | 03 §2 | лицензионный вывод: MIT + необходимость SBOM-review | подтверждено с оговорками | пересказ MIT корректен;找ены усиливающие факты: вендоренные mcp-bundles без license-notices, `trafilatura` (copyleft-история), castlabs Electron с Widevine | низкий |

### 5.5 MCP, безопасность, RBAC, тесты, план (V5)

| ID | Место | Утверждение (кратко) | Статус | Ключевое доказательство | Существенность |
| --- | --- | --- | --- | --- | --- |
| S-01 | 02 §7 | `mcp_enabled` — discovery-фильтр, не enforcement на execute | подтверждено | фильтр `mcp_utils.py:418-419`; execute `handle_call_tool`→`get_flow_snake_case` (`kfx/base/mcp/util.py:726-747`) не проверяет флаг; глобальный сервер не фильтрует даже discovery | — |
| S-02 | 02 §7 | MCP batch не транзакция, partial success | подтверждено (арбитраж §3.1) | `src/kfx/src/kfx/mcp/server.py:1538-1584` | — |
| S-03 | 02 §7 | KFX MCP destructive tools без общего preview/confirmation | подтверждено с оговорками | `mutate_tools.py:54-97,189-210` — немедленные мутации; в headless review-gate отключён по конструкции (`_state.py:107-109`); частичный gate — `ProposeFieldEdit`/`ProposePlan` | низкий |
| S-04 | 02 §9 | OSS authz permissive; owner override не granular | подтверждено | `service.py:61-82` `return True`; `guards.py:108-110` ранний return при `AUTHZ_ENABLED=False` (дефолт); owner override `guards.py:172-180`; Board/Chat в `_RESOURCE_SPECS` нет | — |
| S-05 | 02 §9 | подтверждение не общая обязанность backend | подтверждено | confirmation-token/proposal-таблиц нет; delete/execute без подтверждения | — |
| S-06 | 02 §9 | AST scanner ≠ sandbox/egress/SSRF boundary | подтверждено | `validate.py`, `python_repl_security.py` («NOT a guaranteed sandbox»); SSRF — отдельный слой | — |
| S-07 | 02 §9 | audit best-effort / off-by-default | подтверждено | `AUTHZ_AUDIT_ENABLED` default False (`auth.py:160-168`); drop-on-saturation (`audit.py:8-13,261-277`); writer глотает DB-ошибки | — |
| S-08 | 02 §9 | API key material расшифровывается/возвращается | подтверждено с оговорками | см. B-14: management-ответы маскируют; реальный риск — внутренние пути и Flow.data | низкий |
| S-09 | 02 §6,§9 | RBAC-таблицы существуют; Board/Chat-действий нет | подтверждено | 8 таблиц в `auth/authz.py`; action-enums для 7 типов ресурсов, Board/Chat отсутствуют | — |
| S-10 | 02 §12 | инвентарь тестов | подтверждено | совпадение ±2 по всем пяти категориям | — |
| S-11 | 02 §12 | нет gates для board/concurrent-chat/nested-editor | подтверждено | e2e на несколько чатов/вложенный редактор отсутствуют | — |
| S-12 | 04 §2.1 | «MCP не ядро; Command Gateway обязателен» | подтверждено | вывод следует из S-01/S-02/S-03/S-05, все опоры таблицы подтверждены | — |
| S-13 | 04 §4,§6 | классификация 40 требований полна и согласована | подтверждено | двойная сверка (V5 + основной агент): 15+9+9+1+6=40, статусы §4 ↔ списки §6 совпадают построчно | — |
| S-14 | 05 | зависимости P0–P10 корректны; exit-критерии измеримы | подтверждено с оговорками | граф §2 ↔ предусловия §4-14 без противоречий; выборка 5 exit-критериев — измеримы; порог «≥90% corpus» помечен самим планом как medium-confidence | низкий |
| S-15 | 05 §17 ↔ 07 | блокеры честны и согласованы | подтверждено | пять блокеров §17 ↔ 07 §10/§12 без противоречий | — |
| S-16 | 02 §12 | результаты тестовых прогонов сессии Codex | подтверждено с оговорками | структурная правдоподобность: `test:i18n` 5 сьютов точно; счётчики — сессионные факты, прогон не повторялся | редакционный |

### 5.6 Проверки основного агента по журналам 06/07 (M)

| ID | Место | Утверждение (кратко) | Статус | Доказательство |
| --- | --- | --- | --- | --- |
| M-01 | 02 §1, 07 §3.1 | карта Graphify построена на `82510d5`, отстаёт на 4 commit | устарело | на момент аудита — верно; 2026-07-16 карта актуализирована: `built_at_commit == HEAD` |
| M-02 | 02 §1, 07 §3.3 | «полное обновление карты запрещено правилами установленного Graphify skill» — формальный blocker | **не подтверждено** | ни одна наблюдаемая версия скилла (глобальная `~/.claude/skills/graphify`, mtime 15.06; Codex-локальная `~/.codex/skills/graphify`, mtime 15.07 20:41; backup от 10.07) запрета не содержит — все документируют `--update` и rebuild; фактическое инкрементальное обновление прошло штатно (168 файлов, 0 токенов). Оговорка: точный текст скилла в окне 10.07–15.07 20:41 невоспроизводим. Существенность: **высокий** — на этом «blocker» построен итоговый статус BLOCKED в 07 §12 |
| M-03 | 07 §3.2 | результат `graphify path "FlowPage" "useFlowStore"` | подтверждено | воспроизведён дословно: 1 hop, `--calls [EXTRACTED]-->` |
| M-04 | 07 §4 | `alef` доступен, Aleph 0.9.4; RLM-вызовы деградировали | невозможно проверить | в текущей среде команда `alef` не найдена; сессионные заявления невоспроизводимы |
| M-05 | 07 §1 | дерево было clean на старте аудита | невозможно проверить | ретроспективно непроверяемо; текущее состояние согласуется |
| M-06 | 02 §4.3,§11 | live UI показывал смешанный RU/EN («New Project») | подтверждено с оговорками | live-прогон не воспроизводился; hardcoded-источники строк подтверждены в коде |
| M-07 | 02 §12 | broad backend run INCONCLUSIVE (прерван, 77 PASS) | невозможно проверить | сессионное событие; внутренне согласовано с 07 §8; сами тесты не перезапускались |
| M-08 | 02 §3 | структура репозитория: backend/frontend/kfx/bundles/scripts/tests/.github | частично подтверждено | перечисленное верно, но пропущены целые деревья `src/compat/*`, `src/sdk`, `src/ketos-stepflow` (E-10). Существенность: средний |

---

## 6. Ошибки аудита с доказательствами и уровнем существенности

### E-01 — вымышленное поле `FlowVersion.active` — **средний**
02 §6 («flow FK, version number, data, active, unique/check constraints»), §8 и 04 R-15 («FlowVersion activation меняет data/active state»). Модель `flow_version/model.py:12-36` содержит только id, flow_id, user_id, data, version_number, description, created_at. Активация (`api/v1/flow_version.py:227-292`) не переключает флаг, а копирует `data` версии в `Flow.data` c auto-snapshot. Понятие «активная версия» в схеме отсутствует (косвенно вычислимо только `is_deployed` через deployment attachments). Влияет на дизайн R-15.

### E-02 — пять вымышленных путей в Ketos — **средний** (системный дефект доказательности)
Проверено git-историей: ни один из путей не существовал ни в одном commit (`git log --all` пуст):

| В аудите | Фактически |
| --- | --- |
| `src/frontend/src/components/core/sidebar/components/sideBarFolderButtons/index.tsx:225` | `src/frontend/src/components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx:225` (строка точна) |
| `src/frontend/src/i18n/languages.ts:24-43` | `src/frontend/src/constants/languages.ts:24-43` (диапазон точен) |
| `src/frontend/src/i18n/i18n.ts` | `src/frontend/src/i18n.ts` |
| `src/frontend/src/pages/FlowPage/components/flow-page-sliding-container.tsx` | `src/frontend/src/components/core/playgroundComponent/sliding-container/components/flow-page-sliding-container.tsx` |
| `src/frontend/src/stores/buildUtils.ts:157-445` | `src/frontend/src/utils/buildUtils.ts` |

Паттерн: верное содержание и часто верные номера строк при реконструированном «правдоподобном» каталоге. Выводов не меняет, но нарушает собственный стандарт аудита «Факт — подтверждён указанным файлом». Примечательно: все ошибочные пути — во frontend; backend-цитаты (12+ файлов с диапазонами строк) точны до строки.

### E-03 — неверная карта каталогов OpenSwarm — **средний**
03 §3: 10 из 15 frontend-путей с неверными каталогами; каталога `frontend/src/app/store/` не существует (Redux-слайсы — в `frontend/src/shared/state/`; hooks — в `Dashboard/hooks/interaction|state/`; контролы — в `Dashboard/controls/`). Все файлы существуют под теми же именами.

### E-04 — неверный диапазон «read-only preview :184-206» — **низкий**
02 §4.1: на строках 168-202 `PageComponent/index.tsx` — баннер agent-working. Реальный read-only механизм: проп `view` + `isCanvasReadOnly` (:166) + гейтинг пропов ReactFlow :967-1016 + страница `ViewPage` (`routes.tsx:192`).

### E-05 — преувеличение «API key может быть … возвращён по управленческим paths» — **низкий**
02 §9. Management-read-пути маскируют (`ApiKeyRead.mask_api_key`, `mcp_projects.py:322-327`); полный материал возвращается один раз при создании. Реальные риски, которые аудит не назвал точно: GENERIC variables возвращаются расшифрованными (`variable/service.py:226-244`), v2 MCP расшифровывает все переменные включая CREDENTIAL для внешних серверов (`api/v2/mcp.py:240-256`), `remove_api_keys` по умолчанию False → секреты в `Flow.data`.

### E-06 — `DashboardViewCard` подан как референс «вложенных дашбордов» — **средний**
03 §7. Карточка рендерит Output (пользовательское HTML/JS-приложение) через `ViewPreview`; вложенных дашбордов и recursion policy в OpenSwarm не существует.

### E-07 — ослабленный вывод про Tauri — **средний**
02 §2/§14 «Tauri не обнаружен … отдельный Tauri plan не нужен до изменения desktop strategy». В репозитории есть контракты внешнего продукта «Ketos Desktop» на Tauri: `customization/constants.ts:1-2», regression-тесты (`assistant-message.test.tsx:172-177`, `test_flow_preparation.py:417-425`), telemetry-платформа DESKTOP. Desktop-strategy уже существует вне репо; вывод требует переформулировки.

### E-08 — неподтверждённый Graphify-blocker — **высокий**
02 §1 и 07 §3.3/§10/§12: «локальный Graphify skill … прямо запрещает rebuild/update; это формальный blocker». Ни одна из трёх наблюдаемых версий скилла (глобальная от 15.06, Codex-локальная текущая, backup от 10.07) запрета не содержит; все документируют `--update`/rebuild. Инкрементальное обновление карты на HEAD выполнено 16.07 штатно. На этом заявлении построен строгий итог «BLOCKED, а не PASS» (07 §12) и пункт «Не выполнено» в 07 §10 — оба требуют пересмотра. Оговорка: текст скилла именно в момент сессии Codex (окно 10.07–15.07 20:41) невоспроизводим, поэтому статус «не подтверждено», а не «противоречит».

### E-09 — редакционные неточности — **редакционный**
«Четыре несовместимых stream dialect» при пяти строках в таблице (02 §5.3); «timestamps» у Flow (есть только `updated_at`); `usePostAssistStream` (экспортируется функция `postAssistStream`); off-by-one «sse.py:8-134» (файл 133 строки); «~599 pytest» без уточнения файлы/функции; «массивы card types» в `DashboardLayout` (реально dict).

### E-10 — пропуск деревьев `src/compat/*`, `src/sdk`, `src/ketos-stepflow` — **средний, с высоким влиянием на R-40**
02 §3 перечисляет структуру без них. `src/compat/lfx` — реальный пакет `lfx` v1.10.2 (alias на kfx, frozen module inventory, CLI `lfx`/`lfx-mcp`) с compat-тестами; рядом `langflow`, `langflow-base`, `langflow-sdk`, `langflow-stepflow`. При этом 04 R-40 и 05 §17 называют «LFX compatibility corpus» открытым блокером — частично он уже существует в репозитории. `src/sdk` (ketos_sdk c async-клиентом и background jobs) тоже не упомянут.

### E-11 — неполный каталог моделей в 02 §6 — **средний**
Не упомянуты: `transactions` (per-vertex inputs/outputs/status/error), `vertex_builds`, `traces` (Trace/Span) — частичный фундамент execution-provenance для R-20/R-22; `deployment`, `deployment_provider_account`, `flow_version_deployment_attachment` (derived-state связка, релевантная R-15); `knowledge_base`, `memory_base`, `ingestion_run`, `file`, `variable`; столбцы `workspace_id` на Flow/Folder/AuthzRole (зачаток workspace-скоупа для R-28/R-38).

### E-12 — пропуск `memory_base` — **средний**
`MemoryBase`/`MemoryBaseSession`/`MessageIngestionRecord` (`models/memory_base/model.py`) — durable session-scoped memory-инфраструктура: (а) существующий образец durable session-linked персистентности для R-07/R-36; (б) ещё один consumer `session_id`, усиливающий описанный самим аудитом риск session-rename.

### E-13 — пропуск спящей `AuthzEditLock` — **средний**
`auth/authz.py:252-267` — «Optimistic edit lock … prevents concurrent edits to the same flow», unique flow_id, expires_at. Схема существует, но нигде не задействована. Тезис аудита «нет lease» операционно верен, однако P1/P2 плана проектируют CAS с нуля, не инвентаризировав готовый актив.

### E-14 — неинвентаризированные security-механизмы — **средний**
Не названы: конвейер `AuthzAuditLog` (батчевый writer, retention 90 дней `clean_authz_audit_log`, superuser read-API `api/v1/authz_audit.py`) — фундамент R-37; rate limiting (SlowAPI + Redis, `services/rate_limit/service.py`); SSRF-защита, включённая по умолчанию (`ssrf_protection.py:16`, re-validation на редиректах); REPL-hardening (`python_repl_security.py`); user-scoping/path-traversal-фиксы MCP-ресурсов. Свойства «best-effort/off-by-default» аудит передал верно, но существующая инфраструктура богаче, чем описано, что влияет на объём P9.

### E-15 — прочие содержательные пропуски — **низкий–средний**
Активный публичный `/playground/:id` на legacy `IOModal` (меняет порядок работ R-34); persisted, но неприменяемый `Flow.data.viewport` (частичный механизм R-01/R-27); `cmdk` уже в зависимостях (R-29/R-30); существующий review-gate `ProposeFieldEdit`/`_propose_existing_edits` (ближе к proposal-механике R-13, чем «preview частично реализован»); вероятная durable-история ассистента в MessageTable через `should_store_message=True` (статически открытый путь записи, требует runtime-подтверждения; меняет картину «только localStorage vs RAM»); build-контур уже имеет heartbeat/watchdog и cross-worker cancel (`build.py:245-311`); v2 background реализован вопреки docstring «not yet implemented»; celery без beat (основа будущего scheduler для R-31); внутренний `event_id` в EventManager, не доставляемый клиенту (релевантен sequence/replay R-21).

### E-16 — пропуски по OpenSwarm — **средний/низкий**
Message branching (форк диалога) — значимый референс для ChatThread; зрелый WS-resume-протокол (seq high-water mark, ring-buffer replay, gap detection, heartbeat) — полнее, чем одна строка «sequence/replay ideas» в 03 §7; облачный контур (`openswarm-edge`, per-install token, биллинг) при описании backend как чисто локального; вендоренные mcp-bundles без license-notices — прямо относится к license-разделу; бюджет живых webview `MAX_LIVE_WEBVIEWS=8` с гистерезисом.

---

## 7. Проверка требований R-01–R-40

**Полнота и согласованность:** все 40 требований рассмотрены в 04 §4 (по одному разделу на каждое, у каждого есть «Статус»); списки классификации в 04 §6 (Сохранить 15 + Изменить 9 + Разделить 9 + Отложить 1 + Эксперимент 6 = 40) сверены построчно со статусами §4 дважды (основным агентом и V5) — расхождений нет, дублей и пропусков нет. Обязательные аспекты (evidence, impact, риски, приёмка, уверенность, unresolved) присутствуют во всех 40 разделах.

**Проверка особых классов ошибок из задания:**

| Класс ошибки | Результат проверки |
| --- | --- |
| Назвал предполагаемую функцию существующей | Один случай: поле `FlowVersion.active` (E-01) |
| Не заметил существующий механизм | Несколько случаев: `src/compat`/LFX-пакет (E-10), `memory_base` (E-12), `AuthzEditLock` (E-13), конвейер AuthzAuditLog/rate-limit/SSRF/REPL (E-14), `/playground/:id`, persisted viewport, `ProposeFieldEdit`, вероятная MessageTable-история ассистента (E-15), Ketos Desktop (E-07) |
| Предложил дублирование backend/данных | Не обнаружено — аудит последовательно защищает единый backend (AC-03 соблюдён) |
| Неверно восстановил цепочку вызовов | Не обнаружено: цепочки Assistant, KFX chat, build/run, MCP execute проверены и точны до строк |
| Недооценил сложность вложенного Flow Editor | Нет — оценка обоснована кодом (singleton store, глобальный DOM id, document-listeners); решение «один активный editor + previews» технически корректно |
| Предложил небезопасный доступ AI | Нет — аудит требует Command Gateway/preview/confirm и прямо запрещает immediate apply (04 §5) |
| Лицензионный вывод без оснований | Нет — MIT передан корректно, вывод консервативен; проверка даже усилила его (вендоренные бандлы без notices, castlabs/Widevine) |
| Непроверяемые критерии завершения | Не обнаружено в выборке: exit-критерии P0/P2/P4/P6/P8 измеримы (px/мс/проценты/количества событий) |

**Точечные поправки к отдельным R** (не меняют статусов, уточняют основания):
- **R-01/R-27:** per-Flow viewport уже персистится (`use-save-flow.ts:43-47`), отсутствует только применение при загрузке и per-user разрез — объём работ меньше заявленного «полного отсутствия».
- **R-15:** убрать концепцию «active»-флага; активация = restore-by-copy; учесть deployment attachments и pruning старых версий (rollback-цель может быть уже удалена).
- **R-21:** зафиксировать фактические словари: `JobStatus` (queued/in_progress/completed/failed/cancelled/timed_out), build-события (BUILDING/BUILT/ERROR…) — `waiting_confirmation` и `unknown` действительно отсутствуют.
- **R-31:** подтверждён дополнительно — celery есть, beat/cron/APScheduler нет; «отложить» корректен.
- **R-33:** дублирование триггеров статически разрешимо через `header-visibility.ts` — «live inventory» не обязателен.
- **R-34:** учесть, что legacy playground — активная публичная поверхность `/playground/:id`, а не мёртвый параллельный код.
- **R-37:** фундамент уже есть — конвейер AuthzAuditLog + retention + read-API; проектировать поверх, а не с нуля.
- **R-38/R-39:** учесть существующие rate limiting, SSRF-защиту (on-by-default) и REPL-hardening.
- **R-40:** LFX-corpus частично существует (`src/compat/lfx/tests/…` и аналоги) — блокер §17 плана смягчается.

---

## 8. Проверка OpenSwarm и архитектурных рекомендаций

**OpenSwarm-часть (03):** идентификация репозитория, стек, лицензия, модель данных, ограничения persistence, chat-архитектура и все шесть заявленных interaction-паттернов подтверждены исходниками пиновой копии `ab982af`. Два дефекта: карта каталогов (E-03) и «вложенные дашборды» у DashboardViewCard (E-06). Пропуски E-16 занижают референсную ценность OpenSwarm (branching, WS-resume) и полноту license-обзора (вендоренные бандлы), но ни одна ошибка не опровергает решения R-02 «сохранить», R-03/R-04 «изменить».

**Обоснованность способа интеграции:** вывод «переносить паттерны, а не код» подтверждён реальной связанностью: `useCanvasControls` — единственный React-only модуль (переносим), тогда как `useDashboardInteractions`/`useCardDrag`/`WebSocketManager`/`useWebviewSuspend` жёстко связаны с Redux-слайсами и Electron API. Отказ от Electron/JSON-storage/MUI/Redux и запрет второго backend — обоснованы.

**Необходимость MCP vs внутренний слой:** таблица 04 §2.1 выдержала проверку. Все её фактические опоры подтверждены: `mcp_enabled` не enforcement на execute (S-01, даже сильнее заявленного), KFX MCP batch без транзакции (S-02, `server.py:1538-1584`), отсутствие общего preview/confirm (S-03/S-05), permissive OSS authz (S-04). Вывод «Command Gateway — обязательная основа; MCP — ограниченный adapter после него» следует из доказательств. Требование единого backend (AC-03) аудитом и планом сохранено везде.

**Безопасность/RBAC/подтверждения/аудит/откат:** учтены и в основном точны; требуемые правки — E-05 (формулировка про ключи) и E-13/E-14 (инвентаризация существующих активов). Самый сильный подтверждённый факт против текущей безопасности AI-пути: headless MCP `run_assistant` жёстко включает `apply_edits_immediately=True` и коммитит `Flow.data` без какого-либо подтверждения (`assistant_runner.py:203,207-218`) — рекомендация аудита «запретить immediate apply» полностью обоснована.

---

## 9. Оценка плана реализации (05)

- **Зависимости:** граф §2 (P0→P1→P2→{P3,P4}; P3→P5; {P4,P5}→P6; P5→P7; {P6,P7}→P8→P9→P10; PS после P7) построчно согласован с предусловиями §4–14. Противоречий нет.
- **Критерии приёмки:** во всех этапах присутствуют и в проверенной выборке измеримы (≤1 px / ≤0.01 zoom, 0 cross-events на 10 потоках, replay ≤1 apply, p95 ≤16.7 ms на объявленном профиле, row checksum 100%, stale revision → 409). Этапов без exit-критериев нет.
- **Блокеры (§17):** честны и согласованы с 07; поправки: блокер «LFX corpus» частично снимается существующим `src/compat` (E-10); Graphify-blocker из 07 не подтверждён (E-08).
- **Реалистичность:** prototype-first порядок (P0 до контрактов) адекватен подтверждённым рискам (nested editor, multi-chat, restore). Два уточнения объёма: P1/P2 должны инвентаризировать существующие активы (`authz_edit_lock`, конвейер AuthzAuditLog, transactions/vertex_builds/traces как прото-provenance, `memory_base`), иначе план дублирует уже существующие схемы; P4/R-07 должен учесть третий след истории ассистента (MessageTable) при проектировании backfill.
- **Совместимость Langflow/KFX/LFX:** план не нарушает — additive-миграции, feature flags, запрет переименования классов; compat-gates уже частично существуют в `src/compat/*/tests`, что план может использовать вместо создания corpus с нуля.

---

## 10. Точные исправления ошибочных положений

Обязательные (до использования комплекта как доказательной базы):

1. **02 §6 и 04 R-15:** удалить поле `active` из описания FlowVersion; заменить «activation меняет data/active state» на «активация копирует `data` версии в `Flow.data` c автоматическим snapshot (restore-by-copy); понятия активной версии в схеме нет; деплой-состояние отслеживается через `FlowVersionDeploymentAttachment`».
2. **02 §4.3/§5.2/§5.3/§11:** заменить пять путей по таблице E-02.
3. **03 §3:** заменить префиксы путей: `canvas/use*` → `hooks/interaction/`; `canvas/CanvasControls|Minimap` → `controls/`; `hooks/useLayoutSave` → `hooks/state/`; `app/store/*Slice` → `shared/state/`.
4. **03 §7 (DashboardViewCard):** заменить «архитектурный референс вложенных boards» на «референс тяжёлой embedded-поверхности (встроенное HTML-приложение Output); вложенных дашбордов в OpenSwarm нет».
5. **02 §4.1:** заменить «read-only preview :184-206» на «read-only через проп `view`/`isCanvasReadOnly` (:166) с гейтингом :967-1016; страница `ViewPage` на `/flow/:id/view`».
6. **02 §9:** переформулировать пункт об API-ключах: «полный материал возвращается один раз при создании; management-list маскирует; расшифрованные значения возвращаются для GENERIC variables, передаются внешним MCP-серверам (включая CREDENTIAL) и сохраняются в `Flow.data` при `remove_api_keys=False` (default)».
7. **02 §1 и 07 §3.3/§10/§12:** снять «запрет скилла» как основание blocker'а (не подтверждён ни одной наблюдаемой версией скилла; карта успешно актуализирована 16.07). Итоговый статус исследования в 07 §12 пересмотреть: единственные реальные незакрытия — RLM-деградация, неполный broad-run и production-scale, но не Graphify.
8. **02 §3:** добавить в структуру `src/compat/*` (lfx, langflow, langflow-base, langflow-sdk, langflow-stepflow), `src/sdk`, `src/ketos-stepflow`; в 04 R-40 и 05 §17 отразить существующие compat-тесты как частичный LFX-corpus.
9. **02 §6:** дополнить таблицу моделей: transactions/vertex_builds/traces (частичный execution-provenance), deployment*, memory_base/knowledge_base/ingestion_run, file/variable, workspace_id-колонки, спящая `authz_edit_lock`.
10. **02 §9 / 04 R-37–R-39:** инвентаризировать существующие механизмы — конвейер AuthzAuditLog (+retention, +read-API), rate limiting, SSRF-защита on-by-default, REPL-hardening; скорректировать объём P9.
11. **02 §2/§14 (Tauri):** заменить на «в этом репозитории Tauri-оболочки нет, но существует внешний дистрибутив Ketos Desktop на Tauri с regression-контрактами в коде; desktop strategy учитывать при контрактных изменениях».
12. **02 §5.2/§12 и 04 R-34:** отметить, что legacy `IOModal/playground-modal.tsx` — активная публичная поверхность `/playground/:id`.

Рекомендуемые (не блокируют): исправления E-09 (редакционные); дополнение 03 §6/§7 механизмами branching и WS-resume; упоминание `cmdk`, persisted viewport, `ProposeFieldEdit`; проверка runtime-следа истории ассистента в MessageTable до проектирования P4-backfill.

---

## 11. Заключение о возможности использовать аудит

Аудит Codex **пригоден как основа дальнейшей разработки после внесения обязательных исправлений §10 (пп. 1–12)**. Его сильные стороны подтверждены независимой проверкой: точная (до строк) backend-доказательная база, полная и внутренне согласованная классификация всех 40 требований, воспроизводимые числовые утверждения, корректный лицензионный и архитектурный анализ OpenSwarm, реализуемый план с измеримыми критериями и честными блокерами. Центральные решения — единый backend, разделение Board/Flow Editor, независимость Chat Thread от Placement, «один активный редактор + превью», Command Gateway до MCP-расширения — выдержали адверсариальную проверку по коду и могут приниматься как архитектурная основа.

Ограничения доверия: файловые цитаты frontend-части и карта каталогов OpenSwarm ненадёжны до правки (E-02/E-03); модель данных версий описана с одной вымышленной деталью (E-01); заявленный Graphify-blocker не подтверждён (E-08), поэтому строгий самостатус комплекта «BLOCKED» завышен в части Graphify и должен быть пересмотрен; инвентаризация существующих активов (compat-слой, memory_base, authz-инфраструктура) неполна, что при некритическом использовании привело бы к проектированию уже существующих механизмов с нуля в P1–P2.

Проверка выполнена без изменения исходного аудита и исходного кода; все существенные утверждения проверены по репозиториям на зафиксированных commit'ах; противоречия между субагентами устранены арбитражем основного агента с независимой перепроверкой доказательств.

---

*Методика: 5 субагентов Sonnet 5 (V1–V5) + арбитраж и ~20 личных якорных проверок Fable 5; Graphify (актуальная карта на HEAD: path/explain/query); rg/Read/git-история; read-only. Итог по 93 утверждениям: 60 подтверждено, 20 с оговорками, 7 частично, 1 не подтверждено, 1 противоречит кодовой базе, 1 устарело, 3 невозможно проверить.*
