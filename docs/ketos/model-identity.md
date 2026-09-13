# Ketos: модель-видимая идентичность (этап 0.7)

Перечень model-visible вхождений бренда и стоимость обеих опций ведёт [brand-inventory.md](brand-inventory.md) (раздел 3). Этот документ фиксирует MVP-решение, маршрут отключения идентичности без правки ядра и проверку, что патч не ломает сборку промпта.

## Решение (MVP)

По умолчанию model-visible строки остаются upstream-литералами: идентичность `You are an AI agent powered by DeepSeek Harness.` сохраняется, снапшоты `[snapshots/](../../snapshots/)` не меняются. Полная перебрендировка shipped-композиции — отдельная итерация после MVP (стоимости в [brand-inventory.md](brand-inventory.md): 31 файл `system-prompt.expected.md`, 39 снапшотов с упоминанием бренда, 9 пинящих spec/e2e). В этом MVP-решении учтён и [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md): запрет касается названия проекта «DeepSeek Harness», а не внутренней строки промпта, которую модель не видит как бренд продукта.

## Маршрут: пользовательский patch-слой

Патч-слой заменяет ряд конфига плагина целиком — остальные ключи перечисляются заново. Готовый in-tree прецедент: [packages/bundle/sdk-minimal/cordis.patch.yml](../../packages/bundle/sdk-minimal/cordis.patch.yml) (строка `system-prompt` с `includeHarnessIdentity: false`).

Файл `$DSH_HOME/cordis.patch.yml` (пользовательский patch-слой поверх профиля; форма строки совпадает с [packages/bundle/web-app/cordis.patch.yml](../../packages/bundle/web-app/cordis.patch.yml)):

```yaml
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
  config:
    includeHarnessIdentity: false
    personaPrefix: 'You are an assistant of the Ketos platform, a personal AI-orchestration environment.'
```

Формы применения: `cordis.patch.yml` в доме пользователя или флаг `--patch <файл>` (`dsh --patch a.yml` — повторяемый сборщик патч-оверлеев). Поле `includeHarnessIdentity: false` опускает только фиксированный first-party опенер; `personaPrefix` задаёт собственный текст.

## Проверка применения

Запуск сесии с патчем не требует API-ключа для проверки сборки промпта: гейт `includeHarnessIdentity` покрыт спеком `packages/core/system-prompt/tests/system-prompt.spec.ts` (кейс `includeHarnessIdentity: false` + `personaPrefix`), который собирает реальный prompt через плагин `SystemPrompt` и подтверждает отсутствие identity-строки и наличие персона-текста. Отправка запроса с патчем не меняет формат сессии и `SESSION_FORMAT_VERSION`; снапшоты не пересобираются.

```sh
pnpm exec vitest run packages/core/system-prompt/tests
```

Успех команды — подтверждение, что маршрут патча не ломает сборку промпта и не требует обновлений снапшотов.
