# Ketos 中继服务（VPS）

用于演示与跨网络运行的私有 `iroh-relay`（Ketos 对等通道）与 `strelaysrv`（Syncthing 文件同步）中继。

[English](README.md) | 中文

## 端口

服务器必须开放以下端口：

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (Let's Encrypt ACME)
sudo ufw allow 443/tcp    # HTTPS / QUIC (iroh-relay)
sudo ufw allow 7842/udp   # QUIC address discovery (iroh QAD)
sudo ufw allow 22067/tcp  # Syncthing relay (strelaysrv)
sudo ufw enable
```

> **重要：** `22070` 端口（strelaysrv 状态页）**不得**对外暴露；它只监听 `127.0.0.1`。

## 部署

1. 把 `docker/relay/` 的内容复制到 VPS（例如 `/opt/ketos-relay`）：
   ```bash
   mkdir -p /opt/ketos-relay
   cd /opt/ketos-relay
   ```

2. 创建 `.env`：
   ```bash
   cp .env.example .env
   ```
   填入实际值：
   - `IROH_RELAY_HOST`：由 IP 构造的 `sslip.io` 主机名（例如 `203-0-113-7.sslip.io`）。
   - `ACME_CONTACT`：Let's Encrypt 证书的联系邮箱。
   - `STRELAY_TOKEN`：由 `openssl rand -hex 16` 生成的随机令牌。

3. 渲染 `iroh-relay.toml` 并启动服务：
   ```bash
   chmod +x render-config.sh
   ./render-config.sh
   docker compose up -d
   ```

## 获取演示环境所需的凭据

1. 检查 iroh-relay 证书：
   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://${IROH_RELAY_HOST}/
   ```
   必须返回 `200`。

2. 读取 Syncthing 中继 ID：
   ```bash
   docker compose logs strelaysrv | grep 'URI:'
   ```
   日志行形如：
   `URI: relay://0.0.0.0:22067/?id=XXXXX-...`

3. 演示环境 `.env` 中的最终两行：
   ```env
   KETOS_RELAY_URLS=https://<IROH_RELAY_HOST>
   KETOS_SYNCTHING_RELAY=relay://<SERVER-IP>:22067/?id=<ID>&token=<STRELAY_TOKEN>
   ```

## 访问与密钥

- `iroh-relay` 默认接受任何端点：知道主机名的人都可以使用该中继。把它限制为 Ketos 端点是 VPS 上的改动（`iroh-relay` 配置的 `access` 设置，见 iroh-relay 文档），由运维人员完成，而不是由 stand 完成。
- `strelaysrv` 的令牌以命令行参数传入，因此 VPS 上的 `docker inspect` 与 `ps` 会显示它，只有 VPS 管理员能读取。
- `iroh-relay.toml` 由 `render-config.sh` 根据 `.env` 渲染，已被 git 忽略；请修改模板，而不是渲染后的文件。

## 备用模式

1. 如果 Let's Encrypt 拒绝 `sslip.io`：在 `.env` 中改用 `<IP>.nip.io`，重新运行 `render-config.sh` 并执行 `docker compose up -d`。
2. 无 TLS 的备用模式（`--dev`）：
   ```bash
   docker compose -f compose.dev.yaml up -d
   ```
   此模式下中继地址为 `http://<SERVER-IP>:3340`。
