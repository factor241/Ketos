# Этап 07 — Board, durable multi-window Chat, Command proposals, Project и permission-first Search

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, Wave 1 A1/H1/K1/I1/Q1 и S1.
> **Вход:** Этап 06 — `этап выполнен`, `GO`, F1-C PASS.
> **Следующий файл:** `22_KETOS_STAGE_08_EDITOR_EXECUTION_AI.md`.
> **Обязательный режим:** A1, H1, K1, I1 и Q1 — параллельные bounded lanes с отдельными субагентами; S1 выполняется только после обязательных PASS. Все доступные применимые инструменты обязательны.

## 1. Контекст этапа

После data cutover Ketos может впервые включить Project-scoped Board и durable Chat shell. Этап отделяет entity от placement, BoardRelation от Flow edge, Chat identity от session/context/run, Project от нового DB entity и proposal generation от domain mutation. Embedded Flow Editor, production AI apply и Board execution ещё запрещены.

Связанные зоны: backend Board/Placement/Note/Chat/Search/Command services из F1-R; frontend routes/pages/controllers/stores; existing assistant panel/Message/Trace/MemoryBase; current Folder projects API; i18n/accessibility/design system; continuous Flow/KFX/LFX/API compatibility.

**Явно покрываемые требования:** `R-01`, `R-04`, `R-05`, `R-06`, `R-07`, `R-08`, `R-09`, `R-23`, `R-26`, `R-27`, `R-28`, `R-29`, `R-30`, `R-35`, `R-36`, `R-38`, `R-40`. Их PASS возможен только по критериям этого этапа и Q1; требования Editor/Run/AI остаются открытыми до Этапа 08.

## 2. Цель этапа

Создать восстановимую рабочую оболочку: несколько Boards в Project, placements/notes, 20 независимых durable chats, typed read-only proposals, Project hierarchy и search без metadata leakage. S1 должен доказать reload/restart, close-vs-delete, actor isolation и compatibility до допуска Editor/Execution/AI.

## 3. Подробное техническое задание

### A1 Board

Использовать выбранный X-A compositor; реализовать camera/card frame, move/resize/z/collapse/max/fullscreen/close-placement, lazy mount, viewport debounce, deep links/history/flag states, keyboard/focus/minimap/lost-window. BoardNote отделён от Flow NoteNode; copy default, move через confirmation+Flow CAS, link non-executable.

### H1 Chat

ChatThread CRUD/search через Command Kernel/revision; MessageTable+ChatTurn transaction; ChatRun stream/idempotency/events/model/cost; authorized replay; context from committed turns; independent frontend controllers; opt-in versioned localStorage import with preview/hash/idempotency/atomic batches.

### K1/I1/Q1

Typed DTO/canonical proposal/one-use confirmation states без apply; extend current projects API with hierarchy/pin/archive/order/system-role; federated permission-first search; continuous compatibility/security/coverage/performance/i18n/visual evidence.

## 4. Задачи и task-level verification

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S07-T01 | Wave admission/registrars | route/store/locale/flag owners | F1-C/flags/contracts current; no overlapping central edits |
| S07-T02 | Board route/query/controller | default-controlled Board page | Deep link/reload/back/flag-off/404/403 states tested |
| S07-T03 | Canvas/camera/card frame | spatial UI | 100/500/1000 thresholds; all frame states; lazy/offscreen policy |
| S07-T04 | Placement CAS/viewport | persistence integration | Concurrent move has one winner/one 409; restore hash deterministic |
| S07-T05 | BoardNote conversion | note UX/domain | Close preserves entity; copy default; move confirmed CAS; Flow hash rules |
| S07-T06 | Board accessibility/i18n | keyboard/focus/RU/EN/pseudo | Keyboard-only oracle, focus return, overflow/semantic zoom PASS |
| S07-T07 | Chat backend/domain | durable ChatThread/Turn/Run | Body/files canonical; title rename identity-safe; authorized replay |
| S07-T08 | Multi-window Chat UI | isolated controllers/windows | 20 streams; zero state/AbortController/cancel leakage |
| S07-T09 | Chat recovery/attachments | reconnect/retention | Kill browser/backend every state; exactly-once committed turns; actor matrix |
| S07-T10 | Legacy/local import | opt-in importer | Same transcript twice→one canonical result; invalid/oversized→zero partial commit |
| S07-T11 | K1 proposal DTOs | schema/canonical proposal | Read-only generation has zero domain/outbox mutation; negative corpus PASS |
| S07-T12 | Project hierarchy | extended `/api/v1/projects` + UI states | Depth 5/cycle/move/order/pin/archive/system-role/global uniqueness tests |
| S07-T13 | Permission-first Search | federated backend | Forbidden id/title/snippet/count absent; stable pagination under moves/inserts |
| S07-T14 | Continuous Q1 | compatibility/security/coverage dashboard | Flow/KFX/LFX/API/route/coverage/perf/i18n current-SHA PASS |
| S07-T15 | S1 integration barrier | end-to-end evidence | Multiple Boards/Chats/Notes restore; other actor sees nothing; reviewers PASS |

## 5. Подэтапы и параллельность

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S07.0 Admission/design-system map | Нет | Stage 06 GO | lane/registrar/UX map | Coordinator + Product Design | existing patterns/tokens/routes confirmed | Все lanes |
| S07.1 A1 Board | С H1/K1/I1/Q1 | S07.0, X-A/F1 APIs | Board/Placement/Note UI | Board backend/frontend | unit/controller/Chrome/a11y/perf | S1, E2/R2/U2 |
| S07.2 H1 Chat | С A1/K1/I1/Q1 | S07.0, F1-C | durable chats/import | Chat backend/frontend | 20 streams/restart/import/security | S1 |
| S07.3 K1 Proposals | С A1/H1/I1/Q1 | S07.0, F1-K | typed durable proposals | Command agents | schema/golden/replay/stale | P2; не S1 если отдельно PASS позже |
| S07.4 I1 Project/Search | С A1/H1/K1/Q1 | S07.0 | hierarchy/search | Backend/frontend | adversarial 2-user/pagination | S1/U2 |
| S07.5 Q1 continuous proof | Постоянно; heavy gates serial | Starts S07.0 | regression/evidence lane | Test/compat agents | exact commands/artifacts | S1 and all later stages |
| S07.6 Integration sync | Нет | A1/H1/I1/Q1 PASS; K1 status explicit | S1 RC | Registrars/coordinator | full E2E/restart/auth | Review |
| S07.7 Independent S1 review | Reviewers параллельно | S07.6 | GO/NO-GO | UX/security/compat reviewers | replay selected scenarios | Stage 08 |

K1 может завершаться независимо, но P2 запрещён без K1 PASS. Переход Stage 08 требует S1 PASS; незавершённый K1 фиксируется blocker для P2 и должен быть закрыт до AI subphase Stage 08.

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Найти current frontend/backend seams | routes, stores, queries, Message/Trace/Folder | lane map | graph/source validation |
| Проектирование / Product-UX architect | Сохранить Ketos design system | Board/Chat/Project/Search states | UX spec/oracles | existing component/token comparison |
| Board backend/frontend | A1 | S07-T02–T06 | Board feature | CAS/perf/a11y/Chrome evidence |
| Chat backend/frontend | H1 | S07-T07–T10 | durable multi-chat | 20-run/restart/import/attachment tests |
| Command implementer | K1 | S07-T11 | proposal schemas/service | golden/negative/zero-mutation |
| Project/Search implementer | I1 | S07-T12–T13 | hierarchy/federated search | cycle/leakage/pagination |
| Testing/compatibility | Q1 | S07-T14 | continuous evidence | Flow/KFX/LFX/API/coverage reruns |
| Security auditor | Actor/metadata/capabilities | Board/Chat/Search/import/attachments | security verdict | two-user adversarial matrix |
| Accessibility/i18n reviewer | Keyboard/RU/EN/pseudo | Board/Chat/sidebar/search | a11y/i18n verdict | keyboard/focus/overflow/screen-reader |
| Documentation | User/API/import/runbook | current docs | doc bundle | links/copy/technical accuracy |
| Requirements/compliance | R-01/05–09/23/26–30/35/36/38/40 | traceability | verdict | no premature Editor/AI/Run claim |
| Independent S1 reviewer | Falsify integration | S07-T15 | PASS/FAIL/BLOCKED | Не implementer; current RC replay |

Superpowers, Graphify, Product Design и все доступные релевантные tools обязательны. Chrome используется для live geometry, focus, deep-link, responsive и visual verification выбранного пользователем browser surface; «Компьютер» — для read-only OS/window behavior, если Chrome API не покрывает его. Screenshot сверяется с source state/network/tests и не является единственным proof.

## 7. Зависимости от предыдущих этапов

Требуются F1-C read cutover, F1-R APIs, Command/Job/security/flag foundations, X-A/X-C decisions и C1 UX/data contracts. Stage 07 не может внедрить embedded editor, run/results или AI apply — эти зависимости закрываются в Stage 08.

## 8. Предполагаемые результаты

- Multiple Project-scoped Boards и restored placements/viewport.
- Durable independent Chat windows/history/import.
- Typed proposal creation without apply.
- Project hierarchy and permission-first search.
- Continuous Q1 compatibility/security/performance/i18n evidence.
- S1 release candidate и rollback via backend flags.

## 9. Критерии завершения задач

Каждый UI task имеет reducer/controller/unit + live Chrome/a11y proof; backend task — model/service/API/auth/concurrency tests; import — idempotency/atomicity/privacy; search — pre-rank authorization/adversarial timing/count; proposal — canonicalization/zero mutation. Evidence tied to same RC SHA.

## 10. Общие критерии этапа

- [ ] S07-T01…T15 PASS, либо K1 отдельно закрыт до Stage 08 P2 admission.
- [ ] Project содержит multiple Boards; Chat/Note close/reopen без deletion.
- [ ] Restart restores Project/Board/viewport/placements/Chat history.
- [ ] 20 ChatRuns: zero cross-chat leakage, exactly-once recovery.
- [ ] Local import truthful, opt-in, repeat-safe, atomic.
- [ ] Other actor не discovers/opens/mutates any Project/Board/Placement/Chat/Note/attachment/search metadata.
- [ ] System folders valid/protected; global-name behavior preserved.
- [ ] 100/500/1000 Board performance, keyboard, RU/EN/pseudo PASS.
- [ ] Q1 Flow/KFX/LFX/API/coverage/security PASS.
- [ ] Independent S1 integration verdict PASS.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Board controller becomes global | Scope per mounted Board; isolation tests |
| Close deletes entity | Separate commands/permissions/UI; destructive confirm |
| 20 chats share buffer/controller | Per-chat Run/controller/AbortController; interleaving oracle |
| Legacy/local import overclaims | Preview/source truth/quarantine/checksum; no automatic “complete history” |
| Search ranks before auth | Permission filter before rank/count/snippet; adversarial corpus |
| Registrar conflicts | Exclusive routes/locale/shell registrars |
| Visual polish breaks semantics | Existing design system + Product Design/a11y review |

## 12. Тестирование, проверка и документация

Focused frontend/backend tests; React Query/controller/store tests; API/CAS/idempotency; 20-stream and kill/restart; import fuzz/size/atomicity; two-user search; keyboard/focus/screen-reader; RU/EN/pseudo; Chrome fixed viewports; 100/500/1000 performance/heap; Flow/KFX/LFX/API compatibility and coverage. Docs: Board/Chat/Project/Search user/API guides, import privacy, feature flags, known limits, rollback.

## 13. Условия невыполнения

Любая entity deletion через close, lost update, cross-chat leakage, duplicate turn, forbidden metadata flash/leak, non-atomic import, unprotected system folder, performance/a11y threshold failure, compatibility regression или missing reviewer означает NO-GO. Visual-only success не закрывает backend/security.

## 14. Условия перехода

Stage 08 начинается только при `этап выполнен`, `GO`, S1 PASS и current Q1 evidence. K1 должен быть PASS до входа в P2; если S1 PASS, но K1 partial, Stage 08 может начать только E2/R2/U2 work, а P2 остаётся hard-blocked до K1 closure.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | A1/H1/K1/I1/Q1/S1 и S07-T IDs |
| Невыполненные задачи | Причина, owner, unblock, blocked Stage 08 scope |
| Частично выполненные задачи | Доказанные/недоказанные user/domain flows |
| Обнаруженные дефекты | Severity, reproduction, affected Board/Chat/Project/Search |
| Активные блокеры | API/UX/security/performance/reviewer blocker |
| Результаты тестирования | Board/chat/import/search/security/a11y/i18n commands/artifacts |
| Результаты проверки субагентами | Lane handoffs и independent S1 verdicts |
| Соответствие критериям завершения | Каждый пункт §10 и K1/S1/Q1 status |
| Вывод о возможности перехода | `GO`/`NO-GO` и разрешённые Stage 08 subphases |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 07
Статус: этап выполнен | этап выполнен частично | этап заблокирован
S1/K1/Q1: <PASS/FAIL/BLOCKED>
Переход: GO | NO-GO
## Lane/task status
<A1/H1/K1/I1/Q1; S07-Txx + evidence>
## Product/security/performance results
<Chrome/a11y/chat/import/search/compat>
## Defects/blockers/subagents
<severity, owner, unblock, verdict>
## Completion criteria
<§10>
## Status justification
<concrete current-SHA links>
```
