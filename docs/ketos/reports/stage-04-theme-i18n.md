# Отчёт этапа 4. Визуальный язык Кетос: токены, CSS Modules, локали

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-04-theme-i18n`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-04` (от принятой ветки этапа 3 `stage-03-slots-windows`, `c31a39c`). Состояние отчёта — коммит `4292283` (реализация этапа); GIF снят с построенного дерева этого коммита.

## 1. Итог этапа

Палитра доски объявлена один раз и живёт в `ui-theme`: новый бренд-слой `ketos-brand.css` маппит палитру Кетос на семантические алиасы **только внутри `.board-canvas`**, а белые инструментальные окна перебиндовывают те же алиасы через `data-board-surface="light"`; `body` и `body[data-ds-dark-theme]` не трогаются. Каждый компонент доски получил собственный CSS Module на `--dsw-*`-алиасах и `clsx`, инлайн остался только геометрией и вычисляемыми pan/zoom-переменными — в `packages/client/ui-board/src` не осталось ни одного hex-цвета (единственное исключение — точка сетки холста, задокументированная бренд-переменная модуля холста). Локализация сохранила механику этапа 0: строки владеются словарями `zh`/`en` пакета, ru приходит из корпуса `@ketos/client-locale-ru`, манифест `ru-keys.json` пересинхронизирован. Все гейты этапа зелёные: `test:gui` 385 файлов / 5466 passed, `DSH_SNAPSHOT=replay pnpm run test:web` без расхождений, `verify-client-ui-i18n`, `verify-translation-pairing`, `typecheck`, `lint`, `build`, `hygiene`, `doc-sync`.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 4.1 Токены бренда Кетос | `ketos-5v2.5.1` | выполнен | `packages/client/ui-theme/src/styles/ketos-brand.css` (+ строка в `src/client/styles.ts`, порядок зафиксирован в `tests/client-styles.client.spec.ts`); grep по `src` доски даёт 0 hex; живая проверка `getComputedStyle` под тёмной темой оболочки: `body --dsw-alias-bg-base: #151517`, `.board-canvas … : #f5f5f0`, `--dsw-alias-brand-primary: #b8532f`, elevation-штрих `#3a3940`; два плейсхолдер-пункта удалены; контраст проверен по живым кадрам |
| 4.2 Перевод компонентов на CSS Modules | `ketos-5v2.5.2` | выполнен | 10 модулей (`DashboardCanvas`, `AgentCard`, `ToolWindow`, `ToolWindowBody`, `ConversationBody`, `SessionRail`, `DashboardToolbar`, `Minimap`, `ElementSelectionOverlay`, `BoardViews`); `pnpm --filter @deepseek-ai/dsh-client-ui-board bundle` собирает 10 style-инъекторов; инлайн — только `left/top/width/height/zIndex` и вычисляемые `--board-*`; `test:gui` зелёный |
| 4.3 Локализация: zh/en у `ui-board`, ru — корпус пакета | `ketos-5v2.5.3` | выполнен | `src/client/locale.ts` (zh/en, `BoardKey`), `packages/ketos/client-locale-ru/src/locales/board-ru.ts`, `tests/fixtures/ru-keys.json` (41 ключ); `verify-client-ui-i18n` (623 файла) и `verify-translation-pairing` (818 пар) зелёные; живая проверка: ru-подписи, затем Settings → English → «Board», «Connectors», «Core Tools», «Ask me anything...», «Done» |
| 4.4 Гейты и визуальная приёмка | `ketos-5v2.5.4` | выполнен | `tests/canvas.client.spec.tsx` без литеральных цветов (классы модулей + custom properties), `tests/apply.client.spec.tsx` — на `board-canvas`-хук и модульные классы; 40 passed; snapshot replay без расхождений; чек-лист визуальной приёмки заполнен; GIF `.playwright-mcp/stage-04-gif/board-theme-i18n.gif` (1200×750, 12.8 с, 128 кадров, 3.1 МБ) |

## 3. Критерии приёмки этапа

- [x] **Бренд-слой в `ui-theme` только на `.board-canvas`.** `ketos-brand.css` объявляет палитру на `.board-canvas` (класс-хук носит корень доски рядом с hash-классом модуля) и перебиндовывает те же алиасы на `[data-board-surface='light']`; `body`/`body[data-ds-dark-theme]` в файле не упоминаются. Живое доказательство — вычисленные значения из §2.1 под включённой тёмной темой оболочки: глобальные токены тёмные, токены доски — кетосовские.
- [x] **Ноль литеральных цветов и `var(--board-*)`; `tokens.css` отсутствует.** `grep -rn "#[0-9a-fA-F]\{3,8\}" packages/client/ui-board/src` → пусто; файла `tokens.css` в дереве нет (удалён ещё этапом 2); остался один `rgba(0,0,0,0.08)` — точка сетки в `DashboardCanvas.module.css`, единственное исключение из плана.
- [x] **Плейсхолдеры `Temporal Orchestration` и `External MCP: Twitter/X` удалены.** Ключи `tool.temporalName/Desc`, `tool.mcpName/Desc` удалены из `zh`/`en`, из `board-ru.ts` и из `ru-keys.json`; в ростере остались три пункта, называющие реальные возможности Harness (Core Tools, Web Search, Browser Inspector); новых заглушек нет.
- [x] **Контраст текста проверен.** Живые кадры `qa/02-agent-window.png` (тёмная карточка: `#E6E4E8`/`#8F8E94` на `#2B2A30`, бейдж `#265B19` на `#E9F1DC`) и `qa/03-tools-window.png` (светлое окно: `#1C1B1F`/`#787570` на `#FFFFFF`/`#FAFAF8`); тёмная тема оболочки доску не меняет (`qa/08-board-dark-shell.png`).
- [x] **CSS Modules и `clsx`.** 10 модулей рядом с компонентами; `clsx` в 9 местах (фокус окна, активный таб, активная строка дока, открытое меню, готовность отправки, включённый тумблер, светлая/тёмная заливка прямоугольника миникарты, активная иконка панели).
- [x] **Инлайн — только геометрия и вычисляемые переменные, правило задокументировано в `DashboardCanvas`.** JSDoc модуля: «inline styles are reserved for geometry and the computed metrics that scale with the live pan/zoom (passed as component-local custom properties)».
- [x] **Типы модулей работают при сборке.** `src/css-modules.d.ts` переставлен в порядок `*.module.css` → `*.css` (в прежнем порядке ambient-декларация `*.css` перекрывала модульную, и `.root` не существовал для TS — латентный дефект этапа 1); `tsc -b tsconfig.client.json` зелёный, бандл собирает CSS.
- [x] **`pnpm run test:gui` зелёный** — 385 файлов, 5466 passed, 1 skipped (в т. ч. ui-theme-спеки: elevation-парность, corner-shape-парность, перебиндовка скроллбара на приподнятых поверхностях).
- [x] **`DSH_SNAPSHOT=replay pnpm run test:web`** — 101 файл passed, 1 skipped; 359 passed, 15 skipped; расхождений снимков нет.
- [x] **Язык переключается.** zh/en — словари `ui-board` (спек `apply` проверяет `Board` → `看板` через `ctx.locale.setLocale`), ru — корпус ru-пака (его спек проверяет `Доска`, `agent.contextUsed` и полный охват ключей); живьём — ru по умолчанию и английские подписи доски после Settings → English.
- [x] **Чек-лист визуальной приёмки заполнен** (§4 ниже) и GIF существует — `.playwright-mcp/stage-04-gif/board-theme-i18n.gif`.

## 4. Визуальная приёмка (чек-лист)

Наблюдение — живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3185) с дерева коммита `4292283` после `pnpm run build`; кадры в `.playwright-mcp/stage-04-gif/qa/`.

| Элемент | Наблюдение | Кадр |
|---|---|---|
| Холст | кремовый `#F5F5F0`, точечная сетка, панорамирование/зум | `01-board.png`, `05-zoom.png` |
| Сетка | точка масштабируется с зумом (`--board-canvas-dot-radius`/`--board-canvas-grid`) | `05-zoom.png` |
| Карточка агента | графит `#2B2A30`, терракотовый штрих при фокусе, светофор, бейдж «✓ Готово», композер `#201F24`, ContextRing | `02-agent-window.png` |
| Светлое окно | белый фон, тёплый заголовок, терракотовые табы, тумблеры | `03-tools-window.png`, `04-settings-body.png` |
| Док | графитовая капсула, терракотовая активная строка, тултип на overlay-токене | `06-tooltip.png` |
| Миникарта | терракота для агента, синий `state-business` для тула, акцентный фрустум | `03-tools-window.png` |
| Omnibox | тёмная капсула с blur, терракотовая кнопка меню, локализованный placeholder | `01-board.png` |
| Тёмная тема оболочки | сайдбар тёмный, доска сохраняет палитру Кетос | `07-settings-dark.png`, `08-board-dark-shell.png` |
| Язык | ru по умолчанию; после Settings → English подписи доски английские | `10-board-english.png` |

Референс OpenSwarm: каталог `docs/ketos/reference/` в репозитории отсутствует (план ссылается на скриншот, которого нет), поэтому сверка велась с палитрой и композицией, зафиксированными в плане этапа (§4.1) и в реализации этапа 2, и по живым кадрам до/после перехода на токены. Направление — терракотовый акцент, графитовые карточки, кремовый холст — сохранено.

## 5. Отклонения

- **Премиса плана о `tokens.css` устарела.** Глобального `src/client/tokens.css` с русскими комментариями в дереве не было: он удалён ещё в этапе 2 (`f944353`). Работа свелась к инлайн-литералам, `--board-*`-переменных в коде также не осталось. Критерий «`tokens.css` удалён» выполнен по факту отсутствия, а не правкой.
- **Светлое окно — блок перебинда в бренд-слое, а не вторая палитра.** Один субдерево доски смешивает кремовый холст, графитовые карточки и белые окна, а семантический алиас даёт одно значение на элемент. Решение: `.board-canvas` объявляет палитру графитовой оболочки, а `[data-board-surface='light']` — перебиндовывает те же алиасы (белая заливка, тёплый заголовок, светлые волоски, тёмные чернила). Альтернативы (литералы в модулях окна, глобальный перебинд `body`, новые `--dsw-specific-board-*`) разобраны в Agent Note.
- **Три цвета без прямого алиаса получили семантическое соответствие, а не новые токены.** Зелёный огонёк зума — `--dsw-alias-state-success-tertiary` (`#27C93F`), потому что `-primary`/`-secondary` заняты бейджем «Готово» (`#265B19` на `#E9F1DC`, как в плане); красный/жёлтый огоньки — `state-error-primary`/`state-warn-primary`; синие прямоугольники миникарты — `state-business-primary`. Точка сетки холста — единственная бренд-переменная модуля (`--board-canvas-dot`), как и предписано планом.
- **Миграция на elevation/волоски меняет тень и толщину рамок (намеренно).** Карточки и окна теперь `border: 0` + `--dsw-elevation-panel`/`-prominent`, фокус перебиндовывает `--dsw-elevation-stroke-color` в акцент; внутренние разделители — 0.5px-волоски. Это требование спек ui-theme (широкий нейтральный бордер, пара «нейтральный бордер + elevation-тень» запрещены), поэтому «вид не изменился» из §4.2 понимается как «не изменился относительно состояния 4.1»: палитра, композиция и вёрстка те же, тени и толщины приведены к системным.
- **`inject` остаётся `['slots', 'locale']` — `layout` не добавлен.** План предписывал «проверить `inject = ['slots', 'layout', 'locale']`». Проверка: доска не читает сервис `layout`; регистрация в `main` использует `ctx.slots.inject`, который ждёт *декларацию* слота от ui-layout, а не её сервис. Другой occupant `main` — ui-conversation — тоже не инжектит `layout`. Добавление неиспользуемого сервиса заставило бы фибру ждать лишний провайдер.
- **Иконка панели в сайдбаре больше не терракотовая при активации.** Она живёт вне `.board-canvas`, поэтому бренд-слой на неё не действует; вместо литерала `#B8532F` она следует `currentColor` (shell-чернила), а при активации — `--dsw-alias-brand-primary` в контексте оболочки. Это осознанно: сайдбар — поверхность Harness, а не доски.
- **Из пяти пунктов ростера удалены два, три оставлены.** Удалены ровно те, что называли несуществующие продуктовые интеграции (`Temporal Orchestration`, `External MCP: Twitter/X`, включая их ru-переводы и ключи манифеста). «Core Tools», «Web Search», «Browser Inspector» называют реальные возможности Harness и остаются статичным ростором окна до момента, когда соответствующие этапы подключат их по-настоящему; это зафиксировано в Known Limitations README.
- **Латентный дефект типов CSS Modules исправлен по ходу.** В `src/css-modules.d.ts` порядок ambient-деклараций был `*.css` → `*.module.css`, из-за чего TypeScript выбирал пустую `*.css`-декларацию и модули не типизировались (дефект не проявлялся, пока ни один компонент не импортировал модуль). Порядок приведён к конвенции остальных пакетов.
- **Окно не перелокализует заголовок при смене языка.** Заголовок окна резолвится из словаря в момент открытия и хранится в `BoardWindowState.title` как данные окна; после переключения языка на английский существующее окно остаётся с русским заголовком (наблюдалось живьём в `qa/10-board-english.png`). Это поведение не менялось в этапе 4; заведена задача `ketos-1lx`.
- **Минорное наблюдение при записи.** В консоли — два `Unable to preventDefault inside passive event listener invocation` от колеса холста; известная проблема `ketos-3kf` (жест колеса принадлежит этапу 5.1), в этапе 4 не трогалась.
- **Базовые проблемы:** `verify-client-domain-graph` остаётся красным из-за unrelated upstream-пакетов (`ketos-bmz`, `docs/ketos/baseline-issues.md`); собственных нарушений `ui-board` нет.

## 6. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный: 7 файлов, 40 passed |
| `pnpm exec vitest run packages/client/ui-theme/tests packages/ketos/client-locale-ru/tests` | зелёный: 12 файлов, 93 passed |
| `pnpm run test:gui` | зелёный: 385 файлов, 5466 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл passed, 1 skipped; 359 passed, 15 skipped; расхождений нет |
| `pnpm run typecheck` | зелёный: host-сборка + `tsc -b tsconfig.client.json` |
| `pnpm run lint` | зелёный: oxlint 0 warnings / 0 errors, 3606 файлов |
| `pnpm run build` | зелёный на чистом коммите `4292283`: `238 client artifact(s) with 2 public value(s)`; в `ui-theme/lib/client.js` — `ketos-brand.css` (2 вхождения), в `ui-board/lib/client.js` — `board-canvas` (13) |
| `pnpm run doc-sync` | зелёный: 34 passed, 0 failed |
| `pnpm run hygiene` | зелёный: 16 gates passed |
| `pnpm run verify-client-ui-i18n` | зелёный: 623 файла |
| `pnpm run verify-translation-pairing` | зелёный: 818 пар (включая новые ru/en пары README ui-theme, README ui-board и Agent Note) |
| `pnpm run verify-client-catalog` | зелёный: каталог актуален |
| `pnpm run verify-client-packages` | зелёный: 52 пакета |
| `pnpm run verify-cordis-config` | зелёный: 143 конфига |
| `pnpm --filter @deepseek-ai/dsh-client-ui-board bundle` | зелёный: 10 style-инъекторов (по одному на модуль) |
| Живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3185, коммит `4292283`) | ru по умолчанию; холст/сетка/карточка/светлое окно/док/миникарта/Omnibox по чек-листу §4; тёмная тема оболочки доску не меняет; Settings → English переключает подписи доски; 2 предупреждения консоли — известный `ketos-3kf`; сервер остановлен |
| `getComputedStyle` живьём | под тёмной оболочкой: `body --dsw-alias-bg-base #151517`, `.board-canvas` `#f5f5f0`, `--dsw-alias-brand-primary #b8532f`; светлое окно `#fff`/`#1c1b1f`/`#e8e6e1`; карточка `rgb(43,42,48)`, `border-width 0px`, тень начинается с волоска `rgb(58,57,64) 0 0 0 0.5px` |
| GIF-запись `record-browser-gif` | `.playwright-mcp/stage-04-gif/board-theme-i18n.gif`, 1200×750, 12.8 с, 128 кадров, 3.1 МБ; источник 13.5–28.2 с, скорость 1.5×, финальная задержка 3 с; снят с коммита `4292283`, порт 3185; storyboard, QA-кадры, `console-errors.log` и исходный WebM рядом; вызовов модели нет — окна доски остаются заглушками до этапов 6/10 |

## 7. Следующий шаг

Этап 5 — «Оконный менеджер холста» (эпик этапа 5): 8-направленный ресайз, жесты, passive-listener, GPU-трансформации; за ним этап 6 — каркас чат-окна. Предпосылки этапа 4 выполнены: визуальный язык собран в одном бренд-слое, компоненты разбиты на модули с семантическими токенами (правки стилей в этапах 5–19 не требуют трогать палитру), строки владеются словарями, поэтому новые подписи окон и меню попадают в тот же namespace. Открытые задачи, связанные с этапом: `ketos-3kf` (passive listener колеса), `ketos-e9s` (колесо над доком/омнибоксом/миникартой больше не зумит холст), `ketos-4k3` (дублирование ресайза), `ketos-0s0` (слушатели жеста при размонтировании), `ketos-1lx` (заголовки окон не перелокализуются). После приёмки агент закрывает эпик `ketos-5v2.5` в Beads и готовит worktree этапа 5 от принятой ветки.
