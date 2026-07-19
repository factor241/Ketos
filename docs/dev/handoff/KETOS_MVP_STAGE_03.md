# Ketos MVP Stage 03 — Board persistence/canvas viewport handoff

## Finalization contract

```yaml
stage: 03
base_main_sha: 89df4bc7d469507c37d8f72ccd1d4f40d179c38f
transplanted_source_head: f2b1b4146f708419c7f12dd8e49c08157c53d968
pre_handoff_candidate_sha: 09d1902923b90eafea66878f6aabf04ee60d9f1d
candidate_sha_from: "external final attestation: git rev-parse HEAD"
candidate_tree_from: "external final attestation: git rev-parse HEAD^{tree}"
status: PASS
transition_allowed: true
```

## Нормативная финализация

Commit не может содержать собственный literal SHA: включение SHA в содержимое
меняет tree и, следовательно, SHA commit. Поэтому финальный candidate SHA и
tree определяются внешней final attestation после commit командами
`git rev-parse HEAD` и `git rev-parse HEAD^{tree}`.

Handoff действителен только при одновременном выполнении условий:

1. handoff присутствует в текущем `HEAD`;
2. checkout чистый;
3. fresh Stage-03 gates выполнены на exact `git rev-parse HEAD`;
4. итоговый отчёт координатора содержит external attestation exact HEAD/tree.

Исторические результаты ниже относятся к перенесённому кандидату и не заменяют
повторный прогон на final SHA.

## Источник и заморозка состава

- Исторический отчёт: `docs/evidence/stage-03/STAGE_03_REPORT_RU.md`.
- Замороженный implementation/source исходной ветки:
  `f48b85b59d89e1ce35919480ab4d82a3328aa34a`.
- Финальный docs-only source head исходной ветки:
  `f2b1b4146f708419c7f12dd8e49c08157c53d968`.
- Эквивалентный перенос выполнен commits после target base main
  `89df4bc7d469507c37d8f72ccd1d4f40d179c38f`.

Фактический canvas-файл Stage 03 заморожен как
`src/frontend/src/components/core/board/BoardCanvas.tsx`; путь
`BoardCanvas/index.tsx` не является контрактом этого этапа.

## Инвентарь контракта

- Alembic head: `b03dca5a0001`; parent `9a6e34f1c2d8`.
- Board model:
  `src/backend/base/ketos/services/database/models/board/model.py`.
- Board API: `src/backend/base/ketos/api/v1/boards.py`.
- Pages: `src/frontend/src/pages/BoardsPage/index.tsx` и
  `src/frontend/src/pages/BoardPage/index.tsx`.
- Canvas: `src/frontend/src/components/core/board/BoardCanvas.tsx`.
- Barrel: `src/frontend/src/components/core/board/index.ts`.
- Viewport hook:
  `src/frontend/src/pages/BoardPage/hooks/use-board-viewport.ts`.

## Исторический ledger перенесённого кандидата

| Gate | Исторический результат |
| --- | --- |
| Focused backend | 23 passed |
| SQLite migration | 2 passed, no skip |
| PostgreSQL 16.14 migration | 2 passed, no skip; disposable local database |
| Focused frontend | 69 passed |
| Compatibility | 76 passed |
| Localization | 30 passed |
| i18n parity/key/hardcoded | PASS, 0 new |
| Production TypeScript | PASS |
| Board Chromium | 1 passed |
| Approval E2E | 4 passed |

До external final attestation координатор повторно выполняет соответствующие
gates на exact final `HEAD` и фиксирует результаты внешне.

## PostgreSQL runtime contract

`MVP_POSTGRES_URI` — внешний disposable runtime prerequisite. Значение и
credential не коммитятся. Финальный координатор внешне фиксирует наличие
переменной, `pg_isready` и успешный PostgreSQL migration/model-parity gate.

## Переход

Blocker-ов нет только после fresh exact-HEAD gates и external final attestation.
Только тогда разрешён переход в Stage 04. Stage 04 не начат и не является
частью данного handoff.
