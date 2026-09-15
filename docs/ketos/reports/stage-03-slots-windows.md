# Отчёт этапа 3. Слоты и оконный каркас

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-03-slots-windows`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-03` (от принятой ветки этапа 2 `stage-02-board-wiring`, `b1ca735`). Состояние отчёта — коммит `5c572bb` (голова ветки на момент приёмки); проверочные аудиты этапа и их доработки названы в §4.

## 1. Итог этапа

Доска перестала быть монолитом: `apply` собирает всю композицию через `ctx.slots.register`/`ctx.slots.inject`, и каждый ключ `board.*` (`board.canvas`, `board.dock`, `board.omnibar`, `board.minimap`, `board.windows`, `board.window`, `board.window.body`) имеет ровно одного владельца и render-место. Окна — keyed-регистрации по типу (`WindowKind`), экземпляр приходит owner-пропом, поэтому один occupant обслуживает все окна типа; содержимое окна — отдельный keyed-слой `board.window.body` (`conversation`, `connectors`, `settings`), переключение `bodyKind` меняет body. Последующие этапы 6–19 добавляют типы окон и тела без правки холста. Побочно закрыты шесть нарушений `verify-client-domain-graph` в `ui-board` (canvas больше не импортирует домены окон, дока и омнибокса).

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 3.1 Владение слотами и `renderSlot` | `ketos-5v2.4.1` | выполнен | 7 ключей `SlotMap` ↔ 7 мест `renderSlot` ↔ регистрации в `apply` (grep-вывод в §3); `BoardRoot` объявляет и рендерит `board.canvas`/`board.dock`/`board.omnibar`/`board.minimap`; `entriesOfSlot('board.canvas')` = 1 в `tests/slots.client.spec.tsx`; живой браузер + GIF |
| 3.2 Keyed-окна и `board.window.body` | `ketos-5v2.4.2` | выполнен | 6 регистраций `board.window` (по типам) и 3 тела; два agent-окна рендерит один occupant с разными props; переключение `bodyKind` меняет body; `verify-client-catalog` зелёный после `gen-client-catalog` |
| 3.3 Регистрация слоёв и окон из `apply` | `ketos-5v2.4.3` | выполнен | все регистрации — `ctx.slots.inject` в одном `apply`, общий handle `boardStore`; повторный `apply` не даёт дубликатов (`tests/slots.client.spec.tsx`); `dispose()` очищает все ключи |
| 3.4 Тесты регистрации и диспоуза | `ketos-5v2.4.4` | выполнен | `tests/slots.client.spec.tsx` (10 тестов: каскад, рендер-места слоёв, диспетчер по `kind`, диспетчер по `bodyKind`, панели тела, пустой body, закрытие через каркас, циклы open-close, повторный apply, диспоуз) + `open-window`, `inspector` (оверлей выбора), `canvas` (проекция миникарты), `store`, `roster` (реальный Loader-reload); 7 файлов, 40 тестов; мутации (§4) |

## 3. Критерии приёмки этапа

- [x] Все слоты доски имеют владельца и render-место; оконные слоты — keyed-регистрации. Доказательство: `grep`-вывод по `contract/slots.ts` (7 объявлений), `renderSlot('board.*')` (7 мест) и `name: 'board.*'` в `index.ts`; тест «renders every declared layer…» требует по одному живому DOM-маркеру `[data-board-layer]` на каждый из четырёх слоёв, которые рендерит BoardRoot (canvas, dock, omnibar, minimap), и наличие окна внутри трансформированной поверхности холста, поэтому удаление любого `renderSlot`-вызова валит спек.

```
$ grep -n "^    'board\." src/client/contract/slots.ts   # 7 объявлений: canvas, dock, windows, window, window.body, minimap, omnibar
$ grep -rn "renderSlot('board" src/client                # 7 мест: BoardViews 27-30, DashboardCanvas 106, BoardWindowLayer 19, 28
$ grep -n "name: 'board\." src/client/index.ts           # регистрации всех семи ключей в одном apply
```
- [x] `entryKey` = `window.kind`, экземпляр — в owner props; два окна одного типа рендерит один occupant. `tests/slots.client.spec.tsx` «routes each window to the frame registered for its kind» (окно agent несёт composer агентской карточки, окно connectors — табы и панель тул-окна) и «closes a window through its frame and removes it from the layer»: два agent-окна → 2 `[data-board-window="agent"]`, после клика по кнопке закрытия — 1 и укороченный `windowOrder`.
- [x] Переключение `bodyKind` меняет содержимое. Тот же спек: connectors body → `setWindowBodyKind(id, 'settings')` → settings-панель; в живом браузере — клик по табу «Настройки» (кадр 04 GIF).
- [x] Число регистраций `board.window` равно числу типов окон. Спек: тест каскада сверяет список шести keyed-регистраций (`['agent','clone','connectors','settings','dashboard','tasks']`) без открытых окон, ledger-тесты — что число не растёт после открытия окон.
- [x] `pnpm run test:gui` зелёный — 385 файлов, 5466 passed, 1 skipped.
- [x] HMR и dispose не оставляют следов — `tests/roster.client.spec.ts` «rebuilds the row through the Loader without duplicating board contributions» прогоняет реальный путь client-hmr (`tearDownEntryFiber` → `entry.refresh()`) на поставленном веб-ростере и требует тот же набор вкладов (1/1/1/6/3/1) после пересборки; `tests/slots.client.spec.tsx` добавляет повторный `apply` после `dispose()` (без дублей) и полное снятие вкладов по всем ключам с исчезновением DOM.
- [x] `DSH_SNAPSHOT=replay pnpm run test:web` — 101 файл passed, 1 skipped; 359 passed, 15 skipped; снимки не менялись (перестройка композиции визуального вывода не меняет).
- [x] `verify-client-catalog` зелёный после регенерации — каталог отдаёт закрытые key-домены (`{ [Key in WindowKind]: … }`), занятые ключи (`agent, clone, connectors, dashboard, settings, tasks`; `connectors, conversation, settings`) и owner props обоих keyed-слотов (`window`, `renderBody`).
- [x] В браузере доска выглядит как раньше — живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3184) с дерева коммита `5c572bb` (после `pnpm run build` этого дерева): холст, rail, Omnibox, миникарта; agent-окно (тёмная карточка с conversation-body), tools-окно, табы, закрытие окна, центрирование по rail-строке; 0 ошибок консоли. GIF: `.playwright-mcp/stage-03-gif/board-slot-composition.gif` (1200×750, 13.0 с, 130 кадров, 1.4 МБ; источник 23.0 с, интервал 4.0–20.0 с, скорость 1.6×, финальная задержка 3 с; скрипт, storyboard и QA-кадры рядом; без вызовов модели — окна доски остаются заглушками до этапов 6/10).
- [x] Agent Note этапа — `.agents/notes/implemented/architecture/2026-09-15-ketos-board-slot-composition.md` (+ zh-пара, pairing перезаписан); в ней же зафиксировано вынужденное отклонение от буквального каскада плана.

## 4. Отклонения

- **`board.window.body` объявляет оконный слой, а не окно-оболочка (отклонение от буквального текста плана).** `SlotCore.register` допускает одного declarer'а на ключ (`ui-slots/src/index.ts`), поэтому шесть регистраций `board.window` не могут каждая объявить `board.window.body` — второй выброс `slot "board.window.body" is already declared`. Единственный declarer — слой окон (`children: { 'board.window', 'board.window.body' }`), а каждый каркас получает owner-проп `renderBody(window)` и вызывает его в области содержимого. Форма совпадает с существующим прецедентом `ChatNodeOwnerProps['renderMessageImages']` (ui-chat); контент по-прежнему маршрутизируется через слот. Варианты (body на каждый тип окна, body-ключ на каркас, рендер body рядом с каркасом) разобраны в Agent Note.
- **Критерий 3.4.2 про `renderSlot('board.window.body', …, { entryKey: 'settings' })` → `ToolWindow` выполнен по смыслу, а не буквально.** В `board.window.body` key `settings` зарегистрирован `ToolWindowBody` — панель настроек, извлечённая из `ToolWindow` (каркас остаётся occupant'ом `board.window`). Спек проверяет, что body с `bodyKind: 'settings'` рендерит панель «Agent Configuration / System Prompt»; прямой вызов `renderSlot('board.window.body', …)` из теста невозможен: ключ уже объявлен слоем доски, а тестовый root не может объявить его повторно (одно правило declarer'а).
- **Проверка `ctx.slots.entriesOfSlot('board.canvas')` «в консоли» заменена.** Веб-оболочка не публикует handle клиентского ctx на `window` (только `__DSH_BOOT__`/`__DSH_TRANSPORT__`), поэтому живой консольный вызов невозможен без новой debug-поверхности. Эквивалент: `expect(runtime.slots.entriesOfSlot('board.canvas')).toHaveLength(1)` в `tests/slots.client.spec.tsx` + живой рендер холста в браузере.
- **Мелочь: задвоенный `data-surface="canvas"` сохранён** (наружная поверхность и трансформированный слой). Удаление — задача `ketos-0da` этапа 5 (там же жест панорамирования и passive-listener `ketos-3kf`), менять фильтр пан-жеста вне этого этапа не стали.
- **`addWindow` оставлен в действиях стора** рядом с новым `openWindow`: он обслуживает явные состояния окон в тестах, `openWindow` — размещение и порядок z-index для UI.
- **Дефект, исправленный по ходу:** в путях drag/resize освобождение pointer capture вызывалось на `e.currentTarget` React-события, который после диспатча равен `null`, — освобождение молча не работало (`pointer-cleanup` глотал TypeError). Теперь элемент захватывается в локальную переменную. Незакрытая родственная проблема — слушатели `globalThis`, не снимаемые при размонтировании посреди жеста — заведена как `ketos-0s0` (зависимость от подэтапа 3.2 к приёмке закрыта); дублирование 8-направленного ресайза между каркасами — `ketos-4k3`.
- **Доработки по итогам проверочного аудита (коммит после `5767203`).** Независимый аудит четырьмя мандатами нашёл, что часть критериев подтверждалась тестами слабее, чем заявлено, и один документ расходился с кодом. Закрыто в том же этапе: (1) `[data-board-window]` выводится из состояния окна, поэтому подсчёт окон не ловил подмену `entryKey` — добавлены содержательные проверки (agent-каркас ≠ панели тул-окна) и кросс-компонентная смена body (`conversation` → `connectors`); (2) удаление любого `renderSlot`-вызова из `BoardRoot` не ломало тесты — добавлены маркеры `data-board-layer` и тест рендер-мест; (3) закрытие окна проверялось только юнитом стора — добавлен клик по кнопке закрытия каркаса; (4) dispose-тест мог пройти при отсутствии регистраций `board.window` — добавлены предположительные проверки (окно и 6 регистраций до диспоуза, `entriesOfSlot('board.window')` после); (5) «HMR»-тест был dispose+повторный mount — добавлен реальный Loader-reload (`client.reload`) в ростер-спеке; (6) не проверялись проекция миникарты (обязательный пункт политики MVP) и `open-window`/шаблоны — добавлены тесты; (7) Agent Note утверждал, что тела окон читают состояние через `useStore`, — исправлено; (8) компонент оверлея выбора из §4.10 не имел теста — добавлен `inspector.client.spec.tsx`; (9) по замечаниям к дисциплине комментариев убраны плановые номера в `apply`, нумерация этапа в комментариях компонентов и противоречивое JSDoc `mintWindowId`. Все семь пунктов подтверждены мутациями: `entryKey: 'agent'` для каркасов, `entryKey: 'conversation'` для тел, удаление `renderSlot('board.minimap')`, регистрация одной пары kind-каркас, лишняя регистрация body и удаление `children`-ключа — каждый вариант валит соответствующий спек.
- **Покрытие:** исключение `packages/client/ui-board/src/**` из per-file 100% сохранено по MVP-политике; команда покрытия новых исходников из таблицы «Команды проверки» мастер-плана (§6.1) при этом вакуумна — `--coverage.include` перекрывается `coverage.exclude`, отчёт содержит 0 файлов (см. §5). Полный `pnpm run test:coverage` в этапе не гонялся: пороговые ошибки по доске исключены политикой, а полный прогон принадлежит CI.
- **Базовые проблемы:** `verify-client-domain-graph` остаётся красным из-за upstream-пакетов (`ui-sidebar-documentpreview`, `ui-conversation`; 25 нарушений) — записано в [baseline-issues.md](../baseline-issues.md), задача `ketos-bmz`; собственные нарушения `ui-board` этап снял. Прочее зелено.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный: 7 файлов, 40 passed |
| `pnpm run test:gui` | зелёный: 385 файлов, 5466 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл passed, 1 skipped; 359 passed, 15 skipped |
| `pnpm run build` | зелёный; build-запись `238 client artifact(s) with 3 public value(s)`; `lib/client.js` доски и каталог-бандл содержат аудированный код (`data-board-layer` ×4, `renderBody`) |
| `pnpm run typecheck` | зелёный (сборка + `tsc -b tsconfig.client.json`) |
| `pnpm run lint` | зелёный |
| `pnpm run doc-sync` | зелёный: 34 passed, 0 failed |
| `pnpm run hygiene` | зелёный: 16 gates passed |
| `pnpm run constraints` | зелёный |
| `pnpm run verify-client-catalog` | зелёный (после `gen-client-catalog`) |
| `pnpm run verify-cordis-config` | зелёный: 143 config files |
| `pnpm run verify-client-packages` | зелёный: 52 packages |
| `pnpm run verify-client-ui-i18n` | зелёный: 623 файла |
| `pnpm run verify-module-graph` | зелёный: 3 artifact(s) up to date |
| `pnpm exec tsx scripts/verify-client-domain-graph.ts` | строк `ui-board` нет; 25 чужих нарушений — `ketos-bmz` |
| `pnpm exec vitest run packages/client/ui-board/tests --coverage --coverage.include='packages/client/ui-board/src/**/*.{ts,tsx}'` | 37 passed; отчёт покрытия пуст (0 файлов) — исключение `packages/client/ui-board/src/**` из MVP-политики перекрывает include |
| Ручные мутации | удаление `board.omnibar` из children `main`/`board` → `SlotOwnershipError` в `main` (8 тестов валятся); удаление `board.window`/`board.window.body` из children слоя окон → `SlotOwnershipError` в `board.windows` (по 6 тестов); подмена `entryKey` каркасов на константу `'agent'` → валится тест диспетчера; подмена `entryKey` тел на `'conversation'` → 4 теста; удаление `renderSlot('board.minimap')` → тест рендер-мест; лишняя регистрация body → ростер-reload; все изменения возвращены |
| Живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3184, коммит `5c572bb`) | 200; холст, rail, Omnibox, миникарта; agent-окно, tools-окно, табы, закрытие, центрирование; 0 ошибок консоли; сервер остановлен |
| GIF-запись `record-browser-gif` | `.playwright-mcp/stage-03-gif/board-slot-composition.gif`, 1200×750, 13.0 с, 130 кадров, 1.4 МБ; снят с коммита `5c572bb`, порт 3184; источник, скрипт, storyboard и QA-кадры рядом |

## 6. Следующий шаг

Этап 4 — «Тема и i18n» (эпик `ketos-5v2.5`): локализованные словари и палитра Кетоса на семантических токенах, изоляция палитры на `.board-canvas`. Предпосылки этапа 3 выполнены: вся композиция доски собирается в `apply` и расширяется слотами (`board.window`/`board.window.body`), стилевые правки этапа 4 не затрагивают регистрацию и не требуют менять каскад. После приёмки агент закрывает эпик `ketos-5v2.4` в Beads и готовит worktree этапа 4 от принятой ветки.
