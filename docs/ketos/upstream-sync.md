# Ketos ↔ DeepSeek Harness: политика синхронизации с upstream

Файл принадлежит репозиторию Ketos и находится вне upstream-дерева документации (решение 30 Части I). Рабочее дерево — `/Volumes/Projects/Ketos bot` (GitHub `factor241/Ketos`); единственная основная ветка — `main`, унаследованная `feat/ketos-spatial-board` выведена из обращения (её содержимое — база `d5675c2`, зафиксированная тегом). База форка — коммит `d5675c2` (поверх релизной линии `c291e79` 0.1.5-rc.2 и коммита доски `fe89719`), зафиксированный тегом `ketos-base-d5675c2`. Из-за shallow-клона ветка `main` переимпортирована синтетическим корнем `f5d8f1e` и переигранными коммитами `bbe514e`/`a4b5114` с теми же деревьями, поэтому база фиксируется тегом, а не предком в графе.

## Ремоуты

```sh
git remote -v
# origin    https://github.com/factor241/Ketos.git   (репозиторий Ketos)
# upstream  https://github.com/deepseek-ai/deepseek-harness.git
# base      /Volumes/Projects/deepseek-harness/.     (локальный чекаут базы)
```

## Рабочее дерево и worktrees этапов

Каждый этап (начиная с этапа 1) выполняется в отдельном git-worktree, созданном от `main`; ветка и каталог несут номер и slug этапа. Ветка вливается в `main` только после зелёных критериев приёмки этапа, после чего worktree удаляется. Каталоги worktree живут рядом с репозиторием и не коммитятся.

```sh
cd "/Volumes/Projects/Ketos bot"
git worktree add "/Volumes/Projects/Ketos bot.worktrees/stage-01" -b stage-01-dev-stand main
# работа и гейты этапа — в каталоге worktree
git switch main && git merge --no-ff stage-01-dev-stand
git worktree remove "/Volumes/Projects/Ketos bot.worktrees/stage-01"
```

## Ритм

- Еженедельно — автоматический мониторинг релизов upstream (CI-джоба проверки тегов).
- Приёмка апстрим-релизов — раз в спринт (либо по месяцу, если релизов не было).
- Между приёмками upstream не мержится: ветки усыхающих фич на upstream не чекируются.

## Процедура приёмки (по тегам)

```sh
cd "/Volumes/Projects/Ketos bot"                  # рабочее дерево Ketos
git fetch upstream                                # тянет прод upstream
git tag -l 'v*' --sort=-creatordate | head        # выбрать целевой релизный тег
git switch main
git merge --no-ff <тег> -m "Merge upstream <тег> into main"
```

1. Перед merge: `git switch -c sync/<тег> main` — приёмка всегда в ветке, main получает merge только после зелёных гейтов.
2. Конфликты советуются с `docs/ketos/brand-inventory.md`: ожидаемые места — файлы из серии ребрендинга (CLI-строки, веб-бренд, констрейнты скриптов). Стилистика сверки — «Часть II уточняет Часть I»: сохраняется брендовая и созданная логика Кетоса, upstream-остаток уделяется в пользу пришедшего кода, если брендовая строка вокруг него изменилась.
3. После merge в ветке `sync/<тег>`:
   ```sh
   pnpm install
   pnpm run typecheck
   pnpm run test:gui
   DSH_SNAPSHOT=replay pnpm run test:web
   pnpm run build:native-system
   git switch main && git merge --ff-only sync/<тег>
   git tag ketos-merged-<тег>
   ```

## Правило

- Upstream-приёмка никогда не двигает внутренние идентификаторы (`@deepseek-ai/*`, `DSH_*`, профили, `dsh.*`-поля) — это и есть совместимость форка (решение 6).
- Ребрендинг-изменения не распространяются на новые upstream-файлы автоматически: новые поверхности классифицируются по `docs/ketos/brand-inventory.md` до попадания в серию ребрендинга.
