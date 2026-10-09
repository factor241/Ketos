# 双 Ketos stand（阶段 26.4）

[English](README.md) | 中文

Docker 中并排运行两个 Ketos：各自在独立卷上有自己的 `DSH_HOME` 主目录、自己的 Web 端口和自己的 Syncthing；共享工作目录 `/workspace` 挂载进两个容器。镜像由本分支的源码构建（`docker/stand/Dockerfile`），内含 `ketos web`、`bd`（Beads）与 `syncthing`。演示时两个实例运行在两台计算机上，每台从同一个预构建镜像启动一个服务（见[两台计算机](#two-computers)）。

## 准备

stand 读取两个可选的环境文件：根目录 `.env`（整个检出共享的值，例如模型密钥）与 `docker/stand/.env`（本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥）。两者都不进入 git，也绝不进入镜像：`Dockerfile.dockerignore` 排除任意深度的所有 `.env` 文件，若有 `.env` 被复制进构建上下文则构建失败。Docker Desktop 构建至少需要 8 GiB 内存。复制示例并填入本机的值：

```sh
cp docker/stand/.env.example docker/stand/.env
```

当两个服务运行在同一台计算机上时，`ketos-b` 的参与者名称取自 `KETOS_B_PARTICIPANT_NAME`，未设置则回退到 `KETOS_PARTICIPANT_NAME`，因此两块看板显示不同的名称。

## 启动

从仓库根目录（worktree）执行：

```sh
docker compose -f docker/stand/compose.yaml up --build
```

首次启动会构建镜像（在镜像内安装 pnpm 依赖并运行 `pnpm run build`），耗时较长；之后的启动只需几秒。

## 两台计算机

1. 在每台计算机上，从示例创建 `docker/stand/.env`，填入本机的 `KETOS_PARTICIPANT_NAME`（例如 «Кирилл» 与 «Юрист»）、来自 `docker/relay/README.md` 的中继值，以及新的 `STGUIAPIKEY`（`openssl rand -hex 16`）。
2. 只构建一次镜像，第二台计算机改为传入镜像而不是重新构建：

```sh
docker save ketos-stand:local | gzip > ketos-stand-<arch>.tar.gz
gzip -dc ketos-stand-<arch>.tar.gz | docker load
```

另一种架构用 `docker buildx build --platform linux/amd64 -f docker/stand/Dockerfile -t ketos-stand:local .` 构建（或 `linux/arm64`）。

3. 计算机 1 启动 `docker compose -f docker/stand/compose.yaml up -d ketos-a`；计算机 2 用 `ketos-b` 执行同一命令。
4. 在第一块看板上打开«Участники»并点击«Пригласить»；把代码粘贴到第二块看板的«Подключить Кетос»。此后两块看板都显示两名参与者，重启后通道会自行恢复。

## 地址

| 项目 | Ketos A | Ketos B |
|---|---|---|
| 看板（Web） | `http://127.0.0.1:3080/?token=<token>` | `http://127.0.0.1:3081/?token=<token>` |
| Syncthing UI（仅环回） | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| 工作目录 | 卷 `ketos-stand-workspace`、`/workspace` | 同一卷 |

Ketos 在启动时打印 token：`docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`。打印地址中的端口与已发布的端口一致，因此可以从宿主机原样打开该地址。

若要经非回环地址访问，请在 `compose.yaml` 中为相应服务设置 `KETOS_TRUSTED_HOSTS`（逗号分隔的列表）；`stand.patch.yml` 覆盖层会把这些值传给 `/api` 的受信主机检查。`0.0.0.0` 绑定由覆盖层设置：CLI 在开发机上会刻意拒绝 `--host 0.0.0.0`，而在容器中，这是触达已发布端口的唯一方式。

## 检查

```sh
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
docker compose -f docker/stand/compose.yaml exec ketos-a syncthing --version
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml logs ketos-a | grep ketos-peer
docker run --rm --entrypoint sh ketos-stand:local -c 'test ! -e /app/docker/stand/.env && echo no secrets in the image'
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

覆盖配置加载了 info 级别的控制台日志导出器，因此 `ketos-peer` 的日志行（连接、替换、`board.sync.too-large`）与 `bd` 错误都会出现在 `logs` 中。`restart` 之后，看板与聊天仍在原处：主目录与工作目录保存在命名卷中。stand 不会触碰宿主机上的 `~/.ketos`。

## Syncthing

镜像从官方 Syncthing 2.1.5 发布归档安装，并按架构以 sha256 固定（`Dockerfile` 中的 `SYNCTHING_VERSION`、`SYNCTHING_SHA256_ARM64`、`SYNCTHING_SHA256_AMD64`）。二进制位于 `/usr/local/bin/syncthing`，MPL-2.0 的 `LICENSE.txt` 位于 `/usr/local/share/doc/syncthing`；对应源码是 [v2.1.5 树](https://github.com/syncthing/syncthing/tree/v2.1.5)。

在空的 Syncthing 卷上，entrypoint 运行 `syncthing generate`；每次启动时 `syncthing-bootstrap.mjs` 都会在 Syncthing 运行之前改写 `config.xml`，因此首次启动失败后不会再使用默认配置；引导失败时容器直接停止，不启动 Syncthing。改写内容：关闭全局与本地发现、关闭 NAT、关闭崩溃上报、无 STUN keepalive、关闭自动升级，`listenAddresses` = `$KETOS_SYNCTHING_RELAY` 与 `tcp://0.0.0.0:22000`，GUI API key 取自 `$STGUIAPIKEY`。模板漂移或缺少中继值会明确失败，而不会连接公共节点。GUI 在容器内监听所有接口且没有密码，因此宿主机只在 `127.0.0.1` 上发布它；两个服务处于默认 stand 网络时，一个容器仍能访问另一个容器的 GUI，`relay-only.compose.yaml` 覆盖文件排除了这种情况。检查已固定的选项：

```sh
curl -s -H "X-API-Key: $STGUIAPIKEY" http://127.0.0.1:8384/rest/config/options
```

## Beads（`bd`）

镜像从官方发布归档安装 Beads 1.3.1，并按架构以 sha256 固定（`Dockerfile` 中的 `BD_VERSION`、`BD_SHA256_ARM64`、`BD_SHA256_AMD64`）。归档中的 `LICENSE` 保留在 `/usr/local/share/doc/beads/LICENSE`。镜像范围内设置了 `BD_DISABLE_METRICS=1` 与 `DO_NOT_TRACK=1`，因此 `bd` 从不上报使用情况。

更新方法：从发布版的 `checksums.txt` 复制新值，替换 `BD_VERSION` 与两个 `BD_SHA256_*` 参数，然后重建并检查：

```sh
docker compose -f docker/stand/compose.yaml build ketos-a
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
```

## 组成

- `Dockerfile`——多阶段构建：node:24-bookworm 构建本分支，运行时获得按校验和固定的 Syncthing 与 `bd`。
- `Dockerfile.dockerignore`——不含 `.env`、`.git`、`references/`、`graphify-out*` 的构建上下文。
- `stand.patch.yml`——profile 覆盖层：`0.0.0.0` 绑定、来自 `KETOS_PORT` 的端口、受信主机、`opencode-go` 路由、默认模型，以及启用并带上本机身份与中继的 `ketos-peer` 行。
- `docker-entrypoint.sh`——在同一个容器中启动 Syncthing 与 `ketos web`。
- `syncthing-bootstrap.mjs`——每次启动时把 Syncthing 配置固定到私有中继；`node --test docker/stand/tools/syncthing-bootstrap.test.mjs` 检查重复运行不改变配置。
- `relay-only.compose.yaml`——把两个服务放到不同网络并给 `ketos-b` 独立工作目录卷的 compose 覆盖文件，使 iroh 中继成为两者之间唯一的通路（`docker compose -f docker/stand/compose.yaml -f docker/stand/relay-only.compose.yaml up -d`）；网络中断即 `docker network disconnect ketos-stand_net-b ketos-stand-ketos-b-1`，QUIC 空闲约 30 秒后对等连接显示 `lost`。
- `tools/sync-latency.mjs`——看板同步延迟探针：一方 Ketos 上的 `send` 创建、修改并删除带时间戳的便签；另一方的 `receive` 只统计发送方的改动，并按类型报告中位数、最大值与丢失数（`--timeout`；`--offset-ms` 用于已测得的时钟偏差）。`node --test docker/stand/tools/sync-latency.test.mjs` 检查其计数逻辑。
- `.env.example`——本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥。
- `compose.yaml`——`ketos-a` 与 `ketos-b` 服务、卷与端口。
