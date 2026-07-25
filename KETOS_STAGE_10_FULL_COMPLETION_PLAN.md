# Ketos Stage 10 Full Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:executing-plans`, `superpowers:test-driven-development`,
> `superpowers:systematic-debugging`, `superpowers:verification-before-completion`,
> `superpowers:requesting-code-review`, `graphify`, `product-design:audit`,
> `chrome:control-chrome`, `computer-use:computer-use`, and
> `docker-external-storage-only`. `AGENTS.md` overrides their delegation model:
> only the main agent may use tools, inspect or edit the workspace, apply
> patches, run commands, control browsers, or execute skills. Subagents receive
> complete source slices and return only analysis, code, or unified diff text.

## Goal

Довести уже реализованный Ketos Stage 10 до честного статуса
`этап выполнен / PASS`: устранить воспроизводимую проблему acceptance
orchestration на gate 11, получить новый clean frozen SHA, выполнить один новый
последовательный acceptance run из 20 gates, доказать UI/live-provider/RAM
контракты и запечатать внешний evidence bundle. Stage 11 не начинать.

## Architecture

Продуктовая реализация A01–A10 сохраняет существующие границы:

- внутренний AI adapter: `OpenAI`;
- внешний upstream: `CometAPI`;
- base URL: `https://api.cometapi.com/v1`;
- модель: `deepseek-v4-flash`;
- agent runtime: KFX/LangGraph;
- Chat transport: существующий CopilotKit/AG-UI path;
- primary acceptance DB: новая SQLite DB;
- dialect proof: одноразовый digest-pinned PostgreSQL 16;
- evidence: внешний APFS bundle с `uchg`;
- основная RAM-метрика: system-used memory;
- aggregate RSS: только консервативная метрика атрибуции.

Новый provider/router, CometAPI-specific product branch, fallback-модель,
Ollama, browser-side credential, mock под видом live proof и перенос
development state в acceptance запрещены.

## Tech stack and normative sources

- Python/FastAPI, `uv`, pytest, Alembic.
- React/TypeScript, Jest, Playwright Chromium.
- Docker Official Image `postgres:16`, SCRAM.
- OpenAI Python SDK с custom `base_url`.
- APFS owner/mode/flag controls.
- Официальные источники вместо Context7:
  - [CometAPI Chat Completions](https://apidoc.cometapi.com/api/text/chat);
  - [CometAPI DeepSeek V4 Flash](https://www.cometapi.com/models/deepseek/deepseek-v4-flash/);
  - [OpenAI Python SDK](https://github.com/openai/openai-python);
  - [Docker Official Postgres image](https://hub.docker.com/_/postgres);
  - [PostgreSQL 16 password authentication](https://www.postgresql.org/docs/16/auth-password.html);
  - [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts);
  - [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence);
  - [Node.js `--preserve-symlinks-main`](https://nodejs.org/api/cli.html#--preserve-symlinks-main).

## Current truth snapshot

Снимок зафиксирован 2026-07-24 в рабочем окружении:

| Объект | Текущая истина |
| --- | --- |
| Stage 09 frozen SHA | `18a2a2a9518d23c589c6700c322ad5844adce932` |
| Stage 09 immutable evidence | `/Volumes/Projects/.ketos-stage09-evidence/stage-09/18a2a2a9518d23c589c6700c322ad5844adce932/20260722T191808Z-55170` |
| Stage 10 branch | `codex/mvp-s10-integration` |
| Stage 10 worktree | `/Volumes/Projects/.worktrees/ketos-mvp-stage10` |
| Последний clean Stage 10 SHA | `06d817178a8b1cb8bff273c8c753e86c0cad142b` |
| A01–A10 | Реализованы и закоммичены |
| Root unrelated dirty | `KETOS_STAGE_09_BLOCKER_CLOSURE_PLAN.md`, `outputs/`; не изменять |
| Невалидный acceptance root | `/Volumes/Projects/.ketos-stage10-acceptance.OUtk2G5M` |
| Невалидный bundle | `/Volumes/Projects/.ketos-stage10-evidence/stage-10/06d817178a8b1cb8bff273c8c753e86c0cad142b-20260724T055041Z` |
| Gates 1–10 | Диагностически PASS; не переносятся в новый run |
| Gate 11 | FAIL/BLOCKED: target 072 `test_mcp_projects.py` получил `OSError: [Errno 9] Bad file descriptor`; RAM monitor завершился без `ram-result.json` и без доказанного post-gate tail |
| Peak gates 1–10 | `14_101_676_032` bytes; warning `1`, stop/emergency/loss `0` до gate 11 |
| Честный текущий статус | `этап заблокирован`: monitor evidence потерян, acceptance orchestration требует ремонта |

Текущий root окончательно `INVALID_DIAGNOSTIC`. Продолжать его с gate 12,
достраивать отсутствующий `ram-result.json` постфактум, переносить его PASS или
запечатывать как final запрещено.

## Global constraints

- Абсолютный RAM ceiling: `16_000_000_000` bytes.
- Unrelated dirty state сохраняется без stash/delete/overwrite.
- Source/runtime evidence не записывается в repo.
- Любой tracked code fix создаёт новый commit и новый `S10_CODE_SHA`.
- Любой code fix после freeze аннулирует весь acceptance run.
- Любой новый final run использует новые:
  - acceptance root;
  - SQLite DB;
  - `KETOS_DATA_DIR`;
  - LangGraph saver;
  - entity IDs;
  - browser processes/PIDs;
  - screenshots;
  - provider proof;
  - evidence bundle;
  - seal receipt.
- Все heavy gates выполняются последовательно.
- Запрещены broad `kill`, `pkill` по имени, Docker prune и удаление чужих
  процессов/данных.
- Hiddify/VPN и `HiddifyPacketTunnel`, ChatGPT/Codex, системные/root processes,
  WindowServer и launchd не останавливать.
- PostgreSQL PGDATA сохраняется на FAIL/BLOCKED и удаляется только после
  полного sealed PASS.

## Main-agent and subagent operating model

Перед каждым TDD или audit wave главный агент:

1. Читает актуальный `AGENTS.md`.
2. Проверяет source SHA, worktree status и owned runtime.
3. Через существующий `graphify-out/graph.json` выполняет targeted Graphify
   queries; граф не перестраивается побочным действием.
4. Подготавливает tool-free packet: полный source slice, интерфейсы, test
   output, ограничения и acceptance checks.
5. Передаёт packet отдельным субагентам:
   - orchestration/FD reviewer;
   - RAM/process reviewer;
   - backend package reviewer;
   - evidence/seal/security reviewer;
   - Product Design/Chrome reviewer;
   - CometAPI/Ketos live-path reviewer.
6. Субагент возвращает анализ или unified diff. Если packet неполон, ответ:
   `BLOCKED: missing context`.
7. Главный агент сам применяет patch, запускает tests, проверяет diff и
   интегрирует исправление.
8. После каждого wave другой tool-free reviewer выполняет независимый audit.

Graphify navigation command:

```bash
cd /Volumes/Projects/ketos_canvas_mod_main
graphify query \
  "Stage 10 acceptance controller RAM guard backend package CometAPI live smoke evidence seal browser story" \
  --budget 2200
```

Expected: найденные Stage 10 scripts/tests/components используются только для
навигации; `graphify-out/` не меняется.

---

## Task 1: Preserve and classify the failed acceptance

**Read-only inputs:**

- `/Volumes/Projects/.ketos-stage10-acceptance.OUtk2G5M`
- `/Volumes/Projects/.ketos-stage10-evidence/stage-10/06d817178a8b1cb8bff273c8c753e86c0cad142b-20260724T055041Z`
- `/Volumes/Projects/.worktrees/ketos-mvp-stage10`

- [ ] Подтвердить, что worktree всё ещё clean и на известном SHA:

```bash
git -C /Volumes/Projects/.worktrees/ketos-mvp-stage10 rev-parse HEAD
git -C /Volumes/Projects/.worktrees/ketos-mvp-stage10 status --porcelain=v1
```

Expected: SHA
`06d817178a8b1cb8bff273c8c753e86c0cad142b`, пустой status.

- [ ] Снять read-only forensic ledger gate 11:
  - last RAM sequence and monotonic timestamp;
  - last log timestamp;
  - отсутствие `ram-result.json`;
  - target 072 failure;
  - PID/PPID/PGID/owner/start time/command fingerprint;
  - отсутствие живого owned controller/guard/test child.

- [ ] Записать во внешний diagnostic journal:

```text
classification=INVALID_DIAGNOSTIC
failed_gate=backend-package
reason=monitor_loss+missing_ram_result+bad_fd
final_eligible=false
```

- [ ] Удалить или заменить только внешние `latest-final` pointers, если они
  указывают на этот run. Сам root/bundle не изменять и не выдавать за PASS.

**PASS:** run однозначно исключён из финальной приёмки; ни один его artifact не
будет скопирован в новый acceptance.

---

## Task 2: Reproduce and TDD-fix the gate-11 FD/monitor failure

**Primary files:**

- Modify:
  `/Volumes/Projects/.worktrees/ketos-mvp-stage10/scripts/mvp/stage10_ram_guard.py`
- Modify only if the failure localizes there:
  `/Volumes/Projects/.worktrees/ketos-mvp-stage10/scripts/mvp/run_stage09_backend_package.sh`
- Test:
  `/Volumes/Projects/.worktrees/ketos-mvp-stage10/scripts/mvp/tests/test_stage10_evidence.py`
- Test:
  `/Volumes/Projects/.worktrees/ketos-mvp-stage10/scripts/mvp/tests/test_stage09_gate_controller.py`
- Promote from ephemeral orchestration into tracked files:
  - `scripts/mvp/stage10_acceptance_controller.py`;
  - `scripts/mvp/stage10_audit_stack.py`;
  - `scripts/mvp/stage10_audit_provider.py`.

### Step 2.1 — Diagnostic matrix before code changes

- [ ] Создать отдельный diagnostic root вне final evidence и воспроизвести
  target 072 следующими вариантами, каждый под bounded timeout:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10

uv run pytest \
  src/backend/tests/unit/api/v1/test_mcp_projects.py \
  --instafail -ra -m "not api_key_required" -q -p no:cacheprovider

/bin/bash -lc '
  diagnostic_root=$(mktemp -d /private/tmp/ketos-s10-fd-direct.XXXXXX)
  uv run pytest src/backend/tests/unit/api/v1/test_mcp_projects.py \
    --instafail -ra -m "not api_key_required" -q -p no:cacheprovider \
    >"$diagnostic_root/raw.log" 2>&1
'
```

- [ ] Затем запустить тот же target через текущий `stage10_ram_guard.py run`
  в отдельном diagnostic root.
- [ ] Повторить под guard после сокращённой последовательности предыдущих
  targets и записывать FD count родителя/child до и после каждого target.
- [ ] Классифицировать границу:
  - direct FAIL → test/product/environment;
  - direct PASS, redirect FAIL → stdio/redirection;
  - redirect PASS, guard FAIL → RAM wrapper;
  - isolated guard PASS, serial series FAIL → FD leak/lifecycle;
  - всё PASS, но parent terminal loss повторяется → supervisor lifecycle.

Expected: воспроизводимая минимальная причина; повторный случайный PASS не
считается исправлением.

### Step 2.2 — Write failing regression tests first

- [ ] Добавить regression tests, которые до исправления падают:
  - child всегда видит валидные FD `0`, `1`, `2`;
  - stdin child явно связан с `DEVNULL`, а не с жизненным циклом Codex PTY;
  - non-zero child exit всё равно даёт schema-valid terminal
    `ram-result.json` с `verdict=FAIL`;
  - monitor exception или два пропущенных samples даёт fail-closed result и
    не допускает следующий gate;
  - 30-second tail завершается до atomic publication result;
  - controller interruption не оставляет orphan child;
  - result создаётся через unique temporary file, `flush`/`fsync`, затем
    atomic rename.

Focused RED command:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
uv run pytest \
  scripts/mvp/tests/test_stage10_evidence.py \
  scripts/mvp/tests/test_stage09_gate_controller.py -q
```

Expected: новые regression cases FAIL по точной причине, старые assertions
остаются зелёными.

### Step 2.3 — Minimal implementation

- [ ] Исправить только найденную границу. Для подтверждённого inherited-stdin
  failure минимальный контракт — `stdin=subprocess.DEVNULL` при запуске child.
- [ ] Разделить descriptors telemetry, child log и result; child не наследует
  heartbeat/control descriptors.
- [ ] Публиковать terminal result и на test failure, и на monitor failure.
- [ ] Порядок завершения:
  `child terminal → 30s tail → monitor flush/fsync → atomic result publish`.
- [ ] Убрать executable dependency от `/private/tmp`: tracked controller,
  audit stack и provider fixture входят в новый code SHA.
- [ ] Controller сохраняет собственный source SHA-256/version в evidence.
- [ ] Не добавлять retry, не отключать RAM guard, не сокращать 188 targets и не
  маскировать failure product-изменением.

### Step 2.4 — GREEN and fault injection

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
uv run pytest \
  scripts/mvp/tests/test_stage10_evidence.py \
  scripts/mvp/tests/test_stage09_gate_controller.py -q
```

Expected: PASS, включая normal exit, test failure, closed-stdin,
monitor-loss, controller-interruption и atomic-result cases.

- [ ] Три раза выполнить target 072 через fixed guard в diagnostic roots.
- [ ] Выполнить shortened serial set вокруг targets 070–074 и доказать:
  - каждый target имеет terminal result;
  - FD count не растёт;
  - monitor gap в пределах контракта;
  - нет surviving owned child.
- [ ] Запустить полный backend package один раз как **development diagnostic**,
  не как final acceptance.

Expected:

```text
STAGE09_BACKEND_PACKAGE_TARGETS=188
exit_code=0
monitor_losses=0
post_gate_tail=complete
```

### Step 2.5 — Independent tool-free review and commit

- [ ] Передать reviewer полный diff, RED/GREEN output и fault-injection output.
- [ ] Исправить P0/P1/P2 findings.
- [ ] Проверить diff:

```bash
git -C /Volumes/Projects/.worktrees/ketos-mvp-stage10 diff --check
git -C /Volumes/Projects/.worktrees/ketos-mvp-stage10 status --short
```

- [ ] Создать один scoped commit с orchestration fix.
- [ ] Зафиксировать новый 40-char `S10_CODE_SHA`.

**PASS:** tracked fix подтверждён regression/fault-injection/full diagnostic
package; worktree снова clean. Старый SHA больше не является final candidate.

---

## Task 3: Re-admit Stage 09, secret, evidence filesystem and PostgreSQL

### Step 3.1 — Stage 09 immutable prerequisite

- [ ] Проверить Stage 09 evidence:

```bash
stage09_root=/Volumes/Projects/.ketos-stage09-evidence/stage-09/18a2a2a9518d23c589c6700c322ad5844adce932/20260722T191808Z-55170
test -d "$stage09_root"
test "$(jq -r '.code_sha' "$stage09_root/evidence.json")" = \
  18a2a2a9518d23c589c6700c322ad5844adce932
test "$(jq -r '.status' "$stage09_root/evidence.json")" = pass
(cd "$stage09_root" && shasum -a 256 -c manifest.sha256)
find "$stage09_root" -type f ! -perm -0400 -print
find "$stage09_root" -type d ! -perm -0500 -print
```

Expected: checksum PASS; последние две команды ничего не печатают. Также
проверить recursive immutable flags, manifest inventory и `changed_paths=[]`.
Любое расхождение останавливает Stage 10 как `BLOCKED`.

### Step 3.2 — Preserve unrelated root state

```bash
git -C /Volumes/Projects/ketos_canvas_mod_main status --short
git -C /Volumes/Projects/.worktrees/ketos-mvp-stage10 status --short
```

Expected: root всё ещё содержит только известный unrelated state плюс этот
запрошенный plan; Stage 10 worktree clean.

### Step 3.3 — Secret file contract

- [ ] Проверить без вывода значения:
  - canonical parent
    `/Volumes/Projects/.ketos-stage10-secrets` is `0700`;
  - regular file `cometapi.env` is `0600`;
  - current owner;
  - no ACL;
  - no symlink;
  - ровно одна строка `COMETAPI_KEY=<non-empty>`;
  - loader не использует `source`/`eval`;
  - значение никогда не попадает в argv/stdout.

Expected: `SECRET_PREFLIGHT=PASS`. Файл после Stage 10 сохраняется по
выбранному пользователем режиму.

### Step 3.4 — Evidence root admission

- [ ] С `umask 077` проверить:
  - canonical path `/Volumes/Projects/.ketos-stage10-evidence`;
  - APFS UUID;
  - owner `kirillustuzanin`;
  - root mode `0700`;
  - no symlink/ACL/unexpected flags;
  - private writable create/fsync/rename/unlink probe;
  - evidence root не находится внутри repo или `/tmp`.

Expected: `EVIDENCE_ROOT_PREFLIGHT=PASS`.

### Step 3.5 — PostgreSQL admission

Перед **каждой** Docker command:

```bash
/Users/kirillustuzanin/.codex/skills/docker-external-storage-only/scripts/verify_external_docker_storage.sh --running
```

- [ ] Использовать только pinned image:

```text
postgres@sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20
```

- [ ] Уникальный PG root:

```text
/Volumes/Projects/.ketos-disposable-postgres/stage10.<unique-run-id>
```

- [ ] Контракт:
  - password file outside argv;
  - one bind mount to `/var/lib/postgresql/data`;
  - no Docker volumes;
  - loopback-only random host port;
  - SCRAM;
  - exact container name tied to run ID;
  - `pg_isready`;
  - authenticated `SELECT 1`;
  - empty user schema.

Expected: inspected digest/mount/port/auth/schema all PASS. На FAIL/BLOCKED
container остановить после identity check, PGDATA сохранить.

---

## Task 4: Freeze the new candidate and create fresh acceptance state

- [ ] Проверить clean worktree and ancestry:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
test -z "$(git status --porcelain=v1)"
export S10_CODE_SHA="$(git rev-parse HEAD)"
test "$(printf '%s' "$S10_CODE_SHA" | wc -c | tr -d ' ')" -eq 40
test "$(git merge-base "$S10_CODE_SHA" 18a2a2a9518d23c589c6700c322ad5844adce932)" = \
  18a2a2a9518d23c589c6700c322ad5844adce932
git diff --check \
  18a2a2a9518d23c589c6700c322ad5844adce932..."$S10_CODE_SHA"
```

- [ ] Создать новые unique roots только под `/Volumes/Projects`:

```bash
export KETOS_STAGE10_ACCEPTANCE_RUN_DIR="$(
  mktemp -d /Volumes/Projects/.ketos-stage10-acceptance.XXXXXXXX
)"
export KETOS_DATA_DIR="$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/data"
export KETOS_DATABASE_URL="sqlite:///$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/ketos-mvp.sqlite"
mkdir -m 0700 -p "$KETOS_DATA_DIR"
test ! -e "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/ketos-mvp.sqlite"
test ! -e "$KETOS_DATA_DIR/mvp/langgraph-checkpoints.sqlite3"

export KETOS_MVP_EVIDENCE_ROOT=/Volumes/Projects/.ketos-stage10-evidence
export KETOS_MVP_EVIDENCE_OWNER=kirillustuzanin
export KETOS_MVP_EVIDENCE_RETENTION_POLICY=indefinite
export KETOS_MVP_EVIDENCE_SEAL_CONTROL=apfs-uchg
export KETOS_STAGE10_EVIDENCE_BUNDLE="$(
  mktemp -d \
    "$KETOS_MVP_EVIDENCE_ROOT/stage-10/${S10_CODE_SHA}-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX"
)"
export KETOS_STAGE10_SEAL_RECEIPT="${KETOS_STAGE10_EVIDENCE_BUNDLE}.seal-receipt.json"
mkdir -m 0700 -p \
  "$KETOS_STAGE10_EVIDENCE_BUNDLE/logs" \
  "$KETOS_STAGE10_EVIDENCE_BUNDLE/product-design/1440x900"
```

- [ ] Записать run ID, SHA, canonical roots, APFS UUID и controller digest.
- [ ] Зафиксировать baseline:

```bash
uv run python scripts/mvp/stage10_ram_guard.py baseline \
  --output "$KETOS_STAGE10_EVIDENCE_BUNDLE/memory-baseline.json"
```

- [ ] До gate 1 обеспечить 30 consecutive seconds:
  - system-used `<13_000_000_000`;
  - pageouts/swapouts не растут;
  - heartbeat stable;
  - monitor ready.

**PASS:** новый run не содержит ни одного файла/ID/PID/screenshots из
предыдущих attempts.

---

## Task 5: RAM-safe process admission and cleanup

- [ ] Через Computer Use проверить Claude/Claude Code на несохранённую работу.
  При её отсутствии завершить приложение штатно.
- [ ] Составить PID ledger для Stage 10. Для каждого child записать:
  `run_id`, `gate_id`, role, PID, PPID, PGID, owner, start time, command hash,
  expected parent и terminal result.
- [ ] Старые Playwright/Chromium/MCP/Node/test workers трогать только если
  одновременно подтверждены owner, PID/PPID, start time, command fingerprint и
  отсутствие live run ID.
- [ ] Неизвестный high-RSS process не сигналить. Снизить собственную нагрузку
  или вернуть `BLOCKED`.
- [ ] Пороговые действия:

| Условие | Действие |
| --- | --- |
| `13.5B` × 3 samples | Не начинать новый gate; concurrency = 1 |
| `14.75B` × 2 | TERM только owned Stage 10 process group; run invalid |
| `15.25B` × 1 или critical pressure | Emergency TERM owned children; run invalid |
| `>=16B` × 1 | Acceptance invalid; sealed PASS невозможен |
| 2 missed samples/heartbeat loss | Fail-closed, owned children stop, root invalid |
| recovery не держится 30s `<13B` или растут pageout/swapout | Следующий gate не запускать |

- [ ] После gate всегда 30-second monitored tail.
- [ ] KILL только после TERM, 15 seconds и повторной identity verification.

**PASS:** никакого воздействия на VPN/Codex/system/other-task processes; каждый
gate получает schema-valid `ram-result.json`.

---

## Task 6: Run the 20 acceptance gates exactly once

Использовать tracked `scripts/mvp/stage10_acceptance_controller.py`. Каждый gate
запускается только после PASS предыдущего и RAM admission. Запрещено
перезапускать отдельный failed gate внутри того же final root.

### Required order

1. `seed-idempotency`
2. `focused-backend`
3. `sqlite-migrations`
4. `postgres-migrations`
5. `kfx`
6. `lfx`
7. `frontend-focused`
8. `frontend-i18n`
9. `frontend-type`
10. `frontend-build`
11. `backend-package`
12. `frontend-full`
13. `chromium-story`
14. `product-design`
15. `chrome`
16. `computer-use`
17. `live-ai`
18. `security`
19. `secret`
20. `ram`

### Gates 1–10

- [ ] Запускать последовательно через controller + RAM guard.
- [ ] Для PostgreSQL оба migration node IDs реально выполнены; skip запрещён.
- [ ] `frontend-build` не пересекается с Playwright или full frontend.
- [ ] После каждого gate проверить:
  - `exit_code=0`;
  - `verdict=PASS`;
  - no skip where forbidden;
  - full tail;
  - no monitor loss;
  - peak `<16_000_000_000`;
  - no surviving owned child.

### Gate 11 — backend package

- [ ] Запустить полный package только один раз в final run:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
uv run python scripts/mvp/stage10_acceptance_controller.py \
  run-gate backend-package
```

Expected:

```text
STAGE09_BACKEND_PACKAGE_TARGETS=188
target 072 PASS
exit_code=0
verdict=PASS
monitor_losses=0
post_gate_tail=complete
```

Missing terminal result, monitor loss, bad FD или count `<188` аннулируют весь
run; продолжение с gate 12 запрещено.

### Gate 12 — full frontend

Expected: весь актуальный corpus PASS в одном worker, без aggregation между
attempts. Фактические suite/test counts фиксируются из этого run, а не
копируются из Stage 09.

### Gate 13 — one Chromium story

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10/src/frontend
KETOS_STAGE10_ACCEPTANCE_MODE=1 \
KETOS_MVP_RUN_DIR="$KETOS_STAGE10_ACCEPTANCE_RUN_DIR/playwright" \
KETOS_STAGE10_ENTITY_LEDGER="$KETOS_STAGE10_EVIDENCE_BUNDLE/entity-ledger.json" \
S10_CODE_SHA="$S10_CODE_SHA" \
./node_modules/.bin/playwright test \
  -c playwright.mvp.config.ts \
  tests/core/features/ketos-mvp-vertical-slice.spec.ts \
  --project=chromium --workers=1
```

- [ ] Доказать steps 1–10 на real API/DB.
- [ ] Ledger содержит `backend_pid_1/2`, `frontend_pid_1/2`.
- [ ] Старые listeners действительно мертвы.
- [ ] Новые backend/frontend readiness PASS.
- [ ] Используются те же SQLite DB и `KETOS_DATA_DIR`.
- [ ] Нет localStorage fixture как server truth.
- [ ] Reject даёт zero Flow effect; fresh approve — one CAS/audit effect.

---

## Task 7: Product Design, Chrome and Computer Use without sentinel timeout

### Gate 14 — Product Design

- [ ] До запуска gate:
  - Mac unlocked;
  - audit stack readiness confirmed;
  - screenshot directory empty;
  - report and screenshot-manifest drafts bound to current run ID;
  - 900-second deadline recorded.
- [ ] Открыть candidate at exact `1440×900`; записать viewport и device scale.
- [ ] Пройти связный journey и создать ровно пять current-run screenshots:

```text
product-design/1440x900/01-board-note-chat.png
product-design/1440x900/02-automation-result.png
product-design/1440x900/03-ai-preview-confirmation.png
product-design/1440x900/04-settings-entry.png
product-design/1440x900/05-restored-board.png
```

- [ ] Для каждого немедленно записать:
  `run_id`, UTC timestamp, step, `1440×900`, SHA-256, byte size.
- [ ] Завершить Product Design report. Open findings:
  `P0=0`, `P1=0`, `P2=0`.
- [ ] Валидировать screenshot manifest.
- [ ] Только после существования пяти screenshots, manifest и завершённого
  report атомарно создать sentinel, с существенным запасом до 900 seconds.

Sentinel до evidence запрещён; sentinel в последние секунды также запрещён.
Timeout делает root invalid.

### Gate 15 — Chrome

- [ ] Через Chrome skill проверить:
  - DOM semantics/accessibility tree;
  - no unnamed focusable controls;
  - keyboard-only journey;
  - visible focus ring;
  - `Escape`, Settings/General, flags and Back;
  - console;
  - network;
  - отсутствие duplicate mutation;
  - отсутствие credential в DOM, URL, storage и browser payload evidence.
- [ ] Authorization headers и токены не сохранять в evidence.
- [ ] Завершить Chrome report и sentinel до deadline.

### Gate 16 — Computer Use

- [ ] При unlocked Mac визуально подтвердить:
  - Chrome window and exact viewport;
  - no clipping/overlap;
  - readable states;
  - keyboard focus visible;
  - desktop app/window behavior.
- [ ] Завершить report и sentinel до deadline.
- [ ] Повторно сверить hashes пяти screenshots.

**PASS:** три отдельных gates PASS; автоматизированная проверка не заменяет
Computer Use, а screenshots не заменяют DOM/network audit.

---

## Task 8: Direct CometAPI preflight and real Ketos live path

### Gate 17A — Direct SDK proof

- [ ] Loader читает
  `/Volumes/Projects/.ketos-stage10-secrets/cometapi.env` без `source`/`eval`,
  передаёт secret только child environment как `OPENAI_API_KEY`, base URL
  задаёт константой.
- [ ] Авторизованный `GET /v1/models` подтверждает exact
  `deepseek-v4-flash`.
- [ ] Выполнить bounded non-stream OpenAI SDK request:
  - `stream=False`;
  - exact model;
  - `extra_body={"thinking":{"type":"enabled"}}`;
  - `reasoning_effort="high"`;
  - bounded timeout/output tokens.
- [ ] Выполнить отдельный typed tool request:
  - real `message.tool_calls`;
  - JSON arguments schema-valid;
  - safe local tool result;
  - follow-up с exact `tool_call_id`;
  - successful final response.
- [ ] Сохранить только request ID, status, latency and token usage. Prompt,
  reasoning и full response не сохранять.

### Gate 17B — Ketos path

- [ ] Через Variables API создать в таком порядке:
  1. `OPENAI_BASE_URL`, type `Generic`;
  2. `OPENAI_API_KEY`, type `Credential`.
- [ ] `/check-config` должен доказать:

```text
provider_adapter=OpenAI
provider_upstream=CometAPI
model=deepseek-v4-flash
base_url=https://api.cometapi.com/v1
```

- [ ] Запустить committed smoke:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
uv run python scripts/mvp/run_live_ai_smoke.py \
  --database-url "$KETOS_DATABASE_URL" \
  --assert-canonical-saver-path \
  --entity-ledger "$KETOS_STAGE10_EVIDENCE_BUNDLE/entity-ledger.json" \
  --evidence "$KETOS_STAGE10_EVIDENCE_BUNDLE/live-ai-smoke.json" \
  --secret-file /Volumes/Projects/.ketos-stage10-secrets/cometapi.env
```

- [ ] Доказать:
  - real upstream response;
  - typed Flow proposal;
  - reject: Flow/audit effect counters unchanged;
  - separate fresh proposal;
  - approve: exactly one CAS Flow effect and one audit entry;
  - retry/replay does not add second effect.

Direct SDK proof не заменяет Ketos path. Не утверждать, что Ketos передал
`thinking`/`reasoning_effort`, если это не наблюдалось на server boundary.

Любая live/CAS/secrecy проблема аннулирует root. Если нужен code fix:
RED test → minimal general fix → focused GREEN → review → new commit/SHA →
новый run gates 1–20.

---

## Task 9: Security, secret and aggregate RAM gates

### Gate 18 — Security

- [ ] Проверить canonical path, Variables API credential boundary, prompt/tool
  input validation, server-only key, CAS/replay/stale/reject semantics.
- [ ] Browser/runtime logs не содержат auth headers, cookies or raw secrets.
- [ ] P0/P1/P2 = 0.

### Gate 19 — Secret

- [ ] Exact-value scan выполняется без печати значения.
- [ ] Разрешённое совпадение: только сам
  `/Volumes/Projects/.ketos-stage10-secrets/cometapi.env`.
- [ ] Scope:
  - Stage 10 worktree, including untracked;
  - Git common dir/objects;
  - acceptance root and SQLite bytes;
  - evidence bundle;
  - logs/screenshots/browser evidence;
  - Docker inspect/config/env/labels;
  - process argv;
  - PostgreSQL exports, если создавались.
- [ ] Сохраняются только scope, match count и verdict, не matching bytes.

Expected: `exact_secret_matches=0` вне allowlisted secret file.

### Gate 20 — RAM aggregate

- [ ] Все 19 prior gates имеют:
  - continuous monitor;
  - valid result;
  - full 30-second tail;
  - zero monitor loss;
  - zero stop/emergency;
  - peak `<16_000_000_000`;
  - no surviving owned child.
- [ ] Собрать:
  - `memory-monitor.jsonl`;
  - `memory-baseline.json`;
  - `pid-ledger.json`;
  - `ram-summary.json`.
- [ ] Aggregate RSS явно маркировать approximate/attribution.

Expected: gate 20 PASS. Отсутствующий result нельзя восстановить из log.

---

## Task 10: Freeze artifacts, validate schemas and seal

### Step 10.1 — Stop writers and recheck source identity

- [ ] Остановить только owned Stage 10 writers.
- [ ] Дважды снять size/mtime/hash acceptance artifacts и доказать stability.
- [ ] Проверить:

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
test "$(git rev-parse HEAD)" = "$S10_CODE_SHA"
test -z "$(git status --porcelain=v1)"
```

### Step 10.2 — Build final records

- [ ] Создать `gate-results.json`: 20 gates exactly once, ordered, one run ID.
- [ ] Создать `final-journal.json`: completed/partial/defects/blockers/tests/
  subagents/acceptance/closure.
- [ ] Создать `final-report.md`.
- [ ] Валидировать:
  - `entity-ledger.schema.json`;
  - `gate-results.schema.json`;
  - `live-ai-smoke.schema.json`;
  - `final-journal.schema.json`;
  - `product-design-screenshot-manifest.schema.json`.

### Step 10.3 — Bundle validation

```bash
cd /Volumes/Projects/.worktrees/ketos-mvp-stage10
uv run python scripts/mvp/validate_evidence_bundle.py \
  --bundle "$KETOS_STAGE10_EVIDENCE_BUNDLE" \
  --schema-dir docs/dev/handoff/evidence/stage-10 \
  --s10-code-sha "$S10_CODE_SHA" \
  --owner "$KETOS_MVP_EVIDENCE_OWNER" \
  --retention-policy "$KETOS_MVP_EVIDENCE_RETENTION_POLICY" \
  --deny-secrets \
  --write-no-secret-report "$KETOS_STAGE10_EVIDENCE_BUNDLE/no-secret-qa.json" \
  --write-manifest "$KETOS_STAGE10_EVIDENCE_BUNDLE/manifest.json"

(
  cd "$KETOS_STAGE10_EVIDENCE_BUNDLE"
  shasum -a 256 manifest.json > manifest.sha256
)
```

- [ ] Проверить:
  - regular files only;
  - no symlink/FIFO/socket/device;
  - no path traversal/absolute manifest paths;
  - owner correct;
  - no ACL;
  - `nlink=1`;
  - no unexpected xattrs;
  - sorted unique manifest entries;
  - SHA-256 and size for every payload file;
  - manifest service files are excluded from recursive self-hashing by schema.

### Step 10.4 — APFS seal

```bash
uv run python scripts/mvp/seal_evidence_bundle.py \
  --bundle "$KETOS_STAGE10_EVIDENCE_BUNDLE" \
  --control "$KETOS_MVP_EVIDENCE_SEAL_CONTROL" \
  --manifest-sha-file "$KETOS_STAGE10_EVIDENCE_BUNDLE/manifest.sha256" \
  --owner "$KETOS_MVP_EVIDENCE_OWNER" \
  --retention-policy "$KETOS_MVP_EVIDENCE_RETENTION_POLICY" \
  --verify-final-no-secrets \
  --external-receipt "$KETOS_STAGE10_SEAL_RECEIPT"
```

- [ ] Files `0400`, directories `0500`.
- [ ] Recursive `uchg` на bundle и всех descendants.
- [ ] Evidence root остаётся `0700`, не делается immutable целиком.
- [ ] Negative probes должны завершиться ожидаемым `EPERM/EACCES`:
  - create;
  - write/truncate/content change;
  - mtime change;
  - rename file;
  - unlink file;
  - create/remove directory;
  - rename/remove bundle root.
- [ ] `ENOENT` или `EEXIST` не засчитывать как seal proof.
- [ ] Любая успешная mutation необратимо invalidates bundle.

### Step 10.5 — Sibling receipt

- [ ] Receipt создаётся после negative probes и содержит:
  - canonical bundle path;
  - run ID;
  - `S10_CODE_SHA`;
  - manifest SHA-256;
  - payload count/bytes;
  - APFS UUID;
  - modes/flags summary;
  - each mutation probe result;
  - UTC timestamp;
  - `SEALED_PASS`.
- [ ] Receipt не входит в bundle manifest.
- [ ] Receipt and detached checksum: owner correct, `0400`, no ACL/symlink,
  protected by `uchg`.

**PASS:** independent read-only revalidation подтверждает schemas, hashes,
secret scan, recursive flags and protected receipt.

---

## Task 11: Final cleanup, independent audits and report

### PostgreSQL cleanup

Только после validated and sealed PASS:

- [ ] Выполнить external-storage guard.
- [ ] Проверить exact container ID/name/digest/mount source.
- [ ] Остановить и удалить только exact Stage 10 PostgreSQL container.
- [ ] Удалить только exact disposable PGDATA directory после canonical-path,
  owner, no-symlink and run-ID checks.
- [ ] Docker volumes/prune не использовать.

На FAIL/BLOCKED: container остановить, PGDATA оставить для диагностики.

### Independent tool-free audits

- [ ] Backend/orchestration audit.
- [ ] Frontend/UX audit.
- [ ] Product Design audit.
- [ ] Security/secrecy audit.
- [ ] RAM/process audit.
- [ ] Evidence/seal audit.

Каждому reviewer передать immutable source/evidence slices, commands, results
and hashes. Reviewer не вызывает tools. Open P0/P1/P2 must be zero.

### Final evidence report

Финальный русский отчёт обязан содержать:

- base SHA and final `S10_CODE_SHA`;
- branch/worktree;
- A01–A10 delivery map;
- 20/20 gate table with exact counts and peaks;
- PostgreSQL digest/mount/migration result;
- Product Design/Chrome/Computer Use results;
- direct CometAPI and separate Ketos-path proof;
- reject `0`, approve `1` CAS/audit effect;
- secret scan;
- global peak system-used and aggregate RSS disclaimer;
- monitor losses and stop/emergency trips;
- source clean-before/after;
- bundle path, manifest SHA, APFS UUID, modes/flags, negative probes;
- sibling receipt path/hash;
- unrelated dirty preservation;
- explicit `Stage 11: не запускался`.

---

## Failure and restart decision table

| Событие | Статус | Обязательное действие |
| --- | --- | --- |
| Invalid credential, provider unavailable, PostgreSQL/evidence/tool capability unavailable, monitor lost | `этап заблокирован / BLOCKED` | Сохранить diagnostic evidence, устранить prerequisite, новый root/run |
| Test/UX/live/CAS/security/secrecy/seal FAIL при доступных prerequisites | `этап выполнен частично / FAIL` | TDD fix, new commit/SHA, полный новый run 1–20 |
| Peak `>=16_000_000_000` | `этап выполнен частично / FAIL` | Acceptance навсегда invalid; снизить нагрузку, новый root/run |
| Audit sentinel timeout или locked Mac | `этап заблокирован / BLOCKED` | Root invalid, восстановить capability, новый root/run |
| Packaging/seal orchestration failure без source/artifact drift | Не PASS | Новый unique bundle допустим только после доказанного writer freeze; при любом drift новый acceptance run |
| Все gates, audits, live path, RAM and seal PASS | `этап выполнен / PASS` | Закрыть MVP; Stage 11 не начинать |

## Definition of done

Stage 10 считается полностью выполненным только если одновременно истинно:

- [ ] Stage 09 immutable prerequisite PASS.
- [ ] Gate-11 FD/monitor defect воспроизведён, TDD-fixed и independently audited.
- [ ] Новый clean `S10_CODE_SHA` зафиксирован.
- [ ] A01–A10 остаются реализованными и focused PASS.
- [ ] Один fresh acceptance root прошёл gates 1–20 строго последовательно.
- [ ] Backend package `188/188`.
- [ ] Full frontend corpus PASS.
- [ ] PostgreSQL migrations executed без skip.
- [ ] One Chromium story and four-PID restart proof PASS.
- [ ] Product Design, Chrome and Computer Use PASS at `1440×900`.
- [ ] Five current-run screenshots validated.
- [ ] Direct CometAPI typed-tool proof PASS.
- [ ] Real Ketos adapter path PASS.
- [ ] Reject `0`, fresh approve exactly `1` CAS/audit effect.
- [ ] Security/secret scans PASS.
- [ ] Global system-used peak `<16_000_000_000`.
- [ ] Monitor losses/stop/emergency `0/0/0`.
- [ ] Source SHA/worktree unchanged across acceptance.
- [ ] Evidence schemas/hashes PASS.
- [ ] APFS `0400/0500` + recursive `uchg` + negative probes PASS.
- [ ] Protected sibling seal receipt PASS.
- [ ] Unrelated dirty state preserved.
- [ ] Open P0/P1/P2 = `0/0/0`.
- [ ] Stage 11 не запускался.

После выполнения последнего checkbox единственная допустимая итоговая
формулировка: **`этап выполнен`**.
