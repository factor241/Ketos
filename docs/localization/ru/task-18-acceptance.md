# Task 18 — exhaustive route/state acceptance

Дата среза: 2026-07-12  
Ветка: `main`  
HEAD: `def832f409c01f0acd3937b9317dde03d0273552`  
Controlling source: `LANGFLOW_RUSSIAN_LOCALIZATION_PLAN.md`, Task 18  
Manifest: `docs/localization/ru/surface-manifest.csv`

## Итоговый статус

**BLOCKED / DONE_WITH_CONCERNS для этого bounded slice.** Статический 170-row manifest-contract и детерминированное mapping покрытие проходят. Свежий объединённый manifest/errors/a11y run завершён как `12 passed, 5 skipped (3.9m)` и подтверждает 43 live PASS rows, включая реальный PUBLIC flow с локализованным компонентом «Вход чата» на `/playground/:id/`, RU `html lang`, localized placeholder, keyboard focus, accessibility text, strict diagnostics, horizontal-overflow и axe serious/critical checks.

Первый targeted run выявил `button-name` уровня critical на пяти controls и `nested-interactive` уровня serious. После узких product fixes повторный run завершился axe serious/critical `[]`, поэтому combined R7+R8 count теперь **13 static PASS / 43 live PASS / 114 BLOCKED**. Для `route-playground` обновлены только live/visual поля; 153 manifest rows по-прежнему не имеют завершённой подписи `ru-linguistic-reviewer`.

`surface-manifest.csv` не переписывался: его `pending_*` поля остаются консервативным ledger и сами по себе не означают PASS даже для уже пройденных групп.

## Детерминированный contract

Новый spec:

- `src/frontend/tests/core/features/localization-russian-manifest.spec.ts`

Во время Playwright discovery, включая `--list`, spec проверяет:

- ровно 170 manifest rows;
- ровно 13 колонок в каждой строке;
- отсутствие пустых полей;
- 170 уникальных stable kebab-case `test_id`;
- точные kind-counts: baseline 6, route 39, state 16, modal 31, overlay 57, primitive 5, feature 9, boundary 7;
- существование каждого repo-local `source` path;
- 100% rows → evidence-group mapping;
- существование evidence spec и точного test title для каждой используемой группы;
- наличие runtime case для каждого из 23 core route IDs;
- обязательную причину для каждой `blocked-*` группы.

Распределение 170 строк по текущему evidence contract:

| Группа | Строк | Текущий статус |
|---|---:|---|
| Static governance contract | 13 | PASS для структуры/mapping: 170 уникальных строк и детерминированная привязка подтверждены; historical baseline сам по себе не считается live readiness |
| Core routes и redirects | 23 | PASS: живой route group завершён зелёным |
| Public auth routes | 3 | PASS: живой manual-auth route group завершён зелёным |
| Real flow/folder-ID routes | 6 | PASS: dynamic flow/folder test завершён зелёным в полном run |
| Representative modal/overlay/state | 8 | PASS: preference/state и representative overlays завершены зелёным |
| Task 17 coded-error scenario | 1 | PASS: отдельный Task 17 route/error live evidence подтверждён |
| Task 17 responsive visual scenario | 1 | PASS: отдельный Task 17 a11y/visual live evidence подтверждён |
| PUBLIC playground diagnostic | 1 | PASS: deterministic PUBLIC fixture; RU route/keyboard/strict/overflow и axe serious/critical `[]` |
| Disabled/configured feature matrix | 22 | SKIP/BLOCKED: нужны отдельные feature builds |
| Knowledge chunks fixture | 1 | SKIP/BLOCKED: нет ingested KB/source/chunks fixture |
| Exhaustive state/feature fixtures | 17 | SKIP/BLOCKED |
| Остальные modal/overlay/primitive surfaces | 74 | SKIP/BLOCKED |
| **Всего** | **170** | **13 static PASS; 43 live PASS; 114 explicitly BLOCKED** |

Дополнительный cross-cutting preference test, не являющийся отдельной строкой manifest, проверяет reload, новую вкладку и rapid `ru → en → ru` race. Он завершён как PASS в полном run.

## Текущее живое evidence

Подтверждено зелёными живыми прогонами:

1. 23 core route/redirect entries: root, assets redirect, files, knowledge, flows/components/all/MCP, доступные Settings pages, account delete, admin и wildcard.
2. Три public auth routes после bootstrap, очистки auth cookies и перехода `/auto_login` в manual-auth mode.
3. Создание реального flow и folder fixture, затем editor, folder editor, view и collection folder routes с фактическими `flow.id` и `folder_id`.
4. Отдельные Task 17 route/error/a11y/visual сценарии.
5. Reload, shared-origin new tab и rapid language race с polling-проверкой `GET /api/v1/users/whoami`, что финальный `preferred_locale=ru`.
6. Реальное открытие templates modal, notification tooltip/dropdown, account menu, canvas zoom menu и canvas help menu.

Все перечисленные executable groups подтверждены свежим объединённым manifest/errors/a11y run. Пять явно skipped tests соответствуют 114 строкам с документированными feature/fixture/manual/external blockers и не засчитываются как PASS.

## Явные blockers и SKIP policy

### Feature-configured surfaces

В текущем source snapshot выключены или требуют отдельной topology:

- `ENABLE_LANGFLOW_STORE=false`;
- `ENABLE_CUSTOM_PARAM=false`;
- `ENABLE_EXTENSION_RELOAD=false`;
- `BASENAME=""`;
- `wxo_deployments` не включён в обязательной default конфигурации.

Соответствующие 22 manifest rows привязаны к test `BLOCKED feature-configured Task 18 surfaces`, который вызывает `test.skip(true, reason)`. Нельзя засчитывать route redirect при выключенном флаге как доказательство локализованной включённой поверхности.

### PUBLIC playground: fixture и product a11y blocker закрыты

Targeted spec теперь детерминированно:

- создаёт реальный blank flow;
- открывает локализованный Components sidebar;
- добавляет «Вход чата»;
- включает PUBLIC access и открывает `/playground/:id/`;
- проверяет RU language/placeholder, keyboard focus, accessibility text, strict diagnostics и overflow;
- прикладывает screenshot `route-playground-ru`.

Первый RED run зафиксировал живые axe findings:

- `button-name`, impact `critical`: 5 targets, включая `button[data-testid="new-chat"]`;
- `nested-interactive`, impact `serious`: target `.cursor-text`.

После исправления владельцев controls/input wrapper повторный run дал axe serious/critical `[]`. Conditional expected-failure guard теперь активируется только при непустом списке нарушений, поэтому текущий зелёный результат является настоящим PASS, а возврат axe defect снова сделает test expected-failure с точным diagnostic.

### Оставшийся data fixture

- knowledge chunks требует созданную knowledge base, source ID и завершённую ingestion с chunks.

Эта одна строка остаётся привязана к `BLOCKED fixture-dependent Task 18 routes`.

### Exhaustive states, dialogs и overlays

Representative openings не закрывают требование «каждый modal/dialog открыть хотя бы один раз». До сих пор нет свежего живого evidence для:

- 12 оставшихся state rows и 5 enabled/disabled feature rows;
- 29 обычных modal rows;
- 40 обычных overlay rows;
- 5 primitive rows;
- 12 wxo deployment overlays и одного extension-reload modal в отдельной feature topology.

Они остаются в `BLOCKED exhaustive Task 18 state fixtures` либо `BLOCKED exhaustive Task 18 modal and overlay openings`.

## Reviewer и visual ledger

| Gate | Manifest count | Статус | Причина |
|---|---:|---|---|
| `reviewer=ru-linguistic-reviewer` | 153 | BLOCKED | Назначение reviewer в CSV не является подписью |
| `visual_status=pending_task_17` | 152 | BLOCKED | PUBLIC playground получил отдельный visual PASS; exhaustive screenshot review 152 manifest surfaces не завершён |
| strict RU fallback events = 0 | runtime | PASS для executable set | Подтверждено полным run для 42 rows и targeted PUBLIC PASS; не распространяется на 114 blocked rows |
| same-origin deployment | topology | BLOCKED | Не прогонялся в этом slice |
| separate-origin deployment | topology | BLOCKED | Не прогонялся в этом slice |
| custom BASENAME | topology | BLOCKED | Нужна отдельная сборка/сервер |
| manual linguistic pass | manual | BLOCKED | Human sign-off отсутствует |

Ни один reviewer field не обновлён на `complete`, и manual sign-off не заявлен.

## Зафиксированная доказательная база

- Biome для manifest spec: PASS.
- Playwright discovery и discovery-time contract: PASS; 170 rows, 170 unique `test_id`, 100% deterministic evidence mapping.
- Task 17 route/error: PASS.
- Task 17 a11y/visual: PASS.
- Task 18 core routes: PASS в живом route group.
- Task 18 public auth routes: PASS в живом manual-auth group.
- Task 18 dynamic flow/folder routes: PASS.
- Task 18 preference/race: PASS.
- Task 18 representative overlays: PASS.
- Task 18 объединённый manifest/errors/a11y run: `12 passed, 5 skipped (3.9m)`.
- PUBLIC playground RED diagnostic: exit `0`, runner output `1 passed (49.5s)` с ожидаемым axe failure и точными `button-name`/`nested-interactive` findings.
- PUBLIC playground GREEN: exit `0`, `1 passed (34.8s)`; axe serious/critical `[]`, RU/focus/overflow checks PASS; row переведена в live/visual PASS.
- PUBLIC playground screenshot: `src/frontend/test-results/core-features-localization-5d2ee--visual-accessibility-gates-chromium/route-playground-ru.png`.
- Attached screenshot copy: `src/frontend/test-results/core-features-localization-5d2ee--visual-accessibility-gates-chromium/attachments/route-playground-ru-e485fbe916688f23584d9d22913d3d02548eb542.png`.

Точная команда полного прогона:

```bash
cd src/frontend
npx playwright test tests/core/features/localization-russian-manifest.spec.ts \
  --project=chromium \
  --workers=1 \
  --retries=0
```

Точный итог объединённого прогона трёх localization specs: `12 passed, 5 skipped (3.9m)`.

Свежая targeted команда PUBLIC playground:

```bash
cd src/frontend
npx playwright test tests/core/features/localization-russian-manifest.spec.ts \
  --project=chromium \
  --workers=1 \
  --retries=0 \
  --grep 'Russian public playground'
```

Точный итог после исправления: exit `0`, `1 passed (34.8s)`; axe serious/critical `[]`. Это PASS для manifest row `route-playground`.

## Минимальный путь к Task 18 PASS

1. Создать ingested knowledge-base fixture с source/chunks; убрать соответствующий fixture skip после зелёного live evidence.
2. Добавить реальные action sequences для оставшихся 29 modals, 40 overlays, 5 primitives и 17 state/feature rows.
3. Запустить отдельные Store/custom-param/extension-reload/wxo/BASENAME feature builds.
4. Повторить acceptance в same-origin и separate-origin topology.
5. Сохранить screenshots/logs для каждой ещё заблокированной state group.
6. Провести human Russian linguistic review и только после подписи обновить reviewer/visual statuses.
7. Лишь после 170/170 live evidence, strict RU fallback 0 и reviewer completion сменить итог этого ledger с BLOCKED на PASS.
