# RaytSystem для Ketos: установка, аудит и направления применения

> Это первичный аудит самого инструмента. Актуальное состояние интеграции в
> корень Ketos и финальные проверки находятся в
> `RAYTSYSTEM_KETOS_CONFIGURATION_REPORT.md`.

**Дата проверки:** 2026-07-16  
**Ketos:** `redesign/sidebar-account` @ `572fad8ea2223e342508ecf095133091c7714e1b`  
**RaytSystem:** `main` @ `b5ac70560112758f78dd15852422ee697ac336f4`  
**Версия RaytSystem:** `0.1.0`, pre-1.0  
**Лицензия:** Apache-2.0  
**Локальный путь:** `/Volumes/Projects/ketos_canvas_mod_main/raytsystem`

## 1. Краткий вывод

RaytSystem успешно установлен и запущен как отдельный вложенный Git-репозиторий.
Локальный интерфейс доступен на `http://127.0.0.1:8765`. После инициализации
platform store, перестройки code graph и knowledge projections штатные проверки
`doctor` и `lint` проходят.

RaytSystem полезен Ketos прежде всего как:

1. локальный evidence-first workspace для архитектурных знаний, ADR, требований,
   результатов тестов и исследовательских выводов;
2. операционный слой для долговечных задач, зависимостей, запусков, review и
   checkpoint-гейтов;
3. источник готовых паттернов для безопасных AI-команд: preview, hash/revision
   binding, idempotency, scoped approval, immutable history и fail-closed policy;
4. дополнительный code graph и impact-analysis инструмент;
5. база для будущих KFX-компонентов, которые смогут обращаться к локальным
   QUERY/LINT/task/graph операциям.

RaytSystem не следует сейчас рассматривать как замену backend, Flow runtime,
KFX или Ketos Assistant. Внешнее выполнение моделей, Codex/Claude adapters,
внешний MCP и внешние эффекты в поставляемой конфигурации отключены. Сам проект
не заявляет production readiness.

## 2. Что установлено и проверено

Выполнены:

```bash
git clone https://github.com/romarayt/raytsystem-public-os.git raytsystem
cd raytsystem
uv sync --dev
uv run raytsystem doctor
uv run raytsystem start
```

Дополнительно выполнены штатные операции первого запуска:

```bash
uv run raytsystem graph rebuild --root /Volumes/Projects/ketos_canvas_mod_main/raytsystem --json
uv run raytsystem rebuild-index --root /Volumes/Projects/ketos_canvas_mod_main/raytsystem --json
uv run raytsystem lint --json
```

Финальное состояние:

| Проверка | Результат |
|---|---|
| `uv sync --dev` | PASS, Python 3.12.13, 50 пакетов |
| `raytsystem start` | PASS, `127.0.0.1:8765` |
| HTTP smoke | PASS, `200 OK` |
| Loopback boundary | PASS, listener только на `127.0.0.1` |
| `raytsystem doctor --json` | PASS, `healthy: true` |
| Code graph | `current`, 354 файла, 5 388 узлов, 22 857 ребер |
| `raytsystem lint --json` | PASS, findings отсутствуют |
| `uv run ruff check .` | PASS |
| `uv run mypy` | PASS, 141 source-файл |
| `uv run pytest -q` | PASS, 736 passed, 3 skipped |

Первый `doctor` честно завершился с `healthy: false`: отсутствовали code graph и
инициализированный platform store. `start` инициализировал platform store, затем
полная перестройка graph и projections довела диагностику до `healthy: true`.

Предупреждение `uv` о невозможности hardlink на внешнем диске не является
ошибкой: зависимости скопированы вместо hardlink. Размер `.venv` после установки
составляет около 140 MB, runtime-плоскости `.raytsystem` — около 51 MB.

Пока UI запущен, вложенный репозиторий показывает untracked runtime lock
`ops/skill-authoring-recovery/writer.lock`. Это локальное операционное состояние
активного процесса, а не изменение исходного кода; добавлять его в Git не нужно.

## 3. Что представляет собой RaytSystem

RaytSystem — локальная self-hosted система управления:

- документами и источниками;
- доказательствами, claims и provenance;
- канонической базой знаний;
- производными knowledge/code graphs;
- задачами, зависимостями и immutable history;
- агентами, skills и разрешениями;
- запусками, traces, replay и review;
- workflow DAG;
- approvals, policies, circuit breakers и emergency controls;
- backup/export/restore.

Архитектурный принцип системы:

```text
source bytes
  -> stable evidence
  -> supported claim
  -> knowledge projection
  -> task / skill / agent / run
  -> reviewable artifact
```

Импортированный Markdown, код, transcript, OCR и другие данные считаются
недоверенными данными, а не инструкциями для агента. Каноническое знание не
изменяется прямым редактированием generated-файлов.

## 4. Текущие ограничения

В поставляемой конфигурации выключены:

- реальное runtime-исполнение агентов;
- Codex local adapter;
- Claude Code adapter;
- внешнее выполнение MCP;
- внешние уведомления;
- OTLP export;
- A2A network exposure;
- remote Promptfoo generation;
- external KMS и restricted encryption.

Следовательно, наличие раздела в UI или adapter definition не доказывает, что
внешняя возможность реально работает.

Дополнительные ограничения:

- версия pre-1.0, опубликован только начальный snapshot;
- готовые desktop installers отсутствуют;
- часть Documents, Tool Hub, workflow и recovery функций экспериментальна;
- provider adapters пока в основном являются контрактами;
- graph содержит 3 878 ambiguous edges и много unresolved references, поэтому
  он пригоден как навигационная проекция, но не как каноническая истина;
- перенос кода в Ketos требует соблюдения Apache-2.0 и NOTICE.

## 5. Skills RaytSystem

В репозитории находятся десять основных skills.

| Skill | Что делает | Применение в Ketos |
|---|---|---|
| `start` | Установка, bootstrap preview/apply, запуск UI | Безопасное подключение workspace |
| `graph` | Status/update/rebuild/query/impact code graph | Архитектурная навигация и impact analysis |
| `raytsystem-ingest` | Подготовка, валидация и контролируемое продвижение источников | Импорт ADR, требований, отчетов, контрактов |
| `raytsystem-query` | Evidence-bound ответы с verified citations или explicit gap | Вопросы по решениям, требованиям и накопленным выводам |
| `raytsystem-lint` | Проверка целостности, provenance, links, secrets и projections | Gate для базы знаний и evidence packs |
| `raytsystem-save` | Сохранение синтеза как DRAFT, без автоматической публикации | Черновики архитектурных решений и итогов аудита |
| `raytsystem-research` | Исследование с provenance, противоречиями и gaps | Анализ библиотек, конкурентов, лицензий, API |
| `raytsystem-run-review` | Независимый review run/diff/contract/checkpoint | Проверка этапов плана Ketos |
| `raytsystem-security-review` | Threat-model review и adversarial checks | AI-команды, MCP, KFX, ingest, path/secret boundaries |
| `raytsystem-watch` | Анализ видео, transcript, OCR и timeline через typed Tool Hub | Разбор UX-записей и превращение demo в requirements |

В `.agents/skills/` и `.claude/skills/` находятся адаптеры для соответствующих
agent hosts. Они маршрутизируют запрос к каноническим skills и сами по себе не
включают внешнее выполнение.

## 6. Состояние базы знаний

Каноническая knowledge base после установки пуста:

| Объект | Количество |
|---|---:|
| Claims | 0 |
| Entities | 0 |
| Sources | 0 |
| Knowledge graph nodes | 0 |
| Knowledge graph edges | 0 |

Активная generation — `genesis`.

Штатный запрос:

```text
Что каноническая база знаний raytsystem уже знает о проекте Ketos?
```

вернул explicit gap:

```text
No supported claim in the active generation matches this query.
```

Это правильное fail-closed поведение. RaytSystem не использует собственную
документацию или model memory как подмену импортированным проверяемым знаниям.

Нужно различать:

- `knowledge/` — канонические verified knowledge projections;
- `.raytsystem/graph/` — перестраиваемый code graph;
- `docs/` и `website/` — документация самого RaytSystem;
- Documents index — навигация по разрешенным Markdown roots;
- task/run/platform stores — операционное состояние, не knowledge corpus.

## 7. Совпадение с потребностями Ketos

### 7.1 Безопасные AI-команды

Требования Ketos R-10–R-15 и план P6 требуют:

- typed command registry;
- base revision;
- authoritative preview/diff;
- risk classification;
- one-time confirmation;
- apply-once transaction;
- provenance и rollback;
- запрет произвольного backend path.

RaytSystem уже содержит близкие паттерны:

- operation fingerprint;
- generation/hash binding;
- idempotency;
- approval records;
- policy simulation;
- stale-state rejection;
- immutable event history;
- DRAFT before promotion;
- explicit external-action boundaries.

Наиболее ценное применение — использовать RaytSystem как reference
implementation и источник test scenarios для Ketos Command Gateway, а не
переносить его runtime целиком.

### 7.2 Аудит, R-37 и контроль изменений

Ketos требует журналировать создание, изменение, запуск, preview, confirmation,
отказ и rollback Automation. RaytSystem дает практические модели:

- task ledger;
- run summary;
- trace hierarchy;
- approval record;
- policy decision;
- replay/fork;
- immutable event chain;
- checkpoint guard.

Эти модели можно сопоставить с будущими Ketos `Proposal`, `Execution`,
`AuditEvent` и `FlowVersion`.

### 7.3 R-39: capability, policy и внешние эффекты

RaytSystem полезен как проверяемый пример default-deny:

- network default `none`;
- external actions требуют scoped approval;
- MCP по умолчанию catalog-only;
- destination allowlists пусты;
- запрещенные egress/publish/delete/payment границы разделены;
- circuit breakers контролируют ошибки, длительность, token spike,
  protected paths и policy violations.

Для Ketos это применимо к:

- MCP-компонентам;
- custom Python components;
- файловым компонентам;
- сетевым loaders/tools;
- расписаниям;
- AI-командам запуска Automation;
- операциям publish/export/delete.

### 7.4 Архитектурные знания и evidence packs

В Ketos уже существуют:

- требования и архитектурные аудиты;
- localization governance;
- Graphify graph;
- планы и stage reports;
- тестовые доказательства;
- KFX и compatibility contracts.

RaytSystem может связать их в provenance-first модель:

```text
требование
  -> source/evidence
  -> архитектурное решение
  -> задача этапа
  -> измененные файлы
  -> test run
  -> review
  -> итоговый artifact
```

Это особенно полезно для длинных многоэтапных работ, где исторический PASS не
должен автоматически означать текущую live readiness.

### 7.5 Code graph и impact analysis

Ketos уже использует Graphify. RaytSystem не должен его автоматически заменять.
Возможна полезная двухслойная схема:

- Graphify — широкая persistent knowledge map и cross-document navigation;
- RaytSystem code graph — локальный disposable graph, freshness gate, impact и
  execution-workspace binding.

Материальные выводы в обоих случаях должны подтверждаться исходниками и тестами.

## 8. Практические кейсы

### Кейс 1. Архитектурная память Ketos

Загрузить в контролируемый corpus:

- `01_KETOS_REQUIREMENTS.md`;
- `02_KETOS_CURRENT_ARCHITECTURE_AUDIT.md`;
- `04_KETOS_CRITICAL_ARCHITECTURE_REPORT.md`;
- `05_KETOS_IMPLEMENTATION_PLAN.md`;
- ключевые ADR;
- KFX/API/Flow compatibility contracts;
- stage reports и финальные evidence packs.

Результат:

- вопросы по требованиям возвращают source-bound ответы;
- противоречия между планом и текущим состоянием становятся видимыми;
- новые выводы сохраняются как DRAFT до review;
- устаревшие claims можно помечать, а не молча заменять.

### Кейс 2. Stage-gate control plane

Каждый этап P0–P10 представить как task с dependencies и явными transitions.
Run хранит:

- commit и dirty state;
- graph snapshot;
- выбранный skill;
- тестовые команды;
- artifacts;
- review result;
- blocker/approval.

Польза:

- меньше ложных PASS;
- видна причина BLOCKED;
- повторный запуск можно сравнить с предыдущим;
- checkpoint привязан к конкретному состоянию репозитория.

### Кейс 3. Независимый review перед merge/publish

Использовать `run-review` и `security-review` как процедуру:

1. writer формирует изменение;
2. reviewer получает минимальный diff и contracts;
3. security reviewer проверяет path, secret, egress, idempotency и recovery;
4. итоговый gate сохраняется отдельно от writer context.

Это хорошо сочетается с существующими Ketos skills:

- `backend-code-review`;
- `frontend-code-review`;
- `frontend-testing`;
- `e2e-testing`;
- `component-refactoring`;
- `frontend-query-mutation`.

RaytSystem добавляет над ними orchestration/evidence слой, а не заменяет
специализированные review skills.

### Кейс 4. Reference для Ketos Command Gateway

Использовать schemas и tests RaytSystem при проектировании:

- `ProposalRequest`;
- `ApprovalRecord`;
- `PolicyDecision`;
- `Run`;
- `TraceRecord`;
- `GitCheckpointEvent`;
- `Workflow`;
- `TaskEvent`;
- `CircuitBreaker`.

Не копировать схемы без адаптации: домен Ketos должен сохранить Flow/KFX
contracts и собственную модель actor/workspace/project/board/automation.

### Кейс 5. KFX-компоненты для локального knowledge workspace

После отдельного POC можно создать KFX-компоненты:

- `RaytSystemQuery`;
- `RaytSystemGraphQuery`;
- `RaytSystemGraphImpact`;
- `RaytSystemLint`;
- `RaytSystemTaskCreate`;
- `RaytSystemTaskTransition`;
- `RaytSystemDraftSave`.

Правильная первая версия — локальный typed adapter с allowlisted операциями,
таймаутами, фиксированным root и без arbitrary shell. Имена классов после
публикации нельзя переименовывать, потому что это persisted KFX identifiers.

MCP-интеграцию следует рассматривать позже: внешний MCP execution RaytSystem
сейчас выключен, а Ketos уже имеет собственный MCP transport и session manager.

### Кейс 6. Security regression corpus

Перенести не код, а сценарии:

- prompt injection в imported docs;
- symlink/hardlink/path escape;
- secret leakage;
- stale revision/approval;
- duplicate idempotency key;
- partial commit/crash recovery;
- unauthorized network/process/outbox/Git effect;
- archive/PDF containment;
- SQL/FTS injection;
- oversized inputs и resource limits.

Эти сценарии применимы к KFX loaders, MCP tools, Assistant, будущему Command
Gateway, Documents и artifact storage.

### Кейс 7. Исследование внешних репозиториев и лицензий

`research -> proposal -> validate -> ingest` подходит для:

- OpenSwarm и других UI/reference repos;
- новых LLM/MCP providers;
- workflow engines;
- vector/graph storage;
- security advisories;
- лицензионных и provenance-решений.

Польза — отделение source statement, inference, contradiction и missing
evidence, что снижает риск превращения маркетингового README в архитектурный
факт.

### Кейс 8. Разбор видео UX и demo

`raytsystem-watch` может превращать запись интерфейса в:

- transcript;
- timeline;
- список показанных действий;
- OCR и visual observations;
- automation brief;
- перечень gaps и неопределенностей.

Для Ketos это полезно при анализе референсов, баг-репортов и пользовательских
сессий. Сейчас этот кейс имеет более низкий приоритет, потому что Tool Hub
экспериментален и требует отдельной проверки локальных media executors.

## 9. Три стратегии использования

### Стратегия A — sidecar dev-workspace

**Рекомендация для первого пилота.**

RaytSystem остается отдельным инструментом разработки и не становится
зависимостью Ketos runtime.

Плюсы:

- минимальный риск для продукта;
- можно использовать tasks, graph, reviews и documents;
- легко удалить;
- не меняются API/KFX/Flow contracts.

Минусы:

- отдельный UI и storage;
- часть данных придется синхронизировать процессом;
- canonical knowledge нужно отдельно наполнять.

### Стратегия B — локальный Ketos adapter/KFX bridge

Ketos вызывает ограниченный набор локальных операций RaytSystem.

Плюсы:

- knowledge/query/lint доступны в визуальных flows;
- можно строить internal developer workflows;
- сохраняется локальный контур.

Минусы:

- потребуется versioned adapter contract;
- нужно исключить arbitrary shell/root;
- появляется lifecycle двух Python-систем;
- pre-1.0 изменения RaytSystem могут ломать bridge.

### Стратегия C — перенос архитектурных паттернов в Ketos

Ketos реализует собственные Proposal/Approval/Policy/Trace/Task модели, используя
RaytSystem как reference и test corpus.

Плюсы:

- лучшая интеграция с единым backend Ketos;
- соответствие требованиям AC-03 и AC-04;
- отсутствие второго product runtime.

Минусы:

- максимальная стоимость реализации;
- нельзя копировать модели без доменной адаптации;
- нужен отдельный migration и compatibility plan.

Рекомендуемая комбинация: начать со стратегии A, параллельно заимствовать
паттерны стратегии C. Стратегию B делать только после короткого POC.

## 10. Почему bootstrap в Ketos пока не применен

Выполнен только безопасный dry-run:

```bash
uv run raytsystem bootstrap \
  --target /Volumes/Projects/ketos_canvas_mod_main \
  --dry-run \
  --json
```

Preview определил Ketos как mixed software/Graphify/Markdown workspace:

- Git repo с 9 276 code files;
- 333 Markdown и 12 text-файлов;
- существующий `graphify-out/graph.json`;
- package manifests `package.json` и `pyproject.toml`.

Причины не выполнять `--apply`:

1. рабочее дерево Ketos грязное;
2. существуют конфликты с `AGENTS.md`, `CLAUDE.md` и `README.md`;
3. план хочет создать root-level config, skills, workflow, task и hook files;
4. source map включает сам `raytsystem`, что создаст self-indexing;
5. в Ketos уже есть специализированные `.agents/skills`, и их нельзя затереть
   generic software-template skills;
6. fingerprint bootstrap должен быть свежим и подтвержден отдельной командой.

План dry-run хотел создать, среди прочего:

- `.agents/skills/{start,graph}/SKILL.md`;
- `.claude/skills/{start,graph}/SKILL.md`;
- `.githooks/pre-commit`;
- root-level `config/*`;
- `WORK.md`;
- `docs/INIT-DOCTOR.md`;
- `knowledge/manual/.gitkeep`;
- `packs/software/*`;
- `skills/skill_{builder,reviewer,security_reviewer,tester}`;
- `tasks/software-sample.json`;
- `workflows/software.yaml`.

Автоматическое применение такого плана в текущем checkout было бы слишком
широким изменением.

## 11. Безопасный план пилота

### Этап 1. Изолированный bootstrap

1. Создать чистый linked worktree или disposable clone Ketos.
2. Держать RaytSystem вне scan root либо добавить явное исключение.
3. Исключить generated/runtime paths:
   - `raytsystem/`;
   - `.venv/`;
   - `.raytsystem/`;
   - `graphify-out/` как code source;
   - build/cache/node_modules;
   - secrets и local databases.
4. Повторить fresh `bootstrap --dry-run`.
5. Сравнить создаваемые files с существующими repo skills и hooks.
6. Применить только после отдельного review и подтверждения fingerprint.

### Этап 2. Knowledge pilot

Начать с ограниченного корпуса из 10–20 документов:

- требования;
- архитектурный аудит;
- текущий implementation plan;
- KFX/extension contracts;
- security policy;
- 2–3 stage reports;
- 2–3 ADR.

Проверить:

- QUERY citation closure;
- explicit gaps;
- LINT;
- stale claim handling;
- rebuild и backup/restore;
- отсутствие secret/path leakage.

### Этап 3. Operational pilot

Завести один ограниченный этап, например P0 prototype:

- tasks с dependencies;
- graph snapshot;
- test evidence;
- run review;
- security review;
- PASS/BLOCKED/FAIL gate.

Сравнить трудозатраты и качество с текущим Markdown-only процессом.

### Этап 4. KFX POC

Сделать один read-only компонент `RaytSystemQuery` или
`RaytSystemGraphImpact`. Не добавлять task mutation, SAVE или MCP до прохождения:

- root confinement;
- timeout/cancellation;
- output schema;
- concurrency;
- version pinning;
- security review;
- KFX persisted-class compatibility.

## 12. Как я могу использовать RaytSystem в работе над Ketos

До реализации:

- проверять graph freshness;
- получать bounded architecture/impact context;
- собирать research evidence;
- фиксировать requirements и gaps;
- строить dependency-aware task plan.

Во время реализации:

- связывать задачу, commit, graph snapshot и test evidence;
- выполнять preflight и policy simulation;
- хранить промежуточные checkpoints;
- отделять DRAFT от canonical decision;
- не допускать повторного применения операции.

После реализации:

- запускать independent run review;
- выполнять security review;
- проверять knowledge integrity;
- формировать evidence pack;
- сравнивать replay/повторный run;
- делать backup перед migration/cutover.

Прямо сейчас я могу использовать репозиторий как:

1. источник процедур и test scenarios;
2. локальный UI/CLI для его собственного workspace;
3. code graph для анализа самого RaytSystem;
4. reference при проектировании Ketos Command Gateway;
5. основу для подготовленного, но пока не примененного Ketos bootstrap pilot.

Я не могу честно использовать его как уже работающий автономный agent runtime
Ketos, потому что runtime adapters и external MCP execution выключены.

## 13. Приоритеты

| Направление | Польза | Стоимость | Риск | Приоритет |
|---|---:|---:|---:|---:|
| Evidence/architecture workspace | Высокая | Низкая-средняя | Низкий | P0 |
| Stage tasks и run reviews | Высокая | Средняя | Низкий | P0 |
| Security regression patterns | Высокая | Средняя | Низкий | P0 |
| Command Gateway reference | Очень высокая | Средняя | Средний | P0 |
| Dual Graphify/Rayt graph workflow | Средняя | Низкая | Низкий | P1 |
| Read-only KFX query/impact adapter | Средняя-высокая | Средняя | Средний | P1 |
| Full bootstrap текущего checkout | Средняя | Средняя | Высокий сейчас | BLOCKED |
| RaytSystem как runtime Ketos | Низкая сейчас | Высокая | Высокий | Не рекомендовано |
| Media Tool Hub | Средняя | Средняя | Средний | P2 |

## 14. Итоговая рекомендация

RaytSystem стоит сохранить в проектном окружении как исследованный sidecar и
reference implementation. Наибольшая ценность для Ketos — не его UI сам по
себе, а сочетание:

- provenance-first knowledge;
- explicit gaps;
- durable task/run history;
- graph freshness;
- preview/approval/idempotency;
- independent review;
- fail-closed external boundaries;
- recovery и backup primitives.

Не следует немедленно применять root bootstrap в текущем грязном checkout или
делать RaytSystem runtime-зависимостью продукта. Правильный следующий шаг —
изолированный pilot в чистом worktree с ограниченным corpus, без self-indexing
и без замены существующих Ketos skills/hooks.
