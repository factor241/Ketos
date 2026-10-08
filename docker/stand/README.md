# Two-Ketos stand (stage 26.4)

English | [中文](README.zh.md)

Two Ketos instances side by side in Docker: each has its own `DSH_HOME` home on a separate volume, its own Web port, and its own Syncthing; the shared working directory `/workspace` is mounted into both containers. The image is built from this branch's sources (`docker/stand/Dockerfile`) and contains `ketos web`, `bd` (Beads), and `syncthing`. For the demonstration the two instances run on two computers, one service per computer from the same prebuilt image ([Two computers](#two-computers)).

## Preparation

The stand reads two optional environment files: the root `.env` (values shared by the checkout, such as the model key) and `docker/stand/.env` (this computer's participant name, relay URLs, Syncthing GUI key, and model key). Both stay out of git and never enter the image. Copy the example and fill in this computer's values:

```sh
cp docker/stand/.env.example docker/stand/.env
```

## Launch

From the repository root (worktree):

```sh
docker compose -f docker/stand/compose.yaml up --build
```

The first launch builds the image (installing pnpm dependencies and running `pnpm run build` inside the image) and takes a long time; later launches take seconds.

## Two computers

1. On each computer, create `docker/stand/.env` from the example and fill in that computer's `KETOS_PARTICIPANT_NAME` (for example «Кирилл» and «Юрист»), the relay values from `docker/relay/README.md`, and a fresh `STGUIAPIKEY` (`openssl rand -hex 16`).
2. Build the image once, then transfer it instead of rebuilding on the second computer:

```sh
docker save ketos-stand:local | gzip > ketos-stand-<arch>.tar.gz
gzip -dc ketos-stand-<arch>.tar.gz | docker load
```

For the other architecture, build with `docker buildx build --platform linux/amd64 -f docker/stand/Dockerfile -t ketos-stand:local .` (or `linux/arm64`).

3. Computer 1 starts `docker compose -f docker/stand/compose.yaml up -d ketos-a`; computer 2 starts the same command with `ketos-b`.
4. On the first board, open «Участники» and press «Пригласить»; paste the code into «Подключить Кетос» on the second board. Both boards then show two participants, and the channel reconnects on its own after a restart.

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
docker compose -f docker/stand/compose.yaml exec ketos-a syncthing --version
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

After `restart`, the boards and chats are still there: homes and working directories live in named volumes. The stand does not touch `~/.ketos` on the host.

## Syncthing

The image installs the official Syncthing 2.1.5 release archive, pinned by sha256 per architecture (`SYNCTHING_VERSION`, `SYNCTHING_SHA256_ARM64`, `SYNCTHING_SHA256_AMD64` in the `Dockerfile`). The binary lands in `/usr/local/bin/syncthing` and the MPL-2.0 `LICENSE.txt` in `/usr/local/share/doc/syncthing`; the corresponding source is the [v2.1.5 tree](https://github.com/syncthing/syncthing/tree/v2.1.5).

On the first start of an empty Syncthing volume the entrypoint runs `syncthing generate`, then `syncthing-bootstrap.mjs` edits `config.xml` before Syncthing ever runs: global and local announce off, NAT off, crash reporting off, no STUN keepalive, no auto-upgrade, `listenAddresses` = `$KETOS_SYNCTHING_RELAY` and `tcp://0.0.0.0:22000`, and the GUI API key from `$STGUIAPIKEY`. A template drift or a missing relay value fails loud instead of contacting a public node. Check the pinned options with:

```sh
curl -s -H "X-API-Key: $STGUIAPIKEY" http://127.0.0.1:8384/rest/config/options
```

## Beads (`bd`)

The image installs Beads 1.3.1 from the official release archive, pinned by sha256 per architecture (`BD_VERSION`, `BD_SHA256_ARM64`, `BD_SHA256_AMD64` in the `Dockerfile`). The archive's `LICENSE` is kept at `/usr/local/share/doc/beads/LICENSE`. `BD_DISABLE_METRICS=1` and `DO_NOT_TRACK=1` are set image-wide, so `bd` never reports usage.

To update: copy the new version's values from the release `checksums.txt`, replace `BD_VERSION` and both `BD_SHA256_*` arguments, then rebuild and check:

```sh
docker compose -f docker/stand/compose.yaml build ketos-a
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
```

## Contents

- `Dockerfile` — a multi-stage build: node:24-bookworm builds the branch, and the runtime receives the checksum-pinned Syncthing and `bd`.
- `Dockerfile.dockerignore` — the build context without `.env`, `.git`, `references/`, and `graphify-out*`.
- `stand.patch.yml` — the profile overlay: the `0.0.0.0` bind, the port from `KETOS_PORT`, trusted hosts, the `opencode-go` route, the default model, and the enabled `ketos-peer` row with this computer's identity and relay.
- `docker-entrypoint.sh` — starts Syncthing and `ketos web` in one container.
- `syncthing-bootstrap.mjs` — pins the generated Syncthing config to the private relay before the first run.
- `.env.example` — this computer's participant name, relay URLs, Syncthing GUI key, and model key.
- `compose.yaml` — the `ketos-a` and `ketos-b` services, volumes, and ports.
