# Отчёт этапа 13. Рабочая директория и артефакты агента

> Заполнен по шаблону [stage-report-template.md](../stage-report-template.md). Ветка `stage-13-workdir-artifacts`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-13` (от принятой ветки этапа 12 `stage-12-tools-approvals`; базовый коммит `269e8b7`). План этапа — `ketos_v7_master_plan/stage-13-workdir-artifacts.md` (ревизия 17); задачи — Beads `ketos-5v2.14.1`–`ketos-5v2.14.4`, эпик `ketos-5v2.14`.

## 1. Итог этапа

Каждая сессия окна доски получила прозрачную и управляемую рабочую директорию, а созданные и изменённые файлы выводятся как артефакты окна без сканирования файловой системы. Панель «Чаты» показывает путь текущего проекта с быстрыми действиями копирования пути и открытия папки в системном проводнике, а также предоставляет полноценную вкладку «Артефакты» со статусами создания, изменения и чтения файлов. Домашний каталог Кетоса (`~/.ketos` и `$DSH_HOME`) защищён строгой изоляцией на хосте (`workspace-controller`) и клиенте (`path-validation`), а корень диска и домашняя папка требуют явного подтверждения. Решение этапа зафиксировано в Agent Note [2026-09-21-ketos-stage-13-workdir-artifacts.md](../../../.agents/notes/implemented/architecture/2026-09-21-ketos-stage-13-workdir-artifacts.md).

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 13.1 Артефакты сессии из tool-результатов | `ketos-5v2.14.1` | выполнен | `window/artifacts-model.ts` (сборка `sessionArtifacts` из settled `write`/`edit`/`str_replace_editor`/`read`/`read_image`, дедупликация, приоритет мутаций над чтением, сабколы, отсечение ошибок) + `window/WindowChatsPanel.tsx` (вкладка «Артефакты», теги статусов, кнопки копирования и reveal) + `window/ConversationBody.tsx` (полоса артефактов над композером `[data-board-artifacts-strip]`). Тесты — `tests/artifacts-model.client.spec.ts` (13 тестов) и `tests/window-chats-panel.client.spec.tsx` |
| 13.2 Путь, проект и быстрые действия окна | `ketos-5v2.14.2` | выполнен | `window/WindowChatsPanel.tsx` (строка проекта `[data-board-project-path]` с усечением, кнопки `panel-copy-path` и `panel-open-folder` через `session.openWorkspacePath`, создание чата в проекте); закреплён инвариант композера — отсутствие чипа папки в `ComposerBar`. Тесты — `tests/window-chats-panel.client.spec.tsx` и `tests/composer.client.spec.tsx` (строки 785–797) |
| 13.3 Изоляция `~/.ketos` и валидация каталога | `ketos-5v2.14.3` | выполнен | Хост: `packages/api/workspace-controller/src/commands.ts` (`realpath`-канонизация `$DSH_HOME`, `~/.ketos`, `~/.dsh` и отказ с `workspace/invalid-path`); Клиент: `window/path-validation.ts` (отклонение `~/.ketos` с `panel.error.ketosHome`, предупреждение и модальное подтверждение для `/` и `~` через `panel.warn.dangerousPath`); локализация в `locale.ts` (zh/en), `board-ru.ts` и `ru-keys.json`. Тесты — `packages/api/workspace-controller/tests/workspace-controller.host.spec.ts` и `tests/path-validation.client.spec.ts` |
| 13.4 Проверки | `ketos-5v2.14.4` | выполнен | Актуализированы README пакета `ui-board` (`README.md`, `README.zh.md`, `README.i18n.yaml`); подготовлен Agent Note `2026-09-21-ketos-stage-13-workdir-artifacts.md` (+ `.zh.md`, `.i18n.yaml`); все тестовые наборы и гейты зелёные |

## 3. Критерии приёмки этапа

- [x] Артефакты видны и корректны — модель `sessionArtifacts` извлекает все созданные/изменённые/прочитанные файлы из tool-вызовов; вкладка артефактов отображает список с тегами и быстрым действием показа в проводнике; пустое состояние выводится при отсутствии вызовов.
- [x] Путь и проект окна показаны и управляются из панели — в шапке панели выводится текущий проект и путь с кнопками копирования и открытия в ОС; композер не содержит элементов управления каталогом.
- [x] `~/.ketos` защищён — попытки создания рабочей директории в `$DSH_HOME` или `~/.ketos` блокируются на хосте и клиенте; корневые каталоги требуют подтверждения.
- [x] README обновлён — `packages/client/ui-board/README.md` отражает управление проектами в панели и модель извлечения артефактов.
- [x] Тесты, snapshot replay и аудит зелёные — юнит-тесты (35 файлов, 462 теста), GUI-тесты (408 файлов, 5838 тестов), typecheck, lint, duplication, hygiene, doc-sync и `DSH_SNAPSHOT=replay pnpm run test:web` (101 файл, 359 тестов) зелёные.
- [x] Коммит этапа содержит Agent Note — `2026-09-21-ketos-stage-13-workdir-artifacts.md` (+ zh, i18n).
- [x] Задачи Beads 13.1–13.4 закрыты по критериям (эпик готов к закрытию после приёмки).

## 4. Отклонения

- **Артефакты извлекаются без прямого сканирования ФС.** Как зафиксировано в плане этапа, сканирование файловой системы создаёт избыточную нагрузку и рассинхронизацию при удалённых сессиях; артефакты детерминированно формируются из settled tool-результатов сессии (`write`, `edit`, `str_replace_editor`, `read`, `read_image`). Ограничение отражено в документации: сторонние фоновые процессы терминала вне tool-контракта в список артефактов не попадают.
- **Инвариант композера закреплён.** Чип каталога удалён из `ComposerBar` на этапе 4.7 и не возвращён; контекстная строка композера содержит только чип пресета, управление рабочими папками сосредоточено исключительно в панели «Чаты».
- **Покрытие `ui-board` — исключение MVP-форка.** Согласно политике MVP-форка (`Agent Note 2026-09-15-ketos-mvp-engineering-policy`), для `ui-board` действует выборочное поведенческое тестирование компонентов без требования 100% покрытия каждой вспомогательной строки CSS. При этом для затронутого хост-пакета `workspace-controller` обеспечено 100% покрытие строк, веток и функций.

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests packages/api/workspace-controller/tests packages/ketos/client-locale-ru/tests` | зелёный; 35 файлов, 462 passed |
| `pnpm run test:gui` | зелёный; 408 файлов, 5838 passed, 1 skipped |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный; 101 файл passed, 1 skipped, 359 passed, 15 skipped |
| `pnpm run typecheck` | зелёный; 0 ошибок TS |
| `pnpm run lint` | зелёный; 0 ошибок oxlint на 3654 файлах |
| `pnpm run duplication` | зелёный; 0 клонов на 1776 файлах |
| `pnpm run hygiene` | зелёный; 16 гейтов passed, 0 failed |
| `pnpm run doc-sync` | зелёный; 34 гейта passed, 0 failed |
| `pnpm run build` | зелёный; 238 клиентских артефактов собрано |

## 6. Следующий шаг

После подтверждения приёмки пользователем: закрытие эпика `ketos-5v2.14` в Beads, создание и подготовка ветки и worktree этапа 14 (`stage-14-multiwindow-perf`) от принятой ветки `stage-13-workdir-artifacts`.
