from __future__ import annotations

import os
from pathlib import Path

import pytest

from scripts.ci import current_experience

REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILE_PATH = REPO_ROOT / "config" / "current-experience.toml"


def _profile():
    return current_experience.load_profile(PROFILE_PATH, REPO_ROOT)


def _good_environment(profile) -> dict[str, str]:
    return current_experience.build_effective_environment(
        profile,
        process_environment={},
        env_file_values={"KETOS_DATABASE_URL": "sqlite+aiosqlite:///./ketos.db"},
    )


def _good_alembic_state() -> current_experience.AlembicState:
    return current_experience.AlembicState(
        script_heads=("s08c0mmand01",),
        current_heads=("s08c0mmand01",),
        database_source="KETOS_DATABASE_URL",
    )


def test_profile_declares_exact_current_experience_contract() -> None:
    profile = _profile()

    assert profile.managed_environment == {
        "KFX_DEV": "1",
        "KETOS_FEATURE_MVP_WORKSPACE": "true",
        "KETOS_FEATURE_MVP_CHAT": "true",
        "KETOS_AGENTIC_EXPERIENCE": "true",
        "LANGGRAPH_STRICT_MSGPACK": "true",
    }
    assert {service.name: service.port for service in profile.services} == {
        "backend": 7860,
        "frontend": 3000,
        "copilot": 8788,
    }
    backend = next(service for service in profile.services if service.name == "backend")
    assert backend.startup_timeout_seconds >= 180
    assert profile.alembic_working_directory == REPO_ROOT / "src/backend/base/ketos"
    assert profile.expected_config == {
        "mvp_workspace": True,
        "mvp_chat": True,
        "agentic_experience": True,
    }


def test_effective_environment_precedence_ends_with_managed_profile() -> None:
    profile = _profile()

    effective = current_experience.build_effective_environment(
        profile,
        process_environment={
            "KETOS_FEATURE_MVP_WORKSPACE": "false",
            "KETOS_FEATURE_MVP_CHAT": "false",
        },
        env_file_values={
            "KETOS_FEATURE_MVP_WORKSPACE": "false",
            "KETOS_AGENTIC_EXPERIENCE": "false",
        },
    )

    assert effective["KETOS_FEATURE_MVP_WORKSPACE"] == "true"
    assert effective["KETOS_FEATURE_MVP_CHAT"] == "true"
    assert effective["KETOS_AGENTIC_EXPERIENCE"] == "true"
    assert effective["LANGGRAPH_STRICT_MSGPACK"] == "true"


def test_profile_missing_strict_msgpack_value_fails(tmp_path: Path) -> None:
    text = PROFILE_PATH.read_text(encoding="utf-8").replace(
        'LANGGRAPH_STRICT_MSGPACK = "true"\n',
        "",
    )
    profile_path = tmp_path / "profile.toml"
    profile_path.write_text(text, encoding="utf-8")

    with pytest.raises(current_experience.ProfileError, match="LANGGRAPH_STRICT_MSGPACK"):
        current_experience.load_profile(profile_path, REPO_ROOT)


def test_profile_rejects_non_local_http_probe_url(tmp_path: Path) -> None:
    text = PROFILE_PATH.read_text(encoding="utf-8").replace(
        'backend_health_url = "http://127.0.0.1:7860/health_check"',
        'backend_health_url = "https://example.test/health_check"',
    )
    profile_path = tmp_path / "profile.toml"
    profile_path.write_text(text, encoding="utf-8")

    with pytest.raises(current_experience.ProfileError, match="local HTTP URL"):
        current_experience.load_profile(profile_path, REPO_ROOT)


def test_profile_rejects_boolean_copilot_port(tmp_path: Path) -> None:
    text = PROFILE_PATH.read_text(encoding="utf-8").replace(
        "copilot_port = 8788",
        "copilot_port = true",
    )
    profile_path = tmp_path / "profile.toml"
    profile_path.write_text(text, encoding="utf-8")

    with pytest.raises(current_experience.ProfileError, match="integer"):
        current_experience.load_profile(profile_path, REPO_ROOT)


def test_preflight_reports_occupied_port() -> None:
    profile = _profile()

    report = current_experience.preflight(
        profile,
        REPO_ROOT,
        _good_environment(profile),
        version_probe=lambda _root: (),
        alembic_probe=lambda _profile, _environment: _good_alembic_state(),
        port_available=lambda _host, port: port != 3000,
        artifact_exists=lambda _path: True,
    )

    assert report.ok is False
    assert any(item.code == "port-occupied" and item.actual == "127.0.0.1:3000" for item in report.diagnostics)


@pytest.mark.parametrize("heads", [(), ("head-one", "head-two")])
def test_preflight_requires_exactly_one_alembic_head(heads: tuple[str, ...]) -> None:
    profile = _profile()

    report = current_experience.preflight(
        profile,
        REPO_ROOT,
        _good_environment(profile),
        version_probe=lambda _root: (),
        alembic_probe=lambda _profile, _environment: current_experience.AlembicState(
            script_heads=heads,
            current_heads=heads,
            database_source="KETOS_DATABASE_URL",
        ),
        port_available=lambda _host, _port: True,
        artifact_exists=lambda _path: True,
    )

    assert report.ok is False
    assert any(item.code == "alembic-head-count" for item in report.diagnostics)


def test_preflight_rejects_database_revision_behind_head() -> None:
    profile = _profile()

    report = current_experience.preflight(
        profile,
        REPO_ROOT,
        _good_environment(profile),
        version_probe=lambda _root: (),
        alembic_probe=lambda _profile, _environment: current_experience.AlembicState(
            script_heads=("s08c0mmand01",),
            current_heads=("older-revision",),
            database_source="KETOS_DATABASE_URL",
        ),
        port_available=lambda _host, _port: True,
        artifact_exists=lambda _path: True,
    )

    assert report.ok is False
    assert any(
        item.code == "alembic-current" and item.expected == ["s08c0mmand01"] and item.actual == ["older-revision"]
        for item in report.diagnostics
    )


def _http_result(status: int, json_data=None) -> current_experience.HttpResult:
    return current_experience.HttpResult(status=status, json_data=json_data)


def test_proof_rejects_runtime_version_mismatch() -> None:
    profile = _profile()

    def http_probe(url: str) -> current_experience.HttpResult:
        if url.endswith("/api/v1/version"):
            return _http_result(200, {"version": "1.10.1"})
        if url.endswith("/api/v1/config"):
            return _http_result(
                200,
                {
                    "feature_flags": {
                        "mvp_workspace": True,
                        "mvp_chat": True,
                        "agentic_experience": True,
                    }
                },
            )
        return _http_result(200, {})

    report = current_experience.proof(
        profile,
        expected_version="1.10.2",
        http_probe=http_probe,
        tcp_probe=lambda _host, _port: True,
    )

    assert report.ok is False
    assert any(
        item.code == "runtime-version" and item.actual == "1.10.1" and item.expected == "1.10.2"
        for item in report.diagnostics
    )


@pytest.mark.parametrize(
    ("flag", "actual"),
    [
        ("mvp_workspace", False),
        ("mvp_chat", False),
        ("agentic_experience", False),
    ],
)
def test_proof_rejects_current_config_mismatch(flag: str, actual) -> None:
    profile = _profile()
    flags = {
        "mvp_workspace": True,
        "mvp_chat": True,
        "agentic_experience": True,
    }
    flags[flag] = actual

    def http_probe(url: str) -> current_experience.HttpResult:
        if url.endswith("/api/v1/version"):
            return _http_result(200, {"version": "1.10.2"})
        if url.endswith("/api/v1/config"):
            return _http_result(200, {"feature_flags": flags})
        return _http_result(200, {})

    report = current_experience.proof(
        profile,
        expected_version="1.10.2",
        http_probe=http_probe,
        tcp_probe=lambda _host, _port: True,
    )

    assert report.ok is False
    assert any(item.code == f"config-{flag}" for item in report.diagnostics)


@pytest.mark.parametrize("unavailable", ["backend", "frontend", "copilot"])
def test_proof_rejects_unavailable_service(unavailable: str) -> None:
    profile = _profile()

    def http_probe(url: str) -> current_experience.HttpResult:
        if unavailable == "backend" and url.endswith("/health_check"):
            return _http_result(503)
        if unavailable == "frontend" and url == "http://127.0.0.1:3000/":
            return _http_result(503)
        if url.endswith("/api/v1/version"):
            return _http_result(200, {"version": "1.10.2"})
        if url.endswith("/api/v1/config"):
            return _http_result(
                200,
                {
                    "feature_flags": {
                        "mvp_workspace": True,
                        "mvp_chat": True,
                        "agentic_experience": True,
                    }
                },
            )
        return _http_result(200, {})

    report = current_experience.proof(
        profile,
        expected_version="1.10.2",
        http_probe=http_probe,
        tcp_probe=lambda _host, _port: unavailable != "copilot",
    )

    assert report.ok is False
    assert any(item.code == f"service-{unavailable}" for item in report.diagnostics)


def test_makefile_exposes_current_experience_targets() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")

    for target in (
        "version-check:",
        "current-preflight:",
        "run-current:",
        "current-proof:",
        "run-legacy:",
    ):
        assert target in makefile
    run_cli_recipe = makefile.split("run_cli:", maxsplit=1)[1].split("\n\n", maxsplit=1)[0]
    assert "$(MAKE) run-current" in run_cli_recipe
    assert "ketos run" not in run_cli_recipe


def test_profile_load_is_read_only() -> None:
    before = {path: path.stat().st_mtime_ns for path in (PROFILE_PATH, REPO_ROOT / "pyproject.toml")}

    _profile()

    assert {path: path.stat().st_mtime_ns for path in before} == before
    assert os.environ.get("LANGGRAPH_STRICT_MSGPACK") != "__mutated_by_test__"
