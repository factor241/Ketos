# Этап 03 — Изолированные риск-эксперименты и выбор технических решений

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, Phase X, R-01/03/05/10/17/24/36 и GC-02/03/06/13/14/16–18.
> **Вход:** Этап 02 — `этап выполнен`, `GO`.
> **Следующий файл:** `18_KETOS_STAGE_04_CONTRACT_ADR_FREEZE.md`.
> **Обязательный режим:** X-A…X-E и X-G выполняются несколькими субагентами в disposable worktrees со всеми доступными применимыми инструментами; X-F optional и не блокирует V1.

## 1. Контекст этапа

Главные архитектурные риски нельзя честно закрыть prose-решением: Board compositor может не выдержать 500–1000 placements; текущий Flow Editor имеет глобальные stores/hotkeys/IDs; несколько ChatRuns могут смешать события; placement integrity/CAS должны одинаково работать на SQLite/PostgreSQL; AI preview должен иметь стабильный typed IR и hash; restore должен быть детерминированным. Production migrations до ответа на эти вопросы создадут дорогой lock-in.

Эксперименты используют фиксированные fixtures и не меняют production schema. Каждый выдаёт numeric benchmark, ADR input, recommendation и kill criteria. Неуспешный эксперимент меняет scope/architecture до Этапа 04, а не маскируется optimistic implementation.

## 2. Цель этапа

Экспериментально выбрать Board compositor, one-editor lease, multi-chat stream protocol, placement integrity/CAS strategy и typed AI IR; затем объединить победившие варианты в X-G и доказать deterministic restore/scale под общим RSS cap 16 GiB. Отдельно дать `PASS` или `DEFERRED` scheduler substrate без влияния на V1.

## 3. Подробное техническое задание

- Все fixtures, measurement harnesses, environment manifests и success/kill thresholds утверждаются до запуска.
- X-A сравнивает DOM/CSS-transform и outer XYFlow на одинаковых 100/500/1000 fixtures.
- X-B создаёт `FlowEditorInstance` harness и проверяет store/history/provider/autosave/AbortController/hotkeys/DnD/DOM ID isolation и one editable lease.
- X-C моделирует 1/5/10/20 ChatRuns, reconnect/dedup/cancel и независимость state.
- X-D сравнивает typed nullable FKs+CHECK с registry table и проверяет Board/Placement/Viewport CAS на обеих DB.
- X-E определяет minimal versioned IR, canonical diff/hash и негативные replay/stale/expiry сценарии без production mutation.
- X-F оценивает scheduler и либо выпускает ADR, либо честно `DEFERRED`.
- X-G объединяет выбранные решения, выполняет restart/restore и scale test.

## 4. Задачи и task-level verification

| ID | Задача | Ожидаемый результат | Критерий завершения |
| --- | --- | --- | --- |
| S03-T01 | Experiment charter | frozen fixtures/metrics/thresholds | Порог утверждён до измерения; environment и kill rule указаны |
| S03-T02 | X-A compositor | benchmark + recommendation | 100/500/1000: cold render, p50/p95, long tasks, heap, offscreen, pointer latency |
| S03-T03 | X-A interaction/accessibility | behavior oracle | Move/resize/z/collapse/max/fullscreen/close/minimap/keyboard PASS |
| S03-T04 | X-B editor isolation | harness + 100-scenario oracle | Zero cross-instance mutation/duplicate IDs; deterministic focus; one lease |
| S03-T05 | X-C multi-chat | stream/reconnect benchmark | 1/5/10/20; zero cross-chat event/message/cancel leakage |
| S03-T06 | X-D persistence options | decision matrix/query plans | Integrity/cascade/extensibility/CAS proven on SQLite/PostgreSQL |
| S03-T07 | X-D semantics | placement/relation proof | Close preserves entity; explicit delete policy; Flow JSON hash unchanged |
| S03-T08 | X-E command IR | schema/golden canonicalization | Same validated intent → same hash; malformed IDs/types rejected before risk |
| S03-T09 | X-E confirmation adversary | negative corpus | stale/cross-actor/expired/changed fingerprint fail with zero side effects |
| S03-T10 | X-F scheduler viability | ADR verdict | Duplicate/DST/misfire/revocation/fencing/crash tested; PASS or DEFERRED |
| S03-T11 | X-G integrated scale | restore/scale artifact | Winning Board + one editor + 20 chats; deterministic restore; RSS <16 GiB |
| S03-T12 | Architecture/UX/security reviews | independent verdicts | Каждый mandatory experiment принят либо scope formally reduced |

## 5. Подэтапы и матрица параллельности

| Подэтап | Можно параллельно | Предшественники | Результат | Ответственный | Проверка | Что блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S03.0 Charter/fixtures | Частично по domains; freeze serial | Stage 02 GO | comparable datasets/thresholds | Experiment lead + performance | fixture hashes, threshold review | Все X lanes |
| S03.1 X-A Board | С X-B…X-F | S03.0 | compositor ADR input | Canvas/frontend + Product Design | benchmark + keyboard/visual oracle | X-G, C1 Board ADR |
| S03.2 X-B Editor | С X-A/C/D/E/F | S03.0 | editor isolation/lease decision | Editor specialist | 100 scenarios, store/DOM assertions | X-G, E2, C1 |
| S03.3 X-C Chat | С X-A/B/D/E/F | S03.0 | stream envelope/resume data | Chat backend/frontend | event IDs, reconnect, resource metrics | X-G, H1/C1 |
| S03.4 X-D Data/CAS | С X-A/B/C/E/F; DB runs serial | S03.0 | integrity strategy | Data/migration | SQLite/PostgreSQL queries/races | X-G, F1-E/C1 |
| S03.5 X-E AI IR | С X-A–D/F | S03.0, Stage 02 floor | typed IR/canonicalization | Command/security | golden/negative corpus | C1/F1-K/P2 |
| S03.6 X-F Scheduler | Да, optional | S03.0 | PASS/DEFERRED ADR | Execution/scheduler | HA/DST/idempotency tests | Только optional PS |
| S03.7 X-G Integration | Нет относительно inputs | X-A…X-E candidates ready | integrated restore/scale result | Integration/performance | restart hashes + 100/500/1000 + 20 chats | Этап 04 |
| S03.8 Decision review | Нет | S03.1–S03.7 | selected/rejected alternatives | Independent reviewers | evidence reconciliation | Переход |

Heavy runs сериализуются: Playwright/Chrome benchmark, frontend build, PostgreSQL, full tests и Graphify rebuild. Анализ и harness coding могут выполняться параллельно в отдельных `codex/stage03-x*` worktrees. Никакой experiment branch не merge-ится автоматически.

## 6. Распределение субагентов

| Субагент | Цель | Ответственность/задачи | Результат | Критерии проверки |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Найти реальные seams | stores/providers/routes/models/call chains | experiment source map | Graph query + source confirmation |
| Проектирование / experiment architect | Обеспечить сравнимость | charter, fixtures, metrics, kill rules | frozen protocol | preregistration review |
| Canvas/Product Design | Выбрать spatial UX/compositor | X-A interaction/semantic zoom/lost-window | benchmark + UX evidence | Same viewport/state; keyboard/a11y; Chrome measurements |
| Editor implementer | Изолировать editor | X-B harness/oracle | lease decision | zero leakage, unique IDs |
| Chat implementers | Проверить concurrency | X-C backend+frontend | stream decision | 20-run and restart tests |
| Data implementer | Проверить integrity/CAS | X-D schemas/query plans/races | persistence ADR input | dual-DB evidence |
| AI/security implementer | Проверить IR/confirmation | X-E schemas/hash/adversary | safe IR decision | negative corpus, zero mutations |
| Scheduler analyst | Optional viability | X-F | PASS/DEFERRED ADR | HA/DST/fencing proof |
| Integration/performance | Объединить candidates | X-G | restore/scale report | deterministic hash/RSS/latency |
| Testing | Независимо воспроизвести | All experiment harnesses | rerun bundle | fixture/env/hash parity |
| Documentation | ADR-ready records | decisions, provenance, rejected options | complete experiment pack | no vague “acceptable” wording |
| Requirements/compliance | Map R/GC | R-01/03/05/10/17/24/36 | traceability verdict | all mandatory risk owners present |
| Independent reviewer | Falsify recommendation | thresholds, stats, leakage | PASS/FAIL/BLOCKED | Не implementer; reruns selected cases |

Обязательно использовать Superpowers, Graphify и все доступные релевантные инструменты. Для визуальных/интерактивных опытов Product Design формирует oracle; пользователь выбрал Chrome, поэтому live browser measurements выполняются в Chrome. «Компьютер» допустим для read-only OS/Desktop state, которого нет в browser API. Screenshot сам по себе не является benchmark или accessibility PASS.

## 7. Зависимости от предыдущих этапов

Нужны Stage 01 baseline/coverage/tooling и Stage 02 W0 safe floor. X-E и X-C не могут использовать unsafe auto-apply, ownerless Job или unauthenticated shared route. Любой source drift требует обновления experiment map, но не разрешает rebuild/generated changes вне scope.

## 8. Предполагаемые результаты

- ADR-ready choices для Board compositor, FlowEditorInstance, Chat stream, Placement integrity и Command IR.
- Numeric performance/heap/restart evidence.
- Integrated X-G prototype без production migration.
- Явные rejected alternatives/kill decisions.
- Scheduler verdict `PASS` или `DEFERRED` без блокировки V1.

## 9. Критерии завершения и верификации задач

Каждая mandatory задача должна иметь exact environment, fixture hash, command, raw measurement artifact, aggregation method, threshold, observed result, recommendation и reviewer verdict. Среднее без p95/p99 там, где они требуются, screenshot без timing/network/accessibility evidence, “seems acceptable” и post-hoc threshold считаются FAIL.

## 10. Общие критерии этапа

- [ ] S03-T01…T09, T11, T12 PASS.
- [ ] X-A…X-E и X-G имеют numeric/current-SHA artifacts и ADR recommendation.
- [ ] X-G не имеет cross-editor/cross-chat leakage и проходит approved thresholds.
- [ ] Restore hash детерминирован после browser/backend restarts.
- [ ] BoardRelation оставляет Flow JSON byte-identical.
- [ ] Experiment worktrees не содержат production migrations и не merged автоматически.
- [ ] RSS protocol не нарушен.
- [ ] X-F имеет честный PASS/DEFERRED.
- [ ] Все failed candidates изменили scope/decision до Этапа 04.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Fixtures различаются между candidates | Freeze/hash один dataset и oracle |
| Browser measurements шумные | Fixed Chrome/version/hardware/viewport; warmups; multiple runs; raw data |
| Global editor state скрывает leakage | Instrument stores/controllers/DOM IDs; aggressive interleaving oracle |
| Sequence dedup ложно PASS | Stable `event_id` + epoch/reconnect/crash tests |
| SQLite-only решение не переносимо | Обязательный PostgreSQL lane до decision |
| X-G превышает RSS | Stop optional work; profile and reduce scope before retry |
| Threshold не утверждён | BLOCKED; не изобретать число после run |
| Scheduler substrate слаб | Mark `DEFERRED`; V1 продолжает без PS |

## 12. Тестирование, проверка и документация

Тесты включают Vitest/Jest/controller tests, Playwright/Chrome interaction oracle, backend stream simulators, SQLite/PostgreSQL concurrency, schema golden files, security replay corpus, restart/kill tests, heap/long-task/network measurements. Python запускается через `uv run`. Каждый experiment документирует setup, fixtures, raw data, aggregation, uncertainty, threshold, result, rejected alternatives, limitations и kill decision.

## 13. Условия невыполнения

Этап невыполнен, если любой X-A…X-E/X-G не имеет current-SHA numeric artifact; comparator неравноправен; есть unexplained leakage/lost update/nondeterministic restore; threshold не утверждён; production schema изменена; mandatory failure скрыт рекомендацией; independent reviewer отсутствует. В таком случае статус — частичный/заблокированный и `NO-GO`.

## 14. Условия перехода

Этап 04 начинается только после `этап выполнен` и `GO`, когда все mandatory experiments либо PASS, либо привели к formally approved scope reduction/kill decision с новым contract input. X-F `DEFERRED` не блокирует. Любой обязательный BLOCKED/FAIL запрещает C1 freeze.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | S03-T IDs, candidates, evidence links/hashes |
| Невыполненные задачи | Причина, owner, unblock, blocked experiments |
| Частично выполненные задачи | Доказанная/недоказанная часть и влияние на ADR |
| Обнаруженные дефекты | Severity, reproduction, affected candidate |
| Активные блокеры | Resource/browser/DB/threshold blocker и recheck |
| Результаты тестирования | Raw/numeric results, fixtures, environments, commands/exits |
| Результаты проверки субагентами | Handoffs, reruns, independent verdicts |
| Соответствие критериям завершения | Каждый пункт §10 и selected/rejected/DEFERRED status |
| Вывод о возможности перехода | `GO`/`NO-GO` и разрешённые contract inputs |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 03
Статус: этап выполнен | этап выполнен частично | этап заблокирован
Переход: GO | NO-GO
## Experiment results
<X-A…X-G: candidate, threshold, observed, verdict, artifact>
## Tasks / defects / blockers
<IDs, severity, owner, unblock>
## Subagent and independent review
<handoffs, reruns, verdicts>
## Criteria and decisions
<§10 PASS/FAIL/BLOCKED; selected/rejected/DEFERRED>
## Обоснование итогового статуса
<конкретные evidence links>
```
