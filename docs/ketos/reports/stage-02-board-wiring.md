# Отчёт этапа 2. Подключение доски к веб-профилю

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-02-board-wiring`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-02` (от принятой ветки этапа 1 `stage-01-dev-stand`, `331849a`). Финальный коммит этапа — голова этой ветки на момент приёмки; коммит доработки по аудиту назван в §1.

## 1. Итог этапа

Пакет `@deepseek-ai/dsh-client-ui-board` подключён к веб-профилю: строка `ui-board` в ростeре `packages/bundle/web-app/cordis.patch.yml` и зависимость в манифесте бандла (третья поверхность, агрегат `tsconfig.client.json`, была готова на этапе 0), `lib/client.js` собирается штатным `pnpm run build:lib:client`. В браузере (`pnpm ketos web`) в левом сайдбаре появилась иконка «Доска», клик открывает холст в области `main`, переключение на conversation и обратно работает, панорамирование и зум к курсору работают, ошибок загрузки `/plugins/ui-board/client.js` в консоли нет. Живая проверка выявила дефект вёрстки — холст позиционировался относительно shell-frame и перекрывал сайдбар, — он исправлен в границах этапа: корень `DashboardCanvas` теперь занимает свою панель, а не окно.

Перед приёмкой этап прошёл независимый аудит (в том числе критический разбор документов, тестов и согласованности репозитория) и доработку в том же worktree: закрыт базовый красный гейт `verify-module-graph` (см. [baseline-issues.md](../baseline-issues.md)), снято непрочитанное ребро `layout` из Cordis-`inject` доски, удалён мёртвый глобальный `tokens.css` (33 токена без потребителей), alert-заглушки заменены no-op, тесты усилены (13 вместо 12, включая отложенный путь `slots.inject`), исправлены фактические ошибки Agent Note и этого отчёта, обновлены устаревшие контракты (`ui-layout` README, `dev-loop.md`, `beads.md`), заведены задачи на перенесённые дефекты (`ketos-tmd`, `ketos-jdb`, `ketos-0da`).

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 2.1 Три регистрационные поверхности | `ketos-5v2.3.1` | выполнен | `verify-cordis-config` — 143 config file; `build:lib:client` собирает `packages/client/ui-board/lib/client.js` (57.9 kB); `verify-client-packages` — 52 packages; `verify-client-catalog` — up to date; `pnpm ketos web --dump-config` содержит строку `ui-board`; `__DSH_BOOT__` на живой странице — 55 записей с `@deepseek-ai/dsh-client-ui-board` |
| 2.2 Обязательная обвязка пакета | `ketos-5v2.3.2` | выполнен | README с Summary/Model Experience/четырьмя Known Limitations/причиной отсутствия `./invariant` уже закрыт этапом 0 (гейты `verify-package-readme-*` зелёные); словарь `locale.ts` закрыт коммитом `a7e3534` этапа 0; `files`/`exports`/`types` совпадают с `expectedDshPackageFiles` (`pnpm run constraints`); JSDoc `apply`/`inject` приведён к канонической форме (`@param`, только читаемые сервисы); `/client` экспортирует `apply`, `inject`, `createBoardStore` и типы — лишних runtime-значений нет; `doc-sync` — 34 gates passed |
| 2.3 Первый рендер | `ketos-5v2.3.3` | выполнен | живой `pnpm ketos web`: иконка «Доска», клик открывает холст (rect 280,0,920×1010 — ровно область `main`), панорамирование (`translate3d` −42,−50 → 58,−20) и зум (scale 1 → 1.1 с центровкой на курсоре) работают, ошибок загрузки в консоли нет (единственное сообщение — известный passive-listener при зуме, `ketos-3kf`); smoke-тест `tests/apply.client.spec.tsx` — 4 теста |

## 3. Критерии приёмки этапа

- [x] Иконка и панель доски видны в web-профиле — `pnpm ketos web`, русский интерфейс: строка «Доска» в «Глобальные панели», клик рендерит холст, rail/Omnibox/миникарта в области `main`. Доказательство: `.playwright-mcp/stage-02-gif/board-in-web-profile.gif` — перезаписан с дерева `f944353` (чистый worktree, сборка `f944353`), сервер `pnpm ketos web --no-open --port 3180` на scratch-доме `/tmp/ketos-gif-home`, реальный UI без вызовов модели; интервал 10.0–20.8 с источника, скорость 1.4×, финальная задержка 3 с (bundled encoder `record-browser-gif`).
- [x] `verify-cordis-config`, `verify-client-packages`, README/JSDoc-гейты зелёные — 143 config file; 52 client packages; `doc-sync` 34/34 (включая `verify-package-readme-summaries`, `verify-package-readme-limitations`, `verify-package-readme-model-experience`, `verify-export-jsdoc`, `verify-translation-pairing` для пары Agent Note и трёх затронутых README).
- [x] Smoke-тест регистрации зелёный — `pnpm exec vitest run packages/client/ui-board/tests` — 3 файла, 13 тестов passed (9 прежних + 4 новых): регистрации и метаданные (`order`, `locale`, `store`, отсутствие `children`), рендер панельного бокса холста и иконки, label из словаря (`Board`/`看板`), снятие регистраций и DOM при dispose при сохранении деклараций, отложенный путь `slots.inject` (mount до объявления слотов). Обратная проверка: возврат `position: absolute` в `DashboardCanvas` роняет тест.
- [x] Загрузка доски через дев-цикл этапа 1 подтверждена — `pnpm run dev:web` + `pnpm ketos web`: правка `DashboardCanvas.tsx` дала `[@deepseek-ai/dsh-client-ui-board/client] Rebuilt in 27ms`, живая страница показала пробное значение **без перезагрузки** (`performance.getEntriesByType('navigation').length === 1`), после возврата пробы значение вернулось тем же путём; проба удалена, `git diff` её не содержит.
- [x] `pnpm run test:gui` зелёный — 381 файл, 5439 passed, 1 skipped.
- [x] `DSH_SNAPSHOT=replay pnpm run test:web` — 101 файл passed, 1 skipped; 359 passed, 15 skipped. Два frame-golden'а `lifecycle-chrome` обновлены осознанно (см. §4); остальные снимки не менялись.
- [x] `pnpm run test:coverage` зелёный — 1280 файлов (1268 passed, 12 skipped), 22 642 теста (22 510 passed, 1 ожидаемый провал, 131 skipped), покрытие 100% statements/branches/functions/lines. Первый прогон дал два таймаута под нагрузкой (см. §4), неизменный повторный прогон зелёный.
- [x] `pnpm run verify-module-graph` зелёный — 3 артефакта up to date; базовый красный гейт закрыт (см. §4 и [baseline-issues.md](../baseline-issues.md)).

## 4. Отклонения

- **Контекст плана частично устарел.** Пункты «нет `README.md`» и «продуктовые строки в `src`» закрыты этапом 0 (README и словарь `locale.ts` уже в базе), поэтому задачи 2.2 свелись к проверке гейтов и точечному JSDoc.
- **Дефект вёрстки, найденный живой проверкой**: корень `DashboardCanvas` был `position: absolute; inset: 0` и позиционировался относительно `.frame` (единственный positioned-предок), перекрывая сайдбар и перехватывая его клики. Исправлено в границах этапа: `position: relative; width: 100%; height: 100%; overflow: hidden`; `ui-layout` не менялся. Решение и альтернативы — [Agent Note](../../../.agents/notes/implemented/architecture/2026-09-15-ketos-board-in-web-profile.md).
- **Базовый красный гейт `verify-module-graph`** найден аудитом этапа 2: `docs/module-graph.md` и его пара не содержали `client-ui-board` с импорта базы; гейт не входит в `doc-sync`, поэтому не выполнялся ни этапом 1, ни этапом 2. Документ перегенерирован, запись — в [baseline-issues.md](../baseline-issues.md); гейт добавлен в проверки этапа.
- **Убрано ребро `layout` из Cordis-`inject`** доски: сервис не читается контрактом (панель выбирает `ui-sidebar`), а правило базы требует рёбер только для читаемых сервисов. Это делает отложенный путь `slots.inject` штатным — он закреплён новым тестом и живой проверкой. `dsh.client.inject` не менялся.
- **Удалён мёртвый `src/client/tokens.css`**: глобальный `:root`-лист с 33 свойствами без потребителей, который сборка инжектила в `document.head` на boot и не убирала. Удаление сохраняет поведение (визуально доска не изменилась), убирает глобальные записи из живого браузера (проверено: `style[data-plugin-css*="ui-board"]` отсутствует) и русские комментарии. Палитра вернётся на этапе 4 как brand-слой/CSS Modules.
- **Alert-заглушки заменены no-op** (attach/dictate/web-search/omnibox-send): блокирующий диалог, сообщавший «Message sent» о несуществующей отправке, убран; ограничение записано в README пакета, реальные действия — этапы 6/7/10.
- **Известные ограничения, не входящие в этап:** карточки окон — статические заглушки, раскладка не персистится, слоты `board.*` пока только объявлены, при зуме консоль пишет `Unable to preventDefault inside passive event listener invocation`. Дефекты, найденные аудитом и перенесённые задачами: `ketos-3kf` (passive-listener, заблокирована 5.1), `ketos-tmd` (устаревший `viewportSize` при изменении геометрии колонок, заблокирована 5.1), `ketos-jdb` (z-index хрома доски выше слоёв frame, заблокирована 5.3), `ketos-0da` (дублированный `data-surface="canvas"`, заблокирована 5.1).
- **Снимки GUI обновлены осознанно.** Новый пункт сайдбара изменил записанные frame-golden'ы `apps/web/tests/lifecycle-chrome.e2e.ts`: `snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` получили блок `- navigation "Global panels": - button "Board"` (обновлено `DSH_SNAPSHOT=refresh` по этому файлу, диф — ровно две добавленные строки).
- **Покрытие:** исключение `packages/client/ui-board/src/**` из per-file 100% сохранено по MVP-политике ([policy Agent Note](../../../.agents/notes/implemented/process/2026-09-15-ketos-mvp-engineering-policy.md)): тест регистрации не покрывает компоненты, которые переписывают следующие этапы доски; снятие исключения — на приёмке MVP.
- **Плавающие таймауты `test:coverage`:** в первом полном прогоне два теста вне изменённых пакетов упали по таймауту под нагрузкой — `packages/boot/app-boot/tests/hmr-config.spec.ts` (20 с; тот же класс, что зафиксирован в отчёте этапа 1) и `packages/sandbox/sandbox-local/tests/local.spec.ts` (5 с, seatbelt-проба). Оба файла в изоляции зелёные (44 теста, 5 с), неизменный повторный полный прогон зелёный. Повтор `hmr-config` — сигнал для отдельной задачи; `sandbox-local` — чувствительность к нагрузке.
- **Обновление зависимостей:** `pnpm install` после добавления зависимости бандла переписал `pnpm-lock.yaml` (одна строка).

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный: 3 файла, 13 passed (4 новых) |
| `pnpm run test:gui` | зелёный: 381 файл, 5439 passed, 1 skipped |
| `pnpm run test:coverage` | зелёный (повторный прогон): 22642 теста, 1 ожидаемый провал, 131 skipped; 100% statements/branches/functions/lines |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл passed, 1 skipped; 359 passed, 15 skipped |
| Дев-цикл `pnpm run dev:web` + `pnpm ketos web` | правка `DashboardCanvas.tsx` → `Rebuilt in 27ms` → эффект в живой странице без перезагрузки; проба возвращена |
| `pnpm run build` | зелёный; build-запись `238 client artifact(s) with 3 public value(s)` |
| `pnpm run build:lib:client` | зелёный; `packages/client/ui-board/lib/client.js` — 57.9 kB |
| `pnpm run verify-module-graph` | зелёный: 3 artifact(s) up to date (базовый красный гейт закрыт) |
| `pnpm run verify-cordis-config` | зелёный: 143 config files passed |
| `pnpm run verify-client-packages` | зелёный: 52 client packages (47 dynamic, 5 static) |
| `pnpm run verify-client-catalog` | зелёный: up to date после `gen-client-catalog` |
| `pnpm run verify-client-ui-i18n` | зелёный: 619 Client UI source file(s) |
| `pnpm run doc-sync` | зелёный: 34 passed, 0 failed |
| `pnpm run hygiene` | зелёный: 16 gates passed, 0 failed |
| `pnpm run typecheck && pnpm run lint` и `pnpm run constraints` | зелёные (exit 0) |
| `pnpm ketos web` | 200; «Доска» в сайдбаре; холст в `main` (280,0,920×1010); панель не перекрывает сайдбар; `style[data-plugin-css*="ui-board"]` отсутствует; клик по «Действие меню» → attach-file больше не открывает диалог; 0 ошибок консоли |
| `pnpm ketos web --dump-config \| grep ui-board` | строка `- id: ui-board` из манифеста бандла |
| GIF-запись доски (`record-browser-gif`) | `.playwright-mcp/stage-02-gif/board-in-web-profile.gif`, 1200×750, 10.7 с, 107 кадров, 1.9 МБ; источники рядом (webm, storyboard, QA-кадры) |

## 6. Следующий шаг

Этап 3 — «Слоты и оконный каркас» (эпик `ketos-5v2.4`): перевод объявленных `board.*` в `children` + `renderSlot`, `board.window.body`, дефолтные occupant'ы окон. Предпосылки выполнены: пакет подключён к ростeру и грузится в браузере, дев-цикл подтверждён, объявленные слоты перечислены в каталоге, дефект вёрстки устранён, базовый красный гейт закрыт. После приёмки агент закрывает эпик `ketos-5v2.3` в Beads и готовит worktree этапа 3 от принятой ветки.
