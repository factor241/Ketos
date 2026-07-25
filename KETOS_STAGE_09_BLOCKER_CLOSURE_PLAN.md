# Ketos Stage 09 — план закрытия блокеров, ошибок и финальной приёмки

Дата составления: 2026-07-22

Репозиторий: `/Volumes/Projects/ketos_canvas_mod_main`

Рабочий checkout реализации: `/Volumes/Projects/ketos-mvp-stage09-integration`

Этап: Stage 09 — Restart / Replay / Idempotency

Исходный план: `23_KETOS_STAGE_09_RESTART_REPLAY_IDEMPOTENCY.md`

Следующий этап: **не начинать**

## 1. Назначение документа

Этот документ задаёт последовательный план закрытия всех известных блокеров,
незавершённых проверок и возможных ошибок Stage 09. Он не является отчётом о
PASS и не разрешает переход к следующему этапу.

План должен выполняться циклом:

```text
анализ
  → воспроизведение RED
  → минимальное TDD-исправление
  → focused-проверка
  → package-проверка
  → независимый аудит
  → исправление замечаний
  → полный повторный acceptance-run
  → immutable evidence
```

## 2. Обязательные правила выполнения

1. Сначала повторно прочитать `AGENTS.md` и исходный план Stage 09.
2. Сохранять unrelated dirty state; не очищать и не восстанавливать чужие
   изменения широкими Git-командами.
3. Не изменять generated artifacts, lock-файлы, deployment configuration,
   `LICENSE` и `NOTICE`, если конкретная ошибка прямо этого не требует и scope
   этапа не разрешает такое изменение.
4. Только главный агент использует shell, Git, Graphify, RaytSystem, браузер,
   Computer Use, навыки, MCP, тестовые команды и файловые инструменты.
5. Субагенты работают только с переданными им самодостаточными пакетами:
   source slices, diff, Graphify-результатами, логами, screenshots и критериями.
6. При нехватке материала субагент возвращает `BLOCKED: missing context` и не
   делает предположений.
7. Graphify используется как карта связей. Источниками истины остаются текущий
   исходный код, Git diff, тесты и evidence.
8. Graphify нельзя перестраивать как побочный эффект этой работы.
9. Для внешней технической информации использовать официальную документацию;
   Context7 не использовать.
10. Любое изменение product/test/runbook/schema/finalizer-кода создаёт новый
    candidate SHA и инвалидирует предыдущий финальный acceptance-run.
11. Stage 10 не запускать ни при каком промежуточном результате.

## 3. Текущее доказанное состояние

Состояние ниже является snapshot на момент остановки текущей работы.

| Объект | Состояние | Доказательство / значение |
|---|---|---|
| Stage 08 | `PASS` | Exact SHA `79c2c1ffb2eca0eac7672a092f6df7806f531b37` |
| Stage 08 bundle | `PASS` | Повторно проверено 130 файлов; missing/hash/size mismatch — 0 |
| Stage 09 candidate | готов к повторной проверке | SHA `c6c96276ccbbda22b18741a8f36a6f355d0382da` |
| Candidate worktree | clean на момент остановки | Unrelated dirty state не затрагивался |
| Focused backend | `PASS` | 96 тестов |
| Restart integration | `PASS` | 1 тест |
| Реальный restart smoke | `PASS` | PID изменился `55539 → 56077` |
| Logger regression | `PASS` | 99 тестов |
| Focused frontend | `PASS` | 15 suites / 83 tests |
| i18n | `PASS` | Exit 0 |
| Production TypeScript | `PASS` | Exit 0 |
| Backend package | `INCOMPLETE` | Остановлен пользователем на 44 из 188 targets |
| Full frontend | `NOT COMPLETED` | Финального package-level результата нет |
| Playwright | `NOT COMPLETED` | Нет финального trace/screenshots |
| Workflow compatibility | `NOT COMPLETED` | Итоговый compatibility gate не выполнен |
| Final scope/no-write | `NOT COMPLETED` | Нет post-run доказательства неизменности checkout |
| Immutable evidence | `BLOCKED` | Не утверждён точный постоянный `S09_EVIDENCE_ROOT` |

Частичный backend package run был остановлен сигналом `SIGTERM`. Появившийся
при shutdown `SystemExit: 0` классифицируется как `USER_INTERRUPTED`, а не как
product defect, test failure или PASS.

Результаты нельзя складывать как `44/188 + 144/188`. Финальный backend package
gate должен начинаться заново с target 1 и завершаться единым результатом
`188/188` в рамках одной доказательной попытки.

## 4. Текущий итоговый статус

Текущий честный статус:

> **этап заблокирован**

Причина: отсутствует явное пользовательское утверждение точного постоянного
внешнего каталога `S09_EVIDENCE_ROOT`.

Незавершённые package/browser/compatibility/closure gates являются оставшейся
технической работой, но не подтверждёнными дефектами продукта.

## 5. Навигационная карта Graphify

Для ориентации использован существующий Graphify-граф в read-only режиме.
Перестроение графа не выполнялось.

```text
Stage 09 restart/replay/idempotency
│
├── Chat recovery
│   ├── reconcile_nonterminal_chat_runs()
│   ├── reconcile_owned_run()
│   ├── list_nonterminal_chat_runs()
│   └── build_messages_snapshot()
│
├── Command recovery
│   ├── recover_pending_command()
│   ├── CommandCheckpointInspector
│   ├── resolve_recovered_command()
│   └── CommandService / proposal_service / apply_service
│
├── Board-job recovery
│   ├── reconcile_board_jobs_after_restart()
│   ├── claim_board_job()
│   └── board_results / finalization
│
├── Restart harness
│   ├── seed fixture
│   ├── run()
│   ├── реальная смена PID
│   ├── persistence paths
│   └── recovery proof
│
├── Frontend restore
│   ├── useBoardRestore()
│   ├── BoardPage
│   ├── ChatPlacement()
│   ├── useChatReconnect()
│   └── FlowCommandConfirmation()
│
└── Evidence closure
    ├── finalize_stage09_evidence.py
    ├── _finalize()
    └── EvidenceError
```

Основные backend source points:

- `src/backend/base/ketos/services/chat_threads/recovery.py`;
- `src/backend/base/ketos/services/chat_threads/messages.py`;
- `src/backend/base/ketos/services/commands/recovery.py`;
- `src/backend/base/ketos/services/jobs/recovery.py`;
- `scripts/mvp/restart_harness.py`;
- `scripts/mvp/finalize_stage09_evidence.py`.

Graphify используется для выбора соседних контрактов и blast radius. Любой
вывод графа должен проверяться по актуальному source и тестам кандидата.

## 6. Реестр блокеров, незавершённой работы и рисков

### B1. Не утверждён `S09_EVIDENCE_ROOT`

Класс: внешний blocker полномочий.

Нужен точный абсолютный путь, который:

- находится вне репозитория и временных каталогов;
- является постоянным;
- не является symlink;
- принадлежит текущему пользователю;
- имеет режим `0700`;
- выделен под Stage 09 evidence;
- допускает атомарное переименование staging → final.

Предлагаемый путь:

```text
/Volumes/Projects/.ketos-stage09-evidence
```

Минимальная формулировка утверждения:

> Одобряю `S09_EVIDENCE_ROOT=/Volumes/Projects/.ketos-stage09-evidence` для
> приватного постоянного evidence Stage 09; разрешаю создать выделенный
> каталог, если он отсутствует, и установить для него режим `0700`.

До такого утверждения запрещено:

- выбирать другой постоянный путь самостоятельно;
- создавать final bundle;
- повышать старый diagnostic run до final;
- объявлять Stage 09 выполненным.

### B2. Backend package gate завершён только на 44/188

Класс: незавершённый обязательный gate.

Решение:

1. Создать новую финальную attempt.
2. Начать с target 1.
3. Запустить 188 targets последовательно.
4. Для каждого target использовать свежие `TMPDIR`, XDG dirs и pytest
   basetemp.
5. Не переносить старые логи в final evidence.
6. Остановить attempt при первом реальном failure, RAM guard, monitor loss,
   service failure или SHA drift.

### B3. Не завершён полный frontend gate

Класс: незавершённый обязательный gate.

Плановая команда должна соответствовать текущему runbook; ожидаемый режим:

```bash
CI=true npm test -- --runInBand
```

Исторический ориентир полного набора: 515 suites / 5799 tests. PASS должен
определяться текущим точным selection, итоговым summary и exit code, а не одним
старым числом.

### B4. Не завершён browser acceptance

Класс: незавершённый обязательный gate.

Нужны:

1. Playwright Stage 09 spec на Chromium.
2. `workers=1` и `retries=0` для финального доказательного прогона.
3. Trace.
4. Минимум один screenshot.
5. Отдельная проверка Chrome после Playwright.
6. Computer Use последним — для реального focus ring, keyboard focus и layout.
7. Product Design audit по screenshots и пользовательскому потоку.

Chrome, Computer Use и Product Design не заменяют автоматизированный Playwright
gate.

### B5. Не завершён workflow compatibility gate

Класс: незавершённый обязательный gate.

Целевой тест:

```text
src/backend/tests/unit/api/v2/test_workflow.py
```

Если исправление затронет migration/runtime logic, требуется новый SHA и полный
повтор Stage 09 acceptance-run.

### B6. Monitor может потерять контроль над тестовым процессом

Класс: orchestration/RAM-риск.

Для финального run monitor должен работать fail-closed:

- стартовать раньше первого теста;
- иметь heartbeat;
- контролировать суммарный системный RSS;
- знать точный test process group;
- останавливать test PGID при потере monitor heartbeat;
- записывать событие `MONITOR_LOST`;
- запрещать PASS при отсутствии непрерывной telemetry.

### B7. Возможен test-induced drift checkout

Класс: provenance/scope-риск.

Решение:

- snapshot до первого gate;
- штатные artifact redirects только во внешний staging;
- `EXIT`/`INT`/`TERM` cleanup handlers;
- restore redirects после последнего gate или прерывания;
- snapshot после restore;
- сравнение tracked, staged, unstaged и untracked состояния;
- сохранение unrelated dirty state.

### B8. Evidence может оказаться неполным или несогласованным

Класс: closure-риск.

PASS запрещён при любом из условий:

- отсутствует обязательный лог;
- неизвестен exit code;
- SHA до и после команды различается;
- test count нельзя подтвердить из raw log;
- отсутствует Playwright trace или screenshot;
- найден секрет;
- присутствует symlink или special file;
- payload содержит данные другой attempt;
- manifest не покрывает payload;
- hash/size/type не совпадает;
- final destination уже существует.

## 7. RAM и process-control контракт

Пользовательский абсолютный предел: **16 GiB суммарного RSS**.

| Уровень | Общий RSS | Действие |
|---|---:|---|
| Idle preflight | `< 14.5 GiB` | Разрешить начало тяжёлого gate |
| Soft warning | `≥ 15.0 GiB` | Не начинать новый тяжёлый target |
| Predictive stop | `≥ 15.25 GiB` | Оценить тренд и подготовить остановку PGID |
| Operational hard guard | `≥ 15.5 GiB` | Остановить Stage 09 test PGID |
| Пользовательский предел | `16 GiB` | Никогда не достигать |

Требования:

1. Опрос total RSS примерно каждые 250 мс.
2. Память считать по всей системе, а не только по pytest/npm.
3. Тяжёлые gates выполнять строго последовательно.
4. Не запускать backend package, full frontend и Playwright параллельно.
5. Нельзя широко завершать Chrome, Codex, Node или Python процессы.
6. Допускается остановка только точно идентифицированного Stage 09 PGID или
   заведомо неиспользуемого helper-процесса.
7. Monitor должен сохранять start, heartbeat, RSS samples, peak, stop reason и
   cleanup result.

Допустимые результаты resource controller:

- `PASS`;
- `TEST_FAILURE`;
- `USER_INTERRUPTED`;
- `RAM_GUARD_TRIP`;
- `MONITOR_LOST`;
- `SERVICE_FAILURE`;
- `TIMEOUT`;
- `INFRA_FAILURE`;
- `STALE_SHA`;
- строго нормализованный `DESELECTED_ONLY`, если это прямо разрешено runbook.

## 8. Dependency-ordered план выполнения

### Фаза 0. Сохранить остановленное состояние

1. Не возобновлять старый package run.
2. Убедиться, что старый controller и тестовые процессы больше не работают.
3. Проверить отсутствие активных artifact redirects.
4. Проверить, что candidate worktree не изменён.
5. Сохранить `/Volumes/Projects/.ketos-stage09-gate.iub3Ao` только как
   диагностический материал.
6. Маркировать старую попытку как:
   - `NON_FINAL`;
   - `INCOMPLETE`;
   - `USER_INTERRUPTED`;
   - `44_OF_188`.
7. Не копировать её logs/artifacts в новый final attempt.

Критерий выхода: старая попытка изолирована и больше ничего не пишет.

### Фаза 1. Получить approval для evidence root

1. Получить явное утверждение одного точного абсолютного пути.
2. Зафиксировать утверждённый строковый путь.
3. Получить его resolved physical path.
4. Если resolved path отличается из-за symlink — остановиться и запросить
   утверждение физического пути.
5. Не трактовать предложение пути как approval.

Критерий выхода: имеется однозначное пользовательское разрешение на конкретный
постоянный root.

### Фаза 2. Проверить approved root

1. Установить `umask 077`.
2. Проверить, что путь абсолютный и непустой.
3. Запретить `/`, `/Volumes`, `/Volumes/Projects`, repo root, workspace root,
   `/tmp`, `/private/tmp` и cache directories.
4. Проверить каждый существующий компонент пути на symlink.
5. Проверить владельца — текущий UID.
6. Проверить режим — `0700`.
7. Если каталог отсутствует и approval это разрешает, создать только этот
   выделенный каталог.
8. Не менять права родительского `/Volumes/Projects`.
9. Не очищать существующий root.
10. Проверить свободное место.
11. Проверить, что staging и final будут на одном filesystem.
12. Выполнить узкий atomic rename probe внутри root.
13. Удалить только заведомо созданный probe.
14. Зафиксировать path, realpath, device, mount, UID/GID, mode и probe result.

Критерий выхода: root приватный, постоянный, writable и поддерживает atomic
rename.

### Фаза 3. Повторно подтвердить Stage 08 PASS

1. Получить exact Stage 08 SHA.
2. Сопоставить его с
   `79c2c1ffb2eca0eac7672a092f6df7806f531b37`.
3. Прочитать sealed manifest Stage 08.
4. Повторно вычислить hash и size всех 130 entries.
5. Проверить:
   - missing = 0;
   - extra = 0;
   - hash mismatch = 0;
   - size mismatch = 0;
   - type mismatch = 0.
6. Подтвердить PASS в отчёте Stage 08.

При любом расхождении Stage 09 немедленно остановить. Исправление Stage 08 не
входит в этот план без отдельного расширения scope.

### Фаза 4. Заморозить Stage 09 candidate

1. Повторно прочитать:
   - `AGENTS.md`;
   - исходный Stage 09 plan;
   - runbook;
   - finalizer;
   - scope checker;
   - snapshot/redirect helpers.
2. Получить полный 40-символьный `HEAD`.
3. Проверить ожидаемый SHA
   `c6c96276ccbbda22b18741a8f36a6f355d0382da`.
4. Зафиксировать tree SHA, branch и merge-base.
5. Проверить staged diff.
6. Проверить unstaged diff.
7. Проверить unexpected untracked files.
8. Выполнить scope preflight.
9. Вычислить hashes плана, runbook, finalizer, helpers и schema.
10. Проверить настоящий argparse/CLI-контракт finalizer по source или `--help`.
11. Не использовать сокращённый SHA в evidence.

Критерий выхода: один clean candidate SHA и неизменяемый набор управляющих
артефактов.

### Фаза 5. Проверить сервисы и RAM supervision

1. Измерить idle total RSS.
2. Если idle RSS `≥ 14.5 GiB`, тяжёлый gate не запускать.
3. Проверить PostgreSQL Stage 09:
   - порт `55432`;
   - пользователь `ketos_stage09`;
   - ожидаемый data directory.
4. Проверить Redis Stage 09:
   - порт `56379`;
   - DB `15`.
5. Проверить отсутствие stale Stage 09 child processes.
6. Запустить RAM monitor.
7. Подтвердить heartbeat.
8. Подтвердить, что monitor контролирует точный test PGID.
9. Подтвердить fail-closed stop при потере monitor.
10. Если текущий controller этого не умеет, признать orchestration defect:
    - добавить воспроизводимую проверку;
    - исправить controller/runbook;
    - создать новый SHA;
    - вернуться к Фазе 4.

### Фаза 6. Создать новый staging attempt

1. Создать уникальный `attempt_id` из UTC timestamp и nonce.
2. Создать staging только внутри approved root.
3. Проверить, что resolved staging остаётся внутри root.
4. Проверить mode не шире `0700`.
5. Проверить отсутствие final destination.
6. Зафиксировать:
   - attempt ID;
   - base SHA;
   - candidate SHA;
   - started_at UTC;
   - approved/resolved root;
   - runtime/tool versions.
7. Снять `repo-before.json`.
8. Создать artifact redirects штатным helper.
9. Проверить фактические targets всех redirects.
10. Установить `EXIT`, `INT`, `TERM` cleanup handlers.
11. Выполнить `assert-frozen`.

Критерий выхода: новый пустой staging attempt, безопасные redirects и frozen
candidate.

### Фаза 7. Выполнить финальные gates последовательно

Перед и после каждой команды:

1. Проверить candidate SHA.
2. Выполнить `assert-frozen`.
3. Записать точный argv как массив строк.
4. Записать cwd.
5. Записать start/end UTC.
6. Записать exit code, signal и timeout state.
7. Извлечь test counts из raw log.
8. Записать peak RSS.
9. Проверить heartbeat monitor.
10. Записать относительный путь raw log.

Обязательный порядок:

1. Focused backend — ожидаемый ориентир 96 tests.
2. Restart integration — ожидается 1 test.
3. Реальный restart smoke — обязательна смена PID.
4. Logger regression в свежем XDG/TMP — ориентир 99 tests.
5. Focused frontend — ориентир 15 suites / 83 tests.
6. i18n.
7. Production TypeScript.
8. Backend package — единый запуск target 1 → target 188.
9. Full frontend в сериализованном режиме.
10. Playwright Stage 09 на Chromium.
11. Workflow compatibility.
12. `git diff --check`.
13. Stage 09 scope checker.
14. Финальный `assert-frozen`.

Следующий тяжёлый gate разрешён только если предыдущий имеет exit 0, полный
summary, живой monitor, RSS ниже guard и неизменный SHA.

### Фаза 8. Browser и UX acceptance

Автоматизированный сценарий должен доказать:

1. Открывается стабильный direct URL.
2. Создаётся transcript и незавершённый run.
3. В draft остаётся несохранённый текст.
4. Backend действительно получает новый PID.
5. После reload используется тот же thread ID.
6. Transcript восстановлен без повторов.
7. Server state имеет приоритет над повреждённым локальным cache.
8. Draft сохранён, но не отправлен автоматически.
9. Pending interrupt показан ровно один раз.
10. Confirmation применяется только один раз.
11. Job recovery виден пользователю.
12. Live region не дублирует announcement.
13. Фокус не прыгает неожиданно.
14. Focus ring видим.
15. Network не содержит повторной mutation.
16. Console не содержит необработанных ошибок.
17. Trace и screenshots относятся к текущему SHA.

После Playwright главный агент выполняет:

1. Chrome-проверку DOM/network/accessibility.
2. Computer Use-проверку реального keyboard focus и layout.
3. Product Design audit понятности recovered/failed/pending состояний.

### Фаза 9. Zero-write restore и compare

1. Остановить только Stage 09 runtime processes.
2. Выполнить штатный restore artifact redirects.
3. Снять `repo-after-full.json`.
4. Сравнить его с `repo-before.json`.
5. Проверить неизменность:
   - HEAD;
   - tree SHA;
   - tracked state;
   - staged/unstaged diff;
   - untracked set;
   - artifact path types/targets.
6. Выполнить `git diff --check`.
7. Выполнить scope checker.
8. Выполнить финальный `assert-frozen`.
9. После успешного compare не запускать команды, способные писать в repo.

Любое необъяснённое отличие означает `FAIL` и запрещает finalization.

### Фаза 10. Провести независимые аудиты

Использовать минимум шесть tool-free проверок:

1. Backend recovery и idempotency review.
2. Frontend/browser code review.
3. Test completeness и RAM telemetry audit.
4. Security/ownership/scope audit.
5. Evidence/manifest/provenance audit.
6. Финальный closure audit.

Каждому субагенту передать самодостаточный пакет:

- applicable `AGENTS.md` и Stage 09 constraints;
- полный relevant diff;
- source slices;
- Graphify routes;
- exact command records;
- test summaries и необходимые raw log fragments;
- screenshots и trace summary, если применимо;
- acceptance criteria.

Открытые P0/P1 findings запрещают PASS. Любое исправление product/test/runbook
кода создаёт новый SHA и возвращает работу к Фазе 4.

### Фаза 11. Собрать evidence payload

Обязательные файлы:

- `evidence.json`;
- `report.md`;
- `commands.json`;
- `repo-before.json`;
- `repo-after-full.json`;
- `process/recovery.json`;
- focused backend log;
- restart integration log;
- restart smoke log;
- focused frontend log;
- i18n log;
- production typecheck log;
- backend package logs;
- full frontend log;
- Playwright log;
- workflow compatibility log;
- Playwright trace;
- минимум один screenshot.

Для каждой команды зафиксировать:

- ordinal и command ID;
- gate name;
- точный argv;
- cwd;
- started_at/finished_at UTC;
- duration;
- exit code;
- terminating signal;
- timeout/guard result;
- candidate SHA до и после;
- expected и actual counts;
- peak RSS;
- log path;
- hash и size лога;
- безопасный allowlist environment.

Секретные переменные записываются только как `present/redacted`, без значений.

### Фаза 12. Выполнить pre-final audit

1. Проверить, что каждый required gate представлен одной текущей записью.
2. Проверить, что старые логи не попали в attempt.
3. Проверить schema `commands.json`.
4. Проверить schema `evidence.json`.
5. Сопоставить counts с raw logs.
6. Сопоставить SHA во всех evidence-файлах.
7. Проверить payload на secrets.
8. Запретить symlinks, sockets, devices и FIFOs.
9. Пересчитать SHA-256 и sizes payload.
10. Проверить отсутствие final destination.
11. Получить независимый bundle-review `PASS`.

### Фаза 13. Atomic finalize

1. Вызвать штатный finalizer согласно текущему source/CLI-контракту.
2. Провалидировать schema и полноту payload.
3. Построить детерминированный manifest.
4. Выполнить `fsync` файлов и staging directory.
5. Отказаться от overwrite существующего final path.
6. Атомарно переименовать staging в final на том же filesystem.
7. Выполнить `fsync` parent directory.
8. Установить finalizer-defined restrictive modes.
9. Не изменять final bundle после rename.

Любой `EvidenceError` сохраняется дословно, attempt не получает PASS, а bundle
не чинится на месте.

### Фаза 14. Независимо проверить final bundle

Из final path проверить:

- путь находится под approved resolved root;
- missing = 0;
- extra = 0;
- hash mismatch = 0;
- size mismatch = 0;
- type mismatch = 0;
- symlink/device entries = 0;
- secrets = 0;
- bundle SHA соответствует evidence SHA;
- permissions соответствуют finalizer-контракту;
- worktree всё ещё clean/frozen.

Недействительный final bundle не редактируется. Для повторения создаётся новый
attempt ID и новый final destination.

## 9. TDD-развилки при реальной ошибке

### 9.1. Детерминированный test failure

1. Сохранить raw log.
2. Повторить только упавший target дважды в свежей среде.
3. Получить минимальный воспроизводимый RED.
4. По Graphify определить subsystem и соседние контракты.
5. Добавить или уточнить регрессионный тест.
6. Подтвердить, что тест падает до исправления.
7. Внести минимальное исправление.
8. Запустить focused test.
9. Запустить соседний subsystem gate.
10. Передать diff на независимый review.
11. Исправить замечания.
12. Создать новый SHA.
13. Вернуться к Фазе 4 и повторить весь final run.

### 9.2. Предполагаемая flaky-ошибка

1. Не считать один повторный зелёный запуск PASS.
2. Повторить target минимум три раза в свежей среде.
3. Проверить order dependency.
4. Запустить predecessor → failing target.
5. Проверить утечки БД, Redis, cache, event loop, background tasks и child
   processes.
6. Исправить первопричину.
7. Новый SHA и полный rerun.

### 9.3. Service failure

Отдельно классифицировать:

- сервис не запущен;
- неверный порт/DB/user;
- stale schema;
- остаток предыдущего target;
- повреждение runtime state;
- реальный product defect.

Product defect нельзя маскировать простым перезапуском сервиса.

### 9.4. RAM guard

1. Остановить точный test PGID.
2. Сохранить последние RSS samples и peak.
3. Классифицировать attempt как `RAM_GUARD_TRIP`.
4. Не продолжать с текущего target.
5. Найти источник роста.
6. Снизить concurrency или изменить только orchestration/sharding без изменения
   test selection.
7. Backend package повторить с target 1.

### 9.5. Monitor lost

1. Немедленно остановить test PGID.
2. Классифицировать attempt как `MONITOR_LOST`.
3. Исправить supervision.
4. Инвалидировать текущий run.
5. Повторить полный acceptance-run.

### 9.6. User interrupt

1. Классифицировать как `USER_INTERRUPTED`.
2. Не считать test failure.
3. Не считать PASS.
4. Следующую финальную попытку начать с нуля.

### 9.7. SHA или worktree drift

1. Остановить attempt.
2. Сохранить diff и список изменившихся путей.
3. Не применять широкие destructive Git-команды.
4. Восстановить только доказанно созданные Stage 09 artifacts.
5. Сохранить unrelated dirty state.
6. Если изменён код — новый SHA и полный rerun.

## 10. Предметная матрица recovery/idempotency

### 10.1. Chat recovery

Проверить:

- восстанавливаются только nonterminal runs;
- ownership проверяется до выдачи состояния;
- один restart не создаёт второй `ChatRun`;
- повторный recovery не дублирует messages;
- порядок transcript сохраняется;
- terminal run не возвращается в nonterminal;
- snapshot строится из server state;
- stale browser cache не переопределяет сервер.

Идемпотентная модель:

```text
S0: seed unfinished run
S1: первый restart/recovery
S2: второй restart/recovery

entities(S2) == entities(S1)
effects(S2) == effects(S1)
terminal_state(S2) == terminal_state(S1)
```

### 10.2. Command recovery

Проверить:

- checkpoint принадлежит нужным user/thread/flow/run;
- schema и version валидируются;
- неизвестная/неоднозначная metadata завершается fail-closed;
- confirmation/interrupt применяется один раз;
- replay не создаёт второе внешнее действие;
- terminal command не мутируется;
- небезопасная десериализация отсутствует.

### 10.3. Board-job recovery

Проверить:

- job claim атомарный;
- restart не создаёт второй job;
- terminal job не запускается повторно;
- result/finalization записывается один раз;
- recoverable failure остаётся наблюдаемым;
- отсутствует двойной внешний эффект.

### 10.4. Restart harness

Проверить:

- первый процесс действительно завершён;
- listener первого PID закрыт;
- второй PID отличается;
- storage paths совпадают до и после restart;
- persisted IDs не меняются;
- row counts не растут от повторного replay;
- cleanup ограничен прямыми дочерними runtime paths;
- symlink traversal исключён.

## 11. Security и scope stop-условия

Следующие находки считаются P0 и немедленно запрещают PASS:

- IDOR при восстановлении run/thread/job;
- unsafe checkpoint deserialization;
- повторное внешнее действие;
- мутация terminal state;
- replay при неоднозначной metadata;
- повторное использование interrupt;
- утечка token, secret или password;
- path traversal или cleanup через symlink;
- изменение файлов вне Stage 09 scope;
- evidence без approved external root.

Отдельно проверить отсутствие:

- Alembic migrations;
- новых dependencies и lock-file изменений;
- deployment/config изменений;
- расширения в HA, leader election, outbox или event store;
- переименования component class names;
- изменения generated artifacts;
- неразрешённых внешних действий или network exposure.

## 12. Evidence schema: обязательные смысловые поля

Точная структура определяется текущей schema. Смыслово evidence должно
содержать:

- `schema_version=1`;
- `stage=9`;
- transition и итоговый status;
- Stage 08 base SHA;
- полный Stage 09 code SHA;
- run/attempt ID;
- bundle ID;
- tasks и commits;
- commands;
- process proof;
- storage paths;
- persisted IDs;
- row counts;
- browser proof;
- scope/no-write proof.

Process proof должен подтвердить:

- `pid_1`;
- `pid_2`;
- `pid_changed=true`;
- `listener_pid_1_closed=true`.

Storage proof должен подтвердить канонические пути:

- `data/ketos.db`;
- `data/mvp/langgraph-checkpoints.sqlite3`;
- `same_paths=true`.

Browser proof должен подтвердить:

- direct URL;
- server-wins semantics;
- transcript restored;
- draft preserved;
- focus stable;
- single live-region announcement;
- interrupt resolved once;
- job recovery visible;
- trace path;
- screenshot paths.

Scope proof должен подтвердить:

- head frozen;
- worktree clean;
- pre/post equal;
- allowed paths only;
- no Alembic;
- no HA scope expansion.

## 13. Правила инвалидации результата

Attempt полностью недействителен, если:

1. SHA изменился в ходе run.
2. Использован сокращённый SHA.
3. Worktree был dirty перед финальным run или изменился после restore.
4. Stage 08 rehash больше не проходит.
5. Staging находится вне approved root.
6. Resolved root отличается от одобренного.
7. Нарушена symlink policy.
8. Использованы логи другой attempt.
9. Пропущен обязательный gate.
10. Команда завершилась signal, timeout, memory guard или необъяснённым nonzero.
11. RAM достигла или превысила 16 GiB.
12. Потеряна monitor telemetry.
13. Counts не совпадают с raw logs.
14. Лог отсутствует, усечён или изменён после hash.
15. Redirects не восстановлены.
16. Snapshot, scope или frozen check не прошёл.
17. Evidence schema не прошла.
18. Найден секрет.
19. Final destination уже существовал.
20. Atomic rename/fsync не завершился.
21. Manifest verify обнаружил расхождение.
22. Sealed bundle изменён после finalize.

## 14. Retry semantics

### Транзиентная ошибка на том же SHA

- новый attempt ID;
- новый staging;
- обязательные gates с нуля;
- старые логи не переносятся.

### Изменение кода или теста

- новый полный candidate SHA;
- baseline/scope preflight заново;
- все code-sensitive gates заново;
- новый evidence namespace.

### Ошибка root/permissions/mount

- run не начинается или прекращается;
- status `BLOCKED`;
- изменение resolved root требует нового approval.

### Ошибка evidence assembly без изменения кода

- исправить только staging payload;
- повторить schema/secret/hash audit;
- повторить finalize/verify;
- тесты можно не повторять только если raw command evidence полностью и
  доказуемо сохранилось в той же attempt и runbook это допускает.

### Прерывание package gate

- не продолжать с последней зелёной части;
- не объединять несколько attempts;
- следующий run начинается с target 1.

## 15. Финальная статусная матрица

### «этап выполнен»

Допустимо только если одновременно:

- Stage 08 exact PASS повторно подтверждён;
- один Stage 09 candidate SHA зафиксирован;
- focused backend PASS;
- restart integration и real PID smoke PASS;
- logger regression PASS;
- backend package `188/188`;
- focused и full frontend PASS;
- i18n и production typecheck PASS;
- Playwright и ручной browser acceptance PASS;
- workflow compatibility PASS;
- peak RAM строго ниже 16 GiB;
- monitor telemetry непрерывна;
- scope/diff/no-write PASS;
- независимые reviews PASS;
- immutable bundle создан в approved root;
- manifest независимо проверен;
- обязательных открытых findings нет.

### «этап выполнен частично»

Допустимо, если:

- часть реализации и gates доказанно готова;
- внешнего blocker полномочий уже нет;
- часть обязательной приёмки ещё не закончена;
- Stage 10 не начинается.

### «этап заблокирован»

Используется, когда корректное продолжение невозможно без пользовательского
решения или внешнего состояния.

Текущий snapshot относится к этой категории из-за отсутствия approved
`S09_EVIDENCE_ROOT`.

## 16. Критическая последовательность

```text
Явно утвердить S09_EVIDENCE_ROOT
    ↓
Проверить root, permissions и atomic rename
    ↓
Повторно доказать Stage 08 PASS
    ↓
Заморозить Stage 09 SHA и scope
    ↓
Проверить RAM monitor и сервисы
    ↓
Создать новый staging attempt
    ↓
Запустить все gates с нуля и последовательно
    ↓
При падении: RED → TDD fix → review → новый SHA → полный rerun
    ↓
Playwright → Chrome → Computer Use → Product Design audit
    ↓
Restore redirects → snapshot compare → scope/frozen checks
    ↓
Security/code/test/evidence audits
    ↓
Atomic finalize
    ↓
Independent manifest verification
    ↓
Русский evidence-отчёт с одним разрешённым статусом
```

## 17. Ближайшее действие

До отдельной команды выполнение остаётся остановленным.

Минимальный unblock — утверждение точного пути, например:

> Одобряю `S09_EVIDENCE_ROOT=/Volumes/Projects/.ketos-stage09-evidence` для
> приватного постоянного evidence Stage 09; разрешаю создать выделенный
> каталог и установить `0700`.

После approval работа начинается с проверки root, а не с продолжения старого
target 45. Backend package и весь final acceptance-run выполняются заново.

Stage 10 не входит в этот план и не должен начинаться без отдельного поручения.
