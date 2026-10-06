# Two-Ketos stand (stage 26.4)

English | [中文](README.zh.md)

Two Ketos instances side by side in Docker: each has its own `DSH_HOME` home on a separate volume, its own Web port, and its own Syncthing; the shared working directory `/workspace` is mounted into both containers. The image is built from this branch's sources (`docker/stand/Dockerfile`) and contains `ketos web`, `bd` (Beads), and `syncthing`.

## Preparation

The model key lives in the root `.env` (the file is in `.gitignore` and never enters the image):

```sh
printf 'OPENCODE_GO_API_KEY=%s\n' '<your key>' > .env
```

## Launch

From the repository root (worktree):

```sh
docker compose -f docker/stand/compose.yaml up --build
```

The first launch builds the image (installing pnpm dependencies and running `pnpm run build` inside the image) and takes a long time; later launches take seconds.

## Addresses

| What | Ketos A | Ketos B |
|---|---|---|
| Board (Web) | `http://127.0.0.1:3080/?token=<token>` | `http://127.0.0.1:3081/?token=<token>` |
| Syncthing UI | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| Working directory | volume `ketos-stand-workspace`, `/workspace` | the same volume |

Ketos prints its token at startup: `docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`. The port in the printed address matches the published port, so you can open that address from the host as is.

For access over a non-loopback address, set `KETOS_TRUSTED_HOSTS` (a comma-separated list) in `compose.yaml` for the relevant service: the `stand.patch.yml` overlay passes the values to the trusted-host check on `/api`. The `0.0.0.0` bind is set by the overlay: the CLI deliberately rejects `--host 0.0.0.0` on a developer machine, while in a container it is the only way to reach the published port.

## Checks

```sh
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

After `restart`, the boards and chats are still there: homes and working directories live in named volumes. The stand does not touch `~/.ketos` on the host.

## Contents

- `Dockerfile` — a multi-stage build: node:24-bookworm builds the branch, and the runtime receives Syncthing and `bd`.
- `Dockerfile.dockerignore` — the build context without `.env`, `.git`, `references/`, and `graphify-out*`.
- `stand.patch.yml` — the profile overlay: the `0.0.0.0` bind, the port from `KETOS_PORT`, trusted hosts, the `opencode-go` route, and the default model.
- `docker-entrypoint.sh` — starts Syncthing and `ketos web` in one container.
- `compose.yaml` — the `ketos-a` and `ketos-b` services, volumes, and ports.
