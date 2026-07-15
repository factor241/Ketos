# План: удаление всех языков интерфейса, кроме русского и английского (ru — язык по умолчанию)

> Дата составления: 2026-07-15. База: ветка `redesign/sidebar-account`, head Alembic — `bb693ad2fbab`.
> Источники анализа: knowledge-graph (graphify), LSP-навигация и 5 параллельных
> исследований кодовой базы (UI, БД/миграции, локализационные файлы, конфиги/CI, тесты).

---

## 0. Цель и итоговое состояние

**Сейчас:** 8 языков интерфейса (`en, fr, es, de, pt, ja, zh-Hans, ru`) + dev-псевдолокаль
`qps-ploc`; язык по умолчанию — `en`; русский включается rollback-флагом
`VITE_ENABLE_RUSSIAN_LOCALE`; переводы поставляются через IBM Globalization Pipeline (GP).

**Должно стать:**

1. В селекторе настроек (`/settings/language`) — ровно два языка: **Русский** и **English**.
2. Язык интерфейса по умолчанию (чистый браузер, пустой `localStorage`, `preferred_locale = NULL`) — **русский**.
3. Бэкенд валидирует `preferred_locale` только против `("en", "ru")`; `Accept-Language`
   с любым другим языком откатывается на `ru`.
4. В БД не остаётся пользовательских записей `preferred_locale` вне `ru`/`en`
   (data-миграция Alembic).
5. Физически удалены 12 файлов каталогов переводов (6 фронтенд ≈ 0.9 МиБ + 6 бэкенд ≈ 7.3 МиБ).
6. CI-гейты (`i18n-contracts`), GP-workflow'ы и allowlist'ы синхронизированы — ничего
   не «воскрешает» удалённые языки и ничего не падает.

**Вне объёма задачи (не трогать):**

- `ALL_LANGUAGES` в [src/frontend/src/constants/constants.ts:888](src/frontend/src/constants/constants.ts) —
  это языки **распознавания речи (STT)** голосового ассистента (`it-IT`, `ar-SA`, `hi-IN` и др.),
  отдельная подсистема, не UI-локаль. Используется только в
  `modals/IOModal/.../voice-assistant/.../language-select.tsx`.
- Псевдолокаль `qps-ploc` (`src/frontend/src/i18n/pseudo-locale.ts`) — dev/test-инструмент QA
  переводов, в production не видна (`shipped: false, hidden: true`). Оставить.
- Механизм strict-ru-диагностики (`i18n-diagnostics.ts`, `VITE_STRICT_RU_I18N`,
  `strict_translation_test_mode` на бэке) — уже заточен под пару en/ru, остаётся ключевым
  инструментом верификации.
- `docs/localization/ru/` (glossary, style-guide и пр.) — governance русской локализации,
  остаётся; правится точечно (см. Этап 6).

---

## 1. Карта архитектуры i18n (что где живёт)

| Слой | Источник истины | Ключевые файлы |
|---|---|---|
| Frontend-реестр языков | `SHIPPED_LANGUAGES`, `DEFAULT_LANGUAGE` | [src/frontend/src/constants/languages.ts](src/frontend/src/constants/languages.ts) |
| Frontend-рантайм | i18next instance, `loadLanguage()` | [src/frontend/src/i18n.ts](src/frontend/src/i18n.ts) |
| Выбор языка (UI) | `SUPPORTED_LANGUAGES.filter(shipped && !hidden)` | [LanguageForm/index.tsx](src/frontend/src/pages/SettingsPage/pages/LanguagePage/components/LanguageForm/index.tsx) |
| Персистенция выбора | `localStorage["ketos-language-preference"]` + `PATCH /api/v1/users/{id}` | [use-language-preference.ts](src/frontend/src/hooks/use-language-preference.ts) |
| Backend-реестр | `SUPPORTED_LOCALES`, `DEFAULT_LOCALE` | [src/backend/base/ketos/utils/i18n.py:64-65](src/backend/base/ketos/utils/i18n.py) |
| Определение локали запроса | middleware `set_locale` по `Accept-Language` (БД **не** читается) | [src/backend/base/ketos/main.py:795-809](src/backend/base/ketos/main.py) |
| БД | колонка `user.preferred_locale` (nullable TEXT, без constraint; NULL = серверный дефолт) | [user/model.py:34](src/backend/base/ketos/services/database/models/user/model.py), миграция `bb693ad2fbab` |
| Каталоги переводов | `src/frontend/src/locales/*.json` (по ~2.3 тыс. ключей), `src/backend/base/ketos/locales/*.json` (по 11 507 ключей) | 8 + 8 JSON-файлов |
| Экспорт конфига | `/api/v1/config` → `supported_locales`, `default_locale` | [api/v1/schemas/\_\_init\_\_.py:402-512](src/backend/base/ketos/api/v1/schemas/__init__.py) |
| Поставка переводов | IBM Globalization Pipeline, nightly cron | `scripts/gp/gp_client.py`, `.github/workflows/gp-*.yml` |
| CI-гейты | job `i18n-contracts` | [.github/workflows/ci.yml:377-441](.github/workflows/ci.yml), `scripts/i18n/*` |

Важные факты, определяющие порядок работ:

- **Покрытие ru = 100 %** и на фронте (2332/2332 ключей en, плюс 72 доп. плюральных
  формы `_few`/`_many`), и на бэке (11 507/11 507). Русский готов быть дефолтом без потери покрытия.
- **Vite бандлит все JSON-файлы каталога** `locales/` независимо от содержимого
  `SHIPPED_LANGUAGES` (динамический `import(\`../locales/${code}.json\`)` компилируется в глоб).
  Убрать языки только из реестра недостаточно — файлы нужно удалять физически.
- **Бэкенд-загрузчик тоже глобит** все `*.json` из `ketos/locales/` (`_load_translations()`),
  зря держа ~7.3 МиБ лишних каталогов в памяти и в wheel.
- **GP nightly cron (23:00 UTC) перезапишет удалённые файлы**, если не поправить
  `TARGET_LANGS` в `scripts/gp/gp_client.py:24` и конфигурацию GP-бандла (внешняя система).

---

## 2. Решения, которые нужно зафиксировать до начала (Decision Log)

| # | Вопрос | Рекомендация | Обоснование |
|---|---|---|---|
| D-1 | Судьба флага `VITE_ENABLE_RUSSIAN_LOCALE` / `createSupportedLanguages({russianEnabled})` | **Удалить полностью** | Флаг создавался как rollback «ru → en». Когда ru — обязательный дефолт, откат невозможен по определению; мёртвый флаг с семантикой «выключить дефолтный язык» опаснее его отсутствия |
| D-2 | `fallbackLng` в i18next | **Оставить `"en"`** (не менять на false/ru) | При отсутствующем ru-ключе пользователь увидит английский текст, а не сырой ключ. Строгий контроль полноты ru остаётся за `VITE_STRICT_RU_I18N`-режимом и CI |
| D-3 | Fallback-цепочка бэкенда `requested → en → default` | **Оставить en как технический last-resort** | en-каталог — source of truth хэшированных ключей; цепочка `ru → en → raw` безопаснее `ru → raw` |
| D-4 | Политика data-миграции для существующих `preferred_locale` вне ru/en (`fr`, `de`, `es`, `pt`, `ja`, `zh-Hans` и сырые теги `pt-BR`, `zh-CN` и т.п.) | **Всё → `ru`**, NULL не трогать | Совпадает с новым продуктовым дефолтом; NULL уже означает «серверный дефолт» и станет ru автоматически |
| D-5 | Метка «(рекомендовано)» в селекторе языка (сейчас у `en`) | **Перевесить на `ru`** (или убрать вовсе) | Метка исторически означала «безопасный rollback-язык»; при ru-дефолте это ru |
| D-6 | Статическая предзагрузка каталога | **Статически импортировать и `ru`, и `en`** в `i18n.ts` | Дефолт (ru) обязан быть доступен синхронно до первого рендера; en нужен как fallback без сетевой задержки. +207 КиБ в initial bundle — приемлемо |
| D-7 | GP-интеграция | `TARGET_LANGS = ["ru"]`; конфигурацию GP-бандла (targetLanguages) обновить **вручную вне репо** | Иначе nightly `gp-download.yml` восстановит удалённые файлы; шаг вне репозитория — единственный ручной внешний шаг плана |
| D-8 | Псевдолокаль `qps-ploc` | Оставить | QA-инструмент, production не видит |

---

## 3. Пошаговый план реализации

Порядок этапов выбран так, чтобы: (1) валидация начала отклонять лишние языки **до**
data-миграции; (2) файлы каталогов удалялись **одновременно** с правкой allowlist'ов и
GP-конфига (иначе красный CI или ночное «воскрешение» файлов); (3) тесты правились в том же
коммите, что и код, который они фиксируют.

### Этап 1. Бэкенд: реестр локалей и дефолт

**Файл: [src/backend/base/ketos/utils/i18n.py](src/backend/base/ketos/utils/i18n.py)**

1. Строка 64: `DEFAULT_LOCALE = "en"` → `DEFAULT_LOCALE = "ru"`.
2. Строка 65: `SUPPORTED_LOCALES = ("en", "de", "es", "fr", "ja", "pt", "zh-Hans", "ru")`
   → `SUPPORTED_LOCALES = ("en", "ru")`.
3. Строки 68–72: удалить `_LOCALE_ALIASES` (`zh`/`zh-cn`/`zh-sg` → `zh-Hans`) и ветку
   `normalized.startswith("zh-hans-")` в `normalize_supported_locale()` (строки 341–344) — мёртвый код.
4. Обновить docstring модуля (строка 29: «Fallback chain: requested locale → "en" → raw default» —
   остаётся верным по D-3, но перепроверить формулировки).

Эффекты (код менять не нужно — всё параметризовано):
- `UserUpdate.validate_preferred_locale` начнёт возвращать 422 на `de/es/fr/ja/pt/zh-Hans`.
- `UserRead.normalize_preferred_locale` для «битых» сохранённых значений подставит `ru`.
- `resolve_accept_language("fr-FR")` → `ru`.
- `/api/v1/config` → `supported_locales: ["en","ru"]`, `default_locale: "ru"`.
- Семантика `PATCH preferred_locale=null` («сбросить на серверный дефолт»,
  [crud.py:37-39](src/backend/base/ketos/services/database/models/user/crud.py)) теперь означает ru.

**Удалить файлы:** `src/backend/base/ketos/locales/{de,es,fr,ja,pt,zh-Hans}.json` (≈7.31 МиБ).

### Этап 2. БД: data-миграция Alembic

Новая ревизия поверх текущего head `bb693ad2fbab` (он же — миграция, добавившая
`preferred_locale`; идёт после `e1705947c729`). Файл:
`src/backend/base/ketos/alembic/versions/<new_id>_restrict_preferred_locale_to_ru_en.py`.

```python
"""Restrict user preferred_locale to ru/en

Revision ID: <new_id>
Revises: bb693ad2fbab
"""
import sqlalchemy as sa
from alembic import op

revision = "<new_id>"
down_revision = "bb693ad2fbab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    user = sa.table("user", sa.column("preferred_locale", sa.String))
    # Всё, что не ru*/en* (включая сырые регион-теги zh-CN, pt-BR, fr-FR...),
    # схлопывается на "ru" — новый серверный дефолт. NULL не трогаем:
    # NULL уже означает "использовать серверный дефолт".
    conn.execute(
        user.update()
        .where(
            sa.and_(
                user.c.preferred_locale.is_not(None),
                sa.not_(
                    sa.or_(
                        user.c.preferred_locale.ilike("ru%"),
                        user.c.preferred_locale.ilike("en%"),
                    )
                ),
            )
        )
        .values(preferred_locale="ru")
    )


def downgrade() -> None:
    # Data-миграция необратима: исходные не-ru/en предпочтения теряются.
    pass
```

Дополнительно:
- Прогнать и заснять доказательство по образцу существующего
  [scripts/i18n/prove_preferred_locale_migration.py](scripts/i18n/prove_preferred_locale_migration.py)
  (upgrade → downgrade → upgrade на одноразовой БД); желательно добавить аналогичный
  proof-скрипт для новой ревизии.
- CHECK-constraint `preferred_locale IN ('ru','en')` **не добавляем**: валидация уже на уровне
  Pydantic, а прямые SQL-вставки в обход API не практикуются в проекте. (Опционально —
  отдельной ревизией позже, вместе с нормализацией `ru-RU`→`ru`.)
- Ручная сверка перед прогоном на реальной БД:
  ```sql
  SELECT preferred_locale, COUNT(*) FROM "user" GROUP BY preferred_locale;
  ```

**Важно про порядок:** Этап 1 (валидация) и Этап 2 (чистка данных) должны попасть в один
релиз, причём код Этапа 1 деплоится не позже миграции — тогда новые записи вне ru/en
уже отклоняются на момент чистки исторических.

### Этап 3. Фронтенд: реестр, рантайм, UI

**Файл: [src/frontend/src/constants/languages.ts](src/frontend/src/constants/languages.ts)**

1. Строка 3: `DEFAULT_LANGUAGE = "en"` → `"ru"`.
2. Строки 24–97: из `SHIPPED_LANGUAGES` удалить 6 записей (`fr, es, de, pt, ja, zh-Hans`),
   оставить `en` и `ru`. Тип `SupportedLanguageCode` схлопнется автоматически (derived union).
3. Строки 117–142: удалить `LanguageFeatureFlags.russianEnabled`, `RUSSIAN_LOCALE_ENABLED`
   и фильтрацию по ru в `createSupportedLanguages` (по D-1). Сигнатура упрощается до
   `{ pseudoEnabled }`.
4. Строки 163–167: удалить блок zh-алиасов в `createLanguageAliases` (после удаления
   `zh-Hans` условие всегда false — мёртвый код).

**Файл: [src/frontend/src/i18n.ts](src/frontend/src/i18n.ts)** — самое тонкое место:

5. Строка 15: добавить `import ru from "./locales/ru.json";` рядом с `en`.
6. Строки 66–68: `resources: { en: { translation: en }, ru: { translation: ru } }` (по D-6).
   Сейчас логика неявно предполагает «дефолт = единственный статически вбандленный каталог»;
   ранний return в `loadLanguage` (строка 102: `if (code === DEFAULT_LANGUAGE) return;`)
   при `DEFAULT_LANGUAGE="ru"` перестал бы предзагружать en. Со статическим импортом обоих
   каталогов ранний return можно обобщить: `if (i18n.hasResourceBundle(...)) return;`
   уже есть ниже — достаточно, старую строку можно удалить или оставить как оптимизацию для ru.
7. Строка 70: `fallbackLng: strictRuI18nTestMode ? false : "en"` — **не менять** (D-2),
   но добавить комментарий, что en — осознанный fallback при ru-дефолте.
8. Проверить `i18n-diagnostics.ts` (`shouldRecordFallback` скипает локали `en*`) — логика
   остаётся корректной; правок не требуется.

**Файл: [LanguageForm/index.tsx:65-71](src/frontend/src/pages/SettingsPage/pages/LanguagePage/components/LanguageForm/index.tsx)**

9. Метку `code === "en" && "(рекомендовано)"` перевесить на `code === "ru"` или удалить (D-5).
   Ключ перевода `settings.languageRecommended` при удалении метки тоже вычистить из en/ru
   каталогов (иначе `i18n:check-keys` пометит как неиспользуемый — сверить с allowlist'ами).

**Хук [use-language-preference.ts](src/frontend/src/hooks/use-language-preference.ts)** — правок не требует:
дефолт берётся из `DEFAULT_LANGUAGE`; legacy-значения (`"fr"`, `"ja"` в `localStorage` у
реальных пользователей!) проходят через `normalizeLanguage()` и откатываются на новый дефолт `ru`.
Синхронизация с бэком (`PATCH /users/{id} {preferred_locale}`) продолжит работать: фронт
теперь не может отправить значение вне ru/en.

**Удалить файлы:** `src/frontend/src/locales/{de,es,fr,ja,pt,zh-Hans}.json` (≈903 КиБ; Vite
перестанет генерировать 6 лишних async-чанков).

**Файл: [src/frontend/src/vite-env.d.ts:27](src/frontend/src/vite-env.d.ts)** — удалить
объявление `VITE_ENABLE_RUSSIAN_LOCALE`.

### Этап 4. Инфраструктура, конфиги, тулинг

| Файл | Правка | Почему критично |
|---|---|---|
| [scripts/gp/gp_client.py:24](scripts/gp/gp_client.py) | `TARGET_LANGS = ["fr","ja","es","de","pt","zh-Hans","ru"]` → `["ru"]` | **Риск №1**: nightly `gp-download.yml` (cron `0 23 * * *`) скачивает все TARGET_LANGS и перезаписывает `locales/` — без правки удалённые файлы вернутся следующей ночью |
| Конфигурация GP-бандла (внешний сервис, GP_INSTANCE/GP_BUNDLE) | Убрать targetLanguages кроме ru | Ручной шаг вне репозитория; без него GP продолжит хранить/предлагать переводы |
| `scripts/gp/tests/test_download.py`, `test_gp_client.py` | Синхронизировать с новым `TARGET_LANGS` | Иначе тесты GP-клиента красные |
| [scripts/i18n/allowlists/backend-locale-debt.json:8-16](scripts/i18n/allowlists/backend-locale-debt.json) | `required_locales` → `["en","ru"]`; вычистить debt-записи удалённых локалей | **Риск №2**: `audit_absent_locales` в `check_backend_locales.py` считает отсутствие required-локали блокирующим долгом — CI-джоб `i18n-contracts` упадёт |
| [scripts/i18n/allowlists/frontend-contract-baseline.json](scripts/i18n/allowlists/frontend-contract-baseline.json) | Удалить записи с `"locale": "ja"` и др. удаляемых локалей | Stale baseline-записи детектируются `check_frontend_locales.mjs` как blocking |
| [scripts/i18n/check_backend_locales.py:40-49](scripts/i18n/check_backend_locales.py) | Сократить `INTL_CARDINAL_CATEGORIES` до `en`, `ru` | Не блокирует, но мёртвые записи |
| [docker/build_and_push.Dockerfile:15-16](docker/build_and_push.Dockerfile), [docker/frontend/build_and_push_frontend.Dockerfile:10-11](docker/frontend/build_and_push_frontend.Dockerfile) | Удалить `ARG/ENV VITE_ENABLE_RUSSIAN_LOCALE` | Мёртвый build-arg после D-1 |
| [.github/workflows/gp-download.yml](.github/workflows/gp-download.yml) | Сверить шаги с `--lang ru` и без `--lang`; после правки `TARGET_LANGS` поведение сузится автоматически, но прогнать джоб вручную для проверки | Проверка защиты от «воскрешения» |
| `vite.config.mts`, `.env*`, `Makefile*`, `.pre-commit-config.yaml` | Правок **не требуется** (проверено: языковых упоминаний нет; `VITE_ENABLE_RUSSIAN_LOCALE` в `define` не фигурирует) | — |

Скрипты `check_frontend_locales.mjs` / `check_frontend_keys.mjs` / `check_frontend_hardcoded.mjs`
читают каталоги динамически (`fs.readdir`) — правок не требуют, подстроятся под 2 файла.

### Этап 5. Тесты

#### 5.1. Сломаются гарантированно — обязательные правки

| Файл | Проблема | Правка |
|---|---|---|
| [src/frontend/src/\_\_tests\_\_/residual-ui-localization-contract.test.ts:4-11,49](src/frontend/src/__tests__/residual-ui-localization-contract.test.ts) | Статические ESM-импорты `de/es/fr/ja/pt/zh-Hans.json` — упадёт весь suite на этапе импорта | Оставить импорты и `catalogs` только для en/ru |
| [src/frontend/src/\_\_tests\_\_/locale-contract.test.ts:11](src/frontend/src/__tests__/locale-contract.test.ts) | `SHIPPED_LOCALES = ["de","en","es","fr","ja","pt","ru","zh-Hans"]`, `readFileSync` → ENOENT | `["en","ru"]` |
| [src/frontend/src/i18n.test.ts:16-25,44-63](src/frontend/src/i18n.test.ts) | Реально грузит `fr.json`/`ja.json` через `loadLanguage()` | Переписать на ru/qps-ploc; сократить список очистки бандлов; учесть, что ru станет статически вбандленным (как en) |
| [src/frontend/src/\_\_tests\_\_/i18n.test.ts](src/frontend/src/__tests__/i18n.test.ts) | Строка 50: `DEFAULT_LANGUAGE === "en"`; строки 96–185: тесты `createSupportedLanguages`/`russianEnabled`; 187–207: нормализация `fr-FR`/`zh-CN`; 225–232: дефолт rollback-флага | Ожидание `"ru"`; тесты флага удалить (вместе с флагом); alias-кейсы переписать: `fr-FR`/`ja-JP`/`zh-CN` теперь → `DEFAULT_LANGUAGE` (`ru`) |
| [use-language-preference.test.tsx](src/frontend/src/hooks/__tests__/use-language-preference.test.tsx) | Фикстуры `"fr"`, `"ja"`, `"FR-fr"` (строка 283 и др.); тест «normalizes the initial i18next locale» ожидает `"en"` | Заменить фикстуры на валидные/легаси-сценарии; ожидание дефолта → `"ru"` |
| [LanguageForm.test.tsx:100-113](src/frontend/src/pages/SettingsPage/pages/LanguagePage/components/LanguageForm/LanguageForm.test.tsx) | «marks only English as recommended» | Переписать под ru (или удалить вместе с меткой, по D-5) |
| [src/backend/tests/unit/test_i18n_locale_middleware.py:14-65](src/backend/tests/unit/test_i18n_locale_middleware.py) | Кейсы `("fr-FR,ru;q=0.9,en;q=0.8", "fr")`, `zh`/`zh-CN` → `zh-Hans`; фолбэки на `"en"` | Переписать матрицу: fr-заголовок теперь резолвится в `ru` (по q-весам), zh-кейсы удалить/переписать, дефолт-фолбэк → `"ru"` |
| [src/backend/tests/unit/test_i18n_user_preference.py:210](src/backend/tests/unit/test_i18n_user_preference.py) | `assert default_locale == "en"` | → `"ru"`; сверить тест `supported_locales` со списком `("en","ru")` |
| [scripts/i18n/tests/test_check_backend_locales.py](scripts/i18n/tests/test_check_backend_locales.py) | Параметризованные кейсы с `de/es/ja/pt` (строки 25, 68–180) | Переписать под en/ru (кейсы CLDR-плюралов ru сохранить) |

#### 5.2. Не сломаются (написаны заранее под целевую архитектуру) — прогнать как регресс

`russian-plurals.test.ts`, `task-10-machine-value-roundtrip.test.ts`,
`flow-localization-abi-regression.test.ts`, `strict-i18n-diagnostics.test.ts`,
`*.ru.test.tsx` (5 файлов), `pseudo-locale.test.ts`, `locale-format.test.ts`,
`api-locale-headers.test.ts`, `test_i18n_strict_mode.py`, `test_i18n_strict_runtime.py`,
Playwright `localization-russian-{a11y,manifest,routes,errors}.spec.ts`.

Нюанс Playwright: сценарии, стартующие с выбора English как «известного состояния»
(например [localization-language-page.spec.ts:48](src/frontend/tests/core/features/localization-language-page.spec.ts)),
пересмотреть под новый дефолт ru (чистый старт — уже русский).

⚠️ Отдельно проверить: в `localization-language-page.spec.ts:82-101` тест читает
`localStorage`-ключ `"languagePreference"`, тогда как код использует
`LANGUAGE_STORAGE_KEY = "ketos-language-preference"`. Это либо легаси-расхождение в тесте,
либо второй ключ, не найденный при анализе — разобраться до начала правок, чтобы e2e
не «зеленел» вхолостую.

#### 5.3. Новые тесты (добавить)

1. **FE unit**: при пустом `localStorage` и отсутствии `preferred_locale` эффективный язык — `ru`
   (`document.documentElement.lang === "ru"`).
2. **FE unit**: селектор `LanguageForm` содержит ровно 2 опции и не содержит удалённых кодов.
3. **FE unit (критично для реальных пользователей)**: legacy-значение в `localStorage`
   (`"fr"`, `"ja-JP"`, `"zh-CN"`) нормализуется в `ru` без ошибок/пустых ключей.
4. **BE unit**: `normalize_supported_locale("fr-FR") is None`; `UserRead` с сохранённым `"de"`
   безопасно отдаёт `ru` (аналог существующего `xx-ZZ`-теста, но с *бывшими валидными* кодами —
   важно проверить именно переход «раньше валидный → теперь невалидный»).
5. **BE API**: `PATCH /api/v1/users/{id}` c `preferred_locale: "fr"` → 422;
   `GET /api/v1/config` → `["en","ru"]` / `"ru"`.
6. **BE**: proof-прогон новой data-миграции (upgrade на БД с фикстурами `fr`, `pt-BR`, `zh-CN`,
   `ru`, `en`, NULL → остаются только `ru`/`en`/NULL).
7. **Playwright**: «чистый профиль → интерфейс сразу на русском, без мигания английского».

### Этап 6. Документация

| Документ | Действие |
|---|---|
| [docs/localization/ru/release-rollout-rollback.md](docs/localization/ru/release-rollout-rollback.md) | Переработать или архивировать: центральный сценарий (kill-switch `VITE_ENABLE_RUSSIAN_LOCALE`, откат ru→en) больше не применим |
| [PLAN_SIDEBAR_ACCOUNT_REDESIGN.md](PLAN_SIDEBAR_ACCOUNT_REDESIGN.md) | **Активный план текущей ветки!** Заменить все «8 локалей» / «во все 8 локалей» (строки 50, 98, 117, 130, 137, 158, 162, 186, 211, 235, 238, 270, 292, 295) на «2 локали (en, ru)» — иначе задачи Impl-B будут ориентироваться на устаревший критерий готовности |
| [docs/localization/ru/surface-manifest.csv](docs/localization/ru/surface-manifest.csv) | Обновить счётчики вида `...6x...` (ссылки на «6 других локалей») |
| `docs/docusaurus.config.js` | Правок не требует (`locales: ["en"]` уже) |
| `AGENTS.md`, `README*` | Правок не требуют (списка языков нет) |

---

## 4. Риски, зависимости, последствия

### Высокие

1. **GP nightly «воскрешение» файлов** — `gp-download.yml` по cron перезапишет
   `src/frontend/src/locales/` и `src/backend/base/ketos/locales/` всеми `TARGET_LANGS`.
   Митигируется правкой `gp_client.py:24` **в том же PR**, что удаляет файлы, плюс ручной
   правкой конфигурации GP-бандла (внешний сервис — единственный шаг вне репо).
2. **Красный CI-гейт `i18n-contracts`** при рассинхроне: удалили файлы, но не поправили
   `backend-locale-debt.json.required_locales` / `frontend-contract-baseline.json` — джоб
   блокирует пайплайн. Митигируется атомарностью PR (файлы + allowlist'ы + тесты вместе).
3. **Пользователи с legacy-настройками**: в `localStorage` реальных браузеров лежит
   `ketos-language-preference: "fr"|"ja"|...`, в БД — `preferred_locale` тех же значений.
   Обе цепочки уже имеют нормализацию с фолбэком на дефолт (`normalizeLanguage` на фронте,
   `normalize_supported_locale` + валидатор `UserRead` на бэке) — после смены дефолта фолбэк
   станет `ru`. Покрыть регресс-тестами (5.3.3, 5.3.4); без них риск белого экрана/сырых ключей
   не проверен ничем.

### Средние

4. **Бутстрап-гонка дефолтного каталога**: текущий `i18n.ts` статически бандлит только en;
   если сменить `DEFAULT_LANGUAGE` на ru без D-6, первый рендер пойдёт с пустым ru-каталогом
   (мигание ключей/английского). Решается статическим импортом ru (Этап 3, п.5–6).
5. **Data-миграция необратима** (downgrade — no-op): исходные значения `fr`/`ja`/… теряются.
   Принято осознанно (D-4); при необходимости аудита — снять дамп колонки до прогона.
6. **Параллельная работа в ветке** `redesign/sidebar-account`: план сайдбара требует «ключи во
   все 8 локалей». Если обе работы идут параллельно, согласовать порядок мержа (языковая чистка
   первой упрощает сайдбар-план: меньше каталогов для синхронизации).

### Низкие

7. `zh-Hans`-алиасы и `INTL_CARDINAL_CATEGORIES` — мёртвый код, если забыть: не ломает, но мусор.
8. Ключ `settings.languageRecommended` при удалении метки станет неиспользуемым —
   `i18n:check-keys` это поймает.
9. Wheel/бандл: экономия ≈8.2 МиБ суммарно — только положительный эффект; но проверить, что
   упаковка wheel не имеет отдельного манифеста, перечисляющего locale-файлы (glob — не имеет).

### Что НЕ затрагивается (проверено)

- Языки STT голосового ассистента (`ALL_LANGUAGES`) — отдельная фича.
- `src/kfx`, `src/bundles` — UI-локализации нет (совпадения grep — языковые параметры LLM
  и field typing).
- Email/уведомления бэкенда — локаль не используют.
- Settings/env бэкенда — языковых переменных нет (`KETOS_LOCALE` и т.п. не существуют).
- Docker `LANG`/`LC_ALL` — не заданы.
- Extension locale bundles (манифесты расширений, `extension_locale_bundle`) — механизм
  остаётся; расширения сами решают, какие локали поставлять, ядро лишь читает `ru`/`en`.

---

## 5. Верификация и критерии завершения

### 5.1. Автоматические гейты (в порядке прогона)

```bash
# 1. Контрактные i18n-тесты фронтенда
cd src/frontend && npm run test:i18n

# 2. Полнота/структура каталогов и ключей
cd src/frontend && npm run i18n:check && npm run i18n:check-keys && npm run i18n:check:hardcoded

# 3. Backend locale-гейт (после правки allowlist'ов)
uv run python scripts/i18n/check_backend_locales.py

# 4. Backend i18n-тесты (контракт + предпочтения + middleware + каталоги)
uv run pytest scripts/i18n/tests/test_check_backend_locales.py \
  src/backend/tests/unit/test_i18n_strict_mode.py \
  src/backend/tests/unit/test_i18n_user_preference.py \
  src/backend/tests/unit/test_i18n_locale_middleware.py \
  src/backend/tests/unit/test_i18n_component_metadata.py \
  src/backend/tests/unit/test_i18n_note_translation.py \
  src/backend/tests/integration/test_i18n_strict_runtime.py \
  src/backend/tests/integration/test_i18n_catalog_endpoints.py \
  src/backend/tests/integration/test_i18n_flow_abi_runtime.py -q

# 5. Прогон миграции (одноразовая БД): alembic upgrade head + proof-скрипт
uv run python scripts/i18n/prove_preferred_locale_migration.py   # + аналог для новой ревизии

# 6. Полные пакетные гейты
make lint
make test_frontend       # весь Jest (ловит побочные регрессии в ~65 файлах со словом language)
make unit_tests          # весь backend pytest
make tests_frontend      # Playwright, включая localization-*.spec.ts
```

Тесты GP-клиента: `uv run pytest scripts/gp/tests/ -q`.

### 5.2. Ручная проверка (после зелёных гейтов)

1. `make backend` + `make frontend`; открыть приложение в **чистом браузерном профиле**:
   UI сразу на русском, `document.documentElement.lang === "ru"`, без мигания английского.
2. `/settings/language`: ровно две опции (Русский, English); переключение en↔ru работает и
   переживает reload/вторую вкладку.
3. DevTools: `localStorage.setItem("ketos-language-preference", "ja")` → reload → интерфейс
   на ru, `window.__KETOS_I18N_DIAGNOSTICS__.snapshot()` без `missing`/`failed_loading`.
4. `curl -H "Accept-Language: fr-FR" localhost:7860/api/v1/config` →
   `default_locale: "ru"`, `supported_locales: ["en","ru"]`, `Content-Language: ru`.
5. `curl -X PATCH .../api/v1/users/{id} -d '{"preferred_locale":"de"}'` → 422.
6. Пользователь с legacy `preferred_locale` в БД (до миграции поставить вручную `"fr"`) —
   логин не падает, интерфейс на ru; после `alembic upgrade head` значение в БД = `ru`.
7. Network-вкладка прод-сборки (`npm run build` + preview): чанки `fr.json`/`ja.json` и др.
   отсутствуют в `dist/`.
8. В БД после миграции: `SELECT DISTINCT preferred_locale FROM "user"` → только `ru`, `en`, NULL.

### 5.3. Definition of Done (чек-лист)

- [ ] `SUPPORTED_LOCALES == ("en","ru")`, `DEFAULT_LOCALE == "ru"` (backend);
      `SHIPPED_LANGUAGES == [en, ru]`, `DEFAULT_LANGUAGE == "ru"` (frontend).
- [ ] 12 файлов каталогов удалены; `dist/` и wheel не содержат следов 6 языков.
- [ ] Новая Alembic-ревизия применена; в БД нет `preferred_locale` вне ru/en/NULL.
- [ ] Флаг `VITE_ENABLE_RUSSIAN_LOCALE` удалён отовсюду (код, типы, 2 Dockerfile, тесты).
- [ ] `gp_client.TARGET_LANGS == ["ru"]`; конфигурация GP-бандла обновлена (внешний шаг,
      подтверждён ручным прогоном `gp-download`); следующий nightly-прогон не создал PR
      с удалёнными языками.
- [ ] Allowlist'ы (`backend-locale-debt.json`, `frontend-contract-baseline.json`) без записей
      удалённых локалей; `required_locales == ["en","ru"]`.
- [ ] Все команды из 5.1 зелёные локально и job `i18n-contracts` зелёный в CI.
- [ ] Ручные проверки 5.2 пройдены (зафиксировать выводы команд в PR).
- [ ] Новые тесты 5.3 (Этап 5.3 плана) добавлены и зелёные.
- [ ] Документация обновлена: rollback-runbook, `PLAN_SIDEBAR_ACCOUNT_REDESIGN.md`
      («8 локалей» → «2 локали»), surface-manifest.
- [ ] Расхождение `"languagePreference"` vs `"ketos-language-preference"` в
      `localization-language-page.spec.ts` разобрано и устранено/объяснено.

---

## 6. Предлагаемая нарезка на PR (атомарность против рисков)

1. **PR-1 (бэкенд + БД):** Этапы 1–2 + правки backend-тестов + `backend-locale-debt.json` +
   удаление 6 backend-каталогов + `check_backend_locales.py`. Самодостаточен: фронтенд ещё
   шлёт только коды, которые бэкенд принимает (ru/en — подмножество старого списка).
2. **PR-2 (фронтенд):** Этап 3 + удаление 6 frontend-каталогов + `frontend-contract-baseline.json` +
   все frontend-тесты (5.1) + новые тесты + Dockerfile'ы + `vite-env.d.ts`.
3. **PR-3 (GP + докуменация):** `gp_client.py`, тесты GP, runbook, PLAN_SIDEBAR…, manifest.
   ⚠️ Если nightly GP-прогон случится между PR-2 и PR-3 — файлы вернутся; поэтому допустимо
   слить PR-3 в PR-2 или временно отключить cron `gp-download.yml` на время работ.

Альтернатива — один атомарный PR: устраняет окна рассинхрона (риски 1–2), но крупнее в ревью.
Рекомендация: **PR-1 отдельно, PR-2+PR-3 вместе**.
