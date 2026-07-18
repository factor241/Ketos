# Этап 08 — Embedded Flow Editor, execution/results, navigation и AI safe apply

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, Wave 2 E2/R2/U2/S2/P2.
> **Вход:** Этап 07 — `этап выполнен`, `GO`, S1/Q1 PASS; K1 PASS обязателен до P2.
> **Следующий файл:** `23_KETOS_STAGE_09_ADAPTERS_RESTORE_HARDENING.md`.
> **Обязательный режим:** E2, R2 и U2 выполняются параллельными субагентами; S2 — serial integration barrier; P2 начинается только после S2+K1 PASS. Использовать все доступные применимые инструменты.

## 1. Контекст этапа

Этап превращает Board shell в рабочую Automation surface. Самые опасные границы: текущий Flow Editor имеет shared global state; run нельзя вызывать raw graph execution; result может содержать hostile/secret payload; navigation/search не должны показывать forbidden target; AI preview/confirmation нельзя обходить через `auto_apply`, `skipAll`, headless agentic или filesystem mutation.

Реализация обязана сохранить canonical manual Flow Editor, KFX identifiers, Flow serialization, deployment attachments и one editable lease. AI появляется только после того, как manual Automation можно place/edit/run/result/recover через S2.

**Явно покрываемые требования:** `R-10`, `R-11`, `R-12`, `R-13`, `R-14`, `R-15`, `R-16`, `R-17`, `R-18`, `R-19`, `R-20`, `R-21`, `R-22`, `R-24`, `R-25`, `R-29`, `R-32`, `R-33`, `R-34`, `R-35`, `R-37`, `R-38`, `R-39`, `R-40`. Переход закрывает только те требования, для которых S2/P2/Q1 дают current-SHA evidence.

## 2. Цель этапа

Доказать полный manual Automation lifecycle на Board и затем безопасный AI create/edit: isolated embedded/fullscreen editor, durable Job/result/events, authorized navigation/search/settings, typed preview/hash/risk/one-use confirmation/CAS/idempotency/audit/outbox и compensating revision rollback.

## 3. Подробное техническое задание

### E2

Извлечь per-instance Flow state/history/provider/autosave/pending/AbortController; scope hotkeys/DnD/events/DOM IDs; pure thumbnail без mutable global store; compact/preview/leased/fullscreen states; second editor flush/demote/unmount first fail-closed; stable return context across reload/tab/back.

### R2

Board Run вызывает Command Kernel/Job; pin actor/input/model/capabilities/revision/hash/version; atomic idempotency; durable ordered events; ExecutionResult with current read auth/retention; strict renderer registry; tombstone after purge; BoardRelation non-executable; capability/risk/confirmation before external/code/network action.

### U2

Sidebar New Chat/Search/Scheduled state/Automations/Projects/New Board; Project tree; Flow projection and canonical fullscreen editor; permission-safe search/deep links; one avatar/settings trigger; legacy telemetry/redirect/expiry/rollback; RU/EN/pseudo/focus/responsive/semantic zoom.

### P2

Planner uses current KFX registry; asks 0–5 validated questions; outputs typed Flow/Board/Chat/Note/Project operations; server preview exact diff/base revision/risk/capabilities/hash; bound one-use confirmation; atomic apply/new revision/snapshot/execution/outbox; stale 409; audited compensating revision; bypass scan.

## 4. Задачи и task-level DoD

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S08-T01 | Admission/instance map | E2/R2/U2 scopes | X-B/S1/F1-J/K1/Q1 status verified; registrars assigned |
| S08-T02 | FlowEditorInstance state | isolated store/provider/history | Two instances share zero mutable editor state |
| S08-T03 | Input/DOM/autosave isolation | scoped hooks/IDs/controllers | 100-scenario oracle; unique IDs; no duplicate autosave |
| S08-T04 | One-editor lease/fullscreen | lease/return context | Second editor safely demotes first; reload/new-tab/back restores context |
| S08-T05 | FlowThumbnail/manual compatibility | read-only preview | No mutable store import; open/save/build/run graph hash parity |
| S08-T06 | Board Run→Job | command/execution integration | Same key→same Job/result; pinned revision reconstructible after edit |
| S08-T07 | Events/cancel/restart | run state UI/replay | All states/cancel races/restarts deterministic |
| S08-T08 | ExecutionResult/renderer | safe registry/tombstone | Hostile corpus sanitized/limited; auth rechecked; purged secret absent |
| S08-T09 | BoardRelation/capabilities | relation/run controls | Relation edit leaves Flow byte-identical; risky actions confirmed |
| S08-T10 | Navigation/sidebar/project/search/settings | U2 UI | Correct authorized target; no forbidden flash; one settings trigger |
| S08-T11 | Legacy route transition/i18n/a11y | redirects/telemetry/UX | Replacement proof, rollback, RU/EN/pseudo/focus/responsive PASS |
| S08-T12 | S2 barrier | manual lifecycle RC | Place→preview→edit→fullscreen→run→result→restart PASS |
| S08-T13 | AI planner/clarification | KFX-valid typed operations | No invented component; 0–5 questions only when required ambiguity |
| S08-T14 | Preview/confirmation | server canonical diff/hash | Actor/scope/hash/revision/risk/expiry bound; one-use |
| S08-T15 | Atomic safe apply/rollback | Flow revision/snapshot/command/outbox | Applied hash=confirmed; one effect; stale 409; compensating revision works |
| S08-T16 | Bypass/adversarial closure | route/import/AST scan + races | No production Flow mutation outside kernel/adapters; reviewers PASS |

## 5. Подэтапы и параллельность

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S08.0 Admission/design oracle | Нет | Stage 07 GO | scopes/registrars/100 scenarios | Coordinator + Product Design | X-B oracle/current source match | All lanes |
| S08.1 E2 Editor | С R2/U2 | S08.0 | isolated editor/lease | Editor frontend agents | unit/Chrome/100 scenarios/golden hash | S2 |
| S08.2 R2 Execution core | С E2/U2; UI integration waits E2 | S08.0, F1-J | Job/result/replay/relation | Execution backend/frontend | concurrency/restart/security | S2 |
| S08.3 U2 Navigation | С E2/R2 | S08.0, I1/S1 | shell/navigation/settings | Shell/frontend registrar | deep-link/forbidden/a11y/i18n | S2 |
| S08.4 Q1 continuous | Постоянно; heavy serial | S08.0 | regression evidence | Testing/compat | Flow/KFX/LFX/API/coverage/perf | S2/P2 |
| S08.5 S2 integration | Нет | E2/R2/U2/Q1 PASS | manual Automation RC | Coordinator/registrars | full lifecycle/restart/two tabs | P2 |
| S08.6 P2 planner/preview | Internal lanes parallel | S2 + K1 PASS | proposal/preview/confirmation | AI/Command/Security | schema/golden/adversarial | Apply |
| S08.7 P2 apply/bypass | Registrar merge serial | S08.6 | safe production apply | Flow registrar + security | races/crash/AST-route scan | Review |
| S08.8 Independent closure | Reviewers параллельно | S08.7 | GO/NO-GO | Editor/security/compat reviewers | replay selected cases | Stage 09 |

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Найти global editor/mutation paths | stores/hooks/routes/auto_apply/skipAll/files | current path map | graph/source/AST cross-check |
| Проектирование / Product Design-UX | Interaction/focus/navigation oracle | editor lease, window states, sidebar/settings | UX acceptance spec | Existing design system; live Chrome comparisons |
| Editor implementers | E2 | S08-T02–T05 | isolated editor | 100 scenarios + golden parity |
| Execution implementers | R2 | S08-T06–T09 | Job/result/replay | multiworker/restart/hostile corpus |
| Navigation frontend | U2 | S08-T10–T11 | shell/redirects/settings | deep-link/a11y/i18n/Chrome |
| AI planner implementer | P2 generation | S08-T13 | KFX-valid typed planner | registry-schema corpus |
| Command/Flow implementers | Preview/apply | S08-T14–T15 | safe apply/revision/outbox | concurrency/crash/hash tests |
| Security auditor | Capabilities/bypass | S08-T08/T09/T14–T16 | adversarial verdict | direct imports/routes/replay/outages |
| Testing/compatibility | S2/Q1/full story | S08-T12/T16 | evidence bundle | same RC SHA; focused→package→E2E |
| Documentation | Editor/run/result/AI guides | UX/API/risk/rollback | docs | link/copy/technical validation |
| Requirements/compliance | R-10–22/24–25/29/32–35/37–40 | traceability | verdict | no requirement/bypass gap |
| Independent reviewers | Editor/security/compat/release | final RC | PASS/FAIL/BLOCKED | Не implementers; current-SHA rerun |

Superpowers, Graphify, Product Design и все доступные релевантные tools используются. Chrome — обязательная live surface для nested gestures, geometry, focus, fullscreen/return, deep links, forbidden flash и responsive verification. «Компьютер» применяется для OS-level tab/window/fullscreen state, не покрытого Chrome API. Browser proof всегда сопоставляется с DOM/network/test artifacts.

## 7. Зависимости от предыдущих этапов

S1 и X-B нужны E2; S1/F1-J — R2; S1/I1 — U2; S2+K1 — P2. Stage 02 security floor и C1 confirmation/capability contracts не ослабляются. R2 UI, зависящий от editor, ждёт E2 integration.

## 8. Предполагаемые результаты

- Isolated one-lease embedded/fullscreen Flow Editor.
- Durable Board execution/results/relations with safe renderers.
- Unified navigation/search/settings with migration telemetry.
- S2 manual Automation proof.
- KFX-valid AI planner, exact preview, bound confirmation, atomic apply/rollback.
- Zero bypass production Flow mutation.

## 9. Критерии завершения задач

Editor tasks: component/store/controller unit tests + 100 scenarios + Chrome geometry/focus + Flow golden parity. Execution: transition/race/replay/restart/auth/renderer fuzz. U2: deep-link/network forbidden proof + a11y/i18n. AI: schema/golden/canonical hash/replay/stale/cross-actor/revocation/crash and AST/import/route bypass scan.

## 10. Общие критерии этапа

- [ ] S08-T01…T16 PASS.
- [ ] Exactly one editor lease across two placements/tabs; zero leakage/duplicate IDs/autosave.
- [ ] Manual Flow open/save/build/run and serialized graph parity PASS.
- [ ] Job revision/result/events survive browser/backend/worker restart.
- [ ] Hostile result safe; purged payload shows tombstone; current auth checked.
- [ ] BoardRelation does not change Flow hash.
- [ ] Navigation opens correct authorized target with no forbidden flash.
- [ ] S2 and Q1 PASS.
- [ ] Applied AI hash equals confirmed hash; exactly one effect; stale/replay/cross-actor fail.
- [ ] No bypass mutation path; independent editor/security/compat PASS.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Shared global editor state remains | Stop; extract instance boundaries; one lease fallback |
| Gesture ambiguity/focus loss | Container-scoped handlers + Chrome oracle + deterministic return |
| Cancel vs complete race | F1-J transition CAS/fencing; deterministic winner tests |
| Result leaks secret/hostile markup | Typed schema, sanitizer, limits, current auth, tombstone |
| Forbidden target flashes | Auth before render/data; network/screenshot assertions |
| AI invents components | Current KFX registry/schema validation before preview |
| `auto_apply`/`skipAll` bypass | Server disables; route/import/AST scan and direct tests |

## 12. Тестирование, проверка и документация

Unit/controller/store/API; nested editor Playwright/Chrome oracle; graph golden; multiworker Job/restart/cancel; renderer fuzz/security; navigation/deep-link/two-user; RU/EN/pseudo/keyboard/screen-reader; AI canonicalization/confirmation/race/crash/bypass; compatibility/coverage/performance. Python через `uv run`; heavy suites serial. Docs описывают lease, states, result schemas, risk/confirmation, rollback and legacy route transition.

## 13. Условия невыполнения

Cross-instance mutation, more than one editable lease, graph compatibility regression, duplicate/lost Job effect, unsafe result, forbidden flash, relation→Flow mutation, unclear AI diff/hash, reusable confirmation, stale apply, bypass path, missing S2/Q1/reviewer — любой даёт NO-GO.

## 14. Условия перехода

Stage 09 начинается только при `этап выполнен`, `GO`, S2+P2+Q1 PASS и zero unresolved Critical/High. Partial Editor/Execution/U2/AI запрещает M3 adoption.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | E2/R2/U2/S2/P2/Q1 и S08-T IDs |
| Невыполненные задачи | Причина, owner, unblock, blocked adapter work |
| Частично выполненные задачи | Ready/missing editor/run/navigation/AI behavior |
| Обнаруженные дефекты | Severity, reproduction, bypass/leakage impact |
| Активные блокеры | K1/S2/security/compat/browser/reviewer blocker |
| Результаты тестирования | Chrome/Computer/API/race/restart/AI/compat commands/artifacts |
| Результаты проверки субагентами | Lane handoffs и independent verdicts |
| Соответствие критериям завершения | Каждый пункт §10 и bypass scan result |
| Вывод о возможности перехода | `GO`/`NO-GO` к M3/G3/H4 |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 08
Статус: этап выполнен | этап выполнен частично | этап заблокирован
E2/R2/U2/S2/P2/Q1: <verdicts>
Переход: GO | NO-GO
## Tasks and evidence
<S08-Txx, commands, exits, hashes>
## Browser/product/security/compatibility results
<Chrome/Computer/network/a11y/AI bypass>
## Defects/blockers/subagents
<severity, owner, unblock, verdicts>
## Completion criteria/status rationale
<§10 + concrete links>
```
