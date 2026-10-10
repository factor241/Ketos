# Two-Ketos stand (stage 26.4)

English | [中文](README.zh.md)

Two Ketos instances side by side in Docker: each has its own `DSH_HOME` home, its own working directory `/workspace`, its own Syncthing home, and its own Web port, all on separate volumes. Files reach the other side only through the Syncthing folder `/workspace/shared` ([Working directories](#working-directories)). The image is built from this branch's sources (`docker/stand/Dockerfile`) and contains `ketos web`, `bd` (Beads), and `syncthing`. For the demonstration the two instances run on two computers, one service per computer from the same prebuilt image ([Two computers](#two-computers); a Windows 11 computer: [Windows 11 (computer B)](#windows-11-computer-b); the order of a demonstration from empty volumes: [Demonstration from scratch](#demonstration-from-scratch)).

## Preparation

The stand reads two optional environment files: the root `.env` (values shared by the checkout, such as the model key) and `docker/stand/.env` (this computer's participant name, relay URLs, Syncthing GUI key, and model key). Both stay out of git and never enter the image: `Dockerfile.dockerignore` excludes every `.env` file at any depth, and the build fails if one is copied. Docker Desktop needs at least 8 GiB of memory for the build. Copy the example and fill in this computer's values:

```sh
cp docker/stand/.env.example docker/stand/.env
```

The model key line `OPENCODE_GO_API_KEY=` in `docker/stand/.env` is commented out in the example: uncomment it and fill it in, or set the key in the root `.env`, because the agent on this computer cannot work without it. Never leave an empty `OPENCODE_GO_API_KEY=` line in `docker/stand/.env`: that file is read after the root `.env`, so the empty value replaces the key set there.

When both services run on one computer, `ketos-b` takes its participant name from `KETOS_B_PARTICIPANT_NAME` and falls back to `KETOS_PARTICIPANT_NAME`, so the two boards show different names.

## Launch

From the repository root (worktree):

```sh
docker compose -f docker/stand/compose.yaml up --build
```

The first launch builds the image (installing pnpm dependencies and running `pnpm run build` inside the image) and takes a long time; later launches take seconds.

## Working directories

Each service mounts its own volume at `/workspace` (`ketos-a-workspace` and `ketos-b-workspace`), so no file moves between the two Ketos instances except through Syncthing, with or without the `relay-only.compose.yaml` overlay. On every start the entrypoint creates `/workspace/shared` and, when it does not exist yet, seeds `/workspace/shared/.stignore` with `.DS_Store`, `*.tmp`, and `~*`; an existing `.stignore` is never overwritten. Syncthing does not synchronize `.stignore` itself, so each side keeps its own copy.

A stand created before the working directories were separated still holds the old shared volume `ketos-stand-workspace`. Nothing uses it any more and stand data is disposable, so remove it once by hand:

```sh
docker volume rm ketos-stand_ketos-stand-workspace
```

The two volumes of one computer, `ketos-a-workspace` with `ketos-a-syncthing` (computer B: `ketos-b-workspace` with `ketos-b-syncthing`), belong together. Syncthing keeps a marker `.stfolder` in the shared folder and refuses to sync a folder whose marker is missing («folder marker missing»), which is what remains when the workspace volume is wiped and the Syncthing volume is kept. Each computer removes only its own two volumes, both or neither, with its containers removed first. Computer A:

```sh
docker compose -f docker/stand/compose.yaml down
docker volume rm ketos-stand_ketos-a-workspace ketos-stand_ketos-a-syncthing
```

Computer B:

```sh
docker compose -f docker/stand/compose.yaml down
docker volume rm ketos-stand_ketos-b-workspace ketos-stand_ketos-b-syncthing
```

## Two computers

1. On each computer, create `docker/stand/.env` from the example and fill in that computer's `KETOS_PARTICIPANT_NAME` (a quoted name with its role in parentheses, at most 64 characters, for example `"Кирилл (Руководитель)"` and `"Юрий (Юрист)"`), the relay values from `docker/relay/README.md`, and a fresh `STGUIAPIKEY` (`openssl rand -hex 16`; Windows has no `openssl`, so in PowerShell use `[guid]::NewGuid().ToString('N')`; both give 32 hex characters).
2. Build the image once, then transfer it instead of rebuilding on the second computer. The build computer's own image is `ketos-stand:local`. Save the archive outside the repository: the repository root is the build context, so an archive there would be copied into the next image (`Dockerfile.dockerignore` and `.gitignore` skip `*.tar.gz` as a safety net):

```sh
docker save ketos-stand:local | gzip > ~/ketos-stand-<arch>.tar.gz
gzip -dc ~/ketos-stand-<arch>.tar.gz | docker load
```

For a computer of the other architecture, build from the repository root under an architecture tag, never as `ketos-stand:local`, which would replace the build computer's own image: `docker buildx build --platform linux/amd64 --load -f docker/stand/Dockerfile -t ketos-stand:amd64 .` (or `linux/arm64` with `-t ketos-stand:arm64`). Save that tag instead of `ketos-stand:local`, and on the other computer tag it as `ketos-stand:local` after `docker load` (`docker tag ketos-stand:amd64 ketos-stand:local`), as [Windows 11 (computer B)](#windows-11-computer-b) shows step by step.

3. Computer 1 starts `docker compose -f docker/stand/compose.yaml up -d ketos-a`; computer 2 starts the same command with `ketos-b`.
4. On the first board, open «Участники» and press «Пригласить»; paste the code into «Подключить Кетос» on the second board. Both boards then show two participants, and the channel reconnects on its own after a restart.

## Windows 11 (computer B)

Computer B can be a Windows 11 PC with an Intel processor (x86-64) and Docker Desktop on the WSL2 backend. The steps below prepare it.

1. Give WSL2 at least 8 GiB of memory: create `%UserProfile%\.wslconfig` with the content below, then run `wsl --shutdown` and restart Docker Desktop.

```ini
[wsl2]
memory=8GB
```

2. On the build computer, run the commands from the repository root (the build context is `.`). Build the amd64 image under the tag `ketos-stand:amd64`, not `ketos-stand:local`, which is the build computer's own image, and save the archive outside the repository. Then copy the archive to computer B, into its user folder (`%UserProfile%`):

```sh
docker buildx build --platform linux/amd64 --load -f docker/stand/Dockerfile -t ketos-stand:amd64 .
docker save ketos-stand:amd64 | gzip > ~/ketos-stand-amd64.tar.gz
```

3. On computer B, load the image from the copied archive and tag it with the name `compose.yaml` expects, `ketos-stand:local`. `docker load` reads the gzip file as it is, so the archive is not unpacked first:

```powershell
docker load -i $HOME\ketos-stand-amd64.tar.gz
docker tag ketos-stand:amd64 ketos-stand:local
```

4. Computer B needs two files in the repository's layout: `docker/stand/compose.yaml` and `docker/stand/.env`, which you create from `docker/stand/.env.example` (copy that file to computer B as well). Uncomment `OPENCODE_GO_API_KEY=` in that `.env` and fill in the model key (or set the key in the root `.env`): the agent on computer B cannot work without it. The optional root `.env` (`../../.env` relative to `compose.yaml`) and a source checkout are not needed, and `relay-only.compose.yaml` is for one-computer tests, not for two real computers.
5. Save `docker/stand/.env` (and a root `.env`, if you create one) as UTF-8 without a byte order mark and with LF line endings; in VS Code both are selectable in the status bar. A byte order mark or CRLF line endings can corrupt the first variable name or the values. Quote the participant name: it carries the role in parentheses, so it contains spaces, and it is limited to 64 characters:

```sh
KETOS_PARTICIPANT_NAME="Юрий (Юрист)"
```

6. From the directory that contains `docker/`, start only service B, without building:

```powershell
docker compose -f docker/stand/compose.yaml up -d --no-build ketos-b
```

7. Read the board address with its token:

```powershell
docker compose -f docker/stand/compose.yaml logs ketos-b | Select-String "ketos web:"
```

Service `ketos-b` publishes the Web board on port 3081 and the Syncthing GUI on `127.0.0.1:8385` (loopback only).

## Demonstration from scratch

A demonstration from scratch starts both computers with `docker compose -f docker/stand/compose.yaml down -v`. The command removes the computer's stand volumes: the Ketos home (`DSH_HOME`) with the board, the chats, the iroh node key `peer.key`, the known peers `peers.json`, and the Ketos Beads database; the Syncthing home with its configuration; and the working directory, which goes together with the Syncthing volume as [Working directories](#working-directories) requires. Each demonstration therefore links the two Ketos instances with a new invitation code.

In the commands below, `<VPS>` is the VPS address and `<relay-host>` is the host name in `KETOS_RELAY_URLS`.

1. On the VPS, check that the `iroh-relay` and `strelaysrv` services are running; `/opt/ketos-relay` is the deployment directory of the [relay README](../relay/README.md):

```sh
ssh <user>@<VPS>
cd /opt/ketos-relay && docker compose ps
```

2. On computer A (macOS), send the HTTPS request of step 1 of «Reading the credentials for the stand» in the [relay README](../relay/README.md) with `<relay-host>` in place of `${IROH_RELAY_HOST}` (the answer is `200`), then check that the `notAfter` date of the relay certificate is still ahead and that the Syncthing relay accepts TCP on port 22067:

```sh
openssl s_client -connect <relay-host>:443 -servername <relay-host> </dev/null 2>/dev/null | openssl x509 -noout -enddate
nc -vz <VPS> 22067
```

On computer B (Windows), PowerShell checks the port with `Test-NetConnection <VPS> -Port 22067`. A VPN or proxy client in TUN mode completes the TCP handshake on the checking computer itself, so a port check succeeds even when the server is unreachable; on such a computer only an HTTPS answer shows that the VPS is reachable. Behind such a client the first connection to the VPS after an idle period can time out or take 5 to 10 seconds, so repeat the request until it answers `200`. On Windows the built-in `curl.exe` sends that request (in Windows PowerShell, `curl` names `Invoke-WebRequest`) and prints the code `200` and the TLS handshake time, or `000 0.000000` when no server answers:

```powershell
curl.exe -s -o NUL -w "%{http_code} %{time_appconnect}\n" https://<relay-host>/
```

3. On computer A (macOS, zsh), from the repository root: `ketos-stand:local` is built from the same commit as computer B's `ketos-stand:amd64`, because builds of different peer protocol versions cannot connect ([peer README](../../packages/ketos/peer/README.md#known-limitations-and-deferred-work)); `docker/stand/.env` carries this computer's values ([Two computers](#two-computers), step 1), and the model key is set as [Preparation](#preparation) describes. Reset the stand, start service A, and read the board address:

```sh
docker compose -f docker/stand/compose.yaml down -v
docker compose -f docker/stand/compose.yaml up -d ketos-a
docker compose -f docker/stand/compose.yaml logs ketos-a | grep 'ketos web:'
```

4. On computer B (Windows 11, PowerShell), in the directory that contains `docker/`, run `docker compose -f docker/stand/compose.yaml down -v`, then steps 6 and 7 of [Windows 11 (computer B)](#windows-11-computer-b); the image and `docker/stand/.env` are the ones from steps 3 to 5 there.
5. On each computer, open the board address, open «Окно агента», and send a message: an answer in the chat confirms the model key of that computer.
6. Link the two Ketos instances as step 4 of [Two computers](#two-computers) describes: the invitation on computer A, «Подключить Кетос» on computer B. If the automatic Syncthing linking does not complete, use [Manual Syncthing linking](#manual-syncthing-linking).

## Addresses

| What | Ketos A | Ketos B |
|---|---|---|
| Board (Web) | `http://127.0.0.1:3080/?token=<token>` | `http://127.0.0.1:3081/?token=<token>` |
| Syncthing UI (loopback only) | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| Working directory | volume `ketos-a-workspace`, `/workspace` | volume `ketos-b-workspace`, `/workspace` |

Ketos prints its token at startup: `docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`. The port in the printed address matches the published port, so you can open that address from the host as is.

For access over a non-loopback address, set `KETOS_TRUSTED_HOSTS` (a comma-separated list) in `compose.yaml` for the relevant service: the `stand.patch.yml` overlay passes the values to the trusted-host check on `/api`. The `0.0.0.0` bind is set by the overlay: the CLI deliberately rejects `--host 0.0.0.0` on a developer machine, while in a container it is the only way to reach the published port.

## Checks

```sh
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
docker compose -f docker/stand/compose.yaml exec ketos-a syncthing --version
docker compose -f docker/stand/compose.yaml exec ketos-a cat /workspace/shared/.stignore
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml logs ketos-a | grep ketos-peer
docker run --rm --entrypoint sh ketos-stand:local -c 'test ! -e /app/docker/stand/.env && echo no secrets in the image'
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

The overlay loads the console log exporter at level info, so the `ketos-peer` lines (connections, replacements, `board.sync.too-large`) and the `bd` errors appear in `logs`. After `restart`, the boards and chats are still there: homes and working directories live in named volumes. The stand does not touch `~/.ketos` on the host.

## Syncthing

The two Ketos instances link their Syncthings themselves over the iroh channel: after the invitation the channel carries the Syncthing device IDs, and the Syncthing traffic runs through the team's private relay, so nobody adds a device or shares the folder `ketos-shared` (`/workspace/shared`) by hand. `stand.patch.yml` gives `@ketos/peer` the relay address without its token. The [peer README](../../packages/ketos/peer/README.md) owns the linking details; [Manual Syncthing linking](#manual-syncthing-linking) is the fallback.

The image installs the official Syncthing 2.1.5 release archive, pinned by sha256 per architecture (`SYNCTHING_VERSION`, `SYNCTHING_SHA256_ARM64`, `SYNCTHING_SHA256_AMD64` in the `Dockerfile`). The binary lands in `/usr/local/bin/syncthing` and the MPL-2.0 `LICENSE.txt` in `/usr/local/share/doc/syncthing`; the corresponding source is the [v2.1.5 tree](https://github.com/syncthing/syncthing/tree/v2.1.5).

On an empty Syncthing volume the entrypoint runs `syncthing generate`; on every start `syncthing-bootstrap.mjs` then edits `config.xml` before Syncthing runs, so a failed first start never leaves the stock config in use, and a failed bootstrap stops the container without starting Syncthing. The edits are: global and local announce off, NAT off, crash reporting off, no STUN keepalive, no auto-upgrade, a 10-second reconnection interval (`reconnectionIntervalS`, stock 20), a 1-minute relay redial interval (`relayReconnectIntervalM`, stock 10), `listenAddresses` = `$KETOS_SYNCTHING_RELAY` and `tcp://0.0.0.0:22000`, and the GUI API key from `$STGUIAPIKEY`. After its immediate redials are used up, Syncthing's relay dialer redials a device only once per `relayReconnectIntervalM`, and the private relay is the only path between the two computers, so the stock 10 minutes would stop file transfers for minutes after repeated network cuts. A template drift or a missing relay value fails loud instead of contacting a public node. The GUI listens on all interfaces inside the container without a password, so the host publishes it on `127.0.0.1` only; with both services on the default stand network one container can still reach the other's GUI, which the `relay-only.compose.yaml` overlay rules out. Check the pinned options with:

```sh
curl -s -H "X-API-Key: $STGUIAPIKEY" http://127.0.0.1:8384/rest/config/options
```

Syncthing writes the relay URL, including the shared `token=` credential, to its standard output each time the relay listener starts. The entrypoint starts Syncthing through `run-with-redacted-log.sh`, which rewrites `token=<value>` to `token=REDACTED` before a line reaches `/data/syncthing/syncthing.log`, and truncates a log left by an earlier start. The redaction fails closed: if its `sed` reader stops, Syncthing's next log write ends Syncthing instead of reaching the file unredacted, so a container whose Syncthing has disappeared needs a restart. The GUI keeps the unredacted token in its in-memory log (`/rest/system/log`) and in the `listenAddress` options, including the output of the command above, and it has no password: whoever reaches a GUI port reads the token, so keep the published ports on `127.0.0.1`.

## Manual Syncthing linking

If the automatic linking does not complete during the demonstration, link the two Syncthings by hand in their web interfaces: service A answers on `http://127.0.0.1:8384` and service B on `http://127.0.0.1:8385` (the published ports of `compose.yaml`; on two computers each computer opens its own service). The interfaces have no password.

1. In each interface open «Actions» → «Show ID» and copy the device ID.
2. On A press «Add Remote Device», paste the device ID of B, and on the «Advanced» tab replace the «Addresses» value `dynamic` with the relay address without the token: the value of `KETOS_SYNCTHING_RELAY` in `docker/stand/.env` up to, but not including, `&token=…` (for example `relay://203.0.113.7:22067/?id=<RELAY-ID>`). Global discovery is off, so `dynamic` finds nothing. Only the listening side presents the token, and the entrypoint already writes it into each Syncthing's own listen address. Save.
3. On B do the same with the device ID of A.
4. On A add the folder (or open it, if it exists): «Folder ID» `ketos-shared`, «Folder Path» `/workspace/shared`; on the «Sharing» tab tick B and save. On B accept the offered folder with the same path `/workspace/shared`.
5. After a few seconds both interfaces show the other device as «Connected», and the files in `/workspace/shared` synchronize.

On this path the board's «Общая папка» row keeps showing «Ожидает собеседника»: the board counts only devices that Ketos linked itself, named `ketos:<peer id>`. The files still synchronize, but the row is not a signal here; read the state in the Syncthing interface.

## Beads (`bd`)

The image installs Beads 1.3.1 from the official release archive, pinned by sha256 per architecture (`BD_VERSION`, `BD_SHA256_ARM64`, `BD_SHA256_AMD64` in the `Dockerfile`). The archive's `LICENSE` is kept at `/usr/local/share/doc/beads/LICENSE`. `BD_DISABLE_METRICS=1` and `DO_NOT_TRACK=1` are set image-wide, so `bd` never reports usage.

To update: copy the new version's values from the release `checksums.txt`, replace `BD_VERSION` and both `BD_SHA256_*` arguments, then rebuild and check:

```sh
docker compose -f docker/stand/compose.yaml build ketos-a
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
```

## Contents

- `Dockerfile` — a multi-stage build: node:24-bookworm builds the branch, and the runtime receives the checksum-pinned Syncthing and `bd`.
- `Dockerfile.dockerignore` — the build context without `.env`, `.git`, `references/`, `graphify-out*`, image archives (`*.tar.gz`), and the stand's own tests and fixtures; `node --test docker/stand/tools/dockerignore.test.mjs` checks that the tests, `.env` files, and image archives stay out of the context (and archives out of git) and the files the runtime stage copies stay in.
- `stand.patch.yml` — the profile overlay: the `0.0.0.0` bind, the port from `KETOS_PORT`, trusted hosts, the `opencode-go` route, the default model, and the enabled `ketos-peer` row with this computer's identity, the relay, the 5-second cap on the reconnection pause (`reconnectMaxMs`, package default 20 seconds), the 5-second dial timeout (`connectTimeoutMs`, package default 10 seconds), so the link is back within 30 seconds after the network returns even when a dial after a long outage times out (a pause of at most 5 s, a dial that may time out at 5 s, a pause of at most 5 s, then the dial; a dial started while the relay is still reconnecting wastes the whole timeout, and measured dials take 0.5 to 1 s), and the Syncthing section (the relay address loses its `token` parameter); the overlay also carries the `ketos-board-todo` row with a 60-second `bdTimeoutMs` (package default 15 seconds), because the first `bd init` on a fresh stand can exceed 15 seconds under the load of a demonstration; `node --test docker/stand/tools/stand-patch.test.mjs` checks both rows.
- `docker-entrypoint.sh` — seeds the shared folder's `.stignore`, then starts Syncthing (through `run-with-redacted-log.sh`) and `ketos web` in one container; `node --test docker/stand/tools/docker-entrypoint.test.mjs` checks the Syncthing start (through the wrapper, with the wrapper and `ensure-stignore.mjs` copied where the entrypoint calls them) and that the `.stignore` seed runs before Syncthing.
- `run-with-redacted-log.sh` — runs a command with its output appended to a log file after `token=<value>` becomes `token=REDACTED`; the command keeps the script's process ID; `node --test docker/stand/tools/run-with-redacted-log.test.mjs` checks the redaction, the line-by-line flush, and the process ID.
- `ensure-stignore.mjs` — creates `/workspace/shared/.stignore` when it is missing and never overwrites it; `node --test docker/stand/tools/ensure-stignore.test.mjs` checks creation, an existing file, and a rerun.
- `syncthing-bootstrap.mjs` — pins the Syncthing config to the private relay, the 10-second reconnection interval, and the 1-minute relay redial interval on every start; `node --test docker/stand/tools/syncthing-bootstrap.test.mjs` checks that a rerun changes nothing.
- `relay-only.compose.yaml` — a compose overlay that puts the two services on separate networks, so the iroh relay is the only network path between them (`docker compose -f docker/stand/compose.yaml -f docker/stand/relay-only.compose.yaml up -d`); a network outage is `docker network disconnect ketos-stand_net-b ketos-stand-ketos-b-1`, and the peer link shows `lost` after about 9 to 12 seconds: the channel heartbeat (a ping every 3 s) closes a channel that stays silent for `heartbeatTimeoutMs` (9 s), and the board polls the state every second.
- `tools/sync-latency.mjs` — the board synchronization latency probe: `send` on one Ketos creates, patches, and removes timestamped notes; `receive` on the other measures only the sender's changes and reports per kind the median, maximum, and lost count (`--timeout`, `--offset-ms` for a measured clock offset). `node --test docker/stand/tools/sync-latency.test.mjs` checks its accounting.
- `.env.example` — this computer's participant name, relay URLs, Syncthing GUI key, and model key (commented out, because an empty value here would replace the key of the root `.env`); `node --test docker/stand/tools/env-example.test.mjs` checks that no active assignment is empty.
- `compose.yaml` — the `ketos-a` and `ketos-b` services with their home, Syncthing home, and working directory volumes, and their ports.
- `tools/readme.test.mjs` — `node --test docker/stand/tools/readme.test.mjs` checks the statements of this README and its Chinese pair that an operator acts on: the archive path, the architecture tags, the lost-link timing, the PowerShell key recipe, the ports of service B, the board row after manual linking, the volume names, and the steps of a demonstration from scratch.
