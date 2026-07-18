# Отчёт по Этапу 01

**Статус: этап выполнен частично**

**Transition verdict: NO-GO**

**Product baseline:** `80878261d07c21ad257de017d98069f211ada2c2`

**Integration branch:** `codex/stage01-baseline-evidence`

**Integration worktree:** `/Volumes/Projects/ketos-stage01-integration`

Этап 02 не начинался. Создан только его W0 planning input и тестовая
спецификация. Продуктовый source, generated artifacts, lock-файлы, deployment
config, `LICENSE`, `NOTICE` и пользовательский dirty state не изменялись.

## Admission и границы доказательства

- `AGENTS.md` прочитан до действий. Python-команды репозитория выполнялись
  через `uv run`.
- У Этапа 01 нет предыдущего этапа: §7 входного файла прямо определяет его как
  первый этап. Поэтому predecessor PASS gate имеет disposition
  `N/A_NO_PREDECESSOR`, а не выдуманный PASS.
- Зафиксированы branch, origin, SHA, dirty ownership, RSS и clean worktrees в
  [preflight-manifest.json](preflight-manifest.json) и
  [worktree-registry.json](worktree-registry.json).
- Исходный checkout остался на `redesign/sidebar-account`; SHA-256 его
  `git status --short` до и после работы одинаков:
  `f4627038e5f52dbc80119b5dcd2c5d7c2504eb2742e6adb9b6f177e617fe7a88`.
- Все коммиты этапа изменяют только `docs/evidence/stage-01/**`.
- При aggregate RSS `>=14 GiB` соблюдён GC-16: новые агенты, установка
  frontend dependencies, package coverage, build и локальные server lanes не
  запускались. Два независимых по времени снимка сохранены как
  [baseline](records/coverage-resource-blocker-baseline.json) и
  [rerun](records/coverage-resource-blocker-rerun.json).

## Выполнено / частично / не выполнено

| Task | Статус | Результат и evidence |
| --- | --- | --- |
| S01-T01 | PASS | Current branch/SHA/origin/dirty/RSS зафиксированы в [preflight](preflight-manifest.json); каждый dirty path имеет disposition. |
| S01-T02 | PASS | Clean integration и detached lanes основаны на одном approved SHA; [registry](worktree-registry.json). |
| S01-T03 | PASS | Evidence schema/runner/index реализованы TDD; negative exit не может стать PASS, секреты редактируются, hashes валидируются; [README](README.md), [schema](schema/evidence-record.schema.json), [index](artifact-index.json). |
| S01-T04 | PASS | Исторические 01–14 не переписаны; corrections разрешены только append-only через [ERRATA_REGISTER.md](ERRATA_REGISTER.md). |
| S01-T05 | PARTIAL | Writers/readers и fail-open пути перечислены в [job-ownership.json](backend/job-ownership.json). Локальная read-only SQLite census механически сходится `0 + 0 + 0 = 0 NULL`, но snapshot не production-representative; [job-null-census.json](backend/job-null-census.json). |
| S01-T06 | PARTIAL | Runtime dump содержит 263 route-method registrations и обязательные поля; [matrix](security/route-capability-matrix.json). 83 строки source-reviewed, 180 остаются `runtime-inventory-only; independent source review pending`. |
| S01-T07 | BLOCKED | Sanitized profile и emergency rollback записаны, но baseline SHA признан небезопасным и конкретный safe floor отсутствует; [profile](security/profile-snapshot.json), [safe floor](security/safe-rollback-floor.md), [rollback](security/emergency-rollback.md). |
| S01-T08 | PASS | 36/36 указанных путей разрешены на approved SHA; Graphify drift классифицирован как `STALE_NAVIGATION_ONLY`, source citations authoritative; [asset map](architecture/current-asset-map.md), [reconciliation](architecture/graphify-reconciliation.json). |
| S01-T09 | PARTIAL | Focused backend, evidence, security, asset, planning, LFX и owned static/format gates имеют records. Backend/frontend/migration/KFX package gates resource-blocked; [baseline-gates.json](testing/baseline-gates.json). |
| S01-T10 | BLOCKED | Числа coverage не выдуманы. Backend/frontend/KFX line и branch имеют `null` с точным GC-16 blocker в [baseline](coverage/coverage-baseline.json) и [rerun](coverage/coverage-rerun.json); documentation-only diff корректно `N/A`, не `0`, в [diff](coverage/diff-coverage.json). |
| S01-T11 | PARTIAL | Privacy/cardinality-safe R-34 contract создан без message content, secrets и unbounded labels, но transport `NO_OP`, window/counts отсутствуют; [r34-contract.json](telemetry/r34-contract.json). |
| S01-T12 | PASS | LFX pin/count/hash и 9 focused tests, Desktop `EXCLUDED_FROM_V1`, 45 `@xyflow/react` и 0 `reactflow` source imports зафиксированы; [LFX](compatibility/lfx-baseline.json), [Desktop](compatibility/desktop-status.json), [XYFlow](compatibility/xyflow-dependency.json). |
| S01-T13 | PASS | OpenSwarm commit/tree/license зафиксированы, dirty caveat указан, код не переносился; [provenance](provenance/openswarm-ab982af.md). |
| S01-T14 | PASS | W0-A…D имеют Owner, Dependencies, Focused tests, Rollback и registrars; Stage 02 явно `NOT STARTED`; [W0 plan](planning/stage-02-w0-plan.md), [direct-name fixture](planning/mcp-direct-name-fixture.md). |
| S01-T15 | PARTIAL | Матрица содержит ровно 18/18 GC и 40/40 R, без `FEATURE_PASS`; [traceability](requirements/traceability.json). Evidence-contract reviewer поставил PASS, security reviewer — `PARTIAL / NO-GO`; полного independent compliance acceptance нет. |

Итого: `8 PASS`, `5 PARTIAL`, `2 BLOCKED`. Наличие обязательных PARTIAL/BLOCKED
исключает `GO` и статус «этап выполнен».

## Baseline facts

### Job/data

- В локальном aggregate-only snapshot: `all_jobs=0`, `owned=0`,
  `all_null_owner=0`, `attributable=0`, `ambiguous=0`, `orphan=0`;
  `PRAGMA quick_check=ok`.
- Девять production writer paths передают owner, но `JobService.create_job`
  и модель допускают nullable owner. Обычные fail-open читатели перечислены в
  inventory; это input W0-A, не исправление Stage 01.
- Для deployment-ready census нужен deployment-labelled read-only snapshot или
  connection с aggregate SELECT на `job`, `flow`, `memory_base`,
  `knowledge_base`, `ingestion_run`.

### Routes/security

- Runtime recursion через FastAPI включила 263 method/path registrations:
  137 OpenAPI-visible и 126 hidden; установленный `ketos.plugins` entry-point
  set в данной среде пуст.
- Независимый security lane подтвердил:
  - `G-01 Critical`: MCP resolver при source-default `AUTO_LOGIN=true` может
    вернуть superuser без credentials;
  - `G-02 Critical`: `WEBHOOK_AUTH_ENABLE=false` impersonates Flow owner до
    проверки requester credential;
  - `G-03 High`: protected build events/cancel допускают `Job.user_id IS NULL`;
  - `G-04/G-05 High`: external MCP client surface и direct POST/session parity
    требуют отдельной adversarial проверки;
  - `G-06/G-07`: двойная/условная MCP регистрация и plugin routes требуют
    непрерывного runtime proof.
- Поэтому baseline SHA не является rollback floor. Минимальный safe floor —
  первый последующий revision, где fail-closed Job/MCP/webhook contracts,
  runtime route dump и zero-unreviewed surface подтверждены current-SHA tests.

### Architecture/frontend/telemetry

- Existing product уже содержит React/XYFlow Flow editor; будущий Board — это
  не «первое внедрение canvas» и не должен смешивать BoardRelation с Flow edge.
- Graphify snapshot построен на `572fad8ea2223e342508ecf095133091c7714e1b`,
  а approved source — `80878261…`; snapshot имеет 65,618 nodes, 131,157 links,
  17 self-loops и 0 missing endpoints. Он использовался только для навигации,
  rebuild не выполнялся.
- Legacy taxonomy разводит Public Playground, private Flow chat и agentic
  authoring assistant как разные permission/state journeys.
- Chrome extension реально попытался открыть `http://127.0.0.1:7860/` и
  получил `net::ERR_CONNECTION_REFUSED`. При RSS выше throttle запуск local
  server запрещён; Product Design audit не подменяет отсутствие screenshots/DOM
  статическим PASS. См. [product-design-audit.md](frontend/product-design-audit.md).
- Computer Use подтвердил отсутствие desktop shell в checkout и обнаружил лишь
  внешние local prototypes. Они не считаются support proof; V1 остаётся web MVP.

## Дефекты и блокеры

| ID | Severity | Классификация | Владелец | Точный unblock / downstream impact |
| --- | --- | --- | --- | --- |
| S01-B01 | Critical | MCP credential bypass при AUTO_LOGIN | W0-B Security/API | Fail-closed current-user + Flow EXECUTE + `mcp_enabled=true`; direct-name/list/transport negative suite. Блокирует safe floor и Stage 02 entry. |
| S01-B02 | Critical | Webhook owner impersonation при auth disabled | W0-B Security/API | Убрать нормальный rollback/profile с `WEBHOOK_AUTH_ENABLE=false`; flow-scoped principal tests. Блокирует safe floor. |
| S01-B03 | High | NULL-owner protected Job reads/cancel | W0-A Backend/Data | Explicit public capability marker, non-null protected owner, census/backfill/quarantine, negative tests. Блокирует safe floor. |
| S01-B04 | High | 180 runtime rows без independent source review | Security reviewer | Source-review each actor/scope/risk chain and repeat runtime dump with plugin census. Блокирует zero-gap route acceptance. |
| S01-B05 | High | Production census отсутствует | Data owner | Deployment-labelled read-only aggregate snapshot/connection. Блокирует ownership migration approval. |
| S01-B06 | High | Coverage package gates не выполнены | Testing owner | Освободить aggregate RSS ниже 14 GiB; serial backend/frontend/KFX coverage twice, numeric line+branch within ±0.5 p.p.; migration/lint/type/build gates. |
| S01-B07 | High | R-34 observation отсутствует | Product/Telemetry | Реальный bounded sink, approved retention, minimum observation window и counts для legacy surfaces. Блокирует removal/cutover. |
| S01-B08 | Medium | Browser/accessibility proof отсутствует | Frontend/Product Design | При RSS <14 поднять clean local app, выполнить Chrome queue с DOM/network/screenshots, zoom/reflow/keyboard/a11y checks. |
| S01-B09 | Medium | Broad messages suite inconclusive + pre-existing image-path failure | Backend tests | Изолировать fixture/migration overhead, воспроизвести `test_to_lc_message_keeps_supported_image_attachments`, классифицировать отдельно; [baseline-defects.md](baseline-defects.md). |
| S01-B10 | Governance | Full independent compliance approval отсутствует | Independent reviewer | После B01–B09 повторить full bundle audit и подписать every §10 criterion. |

## Тесты и независимые проверки

### TDD и команды

| Контур | Результат | Evidence |
| --- | --- | --- |
| Evidence runner RED→GREEN | initial missing-runner RED; final contract suite PASS | [contract report](/Volumes/Projects/ketos-stage01-integration/.superpowers/sdd/task-1-report.md), [final record](records/evidence-bundle-tests-final.json) |
| Security inventory TDD | PASS | [record](records/security-inventory-tests.json) |
| Asset/provenance TDD | PASS | [record](records/asset-provenance-tests.json) |
| W0/traceability TDD | `3 passed` | [record](records/planning-traceability-tests.json) |
| Tooling/coverage contract TDD | RED on absent artifacts, then `4 passed` | [record](records/tooling-coverage-contract-tests.json) |
| Full Stage 01 suite | initial `28 passed, 2 failed`; final `30 passed` | [RED record](records/evidence-bundle-tests-rerun.json), [GREEN record](records/evidence-bundle-tests-final.json) |
| Focused backend | `1 passed` | [record](records/focused-backend-baseline.json) |
| LFX compatibility | `9 passed` | [record](records/lfx-compatibility-baseline.json) |
| Owned Python core static | PASS for `E4,E7,E9,F,I` after format/import fixes | [initial full-policy result](records/evidence-ruff-check.json), [focused rerun](records/evidence-ruff-core-rerun.json) |
| Owned Python format | PASS | [record](records/evidence-ruff-format.json) |
| JSON syntax | PASS, 46 JSON files at pre-report verification | current-run verification; index updated after report |
| Evidence record validation | PASS for every record | runner validation loop |
| `git diff --check` | PASS | current-run verification |

Package gates и coverage не помечены PASS: их точные BLOCKED dispositions
находятся в [baseline-gates.json](testing/baseline-gates.json).

### Субагенты и reviewers

| Assignment | Handoff/verdict | Использование |
| --- | --- | --- |
| Architecture/Graphify | `architecture.md`, PARTIAL; clean lane | 36/36 asset paths, stale-graph classification, API/KFX/frontend boundaries. |
| Backend/data | `backend-data.md`, PARTIAL; clean lane | writer/reader graph и read-only local census contract. |
| Security/routes | `security-routes.md`, `PARTIAL / NO-GO`; clean lane | independent source findings G-01…G-07 и safe-floor rejection. |
| Frontend/Product Design | `frontend-product.md`, PARTIAL/BLOCKED; clean lane | IA taxonomy, analytics NO_OP, XYFlow dependency truth, browser queue. |
| Evidence implementer | commits `59d711…` through `8d11215…`; PASS | TDD evidence contract, hardening and delivery attestation. |
| Evidence reviewer | PASS, no critical/important/minor issues | Independent review of runner/schema/hash/redaction/scope contract. |

Новые review agents после resource throttle не запускались. Это соблюдение
GC-16, но не замена отсутствующей полной compliance подписи.

## Проверка критериев §10

| Критерий | Verdict | Evidence / причина |
| --- | --- | --- |
| S01-T01…T15 завершены | FAIL | T05/T06/T09/T11/T15 partial; T07/T10 blocked. |
| B0-I-01…06 и B0-01…12 имеют current-SHA evidence | PARTIAL | Evidence/dispositions есть, но safe floor, production census, numeric coverage и live telemetry отсутствуют. |
| Route inventory охватывает все registered FastAPI routers | PASS structural / PARTIAL review | 263/263 runtime registrations имеют required fields; 180 source reviews pending. |
| Job census и safe rollback floor приняты security reviewer | BLOCKED | Local census non-production; reviewer rejected safe floor at baseline SHA. |
| Coverage воспроизводима ±0.5 п.п. | BLOCKED | GC-16 resource throttle; numeric metrics отсутствуют. |
| Telemetry schema privacy/cardinality-safe | PASS | [r34-contract.json](telemetry/r34-contract.json); observation отдельно BLOCKED. |
| W0 plan одобрен | PARTIAL | Plan и fixtures созданы/протестированы, independent approval отсутствует. |
| 18/18 GC и 40/40 R без false feature PASS | PASS | [traceability.json](requirements/traceability.json); tests PASS. |
| Product source, dirty, generated, locks не изменены | PASS | Only `docs/evidence/stage-01/**`; root dirty hash unchanged. |
| Transition verdict `GO` | FAIL | Активны Critical/High blockers; verdict `NO-GO`. |

## Инструменты и ограничения

- Superpowers: worktree isolation, plan execution, subagent-driven work, TDD,
  independent evidence review и verification-before-completion.
- Graphify: queried existing `graph.json`; no rebuild and no generated output
  mutation per AGENTS/RaytSystem boundary.
- Product Design: source-grounded IA/legacy audit и explicit visual block, без
  invented visual PASS.
- Chrome: selected user Chrome extension; local Ketos URL returned connection
  refused; browser queue stopped at the prescribed capture boundary.
- Computer Use: read-only app census established that external prototypes do
  not prove a desktop shell in this checkout.
- Stage 02 product changes, external actions, network exposure, RaytSystem
  runtime/promotion, deployment and push were not performed.

## Контрольные hashes

| Artifact | SHA-256 до добавления этого отчёта |
| --- | --- |
| `preflight-manifest.json` | `d250c076ec77f689af0680996cb78b638731963653ed56b7e78199c3b3516179` |
| `route-capability-matrix.json` | `511f49dc2e7f28253dc91c4c01da7420685a92c34fd1364d8c50118d57c3117b` |
| `job-null-census.json` | `44a1660df5c2c712614f119778b0bb69e56d08dcec949fe7cee3a05a04bd23dc` |
| `r34-contract.json` | `5f3f5e4391d537b5475f5d08b7b2d391e4abdbcd2d25f5f389fbb1679c82b3a5` |
| `lfx-baseline.json` | `8569d6cb5ed2d83d13f09b86001009a87650ab3199f149dbec0346424838498c` |
| `openswarm-ab982af.md` | `85140a02d87a1ec4f0ae117a79a45c4f640fd3ab0c44f9293e141af6c7812f57` |
| `traceability.json` | `99e30d0e5dd0a5797da4e09ce68467853f40cc3a899f5e6e86d240640a3f874f` |
| `baseline-gates.json` | `4af42045a1cb951d4e778f68ea396382a1c5d7540aac5a2ee50023a9311f1651` |
| `evidence-bundle-tests-final.json` | `bb46de8a7c66d919465ca2f6439584e8ca75ffe0d87b5aa4ca74946fa362fad9` |

## Обоснование статуса и переход

Stage 01 создал воспроизводимый baseline/evidence bundle, завершил безопасную
read-only инвентаризацию и подготовил W0 inputs. Он не может считаться
полностью выполненным, потому что обязательные numeric coverage, production
Job census, live R-34 observation, zero-gap independent route review, concrete
safe rollback floor и полная compliance подпись отсутствуют. Кроме того,
подтверждены два Critical и несколько High security blockers.

**Финальный статус: этап выполнен частично.**

**Переход к Этапу 02: NO-GO.**
