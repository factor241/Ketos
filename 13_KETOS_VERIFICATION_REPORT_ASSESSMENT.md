# Ketos: оценка отчёта проверки мастер-плана

**Проверяемый документ:** [`12_KETOS_MASTER_PLAN_VERIFICATION_REPORT.md`](12_KETOS_MASTER_PLAN_VERIFICATION_REPORT.md)
**Проверяемый план:** [`11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md`](11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md)
**Baseline:** `redesign/sidebar-account` @ `80878261d07c21ad257de017d98069f211ada2c2`
**SHA-256 отчёта 12:** `6d1fe8d209145fab2737acf32d876a53f6be139dc49548381f2facb48b06f328`
**Дата повторной проверки:** 2026-07-18

## 1. Результат

Отчёт 12 полезен как второй слой аудита: он правильно обнаружил незаявленные живые поверхности API, реальное отсутствие таблицы `Workspace`, конфликт parent-scoped имён с текущим `Folder`, пробелы миграции assistant-истории и недостаточно точный DAG. Его нельзя принимать как безусловную спецификацию исправлений.

Итоговая классификация самостоятельной перепроверки:

| Класс | Количество | Значение |
| --- | ---: | --- |
| Подтверждено | 26 | Факт и практическое следствие в основном верны |
| Частично подтверждено | 8 | Факт верен, но severity, формулировка или предлагаемое решение завышены |
| Не подтверждено / исключить | 1 | Вывод противоречит текущему коду или смешивает разные контракты |
| Методологически непроверяемо | 1 | Заявленное evidence отсутствует в checkout |

Главные изменения дальнейших действий:

1. Не вводить таблицу `Workspace` автоматически. В V1 зафиксировать `Project = Folder` как границу размещения Board/Chat/Note; термин “Ketos Workspace” использовать для оболочки приложения, а существующие nullable `workspace_id` оставить как необязательный authz scope до отдельного tenancy ADR.
2. Перенести containment уже зарегистрированных MCP, agentic, OpenAI Responses, webhook и workflow routes в раннюю security-фазу.
3. Сохранить текущую глобальную уникальность `Folder(user_id,name)` в V1; parent-scoped имена не включать в expand-only release.
4. Считать `MessageTable` каноническим телом сообщения вместе с `files`; `ChatTurn` хранит порядок и состояние, но не копирует текст или вложения.
5. Сделать две миграционные линии чатов: server-side классификацию `MessageTable` и явный client-side import полной assistant-истории из `localStorage`.
6. Встроить `F1-R` в DAG между foundational lanes и dual-write, а P2 запускать только после S2 и K1.
7. Сохранить замороженный LFX-контракт из 974 модулей; убрать зависимость обычного CI от наличия исторического Git commit, но не заменять 974 числом текущих модулей KFX.
8. Добавить в план security profiles, system-folder policy, Trace linkage, NoteNode conversion, filesystem capability inventory, telemetry baseline и enforced coverage policy.

## 2. Метод и ограничения проверки

### 2.1 Подтверждённый baseline

- Ветка: `redesign/sidebar-account`.
- HEAD: `80878261d07c21ad257de017d98069f211ada2c2`.
- `src/**` совпадает с source-baseline карты Graphify `572fad8ea22…`.
- Пользовательские dirty/untracked файлы не изменялись.
- Использована существующая `graphify-out/graph.json` и Graphify query по Flow/FlowVersion/Job/Folder/Message/MCP/assistant/migrations/API; ключевые выводы затем проверены прямым чтением исходников.

### 2.2 Ограничение по памяти

Суммарный RSS в ходе повторной проверки находился выше ранее заданного пользователем предела 16 ГиБ из-за уже запущенных Chrome, Claude, Codex renderer и общих MCP-процессов других сессий. После остановки только процессов, созданных текущей сессией, RSS оставался около 18 ГиБ. Поэтому не запускались новые субагенты, браузер, сборки, полные тесты и Graphify rebuild. Это снижает независимость повторной проверки, но не меняет source-backed выводы ниже.

### 2.3 Непроверяемое методологическое заявление отчёта

Отчёт 12 ссылается на журнал `wf_fd6999a2-c67 (journal.jsonl)` как evidence работы девяти субагентов. Такого файла или идентификатора в текущем checkout нет. Поэтому число и независимость ревьюеров невозможно подтвердить из репозитория. Это не опровергает технические находки, подтверждённые кодом, но требование воспроизводимости evidence не выполнено.

## 3. Оценка вводных выводов отчёта

### META-01 — baseline и source identity

- **Вердикт:** подтвердить.
- **Сохранить:** branch, SHA и факт отсутствия `src/**` diff относительно source-baseline Graphify.
- **Изменить:** не считать наличие путей доказательством корректности их интерпретации.
- **Практическое действие:** каждый implementation handoff заново фиксирует SHA, dirty ownership и `src/**` diff к карте.

### META-02 — «план качественный и внутренне согласован»

- **Вердикт:** частично подтвердить.
- **Обоснование:** state machines и rollback ladder полезны, но DAG теряет `F1-R`, P2 имеет два разных входных контракта, а persistence model опирается на несуществующую Workspace entity.
- **Изменить:** формулировать план 11 как сильную основу, не как исполняемый контракт.
- **Практическое действие:** заменить его новым планом 14; план 11 сохранить как historical evidence.

### META-03 — severity summary «1 Critical, 6 High, 9 Medium, ~11 Low»

- **Вердикт:** изменить.
- **Обоснование:** C-1 — критическая неоднозначность терминологии, но не доказательство необходимости новой таблицы; H-5 не доказывает фактическую рассинхронизацию; low-пункт про 974 ошибочен; AUTO_LOGIN сформулирован чрезмерно широко.
- **Практическое действие:** использовать приоритеты нового плана: ранний containment живых mutation/run surfaces, затем contract freeze, затем expand-only foundation.

## 4. Critical

### C-1 — Workspace не существует как backend-сущность

- **Вердикт:** частично подтвердить; premise верен, предлагаемая развилка неполна.
- **Подтверждённые факты:**
  - `Folder.workspace_id` nullable, без FK: `src/backend/base/ketos/services/database/models/folder/model.py:32`.
  - Аналогичные nullable поля есть у Flow и Deployment.
  - `7c8d9e0f1a2b_authz_foundations.py` добавляет колонку и индекс, но не таблицу/FK.
  - `workspace` используется как значение `domain_type` authz, а не как ORM entity.
  - `FolderCreate` не объявляет `workspace_id`; `projects.py` читает его только через `getattr(..., None)`.
- **Ошибка отчёта:** отсутствие таблицы не означает, что V1 обязан создать полноценную tenancy-модель. Это существенно расширит миграцию, RBAC, backfill и product semantics без подтверждённого пользовательского требования отдельной организации/tenant.
- **Сохранить:** запрет на неявное объявление Workspace существующей сущностью и запрет на фиктивные FK.
- **Изменить:**
  - “Ketos Workspace” = application shell, не DB row.
  - V1 Board/Chat/Note принадлежат существующему Project (`folder.id`) и owner.
  - nullable `workspace_id` остаётся opaque optional authz scope для совместимости.
- **Исключить:** автоматическое создание `workspace` table/backfill в foundation.
- **Практические действия:** ADR domain-scope; удалить обязательный `workspace_id` из новых V1 моделей; отдельный future ADR нужен, если появится реальная multi-tenant Workspace entity.

## 5. High

### H-1 — MCP является живой поверхностью, а не будущей функцией

- **Вердикт:** подтвердить.
- **Доказательства:** `src/backend/base/ketos/api/router.py:80-83,123-125`; `handle_list_tools` фильтрует `mcp_enabled`, а `handle_call_tool` выполняет найденный по имени flow без повторной проверки в `src/backend/base/ketos/api/v1/mcp_utils.py`.
- **Уточнение:** код доказывает зарегистрированную поддерживаемую поверхность, но не конкретный production deployment.
- **Сохранить:** перенос execute-time enforcement в W0/F1-S.
- **Изменить:** M3 должен мигрировать/адаптировать уже живые MCP v1/v2/projects routes к Command Kernel, а не «добавлять MCP».
- **Практические действия:** route inventory; `mcp_enabled` + RBAC + Flow EXECUTE check на list и call; direct-name negative test; feature/profile kill switch.

### H-2 — AUTO_LOGIN и RBAC

- **Вердикт:** частично подтвердить.
- **Доказательства:** `AUTO_LOGIN=true` по умолчанию в `src/kfx/src/kfx/services/settings/auth.py:73-81`.
- **Ошибка отчёта:** unauthenticated server fallback к superuser в `auth/service.py:137` срабатывает только при одновременных `AUTO_LOGIN=true` и `skip_auth_auto_login=true`. Сам `AUTO_LOGIN` не равен безусловному bypass всех защищённых routes.
- **Сохранить:** RBAC/ownership acceptance нельзя считать валидным в single-user auto-login profile.
- **Изменить:** определить три профиля: desktop/single-user, multi-user/network, acceptance-test. Для последних двух обязательны `AUTO_LOGIN=false`, `skip_auth_auto_login=false`, `WEBHOOK_AUTH_ENABLE=true`.
- **Практические действия:** profile manifests, startup validation, отдельные тестовые матрицы; документация различает auto-login UI bootstrap и auth bypass.

### H-3 — OpenAI Responses API пропущен

- **Вердикт:** подтвердить.
- **Доказательства:** router включён в `api/router.py:83`; `/api/v1/responses` использует `api_key_security`, Flow lookup, `simple_run_flow`/`run_flow_generator` в `api/v1/openai_responses.py`.
- **Сохранить:** включить в W0, F1-S, F1-J/R и Q1.
- **Дополнить:** проверять Flow EXECUTE, limits, stream cancellation, result/trace correlation и OpenAI wire compatibility.
- **Практические действия:** actor matrix, API snapshot, background/stream failure tests, current-flow revision pinning.

### H-4 — Agentic-подсистема пропущена как конкретный migration lane

- **Вердикт:** подтвердить.
- **Доказательства:** `/api/v1/agentic/execute`, `/assist`, `/assist/stream`, sessions reset и files routes зарегистрированы; `assistant_service.py` испускает `auto_apply`; frontend хранит `ketos-assistant-skip-all`; `initial_setup/setup.py` создаёт assistant folder/flows.
- **Сохранить:** ранний containment и отдельный migration owner.
- **Дополнить:** agentic filesystem tools, user-component writes, session reset и auto-provisioning входят в bypass/capability inventory.
- **Практические действия:** до P2 запретить автоматическое production mutation в multi-user profile; позже заменить на adapter AI Planner → Proposal → Command Kernel.

### H-5 — FlowVersion и deployment attachments

- **Вердикт:** частично подтвердить; severity завышен.
- **Доказательства:** `flow_version.py:132` синхронизирует provider-scoped attachment status при list; `FlowVersionDeploymentAttachment` имеет FKs к immutable version и deployment; activation копирует snapshot data в Flow.
- **Ошибка отчёта:** текущая activation не обязана перемещать deployment attachment и код не доказывает уже существующую рассинхронизацию. Attachment описывает конкретный immutable snapshot, а не «текущую активную версию».
- **Сохранить:** F1-R обязан учитывать deployments при добавлении Flow CAS/lineage.
- **Изменить:** контракт: activation меняет `Flow.data/revision`, но не перепривязывает существующий deployment; deploy/refresh создаёт или синхронизирует attachment отдельно.
- **Практические действия:** regression tests для activate/deploy/delete/prune, feature-flag off/on, provider snapshot identity и CAS conflict.

### H-6 — parent-scoped Folder uniqueness нарушает expand-only

- **Вердикт:** подтвердить.
- **Доказательства:** `UniqueConstraint("user_id","name")` в `folder/model.py:41`; `create_project` глобально авто-суффиксует имя в `projects.py:125-150`.
- **Сохранить:** иерархия, cycle/depth/move validation.
- **Изменить:** V1 сохраняет глобальную per-user уникальность имён. Parent-scoped одинаковые имена откладываются в отдельный compatibility/cutover проект.
- **Исключить:** drop/replace unique constraint из F1-E.
- **Практические действия:** API явно документирует глобальный rename policy; тесты перемещения не меняют имя неожиданно.

## 6. Medium

### M-1 — assistant-история недоступна server-side

- **Вердикт:** подтвердить с уточнением.
- **Доказательства:** полные сериализованные UI messages сохраняются в `assistantPanel/helpers/session-storage.ts`; backend buffer имеет 10 turns/100 sessions и process-local lifecycle в `conversation_buffer.py`.
- **Уточнение:** agentic flows могут сохранять отдельные ChatInput/ChatOutput messages в `MessageTable`, но это не гарантирует полный UI transcript, proposal/result cards и статусы. Источники содержат разные множества данных.
- **Сохранить:** канонический durable ChatThread/MessageTable для новых чатов.
- **Дополнить:** client-side opt-in import с preview, checksum, idempotency и ambiguity handling; server-side census MessageTable отдельно.
- **Практические действия:** не обещать автоматическую server migration localStorage; после подтверждённого импорта local copy становится cache.

### M-2 — Message.files не перенесён в ChatTurn

- **Вердикт:** частично подтвердить; предложенная постановка неверна.
- **Доказательства:** `MessageBase.files: list[str]` и нормализация путей существуют в `message/model.py:31,53-88`.
- **Ошибка отчёта:** invariant плана 11 уже назначает `MessageTable` каноническим body. Поэтому `ChatTurn` не должен дублировать `files` так же, как не должен дублировать `text`.
- **Сохранить:** вложения остаются частью canonical Message row.
- **Дополнить:** file ownership, authorization on read, retention, tombstone, malware/type/size policy; отдельная `ChatAttachment` допустима только после ADR о невозможности безопасно расширить текущий file metadata model.
- **Практические действия:** attachment fixtures входят в dual-write/import/export/delete tests.

### M-3 — Trace session linkage

- **Вердикт:** подтвердить.
- **Доказательства:** `TraceBase.session_id` используется для grouping/filtering в `traces/model.py:159-163` и `/monitor/traces`.
- **Сохранить:** исторический `session_id` не переименовывать destructively.
- **Дополнить:** nullable `chat_id`, `chat_run_id`/`job_id` correlation либо versioned mapping; каждый trace read повторно авторизуется через Flow/Chat/Job.
- **Практические действия:** migrated/imported chat сохраняет trace discoverability; ambiguity ledger вместо silent reassignment.

### M-4 — unauthenticated webhook profile

- **Вердикт:** подтвердить с важным уточнением.
- **Доказательства:** при `WEBHOOK_AUTH_ENABLE=false` `get_webhook_user` возвращает владельца Flow; route `/api/v1/webhook/{flow_id_or_name}` исполняет от его имени.
- **Уточнение:** default уже secure — `WEBHOOK_AUTH_ENABLE=true` в `auth.py:86`.
- **Сохранить:** webhook в W0 surface matrix.
- **Изменить:** unauthenticated owner-run — только явно названный trusted compatibility profile, запрещённый в multi-user/network.
- **Практические действия:** startup warning/fail-fast policy, API-key/rate/idempotency tests, SSE listener ownership.

### M-5 — system folders

- **Вердикт:** подтвердить.
- **Доказательства:** starter, assistant и default folders создаются в `initial_setup/setup.py`; комментарий утверждает, что assistant folder нельзя удалять, но модель не хранит системную роль.
- **Сохранить:** reuse `Folder`, не создавать отдельный Project backend.
- **Дополнить:** nullable/additive `system_role`; запреты delete/archive/move определяются ролью, а не локализованным именем.
- **Практические действия:** high-confidence backfill по provenance/flow fingerprints; неоднозначные rows не маркировать автоматически; новые setup writes сразу ставят роль.

### M-6 — REPL является net-new isolation work

- **Вердикт:** подтвердить.
- **Доказательства:** `PythonREPLComponent` исполняет код in-process; `allow_custom_components=true` по умолчанию; security settings прямо рекомендуют hardware-level isolation для multi-tenant.
- **Исправить ссылку отчёта:** реализация находится в `src/kfx/src/kfx/components/utilities/python_repl_core.py`, helper — `kfx/utils/python_repl_security.py`.
- **Сохранить:** multi-user/network default-off и exploit corpus.
- **Изменить:** не обещать «zero host execution» только allowlist-патчем. Production enablement требует отдельного isolated runner ADR/implementation.
- **Практические действия:** W0 блокирует REPL/custom code в multi-user profile; sandbox worker — отдельный future lane.

### M-7 — SSRF coverage неполно

- **Вердикт:** подтвердить с уточнением масштаба.
- **Доказательства:** `ssrf_safe_get` вызывает `validate_url_for_ssrf`, но затем `requests.get(hostname)` делает повторный DNS resolve; `api_request.py` и `url.py` уже имеют pinned transports; `web_search.py`, `news_search.py` и другие components используют прямые clients.
- **Уточнение:** число «~10» не является стабильным контрактом; не каждый provider call принимает user-controlled URL.
- **Сохранить:** central egress policy, redirect validation и DNS pinning.
- **Практические действия:** AST/rg inventory классифицирует user-controlled/provider-fixed URLs; direct raw clients запрещаются policy test либо получают documented exception.

### M-8 — LFX compatibility lane отсутствует в CI

- **Вердикт:** подтвердить.
- **Доказательства:** `src/compat/lfx/tests/test_lfx_compatibility.py` и `check_s2_compatibility.py` не вызываются Make target/workflow; тест использует `git ls-tree` frozen commit.
- **Сохранить:** отдельный continuous/release lane.
- **Дополнить:** обычный CI проверяет committed manifest/aliases/imports без требования старой Git history; regeneration/audit job явно fetch-ит frozen commit и сверяет hash.
- **Практические действия:** workflow, wheel install-order matrix, release artifact, explicit fetch-depth.

### M-9 — F1-R и P2 в DAG

- **Вердикт:** подтвердить.
- **Сохранить:** barrier model.
- **Изменить:** `F1-E/K/J/S/O → F1-R → F1-W`; P2 имеет обязательные входы `K1 + S2`, где S2 уже включает E2/R2/Q1.
- **Практические действия:** один канонический DAG и machine-readable dependency register; dependent task не стартует при FAIL/BLOCKED.

## 7. Low

### L-1 — «974-module LFX corpus» якобы магическое число

- **Вердикт:** не подтвердить; исключить замечание.
- **Доказательства:** `src/compat/lfx/src/lfx_compat/module-map-v1.json` фиксирует `logical_modules: 974` и source commit; `test_lfx_compatibility.py` фиксирует `FROZEN_MODULE_COUNT = 974`.
- **Ошибка отчёта:** сравнивается frozen pre-cutover LFX inventory с текущим числом модулей KFX. Это разные величины.
- **Сохранить:** 974 как versioned compatibility contract LFX 1.10.2.
- **Практические действия:** manifest/hash — источник истины; изменение числа требует отдельного compatibility version/ADR, а не динамического пересчёта KFX.

### L-2 — Job call sites и dead method

- **Вердикт:** подтвердить.
- **Сохранить:** исправление fail-open legacy rows и nullable signature.
- **Изменить:** приоритет W0 — DB census, quarantine и `user_id` required; dead `JobService.get_jobs_by_flow_id` либо тестируется/исправляется, либо удаляется отдельным cleanup.
- **Практические действия:** static test запрещает `create_job` без actor; legacy migration evidence считает все NULL rows.

### L-3 — фактические job routes

- **Вердикт:** подтвердить.
- **Практические действия:** матрица использует `POST /api/v2/workflows`, `GET /api/v2/workflows?job_id=...`, `POST /api/v2/workflows/stop`; wire aliases фиксируются OpenAPI snapshot.

### L-4 — chat_id/session_id/context_id не разграничены

- **Вердикт:** подтвердить.
- **Практические действия:** `chat_id` — immutable conversation identity; `session_id` — legacy transport/memory grouping alias; `context_id` — optional application-defined memory partition; `run_id` — one generation/execution. Запрещено использовать одно поле как неявный alias другого после C1.

### L-5 — MemoryBase session identity immutable

- **Вердикт:** подтвердить.
- **Практические действия:** rename меняет только ChatThread title; legacy `session_id` и ingestion records не переписываются. Merge/split chats — отдельные commands, не rename.

### L-6 — ReactFlow v11 и XYFlow v12

- **Вердикт:** подтвердить.
- **Доказательства:** обе зависимости есть в `src/frontend/package.json`; source imports найдены только для `@xyflow/react`.
- **Практические действия:** dependency/import guard; удаление `reactflow` v11 — отдельный registrar-owned cleanup с lockfile/build/license evidence.

### L-7 — несуществующая frontend `features/` convention

- **Вердикт:** подтвердить.
- **Практические действия:** V1 использует существующие `pages/`, `components/core/`, `controllers/API/queries/` и stores; ввод `features/` требует отдельного ADR и не смешивается с Board delivery.

### L-8 — memory thresholds

- **Вердикт:** частично подтвердить; это не логическое противоречие, а неясная иерархия порогов.
- **Практические действия:** hard cap 16 ГиБ; throttle при 14; остановка необязательных процессов при 15.5; при фактическом RSS >16 запрещены новые agents/heavy jobs, работа только lightweight/read-only до освобождения памяти. Heavy jobs по умолчанию сериализуются.

### L-9 — число субагентов

- **Вердикт:** частично подтвердить.
- **Обоснование:** §6 требует минимум пять lanes; список B0 owners перечисляет только три специализированные роли и coordinator. Это не прямое противоречие, но handoff недоопределён.
- **Практические действия:** явно назначить минимум пять bounded baseline scopes: architecture/Graphify, backend/data, frontend, security/routes, tests/compatibility; запуск подчиняется memory guard и может быть staged, но deliverables остаются независимыми.

### L-10 — отсутствующая B0 telemetry baseline для R-34

- **Вердикт:** подтвердить.
- **Практические действия:** добавить B0-09: route/feature usage baseline, event schema, privacy/cardinality, minimum observation window; только после этого удалять legacy UI/routes.

### L-11 — план не самодостаточен

- **Вердикт:** подтвердить.
- **Практические действия:** новый план включает краткие определения R-01–R-40, disposition, owner, phase и gate; внешние документы остаются evidence, а не обязательным способом понять scope.

### L-12 — `make lint` изменяет окружение

- **Вердикт:** подтвердить.
- **Доказательства:** `lint: install_backend`, затем только `echo "No type checker configured"`.
- **Практические действия:** tooling contract помечает side effects; для evidence применяются прямые `uv run ruff/pytest/...` commands и отдельные frontend commands, пока реальный lint target не создан.

## 8. Хвосты аудита 10

### A10-1 — NoteNode → BoardNote conversion policy

- **Вердикт:** подтвердить.
- **Практические действия:** команды `copy_to_board_note`, `move_to_board_note`, `link_note_reference`; default — copy с preview. Flow NoteNode не удаляется автоматически; move требует подтверждения и новую Flow revision.

### A10-2 — filesystem save в bypass inventory

- **Вердикт:** подтвердить.
- **Доказательства:** flow filesystem helpers, agentic file tools и user-component writes существуют.
- **Практические действия:** инвентаризировать отдельно domain saves, user file management и code/component writes; назначить capability/risk/audit policy. Не заставлять обычную загрузку файла притворяться Flow mutation, но запрещать обход Command Kernel для изменения Flow/Project/Automation.

### A10-3 — enforced coverage threshold

- **Вердикт:** подтвердить.
- **Доказательства:** coverage генерируется, но `fail_under`/Jest threshold отсутствует.
- **Практические действия:** B0 фиксирует baseline; C1 утверждает ratchet; CI блокирует снижение; new command/security/state-machine code получает отдельный высокий diff-coverage и полный transition matrix.

### A10-4 — dirty OpenSwarm caveat

- **Вердикт:** подтвердить.
- **Практические действия:** provenance использует только committed tree `ab982af…`; dirty/untracked Graphify artifacts отмечаются и исключаются. Перед переносом кода создаётся чистый pinned checkout и SBOM/license ledger.

## 9. Перепроверка списка «verification passed»

| ID | Утверждение отчёта | Итог |
| --- | --- | --- |
| F-01 | `/api/v1/projects` использует Folder; `/folders` legacy redirect | Подтверждено; сохранить |
| F-02 | Flow без revision; FlowVersion snapshot; activate копирует data | Подтверждено; добавить deployment attachment contract |
| F-03 | Message.session_id non-null; chat_id отсутствует | Подтверждено |
| F-04 | `Job.created_at` defect | Подтверждено, но method сейчас не вызывается |
| F-05 | Job idempotency SELECT→INSERT неатомарна | Подтверждено |
| F-06 | NULL-owner read fail-open | Подтверждено; касается legacy rows и nullable APIs |
| F-07 | Job states не имеют requested/retry/lease/fencing | Подтверждено |
| F-08 | `make lint` — фактически no-op lint | Подтверждено; также запускает install_backend |
| F-09 | backend auto_apply и frontend skipAll существуют | Подтверждено |
| F-10 | Flow Editor использует global store/provider/hotkeys/fixed DOM id | Подтверждено; X-B обязателен |
| F-11 | Chat stream SSE; WebSocket относится к voice | Подтверждено для найденных current surfaces |
| F-12 | model registry/Alembic metadata и model_fields_set patterns пригодны | Подтверждено как reuse point |
| F-13 | virtual shared flow identity существует | Подтверждено; использовать в classifier, не как Chat identity |

## 10. Обновлённые приоритеты

### Немедленно до feature work

1. Baseline/evidence/tooling/telemetry freeze.
2. Security profiles и полный route/capability inventory.
3. Job ownership/idempotency floor.
4. MCP execute-time enforcement.
5. Agentic auto-apply/skip-all containment.
6. Webhook/OpenAI Responses/workflow/build/filesystem matrix.
7. REPL multi-user default-off; central egress inventory/pinning.

### До schema implementation

1. Domain ADR без новой Workspace table.
2. Identity contract chat/session/context/run.
3. Folder global uniqueness/system-role contract.
4. Flow revision + FlowVersion deployment attachment contract.
5. Chat body/files/trace/import/retention contract.
6. NoteNode conversion and filesystem capability contract.
7. Corrected DAG and self-contained R-01–R-40 trace.

### Отложить

- Parent-scoped duplicate Project names.
- Полноценную Workspace/organization entity.
- Несколько одновременно editable Flow Editors.
- CRDT/OT coediting.
- In-process REPL как допустимую multi-tenant sandbox.
- Scheduled processes до отдельного viability/security gate.

## 11. Итоговая оценка полезности отчёта

Отчёт 12 следует **сохранить как важный adversarial review**, но не выполнять буквально. Он правильно изменяет объём ранних security/data работ и выявляет настоящие пробелы плана 11. Его ошибочные или чрезмерные части — обязательная новая Workspace table, перенос `Message.files` в `ChatTurn`, предположение о deployment desynchronization, безусловный AUTO_LOGIN superuser bypass и отказ от frozen LFX count 974 — в новый мастер-план не переносятся.

Каноническим дальнейшим планом является [`14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`](14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md).
