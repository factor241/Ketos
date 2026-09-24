# Отчёт этапа 0. Ребрендинг DeepSeek Harness → Кетос

> Заполнен по шаблону `stage-report-template.md` на этапе 1 (ретроспективно, по записям Beads, плану и git-истории). Этап выполнялся до введения worktree-политики (решение 47) и был влит в `main`.

## 1. Итог этапа

Standalone-репозиторий Кетоса (`/Volumes/Projects/Ketos bot`, GitHub `factor241/Ketos`) зафиксирован на базе upstream `d5675c2` (тег `ketos-base-d5675c2`), продукт на всех пользовательских поверхностях называется Кетос, ядро остаётся merge-совместимым с upstream. Эпик Beads `ketos-5v2.1` и все семь задач закрыты. Появились: CLI-алиас `ketos` с данными в `~/.ketos`, группа пакетов `packages/ketos/` и русский языковой пакет, веб-бренд и записанная модель-видимая политика.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 0.1 Форк-репозиторий и фиксация базы | `ketos-5v2.1.1` | выполнен | реимпорт `f5d8f1e` (upstream `c291e79`), `bbe514e` (доска), `a4b5114` (= `d5675c2`); `docs/ketos/upstream-sync.md` |
| 0.2 Карта брендинга и запретный список | `ketos-5v2.1.2` | выполнен | `docs/ketos/brand-inventory.md` |
| 0.3 CLI и лаунчер `ketos` | `ketos-5v2.1.3` | выполнен | bin `ketos` в `apps/cli/package.json`, строки `ketos web:`; `verify-application-entrypoints` зелёный на этапе 1 |
| 0.4 Пакеты `@ketos/*`, группа, констрейнты | `ketos-5v2.1.4` | выполнен | `packages/ketos/` обязана быть `private: true`; `pnpm run constraints` зелёный |
| 0.5 Дом `~/.ketos` и локаль ru | `ketos-5v2.1.5` | выполнен | `apps/cli/src/bin.ts` ставит `DSH_HOME ??= ~/.ketos`; `@ketos/client-locale-ru`, per-file 100% |
| 0.6 Веб-бренд Кетос | `ketos-5v2.1.6` | выполнен | title/манифест/фавикон/марка/бут-страница; `DSH_CLIENT_TITLE='Ketos'`; ru-переводы `brand.localBuild` |
| 0.7 Модель-видимая идентичность (опция) | `ketos-5v2.1.7` | выполнен как решение | MVP-дефолт — не трогать identity; patch-маршрут `docs/ketos/model-identity.patch.yml`, проверка через `--dump-config` |

## 3. Критерии приёмки этапа

- [x] `pnpm ketos web` работает и печатает `ketos web:` — подтверждено смоуком этапа 1 на чистом доме: 200 на `http://127.0.0.1:3080/`.
- [x] Данные в `~/.ketos`, `~/.dsh` не создаётся — подтверждено сравнением файлов `~/.dsh` до/после смоука этапа 1 (без изменений).
- [x] ru по умолчанию для ru-браузера, иначе штатный фолбэк, явный `en` не перетирается — спека `packages/ketos/client-locale-ru/tests/locale-ru.apply.client.spec.ts` (11 тестов) и наблюдаемый русский интерфейс в браузере.
- [x] Заголовок, манифест, сайдбар и бут-страница показывают Кетос — `<title>Ketos Local Build</title>` и марка Кетоса в собранном клиенте.
- [x] `constraints`, `verify-application-entrypoints`, `verify-client-packages` зелёные — подтверждено на этапе 1; `verify-application-entrypoints` потребовал правки shebang у `sync-dictionaries.mjs`.
- [x] Запретный список не нарушен, upstream-diff ограничен перечнем 0.2 — карта `docs/ketos/brand-inventory.md`.
- [x] Agent Note по ребрендингу создан — `.agents/notes/implemented/architecture/2026-09-13-ketos-rebranding-boundaries.md`.

## 4. Отклонения

- Desktop/Electron-ребрендинг отложен до post-MVP вместе с desktop-приложением (`docs/ketos/brand-inventory.md`).
- Модель-видимая идентичность (identity-строка, web-surface промпт, `HARNESS_SOURCE`, персона `cordis`) в shipped-композиции не менялась: MVP использует пользовательский patch-слой (`docs/ketos/model-identity.md`); полный ребренд требует перезаписи prompt-сайдкаров и спек.
- Браузерные e2e-полосы на этапе 0 не прогонялись (сообщение коммита `e818e62`: Playwright install blocked). На этапе 1 `DSH_SNAPSHOT=replay pnpm run test:web` выявил одно устаревшее ожидание (`built-boot.expected.e2e.ts` ждал fish-логотип вместо марки Кетоса) — исправлено на этапе 1.
- Планирование в Beads и worktree-политика появились после этапа 0 (коммиты `1ad2016`, `9a5e59f`); этап 0 остался в `main` без отдельного worktree.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm install` | зелёный (повторно на этапе 1) |
| `pnpm run build` | зелёный |
| `pnpm run test:gui` | 380 файлов, 5435 passed (на этапе 1) |
| `pnpm run typecheck`, `pnpm run constraints` | зелёные |
| `pnpm run verify-client-packages`, `verify-cordis-config`, `verify-client-ui-i18n` | зелёные |
| `pnpm ketos web` на чистом доме | 200, `<title>Ketos Local Build</title>`, `~/.dsh` не создан |

## 6. Следующий шаг

Этап 1 — «Стенд разработки и базовая среда» (эпик `ketos-5v2.2`): зафиксировать воспроизводимость базы, dev-цикл `dev:web` + `ketos web` и MVP-политику покрытия и процесса. Выполнен; см. `stage-01-dev-stand.md`.
