# Ketos ↔ DeepSeek Harness: политика синхронизации с upstream

Файл принадлежит репозиторию Ketos и находится вне upstream-дерева документации (решение 30 Части I). Рабочее дерево — `/Volumes/Projects/Ketos bot` (GitHub `factor241/Ketos`); единственная основная ветка — `main`, унаследованная `feat/ketos-spatial-board` выведена из обращения (её содержимое — база `d5675c2`, зафиксированная тегом). База форка — коммит `d5675c2` (поверх релизной линии `c291e79` 0.1.5-rc.2 и коммита доски `fe89719`), зафиксированный тегом `ketos-base-d5675c2`. Из-за shallow-клона ветка `main` переимпортирована синтетическим корнем `f5d8f1e` и переигранными коммитами `bbe514e`/`a4b5114` с теми же деревьями, поэтому база фиксируется тегом, а не предком в графе.

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
git tag -l 'v*' --sort=-creatordate | head        # выбрать целевой релизный тег
git switch main
git merge --no-ff <тег> -m "Merge upstream <тег> into main"
```

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

## Локальные форк-изменения поведения (не брендинг)

Эти правки живут в upstream-файлах и при приёмке релиза проверяются как ожидаемые конфликты: если апстрим-версия файла не содержит эквивалента, правку нужно перенести поверх (и обновить запись).

| Файл | Правка | Зачем | Проверка |
|---|---|---|---|
| `vendor/hmr/src/index.ts` (вендоренный upstream) | `registerConfig()` опрашивает существование отсутствующей цели до её появления: первый stat поллера может принять единственное изменение mtime родителя за базовую линию и больше не сообщить о создании; первое обнаружение запускает тот же сериализованный refresh | Файл конфигурации, созданный сразу после регистрации, не должен терять единственное событие создания под нагрузкой форк-воркеров (этап 22, `ketos-inp`); полный журнал локальных правок вендора — [vendor/README.md](../../vendor/README.md#local-modifications), пункт 9 | `packages/boot/app-boot/tests/hmr-config.spec.ts`; три подряд полных полосы `pnpm run test:coverage` на Node 24 зелёные |
| `packages/api/workspace-controller/src/commands.ts` | `WorkspaceCommands.create` отказывается регистрировать Workspace, чей путь (лексически или после `realpath`) равен `$DSH_HOME`, `~/.ketos` или `~/.dsh` либо лежит внутри них, отвечая кодом Remote-ошибки `workspace/invalid-path` | Домашние каталоги и состояние рантайма Ketos не должны становиться рабочими каталогами сессий (этап 13) | `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` — «rejects paths inside Ketos or DSH home» |
| `packages/client/tsdown.client.ts` | У гейта `dsh-client-bundle-purity` появилась ветка `@ketos/*` с `KETOS_INLINE_SAFE = /^@ketos\/clone-core\/methodology$/`: любой другой runtime-импорт `@ketos/*` в клиентском бандле отклоняется ошибкой «client bundle purity: … not a requested module-table row or a reviewed browser-safe fork subpath», а `@ketos/clone-core/methodology` инлайнится как чистая браузеробезопасная лексика | Форк-неймспейс не должен молча инлайнить хост-код в браузер (доска инлайнит `clone-core/methodology` намеренно) (этап 18) | Гейт работает на каждой `pnpm run build`; негативная проба в коммите — временный runtime-импорт `clone-core/repository` валит сборку бандла |
| `packages/api/session-controller/src/types.ts`, `src/commands.ts` | `SessionSelectModelRequest.keepDefault?: boolean`: `selectModel` сохраняет системный дефолт `agent-default-model` только когда признак не выставлен | Старт интервью и автономной задачи клона выбирает предпочтительную модель клона, не меняя модель новых обычных чатов (этап 21, пункт П4) | `packages/api/session-controller/tests/session-models.host.spec.ts` — «keeps the stored default when a selection asks to keep it» |
| `packages/client/ui-model-selection/src/client/directory.ts` | `select(selection, options?: { keepDefault?: boolean })` — признак доходит до запроса `session.selectModel` и передаётся только при `true` | Вторая половина правки П4: выбор модели клона доски идёт тем же путём `ModelDirectory`, что и чип композера, но просит не сохранять системный дефолт (этап 21) | `packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts` — «sends keepDefault only when the caller asks to leave the deployment default alone» |
| `packages/client/ui-primitives/src/Tooltip.tsx` | Пока пузырь видим, движение указателя за пределами якоря снимает hover и скрывает пузырь (`pointermove` на `document`, фаза захвата) | Якорь, уехавший из-под неподвижного указателя (смена режима окна, перекладка раскладки), не получает `mouseleave`, и пузырь оставался навсегда — живой репро на кнопке полного экрана (`ketos-6kt`) | `packages/client/ui-primitives/tests/tooltip.client.spec.tsx` — «hides the bubble when its anchor relocates under a still pointer» (падает без правки), «keeps the bubble while the pointer moves inside the anchor» |
| `packages/client/ui-primitives/src/Tooltip.tsx` | Пузырь всегда рендерится порталом в контейнер `PopoverHost` (`document.body` без провайдера), позиция пересчитывается от прямоугольника якоря на каждый сигнал хоста, вписывание и переворот — по `boundary()` хоста | Внутри трансформированного холста доски `position: fixed` без портала отсчитывается от холста, а не от окна, и подпись улетает от кнопки (R1, П-09); этап 23, Д1.5/Д2.1, план — [board-audit-plan.md](board-audit-plan.md) | `packages/client/ui-primitives/tests/tooltip.client.spec.tsx`; `packages/client/ui-trajectory/tests/views.client.spec.tsx` — подпись ищется в `document`, а не в контейнере вида (портал в `document.body` по умолчанию) |
| `packages/client/ui-primitives/src/Menu.tsx`, `src/Menu.module.css` | Портальный список рендерится в контейнере хоста в его масштабе, ограничен `boundary()` по позиции и высоте; подменю вынесено в собственный портальный узел того же контейнера, измеряется и открывается вправо/влево, вниз/вверх; прокрутка и `max-height` есть и у меню с подменю, и у подменю | Меню с подменю не ограничивалось по высоте и открывалось фиксированно «вправо-вверх», выходя за экран (R2, П-14, П-15); этап 23, Д2.1, план — [board-audit-plan.md](board-audit-plan.md) | `packages/client/ui-primitives/tests/menu-host.client.spec.tsx` (переворот подменю, `max-height`); `packages/client/ui-primitives/tests/atoms.client.spec.tsx` — высота и прокрутка меню с подменю |
| `packages/client/ui-primitives/src/PopoverHost.tsx`, `src/index.ts` | В публичный экспорт добавлены `PopoverHostProvider`, `usePopoverHost` и типы `PopoverHost`, `PopoverHostProviderProps`; без провайдера поведение прежнее (`document.body`, масштаб 1, окно браузера, `scroll`/`resize`) | Хост задаёт контейнер, масштаб, границу и сигнал геометрии для портальных подписей и меню; слой всплывающих элементов доски (Д2.2) и обратная совместимость остального клиента; этап 23, Д2.1, план — [board-audit-plan.md](board-audit-plan.md) | `packages/client/ui-primitives/tests/popover-host.client.spec.tsx` — наследование полей и умолчания без провайдера |
| `packages/client/ui-primitives/src/StateDot.module.css` | Под `@media (prefers-reduced-motion: reduce)` пульс работы останавливается статичным кольцом ячеек (`animation: none; opacity: 0.5`) вместо `dsh-state-dot-chase` | Каталог анимаций доски требует поведения при reduced motion для каждой анимации, включая индикатор работы дока и упрощённой карточки (П-35); этап 23, Д6.3, план — [board-audit-plan.md](board-audit-plan.md) | `packages/client/ui-primitives/tests/state-dot-styles.client.spec.ts` — «stills the chase into a static ring under reduced motion» |
| `packages/client/ui-conversation/src/client/contract/input.ts`, `src/client/input/facade.ts`, `src/client/input/hub.ts` | В публичный `SessionInput` добавлен `addFiles(files): boolean` — регистрация браузерных файлов как вложений черновика через сервис (`createDrafts`), отказ в заблокированной фазе приёма; текущий текст стандартного черновика читается через уже публичный снимок `input.state.getSnapshot().draft` | Доска переносит черновик окна (текст + изображения + файлы) в стандартный композер при «Открыть во весь экран» (Т2.1/Т2.4), не перезаписывая текст стандартного композера: текст окна добавляется новым абзацем, при отказе переноса (сессия занята приёмом, файл отклонён, сессия недоступна) черновик окна остаётся, а причина показывается в композере окна; этап 24, Э2.3, план — [board-redesign-plan.md](board-redesign-plan.md) | `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` — «matrix row: files» (два теста: вложение и отказ в заблокированной фазе); `packages/client/ui-board/tests/slots.client.spec.tsx` — «hands the window draft to the standard interface through the expand control (Т2.1/Т2.4)» и «reports every expand failure on the window and keeps its draft (Т2.1)» |
| `packages/client/ui-conversation/src/client/contract/input.ts`, `src/client/input/facade.ts`, `src/client/service.ts` | В публичный `SessionInput` добавлен `takeDraft(): Promise<TakenDraft \| undefined>` — забрать весь черновик (текст + сериализованные вложения: изображения с данными, файлы с receipt и именем) с очисткой и освобождением вложений; `undefined` в фазах приёма/отправки и при незавершённой загрузке файла; новые публичные типы `TakenDraft` и `SerializedDraftAttachment` (у файла появилось имя) | Доска переносит черновик стандартного композера обратно в окно при «Вернуть в окно» (Т2.11), файлы приходят в окно как receipt-only; этап 24, Э2.4, план — [board-redesign-plan.md](board-redesign-plan.md) | `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` — «matrix row: take draft» (три теста); `packages/client/ui-board/tests/slots.client.spec.tsx` — «returns the standard draft to the window on the return control (Т2.11)» |
| `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`, `ConversationRoot.module.css` | Шапка пустой сессии больше не скрывается целиком: смонтированы только слоты `…utilities` и `…corner`, остальное сворачивается, пустая шапка имеет нулевую высоту | Кнопка «Вернуть в окно» в шапке должна быть достижима и у пустой сессии (Т2.11/Т2.15); этап 24, Э2.4 | `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` — «keeps a rendering header utility reachable on a blank Session (Т2.11)» |
| `packages/api/session-controller/src/client/contract/sessions.ts`, `src/client/sessions/service.ts` | `ISessions.openStream(id)` — открывает живой поток сессии без выбора её текущей (тихое разрешение, как у `binding`) | Мост доски открывает потоки окон, не подменяя текущую сессию приложения (А5, Т2.9); этап 24, Э1.2, план — [board-redesign-plan.md](board-redesign-plan.md) | `packages/api/session-controller/tests/sessions-service.client.spec.ts` — «openStream() opens a session stream without moving the current selection»; `packages/client/ui-board/tests/session-bridge.client.spec.ts` — «restores windows without changing the application current session (A5)» |
| `packages/client/ui-sidebar/src/client/contract/slots.ts`, `src/client/index.ts`, `src/client/SidebarRoot.tsx` | Объявлен list-слот `sidebar.brand.actions` (широкий сайдбар — между брендом и кнопкой сворачивания; узкая полоса — первый значок под логотипом; занимающим передаётся доля `{ wide }`) | Переключатель интерфейсов рядом с логотипом и в свёрнутой полосе (Т2.5, S1); этап 24, Э2.2, план — [board-redesign-plan.md](board-redesign-plan.md) | `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` — «renders the brand actions beside the brand while wide and under the logo in the rail (Т2.5)»; `packages/client/ui-board/tests/apply.client.spec.tsx` — «renders the panel-sized canvas and the brand-row switch at its own size», «localizes the interface switch through the board dictionary»; `apps/web/tests/board-geometry.e2e.ts` — «Т2.5/Т2.6: the switch works from the collapsed rail and at a narrow window (S1)» |
| `packages/client/ui-layout/src/client/service.ts`, `src/client/stores.ts`, `src/client/AppFrame.tsx`, `src/client/AppFrame.module.css` | В `ILayout` добавлено `declarePanelSidebar(panelId, sidebar): () => void` (декларация живёт до disposer'а, передекларация слота повторяет её; реестр не стирает признак при переборах): панель, объявившая `false`, скрывает колонку сайдбара, её рейку и ручку ширины (дорожка 0px, без границы) | Доска владеет всей шириной фрейма в режиме доски (Т2.7); этап 24, Э2.1, план — [board-redesign-plan.md](board-redesign-plan.md) | `packages/client/ui-layout/tests/app-frame.client.spec.tsx` — «hides the sidebar column for a panel declaring no sidebar (Т2.7)», «keeps a declared sidebar flag until its declarer clears it»; `packages/client/ui-layout/tests/service.client.spec.ts` — «declares a sidebar and clears it through the returned disposer»; `packages/client/ui-board/tests/apply.client.spec.tsx` — «registers once the occupied slots are declared, and drops the entries when the declaration collapses» (redeclaration re-applies the flag) |
| `packages/client/ui-layout/src/client/index.ts`, `src/client/AppFrame.tsx`, `src/client/pinch-guard.ts`, `package.json` (devDependencies: `@deepseek-ai/schemastery`) | Поле `Config.blockPagePinchZoom` (по умолчанию `true`); непассивные слушатели `wheel` только с `ctrlKey` и `gesture*` на документе корня `AppFrame` (порталы в `document.body` вне поддерева корня), которые отменяют пинч-зум страницы везде, кроме `[data-surface="board"]`; `Cmd/Ctrl +/−/0` вне доски остаются браузеру | Решение Р-2: случайный пинч над сайдбаром не должен масштабировать всё приложение (П-07); слушатель на документе покрывает портальные меню и подсказки в `document.body` (П-37, Д6.4); этап 23, Д1.5/Д6.4, план — [board-audit-plan.md](board-audit-plan.md) | `packages/client/ui-layout/tests/pinch-guard.client.spec.ts` — «blocks a pinch over a portal mounted in document.body (П-37)»; `packages/client/ui-layout/tests/app-frame.client.spec.tsx` — «blocks the page pinch outside the board…», «leaves the page pinch to the browser when blockPagePinchZoom is off» |

## Правило

- Upstream-приёмка никогда не двигает внутренние идентификаторы (`@deepseek-ai/*`, `DSH_*`, профили, `dsh.*`-поля) — это и есть совместимость форка (решение 6).
- Ребрендинг-изменения не распространяются на новые upstream-файлы автоматически: новые поверхности классифицируются по `docs/ketos/brand-inventory.md` до попадания в серию ребрендинга.
