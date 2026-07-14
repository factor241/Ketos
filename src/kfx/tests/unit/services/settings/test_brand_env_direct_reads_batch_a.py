"""Compatibility tests for the first batch of direct branded env consumers."""

from __future__ import annotations

import ast
import importlib
import os
import subprocess
import sys
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from kfx.services.telemetry.service import TelemetryService
from kfx.services.variable.service import VariableService

REPO_ROOT = Path(__file__).parents[6]
BATCH_A_FILES = (
    "src/kfx/src/kfx/log/logger.py",
    "src/kfx/src/kfx/settings.py",
    "src/kfx/src/kfx/interface/utils.py",
    "src/kfx/src/kfx/services/variable/service.py",
    "src/kfx/src/kfx/services/telemetry/service.py",
    "src/kfx/src/kfx/utils/ssrf_protection.py",
)


def _attribute_chain(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_attribute_chain(node.value)}.{node.attr}"
    return ""


@pytest.fixture(autouse=True)
def _clean_batch_environment(monkeypatch):
    suffixes = {
        "DEV",
        "ENVIRONMENT",
        "LANGCHAIN_CACHE",
        "LOG_ENV",
        "LOG_FILE",
        "LOG_FORMAT",
        "LOG_LEVEL",
        "LOG_LEVELS",
        "LOG_REDACT_KEYS",
        "LOG_RETRIEVER_BUFFER_SIZE",
        "LOG_TRACE_LOCALS",
        "PRETTY_LOGS",
        "REQUEST_VARIABLES",
        "SERVICE_NAME",
        "SSRF_ALLOWED_HOSTS",
        "SSRF_PROTECTION_ENABLED",
        "TELEMETRY_BASE_URL",
        "VERSION",
    }
    for suffix in suffixes:
        monkeypatch.delenv(f"KETOS_{suffix}", raising=False)
        monkeypatch.delenv(f"LANGFLOW_{suffix}", raising=False)


def test_batch_a_has_no_literal_direct_branded_environment_reads():
    bypasses: list[tuple[str, int, str]] = []
    for relative_path in BATCH_A_FILES:
        tree = ast.parse((REPO_ROOT / relative_path).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            chain = _attribute_chain(node.func)
            if chain not in {"os.getenv", "os.environ.get"}:
                continue
            first = node.args[0]
            if (
                isinstance(first, ast.Constant)
                and isinstance(first.value, str)
                and first.value.startswith(("KETOS_", "LANGFLOW_"))
            ):
                bypasses.append((relative_path, node.lineno, first.value))

    assert bypasses == []


def test_dev_bootstrap_accepts_legacy_only_without_import_cycle():
    env = os.environ.copy()
    env.pop("KETOS_DEV", None)
    env["LANGFLOW_DEV"] = "true"
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-c", "import kfx.settings; print(kfx.settings.DEV)"],
        check=True,
        capture_output=True,
        env=env,
        text=True,
    )

    assert completed.stdout.strip() == "True"


def test_logger_metadata_and_buffer_accept_legacy_only(monkeypatch):
    logger_module = importlib.import_module("kfx.log.logger")
    monkeypatch.setenv("LANGFLOW_SERVICE_NAME", "legacy-service")
    monkeypatch.setenv("LANGFLOW_VERSION", "1.2.3")
    monkeypatch.setenv("LANGFLOW_ENVIRONMENT", "legacy-environment")
    monkeypatch.setenv("LANGFLOW_LOG_RETRIEVER_BUFFER_SIZE", "17")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        assert logger_module._get_service_info() == {
            "service": "legacy-service",
            "version": "1.2.3",
            "environment": "legacy-environment",
        }
        assert logger_module.SizedLogBuffer().max == 17


def test_langchain_cache_accepts_legacy_only(monkeypatch):
    from kfx.interface.utils import set_langchain_cache

    cache_type = "InMemoryCache"
    cache_class = type("InMemoryCache", (), {})
    monkeypatch.setenv("LANGFLOW_LANGCHAIN_CACHE", cache_type)

    with (
        warnings.catch_warnings(),
        patch("kfx.interface.importing.utils.import_class", return_value=cache_class) as import_class,
        patch("langchain_core.globals.set_llm_cache") as set_llm_cache,
    ):
        warnings.simplefilter("ignore", DeprecationWarning)
        set_langchain_cache(SimpleNamespace(LANGCHAIN_CACHE="unused"))

    import_class.assert_called_once_with(f"langchain_community.cache.{cache_type}")
    set_llm_cache.assert_called_once()


def test_request_variables_accept_legacy_only(monkeypatch):
    monkeypatch.setenv("LANGFLOW_REQUEST_VARIABLES", '{"legacy_token":"selected"}')

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        assert VariableService._get_request_variables() == {"legacy_token": "selected"}


def test_telemetry_base_url_accepts_legacy_only(monkeypatch):
    monkeypatch.setenv("LANGFLOW_TELEMETRY_BASE_URL", "https://legacy.invalid/disabled")

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        default_service = TelemetryService(do_not_track=True)
        empty_service = TelemetryService(base_url="", do_not_track=True)

    assert default_service.base_url == "https://legacy.invalid/disabled"
    assert empty_service.base_url == "https://legacy.invalid/disabled"


def test_ssrf_configuration_accepts_legacy_only(monkeypatch):
    from kfx.utils.ssrf_protection import get_allowed_hosts, is_ssrf_protection_enabled

    monkeypatch.setenv("LANGFLOW_SSRF_PROTECTION_ENABLED", "false")
    monkeypatch.setenv("LANGFLOW_SSRF_ALLOWED_HOSTS", "legacy.internal,10.0.0.0/8")

    with (
        warnings.catch_warnings(),
        patch(
            "kfx.utils.ssrf_protection.get_settings_service",
            side_effect=AssertionError("legacy branded env must resolve before settings fallback"),
        ),
    ):
        warnings.simplefilter("ignore", DeprecationWarning)
        assert is_ssrf_protection_enabled() is False
        assert get_allowed_hosts() == ["legacy.internal", "10.0.0.0/8"]
