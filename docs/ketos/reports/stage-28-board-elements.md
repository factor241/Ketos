# Этап 28. Общая модель элементов доски и хост-документ — отчёт

Подготовка worktree (первая строка отчёта): worktree `/Volumes/Projects/Ketos bot.worktrees/stage-28` создан от принятой `stage-27-window-bezel`, `pnpm install`, `pnpm run build`, `pnpm run typecheck` и `pnpm exec vitest run packages/client/ui-board/tests` — 44 файла / 705 тестов зелёные (записано в память линии `ketos-qzb-line`).

## 1. Итог этапа

На хосте появился пакет `@ketos/board-doc`: документ доски на yjs 13.6.33 в `board.db` с журналом обновлений (`revision` = `seq`), локальными `selfId`/`docId` в SQLite, атомарными операциями элементов, сервисом `ctx.ketosBoardDoc` и маршрутами снимка, операций и SSE-потока. У Кетоса есть собственный идентификатор участника: первый снимок переписывает владельцев-демо на `selfId`, поэтому сохранённые окна принадлежат текущему участнику, а «Кирилл» показывает ту же личность. Доска рисует элементы документа под окнами одним слоем с реестром видов, общей рамкой (кромка цвета владельца, выделение одного, перемещение, изменение размера, удаление владельцем), экранной панелью выделения и общим модулем координат; миникарта, отсечение и «показать все» знают об элементах; изменения видны во всех вкладках (замер 12 мс) и переживают перезапуск. Ветка `stage-28-board-elements`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-28`; изменения не коммитились и не пушились — коммит после ответа «да» на вопрос о приёмке. Следующие этапы 29–31 добавляют только свои виды (тело, данные, панель), 32–33 — участников и синхронизацию через сервис этого этапа.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 28.1 Скелет `@ketos/board-doc` и регистрация | `ketos-qzb.3.1` | выполнен | `package.json` (yjs 13.6.33 точно), tsconfig-тройка, `Config` с девятью полями и JSDoc, строка `cordis.patch.yml` (`path: !!js dshHomePath('board.db')`), `gen-third-party-notices` (+yjs), `gen-config-catalog`, README-тройка + запись `packages/ketos/board-doc` в `SENTENCE_MODEL_EXPERIENCE`, тест композиции через Loader (2/2); `constraints`, `build`, `hygiene`, `verify-cordis-config`, `verify-third-party-notices`, `verify-tsconfig-paths`, `doc-sync` зелёные; `pnpm ketos web --dump-config` строка 415 `- id: ketos-board-doc` |
| 28.2 Хранение: `board.db`, журнал, `selfId` | `ketos-qzb.3.2` | выполнен | `schema.ts` v1 (`updates`, `meta`, `KTBD`), `db.ts` (0700/0600, WAL, `busy_timeout`, `selfId`/`docId`), `journal.ts` (загрузка `mergeUpdates`+`load`, запись `revision=seq`, сжатие одной транзакцией), отказ чужого `application_id`/новой версии; `tests/journal.spec.ts` 18 тестов, покрытие db/schema/journal 100% |
| 28.3 Документ, конверт и операции | `ketos-qzb.3.3` | выполнен | `types.ts` (бренды, конверт, `BoardOp`, коды), `kinds.ts`, `data.ts` (`mintElementId`, `validateElementData` с `assertNever`), `doc.ts` (вложенные `Y.Map`, пропуск нечитаемых с записью в журнал хоста), `ops.ts` (разбор тела, `resolveCreate`, 400/404/409/`ketos/limit`, атомарная пачка); `tests/ops.spec.ts` + `doc.spec.ts` + `data.spec.ts`, покрытие 100% (69 тестов) |
| 28.4 Сервис `ctx.ketosBoardDoc` | `ketos-qzb.3.4` | выполнен | `service.ts`: `selfId`/`docId`/`snapshot`/`apply`/`subscribe`, ленивое открытие, закрытие в `ctx.effect`; `tests/service.spec.ts` + расширение композиции (76 тестов, `service.ts` 100%) |
| 28.5 Маршруты и SSE | `ketos-qzb.3.5` | выполнен | `GET /api/ketos.board`, `POST /api/ketos.board.ops` (400/404/409/413/500), `GET /api/ketos.board.events` (snapshot → patch, `: ping`, закрытие по abort/cancel/backlog/выгрузке, 503); живая проверка cookie-потоком: `event: snapshot` → create → `event: patch` → `GET` revision 1; покрытие 100% (96 тестов) |
| 28.6 Клиент: API, срез, координаты, `selfId` | `ketos-qzb.3.6` | выполнен | `board-doc-api.ts` (SSE-разбор, переподключение с ростом паузы, закрытие скрытой вкладки, декодеры), `board-coordinates.ts` (+ перевод `culling`/`window-screen`/`store`/`safeArea`), срез стора и оптимистичные действия, `owners.ts` (реэкспорт `OwnerId`, `currentOwnerId` от `selfId`, `adoptSelfId`), подписка в `apply`, двойник `boardDoc` в `createBoardBench`; 734 теста ui-board |
| 28.7 Слой элементов и реестр видов | `ketos-qzb.3.7` | выполнен | Слоты `board.elements`/`board.element.body`/`board.element.toolbar`, `board-element-kinds.ts` (note 240×160/мин 120×80, stroke без ресайза, todo 280×240/мин 200×160), `BoardElementLayer` (порядок ранг/z/id, отсечение `CULL_MARGIN`, нейтральное тело через `fallback`), `NeutralElementBody`, миникарта с элементами и рамкой мира; `board-elements.client.spec.tsx` 6/6 |
| 28.8 Рамка и панель выделения | `ketos-qzb.3.8` | выполнен | `ElementFrame` (выделение, порог 5 px, одна операция `patch` на pointerup, снап 24 px без Alt, минимум вида через `resizeStep(..., min)`, чужой без ручек), Delete/Backspace с охранниками (`isBoardEditingTarget`, `[data-board-window]`, `[role="menu"]`, `isSelectingElement`, указатель/фокус в доске), маркер `[data-board-wheel="native"]`, `ElementSelectionBar` (экранный слой, z 150, слот toolbar); `element-frame.client.spec.tsx` 10/10, `wheel-zoom` 10/10, e2e `board-elements.e2e.ts` 4/4 |
| 28.9 Тексты и документация | `ketos-qzb.3.9` | выполнен | Ключи `element.*` (zh/en/ru, ru-keys 443), README ui-board и board-doc (тройки) с элементами/SSE/`selfId`/координатами/Delete, Agent Note `2026-10-06-ketos-board-element-document` (тройка), `gen-client-catalog`; `verify-client-ui-i18n`, покрытие `@ketos/client-locale-ru` 100%, `test:docs` 21/21, `doc-sync` 43/43; `verify-persistence-changes --json` → `"changes": []` |
| 28.10 Проверки и приёмка | `ketos-qzb.3.10` | выполнен (кроме приёмки) | Гейты §5, покрытие `@ketos/board-doc` 100%, живой проход (две вкладки 12 мс, скрытая вкладка закрывает поток за 60 с и переподключается, перезапуск сохраняет элементы, светлая/тёмная темы), GIF и отчёт; вопрос «Принимаете ли вы этап?» задан |

## 3. Критерии приёмки этапа

- [x] `@ketos/board-doc` смонтирован — `pnpm ketos web --dump-config` показывает `ketos-board-doc` с `path: $DSH_HOME/board.db`; живой проход создаёт `board.db`.
- [x] `board.db` с журналом, `selfId` и `docId` в SQLite, не в документе — `tests/journal.spec.ts` (стабильность между открытиями, `doc.share` = `['elements']`, кодированное состояние не содержит `selfId`/`docId`).
- [x] Сервис `ctx.ketosBoardDoc` — `service.ts` + тесты сервиса и композиции через Loader.
- [x] Снимок, атомарные операции (только свои из браузера) и поток SSE без утечек — `routes.spec.ts`/`events.spec.ts` (abort, cancel, backlog, dispose, 503) и живая проверка cookie-потоком.
- [x] Слой элементов под окнами с реестром видов, рамка, панель выделения, Delete с охранниками, нативное колесо — `board-elements.client.spec.tsx`, `element-frame.client.spec.tsx`, `wheel-zoom.client.spec.ts`; e2e: окно над элементом выигрывает `elementFromPoint`.
- [x] Миникарта, отсечение и «показать все» знают элементы — `board-elements.client.spec.tsx` (миникарта, отсечение), `store-elements.client.spec.ts` (`resetView` вписывает элемент без окон).
- [x] Две вкладки синхронны ≤ 1 с — e2e `board-elements.e2e.ts` (создание из первой вкладки видно во второй) и живой замер 12 мс.
- [x] Элементы переживают перезапуск — живой проход: остановка и повторный запуск `pnpm ketos web` на том же `DSH_HOME`, элемент на месте (`left 320px, top 320px`).
- [x] Покрытие пакета 100% — `pnpm exec vitest run packages/ketos/board-doc --coverage --coverage.include='packages/ketos/board-doc/src/**/*.ts'` → Statements/Branches/Functions/Lines 100% (96 тестов).
- [x] `verify-client-domain-graph`, `test:web`, `doc-sync` зелёные — §5 (`test:web`: единственные падения — известные средовые `plugin-install-github`, как на этапе 27).
- [x] GIF и отчёт на месте — `docs/ketos/reports/assets/stage-28-board-elements.gif` (1200×750, 9,3 с, 96 КБ, 6 состояний: создание через маршрут, перемещение, изменение размера, удаление, тёмная и светлая темы) и этот отчёт; GIF снят с живого сервера ветки (без модельного раунда — сценарию он не нужен), QA-кадры и видео — в `.playwright-mcp/stage-28-gif/`.

## 4. Отклонения

- **`tsconfig.client.json` (агрегат) не ссылается на client-leaf `board-doc`.** Typert-анализатор client-лица падает на host-экспорте `.` пакета, у которого есть объявление `Context` (сервис), а лист при этом не содержит `index.ts`; клиентский лист собирается транзитивно через ссылку `ui-board/tsconfig.client.json`. Это единственная поверхность регистрации, отличающаяся от списка плана.
- **`ElementSelectionBar` живёт в `src/client/` верхнего уровня, а не в `elements/`.** Верхнеуровневый файл не может импортировать домен (`verify-client-domain-graph`); панель, как и `HandleRing`, собрана из общих мест и рендерится `BoardRoot`, а слот `board.element.toolbar` объявляет панельный entry (экранный масштаб), не слой элементов.
- **Генераторы каталогов потребовали записей о новом сервисе и браузерных подпутях.** `ctx.ketosBoardDoc` внесён в `SERVICE_WALK_EXEMPTIONS` (`gen-cordis-catalog.ts`) с владельцем `packages/ketos/board-doc/README.md`; `@ketos/board-doc/kinds` и `/data` внесены в `KETOS_INLINE_SAFE` (`tsdown.client.ts`) как проверенные браузер-безопасные подпути.
- **`preview-boot.e2e.ts` принимает 404 `/api/ketos.board.events`** (поток ретраится на статическом хосте; список схлопывается `Set`), как и предполагал план.
- **`pnpm run duplication` красный на базе линии** — 4 старых клона (`WindowFrame.tsx`, `tool-card-labels.ts` ×2, `pack-ru.ts`), воспроизведено в worktree `stage-27` без изменений этапа; задача `ketos-7bs` (discovered-from 28.10). Новые файлы этапа клонов не добавили.
- **`verify-repository-references` был красным на отчёте этапа 27** (commit hash в тексте); исправлено (задача `ketos-bby`, discovered-from 28.1).
- **`test:web`**: 324/325 файлов зелёные; единственное падение — известные средовые `plugin-install-github.e2e.ts` (2 теста), зафиксированные ещё в отчёте этапа 27.
- **Upgrade guide не нужен**: `board.db` — новый файл вне каталога сессий, старые данные не меняются; `pnpm --silent run verify-persistence-changes --json` → `"changes": []`.
- **`~/.ketos` не трогали**: все живые проверки и GIF — на свежих `DSH_HOME` во временных папках.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm run typecheck` | зелёный |
| `pnpm run lint` | зелёный |
| `pnpm run test:gui` | 651 файл / 10318 тестов зелёные, 1 skipped |
| `pnpm exec vitest run packages/ketos/board-doc --coverage --coverage.include='packages/ketos/board-doc/src/**/*.ts'` | 96 тестов; Statements/Branches/Functions/Lines 100% |
| `pnpm run verify-client-domain-graph` | зелёный (82 известных upstream-нарушения исключены, `ketos-bmz`) |
| `pnpm run duplication` | красный на базе: 4 старых клона, новых нет (`ketos-7bs`) |
| `pnpm run hygiene` | 18/18 зелёных |
| `DSH_SNAPSHOT=replay pnpm run test:web` | 325 наборов: 324 зелёных, 1 красный (`plugin-install-github`, средовое); 662 теста: 644 зелёных, 2 средовых, 16 skipped |
| `pnpm run doc-sync` | 43/43 зелёных |
| `pnpm run test:docs` | 21/21 зелёных |
| `pnpm run verify-client-ui-i18n` | зелёный (1017 файлов) |
| `pnpm exec vitest run packages/ketos/client-locale-ru --coverage --coverage.include='packages/ketos/client-locale-ru/src/**/*.ts'` | покрытие 100% (ru-keys 443 ключа board) |
| `pnpm --silent run verify-persistence-changes --json` | `"changes": []` |
| Живой проход (свежий `DSH_HOME`, `pnpm ketos web`): две вкладки, curl-создание, drag/resize/Delete, темы, скрытая вкладка, перезапуск | синхронизация 12 мс; drag/resize/Delete дошли до второй вкладки; кромка светлая `rgb(229,83,61)` / тёмная `rgb(242,115,95)`; скрытая вкладка закрыла поток (запрос abort) и вернула соединение (1 → 2); после перезапуска элемент на месте |

## 6. Следующий шаг

Вопрос приёмки: «Принимаете ли вы этап?». После ответа «да» агент коммитит ветку `stage-28-board-elements` (без пуша), закрывает эпик `ketos-qzb.3` со словами «Принят», выполняет `bd backup sync`, создаёт worktree этапа 29 (`/Volumes/Projects/Ketos bot.worktrees/stage-29`, ветка от принятой `stage-28-board-elements`) и готовит его (`pnpm install`, `pnpm run build`, базовые гейты). Этап 29 регистрирует вид `note` (тело, данные, панель вида) на слотах и сервисе этого этапа; открытые вопросы этапа: панель выделения пуста до 29, у элемента нет UI-создания (только маршрут/другие плагины), порядок окна и элемента не чередуется.
