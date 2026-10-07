# Этап 31. Туду-листы на Beads

## 1. Итог этапа

Этап выполнен в worktree `/Volumes/Projects/Ketos bot.worktrees/stage-31`, ветка `stage-31-todo-beads` от принятой `stage-30-brush`; подготовка worktree (`pnpm install`, `pnpm run build`, `pnpm run typecheck`, `pnpm exec vitest run packages/client/ui-board/tests`) — зелёная до начала правок. Туду-лист создаётся командой `/todo <название>` и из меню «+», живёт эпиком в базе Beads Кетоса (`$DSH_HOME/beads/.beads`), пункты добавляются и отмечаются на доске с анимацией, а `bd list --parent <эпик>` показывает те же пункты и статусы; `bd` 1.3.1 закреплён в стенде по контрольной сумме с выключенной телеметрией. Коммита нет — по правилам линии он делается после ответа «да».

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 31.1 Закрепить `bd` в стенде | `ketos-qzb.6.1` | выполнен | `docker compose -f docker/stand/compose.yaml build ketos-a` зелёный; `exec ketos-a bd version` → `1.3.1`; `sh -c 'echo $BD_DISABLE_METRICS $DO_NOT_TRACK'` → `1 1`; LICENSE в `/usr/local/share/doc/beads/LICENSE` |
| 31.2 Пакет `@ketos/board-todo` и регистрация | `ketos-qzb.6.2` | выполнен | `pnpm run build`, `pnpm run hygiene` (18/18), `pnpm run verify-cordis-config` (213 файла), `pnpm run doc-sync` (43/43); тест композиции через Loader |
| 31.3 Обёртка `bd` | `ketos-qzb.6.3` | выполнен | `pnpm exec vitest run packages/ketos/board-todo` — 62 теста, покрытие 100% (включая `beads.ts`); опциональный `beads.real.spec.ts` прошёл на локальном `bd` 1.2.2 |
| 31.4 Вид `todo` в документе | `ketos-qzb.6.4` | выполнен | `packages/ketos/board-doc/tests/todo.spec.ts`; покрытие `board-doc` 100% |
| 31.5 Маршрут туду-листа | `ketos-qzb.6.5` | выполнен | `tests/routes.spec.ts` (включая гонку `place`: 200 + 409); покрытие `routes.ts` 100% |
| 31.6 Команда `/todo` | `ketos-qzb.6.6` | выполнен | `tests/todo-command.host.spec.ts` (регистрация/снятие, пустой ввод, пара `command/run`/`command/done`); в браузере палитра композера показывает «Туду-лист» и «Добавить туду-лист на доску» |
| 31.7 Создание из меню «+» и размещение | `ketos-qzb.6.7` | выполнен | `tests/todo-placement.client.spec.ts`, `tests/dock.client.spec.tsx`; живой прогон: «+» → «Туду-лист» → «Покупки» в центре; `pendingPlacement` размещает первый видимый таб |
| 31.8 Элемент туду-листа и анимация | `ketos-qzb.6.8` | выполнен | `tests/todo-element.client.spec.tsx` (прогресс, оптимистичная отметка с откатом, «Готово», чужой список только чтение, поле/обновление, guard жеста рамки); GIF; `bd list` совпадает с доской |
| 31.9 Тексты, проверки и приёмка | `ketos-qzb.6.9` | выполнен (кроме приёмки) | ключи zh/en/ru (ru-keys 479), README-тройки, Agent Note-тройка, все гейты §5, GIF и этот отчёт |

## 3. Критерии приёмки этапа

- [x] `bd` 1.3.1 закреплён в стенде по контрольной сумме, телеметрия выключена — сборка образа зелёная, `bd version` = 1.3.1, `BD_DISABLE_METRICS=1`/`DO_NOT_TRACK=1`, LICENSE сохранён (31.1).
- [x] `@ketos/board-todo` смонтирован — строка `ketos-board-todo` в `packages/bundle/web-app/cordis.patch.yml` с явными ключами, пакет в `web-app/package.json`, каталог Config сгенерирован, тест композиции через Loader зелёный.
- [x] Обёртка `bd` без shell, в очереди, с проверкой версии и разбором обеих версий — `tests/beads.spec.ts` (argv с `--title=`, env каждого вызова, очередь, повтор при `exclusive lock`, тайм-аут, фикстуры 1.2.2 и 1.3.1, отказ 1.1.0/2.0.0); покрытие 100%.
- [x] `/todo` и «+» создают список в центре видимой области — живой прогон в стенде: `/todo Подготовка договора` → список в центре, размещённый табом; «+» → «Туду-лист» → «Покупки» в центре (GIF, кадры 8–36.5 с).
- [x] Пункты добавляются и отмечаются с анимацией; при «уменьшить движение» движения нет — `TodoItemRow` (SVG-галочка, зачёркивание, FLIP, `transform: scaleX()`), `@media (prefers-reduced-motion: reduce)` отключает переходы; в GIF виден переезд пункта в «Готово» и прогресс «1 из 2».
- [x] Чужой список только читается — `tests/todo-element.client.spec.tsx`: у чужого нет чекбоксов, поля и «Обновить»; маршрут отвечает 409 `ketos/not-owner` без единого вызова `bd`.
- [x] `bd list` по базе Кетоса совпадает с доской — `BEADS_DIR=/data/ketos/beads/.beads BD_DISABLE_METRICS=1 bd list --parent kt-5oy --all --limit 0 --json` даёт `Проверить смету` (closed) и `Согласовать правки` (open), как на доске; `Покупки` — эпик `kt-7th`.
- [x] Покрытие `board-todo` и `board-doc` 100% — совместный прогон: 100% statements (1009), branches (522), functions (201), lines (865).
- [x] Гейты зелёные — §5.
- [x] GIF, Agent Note и отчёт — `docs/ketos/reports/assets/stage-31-todo-beads.gif`, `.agents/notes/implemented/architecture/2026-10-06-ketos-board-todo-beads.md` (+ `.zh.md`, `.i18n.yaml`), этот отчёт.

## 4. Отклонения

- **`TodoCreatePopover` живёт в `dock/`, а не в `elements/`.** Гейт `verify-client-domain-graph` запрещает домену `dock` импортировать `elements`; поповер — экранная обвязка кнопки «+», поэтому перенесён в `dock/TodoCreatePopover.tsx`, README `ui-board` описывает его там же.
- **Dockerfile стенда: `tar` получил `-f /tmp/bd.tgz`.** Первая сборка образа падала на `gzip: stdin: unexpected end of file` — `tar -xz -C /tmp bd LICENSE` без `-f` читал пустой stdin; контрольная сумма при этом сходилась. Исправлено, сборка и `bd version` в контейнере зелёные.
- **Docker Desktop: память VM поднята с 4096 до 8192 МиБ.** При 4 ГиБ сборка образа падала `cannot allocate memory` на `pnpm run build` внутри контейнера (хост 16 ГиБ); настройка локальная, не входит в репозиторий.
- **Обновлён golden `apps/web/tests/expected/default-model/command-picker.expected.md`** (одна строка: маркер активной строки переехал на `Origin Large`). Новая хост-строка меняет момент загрузки профиля, и активная строка пикера теперь совпадает с объявленным сценарием стартовым маршрутом `origin-gateway`; содержательное поведение пикера проверяют остальные 5 тестов файла, все зелёные.
- **Живой прогон вскрыл дефект и он исправлен на месте:** рамка элемента захватывала указатель на `pointerdown` (`setPointerCapture`), из-за чего клики по чекбоксу, «Обновить» и полю добавления не доходили до контролов. `TodoItemRow`/`TodoElement` теперь останавливают всплытие `pointerdown` этих контролов (как `beginResize` рамки), добавлен тест `keeps the frame gesture out of the checkbox, the refresh, and the add field`.
- **`plugin-install-github.e2e.ts` (2 теста) — известное средовое падение** полосы `test:web`, зафиксировано на этапах 27–30; к этапу 31 отношения не имеет.
- **GIF без хода модели.** Запись сделана с реального стенда (реальный `bd` 1.3.1, реальный профиль) на сценарии `/todo`, который по решению 9 этапа не обращается к модели; скорость 2×, интервал 8–36.5 с, финальный кадр удерживается 3 с.
- Новых задач Beads вне подэтапов не создавалось.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm run typecheck` | зелёный |
| `pnpm run lint` | зелёный |
| `pnpm run test:gui` | зелёный; 662 файла |
| `pnpm run build` | зелёный; 351 клиентский артефакт |
| `pnpm run hygiene` | зелёный; 18/18 гейтов |
| `pnpm run verify-cordis-config` | зелёный; 213 конфигов |
| `pnpm run doc-sync` | зелёный; 43/43 гейта |
| `pnpm exec vitest run packages/ketos/board-doc packages/ketos/board-todo --coverage …` | зелёный; 17 файлов, покрытие 100% на каждый файл |
| `pnpm exec vitest run packages/ketos/client-locale-ru --coverage …` | зелёный; 11 тестов, покрытие 100% |
| `pnpm run verify-client-ui-i18n` | зелёный; 1033 файла |
| `pnpm run verify-client-domain-graph` | зелёный; 82 известных исключения |
| `DSH_SNAPSHOT=replay pnpm run test:web` | 168 файлов: 166 зелёных, 1 красный (`plugin-install-github`, средовое), 1 skipped; 647 тестов зелёных, 16 skipped |
| `docker compose -f docker/stand/compose.yaml build ketos-a` | зелёный; образ `ketos-stand:local` |
| `docker compose … exec ketos-a bd version` / env / LICENSE | `1.3.1`; `BD_DISABLE_METRICS=1 DO_NOT_TRACK=1`; LICENSE на месте |
| `bd list` в контейнере по базе Кетоса | совпадает с доской (`kt-5oy`: 1 closed + 1 open; `kt-7th` «Покупки») |
| Живой прогон и GIF | `docs/ketos/reports/assets/stage-31-todo-beads.gif` (1200×750, 17.25 с, 2.7 МБ) |

## 6. Следующий шаг

Предпосылки этапа 32: пакет `@ketos/board-todo` с `Config` и маршрутом, `TodoData`/`BeadsIssueId`/`parseTodoData` в `@ketos/board-doc`, `bd` 1.3.1 в образе стенда, размещение и снимок списка в документе — на месте. Открытых вопросов нет; после ответа «да» агент коммитит ветку `stage-31-todo-beads` (без пуша), закрывает эпик `ketos-qzb.6` в Beads, выполняет `bd backup sync` и создаёт worktree этапа 32 от принятой ветки (`pnpm install`, `pnpm run build`, базовые гейты).
