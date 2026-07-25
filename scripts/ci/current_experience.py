# ruff: noqa: EM101, EM102, TRY003
"""Preflight, run, and prove the canonical Ketos current-experience profile."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - exercised only on Python 3.10
    import tomli as tomllib

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.ci import version_contract  # noqa: I001


REQUIRED_MANAGED_ENVIRONMENT = {
    "KFX_DEV": "1",
    "KETOS_FEATURE_MVP_WORKSPACE": "true",
    "KETOS_FEATURE_MVP_CHAT": "true",
    "KETOS_AGENTIC_EXPERIENCE": "true",
    "LANGGRAPH_STRICT_MSGPACK": "true",
}
SERVICE_ORDER = ("backend", "frontend", "copilot")
MAX_PORT = 65_535
HTTP_SUCCESS_MIN = 200
HTTP_SUCCESS_MAX = 300
LOCAL_HTTP_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


class ProfileError(RuntimeError):
    """The profile is incomplete, malformed, or unsafe."""


@dataclass(frozen=True)
class Diagnostic:
    check: str
    code: str
    expected: Any
    actual: Any
    detail: str
    passed: bool = False

    def render(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        return (
            f"{status} check={self.check} code={self.code} "
            f"actual={_display(self.actual)} expected={_display(self.expected)} "
            f"detail={self.detail}"
        )


@dataclass(frozen=True)
class Report:
    diagnostics: tuple[Diagnostic, ...]

    @property
    def ok(self) -> bool:
        return all(item.passed for item in self.diagnostics)


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    working_directory: Path
    command: tuple[str, ...]
    host: str
    port: int
    readiness: str
    readiness_url: str | None
    required_artifacts: tuple[Path, ...]
    startup_timeout_seconds: float


@dataclass(frozen=True)
class CurrentExperienceProfile:
    path: Path
    repository_root: Path
    env_file: Path
    managed_environment: dict[str, str]
    alembic_working_directory: Path
    alembic_config_file: Path
    database_url_environment: str
    services: tuple[ServiceSpec, ...]
    backend_health_url: str
    backend_version_url: str
    backend_config_url: str
    frontend_url: str
    copilot_host: str
    copilot_port: int
    request_timeout_seconds: float
    expected_config: dict[str, bool]
    poll_interval_seconds: float
    term_grace_seconds: float
    kill_grace_seconds: float


@dataclass(frozen=True)
class AlembicState:
    script_heads: tuple[str, ...]
    current_heads: tuple[str, ...]
    database_source: str


@dataclass(frozen=True)
class HttpResult:
    status: int
    json_data: Any = None
    error: str | None = None


def _display(value: Any) -> str:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return str(value)


def _inside_root(root: Path, relative: str, *, label: str) -> Path:
    pure = PurePosixPath(relative)
    if relative == ".":
        return root
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ProfileError(f"{label} must be repository-relative")
    path = root.joinpath(*pure.parts)
    try:
        path.resolve(strict=False).relative_to(root.resolve())
    except ValueError as exc:
        raise ProfileError(f"{label} escapes the repository") from exc
    return path


def _table(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProfileError(f"{label} must be a table")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProfileError(f"{label} must be a non-empty string")
    return value


def _positive_number(value: Any, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
        raise ProfileError(f"{label} must be positive")
    return float(value)


def _port(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 < value <= MAX_PORT:
        raise ProfileError(f"{label} must be an integer from 1 to {MAX_PORT}")
    return value


def _local_http_url(value: Any, label: str) -> str:
    url = _string(value, label)
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOCAL_HTTP_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ProfileError(f"{label} must be an unauthenticated local HTTP URL")
    try:
        _port(parsed.port, f"{label}.port")
    except ValueError as exc:
        raise ProfileError(f"{label} contains an invalid port") from exc
    return url


def load_profile(path: Path, repository_root: Path) -> CurrentExperienceProfile:
    repository_root = repository_root.resolve()
    try:
        document = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ProfileError(f"cannot read current-experience profile: {exc}") from exc
    if document.get("schema_version") != 1:
        raise ProfileError("current-experience schema_version must be 1")

    env_file = _inside_root(
        repository_root,
        _string(document.get("env_file"), "env_file"),
        label="env_file",
    )
    environment = _table(document.get("environment"), "environment")
    managed_raw = _table(environment.get("managed"), "environment.managed")
    managed = {str(key): _string(value, f"environment.managed.{key}") for key, value in managed_raw.items()}
    for name, expected in REQUIRED_MANAGED_ENVIRONMENT.items():
        actual = managed.get(name)
        if actual != expected:
            raise ProfileError(f"environment.managed.{name} must be {expected!r}; actual={actual!r}")
    if managed != REQUIRED_MANAGED_ENVIRONMENT:
        extras = sorted(set(managed) - set(REQUIRED_MANAGED_ENVIRONMENT))
        raise ProfileError(f"environment.managed contains unsupported keys: {extras}")

    alembic = _table(document.get("alembic"), "alembic")
    alembic_working_directory = _inside_root(
        repository_root,
        _string(alembic.get("working_directory"), "alembic.working_directory"),
        label="alembic.working_directory",
    )
    alembic_config_file = alembic_working_directory / _string(
        alembic.get("config_file"),
        "alembic.config_file",
    )
    database_url_environment = _string(
        alembic.get("database_url_environment"),
        "alembic.database_url_environment",
    )

    services: list[ServiceSpec] = []
    raw_services = document.get("services")
    if not isinstance(raw_services, list):
        raise ProfileError("services must be an array of tables")
    for index, raw_service in enumerate(raw_services):
        item = _table(raw_service, f"services[{index}]")
        name = _string(item.get("name"), f"services[{index}].name")
        raw_command = item.get("command")
        if (
            not isinstance(raw_command, list)
            or not raw_command
            or not all(isinstance(value, str) and value for value in raw_command)
        ):
            raise ProfileError(f"services[{index}].command must be a non-empty string array")
        port = _port(item.get("port"), f"services[{index}].port")
        readiness = _string(item.get("readiness"), f"services[{index}].readiness")
        if readiness not in {"http", "tcp"}:
            raise ProfileError(f"services[{index}].readiness must be http or tcp")
        readiness_url = item.get("readiness_url")
        if readiness == "http":
            readiness_url = _local_http_url(
                readiness_url,
                f"services[{index}].readiness_url",
            )
        elif readiness_url is not None:
            raise ProfileError(f"services[{index}].readiness_url is only valid for http readiness")
        raw_artifacts = item.get("required_artifacts", [])
        if not isinstance(raw_artifacts, list) or not all(isinstance(value, str) for value in raw_artifacts):
            raise ProfileError(f"services[{index}].required_artifacts must be a string array")
        services.append(
            ServiceSpec(
                name=name,
                working_directory=_inside_root(
                    repository_root,
                    _string(item.get("working_directory"), f"services[{index}].working_directory"),
                    label=f"services[{index}].working_directory",
                ),
                command=tuple(raw_command),
                host=_string(item.get("host"), f"services[{index}].host"),
                port=port,
                readiness=readiness,
                readiness_url=readiness_url,
                required_artifacts=tuple(
                    _inside_root(repository_root, artifact, label=f"services[{index}].required_artifacts")
                    for artifact in raw_artifacts
                ),
                startup_timeout_seconds=_positive_number(
                    item.get("startup_timeout_seconds"),
                    f"services[{index}].startup_timeout_seconds",
                ),
            )
        )
    names = tuple(service.name for service in services)
    if names != SERVICE_ORDER:
        raise ProfileError(f"services must be declared in exact order {SERVICE_ORDER}; actual={names}")
    endpoints = [(service.host, service.port) for service in services]
    if len(endpoints) != len(set(endpoints)):
        raise ProfileError("service host/port pairs must be unique")

    proof_table = _table(document.get("proof"), "proof")
    expected_config_raw = _table(proof_table.get("expected_config"), "proof.expected_config")
    expected_config = {
        name: expected_config_raw.get(name) for name in ("mvp_workspace", "mvp_chat", "agentic_experience")
    }
    if expected_config != {
        "mvp_workspace": True,
        "mvp_chat": True,
        "agentic_experience": True,
    }:
        raise ProfileError("proof.expected_config must enable workspace, chat, and agentic experience")

    supervisor = _table(document.get("supervisor"), "supervisor")
    backend_health_url = _local_http_url(
        proof_table.get("backend_health_url"),
        "proof.backend_health_url",
    )
    backend_version_url = _local_http_url(
        proof_table.get("backend_version_url"),
        "proof.backend_version_url",
    )
    backend_config_url = _local_http_url(
        proof_table.get("backend_config_url"),
        "proof.backend_config_url",
    )
    frontend_url = _local_http_url(
        proof_table.get("frontend_url"),
        "proof.frontend_url",
    )
    return CurrentExperienceProfile(
        path=path.resolve(),
        repository_root=repository_root,
        env_file=env_file,
        managed_environment=managed,
        alembic_working_directory=alembic_working_directory,
        alembic_config_file=alembic_config_file,
        database_url_environment=database_url_environment,
        services=tuple(services),
        backend_health_url=backend_health_url,
        backend_version_url=backend_version_url,
        backend_config_url=backend_config_url,
        frontend_url=frontend_url,
        copilot_host=_string(proof_table.get("copilot_host"), "proof.copilot_host"),
        copilot_port=_port(proof_table.get("copilot_port"), "proof.copilot_port"),
        request_timeout_seconds=_positive_number(
            proof_table.get("request_timeout_seconds"),
            "proof.request_timeout_seconds",
        ),
        expected_config=expected_config,
        poll_interval_seconds=_positive_number(
            supervisor.get("poll_interval_seconds"),
            "supervisor.poll_interval_seconds",
        ),
        term_grace_seconds=_positive_number(
            supervisor.get("term_grace_seconds"),
            "supervisor.term_grace_seconds",
        ),
        kill_grace_seconds=_positive_number(
            supervisor.get("kill_grace_seconds"),
            "supervisor.kill_grace_seconds",
        ),
    )


def _dotenv_values(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    try:
        from dotenv import dotenv_values
    except ImportError as exc:  # pragma: no cover - root environment includes python-dotenv
        raise ProfileError("python-dotenv is required to read the configured env file") from exc
    return {str(key): value for key, value in dotenv_values(path).items() if isinstance(value, str)}


def build_effective_environment(
    profile: CurrentExperienceProfile,
    *,
    process_environment: Mapping[str, str] | None = None,
    env_file_values: Mapping[str, str] | None = None,
) -> dict[str, str]:
    effective = dict(_dotenv_values(profile.env_file) if env_file_values is None else env_file_values)
    effective.update(dict(os.environ if process_environment is None else process_environment))
    effective.update(profile.managed_environment)
    return effective


def _default_port_available(host: str, port: int) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def _database_url(profile: CurrentExperienceProfile, environment: Mapping[str, str]) -> tuple[str, str]:
    explicit = environment.get(profile.database_url_environment, "").strip()
    if explicit:
        return explicit, profile.database_url_environment
    data_dir = environment.get("KETOS_DATA_DIR", "").strip()
    if data_dir:
        database_path = Path(data_dir).expanduser().resolve() / "ketos.db"
    else:
        from platformdirs import user_config_path, user_data_path

        data_path = Path(user_data_path("ketos", "Ketos"))
        config_path = Path(user_config_path("ketos", "Ketos"))
        if data_path == config_path:
            data_path /= "data"
        database_path = data_path.resolve() / "ketos.db"
    return f"sqlite:///{database_path}", "KETOS_DATA_DIR/default"


def _sqlite_path(database_url: str, repository_root: Path) -> Path | None:
    prefixes = ("sqlite+aiosqlite:///", "sqlite:///")
    prefix = next((candidate for candidate in prefixes if database_url.startswith(candidate)), None)
    if prefix is None:
        return None
    raw = database_url[len(prefix) :].split("?", maxsplit=1)[0]
    path = Path(raw).expanduser()
    return path if path.is_absolute() else (repository_root / path).resolve()


def inspect_alembic_state(
    profile: CurrentExperienceProfile,
    environment: Mapping[str, str],
) -> AlembicState:
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine

    database_url, source = _database_url(profile, environment)
    sqlite_path = _sqlite_path(database_url, profile.repository_root)
    if sqlite_path is not None and not sqlite_path.is_file():
        raise RuntimeError(f"database file does not exist: {sqlite_path}")

    config = Config(str(profile.alembic_config_file))
    config.set_main_option("script_location", str(profile.alembic_working_directory / "alembic"))
    script_heads = tuple(ScriptDirectory.from_config(config).get_heads())
    sync_url = database_url.replace("+aiosqlite", "").replace("+asyncpg", "")
    engine = create_engine(sync_url)
    try:
        with engine.connect() as connection:
            current_heads = tuple(MigrationContext.configure(connection).get_current_heads())
    finally:
        engine.dispose()
    return AlembicState(
        script_heads=script_heads,
        current_heads=current_heads,
        database_source=source,
    )


def preflight(
    profile: CurrentExperienceProfile,
    repository_root: Path,
    environment: Mapping[str, str],
    *,
    version_probe: Callable[[Path], Sequence[version_contract.Finding]] = version_contract.check_contract,
    alembic_probe: Callable[[CurrentExperienceProfile, Mapping[str, str]], AlembicState] = inspect_alembic_state,
    port_available: Callable[[str, int], bool] = _default_port_available,
    artifact_exists: Callable[[Path], bool] = Path.is_file,
) -> Report:
    diagnostics: list[Diagnostic] = []
    try:
        version_failures = tuple(version_probe(repository_root))
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(
            Diagnostic("version-family", "version-family-error", "consistent", type(exc).__name__, str(exc))
        )
    else:
        diagnostics.append(
            Diagnostic(
                "version-family",
                "version-family",
                "consistent",
                [finding.render() for finding in version_failures] if version_failures else "consistent",
                "declared product version relations",
                passed=not version_failures,
            )
        )

    for name, expected in REQUIRED_MANAGED_ENVIRONMENT.items():
        actual = environment.get(name)
        diagnostics.append(
            Diagnostic(
                f"environment.{name}",
                "environment-value",
                expected,
                actual if actual is not None else "<missing>",
                "effective current-profile value",
                passed=actual == expected,
            )
        )

    try:
        alembic_state = alembic_probe(profile, environment)
    except Exception as exc:  # noqa: BLE001
        diagnostics.append(
            Diagnostic(
                "alembic",
                "alembic-inspection",
                "readable current database",
                type(exc).__name__,
                str(exc),
            )
        )
    else:
        diagnostics.append(
            Diagnostic(
                "alembic.heads",
                "alembic-head-count",
                1,
                len(alembic_state.script_heads),
                f"source={alembic_state.database_source}",
                passed=len(alembic_state.script_heads) == 1,
            )
        )
        diagnostics.append(
            Diagnostic(
                "alembic.current",
                "alembic-current",
                list(alembic_state.script_heads),
                list(alembic_state.current_heads),
                f"source={alembic_state.database_source}",
                passed=(
                    len(alembic_state.script_heads) == 1 and alembic_state.current_heads == alembic_state.script_heads
                ),
            )
        )

    for service in profile.services:
        for artifact in service.required_artifacts:
            exists = artifact_exists(artifact)
            diagnostics.append(
                Diagnostic(
                    f"artifact.{service.name}",
                    "artifact",
                    "present",
                    str(artifact.relative_to(repository_root)) if exists else "<missing>",
                    "required prebuilt runtime artifact",
                    passed=exists,
                )
            )
        available = port_available(service.host, service.port)
        endpoint = f"{service.host}:{service.port}"
        diagnostics.append(
            Diagnostic(
                f"port.{service.name}",
                "port-available" if available else "port-occupied",
                "available",
                endpoint,
                "exclusive startup port",
                passed=available,
            )
        )
    return Report(tuple(diagnostics))


def _default_http_probe(url: str, timeout: float) -> HttpResult:
    request = urllib.request.Request(url, headers={"accept": "*/*"})  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            raw = response.read()
            content_type = response.headers.get("content-type", "")
            payload = json.loads(raw) if raw and "json" in content_type else None
            return HttpResult(status=response.status, json_data=payload)
    except urllib.error.HTTPError as exc:
        return HttpResult(status=exc.code, error=str(exc))
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        return HttpResult(status=0, error=type(exc).__name__)


def _default_tcp_probe(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def proof(
    profile: CurrentExperienceProfile,
    *,
    expected_version: str,
    http_probe: Callable[[str], HttpResult] | None = None,
    tcp_probe: Callable[[str, int], bool] | None = None,
) -> Report:
    http = http_probe or (lambda url: _default_http_probe(url, profile.request_timeout_seconds))
    tcp = tcp_probe or _default_tcp_probe
    diagnostics: list[Diagnostic] = []

    health = http(profile.backend_health_url)
    diagnostics.append(
        Diagnostic(
            "service.backend",
            "service-backend",
            "HTTP 2xx",
            health.status,
            profile.backend_health_url,
            passed=HTTP_SUCCESS_MIN <= health.status < HTTP_SUCCESS_MAX,
        )
    )
    runtime_version = http(profile.backend_version_url)
    actual_version = (
        runtime_version.json_data.get("version") if isinstance(runtime_version.json_data, dict) else "<unavailable>"
    )
    diagnostics.append(
        Diagnostic(
            "runtime.version",
            "runtime-version",
            expected_version,
            actual_version,
            profile.backend_version_url,
            passed=runtime_version.status == HTTP_SUCCESS_MIN and actual_version == expected_version,
        )
    )
    runtime_config = http(profile.backend_config_url)
    flags = runtime_config.json_data.get("feature_flags", {}) if isinstance(runtime_config.json_data, dict) else {}
    if not isinstance(flags, dict):
        flags = {}
    for name, expected in profile.expected_config.items():
        actual = flags.get(name, "<unavailable>")
        diagnostics.append(
            Diagnostic(
                f"runtime.config.{name}",
                f"config-{name}",
                expected,
                actual,
                profile.backend_config_url,
                passed=runtime_config.status == HTTP_SUCCESS_MIN and actual is expected,
            )
        )
    frontend = http(profile.frontend_url)
    diagnostics.append(
        Diagnostic(
            "service.frontend",
            "service-frontend",
            "HTTP 2xx",
            frontend.status,
            profile.frontend_url,
            passed=HTTP_SUCCESS_MIN <= frontend.status < HTTP_SUCCESS_MAX,
        )
    )
    copilot_available = tcp(profile.copilot_host, profile.copilot_port)
    diagnostics.append(
        Diagnostic(
            "service.copilot",
            "service-copilot",
            "TCP ready",
            f"{profile.copilot_host}:{profile.copilot_port}",
            "copilot runtime listener",
            passed=copilot_available,
        )
    )
    return Report(tuple(diagnostics))


def _service_ready(service: ServiceSpec, profile: CurrentExperienceProfile) -> bool:
    if service.readiness == "tcp":
        return _default_tcp_probe(service.host, service.port)
    if service.readiness_url is None:
        return False
    result = _default_http_probe(service.readiness_url, profile.request_timeout_seconds)
    return HTTP_SUCCESS_MIN <= result.status < HTTP_SUCCESS_MAX


def _cleanup(
    processes: Sequence[subprocess.Popen[Any]],
    profile: CurrentExperienceProfile,
) -> bool:
    running = [process for process in processes if process.poll() is None]
    for process in running:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + profile.term_grace_seconds
    while running and time.monotonic() < deadline:
        running = [process for process in running if process.poll() is None]
        if running:
            time.sleep(profile.poll_interval_seconds)
    for process in running:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    kill_deadline = time.monotonic() + profile.kill_grace_seconds
    while running and time.monotonic() < kill_deadline:
        running = [process for process in running if process.poll() is None]
        if running:
            time.sleep(profile.poll_interval_seconds)
    for process in processes:
        with contextlib.suppress(subprocess.TimeoutExpired, ChildProcessError):
            process.wait(timeout=0)
    return not running


def run_profile(
    profile: CurrentExperienceProfile,
    environment: Mapping[str, str],
) -> int:
    preflight_report = preflight(profile, profile.repository_root, environment)
    _print_report(preflight_report)
    if not preflight_report.ok:
        return 10

    processes: list[subprocess.Popen[Any]] = []
    received_signal: int | None = None

    def request_stop(signum: int, _frame: Any) -> None:
        nonlocal received_signal
        received_signal = signum

    previous_handlers = {signum: signal.signal(signum, request_stop) for signum in (signal.SIGINT, signal.SIGTERM)}
    try:
        for service in profile.services:
            executable = shutil.which(service.command[0], path=environment.get("PATH"))
            if executable is None:
                print(
                    f"FAIL service={service.name} executable-not-found={service.command[0]}",
                    file=sys.stderr,
                )
                return 20
            command = (executable, *service.command[1:])
            print(
                f"START service={service.name} cwd={service.working_directory.relative_to(profile.repository_root)} "
                f"command={json.dumps(command)}"
            )
            process = subprocess.Popen(  # noqa: S603
                command,
                cwd=service.working_directory,
                env=dict(environment),
                shell=False,
                start_new_session=True,
            )
            processes.append(process)
            if process.poll() is not None:
                print(f"FAIL service={service.name} exited={process.returncode}", file=sys.stderr)
                return 22

        for service, process in zip(profile.services, processes, strict=True):
            deadline = time.monotonic() + service.startup_timeout_seconds
            while time.monotonic() < deadline:
                if received_signal is not None:
                    return 128 + received_signal
                failed = next((child for child in processes if child.poll() is not None), None)
                if failed is not None:
                    print(f"FAIL child-exit pid={failed.pid} code={failed.returncode}", file=sys.stderr)
                    return 22
                if _service_ready(service, profile):
                    print(f"READY service={service.name} endpoint={service.host}:{service.port}")
                    break
                time.sleep(profile.poll_interval_seconds)
            else:
                print(f"FAIL readiness-timeout service={service.name}", file=sys.stderr)
                return 21
            if process.poll() is not None:
                return 22

        expected_version = version_contract.canonical_version(profile.repository_root)
        proof_report = proof(profile, expected_version=expected_version)
        _print_report(proof_report)
        if not proof_report.ok:
            return 23
        print(
            f"PASS current-experience sha={_git_sha(profile.repository_root)} "
            f"product={expected_version} ports=7860,3000,8788"
        )
        while received_signal is None:
            failed = next((child for child in processes if child.poll() is not None), None)
            if failed is not None:
                print(f"FAIL child-exit pid={failed.pid} code={failed.returncode}", file=sys.stderr)
                return 22
            time.sleep(profile.poll_interval_seconds)
        return 128 + received_signal
    except OSError as exc:
        print(f"FAIL spawn error={type(exc).__name__} detail={exc}", file=sys.stderr)
        return 20
    finally:
        cleaned = _cleanup(processes, profile)
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
        if not cleaned:
            print("FAIL cleanup-unreaped-child", file=sys.stderr)


def _legacy_profile(profile: CurrentExperienceProfile) -> CurrentExperienceProfile:
    managed = dict(profile.managed_environment)
    managed.update(
        {
            "KETOS_FEATURE_MVP_WORKSPACE": "false",
            "KETOS_FEATURE_MVP_CHAT": "false",
            "KETOS_AGENTIC_EXPERIENCE": "false",
        }
    )
    return replace(profile, managed_environment=managed)


def _git_sha(repository_root: Path) -> str:
    git = shutil.which("git")
    if git is None:
        raise ProfileError("Git executable is required for current-experience proof")
    result = subprocess.run(  # noqa: S603
        [git, "rev-parse", "HEAD"],
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _print_report(report: Report) -> None:
    for diagnostic in report.diagnostics:
        print(diagnostic.render(), file=sys.stdout if diagnostic.passed else sys.stderr)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    parser.add_argument(
        "--profile",
        type=Path,
        default=Path("config/current-experience.toml"),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("preflight")
    subparsers.add_parser("proof")
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--legacy", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    root = arguments.root.resolve()
    profile_path = arguments.profile
    if not profile_path.is_absolute():
        profile_path = root / profile_path
    try:
        profile = load_profile(profile_path, root)
        if getattr(arguments, "legacy", False):
            profile = _legacy_profile(profile)
        environment = build_effective_environment(profile)
    except ProfileError as exc:
        print(f"FAIL profile detail={exc}", file=sys.stderr)
        return 2

    if arguments.command == "preflight":
        report = preflight(profile, root, environment)
        _print_report(report)
        if not report.ok:
            return 10
        version = version_contract.canonical_version(root)
        state = inspect_alembic_state(profile, environment)
        print(
            f"PASS current-preflight sha={_git_sha(root)} product={version} "
            f"alembic_head={state.script_heads[0]} alembic_current={state.current_heads[0]} "
            "ports=backend:7860,frontend:3000,copilot:8788 "
            "workspace=true chat=true agentic=true strict_msgpack=true"
        )
        return 0
    if arguments.command == "proof":
        expected_version = version_contract.canonical_version(root)
        report = proof(profile, expected_version=expected_version)
        _print_report(report)
        if not report.ok:
            return 23
        print(
            f"PASS current-proof sha={_git_sha(root)} product={expected_version} "
            "ports=backend:7860,frontend:3000,copilot:8788 "
            "workspace=true chat=true agentic=true strict_msgpack=true"
        )
        return 0
    return run_profile(profile, environment)


if __name__ == "__main__":
    raise SystemExit(main())
