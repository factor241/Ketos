# R0 audit snapshot русской локализации

Статус: `PASS_WITH_GRAPHIFY_CONCERN`  
Дата: `2026-07-12`  
Рабочий каталог: `/Volumes/Projects/ketos_canvas_mod_main`

## Reviewable baseline

| Поле | Значение |
|---|---|
| Branch | `codex/russian-localization-completion` |
| Implementation commit | `843055d0cce4f262705242fce8a76d425c8f8760` |
| Implementation tree | `2d5d8d9ed9ef4fb8f206bf2c89682d6ac27e1877` |
| Upstream | отсутствует; ветка локальная, push не выполнялся |
| Tracked worktree после commit | clean |

После implementation commit остаются восемь намеренно не включённых untracked roots/files:

- `.artifacts/`, `.superpowers/`, `graphify-out/` — generated/runtime evidence;
- `FRONTEND_ARCHITECTURE_AUDIT.md`, `LANGFLOW_BACKEND_ARCHITECTURE_AUDIT.md`;
- `LANGFLOW_RUSSIAN_LOCALIZATION_PLAN.md`, `LANGFLOW_RUSSIAN_LOCALIZATION_IMPLEMENTATION_REPORT.md`, `LANGFLOW_RUSSIAN_LOCALIZATION_REMAINING_PLAN.md`.

Они не входят в tree reviewable localization commit и не влияют на его воспроизводимость.

## Content hashes implementation commit

Алгоритм: SHA-256.

| Артефакт | SHA-256 |
|---|---|
| `LANGFLOW_RUSSIAN_LOCALIZATION_FINAL_EXECUTION_REPORT.md` | `6391b8a9fb823248a8ca07ec3dab3d6bff0df8d55f4c8566efdd456ce1f77448` |
| `docs/localization/ru/linguistic-review.md` | `dc92df0e4076a7139f6028ff7e2c81be418031a8495ffb1e7fc9731713dd6dec` |
| `docs/localization/ru/surface-manifest.csv` | `fb911971a32612ebefba714f831747231cdea23e38aa9b4039273e79ef2a6531` |
| `docs/localization/ru/task-18-acceptance.md` | `aaa4cd78c046f792f8b5cf44ae85c5cb594ca50f3cd97118d25300a34e072c00` |
| `docs/localization/ru/release-rollout-rollback.md` | `5f12cbc857612d4dcdafa1c806fd4178bb16bbd9996add037cc3f0f9f4242152` |
| `src/frontend/src/locales/ru.json` | `e5f5473f25d5b7bb782c5e3dbbad1150331df1660b44073f4d533aac4611a7c6` |
| `src/backend/base/langflow/locales/ru.json` | `4f396a4ab560179a2f7ef3fbb66695ba6eefe68b9cb4b2b1e67ea069426eff8e` |
| `scripts/i18n/allowlists/frontend-hardcoded.json` | `93e9c8ed518cac01b8a8c048d4cae18df71c686dc2483225e61171f3f2768ef8` |

## Toolchain snapshot

| Инструмент | Версия |
|---|---|
| Local Node.js | `v26.3.1` |
| Local npm | `11.16.0` |
| Python / `uv run python` | `3.13.14` |
| uv | `0.11.21` |
| Unified/standalone builder contract | Node `22.14.0`, npm `10.9.2` для unified; standalone exact `node:22.14.0-bookworm-slim` |

## Feature flags

В момент audit локальные overrides были unset. Effective defaults reviewable tree:

- `VITE_ENABLE_RUSSIAN_LOCALE`: enabled, кроме точного `false`;
- backend `ru`: включён в `SUPPORTED_LOCALES`;
- pseudo locale: dev/test only;
- `VITE_STRICT_RU_I18N`: test-only opt-in;
- Store/custom-param/integrations/MCP notice/wxo/extension reload: disabled при unset;
- files/publish/widget/voice/playground files/MCP/knowledge/inspection/new sidebar: enabled при unset.

## Governance reconciliation

- Governance matrix и journal согласованы как `APPROVED` для Task 2.
- Frontend и backend catalog/hash sign-offs не подменяются governance approval.
- Strict hardcoded contract теперь проверяет текущий tree: commit baseline является только evidence и не даёт неявного PASS.

## Graphify concern

`graphify-out/graph.json` имеет `built_at_commit=def832f409c01f0acd3937b9317dde03d0273552`, поэтому он stale относительно implementation commit `843055d0cce`. Read-only Graphify использован только для навигации; его данные не считаются финальным доказательством. Для полного снятия concern требуется разрешённая перегенерация graph на текущем reviewable commit.

## Воспроизведение

```bash
git show --stat --oneline 843055d0cce4f262705242fce8a76d425c8f8760
git rev-parse 843055d0cce4f262705242fce8a76d425c8f8760^{tree}
npm --prefix src/frontend run i18n:check
npm --prefix src/frontend run i18n:check:keys
npm --prefix src/frontend run i18n:check:hardcoded
uv run python scripts/i18n/check_backend_locales.py
uv run python scripts/i18n/check_component_metadata.py
```
