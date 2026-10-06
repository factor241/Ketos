# Этап 27. Подложка окна и цвета владельцев — отчёт

> План: [stage-27-window-bezel.md](/Users/kirillustuzanin/Downloads/ketos_v7_master_plan/stage-27-window-bezel.md) (ревизия 2), дизайн: `stage-27-window-bezel-design.md`. Эпик Beads: `ketos-qzb.2` в умбрелле `ketos-qzb` «Новый Кетос: показ 16 октября». Ветка: `stage-27-window-bezel`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-27` (создан от принятой `stage-26-setup`). `~/.ketos` не трогали; живые проверки и GIF — на свежих `DSH_HOME` во временных папках.

## 1. Итог этапа

Подготовка worktree (первая строка отчёта): `pnpm install`, `pnpm run build`, `pnpm run typecheck` и `pnpm exec vitest run packages/client/ui-board/tests` — 44 файла / 658 тестов зелёные.

Все подэтапы 27.1–27.8 выполнены, кроме приёмки: у каждого окна доски видна кромка цвета владельца, при наведении и выборе выезжает подложка с владельцем и доступом, акцентная обводка выбранного окна снята, владелец передаёт окно и открывает его другим (демо-команда), `ownerId`/`access` сохраняются с раскладкой и старые раскладки читаются как «моё, только я», обе панели выезжают из-под окна, `owners.ts` — единственный источник участников. Изменения не коммитились и не пушились: коммит — после ответа «да» на вопрос о приёмке. Модель участников готова к замене демо-команды (этапы 28 и 32 меняют только `owners.ts`).

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 27.1 Палитра владельцев | `ketos-qzb.2.1` | выполнен | 22 токена `--board-owner-*` светлой темы в `.root` и тёмной в `:global([data-ds-dark-theme]) .root`, 11 правил `data-board-owner-color`; контраст кромки ≥ 3:1 к `--dsw-alias-bg-layer-2` и фону холста в обеих темах (две светлые кромки затемнены с сохранением оттенка: `#e8780c`→`#e1740c`, `#c9940a`→`#ba8909`); `grep -c "board-owner-"` = 80; `canvas.client.spec.tsx` 8/8; новых буквальных цветов в `window/`/`dock/` нет |
| 27.2 Модуль участников `owners.ts` | `ketos-qzb.2.2` | выполнен | `src/client/owners.ts`: `OwnerId`, `OwnerColorIndex`, `BoardParticipant`, `DEMO_SELF_ID`, `DEMO_TEAM`, `currentOwnerId`, `boardParticipants`, `participantOf`, `ownerColorAttr`, `participantLabel`, `participantInitial`, `isOwnerIdFormat` (+`OWNER_ID_MAX_LENGTH`), `sanitizeWindowAccess`, `canManageWindow`; ключи `owner.demo.*`, `owner.unknown` в zh/en/ru; `owners.client.spec.ts` 18/18; `DEMO_TEAM` только в `owners.ts` |
| 27.3 Владелец и доступ в данных окна | `ketos-qzb.2.3` | выполнен | `WindowAccess` и обязательные `ownerId`/`access` в `BoardWindowState`, `OpenWindowSpec` без них (необязательные для восстановления); схема с умолчаниями (`''` = текущий участник, `access {mode:'owner',people:[]}`, `BOARD_ACCESS_MAX_PEOPLE = 50`), `BOARD_SETTINGS_VERSION` не менялся; `sanitizeWindow` по формату (без членства), `captureBoardLayout`/`hydrate`/`insertWindow`; действия `transferWindow`/`setWindowAccess`; тесты схемы/раскладки/стора 104/104 + запись раскладки после передачи (шпион `replace`); `pnpm --silent run verify-persistence-changes --json` → `"changes": []` |
| 27.4 Кромка и подложка | `ketos-qzb.2.4` | выполнен | Корень окна несёт `data-board-owner-color`/`data-board-manageable`/`data-board-panel-*-open`; кромка `::before` 2px всегда (включая `simplified`), правило `.window.active` удалено; `WindowBezel`/`OwnerBadge`/`AccessIndicator` (заливка `z-index:-2`, поверхность окна на `::after` `z-index:-1`, показ на hover/focus-within/active, `prefers-reduced-motion` без перехода); хук `useWindowDragStart` для шапки и фона подложки; `clearActiveWindow` по щелчку холста (< 3px, `CLICK_SLOP_PX`); `window-bezel.client.spec.tsx` 10/10; `apps/web/tests/board-bezel.e2e.ts` 4/4 |
| 27.5 Передача окна и меню доступа | `ketos-qzb.2.5` | выполнен | `OwnerTransferMenu` («Передать окно», список без владельца, «Передать» неактивна без выбора, «Нет других участников») и `AccessMenu` (три режима, подменю людей с галочками, выбор людей не закрывает меню); триггеры `data-board-action="bezel-owner"`/`"bezel-access"` с `aria-haspopup`/`aria-expanded`/`aria-label`; `Menu` научен отмечать `selectedIds` в строках подменю (`menu-host.client.spec.tsx` +1); ключи `bezel.*` в zh/en/ru; тесты передачи, режимов, сохранения людей, Escape при открытом меню не закрывает панель окна |
| 27.6 Панели выезжают из-под окна | `ketos-qzb.2.6` | выполнен | Мёртвые селекторы `[data-board-panel='beside'|'overlay'|'docked']` удалены, `.panel[data-board-panel-side='right']` прячется влево (левая — вправо); боковая полоса подложки со стороны открытой панели не рисуется (правила 27.4); e2e `board-bezel.e2e.ts` 5/5 (направление закрытых панелей, видимость и `elementFromPoint` открытой) |
| 27.7 Тексты и документация | `ketos-qzb.2.7` | выполнен | Ключи `owner.*` и `bezel.*` в zh/en/ru, ru-корпус 100%; README ui-board (тройка) — раздел о владельце/доступе, палитре, подложке и `owners.ts` + два пункта Known Limitations (демо-команда до этапа 32; переданное окно не возвращается); Agent Note `2026-10-06-ketos-board-window-ownership` (тройка); `docs/ketos/beads.md` — статус линии `ketos-qzb`; `pnpm run doc-sync` 43/43 |
| 27.8 Проверки и приёмка | `ketos-qzb.2.8` | выполнен | Гейты зелёные (см. §5), GIF и отчёт готовы; вопрос «Принимаете ли вы этап?» задан |

## 3. Критерии приёмки этапа

- [x] Кромка цвета владельца у каждого окна в обеих темах — e2e `board-bezel` (border-top `::before` 2px, `--board-owner-edge` непуст) и живая проверка: у окна с `data-board-owner-color="3"` `--board-owner-edge` светлой темы `#ba8909`, тёмной `#e5b53a` (скриншоты `.playwright-mcp/stage-27-gif/qa-02…qa-08`).
- [x] Подложка выезжает при наведении и выборе, при «уменьшить движение» — без анимации — e2e: `opacity` 1 на наведении, 0 после ухода у невыбранного, 1 у выбранного; `transition-duration` подложки `0s` при `prefers-reduced-motion: reduce` (в живом прогоне то же: `0.2s` → `0s`).
- [x] Акцентной обводки выбранного окна нет — правило `.window.active` удалено, e2e: вычисленный `--dsw-elevation-stroke-color` ≠ `--dsw-alias-state-business-primary`.
- [x] Передача окна и меню доступа работают у владельца и скрыты у остальных — unit-тесты (передача «Юристу» перекрашивает в цвет 3 и убирает триггеры; режимы и список людей) и GIF: меню передачи, перекраска, меню доступа.
- [x] `ownerId`/`access` сохраняются, старая раскладка читается как «моё, только я» — `board-settings`/`board-layout`/`board-persistence` тесты (документ без полей → `demo-self`, `owner`; `capture → sanitize` сохраняет `access`; запись после передачи содержит `ownerId`/`access`).
- [x] Правая панель выезжает из-под окна — e2e 27.6 и GIF.
- [x] `owners.ts` — единственный источник участников — `grep -rn "DEMO_TEAM" packages/client/ui-board/src/client` находит только `owners.ts`.
- [x] Словари zh/en/ru, `test:gui`, `test:web`, `verify-client-ui-i18n`, `verify-client-domain-graph`, `doc-sync` — результаты в §5 (`test:web`: единственные падения — известные средовые `plugin-install-github`, см. §4).
- [x] GIF `docs/ketos/reports/assets/stage-27-window-bezel.gif` (1200×750, 13,5 с, 3,2 МБ) и отчёт — на месте.

## 4. Отклонения

- **Иконки «замок» нет в `@deepseek-ai/dsh-client-ui-primitives`.** Режим «Только я» показан значком человека (`IconUserOutlineRegular`), «Все» — значком группы (`IconUsersOutlineRegular`); новый глиф без ревью дизайнера не рисовался. Решение требует подтверждения на приёмке; вариант с замком — отдельная задача дизайну.
- **`Menu` из `ui-primitives` не отмечал `selectedIds` в строках подменю** (галочки в списке людей не отображались бы). Добавлено малое расширение примитива (отметка `selection: 'check'`/`'fill'` для строк подменю) с тестом `menu-host.client.spec.tsx`.
- **`verify-client-domain-graph` был красным на базе** (41 нарушение + 2 устаревших исключения после влития апстрима 0.2.0-rc.2). Починено: `panel-geometry.ts` перенесён из домена `window/` в общий верхний уровень (3 нарушения ui-board), счётчики upstream-исключений актуализированы и добавлены `ui-settings-account`, `ui-sidebar-browser`, `ui-workspace` (задача `ketos-nrs`, закрыта).
- **`doc-sync` был красным на базе.** Починено: `docker/stand/README.md` переведён на английский и получил китайскую пару (`README.zh.md` + `.i18n.yaml`; прежний русский текст был нарушением политики пар), перегенерирован клиентский каталог (`gen-client-catalog` — сдвиг строк из-за новых полей контракта) и обновлён путь `panel-geometry.ts` в `docs/ketos/board-audit-plan.md`.
- **`board-geometry.e2e.ts` (П-27) считал кнопки подложки «вышедшими за кадр»** — проверка сужена до собственного хрома окна (кнопки `[data-board-bezel]` исключены): подложка намеренно выходит за прямоугольник окна.
- **`DSH_SNAPSHOT=replay pnpm run test:web` — 2 падения `plugin-install-github`** (тайм-аут диалога «无法访问 GitHub»): известная средовая проблема хоста, подтверждённая на чистом апстриме в этапе 25 (`docs/ketos/reports/stage-25-upstream-upgrade.md`, §11.5/§13), не регрессия этапа 27. Остальные файлы зелёные; `board-geometry` после правки — 35/35.
- **GIF снят с UI-сценария без модельных раундов** (подложка, передача, меню доступа, панели) на реальном сервере из дерева этапа (несобранные изменения), свежий `DSH_HOME`, светлая тема; интервал 11,5–27,3 с исходного видео, скорость 1,5×, финальная задержка 3 с. Тёмная тема и «уменьшить движение» проверены на том же живом клиенте (`emulateMedia`, вычисленные `--board-owner-edge`/`transition-duration`); сырое видео и QA-кадры — в gitignored `.playwright-mcp/stage-27-gif/`.
- **Руководство по обновлению не нужно**: поля добавлены с умолчаниями, версия документа не менялась, старые раскладки читаются; `verify-persistence-changes` — «изменений нет» (схема доски вне каталога сессий).
- **Найдено вне подэтапов**: `ketos-nrs` (гейт доменов, закрыта). Бюджеты линии (FPS и т.п.) в этом этапе не замеряются — их владелец этап 30.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm run build` | зелёный; 351 клиентский артефакт |
| `pnpm run typecheck` | exit 0 |
| `pnpm run lint` | exit 0 (oxlint, 0 диагностик) |
| `pnpm run test:gui` | 646 файлов, 10 279 passed, 1 skipped, 0 failed |
| `pnpm exec vitest run packages/client/ui-board/tests` | 46 файлов, 705 passed |
| `pnpm exec vitest run packages/ketos/client-locale-ru --coverage --coverage.include='packages/ketos/client-locale-ru/src/**/*.ts'` | 11 passed; 100% (43/43 stmts, 18/18 branch, 9/9 funcs, 38/38 lines) |
| `pnpm run verify-client-ui-i18n` | 1012 файлов на locale-owned копии, 0 нарушений |
| `pnpm run verify-client-domain-graph` | зелёный (82 известных upstream-нарушения исключены) |
| `pnpm run doc-sync` | 43 passed, 0 failed |
| `pnpm --silent run verify-persistence-changes --json` | `"changes": []` — изменений нет |
| `pnpm exec vitest run packages/client/ui-primitives/tests/menu-host.client.spec.tsx` | 10 passed (включая отметку строк подменю) |
| `pnpm exec vitest run packages/client/ui-theme/tests/radius-styles.client.spec.ts packages/client/ui-theme/tests/corner-shape-styles.client.spec.ts` | 3 passed (исключение радиуса подложки записано, круглые значки с `corner-shape: round`) |
| `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/board-bezel.e2e.ts` | 5/5 (после 27.6) |
| `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/board-geometry.e2e.ts` | 35/35 (после сужения проверки П-27) |
| `DSH_SNAPSHOT=replay pnpm run test:web` | после правки `board-geometry`: 165/167 файлов зелёные; 1 файл (2 теста) `plugin-install-github` — известная средовая проблема (этап 25) |
| Живой клиент (свежий `DSH_HOME`) | наведение/выбор/передача/меню доступа/панели; тёмная тема `#e5b53a`/`#352a0e` для цвета 3; `prefers-reduced-motion` → `transition-duration: 0s`; скриншоты `qa-01…qa-08` |

## 6. Следующий шаг

Незакрытых задач подэтапов нет; `bd list --status=in_progress` пуст; `bd backup sync` выполнен. Задан единственный вопрос: «Принимаете ли вы этап?». После ответа «да»: коммит всех изменений в `stage-27-window-bezel` (без пуша), `bd close ketos-qzb.2 --reason "Принят"`, создание и подготовка worktree этапа 28 (`stage-28-board-elements`) от принятой ветки. Перенос в `main` — только после приёмки этапа 36.
