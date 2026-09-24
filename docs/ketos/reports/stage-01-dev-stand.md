# Отчёт этапа 1. Стенд разработки и базовая среда

> Заполнен по шаблону `stage-report-template.md`. Ветка `stage-01-dev-stand`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-01` (от `main` `fd640dc`). Финальный коммит этапа — голова этой ветки на момент приёмки.

## 1. Итог этапа

База после ребрендинга проверена на воспроизводимость и очищена от регрессий ребрендинга; dev-цикл `pnpm run dev:web` + `pnpm ketos web` зафиксирован в `dev-loop.md` и проверен живьём (правка стиля видна без ручной пересборки, диагностический чек испытан на сломанном ростере); MVP-политика покрытия и процесса оформлена Agent Note; базовые проблемы записаны в `baseline-issues.md`. После этапа любой участник поднимает стенд по документу, а этапы 2–20 опираются на зафиксированные правила тестов и приёмки.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 1.1 Чистая база и воспроизводимость | `ketos-5v2.2.1` | выполнен | `pnpm install && pnpm run build` зелёный; `test:gui` — 380 файлов / 5435 passed; `typecheck`, `constraints` зелёные; смоук `ketos web` на чистом доме |
| 1.2 Дев-цикл и диагностика | `ketos-5v2.2.2` | выполнен | правка `ui-theme/base.css` видна в браузере без пересборки и после reload; `docs/ketos/dev-loop.md`; чек испытан на сломанном ростере (53 записи вместо 54) и возвращён |
| 1.3 Политика покрытия и процесс | `ketos-5v2.2.3` | выполнен | точечные исключения в `vitest.config.ts`; полный прогон покрытия зелёный (22 506 тестов) после закрытия базовых файлов; Agent Note MVP; шаблон отчёта и отчёты этапов 0–1 |
| Баг этапа | `ketos-5v2.2.4` | закрыт | Summary ru-пака сокращён до 96 слов, i18n-пара синхронизирована |

## 3. Критерии приёмки этапа

- [x] Стенд поднимается по документу — `pnpm install` зелёный, `pnpm run build` зелёный; `pnpm ketos web` на чистом доме отвечает 200 на `http://127.0.0.1:3080/`, `<title>Ketos Local Build</title>`; `~/.dsh` не создан; `dev:web` + `ketos web` дают рабочий русский интерфейс.
- [x] Dev-цикл работает — пробная переменная из `packages/client/ui-theme/src/styles/base.css` наблюдалась через `getComputedStyle` сразу (HMR) и после reload; `packages/client/ui-board/lib/client.js` пересобирается watcher'ом; пробы возвращены.
- [x] Диагностический чек проверен на намеренно сломанном ростере и возвращён — без строки `ketos-locale-ru` хост поднялся без ошибок, `__DSH_BOOT__` 53 записи, интерфейс `lang="en"`; после возврата — 54 записи и `lang="ru"`.
- [x] Базовые гейты зелёные или задокументированы — зелёные: `build`, `test:gui`, `typecheck`, `constraints`, `lint`, `doc-sync` (34 гейта), `hygiene` (16 гейтов), `verify-client-catalog/packages/cordis-config/ui-i18n/application-entrypoints`, `verify-package-readme-summaries`, `DSH_SNAPSHOT=replay pnpm run test:web`; базовые отклонения покрытия закрыты после ревью (см. «Отклонения»).
- [x] Политика покрытия и процесс зафиксированы — исключения `packages/client/ui-board/src/**` и `packages/ketos/clone-*/src/**` с пометкой политики; Agent Note; шаблон отчёта.
- [x] Agent Note MVP создан — `.agents/notes/implemented/process/2026-09-15-ketos-mvp-engineering-policy.{md,zh.md,i18n.yaml}`, гейты формата, классификации и парности зелёные.

## 4. Отклонения

- 17 базовых ошибок `pnpm run lint` в `packages/client/ui-board` исправлены по итогам критического ревью (механические скобки, поведение не менялось); lint зелёный, доска стартует этапы 2–4 с чистого гейта.
- `test:coverage` на macOS: платформенные `subprocess-local/src/linux-execve.ts` и `code-runtime-python/src/index.ts` закрыты исключениями не-Linux хостов (`nonLinuxOnlyCoverageExclusions`; Linux-линия CI сохраняет оба файла под per-file 100%); `llm-pi-ai/src/adapter.ts` (4 места из форк-коммита `a4b5114`) закрыт тестами после ревью, полный прогон зелёный.
- `packages/client/ui-board/src/**` исключён из per-file покрытия по MVP-политике (Agent Note); исключение снимается, когда этапы 2–4 принесут поведенческие тесты.
- Пробный стиль дев-цикла проверялся на `ui-theme` (`base.css`), а не на `ui-board/tokens.css`, как предлагал план: доска ещё не подключена к ростору (этап 2), её бандл в браузере не рендерится; цепочка watch для доски проверена изменением `lib/client.js`.
- Исправленные по пути базовые дефекты: shebang `sync-dictionaries.mjs` (падал `verify-application-entrypoints`), ключ `'cordis'` в ru-словарях (падал `vendor rescope` в `hygiene`), ожидание fish-логотипа в `built-boot.expected.e2e.ts`, macOS-симлинк tmp в фикстуре `browser-bundled-externals.spec.ts`, гонка `hang`-replay в `queue-actions.e2e.ts` (тест не дожидался рендера `partial`). Однократный таймаут `hmr-config.spec.ts` не воспроизвёлся.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm install` | зелёный |
| `pnpm run build` | зелёный; build-запись на `fd640dc` |
| `pnpm run test:gui` | 380 файлов, 5435 passed, 1 skipped |
| `pnpm run test:coverage` | зелёный: 1267 файлов, 22 506 тестов, 1 ожидаемый провал, 131 skipped (после ревью) |
| `pnpm run typecheck`, `pnpm run constraints`, `pnpm run lint` | зелёные (после ревью) |
| `pnpm run hygiene` | 16 gates passed, 0 failed |
| `pnpm run doc-sync` | 34 gates passed, 0 failed |
| `pnpm run verify-client-catalog/packages/cordis-config/ui-i18n/application-entrypoints` | зелёные |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный: 101 файл / 359 тестов, 15 skipped (после исправления ожидания марки и гонки queue-actions) |
| `pnpm ketos web` на чистом доме | 200, `Ketos Local Build`, `~/.dsh` без изменений |
| Dev-цикл: `dev:web` + `ketos web`, правка стиля | видно без пересборки и после reload |
| Диагностика: сломанный ростер | 53 записи, `lang="en"`, без ошибок; восстановлено — 54 и `lang="ru"` |

## 6. Следующий шаг

Этап 2 — «Подключение доски к веб-профилю» (эпик `ketos-5v2.3`): три регистрационные поверхности, обвязка пакета и первый рендер `ui-board`. Предпосылки выполнены: MVP-политика покрытия действует (доска исключена до появления поведенческих тестов), `dev-loop.md` описывает цикл сборки и загрузки плагина, `verify-client-catalog` зелёный. После приёмки агент закрывает эпик `ketos-5v2.2` и создаёт worktree этапа 2 от принятой ветки.
