# Этап 06 — Safe dual-write, resumable backfill, reconciliation и read cutover

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, F1-W/B/V/C и F1 completion criteria.
> **Вход:** Этап 05 — `этап выполнен`, `GO`; pinned foundation build/schema head.
> **Следующий файл:** `21_KETOS_STAGE_07_BOARD_CHAT_PROJECT.md`.
> **Обязательный режим:** F1-W → F1-B → F1-V → F1-C выполняются строго последовательно; субагенты параллелят только независимый анализ/fixtures/reviews. Использовать все доступные применимые инструменты.

## 1. Контекст этапа

Additive schema ещё не означает безопасную миграцию. Legacy Message/Trace/System Folder/Flow provenance могут быть неоднозначны, browser localStorage отсутствует на сервере, а rollback после новых writes не может быть DB downgrade. Этап вводит safe dual-writer, evidence-backed backfill/quarantine, минимум семидневное parity window и cohort read cutover с monitored legacy fallback.

Этап сохраняет `session_id`, `context_id`, message body/files, deployment attachment identity и expanded schema. Он не выполняет destructive contract removal — это возможно только в Stage 10/C7 после observation window и отдельного approval.

## 2. Цель этапа

Перевести новые writes и затем reads на foundation Этапа 05 без silent loss/reassignment, partial transaction, duplicate effect или security regression; доказать mixed-version compatibility и rollback на pinned safe dual-writer application floor.

## 3. Подробное техническое задание

### F1-W

Атомарно писать MessageTable+ChatTurn; заполнять revision/provenance Flow/Job/Command/Placement; ставить `system_role` только новым system folders; сохранять Trace `session_id`; развернуть pinned dual-writer до backfill. Abort при writer error, checksum mismatch, legacy read regression или unbounded/contract-threshold latency increase.

### F1-B

Создать out-of-band runner: dry-run/checkpoint/batch/idempotent resume/checksum/ambiguity ledger. Классифицировать legacy chat sessions `normal Flow`, `virtual shared Flow`, `agentic candidate`, `orphan`, `ambiguous`; mapping только по evidence. `mapped + quarantined = source`. System role — strong provenance, не name-only. Browser localStorage — только import API/schema preparation, без ложного server-import claim.

### F1-V

Shadow compare privacy-safe digests и bounded reason codes для Chat order/body/files, Project hierarchy, Flow revision, Job results. PASS требует одновременно `>=168 часов` и `>=N_C1 unique eligible operations`, где `N_C1` берётся из Stage 04, не изобретается здесь. Abort при unexplained ownership/identity/security/checksum mismatch.

### F1-C

Backend read-cutover flag переключает C1-approved cohorts только после parity PASS. Legacy read остаётся monitored fallback; rollback возвращает приложение на safe dual-writer той же expanded schema. DB downgrade/destructive cleanup запрещены.

## 4. Задачи и task-level DoD

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S06-T01 | Admission/safe-floor lock | RC/build/schema/flag manifest | F1 foundations PASS; backfill/cutover выключены |
| S06-T02 | Writer/reader matrix | transaction/checksum matrix | Все entry points/legacy readers/old-new fields перечислены |
| S06-T03 | Chat atomic dual-write | Message+Turn implementation | Failure injection даёт zero partial rows; legacy IDs/body/files unchanged |
| S06-T04 | Entity dual-write | Flow/Job/Command/Placement provenance | N writer→N-1 reader approved matrix PASS |
| S06-T05 | Folder/Trace compatibility | new-role/legacy-trace evidence | Existing folder rows unchanged; Trace `session_id` preserved |
| S06-T06 | Abort observability/deploy | metrics + pinned deployment | Checksum numerator/denominator, latency bound, writer/legacy probes operational |
| S06-T07 | Backfill runner | resumable batch tool | Dry-run/checkpoint/resume/idempotency/checksum PASS after interruption |
| S06-T08 | Chat/Trace mapping | mapping/quarantine ledger | Every source classified; no silent drop/reassignment; unmatched trace preserved |
| S06-T09 | System/provenance backfill | evidence ledger | No name-only role; no invented historical actor/command provenance |
| S06-T10 | Browser import contract prep | API/schema | Explicitly says not imported; version/hash/idempotency/size contract valid |
| S06-T11 | Reconciliation comparator | privacy-safe metrics | Four domains have eligible/matched/mismatched/excluded/reason counts |
| S06-T12 | Time/operation/SLO gate | parity report | `>=168h` and `>=N_C1`; no zero-sample false PASS; C1 SLOs met |
| S06-T13 | Rollback drill | tested safe-floor recovery | Flag off restores legacy reads on expanded schema; data/W0 controls preserved |
| S06-T14 | Sequential read cutover | cohort exposure ledger | Каждый cohort проходит parity/error/latency/security gate |
| S06-T15 | Independent closure | migration/security/compat verdicts | All three PASS on cutover SHA |

## 5. Подэтапы и параллельность

| Подэтап | Можно параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S06.0 Admission | Нет | Stage 05 GO | immutable RC/safe floor | Coordinator | SHA/schema/digests/contracts | Всё |
| S06.1 F1-W implementation | Lanes by domain; registrar/deploy serial | S06.0 | safe dual-writer | Chat/domain/identity agents | atomicity/N-1/abort tests | F1-B onward |
| S06.2 F1-W deploy/rollback | Нет | S06.1 PASS | pinned deployed floor | Release + security | smoke/failure/rollback drill | F1-B |
| S06.3 F1-B runner/mapping | Runner, chat, folder, import contracts partly parallel | S06.2 PASS | completed ledgers/checksums | Migration/data agents | interrupt/resume/conservation | F1-V |
| S06.4 F1-V comparator | Comparator domains parallel; time gate shared | S06.3 PASS | parity window | Data/observability/privacy | `168h + N_C1`, per-domain counts | F1-C |
| S06.5 F1-C cutover | Нет между cohorts | S06.4 PASS | approved read target | Flag/release registrar | exposure + fallback + probes | Review |
| S06.6 Independent closure | Reviewers параллельно | S06.5 | GO/NO-GO | Independent panel | current-SHA artifacts/reruns | Stage 07 |

F1-B не стартует, пока F1-W полностью не PASS; F1-V — пока backfill ledger не conserved; F1-C — пока оба parity gates не закрыты. Проценты R5 не переносятся автоматически в F1-C: используются только C1-approved cutover cohorts.

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Полный writer/reader chain | S06-T02 и drift | source matrix | graph/source spot-check |
| Проектирование / migration architect | Зафиксировать порядок и инварианты | F1-W/B/V/C contracts, checksum, safe floor | migration design | data/security/rollback review |
| Chat transaction implementer | Atomic Message+Turn | S06-T03 | dual-write code/tests | crash-point/partial-row tests |
| Domain writer implementer | Revision/provenance | S06-T04 | entity dual-write | N/N-1 and checksum |
| Identity implementer | Folder/Trace | S06-T05/T09 | compatible provenance | bit/hash/identity comparison |
| Backfill implementers | Runner/mapping | S06-T07–T10 | resumable ledgers | interrupt/resume/conservation |
| Observability/data | Reconciliation | S06-T11/T12 | parity/SLO reports | bounded privacy-safe counters |
| Release/flag registrar | Deploy/cutover | S06-T06/T13/T14 | pinned rollout/fallback | flag timing/exposure/probes |
| Security auditor | Preserve W0/ownership/privacy | canary/auth/mismatch/rollback | security verdict | negative probes before/after rollback |
| Testing/compatibility | DB/mixed-version/failure | full Stage 06 matrix | evidence | SQLite/PostgreSQL/N/N-1 rerun |
| Product Design/frontend | Import/cutover user truth | Opt-in preview/error/partial states contract | UX findings | no false “complete history”; a11y/i18n |
| Documentation | Runbooks/ledgers | migration, quarantine, rollback, cutover docs | auditable pack | links/hashes/redaction |
| Requirements/compliance | GC-09/10 and F1 order | no removal/downgrade/silent loss | compliance verdict | phase-order scan |
| Independent reviewers | Migration/security/compat | S06-T15 | PASS/FAIL/BLOCKED | Не implementers; current-SHA rerun |

Обязательны Superpowers, Graphify и все доступные релевантные DB/migration/observability/security/test tools. Product Design/Chrome проверяют только user-visible import/cutover/error behavior на RC; «Компьютер» — read-only OS/browser-state when needed. Никакой UI proof не заменяет ledgers/checksums.

## 7. Зависимости от предыдущих этапов

Требуются F1-E/K/J/S/O/R PASS, C1 checksum/cutover/SLO contracts, Stage 01 baseline, Stage 02 W0 safe floor. Отсутствующий `N_C1`, checksum canonicalization или latency bound означает BLOCKED, а не право выбрать удобное число.

## 8. Предполагаемые результаты

- Pinned safe dual-writer build и rollback digest.
- Resumable backfill/quarantine/import-prep artifacts.
- Conservation/checksum ledgers без identity rewrite.
- Privacy-safe parity report за >=7 дней и C1 operation count.
- Cohort read cutover с monitored fallback.
- Ни одной destructive migration/column removal.

## 9. Критерии завершения задач

Task PASS требует current-SHA manifest, raw commands/exits/hashes, pre/post row counts/checksums, failure-injection result, rollback/abort condition и reviewer verdict. Empty sample, unknown exclusion, historical evidence или partial ledger не считаются parity PASS.

## 10. Общие критерии этапа

- [ ] S06-T01…T15 PASS.
- [ ] Safe dual-writer развёрнут до любого backfill/cutover.
- [ ] Writer error/checksum/legacy-read/latency violations действительно abort promotion.
- [ ] Interrupted backfill resumes idempotently; `mapped + quarantined = source`.
- [ ] Chat body/files/session IDs и deployment identities сохранены.
- [ ] Reconciliation имеет >=168h, >=N_C1 и coverage всех четырёх domains.
- [ ] SQLite/PostgreSQL и mixed N/N-1 matrix PASS.
- [ ] Rollback использует safe dual-writer/expanded schema и сохраняет W0.
- [ ] Migration/security/compat reviewers PASS.
- [ ] Contract removal не выполнялся.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Ambiguous legacy identity | Quarantine с reason/evidence; не угадывать |
| Browser-only history отсутствует server-side | Только opt-in import contract; truthful UI |
| Partial dual-write | Transaction + failure injection; abort deploy |
| N-1 writer contract не определён | BLOCKED до C1 amendment; не предполагать |
| Comparator leaking content | Canonical digest + bounded reason enum + privacy review |
| 7 дней есть, операций нет | BLOCKED; нужны оба gate и per-domain coverage |
| Cutover regression | Flag off ≤ contract; monitored fallback; safe floor rollback |
| DB downgrade кажется проще | Запрещён после writes; restore/forward-compatible app only |

## 12. Тестирование, проверка и документация

Обязательны unit/integration F1-W atomicity; SQLite/PostgreSQL fresh/prior/mixed; N/N-1; crash points; interrupted/resumed backfill; checksum/conservation; privacy/cardinality; latency/SLO; actor/security probes; cohort exposure; flag-off; rollback drill. Evidence каталог содержит window contract, operation counts, parity summary, backfill attestation, SLO report, deployment manifest и reviewer verdicts. Python — через `uv run`; heavy suites serial.

## 13. Условия невыполнения

`FAIL/ABORT`: partial commit, unexplained checksum/ownership/identity/security mismatch, silent loss/reassignment, privacy leak, legacy regression, threshold breach, rollback losing data/W0. `BLOCKED`: не истекли 168h, не достигнут N_C1, missing DB/legacy fixture/contract/reviewer/current evidence. Оба запрещают Stage 07.

## 14. Условия перехода

Stage 07 открывается только после `этап выполнен`, `GO`, F1-C PASS, safe fallback readiness и трёх independent PASS. Contract removal остаётся запрещённым.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | F1-W/B/V/C и S06-T IDs с artifacts |
| Невыполненные задачи | Причина, owner, unblock, blocked successor |
| Частично выполненные задачи | Ledger/window/cutover gap и impact |
| Обнаруженные дефекты | Writer/checksum/identity/security/latency severity |
| Активные блокеры | Time/N_C1/DB/contract/reviewer blocker |
| Результаты тестирования | DB/N-1/backfill/parity/rollback commands, exits, hashes |
| Результаты проверки субагентами | Handoffs и migration/security/compat verdicts |
| Соответствие критериям завершения | Каждый пункт §10, mapped/quarantined и parity gates |
| Вывод о возможности перехода | `GO`/`NO-GO` и safe fallback readiness |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 06
Статус: этап выполнен | этап выполнен частично | этап заблокирован
RC/schema/safe-floor: <digests>
Переход: GO | NO-GO
## F1-W/B/V/C status
<task IDs, artifacts, checksums>
## Parity and cutover
<hours, N_C1, domain counts, SLO, cohorts>
## DB/mixed-version/rollback/security
<commands, exits, hashes, verdicts>
## Defects/blockers/criteria
<owner, unblock, §10>
## Обоснование статуса
<current-SHA evidence>
```
