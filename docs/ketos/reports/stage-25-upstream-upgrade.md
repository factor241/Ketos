# Этап 25. Обновление ядра до dsh-v0.2.0-rc.2 — отчёт

> План: [upstream-upgrade-plan.md](/Users/kirillustuzanin/Downloads/ketos_v7_master_plan/upstream-upgrade-plan.md) (разделы 1–4, этапы У0–У6). Эпик Beads: `ketos-tu8`. Ветка: `stage-25-upstream-0.2.0-rc.2`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-25`. Решения Р-1 … Р-7 приняты 2026-10-03 по рекомендации (раздел 4 плана; записаны в описании эпика).

## 1. Итог этапа

Выполнены У0, У1 и У2: решения и задачи зафиксированы в Beads, `~/.ketos` заархивирован, worktree `stage-25` создан, базовая линия снята; апстрим `dsh-v0.2.0-rc.2` влит через одноразовую пересадку корня (109 конфликтов разрешены), пересадка удалена, `main` получил настоящего общего предка с апстримом. Все 17 правок Кетоса разобраны (перенесены/сняты), генерируемые файлы и пары перегенерированы, профили Кетоса собраны с Р-3/Р-5. Код Кетоса адаптирован к API 0.2.0-rc.2: доска и русская локаль переведены на `configForms`, мост окон удерживает сессии через `retain`/`release`, карточки инструментов читают записи разговора v4, у обоих пакетов появились компиляторные фасады, `clone-core` следует объединённому `agent/created`. Обе компиляторные феи, `lint`, `hygiene` (18/18) и `doc-sync` без учёта записи изменения типов сессий зелёные; перезаписанные эталоны перечислены в разделе 7, оставшиеся расхождения — в разделе 10.

## 2. У0.1. Решения, учёт, резервные копии

- Эпик `ketos-tu8` и 23 задачи подэтапов У0.1 … У6.3 созданы в Beads с зависимостями раздела 5 плана (цепочка У0 → У1 → У2 → (У3 ∥ У4) → У5 → У6).
- Решения Р-1 … Р-7 записаны в описание эпика.
- Стенды на `:3080` не запущены (порт свободен, процессов Ketos нет).
- Архив данных: `/Users/kirillustuzanin/Downloads/ketos-home-backup-20261003-2108.tar.gz` — 281 КБ.
- Верхние записи архива (`tar -tzf | cut -d/ -f1-2 | sort -u`): `.ketos/.anonymous-user-id`, `.ketos/.credentials.yaml`, `.ketos/clones.db`, `.ketos/profiles`, `.ketos/sessions`, `.ketos/settings.yaml`, `.ketos/storages`.

## 3. У0.2. Worktree и базовая линия

- `git fetch upstream --tags` выполнен; `dsh-v0.2.0-rc.2` = `этап 25`.
- `git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-25" -b stage-25-upstream-0.2.0-rc.2 main`; `pnpm install` и `pnpm run build` зелёные.
- Деревья подтверждены: `git rev-parse этап 25^{tree}` = `git rev-parse этап 25^{tree}` = `этап 25`.

### 3.1. Базовая линия на main

| Команда | Результат |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `pnpm run lint` | exit 0 |
| `pnpm run test:gui` | 425 файлов: 6129 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | 102 passed, 1 skipped (103 файла); 394 passed, 15 skipped (409 тестов) |
| `pnpm run doc-sync` | 34 passed, 0 failed, 0 skipped |
| `pnpm run hygiene` | 16 passed, 0 failed, 0 skipped |

### 3.2. Пробное слияние

`git merge-tree --write-tree --name-only --merge-base=этап 25 main dsh-v0.2.0-rc.2` — **109 конфликтов** (совпадает с разделом 3.7 плана), результат слияния — дерево `этап 25`.

Драйвер пар переводов сообщил об ошибках формата записей пар (`merge-translation-pairing`) для 13 файлов `*.i18n.yaml` — они в списке конфликтов и разрешаются в У1.2 (взять апстрим и перегенерировать).

Список конфликтующих файлов и решения по каждому — в разделе 5.

## 4. Ход У1

### У1.1. Пересадка корня и слияние

- Проверено: `git rev-parse этап 25^{tree}` = `git rev-parse этап 25^{tree}` = `этап 25`.
- `git replace --graft этап 25 этап 25` → `git merge-base HEAD dsh-v0.2.0-rc.2` = `этап 2561a515f6d7af9304e7fd1d257929aef26`.
- `git merge --no-ff dsh-v0.2.0-rc.2` — 108 конфликтов содержимого + 1 «изменён у нас, удалён у них» (109 файлов), все разрешены (раздел 5).
- Коммит слияния `этап 25`; пересадка удалена (`git replace -l` пуст); `git merge-base HEAD dsh-v0.2.0-rc.2` = `этап 25` (коммит тега), родители слияния — `этап 25` (main) и `этап 25` (тег).

### У1.2. Сгенерированные файлы

Каталоги и пары взяты из апстрима, затем перегенерированы: `gen-cordis-inspect-catalog`, `gen-client-catalog` (slot-catalog), `gen-config-catalog`, `gen-module-graph`, `gen-doc-graphs`, `gen-tool-catalog`, `gen-persistence-catalog`, `gen-session-format-catalog`, `gen-plugin-packages`; пары переводов перезаписаны (`verify-translation-pairing --write`, 9 записей). `gen-tsconfig-paths`, `gen-cordis-catalog`, `gen-cordis-api` — без изменений.

### У1.3. Бренд

Авто-слияние потеряло брендовые строки только там, где апстрим переписал те же места: CLI-диагностика (`startup-diagnostics.ts`, `profile-boot.ts`, `dump-config-schema.ts`), потребители `ketos web:` (web-app spec, e2e профилей web, server-restart), `apps/cli/reference/README.md`/`.zh.md`. Всё возвращено отдельным коммитом `этап 25`; пары `apps/cli/reference` перезаписаны. Сверка со списком «потерянных» строк (`main` содержал `ketos`, слияние — нет) дала ровно 4 файла: два reference-README (возвращены), `app-boot/src/profile.ts` (7→1: апстрим удалил шесть сообщений вместе с кодом), `app-boot/tests/profile.spec.ts` (ожидание удалённой функции). Новые поверхности апстрима (document-preview, sidebar-terminal, плагин-менеджер и др.) не ребрендированы — это У3.1/У3.2 по решению Р-6.

### У1.4. Правки поведения Кетоса

Все 17 правок разобраны; судьба — в разделе 6. Первой перенесена `x-opencode-session` (`llm-pi-ai`): `randomUUID` + заголовки поверх импорта `createModels` из `./models.ts`; тесты `adapter.spec.ts` (`opencode-go`) сохранены. Согласование имён: внутренний `addFiles(references, ids)` апстрима переименован в `addFileReferences` (`facade.ts`, `apply.ts`, `input-matrix.client.spec.tsx`), публичный `SessionInput.addFiles(files)` Кетоса сохранён. `workspace/invalid-path` и `tsdown.client.ts` сохранились авто-слиянием (проверено чтением). HMR-правка снята: апстрим удалил `registerConfig`, сценарий покрыт `boot/hmr/watch-config.ts` + тест «observes creation when the config parent did not exist at registration».

### У1.5. Тесты, эталоны и записанные сессии

- Записанные сессии `snapshots/**/session.v*.jsonl` — из апстрима (формат v4); в конфликтах их не было.
- Восемь `snapshots/web/*.expected.md` взяты из апстрима и помечены к перезаписи. **Перезапись не выполнена:** после слияния клиент не поднимается до адаптации У2 — оба плагина доски (`@deepseek-ai/dsh-client-ui-board`) и русской локали (`@ketos/client-locale-ru`) ждут удалённый апстримом сервис `settingsScope`, веб-загрузка падает с `web boot: 2 entries did not activate` (подтверждено запуском `pnpm dsh web` и чтением ошибки в браузере). Тесты `lifecycle-chrome`, `message-actions`, `queue-actions`, `turn-tail-actions`, `goal-multi-turn-actions` падают по таймауту кадра, а не по диффу эталона; каждый из них перезаписывается в У2 после переноса плагинов на новый `settingsScope`.
- Эталон `apps/cli/tests/expected/launcher-help.txt` — из апстрима (`dsh`); перезаписывается в У2 после зелёной сборки (`vitest -u`).
- Сценарии без перезаписи: перечисленные пять web-e2e, `apps/cli/tests/built-bin.e2e.ts` (snapshot launcher-help), а также любые сценарии с новой записью модели (`test:snapshot:record`) — они требуют ключа DeepSeek и в CI форка не идут.

### У1.6. Конфигурация и профили

`bundle/web-app/cordis.patch.yml`: строки Кетоса (clone-core, locale-ru, ui-board) поверх апстрима; Р-3 — `desktop-product-telemetry` и `product-analytics` переведены в `disabled: true`/`enabled: false`; Р-5 — отключены `deepseek-account`, `llm-deepseek-account`, `account-controller`, `ui-settings-account`. `bundle/web-app/package.json`: зависимости апстрима + `@ketos/clone-core`, `@ketos/client-locale-ru`, ui-board, ui-schedule. `tsconfig.*`: алиасы и ссылки Кетоса поверх апстрима. `vitest.config.ts` конфликтов не имел; после правки `tsdown.client.ts` сохранён. `verify-cordis-config` запускается в У2 после зелёного `settingsScope`; сейчас `pnpm run build:web` и клиентские бандлы собираются, но применяются только после фикса сервисов настроек.

## 6. Судьба локальных правок Кетоса (раздел 3.5 плана)

| Правка | В апстриме `dsh-v0.2.0-rc.2` | Действие в У1 |
|---|---|---|
| `x-opencode-session` (`llm-pi-ai/adapter.ts`, `этап 25`) | нет | **Перенесена первой**; тесты `opencode-go` сохранены |
| `ISessions.openStream` (этап 24) | нет; апстрим убрал выбор сессии (`current`/`open`) | **Снята:** открытие — владельческое `retain`/`using`/`release`; доска переводится на `retain` в У2 |
| `keepDefault` в `selectModel` (этап 21), backend + client | нет | **Перенесена**: гейт поверх фонового сохранения апстрима; `RemoteResult`-сигнатура клиента сохранена |
| `workspace/invalid-path` (`$DSH_HOME`, `~/.ketos`, `~/.dsh`) | код ошибки есть | **Сохранена** авто-слиянием; условие прочитано и совпадает с правилом |
| Чистота бандла `@ketos/*` (`tsdown.client.ts`) | нет | **Сохранена** авто-слиянием |
| `PopoverHost`, портал Tooltip/Menu, `StateDot` reduced motion | нет | **Перенесена** поверх новых `Tooltip`/`Menu`/`MenuSurface`/`MenuGroup`; тесты пакета зелёные (1379) |
| `SessionInput.addFiles`/`takeDraft`, слот `conversation.session.header.blank` | нет; внутренний `addFiles(references, ids)` | **Перенесена** с переименованием внутреннего метода в `addFileReferences` |
| Слот `sidebar.brand.actions` | нет | **Перенесена** |
| `ILayout.declarePanelSidebar`, `blockPagePinchZoom` | нет | **Перенесена** |
| Опрос отсутствующей цели в `vendor/hmr` | апстрим удалил `registerConfig`; наблюдение — `boot/hmr/watch-config.ts` | **Снята:** сценарий покрыт тестом апстрима; старый тест удалён |
| Локальные глифы полноэкранных кнопок в `ui-sidebar-right` | да, новое artwork | **Снята:** апстрим-визуал важнее; Ketos-иконки без потребителей (кандидаты на удаление в У2) |
| Адрес Launchpad в `prepare-ci-bubblewrap.sh` | изменён (0.12.0-1, Launchpad build-URL) | **Снята:** апстрим исправил 404; SHA-пин сохранён |
| `e2e.yml`: `::warning::` вместо падения без ключа | — | **Сохранена** авто-слиянием |

## 7. Эталоны: перезаписано, отложено, диффы

- Перезаписано в У1.2: пары переводов (9 записей), сгенерированные каталоги/графы.
- Перезаписано в У2 (`DSH_SNAPSHOT=refresh`, каждый дифф просмотрен):
  - `snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` и `plan-active-zh.expected.md` — добавлена кнопка «Go to board»/«前往看板» (переключатель интерфейсов Кетоса), убранная кнопка «Open right sidebar» вернулась после восстановления углового слота пустой сессии, hero-фраза нормализована в `{{hero-headline}}`.
  - `snapshots/web/voice-input/ui.expected.md` и `snapshots/web/fresh-round-trip/blank-reload.expected.md` — та же нормализация hero-фразы (апстримный набор вращающихся фраз из `main`).
  - `snapshots/web/goal-multi-turn-actions/{ui,ui-expanded}.expected.md` — из эталонов убран транзитный контрол «Back to bottom»: его видимость зависит от позиции прокрутки в момент снимка и нормализуется общей функцией `captureStableAria`.
  - `apps/web/tests/expected/onboarding-deepseek-config/welcome.expected.md` — кетосовский текст приветствия (`内测声明`/Кетос) вместо апстримного `预览版说明`.
- `message-actions`, `queue-actions`, `turn-tail-actions`, `seeded-history` и остальные сценарии проходят против апстримных эталонов без перезаписи.
- `apps/cli/tests/expected/launcher-help.txt` не перезаписывался: ключевой снимок `built-bin.e2e.ts` проходит на апстримном эталоне (`ketos web:` уже в нём из У1.3).
- Требуют новой записи моделью (`test:snapshot:record`, ключ DeepSeek вне CI): сценарии с `snapshots/**/session.v*.jsonl` не перезаписывались; список конкретных записей даст прогон `test:snapshot` в У5. Записанные сессии формата v4 взяты из апстрима в У1.

## 8. Ход У2 (по пунктам задания)

1. **`settingsScope` → `configForms`.** Апстрим удалил `settings-file`/`settingsScope`; новый сервис — `ctx.configForms` (`ui-settings/client`): общее зеркало `describe()` и формы по namespace. Доска читает `ctx.configForms.describe()`, ru-пакет — `ctx.configForms.get<LocaleSettings>('locale')`; хост-половина доски вместо `settings.register` объявляет `Config = BoardSettingsSchema.volatile()` (корневая volatile-схема = весь документ редактируем), профильная строка `ui-board` становится namespace. Проверено в браузере: `pnpm ketos web` поднимается без «did not activate», доска открывается, раскладка сохраняется и восстанавливается; adopt читает `view.value` (резолвнутую секцию), а не `view.user` (сырой слой без `version`).
2. **Сессии окон: `retain`/`release`.** `BoardSessionBridge.attach` берёт `retain(sessionId, { source: 'boardWindow' })`, `releaseSession`/`release`/`dispose` освобождают; при переключении состояние записи обновляется до освобождения, чтобы повторный `reconcile` во время публикации teardown не перепривязал старую сессию. Тесты утечек проверяют `retainInfo(...).retainedBy.boardWindow` (1 на окно, 0 после закрытия). A5-тест «restores windows without changing the application current session» остался и проверяет отсутствие `mainView`-удержания. Очередь окна читается из проекции `inbox` (next-turn = queued, next-step = steering), отклонение раскладки не меняет текущую сессию приложения. `docs/ketos/upstream-sync.md`: строка `openStream` — «снята, заменена апстримным `retain`/`release`».
3. **Компиляторные фасады.** У `ui-board` и `client-locale-ru` появились solution-корень и листья `tsconfig.host.json`/`tsconfig.client.json` по правилу «Keep compiler faces explicit»; `WindowKind`/`WindowBodyKind` перенесены в `board-settings.ts`, чтобы хостовая фея не импортировала клиентский контракт; тесты хост-половин переименованы в `*.host.spec.ts`. Ошибок TS6306/TS6307 нет.
4. **Типы и словари.** `ui-settings-models` собрался без правок (18 ошибок отчёта были артефактом неполной пересборки); `clone-core` читает `source` из объединённого события `agent/created` (вместо удалённого `agent/session-start`), тест композиции проверяет FAILED-энтри и `fiber.await()`; ru-словарь получил новые ключи `common` (`codeBlock.*`, `workspace.defaultName`) и потерял удалённые (`json.collapseNode/expandNode`), корпус-фикстура обновлена.
5. **Записи разговора v4.** `tool-card-model` различает фазы `preparing`/`start` (`argsRaw` только у start), `ToolCard`/`ConversationBody`/`artifacts-model` работают на `ToolResultNode`/`ConversationNode` v4; `ConversationBody` читает pending-взаимодействия через `useSessionStatus(...).pendingInteraction`; кнопка right-sidebar вернулась в угловой слот пустой сессии; тесты tool-card (включая preparing), conversation-body, artifacts-model, clone-window-bar и фикстуры зелёные; карточки терминал/чтение/дифф/поиск проверены в браузере.
6. **Тесты `apps/web`.** 53 ошибки типов из отчёта У1 закрыты ещё в У1 (`scaffold.ts` на `createRuntimeResolution`); Кетос-тесты `board-geometry.e2e.ts` и другие изменённые файлы работают на новом scaffold без правок. Дополнительно починены реальные расхождения: mount-относительные URL роутов доски (`CLONES_PATH.slice(1)` вместо абсолютного `/api/...`), `manifest.webmanifest` без `id` (каждый mount получает свою идентичность), пара favicon/`index.html` по media-query, угловой слот пустой сессии.
7. **Эталоны и таймауты.** См. раздел 7. Из пяти таймаутов У1 (`lifecycle-chrome`, `message-actions`, `queue-actions`, `turn-tail-actions`, `goal-multi-turn-actions`) все проходят: причина была не в таймаутах как таковых, а в каскаде — первый golden с hero-фразой/доской падал, сценарий не отправлял промпт, фикстура не потреблялась и следующие тесты упирались в timeout. Отдельно исправлены: нормализация hero-фразы и «Back to bottom» в `captureStableAria`, возврат кнопки right-sidebar, `slice(1)`-роуты. WebKit установлен (`playwright install webkit`), сценарии на нём проходят.
8. **Иконки.** Удалены неиспользуемые `IconFullscreenCornersOutline16`, `IconExitFullscreenCornersOutline16`, а также осиротевшие после переименования `IconExitFullscreenOutline16`/`IconCodeOutline16`; набор иконок снова 94 пары Regular/Medium.

## 8a. Вход для У2: typecheck (исходное состояние)

Тела обеих фейсов были красные; после `pnpm run clean` и полной пересборки: клиентская фея — 33 ошибки (13 + 2 TS6306 конфигурации, 18 ключей локали `ui-settings-models`, 1 `hub.ts` — исправлена в прошлой сессии); хостовая — 56 ошибок (3 `clone-core` `agent/session-start`, 53 `apps/web/tests/*` по тестовым API, исправлены в У1). Ошибок «Cannot find module» после `agent-presets → agent-preset-registry` не было.

## 9. Коммиты этапа

Коммиты У0–У1 перечислены темами (короткие хеши в отчёте заменены метками: гейт `verify-repository-references` запрещает идентификаторы коммитов в поддерживаемых файлах).

| Тема | Содержание |
|---|---|
| merge upstream | Merge upstream dsh-v0.2.0-rc.2 into Ketos (109 конфликтов, пересадка удалена) |
| fix(brand) | Ketos-написания CLI-диагностики и потребителей `ketos web:` |
| chore(upstream) | перегенерация каталогов/доков, восстановление scaffold и Ketos-уведомления |
| docs(ketos) | отчёт этапа 25; процедура синхронизации и таблица правок Кетоса |
| fix(ketos) | migrate board and ru locale to upstream configForms service |
| fix(ketos) | retain board window sessions and adapt to upstream session APIs |
| build(ketos) | give ui-board and client-locale-ru explicit compiler faces |
| fix(ketos) | adapt clone-core and ru locale to upstream types |
| feat(ketos) | adapt the board to v4 conversation records and upstream settings APIs |
| fix(ketos) | finish the У2 client API migration |
| fix(ketos) | mount-aware routes, blank-header corner, and refreshed web goldens |
| chore(ketos) | drop unused legacy icon exports |
| fix(ketos) | pass repository gates and refresh remaining web goldens |

## 10. Проверки и что осталось

| Гейт | Базовая линия (main) | Сейчас |
|---|---|---|
| `pnpm run typecheck` | exit 0 | exit 0 (обе феи, 0 ошибок) |
| `pnpm run lint` | exit 0 | exit 0 |
| `pnpm run test:gui` | 6129 passed, 1 skipped | 10186 passed, 1 skipped, 33 failed |
| `DSH_SNAPSHOT=replay pnpm run test:web` | 394 passed, 15 skipped (409) | 623 passed, 17 skipped, 13 failed |
| `board-geometry.e2e.ts` | 35/35 | 35/35 |
| `pnpm run doc-sync` | 34 passed, 0 failed | 40 passed, 1 failed |
| `pnpm run hygiene` | 16 passed, 0 failed | 18 passed, 0 failed |
| `pnpm run build` | exit 0 | exit 0 |

Расхождения `test:gui` (33) — не регрессии У2: 26 тестов `ui-settings-account` и 1 `ui-settings-general` требуют отключённого решением Р-5 пакета аккаунта; 3 snapshot-теста `ui-sidebar` ожидают апстримный бренд вместо кетосовского (localBuildBrand/брендовые бейджи); 3 аудита `ui-theme` (radius/menu/elevation) не знают CSS доски и требуют кетосовских исключений. Расхождения `test:web` (13): 9 — сценарии аккаунта/десктоп-аккаунта, отключённого Р-5 (`bonus-notice`, `desktop-locale`, `desktop-onboarding` ×3, `menu-material`, `onboarding-native`, `settings-appearance`, `window-drag-coverage`); 2 `plugin-install-github` — среда (прокси Git); 1 `hmr-live` — watcher `dev:web` на этом хосте; 1 `startup-rpc-budget` — доска добавляет стартовые `ketos.clones`/`ketos.tasks` и запись раскладки (4 `settings/describe` против бюджета 2). `doc-sync`: единственный красный гейт — `verify-persistence-changes` («Breaking changes relative to the accepted Session format 4 baseline require format 5 or later»): слияние принесло изменения схемы сессии, запись изменения формата — задача У4 (данные и модели), в этом задании У3–У6 не запускались.

Что осталось: **У3** — бренд новых страниц, русская локаль новых ключей (schedule.catalog переведён лишь частично: устаревшие ключи `status.*`/`relative.*` в ru-корпусе сохранены, новые апстримные — нет), проверка аналитики/аккаунта; **У4** — сессии v4 на копии `~/.ketos`, запись изменения типов (`persistence-changes --record`) и `startup-rpc-budget`; **У5** — полный прогон гейтов, CI форка, `board-geometry` (уже 35/35), бюджеты MVP; **У6** — `upstream-sync.md`/Agent Note/отчёт/граф, приёмка, слияние в `main`.

## Приложение А. Список конфликтов пробного слияния (109)

- `.agents/notes/archived/manifest.json`
- `.agents/notes/implemented/testing/2026-06-19-real-api-e2e-ci.i18n.yaml`
- `apps/cli/reference/README.i18n.yaml`
- `apps/cli/reference/README.md`
- `apps/cli/reference/README.zh.md`
- `apps/cli/src/args.ts`
- `apps/cli/src/bin.ts`
- `apps/cli/src/plugin.ts`
- `apps/cli/tests/built-bin.e2e.ts`
- `apps/web/index.html`
- `apps/web/public/favicon.svg`
- `apps/web/public/manifest.webmanifest`
- `apps/web/tests/expected/onboarding-deepseek-config/welcome.expected.md`
- `apps/web/tests/pwa-manifest.e2e.ts`
- `apps/web/tests/scaffold.ts`
- `apps/web/vite.config.ts`
- `docs/config-catalog.i18n.yaml`
- `docs/config-catalog.md`
- `docs/config-catalog.zh.md`
- `docs/event-producer-consumer.i18n.yaml`
- `docs/event-producer-consumer.md`
- `docs/event-producer-consumer.zh.md`
- `docs/module-graph.i18n.yaml`
- `packages/api/session-controller/src/client/contract/sessions.ts`
- `packages/api/session-controller/src/client/sessions/service.ts`
- `packages/api/session-controller/src/commands.ts`
- `packages/api/session-controller/tests/session-models.host.spec.ts`
- `packages/api/session-controller/tests/sessions-service.client.spec.ts`
- `packages/boot/app-boot/src/profile.ts`
- `hmr-config.spec.ts`
- `packages/boot/app-boot/tests/profile.spec.ts`
- `packages/bundle/headless/README.i18n.yaml`
- `packages/bundle/headless/README.md`
- `packages/bundle/headless/README.zh.md`
- `packages/bundle/headless/src/index.ts`
- `packages/bundle/headless/src/startup.ts`
- `packages/bundle/headless/tests/startup.spec.ts`
- `packages/bundle/web-app/README.i18n.yaml`
- `packages/bundle/web-app/README.md`
- `packages/bundle/web-app/README.zh.md`
- `packages/bundle/web-app/cordis.patch.yml`
- `packages/bundle/web-app/package.json`
- `packages/client/README.i18n.yaml`
- `packages/client/locale/src/locales/en.ts`
- `packages/client/locale/src/locales/zh.ts`
- `packages/client/ui-brand-official/README.i18n.yaml`
- `packages/client/ui-conversation/src/client/index.ts`
- `packages/client/ui-conversation/src/client/input/facade.ts`
- `packages/client/ui-conversation/src/client/locales.ts`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`
- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`
- `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx`
- `packages/client/ui-conversation/src/client/skeleton/HeroShell.module.css`
- `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts`
- `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`
- `packages/client/ui-conversation/tests/skeleton.client.spec.tsx`
- `packages/client/ui-layout/README.i18n.yaml`
- `packages/client/ui-layout/README.md`
- `packages/client/ui-layout/README.zh.md`
- `packages/client/ui-layout/package.json`
- `packages/client/ui-layout/src/client/AppFrame.tsx`
- `packages/client/ui-layout/src/client/index.ts`
- `packages/client/ui-layout/tests/apply.client.spec.ts`
- `packages/client/ui-model-selection/src/client/directory.ts`
- `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts`
- `packages/client/ui-primitives/README.i18n.yaml`
- `packages/client/ui-primitives/README.md`
- `packages/client/ui-primitives/README.zh.md`
- `packages/client/ui-primitives/src/Menu.module.css`
- `packages/client/ui-primitives/src/Menu.tsx`
- `packages/client/ui-primitives/src/StateDot.module.css`
- `packages/client/ui-primitives/src/Tooltip.tsx`
- `packages/client/ui-primitives/src/icons/index.tsx`
- `packages/client/ui-primitives/src/index.ts`
- `packages/client/ui-primitives/tests/icons.client.spec.tsx`
- `packages/client/ui-primitives/tests/tooltip.client.spec.tsx`
- `packages/client/ui-settings-models/src/client/locales.ts`
- `packages/client/ui-settings-models/src/onboarding-copy.ts`
- `packages/client/ui-settings-models/tests/welcome-notice.client.spec.tsx`
- `packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx`
- `packages/client/ui-sidebar/README.i18n.yaml`
- `packages/client/ui-sidebar/README.md`
- `packages/client/ui-sidebar/README.zh.md`
- `packages/client/ui-sidebar/src/client/SidebarRoot.tsx`
- `packages/client/ui-sidebar/src/client/contract/slots.ts`
- `packages/client/ui-sidebar/src/client/index.ts`
- `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx`
- `packages/client/ui-theme/README.i18n.yaml`
- `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`
- `packages/llm/llm-pi-ai/src/adapter.ts`
- `packages/test-support/client-runtime/package.json`
- `packages/test-support/client-runtime/src/sessions.ts`
- `scripts/browser-bundled-externals.spec.ts`
- `scripts/doc-budgets.manifest.json`
- `scripts/prepare-ci-bubblewrap.sh`
- `snapshots/web/goal-multi-turn-actions/ui.expected.md`
- `snapshots/web/lifecycle-chrome/hero.expected.md`
- `snapshots/web/lifecycle-chrome/plan-active.expected.md`
- `snapshots/web/message-actions/ui.expected.md`
- `snapshots/web/queue-actions/editing.expected.md`
- `snapshots/web/queue-actions/ui.expected.md`
- `snapshots/web/turn-tail-actions/running.expected.md`
- `snapshots/web/turn-tail-actions/settled.expected.md`
- `tsconfig.base.json`
- `tsconfig.client.json`
- `tsconfig.host.json`
- `vendor/README.md`
- `vendor/hmr/src/index.ts`
