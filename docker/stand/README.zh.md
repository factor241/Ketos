# 双 Ketos stand（阶段 26.4）

[English](README.md) | 中文

Docker 中并排运行两个 Ketos：每个实例都有自己的 `DSH_HOME` 主目录、自己的工作目录 `/workspace`、自己的 Syncthing 主目录和自己的 Web 端口，全部位于各自独立的卷上。文件只通过 Syncthing 文件夹 `/workspace/shared` 到达另一方（见[工作目录](#working-directories)）。镜像由本分支的源码构建（`docker/stand/Dockerfile`），内含 `ketos web`、`bd`（Beads）与 `syncthing`。演示时两个实例运行在两台计算机上，每台从同一个预构建镜像启动一个服务（见[两台计算机](#two-computers)；Windows 11 计算机见 [Windows 11（计算机 B）](#windows-11-computer-b)）。

## 准备

stand 读取两个可选的环境文件：根目录 `.env`（整个检出共享的值，例如模型密钥）与 `docker/stand/.env`（本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥）。两者都不进入 git，也绝不进入镜像：`Dockerfile.dockerignore` 排除任意深度的所有 `.env` 文件，若有 `.env` 被复制进构建上下文则构建失败。Docker Desktop 构建至少需要 8 GiB 内存。复制示例并填入本机的值：

```sh
cp docker/stand/.env.example docker/stand/.env
```

示例中 `docker/stand/.env` 的模型密钥行 `OPENCODE_GO_API_KEY=` 已被注释掉：请取消注释并填入密钥，或把密钥写进根目录 `.env`，因为没有它这台计算机上的智能体无法工作。切勿在 `docker/stand/.env` 中保留空的 `OPENCODE_GO_API_KEY=` 行：该文件在根目录 `.env` 之后读取，空值会替换那里设置的密钥。

当两个服务运行在同一台计算机上时，`ketos-b` 的参与者名称取自 `KETOS_B_PARTICIPANT_NAME`，未设置则回退到 `KETOS_PARTICIPANT_NAME`，因此两块看板显示不同的名称。

## 启动

从仓库根目录（worktree）执行：

```sh
docker compose -f docker/stand/compose.yaml up --build
```

首次启动会构建镜像（在镜像内安装 pnpm 依赖并运行 `pnpm run build`），耗时较长；之后的启动只需几秒。

<a id="working-directories"></a>

## 工作目录

每个服务在 `/workspace` 挂载自己的卷（`ketos-a-workspace` 与 `ketos-b-workspace`），因此无论是否使用 `relay-only.compose.yaml` 覆盖文件，两个 Ketos 之间除 Syncthing 外没有任何文件通路。每次启动时 entrypoint 都会创建 `/workspace/shared`，并在 `/workspace/shared/.stignore` 尚不存在时写入 `.DS_Store`、`*.tmp` 与 `~*`；已有的 `.stignore` 绝不会被覆盖。Syncthing 本身不同步 `.stignore`，因此双方各自保留一份。

在工作目录分离之前创建的 stand 仍保留旧的共享卷 `ketos-stand-workspace`。它已不再被使用，且 stand 数据是一次性的，因此手动删除一次即可：

```sh
docker volume rm ketos-stand_ketos-stand-workspace
```

同一台计算机的两个卷，`ketos-a-workspace` 与 `ketos-a-syncthing`（计算机 B：`ketos-b-workspace` 与 `ketos-b-syncthing`），必须一起保留或一起删除。Syncthing 在共享文件夹中保存标记 `.stfolder`，标记缺失时拒绝同步该文件夹（错误«folder marker missing»）；清空工作目录卷而保留 Syncthing 卷时留下的正是这种状态。每台计算机只删除自己的两个卷，两个都删或两个都不删，并且先删除自己的容器。计算机 A：

```sh
docker compose -f docker/stand/compose.yaml down
docker volume rm ketos-stand_ketos-a-workspace ketos-stand_ketos-a-syncthing
```

计算机 B：

```sh
docker compose -f docker/stand/compose.yaml down
docker volume rm ketos-stand_ketos-b-workspace ketos-stand_ketos-b-syncthing
```

<a id="two-computers"></a>

## 两台计算机

1. 在每台计算机上，从示例创建 `docker/stand/.env`，填入本机的 `KETOS_PARTICIPANT_NAME`（带引号，名称后用括号标明角色，最长 64 个字符，例如 `"Кирилл (Руководитель)"` 与 `"Юрий (Юрист)"`）、来自 `docker/relay/README.md` 的中继值，以及新的 `STGUIAPIKEY`（`openssl rand -hex 16`；Windows 没有 `openssl`，请在 PowerShell 中使用 `[guid]::NewGuid().ToString('N')`；两者都生成 32 个十六进制字符）。
2. 只构建一次镜像，第二台计算机改为传入镜像而不是重新构建。构建用计算机自己的镜像是 `ketos-stand:local`。把归档保存到仓库之外：仓库根目录是构建上下文，放在那里的归档会被复制进下一个镜像（`Dockerfile.dockerignore` 与 `.gitignore` 忽略 `*.tar.gz` 只是兜底）：

```sh
docker save ketos-stand:local | gzip > ~/ketos-stand-<arch>.tar.gz
gzip -dc ~/ketos-stand-<arch>.tar.gz | docker load
```

给另一种架构的计算机构建时，请在仓库根目录用架构标签构建，绝不要用 `ketos-stand:local`，否则会替换构建用计算机自己的镜像：`docker buildx build --platform linux/amd64 --load -f docker/stand/Dockerfile -t ketos-stand:amd64 .`（或 `linux/arm64`，标签 `-t ketos-stand:arm64`）。保存的是这个标签而不是 `ketos-stand:local`，并在另一台计算机上 `docker load` 之后把它打成 `ketos-stand:local`（`docker tag ketos-stand:amd64 ketos-stand:local`），逐步操作见 [Windows 11（计算机 B）](#windows-11-computer-b)。

3. 计算机 1 启动 `docker compose -f docker/stand/compose.yaml up -d ketos-a`；计算机 2 用 `ketos-b` 执行同一命令。
4. 在第一块看板上打开«Участники»并点击«Пригласить»；把代码粘贴到第二块看板的«Подключить Кетос»。此后两块看板都显示两名参与者，重启后通道会自行恢复。

<a id="windows-11-computer-b"></a>

## Windows 11（计算机 B）

计算机 B 可以是搭载 Intel 处理器（x86-64）、使用 WSL2 后端 Docker Desktop 的 Windows 11 电脑。下面的步骤用于准备它；在真实 Windows 计算机上的检查属于阶段 36.1。

1. 给 WSL2 至少 8 GiB 内存：创建 `%UserProfile%\.wslconfig`，内容如下，然后运行 `wsl --shutdown` 并重启 Docker Desktop。

```ini
[wsl2]
memory=8GB
```

2. 在构建用的计算机上，从仓库根目录执行命令（构建上下文是 `.`）。用标签 `ketos-stand:amd64` 构建 amd64 镜像，不要用 `ketos-stand:local`（那是构建用计算机自己的镜像），并把归档保存到仓库之外。然后把归档复制到计算机 B 的用户文件夹（`%UserProfile%`）：

```sh
docker buildx build --platform linux/amd64 --load -f docker/stand/Dockerfile -t ketos-stand:amd64 .
docker save ketos-stand:amd64 | gzip > ~/ketos-stand-amd64.tar.gz
```

3. 在计算机 B 上，从复制来的归档加载镜像，并打上 `compose.yaml` 所期望的名称 `ketos-stand:local`。`docker load` 直接读取 gzip 文件，因此无需先解压归档：

```powershell
docker load -i $HOME\ketos-stand-amd64.tar.gz
docker tag ketos-stand:amd64 ketos-stand:local
```

4. 计算机 B 只需要两个文件，目录布局与仓库一致：`docker/stand/compose.yaml` 与 `docker/stand/.env`（由 `docker/stand/.env.example` 创建，请把该文件也复制到计算机 B）。在该 `.env` 中取消注释 `OPENCODE_GO_API_KEY=` 并填入模型密钥（或把密钥写进根目录 `.env`）：没有它，计算机 B 上的智能体无法工作。可选的根目录 `.env`（相对 `compose.yaml` 为 `../../.env`）与源码检出都不需要，`relay-only.compose.yaml` 用于单机测试，不用于两台真实计算机。
5. 把 `docker/stand/.env`（以及你创建的根目录 `.env`）保存为不带字节顺序标记的 UTF-8，并使用 LF 换行；在 VS Code 中两者都可在状态栏选择。字节顺序标记或 CRLF 换行可能破坏第一个变量名或各个值。参与者名称要加引号：名称后用括号标明角色，因此含有空格，长度上限为 64 个字符：

```sh
KETOS_PARTICIPANT_NAME="Юрий (Юрист)"
```

6. 在包含 `docker/` 的目录下，只启动服务 B，且不构建：

```powershell
docker compose -f docker/stand/compose.yaml up -d --no-build ketos-b
```

7. 读取带 token 的看板地址：

```powershell
docker compose -f docker/stand/compose.yaml logs ketos-b | Select-String "ketos web:"
```

服务 `ketos-b` 在 3081 端口发布 Web 看板，在 `127.0.0.1:8385` 发布 Syncthing GUI（仅限环回）。

## 地址

| 项目 | Ketos A | Ketos B |
|---|---|---|
| 看板（Web） | `http://127.0.0.1:3080/?token=<token>` | `http://127.0.0.1:3081/?token=<token>` |
| Syncthing UI（仅环回） | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| 工作目录 | 卷 `ketos-a-workspace`、`/workspace` | 卷 `ketos-b-workspace`、`/workspace` |

Ketos 在启动时打印 token：`docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`。打印地址中的端口与已发布的端口一致，因此可以从宿主机原样打开该地址。

若要经非回环地址访问，请在 `compose.yaml` 中为相应服务设置 `KETOS_TRUSTED_HOSTS`（逗号分隔的列表）；`stand.patch.yml` 覆盖层会把这些值传给 `/api` 的受信主机检查。`0.0.0.0` 绑定由覆盖层设置：CLI 在开发机上会刻意拒绝 `--host 0.0.0.0`，而在容器中，这是触达已发布端口的唯一方式。

## 检查

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

覆盖配置加载了 info 级别的控制台日志导出器，因此 `ketos-peer` 的日志行（连接、替换、`board.sync.too-large`）与 `bd` 错误都会出现在 `logs` 中。`restart` 之后，看板与聊天仍在原处：主目录与工作目录保存在命名卷中。stand 不会触碰宿主机上的 `~/.ketos`。

## Syncthing

两个 Ketos 通过 iroh 通道自行连接各自的 Syncthing：邀请完成后，通道传递 Syncthing 设备 ID，Syncthing 流量经团队的私有中继传输，因此无需任何人手动添加设备或共享文件夹 `ketos-shared`（`/workspace/shared`）。`stand.patch.yml` 向 `@ketos/peer` 提供去掉 token 的中继地址。连接细节由 [peer README](../../packages/ketos/peer/README.zh.md) 负责说明；[手动连接 Syncthing](#manual-syncthing-linking)是后备方案。

镜像从官方 Syncthing 2.1.5 发布归档安装，并按架构以 sha256 固定（`Dockerfile` 中的 `SYNCTHING_VERSION`、`SYNCTHING_SHA256_ARM64`、`SYNCTHING_SHA256_AMD64`）。二进制位于 `/usr/local/bin/syncthing`，MPL-2.0 的 `LICENSE.txt` 位于 `/usr/local/share/doc/syncthing`；对应源码是 [v2.1.5 树](https://github.com/syncthing/syncthing/tree/v2.1.5)。

在空的 Syncthing 卷上，entrypoint 运行 `syncthing generate`；每次启动时 `syncthing-bootstrap.mjs` 都会在 Syncthing 运行之前改写 `config.xml`，因此首次启动失败后不会再使用默认配置；引导失败时容器直接停止，不启动 Syncthing。改写内容：关闭全局与本地发现、关闭 NAT、关闭崩溃上报、无 STUN keepalive、关闭自动升级、重连间隔 10 秒（`reconnectionIntervalS`，默认 20）、中继重拨间隔 1 分钟（`relayReconnectIntervalM`，默认 10），`listenAddresses` = `$KETOS_SYNCTHING_RELAY` 与 `tcp://0.0.0.0:22000`，GUI API key 取自 `$STGUIAPIKEY`。立即重拨用尽之后，Syncthing 的中继拨号器每隔 `relayReconnectIntervalM` 才会重拨一次设备，而私有中继是两台计算机之间唯一的通路，因此默认的 10 分钟会使文件传输在反复断网后停滞数分钟。模板漂移或缺少中继值会明确失败，而不会连接公共节点。GUI 在容器内监听所有接口且没有密码，因此宿主机只在 `127.0.0.1` 上发布它；两个服务处于默认 stand 网络时，一个容器仍能访问另一个容器的 GUI，`relay-only.compose.yaml` 覆盖文件排除了这种情况。检查已固定的选项：

```sh
curl -s -H "X-API-Key: $STGUIAPIKEY" http://127.0.0.1:8384/rest/config/options
```

每次中继监听器启动时，Syncthing 都会把中继 URL（含共享的 `token=` 凭据）写入标准输出。entrypoint 通过 `run-with-redacted-log.sh` 启动 Syncthing，该脚本在日志行写入 `/data/syncthing/syncthing.log` 之前把 `token=<值>` 改写为 `token=REDACTED`，并清空上次启动遗留的日志。打码采用失败即关闭的策略：其 `sed` 读取端一旦停止，Syncthing 的下一次日志写入会使 Syncthing 退出，而不会让未打码的内容写入文件，因此 Syncthing 消失的容器需要重启。GUI 的内存日志（`/rest/system/log`）与 `listenAddress` 选项（包括上述命令的输出）仍含未打码的 token，且 GUI 没有密码：能访问 GUI 端口的人就能读到 token，因此请让发布的端口只绑定 `127.0.0.1`。

<a id="manual-syncthing-linking"></a>

## 手动连接 Syncthing

如果演示时自动连接未完成，可在两个 Syncthing 的网页界面中手动连接：服务 A 在 `http://127.0.0.1:8384`，服务 B 在 `http://127.0.0.1:8385`（即 `compose.yaml` 发布的端口；两台计算机各自打开自己的服务）。界面没有密码。

1. 在每个界面中打开«Actions»→«Show ID»，复制设备 ID。
2. 在 A 上点击«Add Remote Device»，粘贴 B 的设备 ID，并在«Advanced»选项卡中把«Addresses»的值 `dynamic` 替换为不带 token 的中继地址：即 `docker/stand/.env` 中 `KETOS_SYNCTHING_RELAY` 的值，截至 `&token=…` 之前（例如 `relay://203.0.113.7:22067/?id=<RELAY-ID>`）。全局发现已关闭，因此 `dynamic` 什么也找不到。只有监听方出示 token，而 entrypoint 已把它写进每个 Syncthing 自己的监听地址。保存。
3. 在 B 上用 A 的设备 ID 做同样的操作。
4. 在 A 上添加文件夹（若已存在则打开它）：«Folder ID» 为 `ketos-shared`，«Folder Path» 为 `/workspace/shared`；在«Sharing»选项卡中勾选 B 并保存。在 B 上以相同路径 `/workspace/shared` 接受收到的文件夹。
5. 几秒后两个界面都会把对方设备显示为«Connected»，`/workspace/shared` 中的文件开始同步。

在这条路径上，看板的«Общая папка»一行会一直显示«Ожидает собеседника»：看板只统计 Ketos 自己连接的、名为 `ketos:<peer id>` 的设备。文件仍会同步，但这一行在此不是信号；请在 Syncthing 界面中查看状态。

## Beads（`bd`）

镜像从官方发布归档安装 Beads 1.3.1，并按架构以 sha256 固定（`Dockerfile` 中的 `BD_VERSION`、`BD_SHA256_ARM64`、`BD_SHA256_AMD64`）。归档中的 `LICENSE` 保留在 `/usr/local/share/doc/beads/LICENSE`。镜像范围内设置了 `BD_DISABLE_METRICS=1` 与 `DO_NOT_TRACK=1`，因此 `bd` 从不上报使用情况。

更新方法：从发布版的 `checksums.txt` 复制新值，替换 `BD_VERSION` 与两个 `BD_SHA256_*` 参数，然后重建并检查：

```sh
docker compose -f docker/stand/compose.yaml build ketos-a
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
```

## 组成

- `Dockerfile`——多阶段构建：node:24-bookworm 构建本分支，运行时获得按校验和固定的 Syncthing 与 `bd`。
- `Dockerfile.dockerignore`——不含 `.env`、`.git`、`references/`、`graphify-out*`、镜像归档（`*.tar.gz`）以及 stand 自身测试与夹具的构建上下文；`node --test docker/stand/tools/dockerignore.test.mjs` 检查测试、`.env` 文件与镜像归档不进入构建上下文（归档也不进入 git），运行时阶段复制的文件保留在构建上下文中。
- `stand.patch.yml`——profile 覆盖层：`0.0.0.0` 绑定、来自 `KETOS_PORT` 的端口、受信主机、`opencode-go` 路由、默认模型，以及启用并带上本机身份、中继、重连暂停上限 5 秒（`reconnectMaxMs`，包默认值为 20 秒）、拨号超时 5 秒（`connectTimeoutMs`，包默认值为 10 秒），使网络恢复后即使长时间中断后的一次拨号超时，连接也能在 30 秒内恢复（最长 5 秒的暂停、可能在 5 秒时超时的一次拨号、又一次最长 5 秒的暂停，再拨号；在中继仍在重连时发起的拨号会白等整个超时，实测拨号耗时 0.5 至 1 秒）与 Syncthing 配置段的 `ketos-peer` 行（中继地址会去掉 `token` 参数）；`node --test docker/stand/tools/stand-patch.test.mjs` 检查该行。
- `docker-entrypoint.sh`——先写入共享文件夹的 `.stignore`，再在同一个容器中启动 Syncthing（经由 `run-with-redacted-log.sh`）与 `ketos web`；`node --test docker/stand/tools/docker-entrypoint.test.mjs` 检查 Syncthing 的启动方式（经由包装脚本，包装脚本与 `ensure-stignore.mjs` 被复制到 entrypoint 调用它们的路径），以及 `.stignore` 的写入先于 Syncthing 启动。
- `run-with-redacted-log.sh`——运行一个命令，把 `token=<值>` 改写为 `token=REDACTED` 后将其输出追加到日志文件；命令沿用该脚本的进程 ID；`node --test docker/stand/tools/run-with-redacted-log.test.mjs` 检查打码、逐行刷新与进程 ID。
- `ensure-stignore.mjs`——在 `/workspace/shared/.stignore` 缺失时创建它，且绝不覆盖；`node --test docker/stand/tools/ensure-stignore.test.mjs` 检查创建、已有文件与重复运行。
- `syncthing-bootstrap.mjs`——每次启动时把 Syncthing 配置固定到私有中继、10 秒重连间隔与中继重拨间隔 1 分钟；`node --test docker/stand/tools/syncthing-bootstrap.test.mjs` 检查重复运行不改变配置。
- `relay-only.compose.yaml`——把两个服务放到不同网络的 compose 覆盖文件，使 iroh 中继成为两者之间唯一的网络通路（`docker compose -f docker/stand/compose.yaml -f docker/stand/relay-only.compose.yaml up -d`）；网络中断即 `docker network disconnect ketos-stand_net-b ketos-stand-ketos-b-1`，约 9 至 12 秒后对等连接显示 `lost`：通道心跳（每 3 秒一次 ping）会关闭静默达到 `heartbeatTimeoutMs`（9 秒）的通道，看板每秒轮询一次状态。
- `tools/sync-latency.mjs`——看板同步延迟探针：一方 Ketos 上的 `send` 创建、修改并删除带时间戳的便签；另一方的 `receive` 只统计发送方的改动，并按类型报告中位数、最大值与丢失数（`--timeout`；`--offset-ms` 用于已测得的时钟偏差）。`node --test docker/stand/tools/sync-latency.test.mjs` 检查其计数逻辑。
- `.env.example`——本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥（已注释掉，因为这里的空值会替换根目录 `.env` 中的密钥）；`node --test docker/stand/tools/env-example.test.mjs` 检查没有为空的有效赋值。
- `compose.yaml`——`ketos-a` 与 `ketos-b` 服务，及其主目录卷、Syncthing 主目录卷、工作目录卷与端口。
- `tools/readme.test.mjs`——`node --test docker/stand/tools/readme.test.mjs` 检查本 README 及其英文版中操作者依赖的表述：归档路径、架构标签、连接丢失的计时、PowerShell 密钥命令、服务 B 的端口、手动连接之后的看板行以及卷名。
