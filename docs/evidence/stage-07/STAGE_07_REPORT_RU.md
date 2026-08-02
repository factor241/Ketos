# Ketos Stage 07 — evidence-отчёт

## Итог

- Статус: **этап выполнен**.
- Внутренний gate: **PASS**.
- Переход к следующему этапу: **GO**.
- Этап 08 не начинался.
- Final implementation candidate: `7971dba2651ecae1d4f8760fc842075010c6973b`.
- Ветка реализации: `codex/mvp-s07-integration`.
- Исходный `main`: `cefa5ec898eda1f944a4758014d624dfe0c7a91d`.
- Исходный worktree `/Volumes/Projects/ketos_canvas_mod_main` после работы остался на том же SHA и чистым.

Evidence-документ и изображения добавляются отдельным docs-only commit после final implementation candidate; поэтому SHA выше обозначает точное проверенное дерево реализации.

## Preflight и право на старт

1. Прочитаны `AGENTS.md` и обязательный `.agents/skills/main-agent-tool-orchestration/SKILL.md`.
2. Проверены `HEAD`, ветка и dirty state исходного worktree: `main`, `cefa5ec898eda1f944a4758014d624dfe0c7a91d`, dirty state отсутствует.
3. Предыдущий этап подтверждён как `PASS / GO` отчётом `docs/evidence/stage-06/STAGE_06_REPORT_RU.md` на точном входном SHA.
4. Preflight предыдущего API-контура: 51 backend v2 test — `PASS`.
5. Реализация выполнена в изолированных linked worktree; исходный checkout не использовался для изменений.

## Выполнение S07-A01…S07-A10

| Задача | Статус | Practical deliverable | Commit | Основное доказательство |
|---|---|---|---|---|
| S07-A01 | PASS | exact Job ownership и fail-closed writers | `62881a8b8e0` | ownership/foreign/NULL/public-marker tests; общий backend gate |
| S07-A02 | PASS | deterministic UUIDv5 claim, canonical fingerprint, insert-first collision recovery | `c8ea87f817f` | `test_board_claim.py`; concurrency/replay/conflict matrix |
| S07-A03 | PASS | immutable common executor и Board v1 facade без HTTP self-call | `c1990a470f9` | `test_service.py`, v1/v2 regression, aggregate execution gate |
| S07-A04 | PASS | legal lifecycle, CAS finalizer и bounded result DTO | `28987f7aff2` | `test_board_finalization.py`, `test_board_results.py` |
| S07-A05 | PASS | terminal Job Result Placement service | `a83913aefa3` | `test_job_result_placement.py`; foreign/mismatch/close matrix |
| S07-A06 | PASS | typed run/list/get/cancel queries и bounded polling | `4ad86909ed4` | execution contract/polling/source-guard Jest |
| S07-A07 | PASS | honest Run/Cancel/status/unknown UI | `0da12f9ae4` | `ExecutionStatus` и `use-run-automation` Jest |
| S07-A08 | PASS | inert bounded `ResultPlacement` для success/error/cancel | `30104196ee2` | `ResultPlacement.test.tsx`; HTML/script inertness |
| S07-A09 | PASS | deterministic result geometry, unique materialization и explicit open | `27f6c54a93b` | geometry/use-place-job-result tests; reload/open proof |
| S07-A10 | PASS | assembled routers, flags, node/locale wiring, Board integration, E2E и docs | `28c1692615a` | OpenAPI uniqueness, aggregate backend, Jest/i18n/typecheck/Chromium |
| Post-gate fix | PASS | test fixtures сохраняют типобезопасность относительно baseline | `7971dba2651` | focused Jest 14/14; full-typecheck comparison with untouched base |

Integration merge commits: `57bef0d043f` (common executor lane) и `b571d8a08c6` (frontend lanes).

## Реализованный контракт

- Board execution создаётся через session-authenticated v1 facade и существующий Job домен.
- Idempotency key не хранится и не логируется в сыром виде; повтор с тем же fingerprint возвращает тот же Job без повторного materialize/runner side effect.
- Claim использует deterministic UUIDv5, direct INSERT, rollback и fresh-session recovery после `IntegrityError`.
- Execution-start и terminal transitions защищены CAS; terminal outcome не перезаписывается проигравшим конкурентом.
- Общий prepared execution хранит канонический immutable snapshot и повторно проверяет SHA-256 перед materialization.
- v1 и v2 сохраняют существующие session/input/output/event-manager semantics и используют один runner seam.
- Frontend различает `queued`, `running`, `succeeded`, `failed`, `cancelled` и локальное `unknown`; transport ambiguity не становится false success.
- Повтор pre-identity запроса использует тот же key; history старого Job не перехватывает recovery нового intent.
- Terminal Job создаёт ровно один `job_result` placement; reload восстанавливает его, explicit open переводит фокус, close сначала подтверждает DELETE и только затем возвращает фокус Automation.
- Feature flag off скрывает execution actions, не удаляя серверные данные.
- RU/EN labels, reasons и actions зарегистрированы одним A10 owner; reserved `backend_restarted` локализован, но не производится Stage 07 runtime.

Не заявляются и не имитируются: process-restart recovery, durable dispatch outbox, lease renewal, multiworker fencing, arbitrary component execution, rich result renderer, load/soak, production rollout и Stage 08.

## Нормативная проверка на final candidate

### Backend

Команда §12.3 по девяти наборам:

```text
139 passed, 1 warning in 267.63s
exit 0
```

Покрыты common executor, claim, finalization, result projection, aggregate domain, четыре v1 route, assembled router, v2 compatibility и Result Placement.

### Frontend

Последовательность §12.3 выполнена без перестановки:

```text
Jest executions + ResultPlacement: 4 suites, 38 tests passed, exit 0
i18n: en 2483 keys; ru 2555 keys; 0 issues; PASS, exit 0
type-check:production: PASS, exit 0
Chromium: 2 tests passed in 1.8m, exit 0
```

Дополнительные focused proofs после review fixes:

```text
ExecutionStatus + ResultPlacement: 2 suites, 22 tests passed
Execution query contract/polling/source guard: 3 suites, 29 tests passed
Placement persistence + run automation: 2 suites, 14 tests passed
Biome lint для изменённых Stage 07 frontend paths: PASS
Ruff format/check для изменённых backend paths: PASS
git diff --check: PASS
```

### Browser story

Chromium matrix доказала real v1 KFX success, timeout, execution failure, cancel, disconnect до и после Job identity, same-key recovery без второго Job, reload того же Job/Result, direct flow route, отсутствие `x-api-key`, feature-off и клавиатурный focus path.

## Chrome, Computer Use и Product Design audit

Capture выполнен в Google Chrome текущего запуска на `localhost:3000`; Computer Use независимо подтвердил выбранную вкладку Ketos, точный Board URL и accessible tree Automation/Result. Скриншоты сохранены в этой папке.

| Шаг | Состояние | Здоровье | Evidence и вывод |
|---|---|---|---|
| 1 | Automation размещена, Run доступен | PASS | `01-automation-idle.jpg`: основное действие видно, edit и run разделены |
| 2 | Невалидный пустой Flow отклонён | PASS | `02-submit-rejected.jpg`: localized alert, false success отсутствует |
| 3 | Валидный TextInput Flow выполнен | PASS | `03-success-result.jpg`: Automation показывает success, Result создан рядом |
| 4 | Reload | PASS | `04-restored-after-reload.jpg`: тот же terminal state и Result восстановлены |
| 5 | Close Result | PASS | `05-result-closed-focus-returned.jpg`: Result placement удалён, Automation active; backend list содержит только Automation |

Сильные стороны: действие Run обнаруживается без перехода в editor; success/error выражены и цветом, и текстом; Result не крадёт фокус автоматически; explicit open/close имеют детерминированный путь.

Неблокирующее UX-наблюдение: JSON fallback в узкой Result-card трудно сканировать. Это соответствует ограниченному inert renderer Stage 07; rich renderer явно отложен и не расширялся в этом этапе.

Ограничение audit: скриншоты не доказывают полное соответствие WCAG, screen-reader announcements или измеренные contrast ratios. Роли/status, keyboard activation и focus path дополнительно проверены DOM snapshot и Chromium E2E.

## Graphify

Graphify использован только read-only; существующий broad graph не перестраивался и не изменялся.

- BFS query по BoardPage/placements нашёл 429 связанных узлов.
- `BoardPage()` подтверждён в `src/frontend/src/pages/BoardPage/index.tsx` и связан с `useGetBoard()`.
- `placementsToNodes()` подтверждён в `placement-to-node.ts`, импортируется `use-board-scene.ts`, вызывается `useBoardScene()` и делегирует `placementToNode()`.
- Graphify output и generated artifacts не вошли в diff.

## Содержательные субагенты и disposition

Субагенты работали только с переданными main-agent пакетами контекста и не использовали инструменты, в соответствии с `AGENTS.md`.

| Agent | Результат |
|---|---|
| `s07_a0_security` | security/invariant findings преобразованы в ownership, collision, CAS, sanitizer и allowlist negative tests |
| `s07_plan_review` | два конфликта закрыты module-level task adapter и execution-start CAS |
| `a03_executor_design` | предложил immutable prepared/materialize seam; main agent адаптировал к реальным KFX interfaces |
| `a03_adapter_review` | повторный review: PASS, 65 combined tests в A03 review packet |
| `s07_backend_review` | A10 router/config/DTO review: PASS |
| `s07_frontend_race_review` | нашёл same-key history hijack и reload transport ambiguity; RED→GREEN fixes; повторный review PASS |
| `s07_ui_e2e_review` | нашёл delete-before-refocus ordering; добавлен `closeAndWait`; повторный review PASS |

Неразрешённых required findings нет.

## Официальная документация

Context7 не использовался. Решения сверялись с официальными источниками:

- SQLAlchemy Session rollback и transaction state: <https://docs.sqlalchemy.org/en/20/orm/session_basics.html#rolling-back>
- FastAPI response status codes: <https://fastapi.tiangolo.com/tutorial/response-status-code/>
- Pydantic model configuration: <https://docs.pydantic.dev/latest/concepts/config/>
- TanStack Query keys, retries и mutations: <https://tanstack.com/query/latest/docs/framework/react/guides/query-keys>, <https://tanstack.com/query/latest/docs/framework/react/guides/query-retries>, <https://tanstack.com/query/latest/docs/framework/react/guides/mutations>
- React `useRef` и `useCallback`: <https://react.dev/reference/react/useRef>, <https://react.dev/reference/react/useCallback>

## Неблокирующие baseline-наблюдения

- Playwright повторяет существующее предупреждение `agentic_mcp.py:330: coroutine '_anop' was never awaited`. Файл вне Stage 07 scope; оба Chromium story проходят.
- Ненормативный `npm run type-check` (test config) остаётся красным в пяти untouched baseline test-файлах. Сравнение с чистым исходным worktree подтвердило те же ошибки; Stage 07-owned type errors исправлены. Нормативный `npm run type-check:production` — PASS.

## Repository safety

- Forbidden paths, lock files, deployment config, `LICENSE`, `NOTICE`, generated artifacts и Graphify output не изменены.
- Сырые secrets, cookies, Authorization headers, idempotency keys и result body в ledger не записаны.
- Исходный worktree: `main`, `cefa5ec898eda1f944a4758014d624dfe0c7a91d`, clean.
- Implementation worktree перед evidence commit: clean на `7971dba2651ecae1d4f8760fc842075010c6973b`.

## Closure

Все S07-A01…S07-A10 имеют practical deliverable, focused proof и commit. Нормативный backend/frontend/browser gate зелёный на точном implementation candidate. Статус Stage 07: **PASS / этап выполнен / GO**.
