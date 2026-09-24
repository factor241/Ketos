# Этап 22. Документация, решения и финальная интеграция MVP

Отчёт по §II.4 общего плана: выполненные подэтапы, подтверждённые критерии, отклонения и следующий шаг. Источник — `stage-22-mvp-integration.md` (подэтапы 22.1–22.5; пункты аудита П5, П6, П20–П25). Ветка — `stage-22-mvp-integration`, worktree — `/Volumes/Projects/Ketos bot.worktrees/stage-22`, база — принятая `stage-21-mvp-stabilization` (`bb3babb`). Финальный коммит с этим отчётом и Agent Note этапа — после его написания.

## 1. Итог этапа

Некодовые пункты аудита 2026-09-24 закрыты: решения записаны в Agent Note этапа (идущая сессия клона следует правкам профиля и памяти на следующей сборке промпта, правка профиля сбрасывает префикс KV-кэша с первого изменённого токена, навыки фиксированы на жизнь агента; запись из окна памяти создаёт только агент инструментом `clone_memory_remember`), README `ui-board` и `clone-core` и пять расхождений в en/zh приведены к коду, реестр форка `upstream-sync.md` дополнен правками `workspace-controller` и `tsdown.client.ts`, процесс в Beads, `docs/ketos/beads.md` и папке плана согласован с ревизией 18 (включая статусные строки этапов 11–21 в генераторе), а в репозитории наведён порядок: worktree `docs-plan-sync` удалён (его незакоммиченные правки перенесены по смыслу), артефакты вне MVP вынесены в `/Volumes/Projects/ketos-context/`, `git status` в `main` чист. Ветви этапов 1–21 пока не влиты в `main`, тег `ketos-mvp` не создан — это пункт П5, выполняемый после ответа пользователя на вопрос о приёмке этапа 22.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 22.1 Записанные решения и сценарий приёмки | `ketos-5v2.23.1` | выполнен | П24: решение записано в [Agent Note этапа 22](../../../.agents/notes/implemented/architecture/2026-09-24-ketos-stage-22-mvp-integration.md) (en/zh, парность зелёная) и в README `ui-board` и `clone-core`; факты сверены с кодом (`packages/ketos/clone-core/src/session.ts:684-688` — refresh текста на месте, `:653-682` — фиксированный набор навыков; `tests/composition.spec.ts:706-735` — правка профиля доходит до сборки, запись памяти не трогает префикс). П25: шаг B9 в `docs/ketos/mvp-e2e.md` переписан (запись создаёт агент `clone_memory_remember`, окно памяти — проверка, правка, удаление); ограничение «создание записи из окна памяти отсутствует» внесено в README `ui-board` (Use this package + Known Limitations) и `docs/ketos/mvp-known-limitations.md`; отсутствие операции создания подтверждено кодом (`src/memory-routes.ts:31-36`, `CloneMemoryBody`) |
| 22.2 README и описания пакетов | `ketos-5v2.23.2` | выполнен | П20: пять расхождений README `ui-board` исправлены в en и zh — текущей сессию делает привязка, а не фокус; menu New window: `agent` и `tasks` открывают рабочие окна, `connectors` и `settings` — окна с текстом «недоступно в MVP»; `board.window.body` — регистрация на каждый body kind, три вида делят unavailable-occupant, описан `board.window.panel` (agent/clone); ретрай берёт ревизию из ошибки конфликта; `agent` в списке пустых тел отсутствует (исправлено этапом 21.5, сверено). П22: `description` пакета `ui-board`, doc-комментарий `tool-card-model.ts` (`str_replace_editor` рендерится diff-блоком) и комментарий исключения покрытия `vitest.config.ts` обновлены; `README.i18n.yaml` перезаписан. Проверки: `pnpm run doc-sync` — 34/34, `pnpm run verify-translation-pairing` — 842 пары |
| 22.3 Реестр форка и процесс в Beads | `ketos-5v2.23.3` | выполнен | П21: в `docs/ketos/upstream-sync.md` добавлены две строки реестра — `packages/api/workspace-controller/src/commands.ts` (`workspace/invalid-path` для `$DSH_HOME`, `~/.ketos`, `~/.dsh`; этап 13, коммит `fc6b144`, спек «rejects paths inside Ketos or DSH home») и `packages/client/tsdown.client.ts` (`KETOS_INLINE_SAFE` в гейте `dsh-client-bundle-purity`; коммит `06af5d8`); строки `session-controller` и `ui-model-selection` этапа 21.3 проверены — на месте. П23: описание эпика `ketos-5v2` (процедура ревизии 13, этапы 0–22), `docs/ketos/beads.md` (23 эпика этапов 0–22, статус 0–21 закрыты / этап 22 выполняется, ревизия 18), память `bd` `ketos-plan-location` (ревизия 18), статусные строки принятых этапов 11–21 в `gen_stage_files.py` и перегенерация папки плана (23 этапа, изменены только генератор и `stage-11`…`stage-21`), known limitations дополнены итогами `ketos-fc3`, `ketos-aqp` и открытым upstream-ограничением `ketos-pux` |
| 22.4 Порядок в репозитории | `ketos-5v2.23.4` | выполнен | П6 после подтверждения владельца: из worktree `docs-plan-sync` перенесены по смыслу семь незакоммиченных правок (формулировка «binding changes the current session» в README `ui-board` en/zh и Agent Note `2026-09-16-ketos-board-window-sessions` en/zh с вызовом `attach()`; уточнение строки `ketos-foe` в отчёте этапа 5 о мульти-поинтере A14), пары перезаписаны; `git worktree remove --force docs-plan-sync` и `git branch -D docs/ketos-plan-sync` (tip `5226f07` = вершина принятой `stage-05`, уникальных коммитов не было); `presentation/`, `scripts/test-presentation-cdp.mjs` и `docs/ketos/ketos-context-specification.md` перенесены `mv` в `/Volumes/Projects/ketos-context/` (структура: `presentation/`, `scripts/`, `docs/ketos-context-specification.md`), копий в репозитории нет; `ketos-presentation` не тронут |
| 22.5 Приёмка этапа и финальная интеграция | `ketos-5v2.23.5` | выполнен (кроме П5) | Сводный чек-лист [mvp-acceptance-checklist.md](../mvp-acceptance-checklist.md) собран на этапы 0–22; гейты этапа зелёные (§5); отчёт — этот файл; итоговый [Agent Note MVP](../../../.agents/notes/implemented/architecture/2026-09-23-ketos-mvp-acceptance.md) обновлён. П5 (PR-стек, вливание в `main`, тег `ketos-mvp`, закрытие эпиков, план Ф3) — после ответа пользователя |

## 3. Критерии приёмки этапа

- [x] Пункты аудита П5, П6 и П20–П25 выполнены и закрыты в Beads — подэтапы 22.1–22.4 закрыты с причинами, П24/P25/P20/P22/P21/P23/P6 закрыты отдельными задачами; П5 закрывается после приёмки; `bd list --status=in_progress` пуст, выполнен `bd backup sync`.
- [x] Документация, реестр форка и процесс соответствуют коду и ревизии 18 — README `ui-board`/`clone-core` сверены с кодом (два независимых исследования по исходникам), реестр форка содержит все правки upstream-пакетов из аудита, описания процесса в Beads, `beads.md` и папке плана согласованы с ревизией 18, known limitations полны.
- [x] Пользователю задан вопрос «Принимаете ли вы этап 22?» — задаётся вместе с этим отчётом.
- [ ] После приёмки ветви этапов влиты в `main`, гейты на `main` зелёные, тег `ketos-mvp` создан — ожидает ответа пользователя (пункт П5).

Критерии верификации 22.1–22.5:

- [x] 22.1: решение по профилю и памяти записано и совпадает с кодом; сценарий 20.1 выполним без обходов (шаг B9 называет автора записи — агента); known limitations отражают отсутствие создания записи из окна памяти.
- [x] 22.2: README, описание пакета и комментарии совпадают с кодом; `pnpm run doc-sync` (34 гейта) и `pnpm run verify-translation-pairing` (842 пары) зелёные.
- [x] 22.3: реестр форка содержит все правки upstream-пакетов; описания процесса в Beads, `docs/ketos/beads.md` и папке плана согласованы с ревизией 18; known limitations полны.
- [x] 22.4: `git worktree list` содержит только `main` и worktree этапов (23 строки); `git status` в `main` чист.
- [x] 22.5 (пп. 1–3): сводный чек-лист обновлён на этапы 0–22, гейты этапа прогнаны, отчёт написан, Agent Note MVP обновлён; все задачи и пункты в Beads закрыты, `bd backup sync` выполнен; изменения закоммичены в ветке этапа.

## 4. Отклонения

- **Полоса покрытия наследует отклонения этапа 21.** `pnpm run test:coverage` на этой машине (Node 24.21.0) красный на плавающем `packages/boot/app-boot/tests/hmr-config.spec.ts` (`ketos-inp`) и на Node 26 — на чужом `packages/experimental/agent-team/tests/team.spec.ts` (`ketos-pux`); обе задачи открыты и адресуются вне этапов. Этап 22 не меняет исходники покрытия, а его Definition of Done (`test:gui`, `DSH_SNAPSHOT=replay` `test:web`, `doc-sync`, `build && hygiene`) зелёный; отклонения записаны в [mvp-known-limitations.md](../mvp-known-limitations.md) и [baseline-issues.md](../baseline-issues.md).
- **Правки worktree `docs-plan-sync` перенесены по смыслу, а не `git apply`.** Файлы stage-22 отличаются от базы `stage-05`, поэтому семь незакоммиченных правок (README en/zh/i18n, Agent Note en/zh/i18n, строка отчёта этапа 5) перенесены вручную; ветка удалена (`-D`, потому что не в `main`, уникальных коммитов не было).
- **Артефакты вне MVP вынесены за пределы репозитория.** `presentation/`, `scripts/test-presentation-cdp.mjs` и `docs/ketos/ketos-context-specification.md` живут в `/Volumes/Projects/ketos-context/`; ссылок из репозитория на них не осталось (`verify-md-links` и `doc-sync` зелёные).
- **Зависимость `ketos-inp` → `ketos-5v2.23.5` снята** с обоснованием: гейты этапа 22 не включают полосу покрытия, а задача этапа 21 явно оставлена вне этапов; `ketos-inp` и `ketos-pux` остаются открытыми для пост-MVP.
- **План следующей фазы (Ф3 Части I) ещё не записан** — записывается после приёмки этапа (пункт 22.5.4).

## 5. Проверки

| Команда | Результат |
|---|---|
| `pnpm exec vitest run packages/client/ui-board/tests packages/ketos packages/ketos/client-locale-ru/tests` | зелёный; 53 файла, 768 тестов |
| `pnpm run test:gui` | зелёный; 418 файлов, 6019 passed, 1 skipped |
| `pnpm run typecheck` | зелёный (exit 0) |
| `pnpm run lint` | зелёный (exit 0) |
| `pnpm run doc-sync` | зелёный; 34 гейта (включая markdown links, translation pairing 842 пары, agent note format 373 заметки, md-wrap) |
| `pnpm run build && pnpm run hygiene` | зелёный; 238 клиентских артефактов и 16 гейтов |
| `DSH_SNAPSHOT=replay pnpm run test:web` | зелёный; 101 файл passed, 1 skipped (359 passed, 15 skipped) |
| `pnpm run verify-translation-pairing` | зелёный; 842 пары |
| `git worktree list` | 23 строки: `main` и 22 worktree этапов; `docs-plan-sync` отсутствует |
| `git status --short` в `/Volumes/Projects/Ketos bot` | пусто (рабочее дерево `main` чисто) |

## 6. Следующий шаг

После ответа пользователя на вопрос «Принимаете ли вы этап 22?» агент выполняет пункт П5: публикует ветви этапов GitHub-PR-стеком (labels `kind/*`/`area/*`, проверки на каждой ветви), вливает цепочку в `main` (`git merge --no-ff stage-22-mvp-integration`), разрешает конфликты, прогоняет сводный чек-лист и финальные гейты на `main`, ставит тег `ketos-mvp` на коммит `main`, закрывает эпик этапа 22 и умбрелла-эпик `ketos-5v2` и записывает план следующей фазы (Ф3 Части I мастер-плана). Открытые задачи `ketos-inp` и `ketos-pux` (полоса покрытия) и `ketos-sm1` (graphify) остаются в Beads вне этапов.
