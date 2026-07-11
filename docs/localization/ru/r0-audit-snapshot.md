# R0 audit snapshot русской локализации

Статус: `SNAPSHOT_CAPTURED_WITH_CONCERNS`  
Дата среза: `2026-07-12T01:45:02+0700`  
Рабочий каталог: `/Volumes/Projects/ketos_canvas_mod_main`

## Git baseline

| Поле | Значение |
|---|---|
| Branch | `main` |
| HEAD | `def832f409c01f0acd3937b9317dde03d0273552` |
| HEAD tree | `59ff091e9d1953d0c18e4087697004cb739ec837` |
| Upstream | `origin/main` |
| Ahead / behind | `0 / 0` |
| Worktree | dirty; отдельный reviewable commit в рамках этого среза не создавался |

HEAD является baseline исходников, но не идентификатором текущего dirty-содержимого. Для dirty-содержимого ниже приведены SHA-256 ключевых артефактов и fingerprint status manifest. Fingerprint привязывает статусы и пути; для ключевых файлов содержимое привязано отдельными hash.

## Классификация `git status`

Срез классифицирован одновременно в двух представлениях:

- user-facing porcelain с каталогами untracked, свёрнутыми Git;
- полностью раскрытый `--untracked-files=all` manifest, где каждый файл является отдельной записью.

| Категория | Porcelain entries | Раскрытые file entries | Правило |
|---|---:|---:|---|
| localization scope | `441` | `471` | Все tracked application/build/test изменения и новые localization implementation/docs/test files, кроме явно перечисленных ниже pre-existing и generated путей. |
| pre-existing | `5` | `5` | Контекстные audit/plan/report файлы, существовавшие до R0 и не изменяемые этим срезом. |
| generated artifacts | `4` | `4,794` | `.artifacts/**`, `.superpowers/**`, `graphify-out/**`, Playwright PNG snapshots. |
| Всего | `450` | `5,270` | Текущий dirty worktree на момент фиксации. |

Pre-existing entries:

- `FRONTEND_ARCHITECTURE_AUDIT.md`
- `LANGFLOW_BACKEND_ARCHITECTURE_AUDIT.md`
- `LANGFLOW_RUSSIAN_LOCALIZATION_PLAN.md`
- `LANGFLOW_RUSSIAN_LOCALIZATION_IMPLEMENTATION_REPORT.md`
- `LANGFLOW_RUSSIAN_LOCALIZATION_REMAINING_PLAN.md`

Generated roots:

- `.artifacts/` — build, release и runtime evidence;
- `.superpowers/` — execution ledger/reports/intermediate generated data; `sdd/progress.md` остаётся рабочим ledger и отдельно исправлен в R0;
- `graphify-out/` — сгенерированный граф;
- `src/frontend/tests/core/features/localization-russian-a11y.spec.ts-snapshots/` — Playwright PNG evidence.

Fingerprint полностью раскрытого status manifest (категория, porcelain code, путь): `c4d261c7dbacb8bea7923e32f86b0f5025b402254f9c2f8b6f4da89cfcdc34f9`. Fingerprint свёрнутого porcelain manifest: `d1d8ec3ed45e9b8ebbea715a9d90e4a4b9c133aef91a7e62592ec4fbfa2f3376`.

Важно: исходный remaining plan фиксировал 441 запись на более раннем аудите. Текущий счётчик является новым фактическим срезом и не заменяется историческим числом.

## Content hashes

Алгоритм: SHA-256, содержимое файлов текущего worktree.

| Артефакт | SHA-256 |
|---|---|
| `LANGFLOW_RUSSIAN_LOCALIZATION_PLAN.md` | `ffa8c286d12580ea41f7b147481b212df2b5bda9763581eb8e52133803869c5d` |
| `LANGFLOW_RUSSIAN_LOCALIZATION_IMPLEMENTATION_REPORT.md` | `ea19d3aceff1f66a86d519ff18fc4d23e732b5269ffa54f1e6ba573802399a5e` |
| `LANGFLOW_RUSSIAN_LOCALIZATION_REMAINING_PLAN.md` | `7b4b1e79562196c379df224848b0a25fb954dd3e4052ccf07020cdc5962dd6fa` |
| `docs/localization/ru/glossary.md` | `f45eaefe6b9bcbfa2588835fbf44c49fa35db183c63e49eb3d8facb4efb795f7` |
| `docs/localization/ru/style-guide.md` | `905e73eb31cf2229fdab6ef3bc2f23b84ea09c824913c523f1611d8ce7809766` |
| `docs/localization/ru/translation-boundary.md` | `7317acd13afa0e1391b525161a8efc866e1c52e3deb1d07cbca675078ea30ee9` |
| `docs/localization/ru/linguistic-review.md` | `7e71d0f092ca4e47f83a942ddcd2bb50406dbbccd6c2d1476489422edf6e015e` |
| `.superpowers/sdd/progress.md` | `9e70382fcb9dada777ab85c2b5a38eb12a40a77570e3815a0b55ee5ac9ec38c9` |
| `src/frontend/src/locales/ru.json` | `92ee623ef7d95dc4b73d27a23ed7e691cffcf1f60f217e470e816b312f7d5a4b` |
| `src/backend/base/langflow/locales/ru.json` | `4f396a4ab560179a2f7ef3fbb66695ba6eefe68b9cb4b2b1e67ea069426eff8e` |
| `docs/localization/ru/surface-manifest.csv` | `d5281c9a7873d20c92d845a0f2c9460dbe763ad9f4481c85f6c7b540b0e984d2` |
| `docs/localization/ru/task-18-acceptance.md` | `2ad70732f510fce1a4ceb1280e160f013f228e45273835fc5abe4980d9316303` |
| `docs/localization/ru/maintenance.md` | `d99ceff71203a0c16f45469ab13c6a3f0fbf702c486827add36d8a35c3b45bc2` |
| `docs/localization/ru/release-rollout-rollback.md` | `0c51da62b367f7b32c5e6cf77f0084feb54e347f4458cbb0c9f525273ec5dc87` |
| `.superpowers/sdd/task-13-extraction-report.json` | `be875333137ea97af468b6ba10878163f36864f44bd76b87f520c70c406edc84` |
| `src/frontend/package-lock.json` | `bd721ff0f83bd5f0478884d94a96a5b653c7b7689bb9ed940d0dba6d579fbf59` |
| `uv.lock` | `158f5a32d622f299fe82430673be295f17316a5e471fd5d9ef35e6e9e4c3c0dc` |
| `graphify-out/graph.json` | `4361bea521d7f71c6f630fd8b10a94c7f3fa91bb3230e550145c531e0d2df38d` |

## Toolchain snapshot

| Инструмент | Версия |
|---|---|
| Node.js | `v26.3.1` |
| npm | `11.16.0` |
| system Python | `3.13.14` |
| uv | `0.11.21 (5aa65dd7a 2026-06-11 aarch64-apple-darwin)` |
| `uv run python` | `3.13.14` |

Локальный Node/npm не равен toolchain unified Docker build из implementation report; release topology должна подтверждаться отдельно после pinning Docker toolchain.

## Feature-flag matrix

Все перечисленные env-переменные в процессе фиксации были unset.

| Surface / flag | Источник | Effective default текущего checkout |
|---|---|---|
| Russian frontend locale | `VITE_ENABLE_RUSSIAN_LOCALE` | enabled, потому что выключается только точным значением `false` |
| Russian backend locale | `SUPPORTED_LOCALES` | enabled; `ru` включён без отдельного backend flag |
| Pseudo locale | `import.meta.env.MODE` | enabled в dev/test, disabled в production |
| Strict RU diagnostics | `VITE_STRICT_RU_I18N` | disabled; включается только в test mode при `true` |
| Langflow Store | `ENABLE_LANGFLOW_STORE` | `false` |
| Custom parameter | `ENABLE_CUSTOM_PARAM` | `false` |
| Integrations | `ENABLE_INTEGRATIONS` | `false` |
| DataStax customization | `ENABLE_DATASTAX_LANGFLOW` | `false` |
| File management | `ENABLE_FILE_MANAGEMENT` | `true` |
| Publish | `ENABLE_PUBLISH` | `true` |
| Widget | `ENABLE_WIDGET` | `true` |
| Voice assistant | `ENABLE_VOICE_ASSISTANT` | `true` |
| Files in playground | `ENABLE_FILES_ON_PLAYGROUND` | `true` |
| MCP | `ENABLE_MCP` | `true` |
| MCP notice | `ENABLE_MCP_NOTICE` | `false` |
| Knowledge bases | `ENABLE_KNOWLEDGE_BASES` | `true` |
| Inspection panel | `ENABLE_INSPECTION_PANEL` | `true` |
| MCP composer | `LANGFLOW_MCP_COMPOSER_ENABLED` | `false` при unset |
| New sidebar | `ENABLE_NEW_SIDEBAR` | `true` |
| Extension reload | `LANGFLOW_EXTENSION_RELOAD_ENABLED` | `false` при unset |
| wxo deployments | `LANGFLOW_FEATURE_WXO_DEPLOYMENTS` | `false` при unset |
| MVP components | `LANGFLOW_FEATURE_MVP_COMPONENTS` | `false` при unset |

## Governance reconciliation

- Matrix `governance` приведена к `APPROVED`, что соответствует journal entry для того же baseline HEAD.
- Основание подтверждено `task-2-report.md`: 22/22 required terms, independent glossary/style review PASS и governance sign-off APPROVED.
- Это исправление не повышает статусы frontend/backend catalog waves: их свежие content-hash sign-offs остаются отдельными gates.
- Stale утверждение ledger о том, что backend `ru.json` не landed, удалено. Свежий `check_backend_locales.py` подтвердил 11,507 source/Russian keys, missing=0, extra=0 и runtime component index PASS; linguistic sign-off текущего backend catalog hash остаётся pending.

## Graphify state

`graphify-out/graph.json` записывает `built_at_commit=def832f409c01f0acd3937b9317dde03d0273552`, то есть тот же HEAD, но граф не отражает dirty worktree. Read-only query всё ещё возвращает удалённые owners:

- `src/frontend/src/components/core/appHeaderComponent/components/LanguageSelector/index.tsx`;
- `src/frontend/src/pages/SettingsPage/pages/GeneralPage/components/LanguageForm/index.tsx`.

Оба пути отсутствуют в текущем filesystem и помечены Git как deleted. Поэтому Graphify является stale относительно dirty snapshot и не может служить текущим доказательством до разрешённой перегенерации после reviewable commit. В рамках R0 governance/snapshot `graphify-out/**` намеренно не изменялся.

## Воспроизведение проверок

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short --branch
git status --porcelain=v1 --untracked-files=all
node --version
npm --version
python3 --version
uv --version
uv run python --version
uv run python scripts/i18n/check_backend_locales.py
jq -r '.built_at_commit' graphify-out/graph.json
graphify query 'LanguageSelector LanguageForm localization governance' --json
shasum -a 256 <artifact>
```

## Непогашенные concerns R0

1. Dirty snapshot ещё не превращён в отдельный reviewable commit/worktree; это сознательно не сделано из-за запрета на commit в этом задании.
2. Graphify stale относительно dirty worktree и всё ещё содержит deleted Language owners; его перегенерация вне разрешённой зоны.
3. Локальный Node/npm отличается от release builder toolchain; локальные версии зафиксированы, но не заменяют packaging proof.
