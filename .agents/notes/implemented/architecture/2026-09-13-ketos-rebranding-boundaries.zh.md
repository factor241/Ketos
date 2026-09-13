# Agent Note: Ketos rebranding boundaries

Status: implemented

[English](2026-09-13-ketos-rebranding-boundaries.md) | 中文

## Problem

Репозиторий запускается как софт-форк DeepSeek Harness, который поставляется под другим названием продукта: пользовательские поверхности печатают «DeepSeek Harness», лаунчер — только `dsh`, данные живут в `~/.dsh`, а собственного npm-неймспейса у форка нет. Переименование внутренних идентификаторов (`@deepseek-ai/*`, `DSH_*`, имена профилей, формат сессий) разрушило бы совместимость с upstream при синхронизации; поставка без бренда сбивала бы пользователей. Форку нужна письменно закреплённая граница между тем, что видит пользователь, и тем, что остаётся внутренним, плюс механическая история контроля обеих сторон.

## Decision

Продуктовые и интерфейсные поверхности несут бренд Ketos; каждый внутренний идентификатор сохраняет upstream-имя. Расщепление поставлено одновременно:

- **Лаунчер.** `ketos` входит в bin-карту (корневой скрипт `pnpm ketos`, бин-алиас в `apps/cli`, allowlist `verify-application-entrypoints`) как алиас к тому же entry `lib/bin.js`, который сохраняет и `dsh`; `package.json` несёт оба скрипта. Пользовательские строки CLI печатают `ketos` (`Usage: ketos …`, описание `ketos: boot a Ketos profile`, help headless/sdk-app/web-app, диагностические `NAME = 'ketos'`, литералы ошибок профиля в `app-boot`). Бин `dsh` сохраняется, потому что его резолвят SDK, `verify-application-entrypoints` и Python-runtime.
- **Readiness-протокол.** Строка готовности сервера — `ketos web: <url>`; все потребители-парсеры — тесты бандлов, CLI e2e-фикстуры и ожидания, `publish-npm-baseline`, stderr-сниппеты headless, снапшоты сессий — должны переехать одним коммитом. `dsh web:` больше не валидный префикс готовности, при этом help ACP-профиля (`Usage: dsh --profile acp`) остаётся `dsh`, поскольку ACP сохраняет upstream-имена клиентов.
- **Дом контейнера.** `apps/cli/src/bin.ts` устанавливает `process.env.DSH_HOME ??= join(homedir(), '.ketos')` до того, как boot разрешит хоть один путь; само имя переменной `DSH_HOME` и внутренний дефолт `resolveDshHome` `~/.dsh` не меняются.
- **Пакетная поверхность.** `@ketos/<name>` — scope форка под `packages/ketos/`: regex release-member в workspace-констрейнте исключает группу рядом с `experimental/`, так что пакеты падают в обязательную ветку `private: true`; группа освобождена от страниц подсистем; её README следуют обычному контракту билингвальной пары. Первый член группы — `@ketos/client-locale-ru`.
- **Локаль.** Языковой пакет ru регистрирует `ru` с фолбэком `en`, регистрирует ru-словари общих `common` и `settings.locale` и применяет `setLocale('ru')` только когда durable-снапшот настроек `locale` резолвится без сохранённого `preference` и когда браузер сам называет язык с тегом `ru`, так что штатные цепочки `zh`/`en` и явный выбор en переживают disposal и повторное применение.
- **Веб-бренд.** Официальный заголовок сборки `Ketos` (локальный дефолт vite `Ketos Local Build`), PWA-манифест `Ketos`/`KETOS`, новый глиф favicon Кетоса, бут-страница `KETOS`, пакет-локальные `KetosMark`/`KetosWordmark` в сайдбаре заменяют upstream-рыбу только в `ui-brand-official`, `brand.localBuild` = `Ketos Local Build`, onboarding-тексты переводятся на Кетоса с повышением версии notice. Экспорты `ui-primitives` (`FishLogo`, hero-рыба) остаются upstream.
- **Model-visible текст (отложено).** Строка идентичности, web-surface промпты и персона пресета cordis сохраняют upstream-формулировки; развёртывание, которому нужна персона Кетоса, пользуется пользовательским patch-слоем (`includeHarnessIdentity: false` + `personaPrefix`, документировано в `docs/ketos/model-identity.md`). Одно исключение вошло в исправления этапа 0.3: тело 401 web-auth называет `ketos web`, потому что этот текст напрямую видит браузер.

`docs/ketos/` владеет инвентарём и решениями форка: `brand-inventory.md` (классификация плюс воспроизводимые grep'и), `upstream-sync.md` (приёмка по тегам), `model-identity.md` (отложенный выбор и маршрут патча). Как исключение корпуса, `docs/ketos/` выведено из scope translation-pairing, поскольку эти документы — русскоязычный планировочный материал форка by construction.

Контроль механический: `verify-application-entrypoints` пинит bin-карту; констрейнт-гейт пинит приватность группы; `pwa-manifest.e2e.ts`, `built-boot.expected.e2e.ts`, `boot-page.client.spec.ts`, `client-build-environment.client.spec.ts`, `dev-web.spec.ts`, `release/families.spec.ts` пинят веб-литералы; CLI e2e пины пинят `ketos web:`; `verify-package-paths` и grep-чеклист остаточного бренда в `brand-inventory.md` замыкают чек-лист ревью.

## Alternatives considered

**Переименовать внутренние идентификаторы в неймспейс ketos.** Проиграло: форк обновляет upstream, и переименования попадали бы в каждый merge; SDK, Python-runtime и релизный тулинг резолвят `dsh`, так что радиус поломки — весь репозиторий при нулевой пользовательской пользе.

**Переписать model-visible идентичность прямо сейчас.** Проиграло: 31 сайдкар `system-prompt.expected.md`, 39 снапшотов с упоминанием бренда и 9 пинящих spec/e2e файлов менялись бы за один шаг; безопасный маршрут (конфиговое отключение плюс персона-патч) уже есть в дереве (`sdk-minimal/cordis.patch.yml`) и настраивается пользователем без касания shipped-композиций.

**Публиковать `@ketos/*` публично.** Проиграло: форк наследует identity-ограничения upstream, а группа — это локальный внутренний потребитель софт-форка; `private: true` сохраняет честность релизного гейта.

**Ребрендить через переименование бина `dsh`.** Проиграло: парсинг readiness, entrypoint-верификация и установка Python-runtime пинят `dsh`; алиас добавляет бренд, не ломая резолверы.

## Consequences

Мерджи из upstream сосредоточены в известном наборе файлов (процедура в `docs/ketos/upstream-sync.md`; конфликты всё равно случаются там, где ребренд-литералы и upstream-правки пересекаются). Новые upstream-поверхности нелокализованы под бренд до классификации — инвентарь и чек-лист ревью являются дисциплиной расширения, а не автоматикой. Официальный заголовок веб-клиента меняет константы release-верификации, поэтому проверки окружения и `families.ts` двигаются вместе при каждой смене. Фича-локальная UI-копия, не покрытая общим ru-словарём, рендерится на английском через документированный фолбэк (известное ограничение языкового пакета, записанное в его README).

## Related

- `docs/ketos/brand-inventory.md` — классификация и grep-чеклист, которые каждый ребренд-коммит обязан оставить чистыми.
- `docs/ketos/upstream-sync.md` — ремоуты, теги, процедура merge.
- `docs/ketos/model-identity.md` — отложенное model-visible решение и маршрут патч-слоя.
- [single `dsh` application launcher](2026-08-22-single-dsh-application-launcher.zh.md) — решение по лаунчеру, расширенное алиасом `ketos` в bin-карте.
- [mandatory app attribution headers](2026-06-21-mandatory-app-attribution-headers.zh.md) — wire-атрибуционные токены, остающиеся upstream под этой границей.
