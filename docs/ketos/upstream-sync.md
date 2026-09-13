# Ketos ↔ DeepSeek Harness: политика синхронизации с upstream

Файл принадлежит форку Ketos и находится вне upstream-дерева документации (решение 30 Части I). База форка — коммит `d5675c2` (поверх релизной линии `c291e79` 0.1.5-rc.2 и коммита доски `fe89719`), зафиксированная тегом `ketos-base-d5675c2` на ветке `main`.

## Ремоуты

```sh
git remote -v
# origin    https://github.com/factor241/ketos.git   (репозиторий Кетос)
# upstream  https://github.com/deepseek-ai/deepseek-harness.git
# base      /Volumes/Projects/deepseek-harness/.     (локальный чекаут базы)
```

## Ритм

- Еженедельно — автоматический мониторинг релизов upstream (CI-джоба проверки тегов).
- Приёмка апстрим-релизов — раз в спринт (либо по месяцу, если релизов не было).
- Между приёмками upstream не мержится: ветки усыхающих фич на upstream не чекируются.

## Процедура приёмки (по тегам)

```sh
cd forks/ketos                                    # рабочее дерево Кетос
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
