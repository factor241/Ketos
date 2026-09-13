# Этап 0. Ребрендинг DeepSeek Harness → Кетос (подготовительный)

> Источник: `ketos_v7_master_instruction.md` (Часть II, этап 0; ревизия 3, 2026-09-12). Общие правила, бюджеты и политика тестов — §II.4; правило перехода — «Сводный чек-лист» общего плана.
> Первый этап плана; выполняется до всех остальных. Порядок подэтапов внутри этапа обязателен.

**Результат этапа (из §II.3):** CLI `ketos`, дом `~/.ketos`, ru по умолчанию, веб-бренд Кетос, запретный список соблюдён.

## Как исполнять этот этап

- Порядок чтения и работы общего плана: §2 → §3 → §4 → §5 → §6; «фаза не считается начатой, пока предыдущая не дала зелёные критерии приёмки §6.2» (§0).
- «Часть II уточняет Часть I, не отменяя её архитектурных решений» (§0); при расхождении формулировок приоритет — за мастер-планом в этой папке.
- Definition of Done этапа (из §II.4): все подэтапы выполнены; каждый критерий верификации подтверждён командой или наблюдаемым поведением; `pnpm run test:gui` зелёный; для видимых изменений — `DSH_SNAPSHOT=replay pnpm run test:web`; при добавлении пакетов — `pnpm run doc-sync && pnpm run build && pnpm run hygiene`; PR/коммит этапа содержит Agent Note (кроме чисто механических правок).
- Команды проверки — в разделе «Команды проверки» ниже; общие правила, бюджеты и политика тестов — в разделе «Общие правила»; справочный контекст — в разделе «Контекст из общего плана».

## Общие правила (из §II.4 общего плана)

**Definition of Done этапа:** все подэтапы выполнены; каждый критерий верификации подтверждён командой или наблюдаемым поведением; `pnpm run test:gui` зелёный; для видимых изменений — `DSH_SNAPSHOT=replay pnpm run test:web`; при добавлении пакетов — `pnpm run doc-sync && pnpm run build && pnpm run hygiene`; PR/коммит этапа содержит Agent Note (кроме чисто механических правок).

**Бюджеты производительности MVP:**

| Метрика | Бюджет | Как проверяем |
|---|---|---|
| FPS холста при 20 окнах | ≥ 55 FPS при панорамировании/зуме | ручной замер + `performance.now()` в dev-консоли |
| Открытие нового окна | ≤ 100 мс до первого кадра | ручной замер |
| Запись раскладки | ≤ 1 запись/с; только после жеста | лог в settings-store |
| Стриминг текста | первый токен ≤ 400 мс после `prompt` (при локальной модели) | ручная проверка |
| Поиск по памяти (10 000 записей) | ≤ 20 мс | микро-бенчмарк в тесте памяти |
| Реакция статуса задачи после `turn/end` | ≤ 1 с | ручная проверка в панели задач |
| Память процесса при 20 сессиях | нет роста подписок/кэшей после циклов открытия-закрытия окон; число агентов равно числу живых сессий списка (закрытие окна сессию не удаляет) | `ctx.agents.list().length` и размеры Map в apply-обёртках |

**Политика тестов MVP:** обязательные тесты — только для (а) чистой математики (`zoomTowardPointer`, snap, проекция миникарты), (б) персистентности (CAS settings, `user_version`, CRUD `clones.db`), (в) регистрации/диспоуза слотов и инструментов, (г) границ Fetch-маршрутов (коды ошибок, валидация), (д) поведения памяти (remember → search → инъекция). Не пишем: тесты на каждый CSS-класс, скриншоты всех состояний, стресс-тесты ресайза. В форке «Кетос» это оформляется исключениями покрытия в `vitest.config.ts` и фиксируется в Agent Note MVP.

**Соглашения MVP:** новые пакеты Кетоса — `@ketos/<name>` в группе `packages/ketos/`; UI-окна клонов живут в существующем `ui-board` (новые `WindowKind`), чтобы не плодить регистрационные поверхности; клиентские данные — только JSON-совместимые; идентификаторы — branded-типы; все продуктовые строки — ru/en словари; комментарии — английские.

---

## Команды проверки (из §6.1 общего плана)

| Изменение | Команда |
|---|---|
| Код доски (юниты/компоненты) | `pnpm exec vitest run packages/client/ui-board/tests` |
| Покрытие новых исходников | `pnpm exec vitest run <спеки> --coverage --coverage.include='packages/client/ui-board/src/**/*.{ts,tsx}'` |
| Весь GUI-слой | `pnpm run test:gui` |
| Собранный UI / видимый вывод | `pnpm run dev:web` (watch) + `DSH_SNAPSHOT=replay pnpm run test:web` |
| Манифесты/экспорты/регистрация | `pnpm run build && pnpm run hygiene` |
| Генераторы, README, каталоги, JSDoc | `pnpm run doc-sync` |
| Типы и линт | `pnpm run typecheck && pnpm run lint` |

## Контекст из общего плана

### 2.2 Сверка исходного плана с кодовой базой

| # | Утверждение v6 / implementation_plan | Факт в коде | Как исполнять |
|---|---|---|---|
| 1 | Запуск: `pnpm dsh --profile web --agent-preset cordis` | Флага `--agent-preset` не существует (0 совпадений по репозиторию); пресет выбирается на сессию (UI-пикер, настройки, поле `agentPreset` в `SessionCreateRequest`); дефолт web-профиля — `standard` | ⚠️ Запускать `pnpm dsh web` (алиас `--profile web`); пресет `cordis` («创造模式» / Creator Mode) выбирать в UI новой сессии |
| 2 | Веб-интерфейс: `http://localhost:5173` | Неверно. `dsh web` слушает **3080** (конфиг `port: !!js ctx.webStartup.port ?? 3080`); голый Vite на 5173 отклоняется кодом и даёт белый экран (`docs/postmortem/0003`) | ⚠️ Dev-цикл: `pnpm run dev:web` (watch-сборка клиента) в одном терминале + `pnpm dsh web` в другом; адрес `http://127.0.0.1:3080` |
| 3 | Хранилище доски: `better-sqlite3` / локальный SQLite | В репозитории **только `node:sqlite`** (`DatabaseSync`); `better-sqlite3` отсутствует в исходниках и lockfile; есть готовый образец дисциплины — `packages/storage/storage-sqlite` | ⚠️ Использовать `node:sqlite`; копировать дисциплину открытия: каталог `0700`, файл `0600`, `PRAGMA user_version`, отказ при чужой версии |
| 4 | База знаний: SQLite-vec + FTS5 | FTS5 есть и в проде (`session-query-sqlite`); **`sqlite-vec`/`vec0` отсутствуют** полностью | ❗ Ф2: спайк загрузки расширения в `node:sqlite` (`enableLoadExtension`) либо замена на cosine-поиск по таблице эмбеддингов; решить до начала Ф2 |
| 5 | Temporal (сервер и SDK, MIT) | Ни `temporal`, ни SDK нигде нет; есть только паттерны долгоживущих воркеров (`workflow-worker-thread`, inspector bridge) | ❗ Ф3: добавить Temporal как внешний сервис; воркер — Cordis-плагин по образцам владения |
| 6 | Отказ от `@xyflow/react` | `xyflow`/`reactflow` нигде не используются | ✅ Ничего делать не нужно |
| 7 | Graceful shutdown через `ctx.on('dispose')` | Публичного события `'dispose'` нет; есть `ctx.effect(fn, label)` → disposer и `fiber.dispose()` | ⚠️ Владение ресурсами — только через `ctx.effect`; async-disposer доводить до квиесценции (`kill → await done`) |
| 8 | Пакеты `packages/board/board-core`, `@deepseek-ai/dsh-board-core` | Не существуют; хост-половина `ui-board` пуста | ⚠️ Отдельный board-хост в MVP не нужен: раскладка хранится в settings-неймспейсе `ui-board` (Часть II, этап 8). Пакет `@ketos/board` с `board.db` — опция после MVP, если раскладка перерастёт settings-документ |
| 9 | Виды слотов: `single/list/keyed` | Их четыре: `single \| list \| keyed \| chain` | ⚠️ Учитывать `chain`; для доски достаточно `single`/`keyed` |
| 10 | Тесты: `tests/store.spec.ts` | Конвенция: `tests/**/*.spec.{ts,tsx}`; клиентские — `*.client.spec.ts(x)`; прагма `// @vitest-environment jsdom` ставится per-file только DOM-спекам (большинство клиентских спек — node-env data-layer, прагмы не имеют); per-package vitest-конфигов нет | ⚠️ Именовать `*.client.spec.ts(x)`, запускать из корня; jsdom-прагму добавлять только компонентным/DOM-спекам |
| 11 | Проверка: `pnpm --filter @…/dsh-client-ui-board run test` | Скрипта `test` в пакетах нет (только `bundle`/`watch`) | ⚠️ Из корня, с явными файлами: `pnpm exec vitest run packages/client/ui-board/tests/store.client.spec.ts packages/client/ui-board/tests/canvas.client.spec.tsx` |
| 12 | `sidebar.panellist` и `ctx.layout.selectPanel('board')` | Подтверждено: `sidebar.panellist` — list-слот в `ui-sidebar`; `ILayout.selectPanel(MainPanelId \| null)` в `ui-layout`; `main` — keyed-слот | ✅ Использовать как есть |
| 13 | Стор на `@deepseek-ai/dsh-client-store` = Zustand + Immer | Подтверждено: zustand ~4.4.7, immer ^10.1.1; фабрика — `defineStore({ init, actions, persist? })` | ✅ |
| 14 | React 18, Vite 6 | React 18.3.1; Vite 6 — только сборка статики `apps/web`; клиентские пакеты собирает tsdown/rolldown (`packages/client/tsdown.client.ts`) | ⚠️ Vite — не dev-сервер доски |
| 15 | «Хостить воркер Temporal на `ctx.on('dispose')`» | См. #7 | ⚠️ `ctx.effect` |

### 2.3 Обязательные правила базы (соблюдать в каждой фазе)

- **Три регистрационные поверхности** для клиентского пакета: агрегат `tsconfig.client.json`; строка `dsh.client` в `packages/bundle/web-app/cordis.patch.yml`; зависимость в `packages/bundle/web-app/package.json`. Пропуск любой падает на своём, более позднем гейте. ✅
- **Композиция только через слоты**: `ctx.slots.register({ name, children?, store?, inject?, locale? }, Component)`; `children` — одновременно объявление и разрешение на рендер; чужие слоты — через `ctx.slots.inject(name, () => register(...))`. ✅
- **Export discipline `/client`**: наружу — только `apply`/`inject`/`Config`, фабрики сторов (для type-only вывода) и общие типы; компоненты и хелперы — внутренние. ✅
- **Стили**: семантические токены `--dsw-*` (`--dsw-alias-*`, `--dsw-specific-*`, `--dsw-elevation-*`) + CSS Modules + `clsx`; глобальные листы и токены — в `ui-theme/src/styles/`; литеральные цвета и сторонние UI-библиотеки запрещены (`docs/web-styling.md`, `ui-theme/README.md`). ✅
- **Локализация**: все продуктовые строки — в типизированных словарях; гейт `verify-client-ui-i18n`. ✅
- **Тесты**: `tests/` на уровне пакета; per-file 100% покрытие `src` (`pnpm run test:coverage`); для product-visible плагинов — real-composition тест через Loader; GUI-снимки и обязательный GIF для PR с видимым GUI. ✅
- **Пакеты**: `@deepseek-ai/dsh-*` (новое Кетос-специфичное — `@ketos/*`); `@deepseek-ai/cordis` — peer + dev; README с Summary/Model Experience/Known Limitations; JSDoc на все экспорты; тесты только в `tests/`. ✅
- **Жизненный цикл**: всё, что владеет ресурсом, живёт в `ctx.effect`; disposer асинхронный и идемпотентный; никакого «dispose-события». ✅
- **Non-trivial change — Agent Note** в том же PR; модель-видимые изменения — новый snapshot. ✅

---

### Ф0. Bootstrap и брендинг (Спайк 1)

Детальный план — Часть II, этап 0.

1. Создать репозиторий Кетос как soft-fork `deepseek-harness`; `origin` — Кетос, `upstream` — DeepSeek Harness; зафиксировать базу `fe89719`; ребрендинг вести отдельной серией коммитов.
2. `pnpm install`; убедиться, что базовые `pnpm run test:gui` и `pnpm run typecheck` зелёные до изменений.
3. Брендинг пользовательских поверхностей: CLI `ketos` алиасом к тому же entrypoint (bin `dsh` сохраняется), вывод `ketos web:`; `DSH_HOME` по умолчанию `~/.ketos`; `ru` — первый пакет `@ketos/*` (addLanguage + словари + дефолт при отсутствии выбора пользователя); веб-бренд (заголовок `DSH_CLIENT_TITLE='Ketos'`, манифест PWA, wordmark в `ui-brand-official`, бут-страница); scope `@ketos/*` и группа `packages/ketos/`. Внутренние идентификаторы (`@deepseek-ai/*`, `DSH_*`, имена профилей, `dsh.*`-поля, формат сессий) не трогать (решение 6).
4. Зафиксировать политику синхронизации с upstream (решение 30): приёмка по тегам раз в спринт, еженедельный CI-мониторинг.

**Приёмка:** `ketos` запускает web-профиль и печатает `ketos web:`; данные в `~/.ketos`; ru по умолчанию; заголовок/манифест/сайдбар показывают Кетос; базовые гейты зелёные; запретный список не нарушен.

### II.1. Границы MVP

| В MVP | Отложено (зафиксировать в Known Limitations) |
|---|---|
| Локальный однопользовательский режим, профиль `web`, том `~/.ketos` | Контуры-контейнеры, Supervisor, Docker/K8s |
| Доска: холст, окна, ресайз, миникарта, док, Omnibox, инспектор | Совместная работа, мультиарендность, поддомены |
| Плавающие окна чата с реальными сессиями Harness | Полный Conversation-стек внутри окна доски (шапка/табы/очередь) |
| Выбор пресета и модели на окно | Прямая фиксация модели в пресете (не поддерживается ядром) |
| Рабочая директория и артефакты агента | Полноценный файловый менеджер доски |
| Клоны: запись, интервью, память (SQLite), методология, навыки | Библиотека организации, карантин знаний, PII-маскинг |
| Автономные задачи клона (goal + round driver) | Temporal-процессы, Beads-граф, расписания, кросс-процессные очереди |
| Персистентность: settings YAML + `clones.db` + JSONL-сессии | PostgreSQL-библиотека, централизованный аудит, SSO/OIDC, MCP-шлюз |
| Один прокси-независимый маршрут модели (штатный `agent-default-model`) | Прокси моделей с ролями, лимиты, ключи |

### Приложение A, решения

3. **Репозиторий:** разработка в новом чистом репозитории Кетос.
5. **Модель форка:** soft-fork; код Кетоса — отдельными пакетами (`@ketos/*`), upstream подтягивается.
6. **Ребрендинг:** пользовательские поверхности под брендом Кетос; внутренние `@deepseek-ai/*` без переименований.
30. **Синхронизация с upstream:** релизы/теги + еженедельный CI-мониторинг; приёмка раз в спринт/месяц.
31. **Брендинг:** Ketos; CLI `ketos`; данные `~/.ketos`; новые пакеты `@ketos/*`.

## План этапа 0 (из Части II, дословно)

**Цель этапа.** Превратить soft-fork DeepSeek Harness в продукт «Кетос» на всех пользовательских и интерфейсных поверхностях — CLI, домашний каталог, веб-интерфейс — не переименовывая внутренние идентификаторы, и зафиксировать правила, по которым бренд живёт во всех последующих этапах.

**Контекст этапа.** Этап целиком опирается на принятые решения Части I: 5 (soft-fork, upstream-код сохраняется и синхронизируется), 6 (под брендом Кетос только пользовательские и интерфейсные поверхности; внутренние имена `@deepseek-ai/*` не меняются), 30 (приёмка релизов upstream), 31 (имя продукта Ketos, CLI `ketos`, данные `~/.ketos`, новые пакеты `@ketos/*`). Инвентаризация базы (ревизия 2 аудита) показывает реальное устройство брендинга: у Node-стороны нет ни бренд-пакета, ни общего constant'а — все пользовательские строки CLI являются литералами (`apps/cli/src/args.ts`, `packages/bundle/web-app/src/index.ts` и `startup.ts`, `packages/bundle/sdk-app/src/index.ts`); у веб-клиента есть штатный шов — сборка с `DSH_CLIENT_BUILD_PROFILE === 'official'` включает `ui-brand-official`, который занимает слоты `sidebar.brand.mark`/`sidebar.brand.name`, а заголовок задаётся `DSH_CLIENT_TITLE` (официальный дефолт — `'DeepSeek Harness'` в `scripts/client-build-environment.ts:20-23`); логотип и wordmark — SVG-графика в `ui-primitives` (`FishLogo`, `BrandWordmark`), а не локализованный текст; статическая оболочка — `apps/web/index.html:8`, `apps/web/public/manifest.webmanifest:3-4`, `favicon.svg`; бут-страница до загрузки плагинов печатает `'HARNESS'` (`packages/client/web/src/boot-page.ts:37`). Локаль `ru` в базе отсутствует полностью: базовые языки — `zh`/`en`, дефолт — браузерный/английский, поэтому русская локаль — это код (языковой пакет `addLanguage` + явный дефолт), а не патч профиля. Границы ребрендинга жёсткие: **не меняются** `@deepseek-ai/*` и `@deepseek-ai/dsh`, bin `dsh`, `DSH_*`-переменные, `~/.dsh` как внутренний дефолт (Кетос переопределяет значение через `DSH_HOME`, а не имя переменной), имена профилей и бандлов, `dsh.*`-поля манифестов, `__DSH_BOOT__`/`__DSH_TRANSPORT__`, wire-идентификаторы, формат сессий и `SCHEMA_VERSION`, имена файлов `cordis.yml`/`*.cordis.yml`/`*.cordis.patch.yml`. Model-visible промпты по умолчанию не трогаются (решение 6 говорит о пользовательских поверхностях) — безопасный маршрут вынесен в опциональный подэтап 0.7. После этапа продукт на всех пользовательских поверхностях называется Кетос, а ядро остаётся merge-совместимым с upstream.

**Подэтапы.** 0.1 Форк-репозиторий и фиксация базы. 0.2 Карта брендинга и запретный список. 0.3 CLI и лаунчер: `ketos`. 0.4 Пакеты `@ketos/*`, группа и констрейнты. 0.5 Дом `~/.ketos` и локаль ru. 0.6 Веб-бренд Кетос. 0.7 Модель-видимая идентичность (опционально).

### 0.1. Форк-репозиторий и фиксация базы

**Цель.** Создать репозиторий Кетос как soft-fork базы с двумя удалёнными репозиториями и зафиксированной точкой синхронизации; весь ребрендинг идёт отдельной серией коммитов до фичей.

**Контекст.** Решения 3/5/30 Части I: разработка в новом репозитории, но код ядра остаётся upstream-совместимым; синхронизация идёт по релизам DeepSeek Harness. Практически: `origin` — репозиторий Кетос, `upstream` — `deepseek-harness`, ветка ведёт от `d5675c2` (HEAD; поверх релизной линии `c291e79` 0.1.5-rc.2 и коммита доски `fe89719`). Ребрендинг — первая серия коммитов форка (этапы 0.1–0.6), отделённая от функциональных этапов 1–20: так конфликты при merge upstream локализуются в известном наборе файлов, а не размазываются по истории фич.

**Задачи.**
1. Создать удалённый репозиторий Кетос и клонировать в него текущее дерево; настроить `origin`/`upstream`.
2. Зафиксировать базовый тег `ketos-base-d5675c2` и ветку `main` от `d5675c2`.
3. Записать процедуру синхронизации (fetch upstream, merge по тегам, приёмка) в `docs/ketos/upstream-sync.md` — файл Кетоса вне upstream-дерева документации.
4. Проверить, что `pnpm install && pnpm run build:native-system` проходит на чистом клоне.

**Критерии верификации.** `git remote -v` содержит `origin` (Кетос) и `upstream` (deepseek-harness); `git rev-parse HEAD` равен базовому коммиту, `git merge-base --is-ancestor c291e79 HEAD` и `--is-ancestor fe89719 HEAD` истинны; `pnpm install` завершается без ошибок; документ синхронизации описывает команды дословно; серия ребрендинга выделена в отдельные коммиты.

### 0.2. Карта брендинга и запретный список

**Цель.** Письменно закрепить каждую поверхность, где бренд виден пользователю, и каждую поверхность, которая остаётся внутренней.

**Контекст.** Без инвентаризации ребрендинг расползается: одно и то же имя встречается в CLI-подсказках, HTML-заголовке, манифесте PWA, SVG-артефактах, локалях, бут-странице, 101 описании `package.json`, README и JSDoc. Аудит ревизии 2 дал полную классификацию: пользовательские поверхности (CLI: `args.ts:132-134`, `HELP_EXAMPLES`, `web-app/src/index.ts:271-277`, `startup.ts:48-60`, `sdk-app/src/index.ts:40-41`, headless-ошибки; веб: `index.html`, `manifest.webmanifest`, `favicon.svg`, `ui-brand-official/Brand.tsx`, `boot-page.ts:37`, ключи `brand.localBuild` и `welcomeBody`); model-visible тексты (`system-prompt:423`, `web-app:139,246`, `app-boot:860`, persona пресета `cordis:22`, `skill-badge` — выключен); строго внутренние (`@deepseek-ai/*`, `DSH_*`, `~/.dsh`, профили, `dsh.*`-поля, wire-идентификаторы, формат сессий, `dsh-session:`-схема, ACP/Codex client names). Отдельно фиксируется ограничение `BRAND_GUIDELINES.md`: форк, выходящий под другим именем, не должен использовать «DeepSeek Harness» как название проекта; «DSH» остаётся допустимым внутренним сокращением.

**Задачи.**
1. Создать `docs/ketos/brand-inventory.md` с тремя таблицами: «перебрендить сейчас» (пользовательские поверхности), «оставить внутренним» (запретный список), «model-visible — опционально (этап 0.7)».
2. Для каждой пользовательской поверхности записать точный путь, строку и целевую замену (`Ketos`, `ketos`, `KETOS`).
3. Зафиксировать правила написания: продукт — «Кетос» в русских текстах и `Ketos` в коде/латинице; CLI — `ketos`; пакеты — `@ketos/*`; данные — `~/.ketos`.
4. Записать в документ проверочные `grep`-команды для поиска остаточных упоминаний и запретный список как явный чек-лист ревью.

**Критерии верификации.** Документ существует; ни одна найденная поверхность не осталась неклассифицированной; запретный список дословно совпадает с решением 6 и §2.3 Части I; grep-команды воспроизводимы.

### 0.3. CLI и лаунчер: `ketos`

**Цель.** Команда `ketos` запускает платформу и печатает брендированные строки; `dsh` остаётся рабочим внутренним алиасом.

**Контекст.** Launcher — скрипт корневого `package.json` (`"dsh": "node --import tsx/esm apps/cli/src/bin.ts"`); `apps/cli/src/args.ts` печатает `Usage: dsh [options] [command]` (`.name('dsh')`, L132), описание `dsh: boot a DeepSeek Harness profile…` (L134) и примеры `HELP_EXAMPLES` (L75-85); web-приложение печатает строку запуска `dsh web: <url>` (`packages/bundle/web-app/src/index.ts:271`, открытие браузера — L274, ошибка — L277) и имеет собственный `--help` (`startup.ts:48-60`, `Serve the DeepSeek Harness browser UI.`); SDK-профиль — `Serve DeepSeek Harness SDK clients over stdio JSON-RPC.` (`packages/bundle/sdk-app/src/index.ts:41`); диагностические префиксы — константы `NAME = 'dsh'` (`apps/cli/src/profile-boot.ts:41`, `plugin.ts:28`, `dump-config.ts:19`) и жёстко вписанные `dsh:`-подсказки в `packages/boot/app-boot/src/profile.ts`. Критично: строка `dsh web:` — это machine-read протокол готовности: её парсят `apps/cli/tests/*`, `apps/web/tests/*`, `packages/bundle/web-app/tests/web-app.spec.ts` и `scripts/publish-npm-baseline.ts:67`, поэтому её переименование — изменение контракта, а не косметика. Команду `dsh` нельзя удалять: её резолвит SDK (`packages/sdk/client/src/launch.ts:61-64`), её bin-карту пинит `scripts/verify-application-entrypoints.ts:26-30`, и её же устанавливает Python-runtime.

**Задачи.**
1. Добавить в корневой `package.json` скрипт `"ketos": "node --import tsx/esm apps/cli/src/bin.ts"`.
2. Добавить `ketos` алиасом в bin-карту `apps/cli/package.json` (`dsh` остаётся); обновить allowlist `scripts/verify-application-entrypoints.ts` и его спек.
3. Заменить пользовательские строки на `ketos`: `.name`/`.description` и `HELP_EXAMPLES` в `args.ts`; prefix строки `web-app/src/index.ts:271,274,277` → `ketos web:`; `startup.ts` name/description/examples; `sdk-app` name/description; headless-подсказки (`bundle/headless/src/startup.ts:53`, `src/index.ts:128,160,210`).
4. Обновить константы диагностических префиксов (`profile-boot.ts`, `plugin.ts`, `dump-config.ts`) и `dsh:`-подсказки в `app-boot/src/profile.ts` на `ketos`.
5. Обновить потребителей readiness-строки: тесты CLI/web/web-app и `scripts/publish-npm-baseline.ts:67`; синхронизировать фикстуру `apps/cli/tests/fixtures/web-browser-open/register.mjs`.
6. Не трогать: `dsh`-скрипт, `@deepseek-ai/dsh`, `DSH_*`, имена профилей/бандлов, `dsh.*`-поля манифестов, `__DSH_BOOT__`.

**Критерии верификации.** `pnpm ketos web` печатает `ketos web: http://…` и открывает 3080; `pnpm dsh web` продолжает работать; `pnpm run verify-application-entrypoints` зелёный; SDK-резолюция к `dsh` не сломана (спеки `packages/sdk/client`); readiness-тесты обновлены и зелёные; diff ограничен перечисленными файлами.

### 0.4. Пакеты `@ketos/*`, группа и констрейнты

**Цель.** Легализовать в форке собственный scope Кетоса и группу пакетов до создания первого из них.

**Контекст.** `scripts/check-workspace-constraints.ts` решает судьбу пакета по **директории**, а не по имени: `standardReleaseMemberDirectory` (строка 59, `/^(?:packages\/(?!experimental\/)[^/]+\/[^/]+|…)$/`) покрывает любой `packages/*/*`, кроме `experimental/`, и для release-member требует «не `private` + `publishConfig.access: public` + `repository`». Поэтому одного разрешения имени `@ketos/*` недостаточно: каталог `packages/ketos/<pkg>` попадёт в release-member и упадёт на `private: true`. Исправление — исключить `packages/ketos/` из regex; тогда сработает финальная ветка «не experimental и не release member → обязателен `private: true`». Отдельно: `checkDshFamilyVersion` применяет проверку версии только к именам `@deepseek-ai/dsh*`, поэтому версия `@ketos/*` гейтом не принуждается — равенство корневой версии остаётся нашим соглашением. `scripts/verify-subsystem-pages.ts` требует для группы README и либо страницу подсистемы, либо запись в `GROUPS_WITHOUT_SUBSYSTEM_PAGE`. Первый `@ketos/*`-пакет появляется в 0.5 (языковой пакет ru), поэтому политика принимается до него; пакеты Кетоса не публикуются: `private: true`, README группы; прочие гейты (client-packages, cordis-config, i18n) остаются включёнными.

**Задачи.**
1. В `scripts/check-workspace-constraints.ts` изменить `standardReleaseMemberDirectory` (строка 59): исключить `packages/ketos/` из release-member-ветки (негативный lookahead рядом с `experimental/`), чтобы для пакетов группы действовала ветка «обязателен `private: true`»; добавить регрессионный тест на приватный `packages/ketos/<pkg>`.
2. Создать `packages/ketos/README.md` и добавить группу в `GROUPS_WITHOUT_SUBSYSTEM_PAGE` с обоснованием «MVP-группа форка».
3. Зафиксировать в README группы соглашения: имя `@ketos/<name>`, тесты в `tests/`, README-секции, запрет публикации.
4. Прогнать `pnpm run constraints` на пустой группе и доказать, что правило принимает будущий пакет (тестовый манифест, затем удалить).

**Критерии верификации.** `pnpm run constraints` зелёный на пустой группе; regex-исключение `packages/ketos/` видно в скрипте и покрыто тестом; приватный тестовый манифест проходит, публичный (без `private`) — падает; README группы существует.

### 0.5. Дом `~/.ketos` и локаль ru

**Цель.** Все данные Кетоса живут в `~/.ketos`, интерфейс по умолчанию русский, при этом явный выбор пользователя (en) не перетирается.

**Контекст.** `resolveDshHome` (`packages/util/home-paths/src/index.ts:87-111`) уже поддерживает `$DSH_HOME`; профили, сессии, настройки и сторы получают пути через `dshHomePath(...)`. Самый чистый способ — задать `DSH_HOME` по умолчанию в `apps/cli/src/bin.ts` до инициализации app-boot; имя переменной и внутренний дефолт `~/.dsh` не меняются (решение 6). С локалью сложнее: базовые языки — `zh`/`en` (`LOCALE_IDS`), дефолт — браузерный/английский, языка `ru` в базе нет; `addLanguage` существует, но ничего не регистрирует. Значит, нужен первый пакет Кетоса — клиентский языковой пакет: `ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })` + регистрация ru-словарей; дефолт ставится только когда пользовательской настройки ещё нет (проверка `user`-секции неймспейса `locale` через `ctx.remote.settings.describe()`), чтобы не перетирать явный en. Патч-слой профиля дефолт задать не может — это код. Как и любой клиентский плагин, пакет требует трёх регистрационных поверхностей.

**Задачи.**
1. В `apps/cli/src/bin.ts` (или launcher-скрипте) установить `process.env.DSH_HOME ??= join(homedir(), '.ketos')`.
2. Создать `packages/ketos/client-locale-ru` (`@ketos/client-locale-ru`): `addLanguage('ru')`, ru-словари для common-неймспейса (включая строку фолбэк-заголовка) и продуктовых строк доски; дефолт `setLocale('ru')` только при отсутствии пользовательской настройки `locale`.
3. Подключить пакет по трём поверхностям (агрегат `tsconfig.client.json`, строка в `packages/bundle/web-app/cordis.patch.yml`, зависимость в `packages/bundle/web-app/package.json`).
4. Проверить: сессии — в `~/.ketos/sessions`, настройки — в `~/.ketos/settings.yaml`; `~/.dsh` не создаётся; при чистом доме интерфейс на русском; явное переключение на en сохраняется после перезагрузки.

**Критерии верификации.** `pnpm ketos web` на чистом доме показывает ru; `settings.yaml` содержит `locale: { preference: ru }` только как результат работы пакета; `~/.dsh` не создан; явный en не перетирается; `verify-client-packages` и `verify-cordis-config` зелёные.

### 0.6. Веб-бренд Кетос

**Цель.** Вкладка, PWA-манифест, бут-страница, сайдбар и стартовые тексты показывают Кетос.

**Контекст.** Трубопровод заголовка: `DSH_CLIENT_TITLE` (официальный дефолт в `scripts/client-build-environment.ts:20-23`) вшивается в HTML (`apps/web/index.html:8` + якорь `vite.config.ts:25`) и в динамические бандлы (`tsdown.client.ts:476-481`), а рантайм `AppFrame.tsx:192` использует `process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')`. Сайдбар: `ui-brand-official` активен ровно при `DSH_CLIENT_BUILD_PROFILE === 'official'` и рисует `FishLogo` + `BrandWordmark` (SVG-леттеринг, не текст); поддерживаемых профилей только `official` (`scripts/client-build-environment.ts:205`), поэтому новый профиль не вводим. Манифест PWA — `manifest.webmanifest:3-4` (`DeepSeek Harness`/`DSH`), фавикон — `favicon.svg` (тёмная схема; её проверяет `pwa-manifest.e2e.ts:29-35`). Бут-страница до плагинов печатает `'HARNESS'` (`packages/client/web/src/boot-page.ts:37`). Видимые тексты: `brand.localBuild` (`locale/src/locales/en.ts:33`, `zh.ts:31`) и `welcomeBody` (`ui-settings-models/src/client/locales.ts:96,203` + зеркало `apps/web/tests/scaffold.ts:107` и ожидание `apps/web/tests/expected/onboarding-deepseek-config/welcome.expected.md`). Снапшот-последствия: замена wordmark/заголовка не задевает committed ARIA-голдены, но требуют правок конкретные спеки (`built-boot.expected.e2e.ts:64-77`, `pwa-manifest.e2e.ts`, `ui-brand-official/tests/browser-plugin.client.spec.tsx:81-90`, `client-build-environment.client.spec.ts`, `release/families.spec.ts`); смена hero-копий (`Into the Unknown`) потребовала бы `DSH_SNAPSHOT=refresh`, поэтому hero не трогаем. Смена дефолта `DSH_CLIENT_TITLE` меняет официальную release-верификацию (`scripts/release/families.ts:332-335` сверяется с `OFFICIAL_CLIENT_BUILD_ENVIRONMENT`) — меняем их вместе.

**Задачи.**
1. Заголовок: `DSH_CLIENT_TITLE: 'Ketos'` в `OFFICIAL_CLIENT_BUILD_ENVIRONMENT`; локальный дефолт `apps/web/vite.config.ts:12` → `'Ketos Local Build'`; `index.html:8` синхронизировать с якорем `vite.config.ts:25`.
2. Манифест: `name: "Ketos"`, `short_name: "KETOS"`; фавикон заменить на знак Кетос, сохранив SVG + тёмную схему.
3. Артворк: заменить `FishLogo`/`BrandWordmark` в `ui-brand-official/src/client/Brand.tsx` на компоненты Кетос (локальные SVG в этом пакете); экспорты `ui-primitives` (`FishLogo`, hero-рыба) в MVP не менять — зафиксировать как Known Limitation.
4. Бут-страница: `'HARNESS'` → `'KETOS'` + обновить `boot-page.client.spec.ts:17`.
5. Видимые тексты: `brand.localBuild` → `Ketos`/`Ketos Local Build`; `welcomeBody` — заменить упоминания продукта на Кетос, синхронизировать зеркало `scaffold.ts:107` и `welcome.expected.md`; при материальном изменении копии — поднять `WELCOME_NOTICE_VERSION` (`onboarding-copy.ts:7-11`).
6. Обновить пинящие спеки и пересобрать: `pnpm run build` (литералы вшиваются в `lib/client.js`). Пинящие спеки: `apps/web/tests/built-boot.expected.e2e.ts` (viewBox и текст фолбэка), `apps/web/tests/pwa-manifest.e2e.ts` (name/short_name/favicon), `packages/client/ui-brand-official/tests/browser-plugin.client.spec.tsx` (viewBox), `packages/client/web/tests/boot-page.client.spec.ts` (`HARNESS`), `scripts/client-build-environment.client.spec.ts` и `scripts/dev-web.spec.ts` (литерал `DeepSeek Harness` в ожиданиях), `scripts/release/families.spec.ts` (title mismatch).
7. Не трогать: hero-копии, locale ids, слоты, `@deepseek-ai/*`, `__DSH_BOOT__`, model-visible промпты.

**Критерии верификации.** Заголовок вкладки, манифест, бут-страница и сайдбар (official-сборка) показывают Кетос; `DSH_SNAPSHOT=replay pnpm run test:web` зелёный после правок ожиданий; release-верификация официального окружения согласована; изменения ограничены перечнем 0.2.

### 0.7. Модель-видимая идентичность (опционально)

**Цель.** Дать Кетосу не представляться модели как DeepSeek Harness — без правки ядра и без массовой перезаписи снапшотов.

**Контекст.** Model-visible вхождения продукта: идентичность `You are an AI agent powered by DeepSeek Harness.` (`packages/core/system-prompt/src/index.ts:423`, гейт `includeHarnessIdentity`), web-surface промпт и описание `DSH_WEB_URL` (`packages/bundle/web-app/src/index.ts:139,246`), source-checkout секция (`packages/boot/app-boot/src/index.ts:860`), persona пресета `cordis` (`presets/cordis/agent.cordis.yml:22`). Решение 6 брендирует пользовательские поверхности, поэтому MVP-дефолт — **не трогать** эти строки и не нести 36 обновлений `system-prompt.expected.md` + спеки. Безопасный маршрут для тех, кому нужно: пользовательский patch-слой профиля (`$DSH_HOME/cordis.patch.yml` или `--patch`), заменяющий конфиг строки `system-prompt`: `includeHarnessIdentity: false` + кето-`personaPrefix` (патч заменяет конфиг целиком — остальные ключи перечисляются заново). Это не меняет shipped-композиции и снапшоты. Альтернатива «полный бренд в shipped-композиции» (правка identity-строки и патчей бандлов) требует перезаписи 36 prompt-сайдкаров, обновления 16 спек и веб-ожиданий — только отдельной брендинг-итерацией после MVP.

**Задачи.**
1. Зафиксировать в `docs/ketos/brand-inventory.md` раздел «model-visible» со списком вхождений и стоимостью обеих опций.
2. Записать пример пользовательского patch-слоя с `includeHarnessIdentity: false` и Ketos-`personaPrefix` в `docs/ketos/` и проверить его применение на локальном профиле.
3. Проверить, что отправка запроса с патчем не ломает сборку промпта (сравнить system-prompt до/после в dev-сессии) и что снапшоты при этом не меняются.
4. Принять решение по умолчанию: MVP — identity остаётся upstream-строкой (Known Limitation), полный бренд — отдельная итерация.

**Критерии верификации.** Раздел «model-visible» заполнен; пример патча применяется и не ломает сборку; `pnpm run test:snapshot` не требует изменений; решение зафиксировано письменно.

**Критерии верификации этапа 0.** `pnpm ketos web` работает и печатает `ketos web:`; данные в `~/.ketos`; ru по умолчанию и en по выбору; заголовок/манифест/сайдбар/бут-страница показывают Кетос; `pnpm run constraints`, `verify-application-entrypoints`, `verify-client-packages` зелёные; upstream-diff ограничен перечнем 0.2; запретный список не нарушен (grep-проверка); Agent Note по ребрендингу создан.

**Риски этапа 0.** Правки upstream-файлов конфликтуют при merge (митигация: карта 0.2 и отдельная серия коммитов, минимум файлов); переименование readiness-строки ломает парсеры (митигация: обновить всех потребителей из 0.3 и прогнать e2e); locale-плагин перетирает явный выбор языка (митигация: дефолт только при отсутствии `user`-секции); смена `DSH_CLIENT_TITLE` расходится с release-верификацией (митигация: менять `OFFICIAL_CLIENT_BUILD_ENVIRONMENT` и `families.ts` вместе).

## Сводный чек-лист этапа 0

### 0.1. Форк-репозиторий и фиксация базы

**Цель:** Создать репозиторий Кетос как soft-fork базы с двумя удалёнными репозиториями и зафиксированной точкой синхронизации; весь ребрендинг идёт отдельной серией коммитов до фичей.

- [ ] Создать удалённый репозиторий Кетос и клонировать в него текущее дерево; настроить `origin`/`upstream`.
- [ ] Зафиксировать базовый тег `ketos-base-d5675c2` и ветку `main` от `d5675c2`.
- [ ] Записать процедуру синхронизации (fetch upstream, merge по тегам, приёмка) в `docs/ketos/upstream-sync.md` — файл Кетоса вне upstream-дерева документации.
- [ ] Проверить, что `pnpm install && pnpm run build:native-system` проходит на чистом клоне.

- [ ] Критерий: `git remote -v` содержит `origin` (Кетос) и `upstream` (deepseek-harness); `git rev-parse HEAD` равен базовому коммиту, `git merge-base --is-ancestor c291e79 HEAD` и `--is-ancestor fe89719 HEAD` истинны; `pnpm install` завершается без ошибок; документ синхронизации описывает команды дословно; серия ребрендинга выделена в отдельные коммиты.

### 0.2. Карта брендинга и запретный список

**Цель:** Письменно закрепить каждую поверхность, где бренд виден пользователю, и каждую поверхность, которая остаётся внутренней.

- [ ] Создать `docs/ketos/brand-inventory.md` с тремя таблицами: «перебрендить сейчас» (пользовательские поверхности), «оставить внутренним» (запретный список), «model-visible — опционально (этап 0.7)».
- [ ] Для каждой пользовательской поверхности записать точный путь, строку и целевую замену (`Ketos`, `ketos`, `KETOS`).
- [ ] Зафиксировать правила написания: продукт — «Кетос» в русских текстах и `Ketos` в коде/латинице; CLI — `ketos`; пакеты — `@ketos/*`; данные — `~/.ketos`.
- [ ] Записать в документ проверочные `grep`-команды для поиска остаточных упоминаний и запретный список как явный чек-лист ревью.

- [ ] Критерий: Документ существует; ни одна найденная поверхность не осталась неклассифицированной; запретный список дословно совпадает с решением 6 и §2.3 Части I; grep-команды воспроизводимы.

### 0.3. CLI и лаунчер: `ketos`

**Цель:** Команда `ketos` запускает платформу и печатает брендированные строки; `dsh` остаётся рабочим внутренним алиасом.

- [ ] Добавить в корневой `package.json` скрипт `"ketos": "node --import tsx/esm apps/cli/src/bin.ts"`.
- [ ] Добавить `ketos` алиасом в bin-карту `apps/cli/package.json` (`dsh` остаётся); обновить allowlist `scripts/verify-application-entrypoints.ts` и его спек.
- [ ] Заменить пользовательские строки на `ketos`: `.name`/`.description` и `HELP_EXAMPLES` в `args.ts`; prefix строки `web-app/src/index.ts:271,274,277` → `ketos web:`; `startup.ts` name/description/examples; `sdk-app` name/description; headless-подсказки (`bundle/headless/src/startup.ts:53`, `src/index.ts:128,160,210`).
- [ ] Обновить константы диагностических префиксов (`profile-boot.ts`, `plugin.ts`, `dump-config.ts`) и `dsh:`-подсказки в `app-boot/src/profile.ts` на `ketos`.
- [ ] Обновить потребителей readiness-строки: тесты CLI/web/web-app и `scripts/publish-npm-baseline.ts:67`; синхронизировать фикстуру `apps/cli/tests/fixtures/web-browser-open/register.mjs`.
- [ ] Не трогать: `dsh`-скрипт, `@deepseek-ai/dsh`, `DSH_*`, имена профилей/бандлов, `dsh.*`-поля манифестов, `__DSH_BOOT__`.

- [ ] Критерий: `pnpm ketos web` печатает `ketos web: http://…` и открывает 3080; `pnpm dsh web` продолжает работать; `pnpm run verify-application-entrypoints` зелёный; SDK-резолюция к `dsh` не сломана (спеки `packages/sdk/client`); readiness-тесты обновлены и зелёные; diff ограничен перечисленными файлами.

### 0.4. Пакеты `@ketos/*`, группа и констрейнты

**Цель:** Легализовать в форке собственный scope Кетоса и группу пакетов до создания первого из них.

- [ ] В `scripts/check-workspace-constraints.ts` изменить `standardReleaseMemberDirectory` (строка 59): исключить `packages/ketos/` из release-member-ветки (негативный lookahead рядом с `experimental/`), чтобы для пакетов группы действовала ветка «обязателен `private: true`»; добавить регрессионный тест на приватный `packages/ketos/<pkg>`.
- [ ] Создать `packages/ketos/README.md` и добавить группу в `GROUPS_WITHOUT_SUBSYSTEM_PAGE` с обоснованием «MVP-группа форка».
- [ ] Зафиксировать в README группы соглашения: имя `@ketos/<name>`, тесты в `tests/`, README-секции, запрет публикации.
- [ ] Прогнать `pnpm run constraints` на пустой группе и доказать, что правило принимает будущий пакет (тестовый манифест, затем удалить).

- [ ] Критерий: `pnpm run constraints` зелёный на пустой группе; regex-исключение `packages/ketos/` видно в скрипте и покрыто тестом; приватный тестовый манифест проходит, публичный (без `private`) — падает; README группы существует.

### 0.5. Дом `~/.ketos` и локаль ru

**Цель:** Все данные Кетоса живут в `~/.ketos`, интерфейс по умолчанию русский, при этом явный выбор пользователя (en) не перетирается.

- [ ] В `apps/cli/src/bin.ts` (или launcher-скрипте) установить `process.env.DSH_HOME ??= join(homedir(), '.ketos')`.
- [ ] Создать `packages/ketos/client-locale-ru` (`@ketos/client-locale-ru`): `addLanguage('ru')`, ru-словари для common-неймспейса (включая строку фолбэк-заголовка) и продуктовых строк доски; дефолт `setLocale('ru')` только при отсутствии пользовательской настройки `locale`.
- [ ] Подключить пакет по трём поверхностям (агрегат `tsconfig.client.json`, строка в `packages/bundle/web-app/cordis.patch.yml`, зависимость в `packages/bundle/web-app/package.json`).
- [ ] Проверить: сессии — в `~/.ketos/sessions`, настройки — в `~/.ketos/settings.yaml`; `~/.dsh` не создаётся; при чистом доме интерфейс на русском; явное переключение на en сохраняется после перезагрузки.

- [ ] Критерий: `pnpm ketos web` на чистом доме показывает ru; `settings.yaml` содержит `locale: { preference: ru }` только как результат работы пакета; `~/.dsh` не создан; явный en не перетирается; `verify-client-packages` и `verify-cordis-config` зелёные.

### 0.6. Веб-бренд Кетос

**Цель:** Вкладка, PWA-манифест, бут-страница, сайдбар и стартовые тексты показывают Кетос.

- [ ] Заголовок: `DSH_CLIENT_TITLE: 'Ketos'` в `OFFICIAL_CLIENT_BUILD_ENVIRONMENT`; локальный дефолт `apps/web/vite.config.ts:12` → `'Ketos Local Build'`; `index.html:8` синхронизировать с якорем `vite.config.ts:25`.
- [ ] Манифест: `name: "Ketos"`, `short_name: "KETOS"`; фавикон заменить на знак Кетос, сохранив SVG + тёмную схему.
- [ ] Артворк: заменить `FishLogo`/`BrandWordmark` в `ui-brand-official/src/client/Brand.tsx` на компоненты Кетос (локальные SVG в этом пакете); экспорты `ui-primitives` (`FishLogo`, hero-рыба) в MVP не менять — зафиксировать как Known Limitation.
- [ ] Бут-страница: `'HARNESS'` → `'KETOS'` + обновить `boot-page.client.spec.ts:17`.
- [ ] Видимые тексты: `brand.localBuild` → `Ketos`/`Ketos Local Build`; `welcomeBody` — заменить упоминания продукта на Кетос, синхронизировать зеркало `scaffold.ts:107` и `welcome.expected.md`; при материальном изменении копии — поднять `WELCOME_NOTICE_VERSION` (`onboarding-copy.ts:7-11`).
- [ ] Обновить пинящие спеки и пересобрать: `pnpm run build` (литералы вшиваются в `lib/client.js`). Пинящие спеки: `apps/web/tests/built-boot.expected.e2e.ts` (viewBox и текст фолбэка), `apps/web/tests/pwa-manifest.e2e.ts` (name/short_name/favicon), `packages/client/ui-brand-official/tests/browser-plugin.client.spec.tsx` (viewBox), `packages/client/web/tests/boot-page.client.spec.ts` (`HARNESS`), `scripts/client-build-environment.client.spec.ts` и `scripts/dev-web.spec.ts` (литерал `DeepSeek Harness` в ожиданиях), `scripts/release/families.spec.ts` (title mismatch).
- [ ] Не трогать: hero-копии, locale ids, слоты, `@deepseek-ai/*`, `__DSH_BOOT__`, model-visible промпты.

- [ ] Критерий: Заголовок вкладки, манифест, бут-страница и сайдбар (official-сборка) показывают Кетос; `DSH_SNAPSHOT=replay pnpm run test:web` зелёный после правок ожиданий; release-верификация официального окружения согласована; изменения ограничены перечнем 0.2.

### 0.7. Модель-видимая идентичность (опционально)

**Цель:** Дать Кетосу не представляться модели как DeepSeek Harness — без правки ядра и без массовой перезаписи снапшотов.

- [ ] Зафиксировать в `docs/ketos/brand-inventory.md` раздел «model-visible» со списком вхождений и стоимостью обеих опций.
- [ ] Записать пример пользовательского patch-слоя с `includeHarnessIdentity: false` и Ketos-`personaPrefix` в `docs/ketos/` и проверить его применение на локальном профиле.
- [ ] Проверить, что отправка запроса с патчем не ломает сборку промпта (сравнить system-prompt до/после в dev-сессии) и что снапшоты при этом не меняются.
- [ ] Принять решение по умолчанию: MVP — identity остаётся upstream-строкой (Known Limitation), полный бренд — отдельная итерация.

- [ ] Критерий: Раздел «model-visible» заполнен; пример патча применяется и не ломает сборку; `pnpm run test:snapshot` не требует изменений; решение зафиксировано письменно.

### Приёмка этапа

- [ ] `pnpm ketos web` работает и печатает `ketos web:`; данные в `~/.ketos`; ru по умолчанию и en по выбору; заголовок/манифест/сайдбар/бут-страница показывают Кетос; `pnpm run constraints`, `verify-application-entrypoints`, `verify-client-packages` зелёные; upstream-diff ограничен перечнем 0.2; запретный список не нарушен (grep-проверка); Agent Note по ребрендингу создан.

## Источники

- Часть II, «Этап 0» — взят дословно (раздел «План этапа 0»).
- §II.4 «Единые правила выполнения» и §6.1 «Команды по типу изменения» — скопированы дословно.
- Контекст: «2.2 Сверка исходного плана с кодовой базой», «2.3 Обязательные правила базы (соблюдать в каждой фазе)», «Ф0. Bootstrap и брендинг (Спайк 1)», «II.1. Границы MVP».
- Приложение A: решения 3, 5, 6, 30, 31.
- Мастер-файл: `ketos_v7_master_instruction.md` (в этой же папке).
