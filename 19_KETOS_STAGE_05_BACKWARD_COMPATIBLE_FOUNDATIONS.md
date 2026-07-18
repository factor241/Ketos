# Этап 05 — Additive schema, Command Kernel, Job engine, security/telemetry и совместимые API

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, F1-E/K/J/S/O/R.
> **Вход:** Этап 04 — `этап выполнен`, `GO`, frozen contract hashes.
> **Следующий файл:** `20_KETOS_STAGE_06_DUAL_WRITE_MIGRATION_CUTOVER.md`.
> **Обязательный режим:** F1-E/K/J/S/O выполняются параллельными субагентами в отдельных worktrees; F1-R стартует только после PASS всех пяти lanes. Использовать все доступные применимые инструменты и эксклюзивных registrars.

## 1. Контекст этапа

Product UI нельзя строить поверх transient/local state. Сначала Ketos получает forward-compatible persistence, typed mutation kernel, durable execution state machine, security enforcement, flags/telemetry/coverage и default-off APIs. Этап расширяет существующие Folder/Flow/FlowVersion/Job/Message/Trace, не создаёт параллельные Project/AutomationExecution stores и не удаляет legacy contracts.

Критические границы: `Flow.revision` выполняет CAS, `FlowVersion` остаётся immutable; `MessageTable` сохраняет body/files/session/context; `Job` pin-ит Flow и владеет execution lifecycle; `CommandExecution` — durable truth, `AuthzAuditLog` — только diagnostic; feature flag блокирует backend mutation, а не только UI.

## 2. Цель этапа

Развернуть выключенный/контролируемый additive foundation, на котором можно безопасно включить dual-write: новые модели и миграции, Command Kernel/outbox, Job transition/replay/result foundation, profile-aware security, metrics/coverage/compatibility gates, domain services/API/adapters и expected-revision Flow paths.

## 3. Подробное техническое задание

### F1-E

Создать Board/Viewport/UserState/Placement/BoardNote/BoardRelation/ChatThread/ChatLegacySession/ChatTurn/ChatRun/ExecutionResult/Command models; additively расширить Flow, FlowVersion, Job, MessageTable, TraceTable, Folder; зарегистрировать models/Alembic; проверить fresh/prior/mixed SQLite/PostgreSQL и N-1 compatibility до новых writes.

### F1-K

Реализовать typed versioned registry, auth-derived context, validation/authz/risk/CAS/idempotency/audit/outbox transaction, one-use confirmation path и crash points. Same tuple+fingerprint replay-ит stored response, changed fingerprint конфликтует.

### F1-J

Реализовать legal Job transitions, CAS transition version, terminal immutability, attempt/lease/epoch/fencing/retry, deterministic cancel-vs-complete, revision/hash/version pinning, atomic run idempotency, durable ordered events и workflow v2 adapters.

### F1-S/O

Ввести profile startup validation, complete route matrix, shared limiter/budgets/capabilities; backend flags, bounded metrics, coverage ratchet, LFX normal/regeneration lanes, KFX/LFX release compatibility, Desktop matrix и `reactflow` v11 import guard.

### F1-R

После PASS пяти foundations создать Board/Placement/Note/Relation/Chat/Search services, default-off routers, extend `/api/v1/projects`, expected revision Flow PATCH/activate, deployment compatibility, trace correlation и adapters current live surfaces без собственного auth/state truth.

## 4. Задачи и task-level verification

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S05-T01 | Foundation admission/registers | lane/registrar manifest | C1 hashes current; scopes/worktrees exclusive |
| S05-T02 | New additive models | model packages/constraints | FKs/revisions/exactly-one checks match C1; no Workspace FK |
| S05-T03 | Existing model extensions | Flow/Version/Job/Message/Trace/Folder fields | Existing semantics/identity preserved |
| S05-T04 | Alembic migrations | expand-only revisions | SQLite/PostgreSQL fresh/prior PASS; no destructive operation |
| S05-T05 | Command registry/context | typed service | Invalid schema/auth/scope rejected before side effect |
| S05-T06 | Idempotency/confirmation/outbox | transaction engine | One effective mutation; changed fingerprint conflict; crash recovery deterministic |
| S05-T07 | Job transition engine | durable state machine | Every legal/illegal edge tested; terminal immutable; fencing works |
| S05-T08 | Job run/replay/result pinning | execution foundation | Same key→same Job; revision/hash/version fixed; events resumable |
| S05-T09 | Security enforcement | profiles/limiter/capabilities | New/current routes satisfy C1 matrix; outage fail-closed |
| S05-T10 | Flags/metrics/coverage | backend gates | Flag off blocks mutation; metrics bounded; numeric ratchet enforced |
| S05-T11 | LFX/KFX/Desktop/dependency | compatibility artifacts | 974 corpus/wheel order/manifest/guard/status PASS |
| S05-T12 | Domain services | Board/Placement/Note/Relation/Chat/Search | Ownership/project/CAS/delete semantics match C1 |
| S05-T13 | Routers/projects/Flow paths | APIs/OpenAPI | Default-off; no parallel Project router; stale returns 409 zero effects |
| S05-T14 | Live-surface adapters | MCP/Responses/agentic/webhook/workflow | Same actor/authz/run/command semantics; adapters own no truth |
| S05-T15 | Integration closure | migration/security/compat review | All F1 criteria current-SHA PASS; rollback targets tested |

## 5. Подэтапы и параллельность

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S05.0 Admission | Нет | Stage 04 GO | worktree/registrar/contracts lock | Coordinator | SHA/hash/status checks | Все lanes |
| S05.1 F1-E | С F1-K/J/S/O | S05.0 | schema/migrations | DB/model agents + Alembic registrar | dual-DB/N-1 matrix | F1-R, Stage 06 |
| S05.2 F1-K | С E/J/S/O | S05.0 | Command Kernel | Command agents | race/crash/replay suite | F1-R, K1/P2 |
| S05.3 F1-J | С E/K/S/O | S05.0 | Job engine/events | Execution agents | transition/cancel/lease/restart | F1-R, R2 |
| S05.4 F1-S | С E/K/J/O | S05.0 + W0 | enforced profiles/capabilities | Security agents | actor/outage/abuse matrix | F1-R/all APIs |
| S05.5 F1-O | С E/K/J/S | S05.0 + C1 metrics | flags/telemetry/coverage/compat | Observability/compat | flag-off/coverage/LFX artifacts | F1-R/release |
| S05.6 Foundation sync | Нет | S05.1–S05.5 PASS | stable interfaces | Coordinator + registrars | cross-lane types/migrations | F1-R |
| S05.7 F1-R services/API | Services parallel; central merge serial | S05.6 | default-off APIs/adapters | Domain/API agents | unit/API/OpenAPI/security | Stage 06 |
| S05.8 Independent closure | Reviewers параллельно | S05.7 | release-candidate verdict | Independent panel | full focused-to-package matrix | Переход |

PostgreSQL, full pytest, frontend build, Playwright и Graphify rebuild сериализуются. Model/API/OpenAPI/flag central files редактирует только registrar. Shared interfaces меняются versioned amendment, а не ad hoc cross-worktree edit.

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Актуализировать file/call map | Models/services/routes/adapters | implementation map | graph/source check |
| Проектирование / foundation architect | Согласовать interfaces lanes | C1 types, registrars, rollback/abort boundaries | architecture handoff | cross-lane contract review |
| Data/model implementers | F1-E | S05-T02–T04 | schema/migrations/tests | SQLite/PostgreSQL/N-1 |
| Command implementers | F1-K | S05-T05–T06 | Kernel/outbox | race/crash/security corpus |
| Execution implementers | F1-J | S05-T07–T08 | Job/events | transition/restart suite |
| Security implementers | F1-S | S05-T09 | profiles/limits/capabilities | route×actor×profile matrix |
| Observability/compat | F1-O | S05-T10–T11 | gates/artifacts | CI/flag/metrics/LFX checks |
| Domain/API implementers | F1-R | S05-T12–T14 | services/routers/adapters | OpenAPI/API/integration |
| Frontend/Product Design reviewer | Проверить API support будущих UX states | forbidden/loading/conflict/deep-link contracts | findings/required fields | C1 UX matrix; no UI implementation |
| Testing | Cross-lane verification | migration/race/API/compat | evidence manifest | rerun on integration SHA |
| Security audit | Falsify Kernel/Job/API | replay/stale/outage/IDOR | independent verdict | zero Critical/High |
| Documentation | Models/API/runbooks | schemas/flags/rollback/adapter docs | current docs | parser/link/hash checks |
| Requirements/compliance | GC/R/F1 coverage | trace all S05 tasks | compliance verdict | no duplicate backend/entity |
| Independent reviewers | Migration/security/compat | S05-T15 | PASS/FAIL/BLOCKED | Separate from implementers |

Обязательны Superpowers, Graphify и все доступные релевантные implementation/test/security tools. Product Design проверяет, что contracts поддерживают существующие Ketos patterns. Chrome/«Компьютер» применяются только для smoke existing UI/flag-off behavior, если backend RC запущен; визуальный PASS не заменяет API/DB proof.

## 7. Зависимости от предыдущих этапов

Все C1 artifacts frozen. Stage 02 security floor нельзя ослаблять. Stage 03 decisions определяют compositor/editor/persistence/IR contracts, но product UI ещё не реализуется. Изменение C1 during F1 требует остановки affected lane и versioned re-approval.

## 8. Предполагаемые результаты

- Expanded schema, compatible migrations и registered models.
- Typed Command Kernel/outbox и durable Job engine.
- Security/flags/telemetry/coverage/compatibility infrastructure.
- Default-off Board/Chat/Command/Execution/Search APIs и projects extension.
- Current-surface adapters на единых contracts.
- Safe pre-dual-write rollback target.

## 9. Критерии завершения задач

Каждая задача имеет failing test, implementation, focused PASS, affected package gate, artifact+SHA/hash и review. Migration task требует dual-DB and N-1; state machine — every legal/illegal edge; idempotency — real concurrency; API — actor/profile negative matrix and OpenAPI snapshot; flags — backend mutation proof.

## 10. Общие критерии этапа

- [ ] S05-T01…T15 PASS.
- [ ] Every F1 subphase имеет artifact, abort condition и tested rollback.
- [ ] SQLite/PostgreSQL fresh/prior/mixed и pre-write N/N-1 PASS.
- [ ] Flow PATCH/activate race: one winner, one 409; deployments correct.
- [ ] Idempotency race: one effect/same replay; changed fingerprint conflicts.
- [ ] Job cancel/complete/retry/lease/restart PASS.
- [ ] New/current adapted routes имеют actor/profile matrix и OpenAPI snapshot.
- [ ] LFX 974 и KFX/LFX release artifact PASS.
- [ ] Flag off блокирует backend mutation.
- [ ] Migration/security/compatibility independent reviewers PASS.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Agents конфликтуют в registrars | Exclusive registrar + patch requests + serial merge |
| Migration требует data rewrite | Вынести в Stage 06 runner; F1-E остаётся expand-only |
| C1 type изменён | Block affected lanes; versioned contract amendment |
| Job/Command transaction расходится | Failure injection/crash points; one transaction/outbox contract |
| Legacy API ломается | Default-off flags, adapters, N-1/API snapshot tests |
| Feature flag только UI | Backend enforcement test обязательный |
| Full suite превышает RSS | Serialize heavy jobs; stop new agents at thresholds |

## 12. Тестирование, проверка и документация

Focused `uv run pytest`, ruff/format; Alembic fresh/prior/upgrade; SQLite/PostgreSQL; concurrent CAS/idempotency/lease; API actor/profile/OpenAPI; failure injection; KFX/LFX/API/extensions; coverage ratchet; frontend client-type/build smoke only where contracts touched. Документы: model/transition diagrams, API/IR versioning, flags, metrics/redaction, migration/rollback, adapters and compatibility. `make lint` не acceptance gate.

## 13. Условия невыполнения

Любая destructive migration, duplicate Project/Execution truth, actor from client, missing transition edge test, broken N-1 read, UI-only flag, route without negative matrix, invalid OpenAPI, unresolved Critical/High или missing independent verdict означает NO-GO. F1-R cannot start if any F1-E/K/J/S/O is partial/blocked.

## 14. Условия перехода

Stage 06 начинается только при `этап выполнен`, `GO`, PASS всех F1-E/K/J/S/O/R и pinned safe foundation build/schema head. До этого dual-write/backfill запрещены.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | S05-T IDs и F1 lane evidence |
| Невыполненные задачи | Lane/dependency, owner, unblock |
| Частично выполненные задачи | Готовые/неготовые interfaces и downstream impact |
| Обнаруженные дефекты | Severity, reproduction, affected model/API |
| Активные блокеры | Contract/DB/registrar/resource/reviewer blocker |
| Результаты тестирования | Migration/race/API/coverage/compat commands, exits, hashes |
| Результаты проверки субагентами | Handoffs и migration/security/compat verdicts |
| Соответствие критериям завершения | Каждый пункт §10 + rollback proof |
| Вывод о возможности перехода | `GO`/`NO-GO`, foundation build/schema head |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 05
Статус: этап выполнен | этап выполнен частично | этап заблокирован
Foundation SHA/schema/build: <...>
Переход: GO | NO-GO
## Lanes and tasks
<F1-E/K/J/S/O/R; S05-Txx; evidence>
## Migration/API/security/compatibility results
<commands, exits, hashes>
## Defects/blockers/reviews
<severity, owner, unblock, verdicts>
## Completion criteria and rollback
<§10 + tested target>
## Status justification
<current-SHA links>
```
