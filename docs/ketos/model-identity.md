# Ketos: модель-видимая идентичность (этап 0.7)

Перечень model-visible вхождений бренда и стоимость обеих опций ведёт [brand-inventory.md](brand-inventory.md) (раздел 3). Этот документ фиксирует MVP-решение, маршрут отключения идентичности без правки ядра и проверку, что патч не ломает сборку промпта.

## Решение (MVP)

По умолчанию model-visible строки остаются upstream-литералами: идентичность `You are an AI agent powered by DeepSeek Harness.` сохраняется, снапшоты `[snapshots/](../../snapshots/)` не меняются. Полная перебрендировка shipped-композиции — отдельная итерация после MVP (стоимости в [brand-inventory.md](brand-inventory.md): 31 файл `system-prompt.expected.md`, 39 снапшотов с упоминанием бренда, 9 пинящих spec/e2e). В этом MVP-решении учтён и [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md): запрет касается названия проекта «DeepSeek Harness», а не внутренней строки промпта, которую модель не видит как бренд продукта.

## Маршрут: пользовательский patch-слой

Патч-слой заменяет ряд конфига плагина целиком — остальные ключи перечисляются заново. Готовый in-tree прецедент: [packages/bundle/sdk-minimal/cordis.patch.yml](../../packages/bundle/sdk-minimal/cordis.patch.yml) (строка `system-prompt` с `includeHarnessIdentity: false`).

Готовый патч-файл: [`model-identity.patch.yml`](model-identity.patch.yml) (в этом каталоге). Форма строки совпадает с [packages/bundle/web-app/cordis.patch.yml](../../packages/bundle/web-app/cordis.patch.yml):

```yaml
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
  config:
    includeHarnessIdentity: false
    personaSuffix: Your working directory is {{cwd}}.
    personaPrefix: >-
      You are an assistant of the Ketos platform, a personal AI-orchestration environment.
```

Формы применения: `cordis.patch.yml` в доме пользователя или флаг `--patch <файл>` (`dsh --patch a.yml` — повторяемый сборщик патч-оверлеев). Поле `includeHarnessIdentity: false` опускает только фиксированный first-party опенер; `personaPrefix` задаёт собственный текст.

## Проверка применения

Патч применяется без модели и без API-ключа: `pnpm dsh --profile web --patch docs/ketos/model-identity.patch.yml --dump-config` печатает собранное дерево профиля с наложенным оверлеем (в строке `system-prompt` видны `includeHarnessIdentity: false` и `personaPrefix`), exit 0 подтверждает, что файл валиден и композиция собирается. Полная сборка промпта с тем же отключением идентичности покрыта спеком `packages/core/system-prompt/tests/system-prompt.spec.ts` (кейс `includeHarnessIdentity: false` + `personaPrefix`), который собирает реальный prompt через плагин `SystemPrompt` и подтверждает отсутствие identity-строки и наличие персона-текста. Отправка запроса с патчем не меняет формат сессии и `SESSION_FORMAT_VERSION`; снапшоты не пересобираются.

```sh
pnpm dsh --profile web --patch docs/ketos/model-identity.patch.yml --dump-config
pnpm exec vitest run packages/core/system-prompt/tests
```
