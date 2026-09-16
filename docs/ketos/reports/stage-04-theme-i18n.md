# Отчёт этапа 4. Визуальный язык: тема Harness, CSS Modules, локали

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-04-theme-i18n`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-04` (от принятой ветки этапа 3 `stage-03-slots-windows`, `c31a39c`). Отчёт переписан после реворка: пользователь отменил кетосовую палитру и потребовал рисовать доску темой и элементами DeepSeek Harness. Состояние отчёта — финальный коммит этапа (см. §6).

## 0. Доработка после реворка: чат-окно с полным composer

По требованию пользователя («в окне должны быть все элементы чата со скринов; сейчас это обрезок») этап расширен в том же worktree:

- **Сессии в окнах.** `session-bridge.ts` владеет картой `windowId → sessionId`, создаёт сессию при первом показе окна (`sessions.create()` → `open()` → `binding()`) и подписывается на `target('chat')`, `SessionSnapshot` и проекции. Окно фокусируется → сессия становится текущей (осознанный побочный эффект; закрытие окна сессию не удаляет).
- **Полный composer (`window/ComposerBar.tsx`)** повторяет референс на тех же сервисах: чипы рабочей папки и пресета агента (переключение — только у пустой сессии), `+`-меню поверх каталога команд (`remote.commands.list`) с собственным пунктом вложений, `/`-попап с подсказками и описаниями, `@`-упоминания (`fileReferences` + `sessionReferenceResolver`), чип разрешений (`/permission`, полный доступ за `RiskConfirmation`), чип модели с подменю уровня рассуждений (`ctx.modelDirectories`), чип плана, контекст-кольцо (`contextPressure`), полосы цели/задач/очереди, кнопки Send/Stop со стиром, вложения-изображения, «Открыть в основной панели».
- **Мост — это и контрольная плоскость:** строка списка сессий (cwd/blank/preset), проекции, модельный каталог, каталог команд, роспись пресетов (лок. через общий `@deepseek-ai/dsh-agent-presets/display`) и причина блокировки композера подписываются по окну и публикуются в один channel; все мутации — через инжектированные колбэки.
- **Тесты:** `tests/conversation-body.client.spec.tsx` (создание сессии, ошибка, лента, стриминг, отправка, стир, стоп, Shift+Enter, загрузка старых ходов, чипы разрешений/контекста/очереди), `tests/fixtures.client.ts` (bench с дублями sessions/remote/modelDirectories/layout), обновлённые `slots`/`apply`/`roster`/`open-window` спеки.
- **Проверки:** `pnpm exec vitest run packages/client/ui-board/tests` — 8 файлов, 49 passed; `pnpm run test:gui` — 386 файлов, 5475 passed, 1 skipped; `DSH_SNAPSHOT=replay pnpm run test:web` — 101 файл passed, 359 passed / 15 skipped; `pnpm run lint`, `typecheck`, `doc-sync` (34), `hygiene` (16), `verify-client-packages`, `verify-module-graph`, `verify-client-ui-i18n`, `verify-translation-pairing`, `verify-client-catalog` (регенерирован) — зелёные. Живьём проверены чипы, `+`-меню, `/`-меню, смена разрешения (команда доходит до хоста и проекция обновляется), вложение-картинка с активацией отправки и отправка промпта в реальную сессию; GIF — `.playwright-mcp/stage-04-gif/board-window-composer.gif` (1200×750, 19.4 с, 194 кадра, 2.2 МБ; источник 6.5–36.0 с, скорость 1.8×, финальная задержка 3 с; 0 ошибок консоли; модельных вызовов нет — чистый дом без провайдера).

## 1. Итог этапа

Доска перестала быть отдельным визуальным островом. Палитра — только семантические алиасы `ui-theme` (никаких оранжевых/кремовых override-слоёв): холст на `--dsw-alias-bg-base`, окна и док — по рецепту плавающей панели (`bg-layer-2` + `border: 0` + `--dsw-elevation-prominent` + перебиндовка `--dsw-elevation-stroke-color`), фокус — `--dsw-alias-state-business-primary`, разделители — 0.5px-волоски, скролл-пары l2. Хром собран из элементов Harness: иконки `ui-primitives`, `Tooltip` на каждом иконочном контроле, `Menu` для Action Menu, `Tag` для статус-капсул; цветной «светофор» и эмодзи удалены. Мок-контент (фейковые модели, system prompt, тумблеры коннекторов) удалён вместе с ключами словарей, ru-корпусом и манифестом; `board.window.body` теперь предоставляет только `conversation`. Компоненты доски остались разбиты на CSS Modules с инлайном только для геометрии и вычисляемых pan/zoom-переменных; в `packages/client/ui-board/src` нет ни одного литерального цвета. Гейты этапа зелёные.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 4.1 Токены темы | `ketos-5v2.5.1` | выполнен | `ui-theme` снова 6 листов (`ketos-brand.css` удалён, порядок закреплён в `client-styles.client.spec.ts`); grep по `ui-board/src` — 0 hex/rgba; точка сетки — `--dsw-alias-border-l3`; `getComputedStyle` живьём в обеих темах |
| 4.2 CSS Modules и хром из Harness | `ketos-5v2.5.2` | выполнен | 9 модулей; `ui-primitives` (иконки, `Tooltip`, `Menu`, `Tag`); инлайн — только `left/top/width/height/zIndex` и `--board-pan-*`/`--board-zoom`/`--board-grid-*`; `pnpm --filter @deepseek-ai/dsh-client-ui-board bundle` собирает 9 style-инъекторов |
| 4.3 Локализация | `ketos-5v2.5.3` | выполнен | `src/client/locale.ts` (zh/en, 23 ключа), `board-ru.ts`, `tests/fixtures/ru-keys.json`; `verify-client-ui-i18n` (622 файла) и `verify-translation-pairing` зелёные; живьём ru → Settings → English |
| 4.4 Гейты и визуальная приёмка | `ketos-5v2.5.4` | выполнен | `canvas`/`apply`/`slots`/`roster`/`open-window`/`inspector` спеки обновлены (39 passed); `test:gui` 385 файлов; snapshot replay без расхождений; чек-лист §4 заполнен; GIF существует |

## 3. Критерии приёмки этапа

- [x] **Палитра — из DeepSeek Harness, без оранжевого.** В `ui-board/src` нет ни одного литерального цвета; все правила — `--dsw-*`-алиасы; `grep` не находит `ketos-brand`, `board-canvas`, `data-board-surface`. Живьём: в светлой теме доска светлая, в тёмной — тёмная (одна и та же композиция).
- [x] **Элементы доски — из Harness.** Иконки `ui-primitives` вместо эмодзи/самодельных глифов; `Tooltip` на dock-строках, закрытии окна, composer-действии и отправке; Action Menu — `Menu` (портал, `selection="fill"`); статус-капсулы — `Tag` (`success`/`neutral`); фокус-ринги — конвенция Harness. Пустой `Button`/`Switch`/`StateDot` не подключены осознанно (см. §5).
- [x] **Настройки и окно — из Harness.** Мок-панель Settings (фейковые модели, system prompt) и мок-панель Connectors (три фейковых тумблера) удалены вместе с таб-полосой, кнопкой дока, пунктом меню, ключами `tool.*`/`menu.connectors`/`rail.addConnectors`/`canvas.connectorsTitle`/`canvas.messageSent` и ru-переводами; новых заглушек нет. Цветной «светофор» заменён одной кнопкой закрытия (`IconCloseOutline16`); меню `•••` — этап 6 по плану.
- [x] **Стили — модульные, инлайн только геометрия/переменные.** JSDoc `DashboardCanvas` фиксирует правило; 9 модулей рядом с компонентами; `clsx` в условных состояниях (фокус окна, активная строка дока, открытое меню, готовность отправки, agent/tool-заливка прямоугольника).
- [x] **Типы модулей работают при сборке** — `src/css-modules.d.ts` в порядке `*.module.css` → `*.css`; `tsc -b tsconfig.client.json` зелёный; бандл собирает CSS.
- [x] **Локализация.** zh/en — словари пакета, ru — корпус `@ketos/client-locale-ru`; `verify-client-ui-i18n` и `verify-translation-pairing` зелёные; переключение языка проверено живьём (ru по умолчанию; Settings → English меняет подписи доски).
- [x] **Гейты.** `pnpm run test:gui` 385 файлов / 5465 passed / 1 skipped; `DSH_SNAPSHOT=replay pnpm run test:web` без расхождений; `typecheck`, `lint`, `build`, `hygiene`, `doc-sync`, `verify-client-catalog` (после `gen-client-catalog`), `verify-client-packages`, `verify-cordis-config` зелёные.
- [x] **Визуальная приёмка и GIF** — чек-лист §4 заполнен; `.playwright-mcp/stage-04-gif/board-harness-theme.gif`.

## 4. Визуальная приёмка (чек-лист)

Наблюдение — живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3185) с дерева финального коммита после `pnpm run build`; кадры в `.playwright-mcp/stage-04-gif/qa/` (светлая и тёмная темы).

| Элемент | Наблюдение | Кадр |
|---|---|---|
| Холст и сетка | поверхность темы (`bg-base`) с точечной сеткой на `border-l3`, видима в обеих темах; зум масштабирует точку и шаг | `01-board-light.png`, `07-board-dark.png` |
| Карточка агента | поверхность `bg-layer-2` с elevation-штрихом; фокус — бизнес-синий; иконка закрытия, `Tag success` «Готово», `Tag neutral` «Изучено»; composer на `specific-input-major` | `02-agent-window.png` |
| Второе окно | та же панельная рецептура, что и у карточки (один хром на все типы) | `03-second-window.png` |
| Док | панель `bg-layer-2`, строки-иконки (`IconAgentPresetOutline16`), `Tooltip` с заголовком, активная строка на `markdown-tag`, reset — `IconFullscreenOutline16` | `04-dock-tooltip.png` |
| Omnibox | composer-рецепт (`specific-input-major` + `elevation-soft` + r22), меню `Menu` с иконками, кнопка отправки на `button-info-fill` | `05-action-menu.png`, `06-sent.png` |
| Инспектор | пунктирная рамка `state-business-primary`, капсула `bg-layer-3` + `IconCloseOutline16` | `08-inspector.png` |
| Тема | светлая и тёмная темы: доска следует палитре, оранжевого нет | `01-board-light.png` / `07-board-dark.png` |
| Язык | ru по умолчанию; Settings → English → подписи доски английские | `09-board-english.png` |

Референс OpenSwarm: каталог `docs/ketos/reference/` в репозитории отсутствует; сверка велась по палитре/композиции и по живым кадрам. Прежний «кетосовский» вид (кремовый холст, тёмные карточки) отменён пользователем осознанно — доска теперь следует теме Harness.

## 5. Отклонения

- **Отмена §4.8 плана и `AUDIT_REPORT.md` (97, 186–188).** План требовал объявить палитру Кетос бренд-слоем в `ui-theme` на селекторе `.board-canvas` и держать «доску в своей палитре Кетос»; пользователь отменил это требование. Решение записано новой Agent Note («доска использует общую тему и контролы Harness»), старая заметка о бренд-слое переведена в `archived/architecture/` (полное замещение, кросс-ссылки починены, печать архивного гейта пройдена).
- **`inject` остаётся `['slots', 'locale']`.** План предписывал «проверить `inject = ['slots', 'layout', 'locale']`»; доска не читает сервис `layout` — регистрация в `main` ждёт декларацию слота, а не сервис, как и у ui-conversation.
- **Мок-панели удалены, а не перекрашены.** Реальных полей (модель, пресет, cwd) в этапе 4 нет: их источники — `ctx.modelDirectories`, `remote.session.modelCatalog/selectModel`, `remote.agentPresets.*` — принадлежат этапам 11/13, а секции настроек Harness нельзя смонтировать вне панели, которая их объявляет; клиентского редактора system prompt в Harness нет вовсе. `WindowKind`/`WindowBodyKind` и регистрации кадров сохранены, но ни один вход не открывает пустые окна.
- **Одна кнопка закрытия вместо меню `•••`.** Меню «закрыть/свернуть/дублировать» — задача подэтапа 6.1 плана; этап 4 ограничился заменой цветного светофора на иконочный контрол.
- **Цвета без прямых алиасов получили семантическое соответствие:** мини-карта — `state-business-primary` (агент) и `label-caption` (прочее), фрустум — бизнес-тинт; статус-капсулы — `Tag` (`success`/`neutral`). Новых `--dsw-*`-токенов и бренд-переменных не добавлено; точка сетки больше не исключение — она на `border-l3`.
- **`ui-primitives` подключён, но не целиком.** Использованы 10 иконок (`IconCloseOutline16`, `IconPlusOutline16`, `IconFullscreenOutline16`, `IconAgentPresetOutline16`, `IconBrowseOutline16`, `IconPaperclipOutline16`, `IconGlobeOutline14`, `IconInspectOutline12`, `IconSparkle16`, `IconSendOutline16`), `Tooltip`, `Menu`, `Tag`. `Button` не подходит для круглых иконочных контролов (в каталоге нет icon-only варианта — это зафиксированное ограничение пакета), `Switch` и `StateDot` остались без потребителя после удаления мок-контента. Пакет уже был в devDependencies доски — новых зависимостей не добавлено.
- **Каталог слотов регенерирован.** `gen-client-catalog` обновил `slot-catalog.ts`: `board.window.body` теперь сообщает один занятый ключ (`conversation`) и один occupant.
- **ru-манифест обновлён вручную.** `sync-dictionaries.mjs` требует корпус community-пака (`--corpus`, `--community`), недоступный офлайн; ключи namespace `board` в `tests/fixtures/ru-keys.json` приведены к новому набору тем же правилом, что применяет скрипт (ключи словаря = ключи корпуса), и спек `locale-ru` это подтверждает.
- **Поведенческое следствие реворка:** «тёмная карточка» больше не тёмная в светлой теме — окна следуют поверхности темы. Это и есть требование пользователя; в README это отражено как свойство, а не как ограничение.
- **Латентный дефект типов CSS Modules исправлен по ходу** (порядок ambient-деклараций в `src/css-modules.d.ts`), иначе модули не типизировались.
- **Открытые пробелы:** `ketos-1lx` (заголовки окон не перелокализуются), `ketos-3kf` (passive-listener колеса — этап 5.1), `ketos-e9s`, `ketos-4k3`, `ketos-0s0`; базовые проблемы (`verify-client-domain-graph` по unrelated upstream-пакетам, `ketos-bmz`).

## 6. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный: 7 файлов, 39 passed |
| `pnpm exec vitest run packages/client/ui-theme/tests packages/ketos/client-locale-ru/tests` | зелёный: 12 файлов, 93 passed |
| `pnpm run test:gui` | зелёный: 385 файлов, 5465 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл passed, 1 skipped; 359 passed, 15 skipped; расхождений нет |
| `pnpm run typecheck` | зелёный: host-сборка + `tsc -b tsconfig.client.json` |
| `pnpm run lint` | зелёный: oxlint 1.76.0, 0 diagnostics на 3605 файлах |
| `pnpm run build` | зелёный на чистом дереве финального коммита: `238 client artifact(s)` |
| `pnpm run doc-sync` | зелёный: 34 passed |
| `pnpm run hygiene` | зелёный: 16 gates passed |
| `pnpm run verify-client-ui-i18n` | зелёный: 622 файла |
| `pnpm run verify-translation-pairing` | зелёный: пары консистентны (README/заметки перезаписаны) |
| `pnpm run verify-client-catalog` | зелёный после `gen-client-catalog` (body-ключи доски: `conversation`) |
| `pnpm run verify-client-packages` | зелёный: 52 пакета |
| `pnpm run verify-cordis-config` | зелёный: 143 конфига |
| `pnpm run verify-archived-agent-notes` | зелёный: 1887 артефактов, 3 новых печати |
| `pnpm --filter @deepseek-ai/dsh-client-ui-board bundle` | зелёный: 9 style-инъекторов |
| Живой `pnpm ketos web` (scratch `DSH_HOME`, порт 3185) | холст/сетка/окно/док/омнибокс/миникарта/инспектор по чек-листу §4 в светлой и тёмной темах; ru и en; консоль без ошибок (два известных предупреждения `ketos-3kf`); сервер остановлен |
| GIF-запись `record-browser-gif` | `.playwright-mcp/stage-04-gif/board-harness-theme.gif` — 1200×750, 14.7 с, 147 кадров, 3.2 МБ; источник 9.5–30.6 с, скорость 1.8×, финальная задержка 3 с; снят с финального коммита, порт 3186; storyboard, QA-кадры (`qa/01-board-light.png` … `qa/09-board-english.png`), `console-errors.log` и исходный WebM рядом; вызовов модели нет (окна доски — заглушки до этапов 9/10) |

## 7. Следующий шаг

Этап 5 — «Оконный менеджер холста» (жесты, passive-listener, GPU-трансформации), затем этап 6 — каркас чат-окна (в том числе меню `•••`). Предпосылки выполнены: палитра и контролы общие с Harness, поэтому правки стилей в этапах 5–19 не задевают доску как исключение, а новые окна наследуют хром; строки по-прежнему владеются словарями. После приёмки агент закрывает эпик `ketos-5v2.5` в Beads и готовит worktree этапа 5 от принятой ветки.
