# Ketos on Grafana + Loki

Reference stack that ingests Ketos's structured JSON logs into [Loki](https://grafana.com/oss/loki/) and visualizes them with a pre-provisioned Grafana dashboard.

Use this as a starting point. The compose file, Promtail config, and dashboard JSON are independent of the rest of `deploy/` and can be lifted into any environment.

## What you get

- **Loki 3.2** on `:3100`
- **Promtail 3.2** scraping a directory of Ketos log files
- **Grafana 11.3** on `:3000` with the Loki datasource and the `Ketos Logs` dashboard already provisioned

## Prerequisites on the Ketos side

The dashboard expects Ketos to be running in JSON mode with service metadata set. At minimum:

```bash
KETOS_LOG_ENV=container
KETOS_LOG_FILE=/absolute/path/to/ketos/logs/ketos.log
KETOS_SERVICE_NAME=ketos
KETOS_VERSION=1.10.0
KETOS_ENVIRONMENT=production
```

Promtail scrapes a directory of `*.log` files, so `KETOS_LOG_FILE` must point at a file inside
the directory you expose to Promtail as `KETOS_LOG_DIR` (see [Run](#run)). Set both to the same
directory, otherwise Promtail watches an empty folder and the dashboard stays blank. Use an
absolute path: `KETOS_LOG_FILE` is resolved against Ketos's working directory, not this one.

In JSON mode the file is a single JSON stream: application logs and third-party stdlib loggers
(`uvicorn`, `sqlalchemy`, `httpx`, `langchain`) are all rendered as JSON and run through PII
redaction, so the `json` parse stage and the **Stdlib intercept routing** panel work against it
directly. This stack scrapes a file, so `KETOS_LOG_FILE` is required. If you instead run
Ketos as a container, you can drop the file and scrape its stdout by swapping Promtail's
`static_configs` file target for `docker_sd_configs` (same JSON, same labels).

The [Ketos logging prerequisites](#prerequisites-on-the-ketos-side) above list the variables this
stack consumes directly. Configure any additional per-logger, redaction, or trace-correlation
settings in the Ketos runtime that writes the JSON log file.

## Run

From this directory:

```bash
# Point Promtail at the directory that holds the file you set in
# KETOS_LOG_FILE above. Must be the same directory. Defaults to the
# bundled ./logs (used by the quick smoke test below).
export KETOS_LOG_DIR=/absolute/path/to/ketos/logs

docker compose up -d
```

Then open [http://localhost:3000/d/ketos-prod-logs](http://localhost:3000/d/ketos-prod-logs). Default credentials are `admin` / `admin` (override with `GF_ADMIN_USER` and `GF_ADMIN_PASSWORD`).

To stop:

```bash
docker compose down
```

### Quick smoke test (no Ketos required)

To verify the stack end to end without running Ketos, write a sample record into the bundled
`./logs` directory and query Loki directly:

```bash
mkdir -p logs
echo '{"event":"smoke test","level":"info","logger":"ketos.api.run","timestamp":"2026-06-01T00:00:00Z","service":"ketos","environment":"production","version":"1.10.0"}' >> logs/ketos.log

docker compose up -d

# Give Promtail a few seconds to tail the file, then confirm the line reached Loki:
sleep 5
curl -sG 'http://localhost:3100/loki/api/v1/query_range' --data-urlencode 'query={job="ketos"}' | grep -q "smoke test" && echo "OK: log reached Loki"
```

## Destructive reset

To also delete the persisted Grafana data and Promtail positions, explicitly remove the named
volumes. This deletes the stack's stored dashboards, settings, and log-tail positions:

```bash
docker compose down -v
```

## What each dashboard panel proves

| Panel | LogQL it runs |
|---|---|
| **PII leak count (must be 0)** | `sum(count_over_time({job="ketos"} \|~ "sk-do-not-leak\|hunter2\|Bearer xyz" [$__range]))` |
| **Errors with structured tracebacks** | `{job="ketos", level=~"error\|critical"} \|= "exception" \| json` |
| **Redaction proof** | `{job="ketos"} \|~ "\\*\\*\\*"` |
| **Stdlib intercept routing** | `{job="ketos", logger=~"uvicorn.*\|sqlalchemy.*\|httpx.*\|langchain.*"}` |
| **Service / environment / version coverage** | `sum by (service, environment, version) (count_over_time({job="ketos"}[$__range]))` |
| **Log rate by level** | `sum by (level) (rate({job="ketos"}[1m]))` |
| **Log rate by logger** | `topk(10, sum by (logger) (rate({job="ketos"}[1m])))` |

## Notes

- Promtail only promotes `level`, `service`, `environment`, `version`, `logger` to labels. High-cardinality fields (`user_id`, `flow_id`, `trace_id`) stay in the log body — query them with `| json` in LogQL.
- Replace Promtail with [Grafana Alloy](https://grafana.com/oss/alloy/) if you already standardize on it; the JSON parse stage maps 1:1.
- If your runtime ships logs through a different transport (Fluent Bit, Vector, OTLP), only the scrape side changes — the dashboard and label schema stay the same.
