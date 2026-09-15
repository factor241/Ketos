# Ketos: стенд разработки веб-клиента (dev-цикл)

Документ описывает воспроизводимый цикл «правишь код → видишь в браузере» для веб-клиента Кетоса: команды, порт, требования и диагностику загрузки клиентских плагинов. Зафиксирован на этапе 1; отклонения стенда — в `baseline-issues.md`.

## Требования и первый запуск

Нужны Node (^22.19 || >=24) и pnpm из корня репозитория. Первый запуск стенда:

```sh
pnpm install
pnpm run build          # обязателен один раз перед dev:web
```

`pnpm run build` собирает host (`tsc` + `tsdown`), клиентские бандлы (`tsc` + `tsdown`) и оболочку `apps/web` (`vite build`), после чего пишет gitignored-запись `.dsh-build/client-build-environment.json` с вшитыми литералами `DSH_CLIENT_*` (версия, commit, title, профиль). Литералы встраиваются в байты бандлов на сборке, поэтому изменение `DSH_CLIENT_*` требует полного `pnpm run build`, а не только перезагрузки страницы.

## Два терминала

Терминал 1 — watch-сборка клиента:

```sh
pnpm run dev:web        # tsx scripts/dev-web.ts --poll
```

`dev:web` последовательно запускает три наблюдателя: `tsc -b tsconfig.client.json --watch` (эмитит `lib/types`), `tsdown --watch` по клиентским плагинам и статически связанным библиотекам (эмитит `lib/client.js`) и `vite build --watch --no-emptyOutDir` для оболочки `apps/web/dist`. Опрос (poll) включён намеренно: сетевые монтирования не доставляют inotify-события, и без опроса `tsc` молча не переиздаёт `lib/types`. Список наблюдаемых пакетов сканируется один раз при старте: новый клиентский пакет требует перезапуска `dev:web`.

Терминал 2 — хост и раздача собранного клиента:

```sh
pnpm ketos web          # алиас --profile web; upstream-бинарь dsh продолжает работать
```

Адрес по умолчанию — `http://127.0.0.1:3080` (порт задаётся `port: !!js ctx.webStartup.port ?? 3080`; переопределяется `--port N`, `--port 0` — ОС-назначенный). Данные профиля — в `$DSH_HOME`, по умолчанию `~/.ketos`; `~/.dsh` не используется. Запуск печатает аутентифицированный URL с токеном (`ketos web: http://127.0.0.1:3080/?token=…`) — открывайте именно его; без токена страница отвечает 401.

`pnpm run build` и `pnpm run dev:web` не запускаются одновременно: оба пишут `lib/` и `apps/web/dist`.

## Что видно в браузере и когда

- Клиентские плагины подхватываются без перезагрузки: хост статически опрашивает каждый `lib/client.js` (по умолчанию 500 мс) и при изменении пересобирает запись графа; `@deepseek-ai/dsh-client-hmr` подменяет фибру плагина в браузере. Перезагрузка страницы не обязательна, но всегда даёт чистое состояние.
- Изменения shell-оболочки (`apps/web/dist`, например `index.html`) требуют перезагрузки страницы; изменения только типов или литералов сборки — полного `pnpm run build`.
- Отсутствие перезапуска не лечит: `dev:web` умирает целиком при отказе любого из трёх наблюдателей (`… exited; the artifact chain is now stale`), чтобы устаревшие артефакты не выглядели как «правка ничего не изменила».

### Проверка цикла (зафиксирована на этапе 1)

1. Добавить в `packages/client/ui-theme/src/styles/base.css` пробное правило `:root { --ketos-stage-01-dev-loop-probe: 1; }` (после проверки удалено).
2. Дождаться строки `[@deepseek-ai/dsh-client-ui-theme/client] Rebuilt` в выводе `dev:web` (пересборка заняла секунды).
3. В консоли браузера: `getComputedStyle(document.documentElement).getPropertyValue('--ketos-stage-01-dev-loop-probe')` возвращает `1` — уже без перезагрузки; после `reload` значение сохраняется. Ручной `pnpm run build` не запускался.
4. Правка `packages/client/ui-board/src/client/tokens.css` также пересобирает `packages/client/ui-board/lib/client.js`; в браузере она появится только после подключения доски к ростору (этап 2).

## Запрет голого Vite

`apps/web` не запускается напрямую (`vite`/`vite dev`): клиентский граф внедряет хост через `window.__DSH_BOOT__`, и голый Vite отдаёт оболочку без него — браузер печатает `client-modules: window.__DSH_BOOT__ is missing or not an object` и страница остаётся пустой (белый экран). Конфиг `apps/web/vite.config.ts` отклоняет режим `serve` на этапе загрузки конфига; используйте связку `dev:web` + `ketos web` и адрес 3080. Разбор — [postmortem 0003](../postmortem/0003-web-agent-gui-feedback-loop.md).

## Диагностика «плагин не виден в браузере»

Клиентский плагин появляется в браузере только когда сходятся три регистрационные поверхности и собран бандл. Проверяйте по порядку:

1. **Три поверхности.** (а) ссылка `{ "path": "./packages/…" }` в `tsconfig.client.json` — при пропуске `pnpm run typecheck`/`build` падают на `error TS6307: File '…' is not listed within the file list of project`, а без импорта из тестов — `[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js`; (б) строка `- id: … / name: '@…'` в `packages/bundle/web-app/cordis.patch.yml` — при пропуске плагин молча отсутствует, ошибок нет; (в) зависимость в `packages/bundle/web-app/package.json` — ловит `pnpm run verify-cordis-config` (`… must be declared in packages/bundle/web-app/package.json dependencies`), иначе возможен отказ загрузки `Cannot find package '…'`.
2. **`dsh.client` в манифесте пакета.** Плагин попадает в ростер только если его `package.json` объявляет `dsh.client.platform === 'web'`; без объявления пакет собирается, но в браузере его нет.
3. **Собранный `lib/client.js`.** Если файла нет, активация падает фатально: `client-modules: client bundle not found; run \`pnpm run build\` before launch` с путём; хост печатает `ketos: fatal load failure: …` и завершается — URL-строка не выводится, браузер получает отказ соединения. Сначала запустите `pnpm run dev:web` (или полный `pnpm run build`).
4. **Консоль и логи.** В браузере отказ загрузки виден как `client-modules: bundle script <url> failed to load`, `bundle <url> loaded without registering "<id>" via __ModuleLoader__.load`, `web boot: N entries did not activate` или страница «Failed to load plugins»; причина может быть в отдельном бандле, даже если остальные загрузились.

Быстрая проверка состава ростера без запуска сервера: `pnpm ketos web --dump-config | grep <package>` — строка отсутствует, значит плагин не в дереве (поверхность «б»). Граф браузера на живой странице: `window.__DSH_BOOT__.entries.map(e => e.id)`.

### Испытание на сломанном ростере (этап 1)

Строка `ketos-locale-ru` временно удалена из `packages/bundle/web-app/cordis.patch.yml`, сервер перезапущен: хост поднялся без единой ошибки, страница отвечала 200, в `__DSH_BOOT__` было 53 записи вместо 54, `@ketos/client-locale-ru` отсутствовал, интерфейс откатился на английский (`<html lang="en">`) — то есть пропуск поверхности «б» не диагностируется ничем, кроме отсутствия эффекта. Строка возвращена, после перезапуска 54 записи и русский интерфейс. Правка patch-файла видна только после перезапуска сервера: bundle-слои не отслеживаются живым reload.

## Полезные команды

```sh
pnpm exec vitest run packages/client/ui-board/tests     # юниты доски
pnpm run test:gui                                       # весь GUI-слой
DSH_SNAPSHOT=replay pnpm run test:web                   # собранный UI (build + браузерный replay)
pnpm run verify-client-packages                         # режимы и запросы клиентских пакетов
pnpm run verify-client-catalog                          # каталог слотов (сгенерированный)
pnpm run verify-cordis-config                           # строки ростера против зависимостей бандла
pnpm run typecheck && pnpm run lint
```

## Источники

- Постановка и критерии: `stage-01-dev-stand.md`, подэтап 1.2.
- Контракт разработки клиентских плагинов: `packages/client/AGENTS.md`.
- Белый экран голого Vite: [postmortem 0003](../postmortem/0003-web-agent-gui-feedback-loop.md).
