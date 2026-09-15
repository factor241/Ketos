# Отчёт этапа 2. Подключение доски к веб-профилю

> Заполнен по шаблону `stage-report-template.md`. Ветка `stage-02-board-wiring`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-02` (от принятой ветки этапа 1 `stage-01-dev-stand`, `331849a`). Финальный коммит этапа — голова этой ветки на момент приёмки.

## 1. Итог этапа

Пакет `@deepseek-ai/dsh-client-ui-board` подключён к веб-профилю: строка `ui-board` в ростeре `packages/bundle/web-app/cordis.patch.yml` и зависимость в манифесте бандла (третья поверхность, агрегат `tsconfig.client.json`, была готова на этапе 0), `lib/client.js` собирается штатным `pnpm run build:lib:client`. В браузере (`pnpm ketos web`) в левом сайдбаре появилась иконка «Доска», клик открывает холст в области `main`, переключение на conversation и обратно работает, панорамирование и зум к курсору работают, ошибок загрузки `/plugins/ui-board/client.js` в консоли нет. Живая проверка выявила дефект вёрстки — холст позиционировался относительно shell-frame и перекрывал сайдбар, — он исправлен в границах этапа: корень `DashboardCanvas` теперь занимает свою панель, а не окно.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 2.1 Три регистрационные поверхности | `ketos-5v2.3.1` | выполнен | `verify-cordis-config` — 143 config file; `build:lib:client` собирает `packages/client/ui-board/lib/client.js` (62.5 kB); `verify-client-packages` — 52 packages; `verify-client-catalog` — up to date; `pnpm ketos web --dump-config` содержит строку `ui-board`; `__DSH_BOOT__` на живой странице — 55 записей с `@deepseek-ai/dsh-client-ui-board` |
| 2.2 Обязательная обвязка пакета | `ketos-5v2.3.2` | выполнен | README с Summary/Model Experience/тремя Known Limitations/причиной отсутствия `./invariant` уже закрыт этапами 0–1 (гейты `verify-package-readme-*` зелёные); `files`/`exports`/`types` совпадают с `expectedDshPackageFiles` (`pnpm run constraints`); JSDoc `apply`/`inject` приведён к канонической форме (`@param`, описание сервисов); `/client` экспортирует `apply`, `inject`, `createBoardStore` и типы — лишних runtime-значений нет; `doc-sync` — 34 gates passed |
| 2.3 Первый рендер | `ketos-5v2.3.3` | выполнен | живой `pnpm ketos web`: иконка «Доска», клик открывает холст (rect 280,0,920×1010 — ровно область `main`), `elementFromPoint` над сайдбаром больше не возвращает холст, панорамирование (`translate3d` −42,−50 → 58,−20) и зум (scale 1 → 1.1 с центровкой на курсоре) работают, 0 ошибок и предупреждений загрузки в консоли; smoke-тест `tests/apply.client.spec.tsx` (3 теста) зелёный |

## 3. Критерии приёмки этапа

- [x] Иконка и панель доски видны в web-профиле — `pnpm ketos web`, русский интерфейс: строка «Доска» в «Глобальные панели», клик рендерит холст, rail/Omnibox/миникарта в области `main`; скриншот и GIF в `.playwright-mcp/`.
- [x] `verify-cordis-config`, `verify-client-packages`, README/JSDoc-гейты зелёные — 143 config file; 52 client packages; `doc-sync` 34/34 (включая `verify-package-readme-summaries`, `verify-package-readme-limitations`, `verify-package-readme-model-experience`, `verify-export-jsdoc`, `verify-translation-pairing` с новой Agent Note).
- [x] Smoke-тест регистрации зелёный — `pnpm exec vitest run packages/client/ui-board/tests` — 3 файла, 12 тестов passed (9 прежних + 3 новых): две регистрации (`main` key `board`, `sidebar.panellist` id `board`), рендер холста и иконки, label из словаря (`Board`/`看板`), снятие обеих регистраций при dispose.
- [x] Загрузка доски через дев-цикл этапа 1 подтверждена — сборка пакета `pnpm --filter @deepseek-ai/dsh-client-ui-board bundle` и перезагрузка страницы видны в живом сервере; путь плагина тот же, что у upstream-плагинов (`/plugins/ui-board/client.js` в `__DSH_BOOT__`).
- [x] `pnpm run test:gui` зелёный — 381 файл, 5438 passed, 1 skipped.
- [x] `DSH_SNAPSHOT=replay pnpm run test:web` — см. таблицу проверок (снимки не изменились: сценарии не выбирают панель доски).

## 4. Отклонения

- **Контекст плана частично устарел.** Пункт «нет `README.md`» и «продуктовые строки в `src`» закрыты этапами 0–1 (README и словарь `locale.ts` уже в базе), поэтому задачи 2.2 свелись к проверке гейтов и точечному JSDoc. Это зафиксировано, а не переделано заново.
- **Дефект вёрстки, найденный живой проверкой**: корень `DashboardCanvas` был `position: absolute; inset: 0` и позиционировался относительно `.frame` (единственный positioned-предок), перекрывая сайдбар и перехватывая его клики. Исправлено в границах этапа: `position: relative; width: 100%; height: 100%; overflow: hidden` по конвенции shell (`ConversationRoot`), `ui-layout` не менялся. Решение и альтернативы — Agent Note `2026-09-15-ketos-board-in-web-profile.md`.
- **Известные ограничения, не входящие в этап:** карточки окон — статические заглушки (этапы 3–6), раскладка не персистится (этап 8), `onWheel` React — passive-слушатель, при зуме консоль пишет `Unable to preventDefault inside passive event listener invocation` (жесты — этап 5), слоты `board.*` пока только объявлены (этап 3). Перечислены в Agent Note и переносятся в этап 5/3.
- **Снимки GUI обновлены осознанно.** Новый пункт сайдбара меняет записанные frame-гolden'ы `apps/web/tests/lifecycle-chrome.e2e.ts`: `snapshots/web/lifecycle-chrome/{hero,plan-active}.expected.md` получили блок `- navigation "Global panels": - button "Board"` (обновлено `DSH_SNAPSHOT=refresh` по этому файлу, диф — ровно две добавленные строки). Остальные 100 файлов web-набора не затронуты.
- **Покрытие:** исключение `packages/client/ui-board/src/**` из per-file 100% сохранено по MVP-политике (Agent Note `2026-09-15-ketos-mvp-engineering-policy.md`): smoke-тест покрывает регистрацию, но не компоненты, которые переписывают этапы 3–4; снятие исключения — на приёмке MVP (этап 20).
- **Обновление зависимостей:** `pnpm install` после добавления зависимости бандла переписал `pnpm-lock.yaml` (одна строка).

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests` | зелёный: 3 файла, 12 passed (3 новых) |
| `pnpm run test:gui` | зелёный: 381 файл, 5438 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл passed, 1 skipped; 359 passed, 15 skipped |
| `pnpm run build` | зелёный; build-запись `238 client artifact(s) with 3 public value(s)` |
| `pnpm run build:lib:client` | зелёный; `packages/client/ui-board/lib/client.js` собран |
| `pnpm run verify-cordis-config` | зелёный: 143 config files passed |
| `pnpm run verify-client-packages` | зелёный: 52 client packages (47 dynamic, 5 static) |
| `pnpm run verify-client-catalog` | зелёный: up to date после `gen-client-catalog` |
| `pnpm run doc-sync` | зелёный: 34 passed, 0 failed |
| `pnpm run hygiene` | зелёный: 16 gates passed, 0 failed |
| `pnpm run typecheck && pnpm run lint` и `pnpm run constraints` | зелёные (exit 0) |
| `pnpm ketos web` | 200; «Доска» в сайдбаре; холст в `main`; pan/zoom; 0 ошибок консоли |
| `pnpm ketos web --dump-config \| grep ui-board` | строка `- id: ui-board` из манифеста бандла |

## 6. Следующий шаг

Этап 3 — «Слоты и оконный каркас» (эпик `ketos-5v2.4`): перевод объявленных `board.*` в `children` + `renderSlot`, `board.window.body`, дефолтные occupant'ы окон. Предпосылки выполнены: пакет подключён к ростeру и грузится в браузере, живой dev-цикл подтверждён, объявленные слоты перечислены в каталоге, дефект вёрстки устранён. После приёмки агент закрывает эпик `ketos-5v2.3` в Beads и готовит worktree этапа 3 от принятой ветки.
