# Ketos: базовые проблемы и отклонения (этап 1)

Документ фиксирует состояние базы после ребрендинга: что проверено, что уже сломано до этапа 1 и не чинится в этапах 2–20, и какие регрессии устранены здесь же. Обновляется по мере обнаружения новых базовых проблем.

## Проверенная база

База — ветка `stage-01-dev-stand` от `main` (`fd640dc`) в worktree `/Volumes/Projects/Ketos bot.worktrees/stage-01`; окружение — Node v26.3.1, pnpm 11.7.0, macOS arm64.

| Проверка | Команда | Результат |
|---|---|---|
| Установка | `pnpm install` | зелёный, 293 workspace-проекта |
| Сборка | `pnpm run build` | зелёный; build-запись `.dsh-build/client-build-environment.json` перезаписана на `fd640dc` |
| GUI-тесты | `pnpm run test:gui` | 380 файлов, 5435 passed, 1 skipped |
| Типы | `pnpm run typecheck` | зелёный |
| Констрейнты | `pnpm run constraints` | зелёный |
| Линт | `pnpm run lint` | 17 базовых ошибок, см. ниже |
| Документация | `pnpm run doc-sync` | 34 gates passed, 0 failed |
| Каталог слотов | `pnpm run verify-client-catalog` | зелёный (`slot-catalog.ts is up to date`) |
| Клиентские пакеты | `pnpm run verify-client-packages` | 52 пакета (47 dynamic, 5 statically linked) |
| Конфигурации | `pnpm run verify-cordis-config` | 143 файла |
| Локализация UI | `pnpm run verify-client-ui-i18n` | 619 файлов |
| Локаторы приложений | `pnpm run verify-application-entrypoints` | зелёный (после исправления, см. ниже) |
| Сводки README | `pnpm run verify-package-readme-summaries` | 322 сводки ≤ 100 слов (после исправления) |
| Гигиена релиза | `pnpm run hygiene` | 16 gates passed (после исправления, см. ниже) |
| Смоук на чистом доме | `pnpm ketos web --no-open` | зелёный: 200 на `http://127.0.0.1:3080/`, `<title>Ketos Local Build</title>`, `~/.dsh` не создан |

## Известные базовые проблемы

### 1. `pnpm run lint` — 17 ошибок в `packages/client/ui-board`

Все ошибки — правило `typescript(no-confusing-void-expression)` в конструкциях, которые существуют в импортированной базе (коммит `bbe514e`, пакет доски), а не появились при ребрендинге. Пакет подключается к веб-профилю начиная с этапа 2, его компоненты переписываются на этапах 3–4; до тех пор ошибки не чинятся здесь, чтобы не смешивать базовую правку с фичами.

Падающие локации (17):

- `packages/client/ui-board/src/client/canvas/DashboardCanvas.tsx:50:18`, `189:42`, `222:31`, `223:40`, `238:25`
- `packages/client/ui-board/src/client/window/ToolWindow.tsx:111:28`, `155:30`, `166:28`, `181:28`
- `packages/client/ui-board/src/client/dock/SessionRail.tsx:60:33`, `61:33`, `64:30`
- `packages/client/ui-board/src/client/window/AgentCard.tsx:116:28`, `159:30`
- `packages/client/ui-board/src/client/omnibox/DashboardToolbar.tsx:113:26`, `135:26`
- `packages/client/ui-board/src/client/inspector/ElementSelectionContext.tsx:25:18`

Дословный пример:

```
packages/client/ui-board/src/client/canvas/DashboardCanvas.tsx:50:18: error typescript(no-confusing-void-expression): Returning a void expression from an arrow function shorthand is forbidden. help: Add braces to the arrow function.
```

Полный список повторяется командой `pnpm run lint`.

### 2. `pnpm run test:coverage` — три базовых файла ниже per-file 100%

Прогон полного покрытия на этапе 1: 1267 файлов, 22 502 теста зелёные, один ожидаемый провал, 12 файлов и 131 тест пропущены по условиям; все падения — только пороговые, в трёх файлах, ни один из которых не относится к Кетосу. Два первых файла — платформенные: Linux-линия покрытия CI покрывает их штатно, macOS не может. Третий не зависит от платформы и приходит из форк-коммита до этапа 0; его закрытие — отдельная задача, вне этапа 1 (тот же принцип «не чинить базовое в этапах 2–20»).

- `packages/subprocess/subprocess-local/src/linux-execve.ts` — 40% lines, 25% functions, 8.33% branches: Linux-only реализация exec-ve, импортируется только на Linux (`linux-scope.ts`, `spawn-runner.ts`); происходит из upstream-импорта `f5d8f1e`.
- `packages/experimental/code-runtime-python/src/index.ts` — 99.08% lines, 99.15% statements: ветка чтения `/proc/<pid>/stat` в `readProcessStart`; сам файл помечает её как платформенную (`/* v8 ignore next -- one arm per platform: the Linux coverage lane always takes the read path, and Darwin always this one. */`); происходит из upstream-импорта `f5d8f1e`.
- `packages/llm/llm-pi-ai/src/adapter.ts` — 99.1% lines, 95.83% branches: 4 непокрытых места — путь `toOpenCodeSessionId` для строки без UUID (`adapter.ts:210-211`) и комбинации fallback `baseUrl` в `isOpenCodeRoute` (`adapter.ts:218`). Код добавлен форк-коммитом `a4b5114` до этапа 0; тесты `adapter.spec.ts` покрывают только UUID-путь и один вариант baseUrl.

Проверка, что исключения Кетоса не задели чужие файлы: после добавления `packages/client/ui-board/src/**` и `packages/ketos/clone-*/src/**` в `vitest.config.ts` пороговых ошибок по ui-board нет, `@ketos/client-locale-ru` сохраняет 100%, остальные upstream-пакеты — без новых пропусков.

## Исправлено в этапе 1 (регрессии ребрендинга и базовой сборки)

1. `verify-application-entrypoints` падал на `packages/ketos/client-locale-ru/scripts/sync-dictionaries.mjs` с сообщением `executable source has no application/build/test classification` — shebang у скрипта сопровождения, добавленного на этапе 0. Shebang убран; скрипт запускается явной командой `node …`, как описано в Dev Note пакета. Гейт зелёный.
2. `verify-package-readme-summaries` падал на `packages/ketos/client-locale-ru/README.md` (121 слово при лимите 100). Сводка сокращена до 96 слов, `README.zh.md` синхронизирован, i18n-пара перезаписана. Гейт зелёный.
3. `pnpm run lint` — три ошибки в файлах, изменённых этапом 0: недостижимый второй `return` в `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` после ротации заголовка (правило `no-unnecessary-condition`) и две ошибки в `packages/ketos/client-locale-ru/tests/locale-ru.apply.client.spec.ts` (`no-confusing-void-expression`, `no-unsafe-member-access`). Исправлено; `mutate` в спеке типизирован как `vi.fn<SettingsMutate>`.
4. `apps/web/tests/built-boot.expected.e2e.ts` — ожидание неофициального профиля требовало fish-логотип (`svg[viewBox="0 0 23.16 17.04"]`), тогда как поставленная марка Кетоса (`img` с data URI) рендерится во всех профилях после коммита `6231f0e`. Ожидание приведено к фактическому поведению; `DSH_SNAPSHOT=replay pnpm run test:web` зелёный.
5. `scripts/browser-bundled-externals.spec.ts` — детерминированное падение на macOS: `mkdtempSync` отдаёт путь через симлинк `/var` → `/private/var`, Vite канонизирует root и `vite:build-html` эмитит чанк с относительным путём (`RollupError: … received "../../../../…/index.html"`). Фикстура канонизирует корень через `realpathSync`; 6 тестов зелёные.
6. `packages/boot/app-boot/tests/hmr-config.spec.ts` — однократный таймаут «HMR did not observe config creation» в первом полном coverage-прогоне под нагрузкой; изолированно и в повторном полном прогоне зелёный (файловый watcher и 10-секундный дедлайн чувствительны к нагрузке). Зафиксировано как плавающее; при повторении заводится отдельная задача.
7. `pnpm run hygiene` — падал на гейте `vendor rescope` из-за ключа `'cordis'` в сгенерированном `packages/ketos/client-locale-ru/src/locales/pack-ru.ts` и манифесте `tests/fixtures/ru-keys.json`: это id неймспейса локали пакета `@deepseek-ai/dsh-client-ui-cordis` (`NS = 'cordis'`), а не ссылка на вендоренный пакет. Файлы добавлены в `GENERIC_SKIPS` с обоснованием, как уже сделано для локалей `ui-cordis`. `pnpm run rescope-vendor:check` и `pnpm run hygiene` зелёные (16 gates).
8. `apps/web/tests/queue-actions.e2e.ts` — гонка golden-захвата: replay-запись `hang` пишет `.hang-ready` сразу после выдачи чанка `partial`, не дожидаясь его рендера в браузере, поэтому под нагрузкой полного `test:web` снимок снимался без абзаца `partial` (и сценарий не доводил записанные вызовы: `llm-replay: fixture not fully consumed — consumed 1/4 recorded call(s)`). Тест теперь дожидается отрендеренного абзаца перед сценарием; полный `DSH_SNAPSHOT=replay pnpm run test:web` зелёный (101 файл, 359 тестов).

## Проверочные команды

```sh
pnpm install && pnpm run build
pnpm run test:gui && pnpm run typecheck && pnpm run constraints
pnpm run doc-sync && pnpm run test:coverage
pnpm ketos web --no-open
```

## Источники

- План этапа: `stage-01-dev-stand.md`, подэтап 1.1.
- Политика работы с базой: общие правила §II.4 мастер-плана (`ketos_v7_master_instruction.md`).
