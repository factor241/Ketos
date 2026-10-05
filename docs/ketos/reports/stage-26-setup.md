# Этап 26. Установка: референсные проекты, граф и стенд Docker — отчёт

> План: [stage-26-setup.md](/Users/kirillustuzanin/Downloads/ketos_v7_master_plan/stage-26-setup.md). Эпик Beads: `ketos-qzb.1` в умбрелле-эпике `ketos-qzb` «Новый Кетос: показ 16 октября». Ветка: `stage-26-setup`, worktree `/Volumes/Projects/Ketos bot.worktrees/stage-26` (создан от `main`). Референсные проекты и граф — в основной папке `/Volumes/Projects/Ketos bot`; `~/.ketos` не трогали.

## 1. Итог этапа

Все подэтапы выполнены: шесть референсных проектов лежат в `references/` (исключены из git локально), `references/**` добавлен в `ignorePatterns` линтера, граф Кетоса обновлён инкрементально и содержит все шесть проектов с семантическим слоем (140 574 узла, 6 287 сообществ; 0 узлов и рёбер Кетоса потеряно), стенд Docker из двух Кетосов с Syncthing и `bd` поднимается одной командой и проверен браузером, зависимости этапов 27–36 проверены на macOS и в Linux. Изменения в worktree не коммитились и не пушились; стенд оставлен запущенным на этой машине.

## 2. Подэтапы

| Подэтап | Задача Beads | Статус | Подтверждение |
|---|---|---|---|
| 26.1 Референсные проекты | `ketos-qzb.1.3` | выполнен | шесть папок в `references/`; `git -C references/<папка> rev-parse HEAD` в таблице §3; `git status --short` в основной папке не показывает `references/` |
| 26.2 Исключения | `ketos-qzb.1.5` | выполнен | `references/**` в `ignorePatterns` (worktree, одна строка); `pnpm -r ls --depth -1` — 342 проекта, 0 путей `references`; `pnpm exec vitest list` — 40 306 строк, 0 путей `references`; oxlint по `references/` не находит файлов |
| 26.3 Обновление графа | `ketos-qzb.1.4` | выполнен | граф: 140 574 узла / 351 047 рёбер / 6 287 сообществ / 313 hyperedges; узлы из всех шести `references/`; 0 старых узлов потеряно; пять контрольных запросов подтверждены кодом (§5); `bd remember ketos-graphify-status` обновлён |
| 26.4 Стенд Docker | `ketos-qzb.1.2` | выполнен | `docker compose -f docker/stand/compose.yaml up -d`: оба Кетоса, обе доски по напечатанным адресам с токеном, чат ответил в обоих, `bd version` 1.3.1, оба Syncthing UI (200), данные пережили `restart` (§6) |
| 26.5 Зависимости | `ketos-qzb.1.1` | выполнен | `@number0/iroh` 1.1.0, `yjs` 13.6.33, `perfect-freehand` 1.2.3 — установка и проверки прошли на macOS arm64, Linux arm64 и Linux x64 (§7) |

## 3. 26.1. Референсные проекты

Неглубокие копии (`git clone --depth 1`, ветка по умолчанию) в `/Volumes/Projects/Ketos bot/references/`; папка исключена строкой `references/` в `.git/info/exclude` (основная папка), поэтому `git status --short` её не показывает. Размеры — `du -sh` после клонирования.

| Папка | Репозиторий | Коммит | Размер | Лицензия |
|---|---|---|---|---|
| `references/beads` | `github.com/gastownhall/beads` | `6d7fecaa3eff8449d1c53de6f961ac302bf149e5` | 69 МБ | MIT |
| `references/syncthing` | `github.com/syncthing/syncthing` | `4461a1ce354d3990660966ad70176e00246adb61` | 22 МБ | MPL-2.0 |
| `references/iroh` | `github.com/n0-computer/iroh` | `b4c8fc68ef21b78781741fab8c6c86a1043d0f97` | 4.3 МБ | MIT или Apache-2.0 |
| `references/iroh-ffi` | `github.com/n0-computer/iroh-ffi` | `3103bf5295be6d50c5272ff7a426e9b539f3f587` | 6.7 МБ | MIT или Apache-2.0 |
| `references/yjs` | `github.com/yjs/yjs` | `4d75cc8e4024dbb1f554737aa93c68b2e54adebe` | 1.7 МБ | MIT |
| `references/perfect-freehand` | `github.com/steveruizok/perfect-freehand` | `176e00f2399f4969e1b0965c5921d96a3e50ce9f` | 5.2 МБ | MIT |

## 4. 26.2. Исключения для инструментов репозитория

Единственное отслеживаемое изменение подэтапа — строка `"references/**"` в `ignorePatterns` файла `.oxlintrc.json` в worktree (`git diff --stat`: 1 insertion) с комментарием, что каталог питает только граф.

Остальные инструменты папку не видят (проверено): рабочие пакеты pnpm перечислены явно в `pnpm-workspace.yaml` (`pnpm -r ls --depth -1 --json` — 342 проекта, ни одного `references`); `pnpm exec vitest list` (40 306 строк) не содержит путей `references/`; корневой `tsconfig.json` — solution-файл `files: []` без `include`; `jscpd` запускается как `jscpd --config .jscpd.json packages scripts`; проверки документации используют фиксированные шаблоны путей. Прогон oxlint с обновлённым конфигом по `references/` отвечает «No files found to lint», то есть паттерн исключения работает.

## 5. 26.3. Обновление графа

### 5.1. Резервная копия и правила шума

Резервная копия до обновления: `graphify-out.bak-2026-10-05-stage26-pre` (396 МБ, клон APFS). В `.graphifyignore` добавлен блок `references/`: negation `!references/` (важно: graphify читает `.git/info/exclude` первым и последнее совпадение побеждает, поэтому `references/` из exclude перекрывается именно negation) и правила шума — `.git`, `node_modules`, `target`, `dist`, `build`, `.github`, `CHANGELOG*`, `testdata`, `fixtures`; для Syncthing negation `!references/syncthing/lib/` (глобальное правило `lib/` иначе съедало ядро) и исключения GUI/man/etc/relnotes/test/assets; для beads — `docs/cli-reference`, `docs/images`, `docs/diagrams`, `release-gates`, `npm-package`, `winget`, `.github`; для iroh — `docker/`; для perfect-freehand — демо `packages/dev/`.

### 5.2. Что было переизвлечено

`detect_incremental` (109 с): полный корпус 12 823 файла; новых 5 044 (4 695 кода, 336 документов, 13 изображений), удалённых 0. Среди «новых» — 177 файлов кода и 21 документ Кетоса, которых не было в манифесте прошлой сборки (пробелы корпуса, а не изменения: HEAD и рабочее дерево те же).

Структурное извлечение: 4 695 файлов → 56 826 узлов и 208 196 рёбер за 50,6 с (tree-sitter; 196 мелких JSON-конфигов дали 0 узлов, 173 `.sql` не извлеклись без `graphifyy[sql]`, 2 файла с синтаксическими ошибками частично — `iroh-ffi/kotlin/.../iroh_ffi.kt`, `yjs/global.d.ts`). Семантическое извлечение: 349 файлов (336 документов + 13 изображений) → 35 чанков, покрытие 349/349, 2 505 узлов, 3 556 рёбер, 68 hyperedges (субагенты general, модель `opencode-go/deepseek-v4.1-flash`; vision на изображениях работает).

### 5.3. Восстановление после смены ID-схемы (отклонение)

`build_merge` при замене переизвлечённых источников снёс 5 925 старых узлов и 7 377 рёбер у 7 923 источников Кетоса: детектор пометил их как «изменённые» из-за пустого `semantic_hash` в манифесте прошлой сборки, а json-экстрактор текущей версии graphify строит другие ID (`..._package_json_<dep>` вместо старой схемы). Все 7 923 источника оказались неизменёнными (сверка MD5 с `ast_hash` манифеста: changed = 0), поэтому слияние отредактировано скриптом восстановления: для каждого неизменённого источника старые узлы/рёбра возвращены, новые варианты удалены. После правки: 140 575 узлов, старых узлов потеряно 0. Дополнительно удалён один шумовой узел `ref_network` (концепт из `keywords` `iroh-js/package.json`) вместе с ребром — чтобы правило «0 рёбер к общим понятиям» не нарушалось новой записью. Манифест перезаписан (`kind=both`: штампуются и `ast_hash`, и `semantic_hash`), поэтому повторный `--update` эти файлы не переоформит.

### 5.4. Граф до и после

| Показатель | До (бэкап) | После |
|---|---|---|
| Узлы | 81 384 | 140 574 |
| Рёбра | 172 008 | 351 047 |
| Сообщества | 5 156 | 6 287 |
| Hyperedges | 252 | 313 |
| Узлы Кетоса | 81 384 | 82 091 (все прежние 81 384 на месте; +3 289 глобальных символьных узлов без `source_file` из разрешения ссылок в коде references, +118 узлов из 25 файлов Кетоса, которых не было в прошлой сборке) |

Узлы из `references/` по проектам: beads 39 130, syncthing 6 419, iroh-ffi 5 402, iroh 3 068, yjs 1 351, perfect-freehand 415. Названия сообществ: 4 207 переиспользованы по подписи состава (`.graphify_labels.json.sig`), 2 141 новым сообществам присвоены hub-имена (детерминированно по узлу-хабу); LLM-имена для новых community не запускались — это следующий шаг при необходимости. Итоговый перезапуск кластеризации после снятия `ref_network` применил модель сообществ к 140 574 узлам.

### 5.5. Правила качества ketos-sm1 и контрольные запросы

| Проверка | Результат |
|---|---|
| 0 висячих концов | 0 рёбер с отсутствующим концом; health-диагностика: 0 dangling, 0 missing, 0 collapsed, 4 self-loop (рекурсивные вызовы AST, норма) |
| 0 семантических рёбер с `confidence_score` 0.5 | 0: все 1 821 ребро с 0.5 — AST (`indirect_call` 1 641, `uses` 177, `imports_from` 3) |
| 0 рёбер к общим понятиям | новых нет: единственная новая запись (`network` из keywords) удалена; остаются 7 базовых рёбер к концептам `Service` из документации Cordis (были и в бэкапе) |
| references-рёбер ≥ 80 | 70 551 |
| Узлы Кетоса не потеряны | старых узлов потеряно 0 (81 384/81 384) |

Пять контрольных запросов к графу (каждый ответ содержит узлы с `source_file` в `references/` и подтверждается кодом):

| Запрос | Подтверждение по коду |
|---|---|
| «How do Yjs updates merge with Y.mergeUpdates and resolve conflicts?» | `references/yjs/src/utils/encoding.js` (mergeUpdates, mergeUpdatesV2, encodeStateAsUpdateV2) |
| «How does perfect-freehand build a stroke outline from input points?» | `references/perfect-freehand/packages/perfect-freehand/src/getStrokeOutlinePoints.ts` (getStrokeOutlinePoints), GIF-анимация процесса |
| «How does iroh create an endpoint and connect two nodes with QUIC?» | `references/iroh/iroh/src/endpoint.rs` (Endpoint), `references/iroh/iroh/README.md` |
| «How does bd sync its Dolt database with the remote?» | `references/beads/internal/storage/dolt/store.go` (DoltStore), `internal/storage/domain/remote.go` |
| «How does Syncthing discover devices on the local network?» | `references/syncthing/lib/protocol/deviceid.go` (DeviceID), `lib/config/...`, README |

### 5.6. Выходные файлы

`graphify-out/graph.json` (209 МБ, `built_at_commit` ветки), `GRAPH_REPORT.md` (1.1 МБ), `graph.html` (5.0 МБ, агрегированный вид 6 287 community-узлов; понадобился `GRAPHIFY_VIZ_NODE_LIMIT=7000`, потому что агрегат превысил жёсткий лимит 5 000), `wiki/` (6 297 статей), `manifest.json` (12 823 файла), `.graphify_labels.json` + `.sig`, `cost.json`. Стоимость семантического прохода в токенах не измерена: инструмент запуска субагентов не отдаёт usage — в `cost.json` запись с нулями и пометкой; это отклонение учтено.

## 6. 26.4. Стенд Docker на два Кетоса

Каталог `docker/stand/` (worktree): `Dockerfile` (двухступенчатая сборка из исходников ветки: node:24-bookworm собирает, runtime получает Syncthing и `bd`; перед сборкой создаётся локальный git-снимок, потому что клиентская сборка читает `git rev-parse HEAD`), `Dockerfile.dockerignore` (контекст без `.env`, `.git`, `references/`, `graphify-out*`), `compose.yaml` (сервисы `ketos-a` и `ketos-b`; у каждого свой дом `DSH_HOME`, свой том Syncthing и общий том рабочей папки `ketos-stand-workspace`), `docker-entrypoint.sh` (Syncthing + `ketos web` в одном контейнере), `stand.patch.yml` (оверлей профиля), `README.md`.

Запуск: `docker compose -f docker/stand/compose.yaml up -d` из worktree (после первого `--build`). Адреса печатаются в логе: A — `http://127.0.0.1:3080/?token=…` (LAN `http://172.18.0.2:3080/?token=…`), B — `http://127.0.0.1:3081/?token=…` (LAN `172.18.0.3:3081`); порты хоста совпадают с напечатанными, поэтому адрес с токеном открывается как есть. Syncthing UI: `http://127.0.0.1:8384` и `:8385`. Ключ модели приходит только переменными окружения из корневого `.env` через `env_file` (в образ не попадает; в `.dockerignore`).

Проверки (наблюдаемые): обе доски открылись в браузере (заголовок «Кетос», скриншоты `assets/stage-26-board-a.png`, `assets/stage-26-board-b.png`); чат ответил в A («Ответь одним словом: работает» → «работает», 3 с) и в B («…стенд» → «стенд», 2 с); `docker compose exec ketos-a bd version` → `bd version 1.3.1`; оба Syncthing UI отвечают 200 (v1.19.2 из Debian); после `docker compose restart` сессии в томах на месте (по 2 файла `session.v4.jsonl.zstd` в каждом) и история чатов восстановилась в обоих окнах при новых токенах; файл, записанный в A в `/workspace`, виден в B (общий том).

Отклонения стенда: `--host 0.0.0.0` CLI намеренно отклоняет (безопасность), поэтому бинд `0.0.0.0` задан оверлеем `stand.patch.yml` внутри контейнера, где опубликованный порт — единственный вход; `--trusted-host` поддержан (`KETOS_TRUSTED_HOSTS`, по умолчанию `localhost`) для доступа через LAN-имя; в worktree этапа создан симлинк `.env` на корневой `.env` (compose разрешает `env_file` относительно своего каталога; после переноса в main это обычный корневой `.env`); образ ставит `bd` 1.3.1 (последний релиз на момент сборки; на хосте Homebrew-версия 1.2.2); LAN-адреса в логе указывают на адрес контейнера и с хоста не используются — рабочий адрес с хоста это loopback-URL с тем же портом.

## 7. 26.5. Проверки зависимостей этапов 27–36

Временная папка `/var/folders/.../T/opencode/stage26-deps` (вне репозитория), три скрипта-проверки и три окружения: macOS arm64 (Node 26.3.1), Linux arm64 (`node:24-bookworm`, Docker), Linux x64 (`node:24-bookworm --platform linux/amd64`, Rosetta). Версии: `@number0/iroh` 1.1.0, `yjs` 13.6.33, `perfect-freehand` 1.2.3.

| Пакет | Проверка | Результат (macOS / Linux arm64 / Linux x64) |
|---|---|---|
| `@number0/iroh` | два endpoint (presetMinimal, привязка `127.0.0.1:0`), соединение по direct-адресу, ALPN, обмен сообщением по bi-stream | во всех трёх: `connected=true`, id совпал, сообщение доставлено; готовые бинарные сборки есть для darwin-arm64, linux-arm64-gnu, linux-x64-gnu |
| `yjs` | два `Y.Doc` обмениваются обновлениями, сходимость текста и Map, `Y.mergeUpdates` | во всех трёх: тексты совпали, merged-документ совпал |
| `perfect-freehand` | `getStroke`/`getStrokePoints`/`getStrokeOutlinePoints` по точкам | во всех трёх: 52 точки контура, все координаты конечны |

Ограничения: `@number0/iroh` даёт Node-deprecation `DEP0128` (поле `main` указывает на `iroh-js/index.js` без `./`), на работу не влияет; `yjs` в Node печатает `ExperimentalWarning` про `localStorage`; серверная сторона соединения завершается через `Incoming.accept()` → `Accepting.connect()` (не `Connection` сразу) — это учтено в проверочном скрипте; `presetMinimal` не использует ретрансляторы и обнаружение, между машинами понадобится собственный relay/поиск (решение линии это и предусматривает); для соединения двух узлов внутри одного хоста достаточно direct-адреса.

## 8. Отклонения

- Восстановление 5 925 узлов после смены ID-схемы json-экстрактора (§5.3) — не предусмотрено промптом, но обязательно для критерия «узлы не потеряны»; по итогу 0 потерь.
- Один новый generic-концепт (`network` из `keywords` `iroh-js/package.json`) удалён вместе с ребром; 7 базовых рёбер к `Service` из документации Cordis остались нетронутыми (были до этапа).
- `graph.html` собран в агрегированном виде с повышенным лимитом (`GRAPHIFY_VIZ_NODE_LIMIT=7000`): агрегат 6 287 сообществ превышает стандартный лимит 5 000.
- Токены семантического извлечения не измерены (`cost.json` — нули с пометкой).
- Новым 2 141 сообществу присвоены hub-имена, а не LLM-имена.
- Стенд: бинд `0.0.0.0` задан оверлеем (CLI-флаг отклонён продуктом), `bd` 1.3.1 вместо 1.2.2 хоста, симлинк `.env` в worktree этапа.
- В `.graphifyignore` появились правила для `references/`; файл не коммитится и живёт локально.
- Ничего не коммитилось и не пушилось; отдельные задачи Beads не создавались — отклонений, требующих новых issue, нет.

## 9. Проверки

| Команда | Результат |
|---|---|
| `git -C references/<проект> rev-parse HEAD` (×6) | полные коммиты в таблице §3 |
| `du -sh references/<проект>` (×6) | размеры 1.7–69 МБ |
| `git status --short` (основная папка) | `references/` отсутствует |
| `pnpm -r ls --depth -1 --json` | 342 проекта, 0 путей `references` |
| `pnpm exec vitest list` | 40 306 строк, 0 путей `references/` |
| oxlint с обновлённым конфигом по `references/` | «No files found to lint» |
| `detect_incremental` | 12 823 файла в корпусе, 5 044 новых, 0 удалённых |
| AST extract (4 695 файлов) | 56 826 узлов, 208 196 рёбер, 50.6 с |
| Семантика (35 чанков) | 349/349 файлов, 2 505 узлов, 3 556 рёбер, 68 hyperedges |
| Кластеризация + имена | 140 574 узла / 351 047 рёбер / 6 287 сообществ; 4 207 имён переиспользовано, 2 141 hub |
| Health-диагностика | 0 dangling, 0 missing, 0 collapsed, 4 self-loop |
| `graphify export html` (лимит 7 000) | 6 287 community-узлов, 11 614 межсообщных рёбер |
| `graphify export wiki` | 6 297 статей |
| Пять `graphify query` | подтверждение кодом `references/` (§5.5) |
| `docker compose -f docker/stand/compose.yaml up -d` | оба контейнера Up, 0.0.0.0:3080/3081 и 8384/8385 |
| Браузер (Playwright): доски A и B, чаты A и B | доски открылись; ответы «работает» и «стенд» |
| `docker compose exec ketos-a bd version` | `bd version 1.3.1` |
| `curl http://127.0.0.1:8384/` и `:8385/` | 200, 200 |
| `docker compose restart` + повторная проверка | сессии в томах и история чатов на месте |
| `mount` + файл в `/workspace` из A, чтение в B | общий том `ketos-stand_ketos-stand-workspace` |
| Три зависимости × три платформы | 9/9 проверок пройдено |

## 10. Следующий шаг

До приёмки: вопрос «Принимаете ли вы этап?». После ответа «да»: закрыть эпик `ketos-qzb.1` (задачи 26.1–26.5 уже закрыты), при необходимости обновить планы этапов 27–36 по обновлённому графу (первые — фронтенд: подложка окна по `stage-27-window-bezel-design.md`, заметки, кисть, туду-листы; затем бэкенд), решить судьбу незакоммиченных изменений worktree (`.oxlintrc.json`, `docker/stand/`, отчёт) и стенда (оставлен запущенным). Ветка `stage-26-setup` не слита в `main` — по процессу этапов перенос в `main` делается только после завершения всех этапов линии.
