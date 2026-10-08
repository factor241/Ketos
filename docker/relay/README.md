# Ketos relay services (VPS)

The private `iroh-relay` (the Ketos peer channel) and `strelaysrv` (Syncthing file synchronization) relays for the demonstration and cross-network operation.

English | [中文](README.zh.md)

## Ports

The server must expose these ports:

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (Let's Encrypt ACME)
sudo ufw allow 443/tcp    # HTTPS / QUIC (iroh-relay)
sudo ufw allow 7842/udp   # QUIC address discovery (iroh QAD)
sudo ufw allow 22067/tcp  # Syncthing relay (strelaysrv)
sudo ufw enable
```

> **Important:** port `22070` (the strelaysrv status page) must **not** be exposed; it listens on `127.0.0.1` only.

## Deployment

1. Copy the contents of `docker/relay/` to the VPS (for example into `/opt/ketos-relay`):
   ```bash
   mkdir -p /opt/ketos-relay
   cd /opt/ketos-relay
   ```

2. Create `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in the real values:
   - `IROH_RELAY_HOST`: the `sslip.io` hostname built from the IP (for example `203-0-113-7.sslip.io`).
   - `ACME_CONTACT`: the contact email for the Let's Encrypt certificate.
   - `STRELAY_TOKEN`: a random token from `openssl rand -hex 16`.

3. Render `iroh-relay.toml` and start the services:
   ```bash
   chmod +x render-config.sh
   ./render-config.sh
   docker compose up -d
   ```

## Reading the credentials for the stand

1. Check the iroh-relay certificate:
   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://${IROH_RELAY_HOST}/
   ```
   It must answer `200`.

2. Read the Syncthing relay id:
   ```bash
   docker compose logs strelaysrv | grep 'URI:'
   ```
   The log line looks like:
   `URI: relay://0.0.0.0:22067/?id=XXXXX-...`

3. The resulting stand `.env` lines:
   ```env
   KETOS_RELAY_URLS=https://<IROH_RELAY_HOST>
   KETOS_SYNCTHING_RELAY=relay://<SERVER-IP>:22067/?id=<ID>&token=<STRELAY_TOKEN>
   ```

## Fallback modes

1. If Let's Encrypt refuses `sslip.io`: switch to `<IP>.nip.io` in `.env`, rerun `render-config.sh`, and `docker compose up -d`.
2. The TLS-free fallback (`--dev`):
   ```bash
   docker compose -f compose.dev.yaml up -d
   ```
   In this mode the relay address is `http://<SERVER-IP>:3340`.
