# Отчёт о проверке мастер-плана

**Проверяемый документ:** [`11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md`](11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md) (999 строк)
**Дата проверки:** 2026-07-18
**Baseline:** `redesign/sidebar-account` @ `80878261d07c21ad257de017d98069f211ada2c2`
**Метод:** 9 субагентов-ревьюеров по зонам + прямая координаторская верификация каждой значимой находки против кода (`file:line`). Все факты сверены с реальным кодом на указанном SHA.

> **Проверка baseline.** HEAD подтверждён; `git diff src/` между `572fad8ea22` и `80878261d07` пуст — заявление плана о совпадении source-baseline верно. Все 20 существующих путей, на которые ссылается план, существуют; `scripts/rebrand/check_s2_compatibility.py`, `graphify-out/graph.json` и документы 01–10 на месте.

---

## Итоговая оценка

**План качественный и в основе достоверный.** Из ~40 фактических утверждений о коде («current truth», §3.2, задачи W0/F1) подтвердилось подавляющее большинство: дефект `Job.created_at`, неатомарная идемпотентность Job, fail-open по NULL-owner, отсутствие `Flow.revision`, `FlowVersion` как snapshot, `Message.session_id` NOT NULL без `chat_id`, `make lint`-заглушка, `auto_apply`/`skipAll`, глобальный `flowStore` и фиксированный `react-flow-id`, WS только для voice — всё верно. Барьерная модель, машины состояний §3.5–3.7 и rollback-лестница внутренне согласованы; обе mermaid-диаграммы валидны.

**Но план не готов к запуску без правок.** Есть 1 критическая ложная предпосылка, 6 существенных пропусков живых поверхностей кода и ряд более мелких расхождений. Главная системная проблема — план описывает legacy-поверхности абстрактно («public routes», «Assistant», «MCP»), тогда как в коде это конкретные работающие эндпоинты, которые меняют объём W0/F1.

### Сводка по severity

| Severity | Кол-во | Суть |
| --- | --- | --- |
| 🔴 Critical | 1 | Workspace объявлен существующей сущностью, которой нет |
| 🟠 High | 6 | Живые поверхности кода не учтены / нарушено обещание expand-only |
| 🟡 Medium | 9 | Пропуски в контрактах миграции и security-скоупе |
| 🟢 Low | ~11 | Косметика, неточные формулировки, битые ссылки |

**Рекомендация:** план можно вести в работу после закрытия критической предпосылки (Workspace) и явной инвентаризации шести живых поверхностей (MCP, AUTO_LOGIN, `openai_responses`, agentic, deployments↔FlowVersion, webhook) в разделах W0/F1-S/C1. High-находка про Folder-constraint требует либо отказа от «parent-scoped», либо признания, что F1-E тут не expand-only. Остальное — уточнения контрактов и косметика.

---

## 🔴 Critical — исправить до C1

### C-1. Workspace не существует как backend-сущность

Терминология (строка 33) объявляет Workspace «существующей backend-сущностью», а §3.2 требует `workspace_id` с «Required integrity» у Board, BoardNote, ChatThread и др. В коде нет ни модели, ни таблицы Workspace — только nullable `workspace_id`-колонки **без FK**:

- [`folder/model.py:32`](src/backend/base/ketos/services/database/models/folder/model.py:32), `flow/model.py:200`, `deployment/model.py:43` — `workspace_id: UUID | None = Field(default=None, nullable=True, index=True)`
- миграция `7c8d9e0f1a2b_authz_foundations.py:435` — `sa.Column("workspace_id", sa.Uuid(), nullable=True)` без ForeignKey
- Workspace существует только как authz-скоуп: [`authz.py:133`](src/backend/base/ketos/services/database/models/auth/authz.py:133) — `domain_type ... "global, org, workspace"`
- `grep 'class Workspace'` и `__tablename__ = "workspace"` — 0 совпадений; `models/__init__.py` не экспортирует Workspace

F1-E (строки 532–537) не содержит шага создания таблицы Workspace и backfill.

**Влияние:** все новые модели §3.2 не могут получить FK-целостность для `workspace_id` — ссылаться не на что. Либо план явно вводит новую сущность Workspace (миграция + backfill существующих nullable-колонок), либо «Required integrity» деградирует до application-level проверки, что прямо противоречит §3.3 (запрет soft-ссылок без DB-integrity как default).

---

## 🟠 High — заниженный объём / нарушенные обещания

### H-1. Живой MCP уже в проде, а контроль отложен в Wave 3 (M3)

Роутеры зарегистрированы: [`router.py:80-124`](src/backend/base/ketos/api/router.py:80) включает `mcp_router` (v1), `mcp_projects_router`, `mcp_router_v2`. Работают SSE и streamable-HTTP эндпоинты, экспонирующие flows пользователя как MCP-tools. `Flow.mcp_enabled` проверяется только как **фильтр в `handle_list_tools`** ([`mcp_utils.py:418`](src/backend/base/ketos/api/v1/mcp_utils.py:418)), а `handle_call_tool` ([`mcp_utils.py:280`](src/backend/base/ketos/api/v1/mcp_utils.py:280)) ищет flow по имени для `current_user` и исполняет **без повторной проверки** `mcp_enabled`.

**Влияние:** direct-name invocation flow с `mcp_enabled=false` возможен уже сейчас — это ровно кейс гейта M3 (строка 810). Контроль list/execute нужно поднять в W0/F1-S, а не откладывать в Wave 3; M3 не «добавляет» MCP, а мигрирует живую поверхность.

### H-2. AUTO_LOGIN=true по умолчанию подрывает предпосылки W0/RBAC

[`auth.py:73`](src/kfx/src/kfx/services/settings/auth.py:73) — `AUTO_LOGIN: bool = Field(default=True)`; неаутентифицированные запросы исполняются как единый superuser ([`auth/service.py:137`](src/backend/base/ketos/services/auth/service.py:137)). Актор-матрица W0 (owner/other/API-key/admin, строка 407) и RBAC-матрица C1-04 проверяемы **только** при `AUTO_LOGIN=false`. Режим нигде в плане (и в аудите №10) не упомянут.

**Влияние:** в дефолтной конфигурации существует один владелец; тесты ownership/RBAC нерепрезентативны. План должен явно зафиксировать multi-user (`AUTO_LOGIN=false`) как предпосылку тестов W0/C1.

### H-3. OpenAI-совместимый API отсутствует в плане

[`openai_responses.py`](src/backend/base/ketos/api/v1/openai_responses.py) (38 КБ, `tags=["OpenAI Responses API"]`, под `api_key_security`) запускает flows через `simple_run_flow`/`run_flow_generator` со стримингом. Зарегистрирован в [`router.py:83`](src/backend/base/ketos/api/router.py:83). `grep openai` по плану — **0 совпадений**.

**Влияние:** затрагивает W0 (ownership запусков через этот путь), F1-S (перечень AI/run routes, лимиты стримов), Q1 (API/OpenAPI compatibility diff).

### H-4. Agentic-подсистема не адресована как конкретная поверхность

`ketos/agentic/**` — зарегистрированные роуты `/api/v1/agentic` (execute, assist, assist/stream, sessions/reset, files_router) ([`router.py:111-121`](src/backend/base/ketos/api/router.py:111)), собственный MCP-сервер (`agentic/mcp/server.py`), `auto_apply` в `assistant_service.py`, автопровиженинг agentic flows в assistant-папку на пользователя ([`setup.py:786,842`](src/backend/base/ketos/initial_setup/setup.py:786)), конвенция `session_id="agentic_*"`.

**Влияние:** план оперирует абстракцией «Ketos Assistant» и «Remove/contain auto_apply» (строка 775), но миграция/владелец этой поверхности не расписаны (H1, P2).

### H-5. FlowVersion связан с deployments — F1-R меняет activate/CAS без учёта attachments

[`flow_version.py:132`](src/backend/base/ketos/api/v1/flow_version.py:132) вызывает `sync_flow_version_attachments`, гейтит по `FEATURE_FLAGS.wxo_deployments` (`:100`); существуют `v1/deployments.py` (runs, snapshots, providers) и модели `deployment`, `deployment_provider_account`, `flow_version_deployment_attachment`.

**Влияние:** F1-R «Modify Flow PATCH and FlowVersion activate to require/accept expected revision» (строки 587–606) не упоминает deployments — изменение семантики activation/revision может рассинхронизировать deployment snapshots.

### H-6. Parent-scoped constraints Folder ≠ expand-only (нарушено обещание F1-E)

Folder имеет глобальный [`UniqueConstraint("user_id","name")`](src/backend/base/ketos/services/database/models/folder/model.py:41) (подтверждено миграцией `1c79524817ed`), а `create_project` ([`projects.py:125-150`](src/backend/base/ketos/api/v1/projects.py:125)) авто-суффиксует имена по глобальному like-поиску. Заявленные в §3.2 «parent-scoped ordering/constraints» потребуют drop/замену существующего constraint и переработку авто-rename.

**Влияние:** меняет наблюдаемое поведение N-1 приложения и **нарушает обещание F1-E** «expand-only schema release; old N-1 application behavior unchanged» (строки 530–538, 706–707). План этот конфликт не называет.

---

## 🟡 Medium — уточнить в контрактах

### M-1. Assistant-история недоступна серверу для миграции H1
Полный транскрипт assistant-сессий живёт только в браузерном `localStorage` ([`session-storage.ts:25-34`](src/frontend/src/components/core/assistantPanel/helpers/session-storage.ts:25)), а backend-буфер — process-local, max 10 turns / 100 сессий, стирается рестартом ([`conversation_buffer.py:17-19`](src/backend/base/ketos/agentic/services/conversation_buffer.py:17)). Серверная saga H1 («buffer becomes derived cache», «Legacy dual-write/read») не восстановит legacy assistant-чаты — нужен client-side import. Плюс формулировка «три источника истины» (строка 60) неточна: buffer / localStorage / MessageTable хранят **разные** множества данных, а не три копии одного. Для assistant-чата канонического стора нет вообще; для playground-чата `MessageTable` уже каноничен. Дизайн ChatThread должен различать эти два случая.

### M-2. `Message.files` (вложения) не переносится в ChatTurn
[`message/model.py:31`](src/backend/base/ketos/services/database/models/message/model.py:31) — `files: list[str]` активно используется (валидатор конвертирует изображения). Модель §3 (ChatThread/ChatTurn/ChatRun) и H1-миграция не содержат поля/таблицы для attachments и не описывают ownership/retention файлов чата.

### M-3. `TraceModel.session_id` вне rename/migration-саги
[`traces/model.py:159`](src/backend/base/ketos/services/database/models/traces/model.py:159) группирует наблюдаемость по сессии; H1 упоминает только MemoryBase/Chroma — traces останутся с несогласованными идентификаторами, ломая корреляцию run↔trace для мигрированных чатов.

### M-4. Webhook run-as-owner без аутентификации не в W0 fail-closed floor
[`auth/service.py:446-450`](src/backend/base/ketos/services/auth/service.py:446): при `WEBHOOK_AUTH_ENABLE=false` `POST /webhook/{flow_id_or_name}` исполняет flow от имени владельца без кред. W0-02 делает GET/STOP/result fail-closed, но этот канал создания запусков от чужого имени не инвентаризован.

### M-5. Автосоздаваемые starter/assistant/default папки не учтены в I1/F1-B
[`setup.py:774+`](src/backend/base/ketos/initial_setup/setup.py:774) создаёт системные папки (и flows) при старте и на пользователя. I1 (иерархия depth 5, pin/archive/move, пагинация) и U2 project tree не определяют поведение системных папок: можно ли их move/archive/delete, входят ли в фикстуры пагинации и backfill parent'ов.

### M-6. W0-06 REPL — net-new, не «доводка»
[`python_repl_security.py:30-33`](src/kfx/src/kfx/components/utilities/python_repl_core.py) — «This is defense-in-depth, NOT a guaranteed sandbox»; код исполняется in-process на хосте. Гейт `ensure_code_execution_enabled()` завязан на `allow_custom_components` (default `True`, `security.py:41`). Требования W0-06 «multi-user/network default-off» и «host execution запрещён» — новая работа, а не почти готовое.

### M-7. W0-07 SSRF-покрытие частичное
Центральный `ssrf_safe_get` валидирует каждый redirect-hop, но **не использует** DNS-pinning `validate_and_resolve_url` — `requests.get` резолвит DNS повторно по hostname (окно rebinding). `web_search.py`/`news_search.py` и ~10 других компонентов идут прямым `requests.get` мимо клиента. Список файлов в W0 верен, но объём работы занижен.

### M-8. Continuous LFX/compat lane придётся создавать с нуля
Ни LFX-corpus (`src/compat/lfx/tests`), ни `check_s2_compatibility.py` не вызываются ни одним `make`-таргетом или GitHub-workflow. F1-O (строка 612) говорит «integrated», хотя интеграции нет. Дополнительно: LFX-тест вычисляет эталон через `git ls-tree -r <frozen commit>` — упадёт в shallow-clone CI (`fetch-depth: 1`), что конфликтует с B0-06 «focused baseline в clean worktree».

### M-9. F1-R не заякорена в DAG; вход P2 противоречив
- F1-R (Board/Chat/Command/Search/Execution routers, строки 587–606) — единственная именованная подфаза F1 без узла в DAG §4 и без места в spine `C1 → F1-E/K/J/S/O → F1-W`. Не определено, до F1-W или до F1-C она завершается.
- Вход P2: текст §13 (строка 765) даёт «Depends on: K1, E2, R2», DAG/spine — `S2 → P2` (барьер, включающий E2+R2+Q1). По тексту P2 можно начать до S2 — нарушение барьерной модели §5.

---

## 🟢 Low — косметика / точность формулировок

- **«LFX 974-module corpus»** — LFX это шим `lfx → kfx` ([`src/compat/lfx`](src/compat/lfx)); модулей в kfx сейчас 978 (971 без тестов). Число 974 нигде, кроме плана, не встречается — не привязывать гейт к магическому числу, считать динамически.
- **W0-01/W0-05 частично по мёртвому коду:** все 10 prod-вызовов `create_job` передают non-null владельца (NULL-строки только legacy из миграции `169b35510b37`); дефектный `get_jobs_by_flow_id` с `Job.created_at` ([`service.py:56`](src/backend/base/ketos/services/jobs/service.py:56)) нигде не вызывается. Работа реальна, но формулировки сместить с «найти call sites» на «legacy-строки в БД + сделать параметр `user_id` обязательным».
- **Набор job-routes:** фактически три поверхности (`POST /api/v2/workflows`, `GET ...?job_id=`, `POST .../stop`), а не отдельные «GET/STOP/result/cancel»; prefix во множественном числе.
- `MessageTable` уже содержит `context_id` рядом с `session_id` ([`message/model.py:29`](src/backend/base/ketos/services/database/models/message/model.py:29)) — план вводит `chat_id`, не разграничив три идентификатора.
- `session_id` объявлен immutable в MemoryBase ingestion ([`memory_base/service.py:233`](src/backend/base/ketos/services/memory_base/service.py:229)) — значит H1 «Rename changes title only» не просто желателен, а обязателен.
- Дублирование `reactflow` v11 + `@xyflow/react` v12 в [`package.json:107`](src/frontend/package.json) (v11 не импортируется) — риск случайного импорта старого API для X-A/X-B/E2.
- A1 назначает код в `src/frontend/src/features/boards/**`, но каталога `features/` нет (паттерн — `pages/` + `components/core/`); новая директорийная конвенция нигде не зафиксирована как решение.
- **GC-15 vs §6.5:** пороги памяти (16 ГиБ / 2 jobs vs 14 / 15.5 ГиБ) и список сериализуемых задач (§6.5 добавляет `full pytest`) расходятся в семантике.
- **§21 vs §7:** «минимум пять read-only baseline субагентов» против «3 субагента + coordinator» — первый handoff нельзя выполнить, следуя обеим секциям без интерпретации.
- **R-34** (строка 963) ссылается на несуществующую задачу «B0 telemetry baseline» — среди B0-01…B0-08 такой нет.
- **План не самодостаточен:** определения R-01…R-40 живут в `01_KETOS_REQUIREMENTS.md §4`, E-09/E-15/E-16 — в 08/10. C1-гейт «Every R-01…R-40 has owner» (строка 515) оперирует ими вслепую. Нужен явный указатель на источники.
- **`make lint`** не просто no-op: зависит от `install_backend` (uv sync) — модифицирует окружение перед печатью «No type checker configured». Отразить в `tooling-contract.json` (B0).

---

## Покрытие аудита №10

План 11 **системно закрывает** замечания аудита: все 10 классов дефектов вердикта и практически все обязательные коррекции §4–§9 имеют адресующие места (Global Constraints, W0, X-core, C1, F1-E/W/B/V/C, отдельные lanes, трейс R-01–R-40 §19). Противоречий аудиту план не вносит. Остались только мелкие хвосты (все low):

| Аудит | Требование | Статус в плане 11 |
| --- | --- | --- |
| §4.5 | Явная conversion-policy NoteNode→BoardNote (copy/move/link UX) | MISSING — есть только разделение сущностей (строки 58, 669) |
| §4.13 | Bypass-inventory охватывает 6 каналов, включая «filesystem save» | PARTIAL — filesystem save явно не назван |
| §4.22 | Enforced coverage threshold | MISSING — остальные пункты §4.22 закрыты |
| §4.21 | Dirty-worktree OpenSwarm в caveats | MISSING — есть только про собственный checkout |

---

## Подтверждённые факты плана (verification passed)

Следующие утверждения «current truth» и §3.2 проверены и **подтверждены** кодом:

- `/api/v1/projects` использует `Folder` ([`projects.py:111-118`](src/backend/base/ketos/api/v1/projects.py:111)); legacy `/folders` редиректит 307.
- `Flow` без `revision`; `FlowVersion` — чистый snapshot; активация копирует `data` через `copy.deepcopy` ([`flow_version.py:252,272`](src/backend/base/ketos/api/v1/flow_version.py:252)), конкурентность через `IntegrityError→409`, не CAS.
- `Message.session_id: str` NOT NULL; `chat_id` отсутствует ([`message/model.py:28`](src/backend/base/ketos/services/database/models/message/model.py:28)).
- `Job.created_at` — реальный дефект: [`service.py:56`](src/backend/base/ketos/services/jobs/service.py:56) сортирует по несуществующему атрибуту (в модели — `created_timestamp`).
- Идемпотентность Job неатомарна: SELECT по `dedupe_key` → raise → insert, без unique-констрейнта ([`service.py:116-136`](src/backend/base/ketos/services/jobs/service.py:116)).
- Fail-open по NULL-owner: [`crud.py:56`](src/backend/base/ketos/services/database/models/jobs/crud.py:56) — `OR Job.user_id IS NULL`.
- `JobStatus` не содержит `CANCEL_REQUESTED`/`RETRY_WAIT`; нет lease/attempt/epoch/fencing — как утверждает план.
- `make lint` — заглушка (`echo "No type checker configured"`).
- `auto_apply` (backend `assistant_service.py`) и `skipAll` (localStorage `ketos-assistant-skip-all`) существуют.
- Глобальный singleton `flowStore`, единственный `ReactFlowProvider`, document-глобальные hotkeys, фиксированный `id="react-flow-id"` ([`PageComponent/index.tsx:939`](src/frontend/src/pages/FlowPage/components/PageComponent/index.tsx:939)), `fitView` на load, `NoteNode` как тип Flow-графа.
- WS только для voice (`voice_mode.py`); стриминг чата — SSE + `build/{job_id}/events`.
- Механизм регистрации моделей (`models/__init__.py` → `SQLModel.metadata` → Alembic env) и паттерн `model_fields_set` соответствуют F1-E/I1.
- Virtual shared flow (`compute_virtual_flow_id`) реально существует — опора categorizer'а F1-B обоснована.

---

## Источники

- Полные результаты 9 зон с evidence: журнал воркфлоу `wf_fd6999a2-c67` (`journal.jsonl`).
- Определения требований: [`01_KETOS_REQUIREMENTS.md`](01_KETOS_REQUIREMENTS.md).
- Замечания аудита: [`10_KETOS_MASTER_PLAN_AUDIT_REPORT.md`](10_KETOS_MASTER_PLAN_AUDIT_REPORT.md).

> **Оговорка о полноте.** Фаза адверсариальной верификации (независимое опровержение находок вторым слоем агентов) не была завершена из-за лимитов сессии. Все находки severity Critical/High/Medium перепроверены координатором прямым чтением кода вручную и подтверждены указанными `file:line`. Low-находки приведены как есть от ревьюеров с evidence.
