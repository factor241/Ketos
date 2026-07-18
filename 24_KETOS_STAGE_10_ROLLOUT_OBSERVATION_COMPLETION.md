# Этап 10 — Staged rollout, observation window, итоговый V1 DoD и optional contract removal/schedules

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, R5, O6, C7, optional PS и Program Definition of Done.
> **Вход:** Этап 09 — `этап выполнен`, `GO`, H4 PASS и exact RC/rollback digests.
> **Выход:** закрытие Ketos V1 либо `NO-GO`; C7 и PS требуют отдельных approvals и не подменяют V1.
> **Обязательный режим:** rollout/monitoring/release/review выполняются специализированными субагентами с использованием всех доступных применимых инструментов; promotion decisions принимаются последовательно.

## 1. Контекст этапа

Test evidence не доказывает production safety. R5 продвигает один RC по cohorts `internal → 1% → 10% → 25% → 50% → 100%`, проверяя security, checksum, error, latency, flag-off и legacy probes. O6 удерживает dual-read/write and compatibility минимум 30 дней или два релиза, whichever longer. Legacy contracts удаляются только после telemetry/retention/rollback proof и отдельного пользовательского разрешения.

Optional scheduled processes R-31 не блокируют V1: вход только после X-F PASS, R2/H4 execution/security PASS и отдельного product approval. Если substrate не доказан, статус `DEFERRED` честнее небезопасной реализации.

## 2. Цель этапа

Безопасно довести RC до 100%, пройти observation window, повторно подтвердить весь Program DoD и выпустить однозначный итоговый статус. При отдельном approval подготовить/выполнить destructive C7 отдельным release plan; при отдельном PS approval — schedule foundation с HA/idempotency/capability proof.

## 3. Подробное техническое задание

### R5

Каждый cohort длится минимум 24 часа и достигает C1-approved operation count. Promotion требует: zero auth/privacy/security incidents; zero unexplained checksum/dual-write mismatch; new-path 5xx delta `<=0.2` percentage points vs matched legacy cohort; p95 regression `<=10%`; flag-off `<=5 min`; legacy compatibility probes `100/100`; zero unresolved Critical/High. Breach → immediate application rollback to W0/safe dual-writer, expanded schema remains.

### O6

Наблюдать минимум 30 дней или два releases; parity/quarantine ledgers reach approved state; R-34 legacy usage meets removal threshold; backup/restore/rollback current; gates remain blocking, not advisory.

### C7/PS

C7 — separate user approval and plan, dedicated release, no combined expand+contract, forward-fix/restore rollback. PS — separate approval, owner/service actor/revision/timezone/DST/misfire/retry/capabilities/lease/fencing/idempotency/revocation/HA; external scheduler uses Ketos APIs and stores no business truth.

## 4. Задачи и task-level DoD

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S10-T01 | Rollout admission | RC/flags/dashboards/rollback manifest | H4 current; cohorts and operation count frozen; on-call/stop authority assigned |
| S10-T02 | Internal cohort | 24h+ report | All promotion thresholds PASS; rollback drill ready |
| S10-T03 | 1% cohort | matched comparison | 24h+count, zero incidents/mismatch, error/latency/compat PASS |
| S10-T04 | 10% cohort | same | Promotion only from previous PASS |
| S10-T05 | 25% cohort | same | Flag exposure/denominator complete |
| S10-T06 | 50% cohort | same | No cohort contamination/unexplained exclusions |
| S10-T07 | 100% cohort | full rollout report | Thresholds continue PASS; rollback remains live |
| S10-T08 | Observation O6 | 30d/two-release report | Both time rule and approved ledger/removal/DR state satisfied |
| S10-T09 | Program DoD revalidation | R-01–R-40 + DoD matrix | Every mandatory row PASS; only separately approved DEFERRED remains |
| S10-T10 | Security/compat/coverage currency | current final evidence | No gate advisory/stale; exact production release SHA |
| S10-T11 | C7 authorization decision | `NOT_AUTHORIZED/DEFERRED` or approved plan | No destructive work without separate approval |
| S10-T12 | Optional C7 execution | dedicated release evidence | Only if approved; telemetry/import/retention/redirect/rollback criteria PASS |
| S10-T13 | PS authorization/viability | PASS or DEFERRED | X-F+R2/H4+approval; failure does not block V1 |
| S10-T14 | Optional PS execution | schedule/HA evidence | Only if approved; duplicate/DST/revocation/fencing/HA PASS |
| S10-T15 | Final independent closure | final report | Release/security/data/compat/product reviewers sign current evidence |

## 5. Подэтапы и параллельность

| Подэтап | Можно параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S10.0 Admission | Нет | Stage 09 GO | rollout contract/on-call/rollback | Release coordinator | exact SHA/flags/dashboards/authority | R5 |
| S10.1 R5 cohorts | Нельзя параллелить promotions; monitoring lanes параллельны | Previous cohort PASS | per-cohort evidence | Release + observability + security | 24h/count/thresholds/100 probes | Next cohort |
| S10.2 100% stabilization | Monitoring parallel | 100% promotion | stable release | Operations | same thresholds, flag-off readiness | O6 |
| S10.3 O6 observation | Security/data/product/compat monitoring parallel | R5 PASS | 30d/two-release evidence | Observability owners | parity/usage/DR/gate currency | V1 closure/C7 |
| S10.4 DoD revalidation | Review lanes parallel; verdict serial | O6 complete | 40/40/final DoD | Compliance + reviewers | source/test/production artifact cross-check | Final status |
| S10.5 C7 decision/plan | Можно готовить read-only после O6; execution serial | O6 + separate approval | DEFERRED или dedicated release | Migration/release | telemetry/retention/rollback | Только contract removal |
| S10.6 PS decision | Independent optional lane | X-F+R2/H4+approval | DEFERRED/PASS | Scheduler team | HA/DST/idempotency | Только R-31 |
| S10.7 Final closure | Нет | S10.4; optional lanes honestly classified | final report | Coordinator | all statuses/evidence/reviews | Program close |

R5 threshold breach не “лечится” увеличением cohort/dwell post hoc: promotion stops, rollback occurs, defect returns to owning stage and fresh H4 evidence is required.

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Анализ кодовой базы / Graphify | Проверить release paths и source drift | adapters, flags, probes, removal/scheduler owners | current source map | Graphify query + source reconciliation |
| Release coordinator | Последовательные decisions | admission/cohorts/rollback/final status | release ledger | no skipped gate |
| Observability/data | Метрики/parity/checksums | 5xx/p95/operations/dual-write/quarantine | dashboards/reports | denominator/exclusion/SHA validation |
| Security monitoring | Incident/capability/auth | live security thresholds/canaries | verdict/incidents | zero unreviewed breach |
| Проектирование / Product Design-UX | Cohort user-flow health | Board/Chat/Editor/AI/navigation/a11y/i18n | product evidence | Chrome journeys + support/telemetry, no metadata leak |
| Compatibility | Legacy probes/current matrices | Flow/KFX/LFX/API/DB/browser/Desktop | 100/100 + release matrix | exact production SHA |
| Reliability/DR | Rollback/backup/restore | flag-off, DR, RPO/RTO | current drill | recovery evidence |
| C7 migration team | Optional destructive release | removals/redirects/data retention | plan/release | separate approval, dedicated gates |
| Scheduler team | Optional PS | schedule model/adapters/HA | PASS/DEFERRED | duplicate/DST/revocation/fencing |
| Documentation | Release/admin/user/migration docs | reports/runbooks/changelog | current docs | links/copy/technical review |
| Requirements/compliance | Program DoD | 40/40 + GC + optional disposition | final matrix | no mandatory BLOCKED/FAIL |
| Independent reviewers | Release/security/data/compat/product | final falsification | PASS/FAIL/BLOCKED | Not promotion implementers; current evidence |

Обязательны Superpowers, Graphify и все доступные релевантные release/monitoring/security/test tools. Product Design анализирует production user flows и accessibility. Chrome — выбранная live browser surface для cohort journeys; «Компьютер» — OS/Desktop/window proof при необходимости. Browser/telemetry access используется read-only, без передачи secrets; screenshots не заменяют server metrics.

## 7. Зависимости от предыдущих этапов

Требуются exact Stage 09 RC, H4 evidence, tested rollback, C1 cohort/operation/SLO/telemetry contracts и current Q1. C7 additionally требует O6+separate user approval. PS additionally требует X-F PASS, R2/H4 PASS и separate product approval.

## 8. Предполагаемые результаты

- Safe 100% rollout и per-cohort signed evidence.
- Complete O6 observation window.
- Final 40/40 and Program DoD matrix.
- Current rollback/DR/security/compatibility evidence.
- Honest C7/PS status: executed only if approved, otherwise DEFERRED/NOT_AUTHORIZED.

## 9. Критерии завершения задач

Каждый cohort artifact содержит exposure denominator, timestamps, operation count, matched baseline, 5xx delta, p95 delta, incidents, mismatches, flag-off probe, compatibility 100/100, reviewer verdict и SHA/hash. O6 имеет continuous-window evidence, not selected screenshots. DoD row links to implementation/test/production proof.

## 10. Общие критерии этапа

- [ ] S10-T01…T10 и T15 PASS.
- [ ] Каждый R5 cohort выдержал >=24h и C1 operation count.
- [ ] Security/checksum/error/latency/flag-off/compat thresholds PASS through 100%.
- [ ] O6 длится >=30 days or two releases, whichever longer.
- [ ] Parity/quarantine/legacy usage/backup/rollback reach approved state.
- [ ] All gates remain blocking/current.
- [ ] Every R-01–R-40 is PASS or separately approved DEFERRED; no mandatory BLOCKED/FAIL.
- [ ] Full Program DoD from master plan has current production-SHA evidence.
- [ ] C7/PS not executed without separate approvals and dedicated plans.
- [ ] Independent final reviewers PASS.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Cohort threshold breach | Stop promotion; rollback safe app; incident/root cause; fresh H4 |
| Metrics denominator incomplete | BLOCKED; repair instrumentation; restart dwell/count |
| 30 days passed but only one release where two longer | Continue until whichever-longer rule satisfied |
| Legacy usage above threshold | Keep contracts/routes; improve migration/redirect; no removal |
| Pressure to make gate advisory | Prohibit; record governance blocker |
| C7 approval absent | `NOT_AUTHORIZED/DEFERRED`; V1 may still complete |
| Scheduler substrate fails | `DEFERRED`; preserve V1 status |
| Stale rollback/DR evidence | Repeat drill on current release before closure |

## 12. Тестирование, проверка и документация

Continuous synthetic+real cohort probes; security canaries; checksum/parity; matched error/latency; flag-off; Flow/KFX/LFX/API compatibility; production browser journeys in Chrome; accessibility/RU/EN; backup/restore/DR. Optional C7 adds migration fresh/prior/restore and redirects/import/retention; optional PS adds two schedulers/workers, clock skew, duplicate/DST/misfire/crash. Документы: per-cohort reports, incident log, O6 report, final DoD, release/rollback runbooks, optional plans.

## 13. Условия невыполнения

Этап не выполнен при skipped/short cohort; threshold breach without rollback; incomplete denominator; observation shorter than rule; stale security/compat/DR evidence; mandatory R/DoD BLOCKED/FAIL; advisory gate; unapproved destructive removal/scheduler; missing independent verdict. Такой результат — partial/blocked и NO-GO.

## 14. Условия перехода/завершения программы

Так как это последний обязательный этап, `GO` означает Ketos V1 release complete, а не автоматическое разрешение C7/PS. `Этап выполнен` возможен при DEFERRED/NOT_AUTHORIZED optional C7/PS, если все mandatory V1 criteria PASS. Любой mandatory partial/blocked оставляет программу `IN_PROGRESS/BLOCKED/FAIL`.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | S10-T IDs, cohort/O6/DoD artifacts |
| Невыполненные задачи | Причина, owner, unblock, program impact |
| Частично выполненные задачи | Cohort/observation/optional gaps |
| Обнаруженные дефекты | Severity, incident/root cause, owning stage |
| Активные блокеры | Metrics/time/approval/security/compat/DR blocker |
| Результаты тестирования | Cohort probes, production journeys, compatibility и DR artifacts |
| Результаты проверки субагентами | Release/security/data/product/compat verdicts |
| Соответствие критериям завершения | Каждый пункт §10, R-01–R-40 и Program DoD |
| Вывод о возможности перехода/закрытия | Финальный `GO`/`NO-GO`, COMPLETE/IN_PROGRESS/BLOCKED/FAIL |

## 16. Итоговый формат отчёта

```markdown
# Итоговый отчёт по Этапу 10 и Ketos V1
Статус: этап выполнен | этап выполнен частично | этап заблокирован
Программа: COMPLETE | IN_PROGRESS | BLOCKED | FAIL
Release SHA / rollback digest: <...>
## R5 cohorts
<cohort, dwell, operations, security, checksum, 5xx, p95, flag-off, compat, verdict>
## O6 observation
<dates, releases, parity, legacy usage, DR, gate currency>
## R-01–R-40 / Program DoD
<each row PASS/DEFERRED/FAIL/BLOCKED + evidence>
## C7 / PS
<approval, DEFERRED/NOT_AUTHORIZED/PASS, artifacts>
## Defects/blockers/subagent reviews
<owner, severity, unblock, verdict>
## Обоснование итогового статуса
<конкретные criteria and current production evidence>
```

Отчёт не может использовать “complete”, пока хотя бы один mandatory criterion не имеет current production-SHA proof.
