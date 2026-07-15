# План редизайна: перенос настроек и аккаунта из верхней панели в низ левого сайдбара Ketos

> Документ подготовлен на основе анализа кодовой базы (Graphify-граф `graphify-out/graph.json`, 5 параллельных исследовательских субагентов) и двух визуальных референсов целевого интерфейса. Все пути указаны относительно корня репозитория. Документ предназначен для исполнения Claude Code одним или несколькими агентами.

---

## 1. Цель редизайна

Перенести все элементы управления аккаунтом и настройками приложения из правого верхнего угла (`AppHeader` → `AccountMenu`) в левый нижний угол боковой панели дашборда (`folderSidebarComponent`), где должна появиться постоянная карточка пользователя (аватар + имя + подпись workspace). По клику на карточку открывается выпадающее меню **вверх** со всеми существующими пунктами: шапка с данными пользователя, Settings, переключатель темы Light/Dark/System, Documentation, версия приложения с индикатором актуальности, Sign out (и условный Admin page). Верхняя панель после редизайна содержит только логотип слева и колокольчик уведомлений справа.

При этом: ни одна существующая функция не теряется, дубли кнопок устраняются, обе темы поддерживаются, интерфейс остаётся адаптивным, результат визуально сверяется с референсами.

## 2. Целевая концепция интерфейса

- **Сайдбар (низ):** карточка пользователя — закруглённый контейнер на всю ширину сайдбара, приглушённый фон, внутри: круглый аватар с инициалами («KU», тёмно-синий фон, белый текст), имя пользователя полужирным, вторая строка «Ketos workspace» приглушённым цветом, справа шеврон (вниз — закрыто, вверх — открыто).
- **Меню (открытое состояние):** раскрывается вверх от карточки, ширина равна ширине карточки, визуально примыкает к ней. Состав сверху вниз:
  1. Шапка: аватар + имя + идентификатор аккаунта (email/username);
  2. разделитель;
  3. **Settings** (иконка шестерёнки) → `/settings`;
  4. **Theme** (иконка палитры) + встроенный сегментированный переключатель `[Light | Dark | System]` с подсветкой активного сегмента;
  5. **Documentation** (иконка книги) → внешняя ссылка;
  6. разделитель;
  7. **Version 1.x.x** + зелёная галочка и зелёный текст `(latest)` при актуальной версии (жёлтый `(update available)` при устаревшей);
  8. разделитель;
  9. **Sign out** (иконка выхода);
  10. условно (как сегодня): **Admin page** при `isAdmin && !autoLogin`.
- **Верхняя панель:** слева логотип Ketos (навигация на `/`), справа только колокольчик уведомлений с badge. На странице редактора флоу по центру остаётся `FlowMenu` (имя флоу/сохранение) — он не относится к настройкам аккаунта.
- **Состояния карточки/меню:** closed (нейтральный фон), hover (усиление фона `hover:bg-accent`-класс токенов), active/pressed, open (шеврон вверх, карточка визуально «слита» с меню). Все состояния — в обеих темах.

## 3. Анализ приложенных референсов

Из двух референс-скриншотов (светлая тема; тёмная выводится из системы токенов) извлечены следующие факты:

| Элемент референса | Наблюдение |
|---|---|
| Карточка пользователя | Низ левого сайдбара; аватар-инициалы «KU» на тёмно-синем круге; имя «Kirill Ustyuzhanin»; подпись «Ketos workspace»; шеврон справа; фон карточки чуть темнее фона сайдбара, скругление ~12px |
| Открытое меню | Расширяется вверх, шире свёрнутой карточки не становится; шапка меню: аватар + имя + `kirill@ketos.app` |
| Пункты меню | Settings (шестерёнка), Theme (палитра) с сегментированным контролом `Light｜Dark｜System` (активный сегмент — «Light» — выделен рамкой/фоном), Documentation (книга), `Version 1.10.2` с зелёной галочкой и зелёным `(latest)`, Sign out (выход) — разделены тонкими линиями |
| Верхняя панель | Только логотип слева и колокольчик справа; никаких аватара/шестерёнки/темы |
| Сайдбар | Сверху «Projects» (+ иконки upload/add), список проектов, ниже — навигация Knowledge и My Files, в самом низу — карточка пользователя |
| Прочее | Контентная область (Flows/MCP Server, поиск, список флоу) не меняется |

Соответствие текущему коду: сегментированный переключатель темы уже существует 1:1 (`ThemeButtons`), логика версии/`(latest)` уже существует (включая ключ i18n `account.latest` и зелёный класс `text-accent-emerald-foreground`), пункты Settings/Docs/Sign out существуют в `AccountMenu`. Новыми являются: аватар-инициалы, шапка меню с именем/идентификатором, подпись «Ketos workspace», зелёная галочка у версии, постоянные иконки слева у пунктов меню, раскрытие меню вверх и сама карточка в сайдбаре.

**Трактовка «основных, тематических, расширенных и всех существующих настроек» из ТЗ.** В меню попадают все существующие настройки приложения: «основные» = пункт Settings, ведущий на `/settings` (внутри — General, Language, MCP Servers/Client, Global Variables, Model/DB Providers, Shortcuts, Messages), «тематические» = встроенный переключатель Theme, «все существующие» = Version/Documentation/Sign out/Admin page. Отдельного раздела «расширенные» (Advanced) в кодовой базе **не существует** (`grep -i advanced` по `SettingsPage` пуст) — создавать его план не предусматривает (это было бы добавлением новой функции сверх задачи). Если под «расширенными» подразумевалось нечто конкретное — требуется уточнение пользователя до этапа 1 (см. риск №13).

## 4. Текущее состояние кодовой базы (результаты анализа)

### 4.1 Стек
React 19.2.1, react-router-dom 6, Zustand 4 + TanStack Query 5, Tailwind CSS 3.4 (darkMode: `class`), Radix UI-примитивы в стиле shadcn (`src/frontend/src/components/ui/*`), Vite 7, Jest 30 (unit) + Playwright (e2e), Biome (lint/format), i18next (2 локали (en, ru)).

### 4.2 Layout и точки монтирования
- `src/frontend/src/pages/DashboardWrapperPage/index.tsx:9-13` — `h-screen flex-col`: `<AppHeader />` (фикс. высота `h-[48px]`) + `<Outlet/>`. Высоты считаются flexbox'ом, хардкода `calc()` нет.
- `AppHeader` — `src/frontend/src/components/core/appHeaderComponent/index.tsx`: левая секция (`KetosBrandMark` + пустышка `CustomOrgSelector`), центр (`FlowMenu`, только на `/flow/:id`), правая секция: выключенный `ModelProviderCount` (`{false && …}`), колокольчик `AlertDropdown` (`notification_button`), `Separator`, `CustomAccountMenu`.
- Сайдбар дашборда — `SideBarFoldersButtonsComponent` (`src/frontend/src/components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx`), монтируется только в `src/frontend/src/pages/MainPage/pages/main-page.tsx:62-76` внутри `<SidebarProvider width="280px">`. На `/flow/:id` этот сайдбар **не рендерится** (отдельная ветка роутинга, `routes.tsx:186-191`).
- В сайдбаре уже есть `SidebarFooter` (строки 508-531) с кнопками Knowledge/My Files, но он целиком обёрнут флагом `ENABLE_FILE_MANAGEMENT`.

### 4.3 AccountMenu (что переносится)
`src/frontend/src/components/core/appHeaderComponent/components/AccountMenu/index.tsx` (подключён через обёртку `customization/components/custom-AccountMenu.tsx`):
1. Блок версии (`menu_version_button`): `version`/`latestVersion` из `useDarkStore`, сравнение `stripReleaseStageFromVersion` (`@/utils/utils`), классы `text-accent-emerald-foreground`/`text-accent-amber-foreground`, ключи `account.latest`/`account.updateAvailable` (`locales/en.json:440-441`).
2. Settings (`menu_settings_button`) → `navigate("/settings")`.
3. Admin page (`menu_admin_page_button`) — `isAdmin && !autoLogin`.
4. Docs (`menu_docs_button`) — `ENABLE_DATASTAX_KETOS ? DATASTAX_DOCS_URL : DOCS_URL` (`constants/constants.ts:928-929`).
5. Theme — лейбл + `<ThemeButtons/>`.
6. Logout — `useLogout()` (`controllers/API/queries/auth/use-post-logout.ts`), скрыт при `autoLogin || hideLogoutButton` (`utilityStore`).

Триггер: `HeaderMenuToggle` (`user_menu_button`) с `CustomProfileIcon` (`user-profile-settings`) и статичной иконкой `ChevronsUpDown`.

### 4.4 Тема
- `useDarkStore` (`stores/darkStore.ts`) — `dark: boolean`, localStorage-ключ `ketos-is-dark`; класс `dark` навешивается на `<body id="body">` в `App.tsx:8-16`.
- `useTheme()` (`customization/hooks/use-custom-theme.ts`) — preference `light|dark|system`, localStorage-ключ `ketos-theme-preference`, подписка на `matchMedia`. Побочный вызов `useTheme()` есть в `AppHeader` (index.tsx:23) — при выносе меню из хедера подписку нельзя потерять.
- `ThemeButtons` (`appHeaderComponent/components/ThemeButtons/index.tsx`) — готовый сегментированный контрол Light/Dark/System со скользящим индикатором; testid `menu_light_button`/`menu_dark_button`/`menu_system_button`. **Также импортируется** в `modals/IOModal/playground-modal.tsx:5,432` — компонент нельзя перемещать/ломать, только переиспользовать.
- Вызов `useTheme()` **уже задублирован**: он есть и в `AppHeader` (`appHeaderComponent/index.tsx:23`), и выше по дереву в `DashboardWrapperPage/index.tsx:6` (монтируется на всех защищённых маршрутах, включая `/flow/:id`). Удаление меню из хедера подписку не потеряет — достаточно убрать дублирующий вызов из `AppHeader` (или оставить его как безвредный дубль).
- CSS-токены: `style/index.css` — `:root` (light, строки 7-219) и `.dark` (221-494). Токены `--sidebar-*` определены **только в `.dark`** (430-437) и **нигде не используются** (нет маппинга в `tailwind.config.mjs`) — мёртвый набор; в новом коде использовать стандартные токены (`--background`, `--muted`, `--accent`, `--border`, `--popover`…), а не `--sidebar-*`.

### 4.5 Пользователь
- Тип `Users` (`types/api/index.ts:211-226`): `{ id, username, is_active, is_superuser, profile_image, preferred_locale?, create_at, updated_at, optins? }`. **Полей `email` и `full_name` нет** — только `username`.
- `ProfileIcon` (`appHeaderComponent/components/ProfileIcon/index.tsx`) — `<img>` из `AuthContext.userData.profile_image` с URL `${BASE_URL_API}files/profile_pictures/…`, фолбэк `Space/046-rocket.svg`. Также используется в чат-сообщениях (playground/assistant) — не ломать.
- Компонента аватара-инициалов и `ui/avatar.tsx` **нет**; утилиты `getInitials` нет; есть массив `gradients` (`utils/styleUtils.ts:17`) как фолбэк-фон.
- Auth: `useAuthStore` (`stores/authStore.ts`) — `isAdmin`, `autoLogin`, `userData`, `logout()`; `AuthContext` (`contexts/authContext.tsx`) параллельно держит `userData`.

### 4.6 Dropdown-примитивы
- `components/ui/dropdown-menu.tsx` — обёртка Radix, `DropdownMenuContent` пробрасывает весь нативный API (`side`, `align`, `sideOffset`…). Прецеденты `side="top"` уже есть: `canvasControlsComponent/CanvasControlsDropdown.tsx:121-124`, `HelpDropdownView.tsx:58`. Контент рендерится в портал (`document.body`, `z-50`) — обрезание overflow сайдбара не грозит.
- `HeaderMenuItems` (`HeaderMenu/index.tsx:74-88`) поддерживает только `position: "left"|"right"` и **не** пробрасывает `side` — для меню «вверх» либо расширить, либо (надёжнее) собрать новое меню напрямую на `ui/dropdown-menu`.
- Паттерн динамического шеврона open/closed уже есть: `CanvasControlsDropdown.tsx:113-117`.

### 4.7 Дубли и «сироты»
- Переключатель темы — только в `AccountMenu` (дублей нет); прямые ссылки на подстраницы настроек из модалок/Help-меню (`/settings/shortcuts`, `/settings/mcp-servers`, `/settings/api-keys`, `/settings/db-providers`) — контекстные ссылки, не дубли, сохраняются.
- `CustomOrgSelector`, `custom-header.tsx`, `custom-header-menu-items-title.tsx`, `custom-feature-flag-menu-items.tsx` — пустышки `<></>`; `ModelProviderCount` в хедере выключен `{false && …}` — мёртвый код.
- Страница `/settings/api-keys` существует в роутере, но отсутствует в навигации SettingsPage (скрытая) — фиксируем как факт, в объём задачи не входит.

### 4.8 Тесты и testid (полный инвентарь затронутого)
- **testid:** `app-header`, `header_left_section_wrapper`, `header_right_section_wrapper`, `notification_button`, `user-profile-settings`, `user_menu_button`, `menu_version_button`, `menu_settings_button`, `menu_admin_page_button`, `menu_docs_button`, `menu_light_button`, `menu_dark_button`, `menu_system_button`, `project-sidebar`, `sidebar-nav-{name}`. Централизованная константа: `tests/utils/constants/testIds.ts:13` (`userProfileSettings`).
- **Ключевые e2e-хелперы:** `tests/utils/add-new-user-and-loggin.ts:67,95,99` и `tests/utils/go-to-settings.ts:11` — оба кликают `user-profile-settings`; через них проходит большинство e2e.
- **Spec-файлы с прямыми ссылками:** `auto-login-off.spec.ts`, `user-flow-state-cleanup.spec.ts`, `localization-russian-manifest.spec.ts`, `general-bugs-remove-session-after-logout.spec.ts`, `userSettings.spec.ts`, `notifications.spec.ts`, `mcp-server.spec.ts` (самый тяжёлый), `generalBugs-shard-1.spec.ts`, `generalBugs-shard-13.spec.ts`; косвенно — `modelProviderModal.spec.ts`, `mcp-server-starter-projects.spec.ts`.
- **Unit:** `AccountMenu/__tests__/account-menu.test.tsx` (мокает `../../HeaderMenu/index`, `../../ThemeButtons/index` относительными путями — перенос файлов ломает моки), `HeaderMenu/__tests__/HeaderMenu.spec.tsx`, `stores/__tests__/darkStore.test.ts`, `ui/__tests__/sidebar.test.tsx`.
- **Контрактные тесты:** `src/frontend/src/__tests__/taREDACTED_OPENAI_API_KEY.test.ts` — грепает **по путям файлов** `appHeaderComponent/index.tsx`, `AccountMenu/index.tsx`, `ThemeButtons/index.tsx` и по строкам `aria-label={t(…)}`; `taREDACTED_OPENAI_API_KEY.test.ts:280-297` — требует `KetosBrandMark` среди visual-consumers, включая `appHeaderComponent/index.tsx` (assert на строке 297). Следствие: **файлы `AccountMenu` и `ThemeButtons` не перемещать физически**, либо синхронно править контрактные тесты.
- **i18n-гейты:** `npm run test:i18n`, `i18n:check-keys` (рассинхрон ключей между 2 локалями (en, ru) = падение CI), `i18n:check:hardcoded` (детектор захардкоженных строк).

## 5. Затрагиваемые файлы и компоненты

### Новые файлы
| Файл | Назначение |
|---|---|
| `src/frontend/src/components/core/sidebarAccountComponent/index.tsx` | `SidebarAccountCard` — карточка пользователя + upward-dropdown (собран напрямую на `ui/dropdown-menu`) |
| `src/frontend/src/components/core/sidebarAccountComponent/components/avatar-initials.tsx` | Аватар с инициалами (fallback — существующий `profile_image`, если задан) |
| `src/frontend/src/components/core/sidebarAccountComponent/utils/get-initials.ts` | Утилита извлечения инициалов из `username` |
| `src/frontend/src/components/core/sidebarAccountComponent/__tests__/sidebar-account.test.tsx` | Unit-тесты карточки и меню |
| `src/frontend/src/customization/components/custom-sidebar-account.tsx` | Обёртка кастомизации (по образцу `custom-AccountMenu.tsx`) |

### Изменяемые файлы
| Файл | Изменение |
|---|---|
| `src/frontend/src/components/core/folderSidebarComponent/components/sideBarFolderButtons/index.tsx` | Добавить карточку в низ сайдбара **вне** условия `ENABLE_FILE_MANAGEMENT` (строка 508) |
| `src/frontend/src/components/core/appHeaderComponent/index.tsx` | Убрать `CustomAccountMenu` + `Separator` из правой секции на dashboard-маршрутах; сохранить `useTheme()`-подписку (перенести в `DashboardWrapperPage` или `App`); колокольчик остаётся |
| `src/frontend/src/components/core/appHeaderComponent/components/AccountMenu/index.tsx` | Остаётся (условный рендер только на `/flow/:id` — см. решение Р-1) либо помечается deprecated |
| `src/frontend/src/locales/{en,ru}.json` | Новые ключи `account.workspace`, `account.signOut` (если отличен от `account.logout`) и пр. — синхронно в 2 локалях (en, ru) |
| `src/frontend/tests/utils/constants/testIds.ts` | Новые константы testid карточки (старые значения сохраняются) |
| `src/frontend/tests/utils/add-new-user-and-loggin.ts`, `tests/utils/go-to-settings.ts` | Актуализация локаторов (если DOM-контекст изменился) |
| `src/frontend/src/__tests__/taREDACTED_OPENAI_API_KEY.test.ts` | Только если меняются проверяемые файлы/aria-label |
| Spec-файлы из §4.8 | Точечные правки локаторов при необходимости |

### Не трогать
`ThemeButtons` (переиспользуется из текущего пути), `ProfileIcon` (используется в чатах), `ui/sidebar.tsx` (общий примитив трёх сайдбаров; FlowPage-сайдбар манипулирует его DOM напрямую), `ui/dropdown-menu.tsx`, `FlowMenu`, `AlertDropdown`, роуты `/settings/*`, локфайлы, `LICENSE`/`NOTICE`.

## 6. Архитектурные, UX- и визуальные решения

- **Р-1 (доступ к меню на `/flow/:id`) — требует подтверждения пользователя.** На странице редактора флоу нет дашборд-сайдбара, значит после «чистого» удаления меню из хедера пользователь в редакторе теряет доступ к Settings/Theme/Sign out/версии — это нарушает требование «сохранение существующей функциональности». **Рекомендация:** оставить `CustomAccountMenu` в хедере **только** на `/flow/:id` (условие `onFlowPage`, уже вычисляемое в `AppHeader`), на остальных маршрутах — только логотип и колокольчик, как в референсах (референсы показывают именно дашборд). Альтернативы: (а) полностью убрать и принять регресс; (б) отдельный мини-триггер аккаунта в хедере flow-страницы.
- **Р-2 (dropdown вверх):** новое меню собирается напрямую на `ui/dropdown-menu` c `side="top"`, `align="start"`, `sideOffset={4}`, ширина `w-[--radix-dropdown-menu-trigger-width]` (Radix-переменная равна ширине триггера — карточки) — это даёт «слияние» меню с карточкой без кастомных хаков. `HeaderMenuItems` не расширяем (меньше риска для `AccountMenu`, который остаётся для flow-страницы).
- **Р-3 (данные карточки):** имя — `userData.username`; вторая строка карточки — i18n-ключ `account.workspace` («Ketos workspace»; в коде концепции workspace нет — это статичная подпись); строка идентификатора в шапке меню — `username` (поля `email` в типе `Users` нет; если username — email, отображение совпадёт с референсом). Бэкенд не трогаем.
- **Р-4 (аватар):** инициалы из `username` (первые буквы двух первых слов, либо первые 2 символа); фон — токен `bg-primary` c `text-primary-foreground` (в light-теме primary тёмный — совпадает с navy референса), НЕ хардкод-цвет. Если у пользователя задан `profile_image` — показывать картинку (сохранение существующей функциональности выбора аватара в `/settings/general`).
- **Р-5 (testid-стратегия):** новые элементы получают **те же значения** testid, что и старые (`user-profile-settings` на карточке, `user_menu_button` на триггере, `menu_settings_button`, `menu_light/dark/system_button`, `menu_version_button`, `menu_docs_button`, `menu_admin_page_button`) — тогда e2e-хелперы продолжают работать почти без правок. На flow-странице при сохранении старого `AccountMenu` возникнут дубли testid в DOM только если оба смонтированы одновременно — исключено, т.к. сайдбар и flow-хедер-меню не существуют на одном маршруте.
- **Р-6 (темы):** только существующие семантические токены: карточка — `bg-muted/50` + `hover:bg-muted`, текст — `text-foreground`/`text-muted-foreground`, меню — `bg-popover text-popover-foreground border-border` (dropdown-menu уже стилизован), версия — существующие `text-accent-emerald-foreground`/`text-accent-amber-foreground`. Мёртвые `--sidebar-*` токены не подключать (вне объёма).
- **Р-7 (состояния):** closed / hover (`hover:bg-muted`, курсор pointer) / active-press (`active:` или `data-[state=open]`) / open (шеврон `ChevronUp`, карточка `data-[state=open]:bg-muted`); пункты меню — стандартные hover/focus стили `DropdownMenuItem` (клавиатурная навигация Radix бесплатно). Направление шеврона — по референсам: закрыто → вниз, открыто → вверх. `CanvasControlsDropdown.tsx:113-117` цитируется **только** как образец техники динамической смены иконки по `open`-состоянию; направление там обратное (`isOpen ? "ChevronDown" : "ChevronUp"`) и копироваться не должно.
- **Р-8 (условная логика — переносится 1:1):** Admin page: `isAdmin && !autoLogin`; Sign out: `!autoLogin && !hideLogoutButton`; Docs: `ENABLE_DATASTAX_KETOS ? DATASTAX_DOCS_URL : DOCS_URL`; версия: `stripReleaseStageFromVersion`. Карточка размещается **вне** `ENABLE_FILE_MANAGEMENT`.
- **Р-9 (адаптивность):** сайдбар уже offcanvas при ширине <1024px (`useIsMobile({maxWidth:1024})`), открывается `SidebarTrigger`-ом — карточка едет вместе с сайдбаром и остаётся доступной после его открытия. Это принимаемое изменение UX на узких экранах (меню аккаунта — за один тап по триггеру сайдбара); фиксируется в проверочных сценариях. Дополнительных брейкпоинтов не вводим.
- **Р-10 (i18n):** все новые строки — через `t()`; новые ключи добавляются синхронно в 2 локали (en, ru); повторно используем существующие `account.*` ключи (`account.settings`, `account.docs`, `account.theme`, `account.logout`, `account.version`, `account.latest`, `account.updateAvailable`, `theme.light/dark/system`).

## 7. Подробные этапы реализации

> Формат каждого этапа: **Цель / Задачи / Файлы / Зависимости / Параллельность / Критерий выполнения / Проверка**.

### Этап 0. Подготовка и базовая линия
- **Цель:** зафиксировать текущее поведение и получить эталонные скриншоты «до».
- **Задачи:** создать ветку (`git checkout -b redesign/sidebar-account`); запустить бэкенд+фронтенд (`make backend`, `make frontend` или dev-конфиг `.claude/launch.json`); снять скриншоты дашборда и открытого `AccountMenu` в light и dark; прогнать быстрые гейты (`npm run type-check`, `make test_frontend` по затронутым паттернам) для чистой базовой линии.
- **Файлы:** нет изменений.
- **Зависимости:** нет. **Параллельность:** нет (первый шаг).
- **Критерий:** приложение открывается в браузере, скриншоты «до» сохранены, базовые тесты зелёные.
- **Проверка:** скриншоты в scratchpad/артефактах; вывод команд без ошибок.

### Этап 1. Новые компоненты: карточка, аватар-инициалы, upward-меню
- **Цель:** изолированно собрать `SidebarAccountCard` со всеми состояниями и пунктами.
- **Задачи:**
  1. `get-initials.ts` + unit-тесты (пустой username, один символ, кириллица, слова через пробел/точку).
  2. `avatar-initials.tsx`: круг `bg-primary text-primary-foreground`; если `userData.profile_image` задан — `<img>` тем же URL-паттерном, что `ProfileIcon`.
  3. `index.tsx` (`SidebarAccountCard`): триггер-карточка (аватар, `username`, `t("account.workspace")`, шеврон `ChevronDown/ChevronUp` по `open`-состоянию — паттерн из `CanvasControlsDropdown.tsx:113-117`); `DropdownMenu` + `DropdownMenuContent side="top" align="start" sideOffset={4}` шириной по триггеру; пункты меню по §2 с постоянными иконками слева (`Settings`, `Palette`, `BookOpen`, `LogOut` через `ForwardedIconComponent`); блок версии с галочкой `Check`; `<ThemeButtons/>` импортируется из текущего пути; вся условная логика Р-8; testid по Р-5.
  4. `custom-sidebar-account.tsx` — обёртка-прокси.
  5. i18n: добавить недостающие ключи (минимум `account.workspace`) в 2 локали (en, ru).
  6. Unit-тесты: рендер карточки; скрытие Sign out при `hideLogoutButton`/`autoLogin`; показ Admin page при `isAdmin && !autoLogin`; выбор docs-URL по флагу; отображение `(latest)`/`(update available)`.
- **Файлы:** новые из §5 + 2 файла локалей (en, ru).
- **Зависимости:** этап 0. **Параллельность:** задачи 1–2, 5 и 6 независимы; компонент (3) — после 1–2.
- **Критерий:** `make test_frontend` зелёный по новым тестам; `npm run test:i18n` и `i18n:check-keys` зелёные; `npm run type-check` без ошибок.
- **Проверка:** вывод jest/i18n-скриптов.

### Этап 2. Интеграция карточки в сайдбар
- **Цель:** карточка постоянно видна в самом низу дашборд-сайдбара.
- **Задачи:** в `sideBarFolderButtons/index.tsx` добавить после существующего условного `SidebarFooter` (или объединив разметку) блок с `<CustomSidebarAccount/>` **вне** `ENABLE_FILE_MANAGEMENT`; убедиться, что спейсер `<div className="flex-1"/>` (строка 500) прижимает низ; `border-t` между Knowledge/My Files и карточкой согласно референсу.
- **Файлы:** `sideBarFolderButtons/index.tsx`.
- **Зависимости:** этап 1. **Параллельность:** можно вести параллельно с этапом 3 (разные файлы).
- **Критерий:** на `/flows` карточка видна внизу сайдбара; меню открывается вверх, не обрезается, ширина равна карточке; при `ENABLE_FILE_MANAGEMENT=false` (локальная проверка правкой флага) карточка остаётся.
- **Проверка:** скриншоты light/dark; ручная проверка открытия/закрытия; существующий e2e `folders.spec.ts` зелёный.

### Этап 3. Очистка хедера
- **Цель:** правая секция хедера — только колокольчик (на dashboard-маршрутах).
- **Задачи:** в `appHeaderComponent/index.tsx` обернуть `Separator` + `CustomAccountMenu` условием `onFlowPage` (решение Р-1) либо удалить полностью (если пользователь выберет альтернативу); убрать дублирующий вызов `useTheme()` из `AppHeader` (index.tsx:23) — подписка сохраняется, т.к. `DashboardWrapperPage/index.tsx:6` уже вызывает `useTheme()` на всех защищённых маршрутах (проверить это перед удалением; допустимо и оставить дубль — он безвреден); `KetosBrandMark` и `notification_button` не трогать (контрактный тест task-13, e2e notifications).
- **Файлы:** `appHeaderComponent/index.tsx`, `DashboardWrapperPage/index.tsx`.
- **Зависимости:** этап 1 (чтобы функциональность не исчезала раньше, чем появилась замена). **Параллельность:** параллельно с этапом 2.
- **Критерий:** на `/flows` в правом углу только колокольчик; на `/flow/:id` — колокольчик + (по Р-1) аккаунт-меню; тема продолжает реагировать на смену системной темы.
- **Проверка:** скриншоты обеих страниц; unit `account-menu.test.tsx` зелёный; ручная проверка system-темы через эмуляцию `prefers-color-scheme`.

### Этап 4. Актуализация тестов
- **Цель:** зелёный CI без потери покрытия.
- **Задачи:** проверить/обновить `add-new-user-and-loggin.ts` и `go-to-settings.ts` (testid сохранены — ожидаются минимальные правки: возможно, теперь надо сперва убедиться, что сайдбар видим); прогнать и починить spec-файлы из §4.8; проверить контрактные тесты task-9/task-13 (пути и aria-label не менялись — должны пройти без правок; если правились aria-label — синхронизировать); добавить e2e-сценарий карточки (открытие меню, переключение темы, переход в Settings, Sign out) — расширением `userSettings.spec.ts` или новым spec.
- **Файлы:** тестовые из §5.
- **Зависимости:** этапы 2–3. **Параллельность:** unit и e2e — параллельно.
- **Критерий:** `make test_frontend`, `make lint` (или `cd src/frontend && npm run lint`), `npm run type-check` (make-обёртки нет), `npm run test:i18n` зелёные; Playwright-подмножество из §4.8 зелёное (`make tests_frontend` либо адресный `npx playwright test <specs> --project=chromium`).
- **Проверка:** полный вывод команд (см. §10, этап 4).

### Этап 5. Визуальная сверка с референсами и итерации
- **Цель:** пиксельно-смысловое соответствие референсам в обеих темах и на всех ширинах.
- **Задачи:** итерационный цикл §-«Iteration loop» (ниже); сверка чек-листа §13; правка отступов/радиусов/цветов до совпадения.
- **Файлы:** стили новых компонентов.
- **Зависимости:** этапы 2–4. **Параллельность:** нет (единый визуальный контур).
- **Критерий:** каждый пункт таблицы §3 воспроизведён; расхождения либо устранены, либо явно задокументированы как ограничения (например, отсутствие поля email).
- **Проверка:** пары скриншотов «референс/результат» light+dark, 1280px/1024px/375px.

### Итерационный цикл (используется в этапах 2, 3, 5)
```
анализ → реализация → запуск (make frontend + backend / launch.json)
→ скриншоты (browser-инструменты: дашборд, карточка closed/hover/open, обе темы, 3 ширины)
→ сравнение с референсами (§3, чек-лист §13)
→ исправление отклонений → повторная проверка (до 0 расхождений)
```

## 8. Распределение задач между агентами

| Агент | Модель | Задача | Этапы |
|---|---|---|---|
| Координатор | Fable 5 | декомпозиция, ревью диффов, визуальная сверка, итоговые гейты | все |
| Impl-A | Sonnet 5 | новые компоненты + unit-тесты (этап 1, задачи 1–4, 6) | 1 |
| Impl-B | Sonnet 5 | i18n-ключи в 2 локалях (en, ru) + прогон i18n-гейтов (этап 1, задача 5) | 1 |
| Impl-C | Sonnet 5 | интеграция в сайдбар (этап 2) | 2 |
| Impl-D | Sonnet 5 | очистка хедера + перенос `useTheme()` (этап 3) | 3 |
| Test-E | Sonnet 5 | e2e-хелперы и spec-файлы, новый e2e-сценарий (этап 4) | 4 |
| Reviewer | Sonnet 5 | независимое код-ревью диффа + проверка чек-листа §13 | 4–5 |

Каждому агенту передаётся: этот документ, список «не трогать» (§5), решение по Р-1.

## 9. Параллельные задачи и зависимости

```
Этап 0 ──► Этап 1 (Impl-A ∥ Impl-B) ──► Этап 2 (Impl-C) ─┐
                                    └──► Этап 3 (Impl-D) ─┤──► Этап 4 (Test-E ∥ Reviewer) ──► Этап 5 (координатор)
```
- Impl-A ∥ Impl-B — независимы (код vs локали).
- Этапы 2 и 3 — параллельны (разные файлы), но оба после этапа 1.
- Этап 4 — после слияния 2 и 3; unit- и e2e-правки внутри него параллельны.
- Этап 5 — строго последним.

## 10. Критерии выполнения каждого этапа

| Этап | Критерий (все пункты обязательны) |
|---|---|
| 0 | Приложение запущено; скриншоты «до» сохранены; базовые `type-check`/jest зелёные |
| 1 | Новые unit-тесты зелёные; `i18n:check-keys` зелёный по 2 локалям (en, ru); type-check зелёный |
| 2 | Карточка внизу сайдбара; меню открывается вверх без обрезания; независимость от `ENABLE_FILE_MANAGEMENT`; `folders.spec.ts` зелёный |
| 3 | Хедер: только логотип+колокольчик на дашборде; аккаунт-доступ на `/flow/:id` сохранён (по Р-1); подписка на системную тему работает |
| 4 | `make test_frontend` ∧ `npm run lint` ∧ `npm run type-check` ∧ `npm run test:i18n` ∧ Playwright-подмножество (§4.8) — зелёные |
| 5 | Чек-лист §13 полностью закрыт; пары скриншотов приложены |

## 11. Сценарии проверки

### Темы
1. Light: карточка/меню читаемы, фон карточки отличим от фона сайдбара, активный сегмент Light выделен.
2. Dark: то же; проверить контраст инициалов на `bg-primary` в dark.
3. System: переключить `prefers-color-scheme` эмуляцией браузера при выбранном System — приложение и меню перерисовываются без перезагрузки.
4. Переключение из самого меню: Light→Dark→System без закрытия меню; состояние персистится (`ketos-theme-preference`, `ketos-is-dark`) после перезагрузки страницы.

### Меню аккаунта
1. Клик по карточке → меню открывается вверх, примыкает к карточке, шеврон меняется на «вверх»; Esc и клик вне — закрывают; фокус возвращается на триггер.
2. Клавиатура: Tab до карточки, Enter — открыть, стрелки — по пунктам, Enter — активировать (Radix из коробки — проверить фактически).
3. Settings → `/settings`; Documentation → новая вкладка `DOCS_URL`; Version — отображает актуальную версию и `(latest)` зелёным (сравнить с `GET /api/v1/version`); Sign out → логаут и редирект на `/login`.
4. Условная логика: под админом виден Admin page; при `autoLogin=true` скрыты Admin page и Sign out; при `hide_logout_button` из `/config` скрыт Sign out.
5. Hover-состояния карточки и каждого пункта; активное (`data-[state=open]`) состояние карточки.

### Адаптивность
1. 1280px+: сайдбар постоянен, карточка внизу, меню не выходит за вьюпорт.
2. Ширина 1023px (порог `useIsMobile({maxWidth:1024})`): сайдбар offcanvas; открыть `SidebarTrigger`-ом — карточка доступна, меню открывается корректно поверх.
3. 375px (mobile): то же + отсутствие горизонтального скролла.
4. Плавное изменение ширины окна с открытым меню: меню не «отрывается» от карточки (Radix reposition) либо корректно закрывается.
5. Низкая высота окна (~500px): меню вверх не обрезается верхней границей (Radix `avoidCollisions`).

## 12. Риски, блокеры и способы устранения

| # | Риск | Серьёзность | Устранение |
|---|---|---|---|
| 1 | Потеря доступа к настройкам на `/flow/:id` (нет сайдбара) | Высокая | Решение Р-1: условный рендер старого меню по `onFlowPage`; подтвердить у пользователя до этапа 3 |
| 2 | Каскадное падение e2e (хелперы `add-new-user-and-loggin`, `go-to-settings`) | Высокая | Сохранить значения testid (Р-5); править хелперы первыми, затем точечно spec-файлы |
| 3 | Контрактные тесты task-9/task-13 грепают исходники по путям | Средняя | Не перемещать `AccountMenu`/`ThemeButtons`/`appHeaderComponent/index.tsx` физически; aria-label не удалять |
| 4 | Рассинхрон 2 локалей (en, ru) → падение `i18n:check-keys`; захардкоженные строки → `i18n:check:hardcoded` | Средняя | Отдельная задача Impl-B; все строки через `t()` |
| 5 | Карточка исчезает при `ENABLE_FILE_MANAGEMENT=false` | Средняя | Размещение вне флага (Р-8); явная проверка в критерии этапа 2 |
| 6 | Потеря подписки `useTheme()` при чистке хедера | Низкая | Подписка уже существует в `DashboardWrapperPage/index.tsx:6` независимо от хедера; при чистке `AppHeader` подтвердить это и прогнать сценарий §11-Темы-3 |
| 7 | `ThemeButtons` сломается для `playground-modal.tsx` | Средняя | Компонент не перемещать и не менять API; unit-прогон затронутых тестов |
| 8 | Обрезание/перекрытие upward-меню (z-index, нижний край вьюпорта) | Низкая | Radix-портал в body + `side="top"` + `avoidCollisions` (по умолчанию true); сценарий §11-Адаптивность-5 |
| 9 | Недоступность меню на узких экранах, пока сайдбар закрыт | Низкая (принятый UX) | Зафиксировано в Р-9; проверяется §11-Адаптивность-2/3; при неприемлемости — отдельная задача вне объёма |
| 10 | Нет полей email/full_name/workspace в модели `Users` | Низкая | Р-3: username + статичная подпись; бэкенд не трогаем; расхождение с референсом документируется |
| 11 | Мок-пути в `account-menu.test.tsx` относительные | Низкая | Файлы не перемещаются (риск 3); новые тесты — со своими моками |
| 12 | Двойные testid в DOM (старое меню на flow + новая карточка) | Низкая | Компоненты не сосуществуют на одном маршруте; проверить e2e strict-mode локаторами |
| 13 | Неоднозначность «расширенных настроек» из ТЗ: раздела Advanced в коде нет | Низкая | Принята трактовка §3 (Advanced не создаётся — вне объёма); при иной трактовке — уточнение пользователя до этапа 1 |

**Блокером** считается только Р-1 (нужно решение пользователя); риск №13 желательно снять тем же ответом. Всё остальное разрешается внутри плана.

## 13. Итоговый чек-лист соответствия требованиям

- [ ] Карточка пользователя (аватар-инициалы, имя, «Ketos workspace», шеврон) — внизу левого сайдбара, как в референсах
- [ ] Меню открывается вверх по клику на карточку и содержит: шапку с данными пользователя, Settings, Theme с сегментированным Light/Dark/System, Documentation, Version + `(latest)` с зелёной галочкой, Sign out, условный Admin page
- [ ] Верхняя панель на дашборде: только логотип и колокольчик; дубликаты кнопок настроек/аккаунта устранены
- [ ] Вся функциональность старого `AccountMenu` сохранена (включая условия `isAdmin`/`autoLogin`/`hideLogoutButton`/`ENABLE_DATASTAX_KETOS`); доступ к настройкам с `/flow/:id` не потерян (Р-1)
- [ ] Light/Dark/System работают из нового меню; персистентность после перезагрузки; только семантические токены темы
- [ ] Состояния closed/hover/active/open проработаны в обеих темах
- [ ] Клавиатурная доступность (Tab/Enter/стрелки/Esc), aria-label через `t()`
- [ ] Все новые строки в 2 локалях (en, ru); `test:i18n` зелёный
- [ ] Адаптивность: 1280/1024/375px и низкая высота окна — без обрезаний и потери доступа
- [ ] Значения data-testid сохранены; e2e-хелперы и spec-файлы зелёные
- [ ] `make test_frontend`, `npm run lint`, `npm run type-check`, `npm run test:i18n`, Playwright-подмножество — зелёные
- [ ] Пары скриншотов «референс ↔ результат» (light+dark) приложены; отклонения задокументированы
- [ ] Не тронуты: `ThemeButtons`(путь), `ProfileIcon`, `ui/sidebar.tsx`, `FlowMenu`, `AlertDropdown`, lock-файлы, `LICENSE`/`NOTICE`; несвязанное dirty-state сохранено
