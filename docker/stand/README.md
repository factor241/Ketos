# Стенд «два Кетоса» (этап 26.4)

Два Кетоса рядом в Docker: у каждого свой дом `DSH_HOME` на отдельном томе, свой порт Web и свой Syncthing; общая рабочая папка `/workspace` смонтирована в оба контейнера. Образ собирается из исходников этой ветки (`docker/stand/Dockerfile`), внутри — `ketos web`, `bd` (Beads) и `syncthing`.

## Подготовка

Ключ модели лежит в корневом `.env` (файл в `.gitignore`, в образ не попадает):

```sh
printf 'OPENCODE_GO_API_KEY=%s\n' '<ваш ключ>' > .env
```

## Запуск

Из корня репозитория (worktree):

```sh
docker compose -f docker/stand/compose.yaml up --build
```

Первый запуск собирает образ (установка pnpm-зависимостей и `pnpm run build` внутри образа) — это долго; дальше запуск занимает секунды.

## Адреса

| Что | Кетос A | Кетос B |
|---|---|---|
| Доска (Web) | `http://127.0.0.1:3080/?token=<токен>` | `http://127.0.0.1:3081/?token=<токен>` |
| Syncthing UI | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| Рабочая папка | том `ketos-stand-workspace`, `/workspace` | тот же том |

Токен Кетос печатает при старте: `docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`. Порт в напечатанном адресе совпадает с опубликованным, поэтому адрес открывается с хоста как есть.

Доступ не через петлевой адрес: задайте `KETOS_TRUSTED_HOSTS` (список через запятую) в `compose.yaml` для нужного сервиса — оверлей `stand.patch.yml` передаст значения в забор доверия `/api`. Бинд `0.0.0.0` задан оверлеем: CLI намеренно отклоняет `--host 0.0.0.0` на машине разработчика, а в контейнере это единственный способ достичь опубликованного порта.

## Проверки

```sh
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml down            # остановить
docker compose -f docker/stand/compose.yaml down -v         # сбросить тома (данные стенда)
```

После `restart` доски и чаты на месте — дома и рабочие папки живут в именованных томах. `~/.ketos` на хосте стенд не трогает.

## Состав

- `Dockerfile` — многоступенчатая сборка: node:24-bookworm собирает ветку, runtime получает Syncthing и `bd`.
- `Dockerfile.dockerignore` — контекст без `.env`, `.git`, `references/`, `graphify-out*`.
- `stand.patch.yml` — оверлей профиля: бинд `0.0.0.0`, порт из `KETOS_PORT`, доверенные хосты, маршрут `opencode-go` и модель по умолчанию.
- `docker-entrypoint.sh` — запускает Syncthing и `ketos web` в одном контейнере.
- `compose.yaml` — сервисы `ketos-a` и `ketos-b`, тома и порты.
