# Лингвистический review русской локализации

## Ответственность

- Основной reviewer: `ru-linguistic-reviewer`.
- Технический reviewer: `localization-governance`.
- ABI/protocol reviewer: `platform-contracts`.
- Владелец extension namespace подписывает только свой bundled bundle; core namespace остаётся под `localization-governance`.

`ru-linguistic-reviewer` проверяет терминологию, естественность и единообразие русского текста. `localization-governance` проверяет полноту каталогов, tokens, plural forms и отсутствие fallback. `platform-contracts` подтверждает, что перевод не изменил identifiers, values, events, routes и persisted data.

## Статусы

- `PENDING` — wave ещё не передан на review.
- `CHANGES_REQUESTED` — есть конкретные замечания; merge/release gate закрыт.
- `APPROVED` — все обязательные проверки wave выполнены, blockers отсутствуют.
- `BLOCKED` — review невозможно завершить без внешнего входа; указаны evidence и минимальный unblock.

Молчание, отсутствие замечаний или исторический PASS не считаются одобрением текущего checkout.

## Формат письменного sign-off

Каждая запись содержит:

| Поле | Обязательное содержание |
|---|---|
| `wave` | Task или точный namespace/surface scope |
| `commit` | Проверенный Git SHA |
| `artifacts` | Каталоги, screenshots, DOM/a11y/error reports |
| `checks` | Glossary, style, tokens/tags, plurals, user/protocol boundaries |
| `findings` | Список замечаний с path/key/surface или `none` |
| `status` | `PENDING`, `CHANGES_REQUESTED`, `APPROVED` или `BLOCKED` |
| `reviewer` | Стабильная роль reviewer |
| `date` | Дата проверки в ISO-формате |

Пример:

```text
wave: frontend-a
commit: <sha>
artifacts: <paths>
checks: glossary PASS; style PASS; tokens PASS; user/protocol boundary PASS
findings: none
status: APPROVED
reviewer: ru-linguistic-reviewer
date: YYYY-MM-DD
```

## Обязательная матрица review

| Wave | Scope | Технический review | Лингвистический review | Visual/a11y evidence | Текущий статус |
|---|---|---|---|---|---|
| governance | glossary + style guide | обязателен | обязателен | не требуется | APPROVED |
| frontend catalog | `src/frontend/src/locales/ru.json` | обязателен | обязателен | plural/token reports | TECHNICAL APPROVED; LINGUISTIC PENDING |
| frontend A | shell/shared/auth/admin | обязателен | обязателен | RU + pseudo + accessibility | PENDING |
| frontend B | dashboard/assets/settings/deployments/MCP | обязателен | обязателен | RU + pseudo + accessibility | PENDING |
| frontend C | canvas/nodes/component forms | обязателен | обязателен | RU + pseudo + ABI | PENDING |
| frontend D | assistant/playground/IO/voice/traces/memories | обязателен | обязателен | RU + pseudo + raw-output boundary | PENDING |
| backend catalog | built-in component metadata | обязателен | обязателен | metadata report | PENDING |
| errors | native error envelopes + UI mapping | обязателен | обязателен | scenario report | PENDING |
| final acceptance | all manifest routes/states | обязателен | обязателен | complete artifact matrix | PENDING |

## STOP-условия reviewer

Review получает `CHANGES_REQUESTED`, если обнаружены:

- разные переводы одного glossary term без документированного контекста;
- запрещённый вариант;
- English system prose в strict RU;
- потерянный interpolation token, numeric tag, HTML/Markdown link или plural category;
- перевод brand/protocol/model/provider/code identifier;
- изменение user-owned текста, raw provider output или diagnostics payload;
- translated text в `data-testid` либо сопоставление option/output по переведённой подписи;
- layout/a11y дефект, скрывающий текст вместо исправления перевода.

## Журнал sign-off

Записи добавляются только после свежей проверки текущего checkout.

### R4 technical snapshot 2026-07-12

- Checkout: dirty `worktree@def832f409c01f0acd3937b9317dde03d0273552`; это не release commit.
- Frontend source catalog: `en.json` SHA-256 `3df37591c049911a369680dc79189068b174f93a318defe93f4ee9e8d205e7f0`, 2,373 keys.
- Frontend Russian catalog: `ru.json` SHA-256 `92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b`, 2,447 keys.
- `npm run i18n:check`: PASS, `ru` issues = 0; `npm run i18n:check:keys`: PASS, new/stale blocking debt = 0.
- `npm run test:i18n`: PASS, 43 Node tests + 75 Jest tests; все 37 source plural groups имеют `one/few/many/other` и проходят boundary cases `0, 1, 2, 5, 11, 21, 22, 25, 101, 1.5`.
- `npm run i18n:check:hardcoded`: PASS, 1,605 production files + current `index.html`, 405 AST candidates, new system-owned English = 0, stale exact identities = 0. Это repo-wide scan, включающий Waves A/C/D; icon names, test IDs, protocol/provider/user/assistant payload не переводились.
- Focused Wave A/C/D contracts и formatting/rerender regressions: PASS, 6 suites / 81 tests. Rendered `IngestionHistoryPanel.language-change.test.tsx` подтверждает обновление visible и accessibility text после `languageChanged` при неизменном user-owned `source_name`; `flow-localization-abi-regression.test.ts` подтверждает machine-identical flow corpus.
- Browser screenshots, axe по полной route/state matrix, clipping/overflow и human linguistic review в этом snapshot не выполнялись. Поэтому строки technical review ниже не являются visual/route/linguistic PASS; эти статусы остаются PENDING до R7/R8.

| Wave | Commit | Artifacts | Checks | Findings | Status | Reviewer | Date |
|---|---|---|---|---|---|---|---|
| governance | `def832f409c01f0acd3937b9317dde03d0273552` | `glossary.md`, `style-guide.md`, `translation-boundary.md` | glossary PASS; style PASS; protected tokens PASS; boundary PASS | none | APPROVED | `ru-linguistic-reviewer` | 2026-07-11 |
| frontend catalog | `worktree@def832f409c01f0acd3937b9317dde03d0273552` | `src/frontend/src/locales/ru.json`, `src/frontend/src/__tests__/locale-contract.test.ts`, `src/frontend/src/__tests__/russian-plurals.test.ts`, `scripts/i18n/allowlists/english-identical-values.json` | source alignment PASS; empty values PASS; interpolation PASS; numeric tags PASS; protected fragments PASS; 25 plural groups PASS; identical allowlist PASS | none in catalog; `shareModal/index.tsx` literal `Flow` assigned to frontend integration wave | APPROVED | `localization-governance` | 2026-07-11 |
| frontend catalog | `worktree@def832f409c01f0acd3937b9317dde03d0273552` | `src/frontend/src/locales/ru.json`, glossary/style reports, plural boundary report | glossary PASS; style PASS; protected tokens PASS; Russian plurals PASS; English prose PASS; typography PASS | none in catalog; `shareModal/index.tsx` literal `Flow` assigned to frontend integration wave | APPROVED | `ru-linguistic-reviewer` | 2026-07-11 |
| frontend catalog technical | `worktree@def832f409c01f0acd3937b9317dde03d0273552`; `en=3df37591c049911a369680dc79189068b174f93a318defe93f4ee9e8d205e7f0`; `ru=92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` | `src/frontend/src/locales/{en,ru}.json`, `locale-contract.test.ts`, `russian-plurals.test.ts`, frontend locale/key/hardcoded gates | parity/tokens/tags PASS; ru issues 0; 37 plural groups PASS; new English 0; stale identities 0 | technical none; current-hash human linguistic re-review not performed | APPROVED | `localization-governance` | 2026-07-12 |
| frontend A technical | `worktree@def832f409c01f0acd3937b9317dde03d0273552`; `ru=92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` | `task-9-localization-contract.test.ts`, `check_frontend_hardcoded.mjs` | shell/shared/auth/admin source and a11y-key contracts PASS; repo-wide new English 0 | technical none; browser RU/pseudo/axe/route evidence pending R7/R8 | APPROVED | `localization-governance` | 2026-07-12 |
| frontend C technical | `worktree@def832f409c01f0acd3937b9317dde03d0273552`; `ru=92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` | `task-11-localization-contract.test.ts`, `flow-localization-abi-regression.test.ts`, `check_frontend_hardcoded.mjs` | canvas/node/form contracts PASS; machine graph ABI corpus PASS; repo-wide new English 0 | technical none; browser canvas states, pseudo and full visual/a11y evidence pending R7/R8 | APPROVED | `localization-governance` | 2026-07-12 |
| frontend D technical | `worktree@def832f409c01f0acd3937b9317dde03d0273552`; `ru=92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` | `task-12-localization-contract.test.ts`, `check_frontend_hardcoded.mjs` | assistant/playground/IO/voice/traces/memories contracts PASS; user/assistant/provider payload and event identifiers preserved; repo-wide new English 0 | technical none; browser raw-output/a11y/route evidence pending R7/R8 | APPROVED | `localization-governance` | 2026-07-12 |
| frontend formatting/runtime technical | `worktree@def832f409c01f0acd3937b9317dde03d0273552`; `ru=92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` | `sort-by-name.test.ts`, `locale-format.test.ts`, `IngestionHistoryPanel.language-change.test.tsx` | shared locale Collator PASS; locale-aware UTC presentation PASS; opened UI rerender + accessible name PASS; user-owned source name preserved | none in focused rendered test; full browser matrix pending R7/R8 | APPROVED | `localization-governance` | 2026-07-12 |
