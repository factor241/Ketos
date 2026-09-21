# Этап 15. Клон сотрудника: модель данных и редактор

## 1. Итог этапа

Появился первый хост-пакет Кетоса `@ketos/clone-core`: клон — запись с ролью, персонажем, методологией, предпочтительной моделью и привязками сессий, хранимая в `~/.ketos/clones.db` (SQLite, WAL, `application_id` + `user_version`, каталог `0700`/файл `0600`). Браузер работает с ней через точный Fetch-маршрут `/api/ketos.clones` без кодогенерации, а окно-редактор живёт в существующем `ui-board` новым телом `clone`; клон создаётся, редактируется (CAS по `revision`), переживает перезапуск, и его сессия привязывается в `clone_sessions`. Ветка `stage-15-clone-model-editor`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-15` от `stage-14-multi-window-perf`.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 15.1 Пакет `@ketos/clone-core` и монтирование | `ketos-5v2.16.1` | выполнен | `packages/ketos/clone-core/` (package.json, пара `tsconfig.host.json`/`tsconfig.client.json`, `src/{index,db,schema,repository,routes,types}.ts`); строка `ketos-clone-core` в `packages/bundle/web-app/cordis.patch.yml` с `path: !!js dshHomePath('clones.db')` и зависимость в манифесте бандла; регистрация в `tsconfig.host.json`, `tsconfig.client.json`, ручные алиасы в `tsconfig.base.json`; `pnpm run verify-cordis-config` — 143 файла; `tests/database.spec.ts` и `tests/composition.spec.ts` (реальный Loader + записывающий connection-сервис: маршрут зарегистрирован, файл не создан до первого запроса, при первом запросе — `0600`, при диспоузе маршрут снят, данные целы) |
| 15.2 Схема `clones.db` | `ketos-5v2.16.2` | выполнен | `src/schema.ts` (`CLONE_CORE_SCHEMA_VERSION = 1`, `CLONE_CORE_APPLICATION_ID` «KTCL», runner одним проходом, отказ только при чужом `application_id` и `user_version > CURRENT`), `src/types.ts` (`CloneRecord`, `CloneSessionBinding` с branded `CloneId`/`SessionId`), `src/repository.ts` (CRUD + CAS + удаление привязок); тесты — CRUD, ревизия, конкурентное обновление даёт `ketos/clone-conflict`, «v1 → v2 → v3 без потери данных» на синтетических шагах, декодирование испорченного `status`/`skills_json` |
| 15.3 Fetch-API клонов | `ketos-5v2.16.3` | выполнен | `src/routes.ts`: `GET` списка и `POST` с `op` `list/get/create/update/delete/bindSession/listSessions`, ручная валидация тела, коды `ketos/invalid` (400), `ketos/clone-not-found` (404), `ketos/clone-conflict` (409); тесты — все операции, каждая ошибка, 500 при недоступной БД, снятие маршрута при диспоузе фибера |
| 15.4 Окно-редактор и список клонов | `ketos-5v2.16.4` | выполнен | `ui-board`: тело `clone` (форма, валидация, сохранение/удаление с подтверждением, индикатор ревизии, баннер «изменено в другом месте», список привязанных сессий), `BOARD_WINDOW_TEMPLATES.clone`, `cloneId` в состоянии окна и в документе раскладки, `bridge.adopt`, имя окна = имя клона; список — мини-панель в доке и пункты Omnibox («Новый клон» + раздел «Клоны»); «Создать сессию клона» создаёт сессию, применяет пресет по умолчанию и предпочтительную модель, привязывает её и открывает в своём окне; тесты `clone-body.client.spec.tsx`, `clone-flow.client.spec.tsx`, `board-layout.client.spec.ts`, `open-window.client.spec.ts`; локализация (zh/en + ru-корпус + `ru-keys.json`) |

## 3. Критерии приёмки этапа

- [x] `@ketos/clone-core` смонтирован — строка в web-app patch, зависимость в манифесте бандла, `verify-cordis-config` зелёный.
- [x] CRUD клонов работает через fetch — `tests/routes.spec.ts` (успех и каждая ошибка) и живая проверка в браузере: создание/сохранение клона из окна.
- [x] Окно-редактор существует — тело `clone` в `board.window.body`, живая проверка и `tests/clone-body.client.spec.tsx`.
- [x] Сессии привязываются к клонам — `POST { op: 'bindSession' }`, запись в `clone_sessions` (проверено `sqlite3 ~/.ketos/clones.db`) и строка в списке привязанных сессий редактора.
- [x] Клон переживает перезапуск — перезагрузка страницы: окно восстановилось по `cloneId` из раскладки, форма показала сохранённые значения и ревизию 2.
- [x] Тесты зелёные — `pnpm run test:gui` (413 файлов, 5872 passed, 1 skipped); `packages/ketos` + `packages/client/ui-board/tests` — 481 passed.
- [x] `hygiene`/`verify-cordis-config` зелёные — 16/16 и 143 конфигурационных файла.
- [x] `pnpm run build` зелёный; в `~/.ketos` появляется `clones.db` (режим `0600`), при этом ленивое открытие сохраняет смоук `apps/cli/tests/lazy-search-startup.compat.spec.ts` зелёным: собранный `ketos web` стартует без `ExperimentalWarning: SQLite` и создаёт файл только на первом запросе (проверено: до первого запроса файла нет, после — есть).

## 4. Отклонения

- **Формат предпочтительной модели — `provider/model`.** План оставляет формат открытым; строка из двух частей не требует каталога при применении и совпадает с представлением маршрута в `core/agent/model-selection.ts`. `parseModelRoute` делит по первому `/`, поэтому модель со слэшем в id сохраняется.
- **Удаление клона удаляет и его привязки.** План этого не оговаривает; брошенная привязка не разрешается ничем, поэтому `deleteClone` сносит `clone_sessions` в одной транзакции, а сами сессии остаются обычными сессиями.
- **Неожиданный отказ маршрута — 500 без кода.** Три кода плана описывают доменные ошибки; внутренний сбой (например, недоступная БД) отдаёт `500` с текстом, чтобы клиент не принял его за конфликт.
- **Путь маршрута в клиенте — литерал.** Клиент импортирует из пакета только типы (`./types`), поэтому `clone-api.ts` держит `/api/ketos.clones` рядом с видами ответов; это зафиксировано в README пакета.
- **Побочный эффект предпочтительной модели.** Применение модели на сессии клона идёт штатным `remote.session.selectModel`, который также сохраняет выбор как `agent-default-model`; это разрешено планом на этом этапе и уже описано в Known Limitations `ui-board`.
- **Покрытие.** Новые исходники попадают в именованные исключения MVP-политики (`packages/client/ui-board/src/**`, `packages/ketos/clone-*/src/**`), поэтому сигнал дают поведенческие тесты, а не проценты; команда из таблицы проверок (`--coverage.include='packages/client/ui-board/src/**'`) отвечает пустой сводкой именно из-за исключения.
- **Ожидание превью-смоука расширено.** `apps/web/tests/preview-boot.e2e.ts` теперь перечисляет `/api/ketos.clones` среди ожидаемых 404 статического превью: в этом скаффолде хост-пакет клонов не смонтирован, и ростер клонов законно пуст.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/ketos/clone-core/tests` | зелёный; 29 passed |
| `pnpm exec vitest run packages/ketos packages/client/ui-board/tests` | зелёный; 40 файлов, 482 passed |
| `pnpm run test:gui` | зелёный; 413 файлов, 5873 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный; 101 файл passed + 1 skipped, 359 passed, 15 skipped |
| `pnpm run typecheck` | зелёный |
| `pnpm run lint` | зелёный |
| `pnpm run build` | зелёный (238 клиентских артефактов, 3 публичных значения) |
| `pnpm run hygiene` | зелёный; 16/16 гейтов |
| `pnpm run doc-sync` | зелёный; 34/34 гейта |
| `pnpm run duplication` | 0 клонов (после `jscpd:ignore` вокруг открытия БД с обоснованием) |
| `pnpm run verify-cordis-config` | зелёный; 143 файла |
| `DSH_REQUIRE_BUILT_CLI_SMOKE=1 pnpm exec vitest run apps/cli/tests/lazy-search-startup.compat.spec.ts` | зелёный; старт собранного `ketos web` без `ExperimentalWarning: SQLite` |
| Живая проверка (собранный `ketos web`, Chrome): создать клона → править → сохранить → перезагрузить → создать сессию | `clones.db` создан при первом запросе, запись сохранена (ревизия 2), окно восстановилось по `cloneId`, `clone_sessions` содержит сессию, редактор показывает её в списке |

## 6. Следующий шаг

После приёмки: закрыть эпик `ketos-5v2.16` в Beads, подготовить worktree этапа 16 от принятой ветки `stage-15-clone-model-editor` и передать пользователю. Открытые предпосылки для этапа 16: `clone_sessions` с ролью `main` уже есть (интервью добавит свою роль), `persona`/`methodology` хранятся и ждут подачи в системный промпт, `skills_json` ждёт этапа 18, `clone_tasks`/`memories` — шаги 2/3 того же forward-only runner.
