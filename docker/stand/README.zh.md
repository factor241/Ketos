# 双 Ketos stand（阶段 26.4）

[English](README.md) | 中文

Docker 中并排运行两个 Ketos：各自在独立卷上有自己的 `DSH_HOME` 主目录、自己的 Web 端口和自己的 Syncthing；共享工作目录 `/workspace` 挂载进两个容器。镜像由本分支的源码构建（`docker/stand/Dockerfile`），内含 `ketos web`、`bd`（Beads）与 `syncthing`。演示时两个实例运行在两台计算机上，每台从同一个预构建镜像启动一个服务（见[两台计算机](#two-computers)）。

## 准备

stand 读取两个可选的环境文件：根目录 `.env`（整个检出共享的值，例如模型密钥）与 `docker/stand/.env`（本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥）。两者都不进入 git，也绝不进入镜像。复制示例并填入本机的值：

```sh
cp docker/stand/.env.example docker/stand/.env
```

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
| Syncthing UI | `http://127.0.0.1:8384` | `http://127.0.0.1:8385` |
| 工作目录 | 卷 `ketos-stand-workspace`、`/workspace` | 同一卷 |

Ketos 在启动时打印 token：`docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"`。打印地址中的端口与已发布的端口一致，因此可以从宿主机原样打开该地址。

若要经非回环地址访问，请在 `compose.yaml` 中为相应服务设置 `KETOS_TRUSTED_HOSTS`（逗号分隔的列表）；`stand.patch.yml` 覆盖层会把这些值传给 `/api` 的受信主机检查。`0.0.0.0` 绑定由覆盖层设置：CLI 在开发机上会刻意拒绝 `--host 0.0.0.0`，而在容器中，这是触达已发布端口的唯一方式。

## 检查

```sh
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
docker compose -f docker/stand/compose.yaml exec ketos-a syncthing --version
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

`restart` 之后，看板与聊天仍在原处：主目录与工作目录保存在命名卷中。stand 不会触碰宿主机上的 `~/.ketos`。

## Syncthing

镜像从官方 Syncthing 2.1.5 发布归档安装，并按架构以 sha256 固定（`Dockerfile` 中的 `SYNCTHING_VERSION`、`SYNCTHING_SHA256_ARM64`、`SYNCTHING_SHA256_AMD64`）。二进制位于 `/usr/local/bin/syncthing`，MPL-2.0 的 `LICENSE.txt` 位于 `/usr/local/share/doc/syncthing`；对应源码是 [v2.1.5 树](https://github.com/syncthing/syncthing/tree/v2.1.5)。

在空的 Syncthing 卷首次启动时，entrypoint 运行 `syncthing generate`，随后由 `syncthing-bootstrap.mjs` 在 Syncthing 启动之前改写 `config.xml`：关闭全局与本地发现、关闭 NAT、关闭崩溃上报、无 STUN keepalive、关闭自动升级，`listenAddresses` = `$KETOS_SYNCTHING_RELAY` 与 `tcp://0.0.0.0:22000`，GUI API key 取自 `$STGUIAPIKEY`。模板漂移或缺少中继值会明确失败，而不会连接公共节点。检查已固定的选项：

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
- `syncthing-bootstrap.mjs`——在首次运行前把生成的 Syncthing 配置固定到私有中继。
- `.env.example`——本机的参与者名称、中继 URL、Syncthing GUI 密钥与模型密钥。
- `compose.yaml`——`ketos-a` 与 `ketos-b` 服务、卷与端口。
