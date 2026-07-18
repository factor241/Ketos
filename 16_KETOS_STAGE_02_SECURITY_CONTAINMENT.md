# Этап 02 — Контроль текущих поверхностей и обязательный security floor

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, §3, W0-A…W0-D и GC-07/08/10/15–18.
> **Вход:** Этап 01 имеет статус `этап выполнен` и `GO`.
> **Следующий файл:** `17_KETOS_STAGE_03_RISK_EXPERIMENTS.md`.
> **Обязательный режим:** реализация ведётся субагентами; использовать все доступные инструменты, применимые к этапу. Security reviewer не может быть автором проверяемого изменения.

## 1. Контекст этапа

Ketos уже имеет MCP, OpenAI Responses, agentic, webhook, workflow v2, build/public build, filesystem и custom-component surfaces. Новые Board/Chat/AI функции увеличат ущерб от существующего fail-open поведения, поэтому W0 выполняется до product expansion. Этап закрывает ownerless Job, list/execute TOCTOU, обходы `auto_apply`/`skipAll`, unauthenticated webhook, небезопасный custom code/REPL, SSRF/DNS rebinding, leakage секретов и неподдерживаемый task backend.

Основные части проекта: `services/jobs`, модели Job, `api/v1/mcp*`, `openai_responses.py`, `agentic/**`, `api/v2/workflow.py`, build/public routes, KFX security settings, REPL, SSRF transport и сетевые components. Этап не реализует Board, новый Command Kernel или Job idempotency foundation; если W0 тест выявляет зависимость от будущего F1-J, она фиксируется как explicit dependency, а текущая поверхность всё равно переводится в fail-closed режим.

## 2. Цель этапа

Создать текущий безопасный application floor: ни один новый Job не остаётся без владельца; обычный actor не видит/не останавливает ownerless/quarantined Jobs; все registered routes применяют server-derived actor и одинаковые authz rules; multi-user профили не допускают REPL, unisolated custom code, unauthenticated webhook или auto-apply; egress, secrets, rate/size/concurrency и task backend работают fail-closed.

## 3. Подробное техническое задание

- Реализовать W0-A owner-safe Job contract и additive quarantine/backfill без уничтожения legacy rows.
- Закрыть W0-B для MCP, Responses, agentic, webhook, workflow v2 и build/public routes.
- Разделить domain filesystem mutation и scoped user file management; запретить обход capability policy.
- Централизовать egress validation с redirect revalidation и DNS-pinned connection; ввести raw-client policy test.
- Доказать отсутствие секретов во Flow/export/version/MCP/error/log/trace/result artifacts.
- Ввести profile-aware startup validation и JSON-only task serialization; неподдерживаемые settings должны блокировать старт.
- Выполнить adversarial actor/profile/capability matrix и независимый security audit с нулём Critical/High.

Rollback допускается только на W0-safe application. Он не может вернуть ownerless reads, unauthenticated shared ingress, multi-user REPL или agentic bypass.

## 4. Перечень задач и критерии каждой задачи

| ID | Техническая задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S02-T01 | Admission и W0 test map | current-SHA scope/route matrix | Все Stage 01 inputs актуальны; каждый route имеет test owner |
| S02-T02 | Non-null Job owner boundary | service/model tests | `create_job(user_id: UUID)` отклоняет NULL на type/runtime boundary |
| S02-T03 | Fail-closed Job reads/mutations | CRUD/API patch + tests | Нет ordinary `OR user_id IS NULL`; other actor не читает/stop row |
| S02-T04 | Legacy ownerless classification | dry-run ledger + migration | `attributable + ambiguous + orphan = all NULL`; неизвестные quarantined |
| S02-T05 | MCP parity | list/direct-name tests | `mcp_enabled=false` и revoked EXECUTE блокируют до graph execution |
| S02-T06 | Responses/agentic controls | route/security tests | Actor/Flow EXECUTE/limits enforced; `auto_apply`/`skipAll` не commit в secure profiles |
| S02-T07 | Webhook/workflow/build parity | actor/profile matrix | POST/GET/stop единообразны; webhook auth обязателен; build получает capability limits |
| S02-T08 | Custom code/REPL/filesystem | capability policy + exploit corpus | Multi-user REPL/custom code disabled; zero host file/env/network side effect |
| S02-T09 | SSRF/egress | central validator+pinned transport | Loopback/private/link-local/metadata/redirect/rebinding corpus blocked |
| S02-T10 | Secret containment | canary suite | Ноль canary occurrence во всех перечисленных artifacts |
| S02-T11 | Task backend/startup | validation + serializer tests | Invalid combinations fail startup; Celery JSON-only and explicit credentials contract |
| S02-T12 | Rate/size/concurrency failure modes | abuse tests | Secure profiles enforce bounded requests/streams/runs and fail closed on guard outage |
| S02-T13 | Independent security closure | signed verdict | Ноль unresolved Critical/High; Medium имеет owner/expiry/control |

## 5. Подэтапы и параллельное выполнение

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Что блокирует невыполнение |
| --- | --- | --- | --- | --- | --- | --- |
| S02.0 Admission/test-first | Нет | Stage 01 GO | immutable scope и failing regression tests | Coordinator + test designer | tests действительно падают на старом поведении | Все W0 lanes |
| S02.1 Job ownership | С S02.2–S02.4; миграция serial | S02.0, Stage 01 census | owner-safe Job/quarantine | Backend/data + DB registrar | unit/API/SQLite/PostgreSQL census | S02.5, F1-J |
| S02.2 Route containment | Да по router groups | S02.0 route matrix | MCP/Responses/agentic/webhook/workflow/build guards | Route security agents + API registrar | full actor/profile matrix | S02.5, C1/F1 |
| S02.3 Code/filesystem containment | Да | S02.0 capabilities | disabled dangerous capabilities + scoped file policy | KFX/security | exploit corpus, traversal/quota/type tests | S02.5, R2/P2 |
| S02.4 Egress/secrets/task backend | Три lanes параллельно | S02.0 | pinned egress, canary proof, startup guard | Security/execution agents | SSRF, canary, serializer tests | S02.5, all network/run work |
| S02.5 Integration/adversarial | Нет; heavy suites serial | S02.1–S02.4 | integrated security evidence | Test lead + independent reviewer | negative matrix + failure injection | Переход к Этапу 03 |

Регистраторы `models/__init__.py`, Alembic, API router/OpenAPI, KFX security config и test policy эксклюзивны. Feature agents передают registrar patch request, не редактируют центральные файлы одновременно.

## 6. Субагенты: цель, ответственность и проверка

| Субагент | Цель | Зона и конкретные задачи | Ожидаемый результат | Проверка |
| --- | --- | --- | --- | --- |
| Анализ кодовой базы/Graphify | Полный call/data chain | Job writers/readers; routes; raw clients; file tools | current-SHA inventory delta | Source query + manual spot-check |
| Архитектор security profiles | Удержать единый floor | profile/startup/rollback contracts | approved security design | threat-model review |
| Backend/data implementer | Job ownership/quarantine | S02-T02–T04 | migrations/services/tests | DB matrix + invariant totals |
| Route implementers | Закрыть registered surfaces | S02-T05–T07, по непересекающимся routers | guards и negative tests | API/OpenAPI snapshots |
| KFX/capability implementer | Изолировать code/files | S02-T08 | fail-closed capability layer | exploit corpus |
| Egress/secrets implementers | Защитить network/data | S02-T09–T11 | pinned transport/canary/startup | adversarial tests |
| Тестирование | Falsify controls | S02-T12, concurrency/failure injection | reproducible evidence | rerun on integration SHA |
| Product Design/frontend review | Проверить visible bypass states | disabled/forbidden/error UX без metadata leak | UX/accessibility findings | Chrome/browser + network proof при запущенном app |
| Документация | Runbook/rollback/threat model | security profile docs, known dependencies | current-SHA docs | link/schema review |
| Контроль требований | GC/R/W0 coverage | R-38/R-39 и §3.2 traceability | compliance verdict | every route/capability mapped |
| Независимый security reviewer | Атаковать релиз-кандидат | Все Critical/High paths | PASS/FAIL/BLOCKED | Не автор; повторяет выбранные probes |

Используются Superpowers, Graphify, repository tests, security/static tools и все другие доступные релевантные инструменты. Product Design, Chrome и «Компьютер» применяются к user-visible forbidden/disabled states только после source/API tests; DOM screenshot без network/authorization evidence не считается PASS.

## 7. Зависимости от предыдущего этапа

Обязательны все artifacts Этапа 01: Job census, route/capability inventory, profile snapshot, approved safe rollback floor, clean worktree registry и W0 plan. Если они устарели относительно текущего SHA, выполняется bounded rebaseline; Stage 02 не начинает изменения на предположениях.

## 8. Предполагаемые результаты

- Secure profiles с validated startup combinations.
- Owner-safe Job и quarantined legacy ambiguity.
- Единая route-level authorization matrix для всех live surfaces.
- Disabled/contained REPL, custom code, filesystem и agentic mutation paths.
- DNS-pinned egress, secret canary proof, safe task backend.
- W0 application digest и rollback drill.

## 9. Верификация задач

Каждая задача следует TDD: failing regression → минимальное исправление → focused test → affected package gate → integration matrix → независимый review. Evidence содержит SHA/profile/command/exit/hash и доказывает отсутствие side effects. Для concurrency/TOCTOU обязательны барьеры или event-based synchronization, а не произвольное увеличение timeout.

## 10. Общие критерии завершения этапа

- [ ] S02-T01…T13 PASS.
- [ ] New ownerless Job insert невозможен; ordinary actor не видит quarantined/NULL rows.
- [ ] MCP list и direct call повторно проверяют current authz/`mcp_enabled`.
- [ ] Secure profiles отвергают unauthenticated webhook и agentic auto-apply.
- [ ] Workflow POST/GET/stop и build/public surfaces имеют полный actor matrix.
- [ ] SSRF/rebinding и REPL exploit corpora дают zero side effect.
- [ ] Secret canary count равен нулю.
- [ ] Unsupported task backend/settings fail startup.
- [ ] Rollback drill сохраняет W0 floor.
- [ ] Независимый security verdict: zero unresolved Critical/High.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| Ownerless rows невозможно атрибутировать | Quarantine; запрет обычной видимости; не выдумывать owner |
| Legacy webhook нужен клиенту | Только explicit `trusted_legacy_webhook`, isolated ingress, warning и telemetry |
| Изоляция REPL отсутствует | Оставить capability disabled; отдельный ADR/program позже |
| DNS validation расходится с connection | Один pinned transport; redirect revalidation; fail closed |
| Multi-worker limiter отсутствует | Реализовать shared limiter либо явно блокировать multi-worker |
| Fix ломает compatibility | Flag/adapter на W0-safe behavior; regression suite; не возвращать bypass |
| Security tool/fixture недоступен | Точный blocker и required fixture; NO-GO вместо waiver |

## 12. Тестирование, проверка и документирование

Минимум: focused pytest через `uv run`; ruff/format; migration matrix SQLite/PostgreSQL; actor matrix owner/other/admin/API-key/anonymous; OpenAPI snapshots; MCP direct-name; workflow stop race; webhook replay; REPL and filesystem exploit corpus; SSRF DNS/redirect/rebinding; secret canary; serializer/startup; rate/size/concurrency; affected KFX/LFX/API compatibility. Heavy jobs выполняются последовательно. Документы: threat model, profile manifests, route matrix, migration/quarantine ledger, rollback runbook и evidence manifest.

## 13. Условия невыполнения

Любой unresolved Critical/High, ownerless/fail-open path, list/execute mismatch, auto-apply bypass, unauthenticated secure-profile webhook, host side effect REPL, SSRF escape, secret leakage, invalid startup acceptance, непроверенный rollback или отсутствующий independent verdict означает `этап выполнен частично` либо `этап заблокирован` и `NO-GO`.

## 14. Условия перехода

Этап 03 начинается только при `этап выполнен`, `GO`, полном S02-T01…T13 PASS и опубликованном W0 safe-build digest. Частичный/заблокированный этап запрещает любые production-oriented X/C1/F1 work; допускается только диагностика blocker.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | IDs, evidence links и hashes |
| Невыполненные задачи | Причина, owner, точный unblock |
| Частично выполненные задачи | Доказанная и недоказанная части, downstream impact |
| Обнаруженные дефекты | Severity, reproduction, owner, target fix |
| Активные блокеры | Internal/external, unblock и дата повторной проверки |
| Результаты тестирования | Actor/profile/SSRF/REPL/canary/migration commands, exits, artifacts |
| Результаты проверки субагентами | Handoffs и независимые verdicts |
| Соответствие критериям завершения | Каждый пункт §10: PASS/FAIL/BLOCKED + ссылка |
| Вывод о возможности перехода | `GO` или `NO-GO` с обоснованием |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 02
Статус: этап выполнен | этап выполнен частично | этап заблокирован
Release SHA / W0 safe-build digest: <...>
Переход: GO | NO-GO
## Task status
<S02-Txx: PASS/PARTIAL/BLOCKED + evidence>
## Дефекты и блокеры
<severity, owner, unblock>
## Security/test/reviewer results
<commands, exits, hashes, verdicts>
## Completion criteria
<каждый пункт §10>
## Обоснование статуса и перехода
<current-SHA evidence links>
```

Статус без конкретных критериев, результатов проверок и ссылок на проблемы недействителен.
