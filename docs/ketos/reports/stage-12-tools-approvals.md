# Отчёт этапа 12. Инструменты и разрешения в ленте

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-12-tools-approvals`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-12` (от принятой ветки этапа 11 `stage-11-presets-models`; подготовительный коммит `bc80f61`). План этапа — `ketos_v7_master_plan/stage-12-tools-approvals.md` (ревизия 17); задачи — Beads `ketos-5v2.13.1`–`ketos-5v2.13.4`, эпик `ketos-5v2.13`.

**Демонстрация (живой прогон).** Живой сервер `pnpm ketos web --port 3195` против scratch-дома `DSH_HOME=/tmp/ketos-stage12-home` с `DEEPSEEK_API_KEY=dummy` и `DEEPSEEK_BASE_URL=http://127.0.0.1:3998` — локальная OpenAI-совместимая SSE-заглушка этапа (`.playwright-mcp/stage-12-tools/sse-stub.mjs`, не в git: каталог этапа gitignored), поэтому ходы исполняются реальным host-набором инструментов (tool-fs, tool-fs-search, tool-bash) под пресетом `standard`. Машиночитаемые проверки — `.playwright-mcp/stage-12-tools/audit/audit.json`, вердикт — `audit-verdict.json` `{ total: 14, failed: [], ok: true, aborted: false }`; кадры — `qa/12-tool-cards.png`, `qa/12-tool-cards-top.png`, `qa/12-cards-fullscreen.png`, `qa/12-diff-todo-error.png`, `qa/12-approval-banner.png`. Живой прогон дал точный код отмены (`AbortError`/`ABORTED`), который лента раньше считала обычной ошибкой (исправлено), и подтвердил все критерии этапа.

## 1. Итог этапа

Лента окна перестала быть однострочной: каждый вызов инструмента рендерится карточкой на общих блоках `ui-primitives` — `TerminalBlock` для shell, `ReadBlock` для чтения, `DiffBlock` для правок, `SearchBlock` для поиска, `WebBlock` для веб-результатов, списочные карточки для `todo_write`/`read_image`/`ask_user_question`, `JsonBlock` для всего, что таблица не покрывает. Идущий вызов показывает команду (или намеренный diff) и секунды выполнения, а по завершении — состояние успеха, ошибки с локализованной строкой и текстом провайдера, либо «остановлено» для отменённого вызова. Подтверждение больше нельзя потерять: pending approval/question сессии окна рисует баннер «Требуется подтверждение» с кнопкой «Открыть в основной панели», композер окна на это время инертен, а при возвращении на доску окно-источник поднимается и коротко подсвечивается. Решение этапа — Agent Note [2026-09-20-ketos-board-tool-cards-approvals.md](../../../.agents/notes/implemented/architecture/2026-09-20-ketos-board-tool-cards-approvals.md).

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 12.1 Презентационные карточки tool-узлов | `ketos-5v2.13.1` | выполнен | `window/tool-card-model.ts` (таблица «имя → блок», толерантные читатели с `null`-фолбэком) + `window/ToolCard.tsx` (карточка, статусная строка, elapsed-секунды) + `window/tool-card-labels.ts` (локализованные подписи блоков); `ToolRow`/`ToolRow.module.css` удалены, лента читает `chat.legacy.runningCalls` напрямую; канал окна потерял проекцию `BoardRunningCall`/`runningCalls` (единственный потребитель ленты, второй источник не нужен). Тесты — `tests/tool-card.client.spec.tsx` (50 кейсов: по блоку на инструмент, каждая ветка отказа, JSON-фолбэк, картинка, ошибка, отмена, тикающие секунды); живой прогон — bash/read/diff/search/todo/error/стоп (см. ниже) |
| 12.2 Обнаружение и обработка подтверждений | `ketos-5v2.13.2` | выполнен | `ConversationBody` читает корневой `useSessionPendingInteraction` (через `PropsRuntime`, без inject `uiSession` — как `ui-workspace`), рисует баннер с локализованным титулом по `kind` (approval/question/plan-review/other) и блокирует композер титулом баннера; действие — injected `openInMainPanel(windowId)` → `bridge.sessionFor` → `ctx.uiWorkspace.openSession(sessionId)` + `store.expectReturnWindow`; `BoardRoot` по `usePanelInfo` (`BOARD_PANEL_ID`) центрирует вернувшееся окно и включает подсветку (`WindowFrame.returned`, `RETURN_HIGHLIGHT_MS`). Тесты — `tests/conversation-body.client.spec.tsx` (баннер, блокировка, навигация, титулы по видам, чужой session не баннерится), `tests/store.client.spec.ts` (действия возврата/подсветки и guard'ы), `tests/slots.client.spec.tsx` (сквозной путь в композиционном стенде); живой прогон — sandbox-эскалация: баннер → основная панель с «Разрешить один раз» → возврат с подсветкой → запись исполнена |
| 12.3 Состав инструментов окна | `ketos-5v2.13.3` | выполнен | Живой прогон из окна доски: `bash` (pwd+маркер), `read` (package.json, `json`-подсветка, 226 строк), `grep` (22 совпадения в 15 файлах), `write` (diff + файл на диске), `todo_write`, ошибочный `read` (`FS_NOT_FOUND`); тот же session в основной Conversation-панели показывает те же 8 вызовов (`data-chat-call-id` 1–8) и те же тексты. Список MVP-инструментов — §«Состав инструментов окна» ниже |
| 12.4 Ошибки, длительные вызовы, отмена | `ketos-5v2.13.4` | выполнен | Карточка ошибки: локализованное «ошибка» + `error.name` (деталь) + текст провайдера в `<pre>` с высотой-капом; долгий вызов — «выполняется · N с» с локальным таймером (живой прогон: 0 с → 2 с); отмена — «bash остановлено» по кодам `ABORTED`/`interrupted`, ход завершается `aborted`; лента не прыгает при завершении длинного вызова (автоскролл только у нижней кромки — существующее поведение, проверено). Тесты — `tests/tool-card.client.spec.tsx` (ошибка с деталью и без, отмена обоими кодами, тиканье), `tests/conversation-body.client.spec.tsx` (running → stopped без ремоунта) |

### Состав инструментов окна (MVP)

Набор карточек выведен из фактических keyed-видов `ui-tool` и живого прогона; окно не добавляет собственных инструментов и не меняет глобальный набор (его определяет пресет сессии — в web-профиле по умолчанию `standard`):

| Инструмент | Карточка | Источник |
|---|---|---|
| `bash`, `pwsh`, `terminal_send` | `TerminalBlock` | keyed-вид `bash`, общий путь `pwsh`/`terminal_send` |
| `read` | `ReadBlock` | keyed-вид `read` |
| `write`, `edit` | `DiffBlock` | keyed-вид `edit`/`write` |
| `str_replace_editor` | `DiffBlock` (намеренный hunk из аргументов) | своего keyed-вида нет (в `ui-tool` уходит в Generic) |
| `grep`, `glob` | `SearchBlock` | keyed-вид `grep`/`glob` |
| `web_search`, `web_fetch` | `WebBlock` | keyed-вид `web_search`/`web_fetch` |
| `read_image` | превью изображения через session-авторизованный загрузчик | keyed-вид `read_image` (галерея `tool.call.images`) |
| `todo_write` | список задач | keyed-вид `todo_write` |
| `ask_user_question` | пары «вопрос → ответ» | keyed-вид `ask_user_question` |
| всё прочее (включая `skill`, `present`, `cordis_*`, `goal`-инструменты) | `JsonBlock` | generic-фолбэк |

Покрытие сверено с `packages/client/ui-tool/src/client/apply.ts` (ключи `bash`, `read`, `read_image`, `edit`, `write`, `grep`, `glob`, `web_search`, `web_fetch`, `todo_write`, `ask_user_question`). Инструменты, требующие UI-композера главной панели (`ask_user_question`), в MVP-сценарии обрабатываются баннером 12.2: окно показывает транскрипт уже отвеченного вопроса, а сам вопрос отвечается в основной панели. `tool-cordis` (Creator Mode) для доски не требуется.

## 3. Критерии приёмки этапа

- [x] Пять типов карточек рендерятся — живой прогон: `TerminalBlock` (bash), `ReadBlock` (read), `DiffBlock` (write), `SearchBlock` (grep), `WebBlock` (каталог web-инструментов; юнит-тесты на search/fetch-формы), плюс `JsonBlock`-фолбэк, todo-карточка и карточка ошибки; тесты `tests/tool-card.client.spec.tsx` зелёные.
- [x] Pending approval всегда доступен через баннер-навигацию — живой прогон sandbox-эскалации: баннер «Требуется подтверждение» + кнопка «Открыть в основной панели» → главная панель с «Отклонить»/«Разрешить один раз» → возврат с подсветкой окна → запись исполнена; тесты баннера, блокировки композера и навигации; Known Limitation описывает отсутствие встроенного approval-UI.
- [x] Базовые инструменты работают из окна — read/grep/write/bash исполнены из окна доски (см. 12.3), результаты корректны (файл на диске, найденные совпадения, вывод команды).
- [x] Ошибки и отмены корректны — карточка ошибки с локализованным текстом и деталью; отмена переводит карточку в «остановлено», ход — в `aborted`; окно остаётся отзывчивым (лента не прыгает, композер жив).
- [x] Тесты зелёные — `pnpm exec vitest run packages/client/ui-board/tests` (27 файлов, 378 passed), `packages/ketos/client-locale-ru` (корпус ru дополнен), `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web` (см. §5).
- [x] Коммит этапа содержит Agent Note — [2026-09-20-ketos-board-tool-cards-approvals.md](../../../.agents/notes/implemented/architecture/2026-09-20-ketos-board-tool-cards-approvals.md) (+ zh, i18n-пара).
- [x] Задачи Beads 12.1–12.4 закрыты по критериям (закрываются вместе с коммитом этапа).

## 4. Отклонения

- **Доска не переиспользует компоненты `ui-tool`.** Слот `tool.call.toolview` объявлен со `scope: 'session'`, а доска рендерит из root-scope, где нет session-биндинга для произвольного окна; правило feature-плагинов запрещает runtime-импорт значений другого feature-плагина. Поэтому таблица карточек реализована локально на общих `ui-primitives`-блоках, а покрытие сверено с keyed-видами `ui-tool` (список выше). Вынос моделей в общий пакет отклонён для MVP (единственный потребитель, намеренно более узкая таблица) и зафиксирован в Agent Note как кандидат при втором потребителе.
- **`str_replace_editor` рисуется diff'ом и у завершённого вызова.** У `ui-tool` keyed-вида нет, а его generic-путь для settled-вызова diff не показывает; доска выводит намеренный hunk из аргументов (`create`/`str_replace`), а `view`/неизвестная команда уходят в JSON. Отличие от `ui-tool` осознанно: окно показывает то, что модель собиралась изменить.
- **Проекция `BoardRunningCall`/`runningCalls` удалена из канала окна.** Лента была её единственным потребителем, а для карточки нужны `argsRaw` и `time` полного `RunningToolCall`; источник — `chat.legacy.runningCalls` снапшота (одна проекция вместо двух).
- **Код отмены уточнён живым прогоном.** План называл признаком остановки только синтезированный `interrupted`; host логирует `AbortError`/`ABORTED` (проверено в session-логе и UI), поэтому «остановлено» теперь покрывает оба кода, а прочие ошибки остаются «ошибкой» (`FsError`/`FS_NOT_FOUND` в живом прогоне).
- **Индикатор подтверждения — баннер с навигацией, а не inline-поверхность.** Осознанный компромисс MVP из плана: отвечающий composer живёт в основной панели, окно не дублирует approval/question-UI; композер окна блокируется титулом баннера, возврат подсвечивает окно-источник. Записано в Known Limitations README.
- **Ключ `usePanelInfo` вместо собственного сигнала видимости.** Возврат к доске определяется активным id панели доски (`BOARD_PANEL_ID` = ключ регистрации `main`), это штатный root-хук ui-layout; собственная подписка на видимость не заводилась.
- **Покрытие `ui-board` — исключение MVP-форка.** `pnpm run test:coverage` для доски не запускался (политика MVP-форка в `vitest.config.ts`), как на этапах 3–11; карточки покрыты поведенческими тестами.
- **Скриптовый аудит `.playwright-mcp` не расширялся как `audit.mjs`.** §4.10 требует скриптовый аудит для этапов, меняющих геометрию, шкалу или слои; этап их не меняет. Живая проверка выполнена браузерным прогоном с машинными проверками (`audit.json`, 14 проверок `ok: true`) и кадрами, как на этапах 9–11; GIF не записывался, PR ещё не создавался.
- **Новых пакетов нет.** Манифесты и ростер не менялись; `pnpm run doc-sync`, `pnpm run build`, `pnpm run hygiene` прогнаны (см. §5).
- **Наблюдение по логу консоли.** При перезагрузке страницы после HMR-пересборки бандла доски один раз зафиксирована ошибка `[session-controller] event feed subscriber failed: … trajectory-tool-call… received more than one start Match` — это траекторный ассемблер upstream (не доска); в чистом прогоне без HMR не повторяется. Зафиксировано здесь как наблюдение, кода этапа не касается.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный; 27 файлов, 378 passed (было 373 после этапа 11; новый файл `tests/tool-card.client.spec.tsx` — 50 кейсов) |
| `pnpm exec vitest run packages/client/ui-board/tests packages/ketos/client-locale-ru` | зелёный; 28 файлов, 389 passed; корпус `ru-keys.json` дополнен 31 ключом (239 в `board`) |
| `pnpm run test:gui` | зелёный; 405 файлов, 5809 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный; 101 файл passed | 1 skipped, 359 passed | 15 skipped (доска не входит в веб-снапшот-харнесс, как на этапах 9–11; видимые изменения подтверждены живым прогоном с кадрами) |
| `pnpm run typecheck` | зелёный; 0 ошибок TS |
| `pnpm run lint` | зелёный; 0 ошибок oxlint |
| `pnpm run duplication` | зелёный; 0 клонов |
| `pnpm run doc-sync` | зелёный; 34 гейта passed, 0 failed (включая translation pairing: 831 пара, README и Agent Note перезаписаны) |
| `pnpm run build` | зелёный; 238 клиентских артефактов |
| `pnpm run hygiene` | зелёный; 16 гейтов passed, 0 failed |
| Живой прогон: `pnpm ketos web --port 3195` + SSE-заглушка | зелёный; 14 проверок `ok: true` в `audit.json` (bash/read/diff/search/todo/error, тикающие секунды, отмена→«остановлено», баннер подтверждения, блокировка композера, навигация и возврат, исполнение эскалации, паритет с основной панелью) |
| `.playwright-mcp/stage-12-tools/audit/audit-verdict.json` | `{ total: 14, failed: [], ok: true, aborted: false }`; кадры `qa/12-tool-cards.png`, `qa/12-tool-cards-top.png`, `qa/12-cards-fullscreen.png`, `qa/12-diff-todo-error.png`, `qa/12-approval-banner.png` |

## 6. Следующий шаг

После приёмки: эпик `ketos-5v2.13` закрывается, worktree этапа 13 (`stage-13-workdir-artifacts`) создаётся от принятой ветки `stage-12-tools-approvals` и подготавливается (`pnpm install`, сборка, базовые гейты). Этап 13 использует карточки этого этапа как источник артефактов: `DiffBlock`/`ReadBlock` дают производные «путь + тип изменения» для списка артефактов сессии. Открытые наблюдения для следующих этапов: отсутствие inline approval-UI в окне (осознанно, при необходимости — этап 20/кросс-ревью), траекторная ошибка `received more than one start Match` при HMR (upstream, воспроизводится без изменений доски), и статусы окон в доке по-прежнему четырёхзначные (этап 7.1).
