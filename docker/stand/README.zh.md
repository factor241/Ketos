# 双 Ketos stand（阶段 26.4）

[English](README.md) | 中文

Docker 中并排运行两个 Ketos：各自在独立卷上有自己的 `DSH_HOME` 主目录、自己的 Web 端口和自己的 Syncthing；共享工作目录 `/workspace` 挂载进两个容器。镜像由本分支的源码构建（`docker/stand/Dockerfile`），内含 `ketos web`、`bd`（Beads）与 `syncthing`。

## 准备

模型密钥位于根目录的 `.env`（该文件在 `.gitignore` 中，不会进入镜像）：

```sh
printf 'OPENCODE_GO_API_KEY=%s\n' '<your key>' > .env
```

## 启动

从仓库根目录（worktree）执行：

```sh
docker compose -f docker/stand/compose.yaml up --build
```

首次启动会构建镜像（在镜像内安装 pnpm 依赖并运行 `pnpm run build`），耗时较长；之后的启动只需几秒。

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
docker compose -f docker/stand/compose.yaml restart
docker compose -f docker/stand/compose.yaml logs ketos-a | grep "ketos web:"
docker compose -f docker/stand/compose.yaml down            # stop
docker compose -f docker/stand/compose.yaml down -v         # reset volumes (stand data)
```

`restart` 之后，看板与聊天仍在原处：主目录与工作目录保存在命名卷中。stand 不会触碰宿主机上的 `~/.ketos`。

## Beads（`bd`）

镜像从官方发布归档安装 Beads 1.3.1，并按架构以 sha256 固定（`Dockerfile` 中的 `BD_VERSION`、`BD_SHA256_ARM64`、`BD_SHA256_AMD64`）。归档中的 `LICENSE` 保留在 `/usr/local/share/doc/beads/LICENSE`。镜像范围内设置了 `BD_DISABLE_METRICS=1` 与 `DO_NOT_TRACK=1`，因此 `bd` 从不上报使用情况。

更新方法：从发布版的 `checksums.txt` 复制新值，替换 `BD_VERSION` 与两个 `BD_SHA256_*` 参数，然后重建并检查：

```sh
docker compose -f docker/stand/compose.yaml build ketos-a
docker compose -f docker/stand/compose.yaml exec ketos-a bd version
```

## 组成

- `Dockerfile`——多阶段构建：node:24-bookworm 构建本分支，运行时获得 Syncthing 与按校验和固定的 `bd`。
- `Dockerfile.dockerignore`——不含 `.env`、`.git`、`references/`、`graphify-out*` 的构建上下文。
- `stand.patch.yml`——profile 覆盖层：`0.0.0.0` 绑定、来自 `KETOS_PORT` 的端口、受信主机、`opencode-go` 路由与默认模型。
- `docker-entrypoint.sh`——在同一个容器中启动 Syncthing 与 `ketos web`。
- `compose.yaml`——`ketos-a` 与 `ketos-b` 服务、卷与端口。
