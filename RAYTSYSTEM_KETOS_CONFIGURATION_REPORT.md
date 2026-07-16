# RaytSystem для Ketos: итоговая конфигурация и аудит

**Дата:** 2026-07-16  
**Ketos:** `redesign/sidebar-account` @ `572fad8ea2223e342508ecf095133091c7714e1b`  
**RaytSystem upstream checkout:** `b5ac70560112758f78dd15852422ee697ac336f4`  
**Интерфейс:** `http://127.0.0.1:8765`  
**Статус:** PASS

## 1. Итог

RaytSystem установлен как editable uv tool и полноценно подключён к корню
Ketos:

```text
/Volumes/Projects/ketos_canvas_mod_main
```

Открытый локальный интерфейс теперь работает с Ketos, а не с репозиторием
самого RaytSystem. Сервер привязан только к `127.0.0.1:8765`.

Выбрана гибридная схема:

- Graphify остаётся существующей широкой persistent-картой проекта;
- RaytSystem ведёт отдельный локальный disposable code graph;
- документация Ketos индексируется read-only;
- `knowledge/manual` является единственным writable Documents root;
- runtime-агенты и внешние действия выключены fail-closed;
- каталог и workflows настроены под существующие правила и skills Ketos.

Graphify не перестраивался и `graphify-out/` не изменялся.

## 2. Что установлено

Команда установлена отдельно от Python workspace Ketos:

```bash
uv tool install --editable /Volumes/Projects/ketos_canvas_mod_main/raytsystem
```

Использование:

```bash
raytsystem doctor --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem graph status --root /Volumes/Projects/ketos_canvas_mod_main --json
raytsystem lint --root /Volumes/Projects/ketos_canvas_mod_main --json
```

Запуск интерфейса:

```bash
raytsystem start \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --host 127.0.0.1 \
  --port 8765 \
  --no-open
```

## 3. Code graph

Настроенный RaytSystem graph содержит:

| Метрика | Значение |
|---|---:|
| Файлы | 3 904 |
| Узлы | 27 782 |
| Рёбра | 88 488 |
| Ambiguous edges | 19 233 |
| Unresolved references при сборке | 94 478 |
| Состояние | `current` |

В corpus включены:

- `src/backend/base/ketos`, кроме bundled frontend assets;
- `src/frontend/src`;
- `src/kfx/src/kfx`, кроме generated `_assets`;
- `src/bundles`;
- `scripts`;
- localization governance;
- engineering specs и plans;
- основные root-контракты и аудиты.

Два крупных generated-файла исключены намеренно:

- `src/backend/base/ketos/frontend/assets/index-BeyErzOO.js`;
- `src/kfx/src/kfx/_assets/component_index.json`.

Граф пригоден для поиска, bounded context, neighbors, path и impact analysis.
Из-за высокой неоднозначности он не является канонической истиной: существенные
выводы должны подтверждаться текущим исходным кодом и тестами.

Пример:

```bash
raytsystem graph query \
  "Как устроены backend API, frontend canvas и KFX components в Ketos?" \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --depth 2 \
  --json
```

## 4. Graphify

Graphify уже был настроен и оставлен без изменений. Read-only запрос к
существующему graph успешно вернул связи frontend canvas, API и KFX.

Текущий Graphify сообщает, что graph использует старую, pre-`#1504`, схему
node ID. Это не блокирует запросы. Полный rebuild нужен только отдельной задачей,
если потребуется убрать same-name-file collisions; RaytSystem не должен
инициировать его автоматически.

Распределение ответственности:

| Инструмент | Основная роль |
|---|---|
| Graphify | широкая карта репозитория и cross-document навигация |
| RaytSystem graph | свежесть, bounded query, impact и binding к workspace |
| Исходный код и тесты | окончательное доказательство |

## 5. Documents и knowledge

Documents index:

| Метрика | Значение |
|---|---:|
| Документы | 27 |
| Ошибки индексирования | 0 |
| Состояние после rebuild | `current` |

Read-only roots:

- `docs/docs`;
- `docs/localization/ru`;
- `docs/superpowers`.

Writable root:

- `knowledge/manual`.

Добавлены:

- `knowledge/manual/README.md`;
- `knowledge/manual/ketos-workspace.md`.

Каноническая knowledge generation остаётся `genesis` с нулём claims, sources и
entities. Это правильное безопасное состояние: требования, архитектурные
отчёты и планы пока доступны как документы и graph context, но не были молча
превращены в verified claims.

Продвижение реального corpus в каноническую базу знаний должно быть отдельной
задачей с выбором источников, validation и ручным hash-bound approval.

## 6. Каталог Ketos Engineering

Создан pack `Ketos Engineering` с четырьмя skills:

1. `skill_builder` — scoped implementation с правилами Ketos и focused tests;
2. `skill_reviewer` — frontend/backend review через существующие repo skills;
3. `skill_tester` — Jest/RTL, Playwright, backend/KFX gates и честный
   PASS/BLOCKED/FAIL;
4. `skill_security_reviewer` — paths, secrets, MCP, network, approvals,
   idempotency и recovery.

Определены четыре соответствующих агента:

- Ketos Builder;
- Ketos Reviewer;
- Ketos Tester;
- Ketos Security Reviewer.

Все агенты `enabled: false`, используют `adapter_disabled` и не имеют runtime
capabilities. Это каталог процедур, а не скрытое выполнение моделей.

Существующие Codex skills Ketos не копировались. RaytSystem reviewer/tester
явно маршрутизируют работу в:

- `.agents/skills/frontend-code-review`;
- `.agents/skills/backend-code-review`;
- `.agents/skills/frontend-testing`;
- `.agents/skills/e2e-testing`.

## 7. Политика безопасности

Настроены:

- `network_default: none`;
- `workspace_default: staging_only`;
- approval для send/publish/upload/delete/pay/git push/pull request;
- redaction перед model egress;
- запрет reviewer-ролям на write/worktree/promotion/external action/secret;
- catalog-only MCP;
- circuit breakers для protected paths, policy violations, retry loops,
  token spikes и зависших runs.

Отключены:

- runtime execution;
- Codex local invocation bridge;
- Claude Code invocation bridge;
- Hermes и OpenHands runtime;
- external MCP execution;
- A2A network exposure;
- external notifications;
- OTLP export;
- external KMS и restricted encryption.

Contracts адаптеров видны в UI, но не выдают реальные разрешения.

## 8. Локальные исправления RaytSystem

Реальный corpus Ketos выявил два дефекта upstream checkout:

1. worker отклонял пустые source-файлы из-за запрета `size_bytes = 0`;
2. node ID вычислялся до sanitization qualified name, из-за чего путь
   `@jsonquerylang` приводил к forged-node-ID fail-closed.

Исправления сделаны TDD:

- добавлен тест на пустой `__init__.py`;
- добавлен тест на согласованность sanitized qualified name и node ID;
- worker принимает неотрицательный размер файла;
- ID строится из безопасного qualified name;
- extractor version локально поднята до `1.2.1`.

Эти изменения находятся во вложенном, игнорируемом checkout `raytsystem/`.
Они не являются подтверждённым upstream release. Перед upgrade/reclone нужно
проверить наличие эквивалентных исправлений либо сохранить локальный patch.

## 9. Git и hooks

Bootstrap создал `.githooks/pre-commit` с `raytsystem guard-checkpoint`, но
`core.hooksPath` намеренно не переключён. В проекте уже есть собственная
`.pre-commit-config.yaml`; скрыто заменять существующий hook pipeline было бы
небезопасно.

Checkpoint можно запускать явно:

```bash
raytsystem guard-checkpoint \
  --root /Volumes/Projects/ketos_canvas_mod_main \
  --json
```

Текущий checkpoint: PASS, findings отсутствуют.

## 10. Проверки

| Проверка | Результат |
|---|---|
| `raytsystem doctor` | PASS, `healthy: true` |
| `raytsystem status` | PASS, platform `ready` |
| `graph status --verify` | PASS, `current`, changed files `0` |
| `raytsystem lint` | PASS, findings `0` |
| `guard-checkpoint` | PASS, findings `0` |
| Documents rebuild | PASS, 27 files, errors `0` |
| HTTP session | PASS, `local_only: true` |
| UI listener | PASS, только `127.0.0.1:8765` |
| Catalog API | PASS, 1 pack, 4 skills, 4 agents |
| `uv run ruff check .` | PASS |
| `uv run mypy` | PASS, 141 source files |
| `uv run pytest -q` | PASS, 738 passed, 3 skipped |
| Graphify read-only query | PASS |
| `graphify-out` modifications | отсутствуют |

## 11. Как применять в Ketos

### Кейс A. Архитектурная навигация перед изменением

Перед задачей:

1. Graphify даёт широкую карту;
2. RaytSystem query сужает контекст и показывает impact;
3. инженер подтверждает выводы по исходникам;
4. task фиксирует scope и acceptance;
5. checkpoint и тесты закрывают работу.

### Кейс B. Долговечные stage-задачи

RaytSystem может хранить этапы как задачи с dependencies, review и evidence:

```text
requirement -> task -> changed files -> tests -> review -> checkpoint
```

Это снижает риск, что исторический PASS будет ошибочно принят за текущую live
readiness.

### Кейс C. Поиск по проектной документации

Documents уже индексирует API docs, KFX docs, localization governance и
engineering plans. Это можно использовать для поиска решений без смешивания
read-only product docs с writable рабочими заметками.

### Кейс D. Безопасные AI-команды и MCP

RaytSystem полезен как reference implementation для будущего Ketos Command
Gateway:

- preview до apply;
- revision/hash binding;
- idempotency;
- scoped approval;
- default deny;
- immutable audit;
- stale-state rejection;
- recovery и circuit breakers.

### Кейс E. Независимый review pipeline

Workflow Builder → Reviewer → Tester → Security Reviewer можно использовать как
формальную модель handoff даже до включения runtime agents. Каждый этап имеет
собственную процедуру и не подменяет другой.

### Кейс F. Evidence-first база знаний

Следующим этапом можно выборочно ingest:

- требования Ketos;
- архитектурные аудиты;
- API/KFX contracts;
- ADR;
- stage reports;
- test evidence.

После validation они смогут отвечать как source-bound claims, а не как
непроверенные заметки.

## 12. Ограничения и следующие решения

1. Runtime agents не включены. Для их включения нужен отдельный security design
   адаптера, sandbox, egress destination, approval и regression tests.
2. Canonical knowledge пуста. Автоматический ingest не выполнялся намеренно.
3. RaytSystem graph имеет много ambiguous/unresolved связей; использовать его
   нужно как навигацию, не как доказательство.
4. Documents index имеет встроенное короткое freshness window; rebuild доступен
   из UI/API, а при старте сервера stale index перестраивается.
5. Два compatibility fixes локальны и должны быть либо отправлены upstream,
   либо сохранены при обновлении.
6. Graphify можно позже отдельно пересобрать на новой node-ID схеме, но текущая
   настройка работоспособна.
7. Прямое управление Chrome/Computer Use в этой сессии было недоступно без
   обязательного `node_repl`. Поэтому UI не кликался через GUI; вместо этого
   корень workspace, session, Documents, catalog, tasks, safety и listener
   проверены через локальные HTTP API и CLI. Открытая вкладка должна обновиться
   на Ketos после reload.

## 13. Рекомендуемый следующий этап

Наиболее полезное продолжение — не включать агентов сразу, а создать первый
реальный evidence pack:

1. выбрать 3–5 канонических документов требований и архитектуры;
2. выполнить controlled ingest prepare/validate;
3. проверить contradictions и gaps;
4. создать одну реальную stage-задачу Ketos;
5. провести её по Builder → Reviewer → Tester → Security Reviewer;
6. только после этого решить, нужен ли локальный Codex runtime adapter.
