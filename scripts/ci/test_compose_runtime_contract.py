from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def _load(relative_path: str) -> dict:
    with (ROOT / relative_path).open(encoding="utf-8") as compose_file:
        return yaml.safe_load(compose_file)


def _healthcheck_command(service: dict) -> str:
    healthcheck = service.get("healthcheck", {})
    test = healthcheck.get("test", "")
    if isinstance(test, list):
        return " ".join(str(part) for part in test)
    return str(test)


def _compose_service(base: dict, override: dict, service_name: str) -> dict:
    """Return the effective top-level service fields used by this contract test."""
    return {
        **base.get("services", {}).get(service_name, {}),
        **override.get("services", {}).get(service_name, {}),
    }


def test_deploy_services_have_meaningful_healthchecks_and_restart_policies() -> None:
    services = _load("deploy/docker-compose.yml")["services"]
    expected_probe = {
        "proxy": "traefik healthcheck",
        "backend": "http://localhost:7860/health_check",
        "db": "pg_isready",
        "pgadmin": "http://localhost:5050/misc/ping",
        "result_backend": "redis-cli ping",
        "celeryworker": "inspect ping",
        "flower": "http://localhost:5555",
        "frontend": "IO::Socket::INET",
        "broker": "rabbitmq-diagnostics",
        "prometheus": "http://localhost:9090/-/healthy",
        "grafana": "http://localhost:3000/api/health",
    }

    assert set(services) == set(expected_probe)
    for service_name, probe in expected_probe.items():
        service = services[service_name]
        command = _healthcheck_command(service)
        assert probe in command, f"{service_name} has no meaningful health probe: {command!r}"
        assert "exit 0" not in command
        assert service.get("restart") == "unless-stopped"

    assert services["flower"].get("deploy") == {}, "Flower must not inherit the public backend Traefik route"


def test_observability_services_have_health_restart_and_persistent_positions() -> None:
    compose = _load("deploy/observability/grafana-loki/docker-compose.yml")
    services = compose["services"]
    expected_probe = {
        "loki": "http://localhost:3100/ready",
        "promtail": "http://localhost:9080/ready",
        "grafana": "http://localhost:3000/api/health",
    }

    for service_name, probe in expected_probe.items():
        service = services[service_name]
        assert probe in _healthcheck_command(service)
        assert service.get("restart") == "unless-stopped"

    positions_mount = "promtail-positions:/var/lib/promtail"
    assert positions_mount in services["promtail"]["volumes"]
    assert "promtail-positions" in compose["volumes"]
    assert _load("deploy/observability/grafana-loki/promtail/config.yml")["positions"]["filename"] == (
        "/var/lib/promtail/positions.yaml"
    )


def test_local_image_compose_services_are_fail_closed_and_runtime_ready() -> None:
    compose_paths = (
        "docker_example/docker-compose.yml",
        "docker_example/pre.docker-compose.yml",
    )

    for compose_path in compose_paths:
        services = _load(compose_path)["services"]
        assert services["ketos"]["pull_policy"] == "never"
        assert "http://localhost:7860/health_check" in _healthcheck_command(services["ketos"])
        assert "pg_isready" in _healthcheck_command(services["postgres"])
        assert services["ketos"]["restart"] == "unless-stopped"
        assert services["postgres"]["restart"] == "unless-stopped"

    deploy_services = _load("deploy/docker-compose.yml")["services"]
    assert deploy_services["backend"]["pull_policy"] == "never"
    assert deploy_services["frontend"]["pull_policy"] == "never"


def test_deploy_override_keeps_proxy_ping_enabled_in_effective_command() -> None:
    base = _load("deploy/docker-compose.yml")
    override = _load("deploy/docker-compose.override.yml")
    effective_proxy = _compose_service(base, override, "proxy")

    assert "--ping=true" in effective_proxy["command"]


def test_deploy_test_environment_is_writable_by_the_non_root_backend() -> None:
    values = {}
    for raw_line in (ROOT / "deploy/compose.test.env").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#"):
            key, value = line.split("=", maxsplit=1)
            values[key] = value

    assert {key: values[key] for key in ("KETOS_CONFIG_DIR", "KETOS_DATA_DIR", "KETOS_CACHE_DIR", "KETOS_TEMP_DIR")} == {
        "KETOS_CONFIG_DIR": "/app/ketos/config",
        "KETOS_DATA_DIR": "/app/ketos/data",
        "KETOS_CACHE_DIR": "/app/ketos/cache",
        "KETOS_TEMP_DIR": "/app/ketos/tmp",
    }
    assert values["PGADMIN_DEFAULT_EMAIL"] == "admin@example.com"


def test_backend_image_installs_the_flower_command_used_by_deploy() -> None:
    dockerfile = (ROOT / "docker/build_and_push_backend.Dockerfile").read_text(encoding="utf-8")

    assert '"flower==2.0.1"' in dockerfile
    assert "COPY --from=builder --chown=1000:0 /app/.venv /app/.venv" in dockerfile
    assert 'ENV PATH="/app/.venv/bin:$PATH"' in dockerfile
    assert "chown -R 1000:0 /app/data /app/ketos" in dockerfile


def test_observability_docs_keep_normal_stop_non_destructive() -> None:
    readme = (ROOT / "deploy/observability/grafana-loki/README.md").read_text(encoding="utf-8")
    normal_stop = readme.split("To stop:", maxsplit=1)[1].split("## ", maxsplit=1)[0]

    assert "docker compose down" in normal_stop
    assert "docker compose down -v" not in normal_stop

    destructive_reset = readme.split("## Destructive reset", maxsplit=1)[1].split("## ", maxsplit=1)[0]
    assert "docker compose down -v" in destructive_reset
    assert "deletes" in destructive_reset.lower()
