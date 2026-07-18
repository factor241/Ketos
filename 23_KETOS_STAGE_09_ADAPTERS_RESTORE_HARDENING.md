# Этап 09 — Restricted MCP/agentic adoption, deterministic restore и независимый hardening

> **Для agentic workers:** REQUIRED SUB-SKILL: использовать `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`; вести task tracking чекбоксами и выполнять независимое ревью перед gate.
>
> **Источник:** `14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md`, M3, G3 и H4.
> **Вход:** Этап 08 — `этап выполнен`, `GO`, P2/F1-R/Q1 PASS.
> **Следующий файл:** `24_KETOS_STAGE_10_ROLLOUT_OBSERVATION_COMPLETION.md`.
> **Обязательный режим:** M3 → G3 → H4 последовательны; внутри каждого используются независимые субагенты и все доступные применимые инструменты. H4 reviewers не участвуют в implementation.

## 1. Контекст этапа

После safe human/AI apply текущие MCP v1/projects/v2, agentic и OpenAI Responses пути должны стать ограниченными adapters, а не параллельными mutation/run engines. Особенно важны list/execute TOCTOU и direct-name MCP call: `mcp_enabled`/RBAC/revision должны повторно проверяться в момент execution. Restore должен считать server revision truth, а local cache — только hint. H4 не доделывает foundation, а пытается его опровергнуть.

Зоны: MCP routers/utils, agentic assistant/session/files, Responses, Command/Job/Chat APIs, Board/Project client cache, deep links, export/delete/retention, route security, performance, DR, Flow/KFX/LFX/API/browser/DB/Desktop compatibility.

## 2. Цель этапа

Свести REST/Assistant/MCP/Responses к одинаковым CommandExecution/idempotency/audit semantics; доказать deterministic restore без duplicate/lost entity и forbidden flash; получить независимый security/performance/reliability/compatibility release evidence на одном exact SHA.

## 3. Подробное техническое задание

### M3

Expose only allowlisted versioned IR tools; actor только из authenticated transport; recheck `mcp_enabled`, RBAC, risk, revision, confirmation at execute; устранить list/direct-call mismatch; agentic становится Planner/Proposal adapter; Responses — run/chat adapter; external irreversible action declares compensation impossibility before confirmation.

### G3

Persist/restore active Project/Board/viewport/placements/open/fullscreen context/Chat/Automation; define versioned restore snapshot/hash/reasons; server revision wins; crash at each Command/Chat/Job state; stale cache convergence; deep links/tabs/flags/delete/archive/export/retention; forbidden resource never renders before auth.

### H4

Полная adversarial security matrix; 100/500/1000 Board, 1/5/10/20 chats, small/large Flow, cold/warm/restart metrics; 4-hour soak + approved longer staging soak; browser/backend/worker/DB/network chaos; backup/restore/DR with RPO/RTO; Flow/KFX/LFX/API/DB/browsers/Desktop/coverage/i18n/a11y compatibility; rollback drill preserving W0.

## 4. Задачи и task-level DoD

| ID | Задача | Результат | Критерий завершения |
| --- | --- | --- | --- |
| S09-T01 | M3 admission/tool registry | allowlist/version matrix | No arbitrary SQL/filesystem/backend tool; C1/P2 versions current |
| S09-T02 | Auth-derived actor | transport adapters | Caller `user_id` ignored/rejected; cross-actor session fails |
| S09-T03 | MCP list/execute parity | updated v1/projects/v2 paths | Direct-name disabled/revoked/stale call fails before graph/tool effect |
| S09-T04 | Agentic/Responses adoption | proposal/run/chat adapters | `auto_apply`/filesystem/raw mutation absent; unified ledger semantics |
| S09-T05 | Confirmation/outage/external action | fail-closed adapters | Replay/revocation/audit/outbox outage safe; compensation limits explicit |
| S09-T06 | Restore snapshot/protocol | version/hash/reason contract | Server revision dominates; local cache alone creates no mutation |
| S09-T07 | State crash/restart matrix | recovery evidence | Every command/chat/run state has no duplicate/lost entity |
| S09-T08 | Navigation/cache/flag restore | browser integration | Back/forward/new tab/deep link/flag toggles converge |
| S09-T09 | Retention/forbidden proof | delete/archive/export tests | Forbidden object never flashes; screenshots/network logs reveal no metadata |
| S09-T10 | H4 security | independent attack report | Zero unresolved Critical/High; Medium owned/expiry/controls |
| S09-T11 | H4 performance/soak | numeric report | p50/p95/p99, heap, DB plans, connections, lag, long tasks; 4h soak PASS |
| S09-T12 | H4 chaos/DR/rollback | recovery report | Approved RPO/RTO; replay/restore works; W0 floor preserved |
| S09-T13 | H4 compatibility/quality | release matrix | Flow/KFX/LFX/API/DB/browsers/Desktop/coverage/RU/EN/a11y PASS |
| S09-T14 | Evidence/reviewer closure | release candidate manifest | All results exact SHA/env/hash; five independent disciplines PASS |

## 5. Подэтапы и параллельность

| Подэтап | Параллельно | Предшественники | Результат | Ответственный | Проверка | Блокирует |
| --- | --- | --- | --- | --- | --- | --- |
| S09.0 Admission | Нет | Stage 08 GO | adapter/restore/H4 manifests | Coordinator | versions/SHA/registrars | All |
| S09.1 M3 adapters | Adapter lanes parallel; central registry serial | S09.0 | restricted adapters | MCP/agentic/Responses agents | parity/replay/outage/direct-name | G3 |
| S09.2 M3 independent security | Review parallel | S09.1 | adapter PASS | Security reviewer | direct raw-tool/actor/permission probes | G3 |
| S09.3 G3 restore implementation | Backend/frontend lanes parallel | S09.2 | restore protocol/UI | State/UX agents | deterministic fixtures/reasons | H4 |
| S09.4 G3 E2E | Heavy scenarios serial | S09.3 | integrated restore evidence | Test/recovery | crash matrix/browser/network logs | H4 |
| S09.5 H4 attack/perf/compat | Independent lanes parallel; heavy jobs serial | S09.4 + Q1 | release evidence | Separate reviewers | reruns on same RC | H4 gate |
| S09.6 H4 soak/DR/rollback | Sequential operational drills | S09.5 prerequisites | reliability evidence | Release/recovery | 4h+soak/RPO/RTO/rollback | Closure |
| S09.7 Final evidence reconciliation | Нет | S09.5–S09.6 | GO/NO-GO | Coordinator + release reviewer | manifest/hash/status scan | Stage 10 |

## 6. Распределение субагентов

| Субагент | Цель | Ответственность | Результат | Проверка |
| --- | --- | --- | --- | --- |
| Codebase/Graphify analyst | Полный adapter/restore path map | MCP/agentic/Responses/cache/retention | source map | graph/source/AST scan |
| MCP implementers | Restricted tools/parity | S09-T01–T03 | allowlisted adapters | direct-name/list/revoke tests |
| Agentic/Responses implementers | Unified semantics | S09-T04–T05 | proposal/run/chat adapters | ledger/idempotency/outage tests |
| Restore backend/frontend | Server-truth convergence | S09-T06–T09 | snapshot/reconcile/UI | deterministic hash/crash/browser |
| Проектирование / Product Design-UX | Restore/deep-link/forbidden states | loading/error/lost-window/return context | UX oracle | Existing design system + Chrome live proof |
| Security red team | H4 adversarial matrix | routes/REPL/SSRF/secrets/confirmation/search/outages | attack report | independent current-RC probes |
| Performance/reliability | Benchmarks/soak/chaos | S09-T11–T12 | numeric/DR reports | raw datasets, thresholds, RPO/RTO |
| Compatibility | Flow/KFX/LFX/API/DB/browser/Desktop | S09-T13 | release matrix | exact commands and artifacts |
| Testing | Full-story E2E | S09-T07–T09/T14 | evidence | same RC; focused→package→E2E |
| Documentation | Tools/restore/DR/release | runbooks/user/admin/security | docs bundle | links/redaction/accuracy |
| Requirements/compliance | R-36–40 and all DoD inputs | traceability | verdict | no missing live surface |
| Independent release reviewers | Security/data/editor/compat/release | H4 gate | PASS/FAIL/BLOCKED | Not implementers; same SHA |

Superpowers, Graphify, Product Design и все доступные relevant tools обязательны. Chrome используется для restore/deep links/tabs/forbidden flash/performance; «Компьютер» — для OS-level restart/window/fullscreen/Desktop evidence. Browser screenshots дополняются network/log/authorization artifacts. Heavy work соблюдает RSS cap и сериализацию.

## 7. Зависимости от предыдущих этапов

M3 требует F1-R+P2; G3 требует M3+P2; H4 требует G3+Q1. Любой current live surface, оставшийся вне adapter semantics, блокирует M3. H4 не может принять waiver для missing foundation — дефект возвращается в владеющий этап и RC пересобирается.

## 8. Предполагаемые результаты

- Restricted versioned MCP/agentic/Responses adapters.
- Identical Command/Job/audit/idempotency semantics across transports.
- Deterministic restore protocol/UI and no forbidden flash.
- Independent security/performance/chaos/DR/compatibility evidence.
- Release candidate SHA и tested rollback target.

## 9. Критерии завершения задач

Adapter tasks требуют direct-name/list/revoke/replay/cross-actor/outage/raw-tool injection tests. Restore tasks — fixture hash, crash at every state, stale cache, tabs/deep links/flags/retention, network screenshot proof. H4 — preregistered thresholds, raw numeric data, exact RC, independent rerun and current rollback drill.

## 10. Общие критерии этапа

- [ ] S09-T01…T14 PASS.
- [ ] MCP/agentic/Responses expose no arbitrary mutation/tool bypass.
- [ ] Actor is transport-derived; permission/`mcp_enabled` rechecked at execute.
- [ ] REST/Assistant/MCP have identical command/idempotency/audit behavior.
- [ ] Restore hash deterministic; stale cache converges; no duplication/loss.
- [ ] Forbidden object never appears in DOM/screenshot/network metadata.
- [ ] H4 zero unresolved Critical/High.
- [ ] Board/chat/Flow performance, 4h soak, chaos and DR meet approved thresholds/RPO/RTO.
- [ ] Flow/KFX/LFX/API/DB/browser/Desktop/coverage/i18n/a11y PASS.
- [ ] Five independent reviewer disciplines PASS on exact RC SHA.

## 11. Риски, блокеры и устранение

| Риск | Устранение |
| --- | --- |
| MCP list filters but direct call executes | Mandatory execute-time recheck + direct-name regression |
| Agentic/Responses keep parallel truth | Adapter only; Command/Job ledger assertions |
| Local cache recreates stale entity | Server revision truth; cache read-only hint; reasoned reconciliation |
| Forbidden flash before auth | No render/data until authorization; DOM/network assertions |
| Soak/chaos exceeds RSS | Serialize scenarios; stop optional agents; preserve raw evidence |
| H4 finds foundation gap | Return to owning stage; no hardening-layer patch that hides it |
| Desktop unknown | Enforce declared status; no inferred PASS |

## 12. Тестирование, проверка и документация

MCP/agentic/Responses route/import/AST scans; actor/risk/revision/confirmation/outage tests; deterministic restore/crash/restart; browser tabs/deep links/cache/flags; delete/export/retention; full route security; REPL/SSRF/secrets/rate abuse; performance p50/p95/p99/heap/DB plans; 4h+soak; chaos/backup/DR/rollback; Flow/KFX/LFX/API/DB/browsers/Desktop/coverage/RU/EN/pseudo/keyboard. Python через `uv run`; heavy jobs serial. Docs: tool allowlist, adapter contracts, restore reasons, incident/DR/rollback/release runbooks.

## 13. Условия невыполнения

Любой direct-call bypass, caller-trusted actor, parallel mutation truth, duplicate/lost restore, forbidden flash, unresolved Critical/High, missing raw performance/DR evidence, stale compatibility result, waiver вместо foundation fix или reviewer conflict означает `NO-GO`.

## 14. Условия перехода

Stage 10 начинается только при `этап выполнен`, `GO`, H4 PASS, exact RC manifest и tested safe rollback. Любой PARTIAL/BLOCKED запрещает rollout cohorts.

## 15. Контроль перехода

| Поле | Обязательная запись |
| --- | --- |
| Выполненные задачи | M3/G3/H4 и S09-T IDs, RC/rollback digests |
| Невыполненные задачи | Причина, owner, unblock, rollout impact |
| Частично выполненные задачи | Adapter/restore/hardening gaps |
| Обнаруженные дефекты | Severity, reproduction, owning earlier stage |
| Активные блокеры | Security/perf/soak/DR/compat/reviewer blocker |
| Результаты тестирования | Restore/security/perf/soak/chaos/DR/compat commands/artifacts |
| Результаты проверки субагентами | Handoffs и five-discipline reviewer verdicts |
| Соответствие критериям завершения | Каждый пункт §10 и H4 gate |
| Вывод о возможности перехода | `GO`/`NO-GO` к production rollout |

## 16. Итоговый формат отчёта

```markdown
# Отчёт по Этапу 09
Статус: этап выполнен | этап выполнен частично | этап заблокирован
RC / rollback digest: <...>
M3/G3/H4: <verdicts>
Переход: GO | NO-GO
## Tasks/evidence
<S09-Txx, commands, exits, hashes>
## Security/restore/performance/DR/compatibility
<metrics, thresholds, incidents, verdicts>
## Defects/blockers/subagents
<owner, unblock, independent reviews>
## Completion criteria/status rationale
<§10 + current-SHA links>
```
