# Этап 04 — Заморозка доменных контрактов, ADR, API, безопасности и delivery policy

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, §§2–6, C1-D/A/S/Q и Required artifacts.
> **Вход:** Этап 03 — `этап выполнен`, `GO`; B0/W0/X evidence current.
> **Следующий файл:** `19_KETOS_STAGE_05_BACKWARD_COMPATIBLE_FOUNDATIONS.md`.
> **Обязательный режим:** минимум шесть contract-субагентов и независимые reviewers; использовать все доступные применимые инструменты для schema, API, threat, UX, compatibility и documentation validation.

## 1. Контекст этапа

После экспериментов независимые implementation lanes могут работать параллельно только при frozen interfaces. Без C1 data team может создать новый Workspace/AutomationExecution, frontend — смешать Board geometry и Flow, AI — применить другой IR, migration — разрушить `session_id`, а rollback — оказаться невозможным. Этап фиксирует версии контрактов; он не реализует production models/API.

Канонические решения: Workspace — application shell, Project — существующий `Folder`; Flow=Automation; Job=AutomationExecution persistence; MessageTable хранит body/files; Board и Flow — разные домены; entity и Placement различны; Flow.revision — CAS, FlowVersion — immutable snapshot; deployment attachment не переназначается activation; actor всегда server-derived.

## 2. Цель этапа

Опубликовать валидируемый комплект ADR/OpenAPI/JSON Schema/security/privacy/compatibility/coverage/feature-flag/observability контрактов, достаточный для независимой реализации F1-E/K/J/S/O/R без трактовочных пробелов, destructive migration и скрытых live surfaces.

## 3. Подробное техническое задание

### C1-D — domain/data

Зафиксировать scope без Workspace table; Board/Placement/Viewport/UserState schemas; Chat identity/import; Message/attachment retention; Project hierarchy/system roles; Flow revision/FlowVersion/deployments; ExecutionResult; Trace correlation; NoteNode↔BoardNote conversion.

### C1-A — API/stream/command

Определить versioned resources Boards/Placements/Notes/Chats/Search/Commands/Execution и расширение `/api/v1/projects`; pagination/sort/filter/ETag/revision/409/idempotency/anti-enumeration; command registry; event envelopes/replay/cancel; adapter semantics для MCP/Responses/agentic/webhook/REST.

### C1-S — security/privacy/capabilities

Закрыть route×profile×actor×resource×action×ownership×authz×rate×size×egress×secret×audit matrix; startup manifests; capabilities; confirmation binding; retention/export/delete; fail-closed outages.

### C1-Q — compatibility/UX/delivery

Зафиксировать Flow/KFX/LFX/API/extensions/DB/browser/Desktop matrix; LFX 974; RU/EN/pseudo-locale/accessibility/semantic zoom/deep links/lost-window; OpenSwarm provenance; numeric coverage ratchet; feature flags; observability/SLO; R-34 removal telemetry window.

## 4. Перечень задач и task-level DoD

| ID | Задача | Результат | Проверяемый критерий |
| --- | --- | --- | --- |
| S04-T01 | Scope/terminology/identity ADR | ADR-001 + glossary | Нет new Workspace/Project/AutomationExecution duplicate; IDs однозначны |
| S04-T02 | Board/Placement contracts | ADR-002/004 + schemas | Exactly-one target, same Project/Board, close/archive/delete semantics |
| S04-T03 | Chat/message/import contracts | ADR-005 + retention | `chat_id/session_id/context_id/run_id` разделены; body/files canonical |
| S04-T04 | Project/system-folder contracts | schema/policy | Depth=5, cycles/move/root/order, global name uniqueness retained |
| S04-T05 | Flow revision/version/deploy contracts | ADR-006 | CAS 409; rollback=new revision; attachment identity unchanged |
| S04-T06 | Job/result/trace contracts | state/API schemas | Legal transitions, pinning, result XOR payload/ref, read auth/retention |
| S04-T07 | Command IR/registry | JSON Schema + risk table | Version/risk/confirmation/compensation/audit defined for every command |
| S04-T08 | REST/event contracts | OpenAPI + fixtures | Positive/negative examples validate; cursor/dedup/cancel versioned |
| S04-T09 | Security/profile matrix | contract matrix | Нет unexplained blank; actor server-derived; outages specified |
| S04-T10 | Privacy/capability/confirmation | policy docs | Retention/export/delete and one-use nonce binding complete |
| S04-T11 | Compatibility/UX/i18n | compatibility matrix | Flow/KFX/LFX/API/DB/browser/Desktop + RU/EN/a11y commands fixed |
| S04-T12 | Coverage/flags/observability | three policies | Numeric ratchet from Stage 01; backend enforcement; SLO/cardinality/redaction |
| S04-T13 | R-01–R-40 traceability | matrix | 40/40 rows have owner, phase, API/data, test, rollback, release gate |
| S04-T14 | Multi-discipline review | signed verdicts | Architecture/data/security/frontend/compat/docs independent PASS |

## 5. Подэтапы и параллельность

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S04.0 Contract register | Нет | Stage 03 GO | versions/owners/dependencies | Coordinator/architect | all X decisions mapped | Все C1 lanes |
| S04.1 C1-D | Внутри по bounded schemas | S04.0 | domain/data ADRs | Data/domain agents + DB registrar | schema examples/invariants | C1-A/S/Q, F1-E |
| S04.2 C1-A | Да с поздними D/S/Q, но consumes IDs | S04.0 + relevant C1-D drafts | OpenAPI/IR/events | API/command agents | parser + negative fixtures | F1-K/J/R |
| S04.3 C1-S | Да | S04.0 + W0 evidence | security/privacy contracts | Security/privacy | threat/matrix blank scan | F1-S/K/R |
| S04.4 C1-Q | Да | S04.0 + B0/X data | compatibility/UX/delivery | Frontend/Product Design/compat | command/coverage/UX review | F1-O, all waves |
| S04.5 Cross-contract reconciliation | Нет | S04.1–S04.4 | consistent frozen versions | Coordinator + compliance | ID/type/state/flag/rollback diff | Review |
| S04.6 Independent review | Reviewers параллельно; fix serial | S04.5 | six verdicts | Independent panel | rerun schema/OpenAPI/matrix checks | Переход |

DB, OpenAPI/API router, frontend shell/routes, locale, flag/telemetry и release workflow имеют одного registrar. В C1 изменяются только документы/schema artifacts, не production code или migrations.

## 6. Распределение субагентов

| Субагент | Цель | Зона/задачи | Ожидаемый результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Сверить contracts с реальностью | Current models/routes/stores/KFX/LFX chains | source-backed contract inputs | Graph/source citations |
| Проектирование / domain-data architect | C1-D | S04-T01–T06 data semantics | ADR/schema bundle | invariants + dual-DB feasibility review |
| API/stream architect | C1-A | S04-T07–T08 | OpenAPI/events/errors | parser and negative fixtures |
| Command/security architect | IR/risk/confirmation | S04-T07/T09/T10 | kernel contract | replay/stale/outage threat review |
| Frontend/Product Design | UX/application shell | Board/editor/chat/navigation/a11y/i18n | UX contract | existing design-system/source pattern review |
| Compatibility/release | C1-Q | S04-T11/T12 | matrices/gates | exact commands and floor/rollback review |
| Testing architect | Сделать contracts проверяемыми | transition/negative/perf/coverage plan | test matrix | no vague “test above” rows |
| Documentation/provenance | Versioned artifacts | ADR links, OpenSwarm categories, change policy | coherent docs | Markdown/schema/link validation |
| Requirements/compliance | Full R/GC coverage | S04-T13 | traceability matrix | 40/40 + 18/18 scan |
| Independent reviewers | Falsify each discipline | S04-T14 | PASS/FAIL/BLOCKED | Reviewer не автор; cross-contract spot-check |

Superpowers и Graphify обязательны; все доступные релевантные schema/API/security/documentation tools применяются. Product Design проверяет соответствие существующей design system и user flows. Chrome/«Компьютер» используются только для source-backed review существующих интерактивных patterns, если это действительно влияет на UX contract; они не заменяют OpenAPI/schema evidence.

## 7. Зависимости от предыдущих этапов

Нужны current Stage 01 baselines, Stage 02 W0 safe floor и все selected/rejected X decisions Этапа 03. Если mandatory experiment завершён kill decision, C1 обязан явно уменьшить scope; нельзя писать contract так, будто experiment PASS.

## 8. Предполагаемые результаты

Обязательные artifacts:

- `ADR-001-v1-scope-without-workspace-entity.md` … `ADR-006-flow-revision-and-deployments.md`;
- `openapi-board-chat-command.yaml`, `command-ir-v1.schema.json`;
- `security-coverage-matrix.md`, `retention-and-deletion.md`;
- `compatibility-matrix.md`, `feature-flags.md`, `coverage-policy.md`;
- state-machine/event/observability/UX contracts и R-01–R-40 traceability register.

## 9. Критерии завершения каждой задачи

Artifact считается готовым, если имеет owner/version/status, normative language, examples и negative fixtures, dependency/rollback/test/release fields, link на source/experiment evidence и independent verdict. Исправление frozen contract создаёт новую версию/ADR, а не silent rewrite.

## 10. Общие критерии этапа

- [ ] S04-T01…T14 PASS.
- [ ] 40/40 requirements имеют owner/phase/API-data/test/rollback/release gate.
- [ ] Все §3.2 live surfaces имеют containment/migration owner.
- [ ] JSON Schema/OpenAPI positive/negative fixtures validate.
- [ ] Нет FK к несуществующему Workspace и параллельного Project router.
- [ ] Folder global uniqueness не меняется в F1.
- [ ] State-machine names/types consistent между data/API/tests.
- [ ] Numeric coverage/operation/SLO/observation contracts не оставлены неопределёнными там, где они нужны downstream.
- [ ] Architecture, data, security, frontend, compatibility и independent reviewers дали PASS.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Contradictory IDs/types между ADR/OpenAPI/IR | Central contract register + automated cross-schema review |
| Порог выдуман без baseline | BLOCKED до Stage 01/03 measurement; record exact missing data |
| Live route пропущен как “future” | Reconcile с Stage 01 registered-router inventory |
| Scope experiment failed | Formal kill/scope ADR; не скрывать |
| Compatibility требует destructive change | Defer to C7; сохранить additive adapter |
| UX contract изобретает новую design system | Использовать существующие Ketos patterns/tokens/components |
| Review совмещён с авторством | Назначить отдельного reviewer; verdict иначе недействителен |

## 12. Тестирование, проверка и документация

Запустить Markdown/link/fence/table validators, JSON Schema validation, OpenAPI parse/lint/snapshot, positive/negative fixtures, state-machine completeness scan, route-matrix blank scan, 40/40 and 18/18 traceability scan, path existence check, terminology scan и `git diff --check`. Все Python commands — через `uv run`. Документы содержат security/privacy/rollback/compatibility implications и change/version policy.

## 13. Условия невыполнения

Этап невыполнен при любом пропущенном requirement/live surface; unresolved identity/ownership/state/rollback contradiction; invalid schema/OpenAPI; отсутствующем numeric downstream contract; new Workspace/parallel Project assumption; silent destructive migration; неполном independent review. `PARTIAL`/`BLOCKED` запрещает F1.

## 14. Условия перехода

Этап 05 начинается только при `этап выполнен`, `GO`, всех S04-T PASS и frozen artifact hashes. Любое дальнейшее изменение contract требует versioned amendment и re-approval затронутых downstream lanes.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | S04-T IDs, frozen versions/hashes |
| Невыполненные задачи | Missing contract, owner и unblock |
| Частично выполненные задачи | Unfrozen/ambiguous clauses и downstream impact |
| Обнаруженные дефекты | Contradictions/invalid fixtures/severity |
| Активные блокеры | Missing baseline/decision/reviewer и recheck |
| Результаты тестирования | Schema/OpenAPI/link/traceability validations, exits/hashes |
| Результаты проверки субагентами | Discipline handoffs и independent verdicts |
| Соответствие критериям завершения | 40/40, 18/18 и каждый пункт §10 |
| Вывод о возможности перехода | `GO`/`NO-GO` с перечислением frozen inputs F1 |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 04
Статус: этап выполнен | этап выполнен частично | этап заблокирован
Переход: GO | NO-GO
## Frozen artifacts
<version, hash, owner, validation>
## Task and review status
<S04-Txx + evidence/verdict>
## Defects/blockers/contract amendments
<impact, owner, unblock>
## Completion criteria
<каждый §10 criterion>
## Обоснование статуса
<почему F1 разрешён/запрещён>
```
