# Ketos ↔ DeepSeek Harness: политика синхронизации с upstream

Файл принадлежит репозиторию Ketos и находится вне upstream-дерева документации (решение 30 Части I). Рабочее дерево — `/Volumes/Projects/Ketos bot` (GitHub `factor241/Ketos`); единственная основная ветка — `main`, унаследованная `feat/ketos-spatial-board` выведена из обращения (её содержимое — историческая база форка, зафиксированная тегом базы). Текущая база — тег `dsh-v0.2.0-rc.2`: слияние тега в ветке `stage-25-upstream-0.2.0-rc.2` (PR [#54](https://github.com/factor241/Ketos/pull/54)) влило историю апстрима вторым родителем, поэтому у `main` настоящий общий предок с `upstream` — коммит тега, и дальнейшие приёмки идут обычным `git merge` без пересадки корня. Историческая база — коммит поверх релизной линии 0.1.5-rc.2 и коммита доски; синтетический корень импорта и переигранные коммиты с теми же деревьями остаются в истории ниже слияния.

## Ремоуты

```sh
git remote -v
# origin    https://github.com/factor241/Ketos.git   (репозиторий Ketos)
# upstream  https://github.com/deepseek-ai/deepseek-harness.git
# base      /Volumes/Projects/deepseek-harness/.     (локальный чекаут базы)
```

## Рабочее дерево и worktrees этапов

Каждый этап (начиная с этапа 1) выполняется в отдельном git-worktree, созданном от принятого состояния предыдущего этапа (для этапа 1 — от `main`); ветка и каталог несут номер и slug этапа. Этап завершается коммитом в своей ветке и вопросом пользователю «Принимаете ли вы этап?»; после приёмки агент подготавливает worktree следующего этапа, а перенос результатов всех этапов в `main` и финальная интеграционная проверка выполняются после завершения всех этапов. Каталоги worktree живут рядом с репозиторием, не коммитятся и сохраняются до финальной интеграции.

```sh
cd "/Volumes/Projects/Ketos bot"
git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-01" -b stage-01-dev-stand main
# работа и гейты этапа — в каталоге worktree; коммит — в ветке этапа
# если worktree уже создан и отстаёт от базы: git -C "/Volumes/Projects/Ketos bot.worktrees/stage-01" merge --ff-only main
# после приёмки — worktree следующего этапа от принятой ветки:
git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-02" -b stage-02-board-wiring stage-01-dev-stand
# перенос в main — после всех этапов (финальная интеграция):
git switch main && git merge --no-ff stage-20-mvp-acceptance
```

## Ритм

- Еженедельно — автоматический мониторинг релизов upstream (CI-джоба проверки тегов).
- Приёмка апстрим-релизов — раз в спринт (либо по месяцу, если релизов не было).
- Между приёмками upstream не мержится: ветки усыхающих фич на upstream не чекируются.

## Процедура приёмки (по тегам)

```sh
cd "/Volumes/Projects/Ketos bot"                  # рабочее дерево Ketos
git fetch upstream                                # тянет прод upstream
git tag -l 'dsh-v*' --sort=-creatordate | head    # выбрать целевой релизный тег
git switch main
git merge --no-ff <тег> -m "Merge upstream <тег> into Ketos"
```

С `dsh-v0.2.0-rc.2` пересадка корня (`git replace --graft`) не нужна: общий предок — коммит тега через второго родителя слияния.

1. Перед merge: `git switch -c sync/<тег> main` — приёмка всегда в ветке, main получает merge только после зелёных гейтов.
2. Конфликты советуются с `docs/ketos/brand-inventory.md`: ожидаемые места — файлы из серии ребрендинга (CLI-строки, веб-бренд, констрейнты скриптов). Стилистика сверки — «Часть II уточняет Часть I»: сохраняется брендовая и созданная логика Кетоса, upstream-остаток уделяется в пользу пришедшего кода, если брендовая строка вокруг него изменилась.
3. После merge в ветке `sync/<тег>`:
   ```sh
   pnpm install
   pnpm run typecheck
   pnpm run test:gui
   DSH_SNAPSHOT=replay pnpm run test:web
   pnpm run build:native-system
   git switch main && git merge --ff-only sync/<тег>
   git tag ketos-merged-<тег>
   ```

## Переход на новую версию на реальных данных

Первый запуск новой версии переносит настройки: `SettingsForms.importLegacyDocument` (`packages/settings/settings/src/index.ts`) переименовывает `~/.ketos/settings.yaml` в `~/.ketos/settings.yaml.imported` (чистое переименование — исходные байты сохраняются) и записывает каждую секцию в запись активного профиля, для web — в `~/.ketos/profiles/web/cordis.patch.yml`. Переименование выполняется до первой записи, поэтому частичный импорт не повторяется; после первого запуска источник истины — профильный патч, а `settings.yaml.imported` остаётся прежним снимком. Сессии не переписываются: поколение v3 остаётся на месте, у открытых сессий рядом появляется v4-преемник.

Порядок перехода (Кетос закрыт):

1. Свежий архив до первого запуска:
   ```sh
   tar -czf "$HOME/Downloads/ketos-home-backup-$(date +%Y%m%d-%H%M).tar.gz" -C "$HOME" .ketos
   ```
2. Запуск новой версии (`pnpm ketos web`) и проверка: язык — русский (`locale.preference: ru`), раскладка доски (окна, Dock, панели) восстановлена, модель OpenCode Go выбрана по умолчанию.
3. Откат — закрыть Кетос и распаковать архив поверх дома:
   ```sh
   tar -xzf "$HOME/Downloads/ketos-home-backup-<дата>.tar.gz" -C "$HOME"
   ```

Частичный откат «`settings.yaml.imported` → `settings.yaml`» требует вычистить импортированные строки из `cordis.patch.yml`, поэтому архив надёжнее. Стенды и тесты запускаются только с временным `DSH_HOME` и предохранителем `test -n "$DSH_HOME" && [ "$DSH_HOME" != "$HOME/.ketos" ] || exit 1`: запуск без переменной перезаписывает `~/.ketos/profiles/web/{cordis.yml,cordis.patch.yml}`.

## Локальные форк-изменения в upstream-файлах

Эти правки живут в upstream-файлах и при приёмке релиза проверяются как ожидаемые конфликты: если апстрим-версия файла не содержит эквивалента, правку нужно перенести поверх (и обновить запись).

| Файл | Правка | Зачем | Состояние после `dsh-v0.2.0-rc.2` | Проверка |
|---|---|---|---|---|
| `vendor/hmr/src/index.ts` | `registerConfig()` опрашивает существование отсутствующей цели до её появления | Файл конфигурации, созданный сразу после регистрации, не должен терять единственное событие создания (этап 22, `ketos-inp`) | **Снята:** апстрим удалил `registerConfig` вместе с ручным реконсайлом; точное наблюдение конфига живёт в `packages/boot/hmr/src/watch-config.ts` (`findWatchRoot` + `awaitWriteFinish` + native-watch barrier). Старый тест `hmr-config.spec.ts` удалён вместе с функцией | `packages/boot/hmr/tests/watch-config.spec.ts` — «observes creation when the config parent did not exist at registration» |
| `packages/api/workspace-controller/src/commands.ts` | `WorkspaceCommands.create` отказывается регистрировать Workspace внутри `$DSH_HOME`, `~/.ketos`, `~/.dsh` (лексически или после `realpath`), код `workspace/invalid-path` | Домашние каталоги и состояние рантайма Ketos не должны становиться рабочими каталогами сессий (этап 13) | **Сохранена** авто-слиянием; условие на месте (`commands.ts`: `$DSH_HOME`, `~/.ketos`, `~/.dsh`) | `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` — «rejects paths inside Ketos or DSH home» |
| `packages/client/tsdown.client.ts` | Ветка `@ketos/*` с `KETOS_INLINE_SAFE`: любой runtime-импорт `@ketos/*`, кроме `@ketos/clone-core/methodology`, отклоняется ошибкой чистоты бандла | Форк-неймспейс не должен молча инлайнить хост-код в браузер (этап 18) | **Сохранена** авто-слиянием | Гейт `dsh-client-bundle-purity` на каждой сборке; негативная проба — временный runtime-импорт `clone-core/repository` валит сборку |
| `packages/api/session-controller/src/commands.ts`, `packages/client/ui-model-selection/src/client/directory.ts` | `selectModel` с `keepDefault` сохраняет системный дефолт только когда признак не выставлен; `select` на клиенте передаёт `keepDefault` только при `true` | Старт интервью и автономной задачи клона выбирает модель клона, не меняя дефолт обычных чатов (этап 21) | **Перенесена** поверх новых сигнатур: `commands.ts` сохраняет апстримное фоновое сохранение и оборачивает его гейтом; `directory.ts` возвращает `RemoteResult` апстрима | `session-models.host.spec.ts` — «keeps the stored default…»; `browser-plugin.client.spec.ts` — «sends keepDefault only when…» |
| `packages/client/ui-primitives/src/Tooltip.tsx` | Подписи: портал через `PopoverHost` (контейнер, масштаб, граница, сигнал геометрии), скрытие при уходе указателя/остановке рендера якоря, один пузырь за раз | Внутри трансформированного холста доски `position: fixed` без портала отсчитывается от холста (R1, П-09); уехавший якорь оставлял пузырь навсегда (`ketos-6kt`) | **Перенесена** поверх новой реализации апстрима: при смонтированном PopoverHost пузырь порталится в его контейнер, `fit` считает границу хоста от измеренного бокса и следит за якорем; без провайдера — прежнее поведение апстрима. Реестр одного пузыря не трогает вложенные (их гасит `TooltipSuppression`) | `packages/client/ui-primitives/tests/tooltip.client.spec.tsx` (весь файл) |
| `packages/client/ui-primitives/src/Menu.tsx`, `src/Menu.module.css` | Портальный список в контейнере хоста в его масштабе, ограничение `boundary()`; подменю — отдельный портал с измерением и переворотом; прокрутка и `max-height` у меню и подменю; строки меню и подменю отмечаются по `selectedId`/`selectedIds` (`selection: 'check' \| 'fill'`) | Меню с подменю не ограничивалось по высоте и выходило за экран (R2, П-14, П-15); список людей в меню доступа подложки окна должен показывать уже выбранных участников (этап 27) | **Перенесена** поверх `MenuSurface`/`MenuGroup` апстрима: список и подменю порталятся в хост, rAF-трекинг апстрима сохранён, клампы считаются от `boundary()` хоста; отметка строк расширена на независимые группы выбора (этап 27) | `menu-host.client.spec.tsx` (портал, высота, подменю, отметка строк `selectedIds`), `atoms.client.spec.tsx` (высота/прокрутка/подменю) |
| `packages/client/ui-primitives/src/PopoverHost.tsx`, `src/index.ts` | Публичные `PopoverHostProvider`, `usePopoverHost`, типы `PopoverHost`, `PopoverHostProviderProps` | Хост задаёт контейнер, масштаб, границу и сигнал геометрии для портальных подписей и меню (Д2.2) | **Сохранена**; добавлен внутренний (не публичный) `useOptionalPopoverHost` для выбора режима позиционирования | `popover-host.client.spec.tsx` |
| `packages/client/ui-primitives/src/StateDot.module.css` | Под `prefers-reduced-motion` пульс заменяется статичным кольцом | Каталог анимаций доски требует reduced-motion для каждой анимации (П-35) | **Перенесена** рядом с новыми spinner-анимациями апстрима | `state-dot-styles.client.spec.ts` |
| `packages/client/ui-conversation/src/client/contract/input.ts`, `src/client/input/facade.ts`, `src/client/service.ts` | Публичные `SessionInput.addFiles(files): boolean` и `takeDraft(): Promise<TakenDraft \| undefined>` для переноса черновика окна | Доска переносит черновик окна в стандартный композер и обратно (Т2.1/Т2.4/Т2.11) | **Перенесена** с согласованием имён: внутренний метод апстрима `addFiles(references, ids)` переименован в `addFileReferences` (вызовы в `apply.ts` и `input-matrix.client.spec.tsx` обновлены) | `input-matrix.client.spec.tsx` — «matrix row: files», «matrix row: take draft»; `slots.client.spec.tsx` доски |
| `packages/client/ui-conversation/src/client/contract/slots.ts`, `src/client/apply.ts`, `src/client/skeleton/ConversationSession.tsx`, `ConversationRoot.module.css` | List-слот `conversation.session.header.blank` | Кнопка «Вернуть в окно» достижима у пустой сессии (Т2.11/Т2.15) | **Перенесена** в новую структуру шапки апстрима (`.headerBlankSeat`), тест адаптирован к всегда присутствующему `<header>` | `skeleton.client.spec.tsx` — «keeps only the blank seat reachable on a blank Session» |
| `packages/api/session-controller/src/client/contract/sessions.ts`, `packages/client/ui-board/src/client/session-bridge.ts` | `ISessions.openStream(id)` — открыть поток сессии, не выбирая её текущей | Мост доски открывает потоки окон, не подменяя текущую сессию (А5, Т2.9) | **Снята, заменена апстримным `retain`/`release`:** апстрим убрал понятие выбора сессии из `ISessions`; открытие владельческое. Доска переведена: `BoardSessionBridge.attach` берёт `retain(sessionId, { source: 'boardWindow' })`, `releaseSession`/`release`/`dispose` освобождают ссылку, `reconcile` не меняет `list.current` | `packages/client/ui-board/tests/session-bridge.client.spec.ts` — «restores windows without changing the application current session (A5)», «restores every stored pair, retaining each session once»; `packages/client/ui-board/tests/leaks.client.spec.tsx` — счётчик `retainInfo(sessionId).retainedBy.boardWindow` |
| `packages/client/ui-sidebar/src/client/contract/slots.ts`, `src/client/index.ts`, `src/client/SidebarRoot.tsx` | List-слот `sidebar.brand.actions` (широкий сайдбар и узкая полоса, доля `{ wide }`) | Переключатель интерфейсов рядом с логотипом (Т2.5, S1) | **Перенесена** поверх новой раскладки сайдбара апстрима (объединено с `sidebar.toggle.badge`) | `sidebar-root.client.spec.tsx` — «renders the brand actions beside the brand…» |
| `packages/client/ui-layout/src/client/service.ts`, `src/client/stores.ts`, `src/client/AppFrame.tsx`, `AppFrame.module.css` | `ILayout.declarePanelSidebar(panelId, sidebar)` скрывает колонку сайдбара, рейку и ручку ширины | Доска владеет всей шириной фрейма в режиме доски (Т2.7) | **Перенесена**; сетка апстрима (`minmax`) объединена с `sidebarHidden` | `app-frame.client.spec.tsx`, `service.client.spec.ts`, `apply.client.spec.tsx` доски |
| `packages/client/ui-layout/src/client/index.ts`, `AppFrame.tsx`, `pinch-guard.ts`, `package.json` | `Config.blockPagePinchZoom` (по умолчанию `true`) и непассивные слушатели пинч-жеста | Случайный пинч над сайдбаром не масштабирует всё приложение (П-07, П-37) | **Перенесена** | `pinch-guard.client.spec.ts`, `app-frame.client.spec.tsx` |
| `packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx` | Локальные `FullscreenGlyph`/`ExitFullscreenGlyph` заменены иконками `ui-primitives` | Точное artwork кнопок окна (этапы 23–24) | **Снята:** апстрим дал этим глифам новое artwork; замена на иконки `ui-primitives` откатила бы визуальное изменение апстрима. Иконки `IconFullscreenCornersOutline16`/`IconExitFullscreenCornersOutline16` остались без продакшн-потребителей (кандидаты на удаление в У2) | — |
| `scripts/prepare-ci-bubblewrap.sh` | Загрузка `.deb` сначала с Launchpad, `archive.ubuntu.com` — запасной | Ubuntu заменил точечную версию в пуле, старый URL отдавал 404 (задача ketos-cbn.1) | **Снята:** апстрим обновил пин до `bubblewrap 0.12.0-1` и качает его с постоянного Launchpad build-URL; проверено — HTTP 200 и SHA256 совпадает с пином | `bash -n`; прогон в `ketos-ci` на `ubuntu-24.04` |
| .github/workflows/e2e.yml | Preflight при пустом ключе печатает `::warning::` вместо `exit 1` | Ключ в форк не добавляется; E2E остаётся проверкой собранного приложения | **Сохранена** авто-слиянием | E2E-запуск на PR/push форка доходит до тестов |
| `packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/web-app/tests/product-analytics.spec.ts` | `product-analytics` переведён в `enabled: false`, `desktop-product-telemetry` — в `disabled: true`; тест проверяет обе строки и отсутствие сервисов `productAnalytics`/`productTelemetry` в профилях `desktop` и `web` | Решение Р-3: продуктовая аналитика и телеметрия не собираются в Кетосе без отдельного решения | **Сохранена** поверх апстримных строк профиля; собственный тест переписан под политику (апстримный проверял сбор) | `pnpm exec vitest run packages/bundle/web-app/tests/product-analytics.spec.ts` (входит в полный `pnpm test` и `check:ci:coverage`) |
| `packages/bundle/web-app/cordis.patch.yml` | Строки аккаунта DeepSeek (`deepseek-account`, `llm-deepseek-account`, `account-controller`, `ui-settings-account`) не отличаются от апстрима | Решение Р-5: вход — через провайдеров, включая OpenCode Go; аккаунт неактивен в веб-профиле по устройству апстрима (`deepseek-account-platform` получает `desktopPlatform: null` вне профиля `desktop`, клиентская половина выходит из `apply` без `globalThis.dshDesktop`) | **Применена**; попытка выключить строки ломала собственные тесты пакетов, изоляция — устройство апстрима | `pnpm exec vitest run packages/client/ui-settings-account/tests packages/client/ui-settings-general/tests`; 9 web-сценариев аккаунта в `DSH_SNAPSHOT=replay pnpm run test:web`; в веб-интерфейсе нет страниц и запросов аккаунта |
| `apps/cli/tests/plugin.spec.ts`, `apps/cli/tests/startup-diagnostics.spec.ts`, `packages/bundle/headless/tests/headless.spec.ts`, `apps/cli/tests/expected/launcher-help.txt` | Ожидания вывода и файловый эталон переведены на бренд Кетоса: `ketos:` вместо `dsh:`, `ketos plugin`/`ketos web` вместо `dsh …`, справка запуска под именем `ketos` | Тесты апстрима зашивают имя `dsh`, а CLI ребрендирован в `ketos` (этап 0) | **Перенесена** поверх апстримных тестов: та же логика, ожидания Кетоса | `pnpm exec vitest run apps/cli/tests/plugin.spec.ts apps/cli/tests/startup-diagnostics.spec.ts packages/bundle/headless/tests/headless.spec.ts`; `pnpm run build && pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/built-bin.e2e.ts` для `launcher-help.txt` |

## Правило

- Upstream-приёмка никогда не двигает внутренние идентификаторы (`@deepseek-ai/*`, `DSH_*`, профили, `dsh.*`-поля) — это и есть совместимость форка (решение 6).
- Ребрендинг-изменения не распространяются на новые upstream-файлы автоматически: новые поверхности классифицируются по `docs/ketos/brand-inventory.md` до попадания в серию ребрендинга.
