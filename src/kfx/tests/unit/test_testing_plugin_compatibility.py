"""Compatibility contracts for the canonical KFX pytest plugin."""

from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from _pytest.config.argparsing import Parser
from kfx.testing import plugin


class _Config:
    def __init__(self, **options: object) -> None:
        self._options = options

    def getoption(self, name: str, default: object = None) -> object:
        return self._options.get(name, default)


class _Request:
    def __init__(self, *, markers: dict[str, object] | None = None, **options: object) -> None:
        self.config = _Config(**options)
        self.node = MagicMock()

        def get_closest_marker(name: str) -> object | None:
            if markers is None or name not in markers:
                return None
            return SimpleNamespace(args=[markers[name]])

        self.node.get_closest_marker.side_effect = get_closest_marker


def test_pytest_addoption_registers_canonical_and_legacy_families() -> None:
    parser = Parser(_ispytest=True)

    plugin.pytest_addoption(parser)
    parsed = parser.parse(
        [
            "--kfx-env-file",
            ".env.kfx",
            "--lfx-env-file",
            ".env.lfx",
            "--kfx-timeout",
            "12",
            "--lfx-timeout",
            "34",
            "--ketos-url",
            "https://ketos.example",
            "--langflow-url",
            "https://langflow.example",
        ]
    )

    assert parsed.kfx_env_file == ".env.kfx"
    assert parsed.lfx_env_file == ".env.lfx"
    assert parsed.kfx_timeout == 12
    assert parsed.lfx_timeout == 34
    assert parsed.ketos_url == "https://ketos.example"
    assert parsed.langflow_url == "https://langflow.example"


def test_pytest_addoption_is_idempotent_for_shared_plugin_flags() -> None:
    parser = Parser(_ispytest=True)

    plugin.pytest_addoption(parser)
    plugin.pytest_addoption(parser)


def test_pytest_configure_registers_both_marker_families() -> None:
    config = MagicMock()

    plugin.pytest_configure(config)

    marker_lines = [call.args[1] for call in config.addinivalue_line.call_args_list]
    assert any(line.startswith("kfx_env_file(") for line in marker_lines)
    assert any(line.startswith("kfx_timeout(") for line in marker_lines)
    assert any(line.startswith("lfx_env_file(") for line in marker_lines)
    assert any(line.startswith("lfx_timeout(") for line in marker_lines)


def test_canonical_local_family_precedes_legacy_family(monkeypatch) -> None:
    monkeypatch.setenv("KFX_ENV_FILE", ".env.kfx-env")
    monkeypatch.setenv("KFX_TIMEOUT", "22")
    monkeypatch.setenv("KFX_FLOW_DIR", "/tmp/kfx-env")
    monkeypatch.setenv("LFX_ENV_FILE", ".env.lfx-env")
    monkeypatch.setenv("LFX_TIMEOUT", "44")
    monkeypatch.setenv("LFX_FLOW_DIR", "/tmp/lfx-env")
    request = _Request(
        markers={"lfx_env_file": ".env.lfx-marker", "lfx_timeout": 66},
        kfx_env_file=None,
        kfx_timeout=None,
        kfx_flow_dir=None,
        lfx_env_file=".env.lfx-cli",
        lfx_timeout=55,
        lfx_flow_dir="/tmp/lfx-cli",
    )

    env_file, timeout, flow_dir = plugin._resolve_runner_config(request)

    assert env_file == ".env.kfx-env"
    assert timeout == 22
    assert str(flow_dir) == "/tmp/kfx-env"


def test_legacy_local_family_remains_supported(monkeypatch) -> None:
    for name in ("KFX_ENV_FILE", "KFX_TIMEOUT", "KFX_FLOW_DIR"):
        monkeypatch.delenv(name, raising=False)
    request = _Request(
        markers={"lfx_timeout": 0},
        kfx_env_file=None,
        kfx_timeout=None,
        kfx_flow_dir=None,
        lfx_env_file=".env.legacy",
        lfx_timeout=55,
        lfx_flow_dir="/tmp/legacy",
    )

    env_file, timeout, flow_dir = plugin._resolve_runner_config(request)

    assert env_file == ".env.legacy"
    assert timeout == 0
    assert str(flow_dir) == "/tmp/legacy"


def test_canonical_remote_environment_precedes_legacy_cli(monkeypatch) -> None:
    monkeypatch.setenv("KETOS_URL", "https://ketos-env.example")
    monkeypatch.setenv("KETOS_API_KEY", "ketos-env-key")
    monkeypatch.setenv("LANGFLOW_URL", "https://langflow-env.example")
    monkeypatch.setenv("LANGFLOW_API_KEY", "langflow-env-key")
    client = object()
    sdk = SimpleNamespace(KetosClient=MagicMock(return_value=client))
    monkeypatch.setitem(sys.modules, "ketos_sdk", sdk)
    request = _Request(
        ketos_url=None,
        ketos_api_key=None,
        ketos_env=None,
        ketos_environments_file=None,
        langflow_url="https://langflow-cli.example",
        langflow_api_key="langflow-cli-key",
        langflow_env=None,
        langflow_environments_file=None,
    )

    assert plugin._resolve_remote_client(request) is client
    sdk.KetosClient.assert_called_once_with(base_url="https://ketos-env.example", api_key="ketos-env-key")


def test_legacy_remote_family_uses_canonical_sync_client(monkeypatch) -> None:
    for name in ("KETOS_URL", "KETOS_API_KEY", "KETOS_ENV"):
        monkeypatch.delenv(name, raising=False)
    client = object()
    sdk = SimpleNamespace(KetosClient=MagicMock(return_value=client))
    monkeypatch.setitem(sys.modules, "ketos_sdk", sdk)
    request = _Request(
        ketos_url=None,
        ketos_api_key=None,
        ketos_env=None,
        ketos_environments_file=None,
        langflow_url="https://legacy.example",
        langflow_api_key="legacy-key",
        langflow_env=None,
        langflow_environments_file=None,
    )

    assert plugin._resolve_remote_client(request) is client
    sdk.KetosClient.assert_called_once_with(base_url="https://legacy.example", api_key="legacy-key")


def test_legacy_remote_family_uses_canonical_async_client(monkeypatch) -> None:
    for name in ("KETOS_URL", "KETOS_API_KEY", "KETOS_ENV"):
        monkeypatch.delenv(name, raising=False)
    client = object()
    sdk = SimpleNamespace(AsyncKetosClient=MagicMock(return_value=client))
    monkeypatch.setitem(sys.modules, "ketos_sdk", sdk)
    request = _Request(
        ketos_url=None,
        ketos_api_key=None,
        ketos_env=None,
        ketos_environments_file=None,
        langflow_url="https://legacy.example",
        langflow_api_key="legacy-key",
        langflow_env=None,
        langflow_environments_file=None,
    )

    assert plugin._resolve_async_remote_client(request) is client
    sdk.AsyncKetosClient.assert_called_once_with(base_url="https://legacy.example", api_key="legacy-key")
