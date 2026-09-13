# Инвентаризация бренда (этап 0.2)

Инвентаризация фиксирует каждое вхождение бренда DeepSeek Harness в кодовой базе форка на базе `d5675c2` и классифицирует его по трём спискам: пользовательские поверхности, которые перебренчиваются на «Кетос» сейчас; внутренние идентификаторы, которые не меняются никогда (запретный список); model-visible тексты, которые по умолчанию остаются без изменений и вынесены в опциональный этап 0.7. Все пути и строки ниже проверены по реальному коду grep'ом и чтением файлов; подсказки предыдущего аудита сверены, расхождения отмечены в строках таблиц. Документ не изменяет исходники — он только фиксирует состояние и правила для последующих этапов 0.3–0.7.

## 1. «Перебрендить сейчас» — пользовательские поверхности

Колонка «Замена» даёт целевой литерал: `Ketos` в английских и кодовых строках, `KETOS` в верхнерегистровых вордмарках, `ketos` как написание команды. Правила выбора формы — в разделе [«Правила написания»](#правила-написания).

### CLI-лаунчер (`apps/cli`)

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `apps/cli/src/args.ts:75-85` | `HELP_EXAMPLES`: шаблон примеров, `dsh` в начале каждой строки примеров (строки примеров 77–84, 9 вхождений `dsh`, включая `dsh web` внутри строки 77) | `ketos` в тех же позициях; имена профилей (`web`, `rescue`, `headless`, `tui`) не меняются |
| `apps/cli/src/args.ts:132` | `.name('dsh')` | `.name('ketos')` |
| `apps/cli/src/args.ts:134` | `.description('dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.')` | `.description('ketos: boot a Ketos profile — …')` (остаток формулировки сохраняется) |

### Строка готовности профиля web — machine-read протокол

Строка `dsh web: <url>` — не косметика, а контракт готовности: её парсят тесты и скрипт публикации baseline. Переименование в `ketos web:` допустимо только одной заменой вместе со всеми потребителями, перечисленными в примечании.

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `packages/bundle/web-app/src/index.ts:271` | ``console.log(`dsh web: ${authenticatedUrl}${…(LAN: ${lanUrl})`}`` | `` `ketos web: …` `` — machine-read, см. потребителей ниже |
| `packages/bundle/web-app/src/index.ts:274` | `'dsh web: opening the default browser; pass --no-open to disable'` | `'ketos web: …'` |
| `packages/bundle/web-app/src/index.ts:277` | ``console.error(`web-app: could not open the default browser because ${reason}; use the dsh web URL printed at startup`)`` | `…use the ketos web URL printed at startup` |

Потребители литерала `dsh web:` (меняются в одном коммите со строками выше): `scripts/publish-npm-baseline.ts:67,82,86`; `apps/web/tests/hmr-live.e2e.ts:123`; `apps/web/tests/smoke-real.e2e.ts:62`; `packages/bundle/web-app/tests/web-app.spec.ts:146,147,150,151,215,251,275`; `apps/cli/tests/fixtures/web-browser-open/register.mjs:27` (фикстура матчает префикс `dsh web: `); диагностический вывод той же фикстуры `apps/cli/tests/fixtures/web-browser-open/open.mjs:35` печатает `dsh browser-open:` и переименовывается вместе с ней.

### Собственные `--help` профилей web и sdk

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `packages/bundle/web-app/src/startup.ts:48` | `.name('dsh --profile web')` | `.name('ketos --profile web')` |
| `packages/bundle/web-app/src/startup.ts:49` | `.description('Serve the DeepSeek Harness browser UI.')` | `'Serve the Ketos browser UI.'` |
| `packages/bundle/web-app/src/startup.ts:57-59` | примеры `dsh --profile web …` (3 строки) | `ketos --profile web …` |
| `packages/bundle/sdk-app/src/index.ts:40` | ``.name(`dsh --profile ${profile}`)`` | ``.name(`ketos --profile ${profile}`)`` |
| `packages/bundle/sdk-app/src/index.ts:41` | `.description('Serve DeepSeek Harness SDK clients over stdio JSON-RPC.')` | `'Serve Ketos SDK clients over stdio JSON-RPC.'` |
| `packages/bundle/sdk-app/src/index.ts:45` | пример `dsh --profile ${profile}     serve one SDK runtime…` | `ketos --profile ${profile} …` |

### Профиль headless

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `packages/bundle/headless/src/startup.ts:33` | `.name('dsh --profile headless')` | `.name('ketos --profile headless')` |
| `packages/bundle/headless/src/startup.ts:39` | пример `dsh --profile headless "run the tests"     answer one task and exit` | `ketos --profile headless …` |
| `packages/bundle/headless/src/startup.ts:53` | `program.error('error: a task is required, for example: dsh --profile headless "run the tests"')` | `…for example: ketos --profile headless "run the tests"` |
| `packages/bundle/headless/src/index.ts:128` | `stderr.write('dsh: reasoning:\n')` | `'ketos: reasoning:\n'` |
| `packages/bundle/headless/src/index.ts:160` | ``io.stderr.write(`dsh: ${error instanceof Error ? …}`)`` | `` `ketos: …` `` |
| `packages/bundle/headless/src/index.ts:210` | ``io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)`` | `` `ketos: …` `` |

### Диагностические префиксы boot-слоя

Константы `NAME = 'dsh'` формируют префикс всех пользовательских сообщений stderr/stdout (`${NAME}: …`); замена константы меняет весь префикс разом. Важно: в `packages/boot/app-boot/src/profile.ts` строки 177, 306 и 417 содержат `dsh: { … }` — это ключи конфигурации/манифеста (`dsh.*`-поля), они относятся к запретному списку и не перебренчиваются; перебренчиваются только тексты ошибок.

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `apps/cli/src/profile-boot.ts:41` | `const NAME = 'dsh'` (префикс в сообщениях на строках 116, 121, 133, 138, 149) | `const NAME = 'ketos'` |
| `apps/cli/src/plugin.ts:28` | `const NAME = 'dsh'` (префикс в сообщениях на строках 72, 129, 142, 154, 157) | `const NAME = 'ketos'` |
| `apps/cli/src/dump-config.ts:19` | `const NAME = 'dsh'` (используется на строках 47, 53, 57) | `const NAME = 'ketos'` |
| `packages/boot/app-boot/src/profile.ts:99` | ``throw new Error(`dsh: invalid profile name …`)`` | `` `ketos: invalid profile name …` `` |
| `packages/boot/app-boot/src/profile.ts:210` | `` `dsh: ${link} exists and is not a symlink or dsh-managed module proxy; remove it so dsh can manage the installation fallback` `` | `ketos: …` (оба вхождения `dsh` в тексте) |
| `packages/boot/app-boot/src/profile.ts:332` | `` `dsh: cannot resolve ESM export ${specifier}…` `` | `ketos: …` |
| `packages/boot/app-boot/src/profile.ts:339` | `` `dsh: installed package ${packageName} export ${subpath} resolves outside its package…` `` | `ketos: …` |
| `packages/boot/app-boot/src/profile.ts:360` | `` `dsh: installed package ${packageName} must declare a non-empty version` `` | `ketos: …` |
| `packages/boot/app-boot/src/profile.ts:374` | `` `dsh: installed package ${packageName} main entry is missing at ${entry}` `` | `ketos: …` |
| `packages/boot/app-boot/src/profile.ts:432` | `` `dsh: ${link} exists and is not a dsh-managed module proxy…` `` | `ketos: …` |

### Статическая веб-оболочка и PWA

Расхождение с подсказками предыдущего аудита: в `apps/web/index.html:8` записан не «DeepSeek Harness», а локальный дефолт `DSH Local Build` — официальный заголовок подставляется при сборке через `DSH_CLIENT_TITLE` (см. ниже), поэтому в таблице два литерала: локальный дефолт и официальный.

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `apps/web/index.html:8` | `<title>DSH Local Build</title>` | `<title>Ketos Local Build</title>` |
| `apps/web/vite.config.ts:12` | `const DEFAULT_CLIENT_TITLE = 'DSH Local Build'` | `'Ketos Local Build'` |
| `apps/web/vite.config.ts:25` | якорь `html.replace('<title>DSH Local Build</title>', …)` | якорь должен совпасть с новым литералом в `index.html:8` — меняются одной правкой |
| `apps/web/public/manifest.webmanifest:3` | `"name": "DeepSeek Harness"` | `"name": "Ketos"` |
| `apps/web/public/manifest.webmanifest:4` | `"short_name": "DSH"` | `"short_name": "Ketos"` |
| `apps/web/public/favicon.svg` | весь файл — графика кита (whale mark) | новый знак Кетоса; пинящие спеки см. в примечании после таблицы |

### Бренд веб-клиента (официальный профиль сборки)

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `scripts/client-build-environment.ts:22` | `DSH_CLIENT_TITLE: 'DeepSeek Harness'` внутри `OFFICIAL_CLIENT_BUILD_ENVIRONMENT` (блок 20–23) | `DSH_CLIENT_TITLE: 'Ketos'`; имя переменной `DSH_CLIENT_TITLE` не меняется (запретный список) |
| `packages/client/ui-brand-official/src/client/Brand.tsx:10` | `<FishLogo size={size} />` — официальный знак | новый знак Кетоса (компонент-обёртка сохраняется, меняется artwork) |
| `packages/client/ui-brand-official/src/client/Brand.tsx:18` | `<BrandWordmark includeMark={false} />` — официальный вордмарк | новый вордмарк Кетоса |
| `packages/client/ui-primitives/src/FishLogo.tsx:4,7` | `FISH_LOGO_VIEWBOX = { width: 23.16, height: 17.04 }` и `FISH_LOGO_PATH` — path-графика кита | artwork знака Кетоса; имя экспорта `FishLogo` — внутреннее, решение о переименовании экспорта принимает этап реализации (необязательно) |
| `packages/client/ui-primitives/src/BrandWordmark.tsx:23` | `viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}` — SVG-леттеринг «DeepSeek Harness» | леттеринг «KETOS»; новые viewBox попадают в пинящие спеки |
| `packages/client/web/src/boot-page.ts:37` | `this.wordmark = div(css.wordmark, 'HARNESS')` — текст бут-страницы до загрузки плагинов | `'KETOS'` |
| `packages/client/ui-brand-official/src/client/index.ts:1` | JSDoc `/** Official DeepSeek Harness occupants for the generic browser-brand slots. */` | `/** Official Ketos occupants … */` |

Пинящие спеки, которые обновляются в том же коммите: `apps/web/tests/built-boot.expected.e2e.ts:64-77` (viewBox и текст `DSH Local Build`), `apps/web/tests/pwa-manifest.e2e.ts` (name/short_name/favicon), `packages/client/ui-brand-official/tests/browser-plugin.client.spec.tsx:83` (viewBox `26 0 156 24`), `packages/client/web/tests/boot-page.client.spec.ts:17` (`HARNESS`), `scripts/client-build-environment.client.spec.ts:86,116,132` и `scripts/dev-web.spec.ts:25` (ожидание `DeepSeek Harness`), `scripts/release/families.spec.ts:161` (проверка релизной сборки на `DSH_CLIENT_TITLE`). Замена дефолта `DSH_CLIENT_TITLE` и литерала в `client-build-environment.ts` — одна правка.

### Локали веб-клиента

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `packages/client/locale/src/locales/en.ts:33` | `'brand.localBuild': 'DSH Local Build'` | `'Ketos Local Build'` |
| `packages/client/locale/src/locales/zh.ts:31` | `'brand.localBuild': 'DSH 本地构建'` | `'Ketos 本地构建'` |
| `packages/client/ui-settings-models/src/client/locales.ts:96` | en `welcomeBody`: `"DeepSeek Harness 0.1 remains in testing for Harness developers. … join the DSH plugin ecosystem."` | полный переписанный абзац с `Ketos` (включая хвост `…join the Ketos plugin ecosystem.`) |
| `packages/client/ui-settings-models/src/client/locales.ts:203` | zh `welcomeBody`: `'DeepSeek Harness 目前的 0.1 版本…欢迎全球 Harness 开发者加入 DSH 插件生态。'` | переписанный абзац с `Ketos` |

Зеркала `welcomeBody`, обновляемые той же правкой: `apps/web/tests/scaffold.ts:107` (fixture-копия zh-текста) и ожидание `apps/web/tests/expected/onboarding-deepseek-config/welcome.expected.md:3`. Строка `onboardingDescription: 'Configure the official DeepSeek provider to start building.'` брендом Harness не является — это имя LLM-провайдера DeepSeek, она не меняется.

### Desktop-приложение (Electron) — поверхность, отсутствовавшая в подсказках

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `apps/desktop/electron-builder.config.mjs:57` | `productName: 'DeepSeek Harness'` | `productName: 'Ketos'` |
| `apps/desktop/scripts/package-macos.ts:75` | ``join(artifactsRoot, `mac${…}`, 'DeepSeek Harness.app')`` | `'Ketos.app'` |
| `apps/desktop/src/locale.ts:5` | `startupFailed: 'DeepSeek Harness could not start'` | `'Ketos could not start'` |
| `apps/desktop/src/locale.ts:6` | `startupLoading: 'Starting DeepSeek Harness…'` | `'Starting Ketos…'` |
| `apps/desktop/src/locale.ts:21` | `updateTitle: 'DeepSeek Harness Update'` | `'Ketos Update'` |
| `apps/desktop/src/locale.ts:23` | `updateDetail: 'DeepSeek Harness {version}\n\nThis release includes its matching dsh version. …'` | `'Ketos {version}\n\n…'`; упоминание `dsh` в тексте — фактическая ссылка на внутренний bin, который сохраняется (решение о формулировке — за этапом реализации) |
| `apps/desktop/src/locale.ts:28` | `pluginWindowTitle: 'DeepSeek Harness — Desktop Plugins'` | `'Ketos — Desktop Plugins'` |
| `apps/desktop/src/locale.ts:59,60,75,77,82` | те же пять строк в zh-локали (`DeepSeek Harness 无法启动` и т.д.) | `Ketos` в тех же позициях |

### Дистрибутивные артефакты

| Файл:строки | Текущий литерал | Замена |
| --- | --- | --- |
| `scripts/gen-third-party-notices.ts:658` | `…not linked into or distributed with any DeepSeek Harness artifact.` | `…any Ketos artifact.` |
| `scripts/gen-third-party-notices.ts:718` | `DeepSeek Harness is licensed under [MIT](LICENSE). …` | `Ketos is licensed under [MIT](LICENSE). …` (файл THIRD-PARTY-NOTICES.md генерируется — правится генератор, затем перегенерация) |

### Классифицировано, но не блокирует этап (dev/fixture-поверхности)

Эти вхождения не являются пользовательскими поверхностями продукта и остаются без изменений либо перебренчиваются по желанию на этапе 0.6: `packages/client/connection/src/client/fixture.ts:570,574,691` (ответы fixture-режима, включая fixture system prompt на китайском); `packages/experimental/inspector/src/worker/bridge/endpoint.ts:148,227` (заголовок страницы devtools `DeepSeek Harness Host`); `packages/client/ui-board/src/client/index.ts:3,20` (только комментарии); `scripts/install-lefthook.mjs:31` (dev-инфраструктура). JSDoc-упоминания «DeepSeek Harness» в десятках пакетов (`packages/util/home-paths/src/index.ts`, `packages/sdk/*`, `packages/session/*` и др.) — внутренняя документация, не перебренчиваются.

## 2. «Оставить внутренним» — запретный список

Каждая позиция зафиксирована с местом в коде как доказательством; проверка сохранности — разделом [«Проверочные команды»](#проверочные-команды).

| Позиция запретного списка | Где живёт сегодня |
| --- | --- |
| Имена пакетов `@deepseek-ai/*` и `@deepseek-ai/dsh` | поля `name` всех `packages/*/package.json` и `apps/*/package.json`; корень — `package.json:2` (`@deepseek-ai/dsh-root`); ~101 описание `description` в тех же манифестах остаётся внутренним текстом |
| bin `dsh` | `apps/cli/package.json:14` (`"bin"`), скрипт `"dsh"` в корневом `package.json:179`; пин `scripts/verify-application-entrypoints.ts:28-29` (`apps/cli/package.json → lib/bin.js`); резолв SDK `packages/sdk/client/src/launch.ts:55-67` (читает `bin.dsh` из манифеста `@deepseek-ai/dsh`); тот же bin ставит Python-runtime |
| Переменные окружения `DSH_*` | `DSH_HOME` (`packages/util/home-paths/src/index.ts:18`), `DSH_WEB_URL` (`packages/bundle/web-app/src/index.ts:76`), `DSH_CLIENT_TITLE`, `DSH_CLIENT_BUILD_PROFILE`, `DSH_CLIENT_COMMIT_HASH`, `DSH_CLIENT_VERSION`, `DSH_BUILD_CLIENT_PROFILE` (`scripts/client-build-environment.ts:16-30`), `DSH_SYSTEM_PROMPT` (`packages/bundle/sdk-minimal/cordis.patch.yml:91`), префикс `DSH_` для child-env (`packages/subprocess/subprocess/src/types.ts:12`, `DSH_ENV_PREFIX`) |
| Дефолт домашнего каталога `~/.dsh` | `packages/util/home-paths/src/index.ts:12-15` (`DSH_HOME_DIR_NAME = '.dsh'`, `DEFAULT_DSH_HOME_DISPLAY = '~/.dsh'`) — внутренний дефолт; Кетос задаёт пользовательский каталог `~/.ketos` значением через `DSH_HOME`, а не именем переменной или константы |
| Имена профилей и бандлов | `web`, `headless`, `sdk`, `sdk-minimal`, `rescue`, `tui`, `cordis`, `ptc`, `minimal`, `standard`, `desktop` — примеры в `apps/cli/src/args.ts:77-83`, каталоги `packages/bundle/*` и `packages/preset/agent-presets/presets/*`, профиль `desktop` в `apps/desktop` |
| Поля `dsh.*` в манифестах | `"dsh": { … }` в `packages/bundle/web-app/package.json:36`, `packages/experimental/inspector/package.json:26` и др.; ключ `dsh.bundle` проверяется в `apps/cli/src/plugin.ts:72`; ключи `dsh:` в конфиге — `packages/boot/app-boot/src/profile.ts:177,306,417` |
| Глобалы `__DSH_BOOT__` / `__DSH_TRANSPORT__` | `apps/web/vite.config.ts:9`, `packages/client/web/src/boot.ts:66-67`, `packages/client/connection/src/client/index.ts:110,192` |
| Wire-идентификаторы | в том числе clientInfo рукопожатия Codex app-server: `packages/subagent/subagent-codex/src/wire.ts:270-271` (`name: 'deepseek-harness'`, `title: 'DeepSeek Harness'`) — имена клиента в протоколных рукопожатиях не меняются |
| Формат сессий | `SESSION_FORMAT_VERSION` (`packages/core/session/src/types.ts:88`), `STORAGE_SQLITE_SCHEMA_VERSION` (`packages/storage/storage-sqlite/src/schema.ts:20`) |
| URI-схема `dsh-session:` | `packages/context/session-reference/src/uri.ts:9` (`SESSION_REFERENCE_SCHEME`) |
| ACP/Codex client names | как wire-идентификаторы выше; автоматизационный ACP-сервер `packages/acp` не переименовывается |
| Имена файлов `cordis.yml` / `*.cordis.yml` / `*.cordis.patch.yml` | `PROFILE_ROOT_FILENAME = 'cordis.yml'` (`apps/cli/src/profile-boot.ts:91`), пресеты `packages/preset/agent-presets/presets/*/agent.cordis.yml`, патч базового бандла `packages/bundle/base/cordis.patch.yml` |
| Model-visible промпты (MVP-дефолт) | перечень в разделе 3; по умолчанию не трогаются |
| Ограничение `BRAND_GUIDELINES.md` | [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md): проект, выпускаемый под другим именем, не должен использовать «DeepSeek Harness» как название проекта (зарегистрированный товарный знак; допустимы фактические описания вида «built on DeepSeek Harness»); сокращение «DSH» остаётся разрешённым обозначением связи с экосистемой и внутренним сокращением |

## 3. Model-visible — опционально (этап 0.7)

Два маршрута. (a) Пользовательский patch-слой: `cordis.patch.yml` с конфигом system-prompt `includeHarnessIdentity: false` и Ketos-persona в `personaPrefix` — shipped-композиция и снапшоты не трогаются; прецедент уже в shipped-бандле: `packages/bundle/sdk-minimal/cordis.patch.yml:87` ставит `includeHarnessIdentity: false`. (b) Полная перебрендировка shipped-композиции — правится ядро и все пинящие ожидания; стоимость ниже, этап отложен после MVP.

| Вхождение | Файл:строки | Стоимость (a) patch-слой | Стоимость (b) перебрендировка shipped-композиции |
| --- | --- | --- | --- |
| Фиксированная идентичность «You are an AI agent powered by DeepSeek Harness.» | `packages/core/system-prompt/src/index.ts:423` (гейт `includeHarnessIdentity` — строка 419; поле конфига — 244; zod-дефолт `true` — 401) | 0 правок ядра: секция отключается конфигом, persona задаётся `personaPrefix` | 31 файл `system-prompt.expected.md` в `snapshots/` (подсказка «~36» завышена); 35 файлов снапшотов содержат эту фразу; 9 spec/e2e-файлов пинят фразу или секцию `harness:identity`: `packages/core/system-prompt/tests/system-prompt.spec.ts`, `packages/core/agent-loop/tests/loop.spec.ts`, `packages/boot/app-boot/tests/app-boot.spec.ts`, `packages/preset/persona/tests/persona.spec.ts`, `packages/shell/tool-bash/tests/tools.spec.ts`, `packages/fs/tool-fs/tests/tools.spec.ts`, `packages/fs/tool-fs-search/tests/tools.spec.ts`, `packages/web/tool-web/tests/tool-web.spec.ts`, `apps/web/tests/replay-round-trip.e2e.ts` |
| Промпт веб-GUI «You are interacting with the user through the DeepSeek Harness Web GUI at …» | `packages/bundle/web-app/src/index.ts:139` | не гейтится конфигом — правится литерал в патч-слое невозможно; только (b) или отдельная точка конфигурации | + ожидание `apps/web/tests/expected/web-runtime-context/web-surface-prompt.expected.md` |
| Описание bash-переменной `DSH_WEB_URL` («Canonical local URL of the DeepSeek Harness Web GUI…») | `packages/bundle/web-app/src/index.ts:246` | имя переменной не меняется; текст описания — только (b) | + те же web-ожидания |
| Секция `HARNESS_SOURCE` «The DeepSeek Harness implementation checkout is at …» | `packages/boot/app-boot/src/index.ts:860` (секция добавляется только при source-checkout) | не отключается конфигом — только (b) | + `packages/boot/app-boot/tests/app-boot.spec.ts` |
| Персона пресета `cordis` «You are a coding agent powered by the {{model}} model, running on the DeepSeek Harness.» | `packages/preset/agent-presets/presets/cordis/agent.cordis.yml:22` (подсказка называла путь `presets/cordis/` — фактически файл в `packages/preset/agent-presets/presets/cordis/`) | пользовательский пресет-копия с Ketos-persona; shipped-файл не трогается | + снапшоты сессий на пресете `cordis` |
| Описание инструмента-навыка badge «Add the official "powered by dsh" badge…» | `packages/skill/skill-badge/src/index.ts:24`; в shipped-бандле выключен: `packages/bundle/base/cordis.patch.yml:279-281` (`disabled: true`) | остаётся выключенным — 0 стоимости; активировать в Кетосе не следует | + ассеты официального бейджа `packages/skill/skill-badge/assets/dsh-badge.md:1-16` и `dsh-badge.png` — по [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md) официальные бренд-материалы в форке под другим именем использовать нельзя, поэтому при включении навыка ассеты заменяются |

Суммарная стоимость (b) по факту: 31 файл `system-prompt.expected.md`, 39 файлов снапшотов всего упоминают «DeepSeek Harness», 9 spec/e2e-файлов пинят идентичность (23 spec-файла упоминают бренд в любой форме), плюс web-ожидания `web-surface-prompt.expected.md` и `welcome.expected.md`. Подсказка «~36 снапшотов + 16 specs» завышена относительно факта.

## Правила написания

Продукт в русских текстах — «Кетос»; в коде, английских строках и латинице — `Ketos`; в верхнерегистровых вордмарках и на бут-странице — `KETOS`; написание команды в пользовательских текстах CLI — `ketos` (в help, примерах и диагностических префиксах), при этом фактический bin `dsh` сохраняется по запретному списку, а вводимая команда `ketos` (алиас/новый bin) — отдельное решение этапа 0.3. Новые пакеты именуются `@ketos/*`; существующие `@deepseek-ai/*` не переименовываются. Пользовательский каталог данных — `~/.ketos`, доставляется значением через `DSH_HOME`, внутренний дефолт `~/.dsh` остаётся. Русская локаль веб-клиента — новый языковой пакет через `addLanguage` (базовые языки `zh`/`en`, локали `ru` в базе нет), поэтому «Кетос» в русском UI появляется с локалью, а не патчем профиля.

## Проверочные команды

Хвостовые упоминания бренда в пользовательских каталогах (исключая тесты, снапшоты, документацию и манифесты пакетов):

```sh
grep -rn "DeepSeek Harness" apps packages scripts \
  --include="*.ts" --include="*.tsx" --include="*.mjs" \
  --include="*.html" --include="*.webmanifest" --include="*.svg" \
  | grep -v "/tests/" | grep -v "\.spec\." | grep -v "\.e2e\." \
  | grep -v "package.json"
```

Остатки `dsh`-написания команды в пользовательских строках (после этапа 0.3 список должен опустеть, кроме запретных позиций):

```sh
grep -rn "dsh web:\|dsh: \|'dsh'\|\`dsh " \
  apps/cli/src packages/bundle/*/src packages/boot/app-boot/src \
  | grep -v "dsh: {" | grep -v "dsh\."
```

Утверждения запретного списка, которые каждая ревью-проверка обязана подтвердить:

```sh
# имена пакетов не переименованы (счётчик не уменьшается)
grep -rl '"@deepseek-ai/' --include="package.json" packages apps | wc -l
# bin dsh сохранён
grep -n '"bin"' apps/cli/package.json && grep -n '"dsh":' package.json
# env-переменные и внутренний дефолт дома не тронуты
grep -n "DSH_HOME_DIR_NAME\|DSH_HOME_ENV" packages/util/home-paths/src/index.ts
# boot-глобалы на месте
grep -rn "__DSH_BOOT__\|__DSH_TRANSPORT__" apps/web packages/client --include="*.ts" | wc -l
# схема сессий и формат не тронуты
grep -n "dsh-session:" packages/context/session-reference/src/uri.ts
grep -n "SESSION_FORMAT_VERSION" packages/core/session/src/types.ts
```

Чек-лист ревью ребрендинг-коммита: ни одного переименования `@deepseek-ai/*`; bin `dsh` сохранён и пин `verify-application-entrypoints` не тронут; все `DSH_*`-переменные и дефолт `~/.dsh` без изменений; имена профилей, бандлов и файлов `cordis.yml`/`*.cordis.yml`/`*.cordis.patch.yml` без изменений; `__DSH_BOOT__`/`__DSH_TRANSPORT__`, wire-идентификаторы, `dsh-session:` и client names рукопожатий без изменений; `SESSION_FORMAT_VERSION`/`SCHEMA_VERSION` без изменений; model-visible промпты не меняются в MVP-коммите; каждый изменённый пользовательский литерал из раздела 1 имеет обновлённого пинящего потребителя из своего примечания.

## Источники

Записи этого документа опираются на файлы плана «Кетос» в папке планирования вне репозитория (`stage-00-rebranding.md`, ревизия 3; `ketos_v7_master_instruction.md`) и товарные ограничения [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md).
