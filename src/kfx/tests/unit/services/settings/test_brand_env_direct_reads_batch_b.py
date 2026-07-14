"""Compatibility tests for the Batch B branded-environment consumers."""

from __future__ import annotations

import ast
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from kfx.brand_env import BrandEnvConflictError, BrandEnvLegacyWarning
from kfx.cli._extension_reload_client import resolve_api_key, resolve_target
from kfx.cli.common import get_api_key
from kfx.cli.login import login_command
from kfx.config import environments
from kfx.extension.dev_registry import _default_state_dir
from kfx.load.utils import upload
from kfx.mcp.client import KetosClient

_CONSUMERS = (
    "cli/_extension_reload_client.py",
    "cli/common.py",
    "cli/login.py",
    "config/environments.py",
    "load/utils.py",
    "mcp/client.py",
    "extension/dev_registry.py",
)
_POLICY_COVERED_NAMES = {
    "KETOS_API_KEY",
    "KETOS_CONFIG_DIR",
    "KETOS_DEV_EXTENSIONS_DIR",
    "KETOS_HOST",
    "KETOS_SERVER_URL",
    "KETOS_URL",
}


@pytest.fixture(autouse=True)
def _clear_batch_b_brand_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for suffix in ("API_KEY", "CONFIG_DIR", "DEV_EXTENSIONS_DIR", "HOST", "SERVER_URL", "URL"):
        monkeypatch.delenv(f"KETOS_{suffix}", raising=False)
        monkeypatch.delenv(f"LANGFLOW_{suffix}", raising=False)


def test_batch_b_has_no_literal_policy_bypasses() -> None:
    """Every literal covered read must flow through the reviewed resolver."""
    source_root = Path(__file__).resolve().parents[4] / "src/kfx"
    bypasses: list[str] = []

    for relative_path in _CONSUMERS:
        path = source_root / relative_path
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            argument = node.args[0]
            if not isinstance(argument, ast.Constant) or argument.value not in _POLICY_COVERED_NAMES:
                continue
            function = node.func
            is_getenv = (
                isinstance(function, ast.Attribute)
                and function.attr == "getenv"
                and isinstance(function.value, ast.Name)
                and function.value.id == "os"
            )
            is_environ_get = (
                isinstance(function, ast.Attribute)
                and function.attr == "get"
                and isinstance(function.value, ast.Attribute)
                and function.value.attr == "environ"
                and isinstance(function.value.value, ast.Name)
                and function.value.value.id == "os"
            )
            if is_getenv or is_environ_get:
                bypasses.append(f"{relative_path}:{node.lineno}:{argument.value}")

    assert bypasses == []


def test_reload_helpers_accept_legacy_only_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFLOW_HOST", "http://legacy-host/")
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert resolve_target(None) == "http://legacy-host"
        assert resolve_api_key(None) == "legacy-secret"  # pragma: allowlist secret

    assert [item.category for item in caught] == [BrandEnvLegacyWarning, BrandEnvLegacyWarning]


def test_reload_helpers_fail_closed_on_unequal_dual_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KETOS_HOST", "http://canonical")
    monkeypatch.setenv("LANGFLOW_HOST", "http://legacy")

    with pytest.raises(BrandEnvConflictError):
        resolve_target(None)


def test_common_api_key_accepts_legacy_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret

    with pytest.warns(BrandEnvLegacyWarning):
        assert get_api_key() == "legacy-secret"  # pragma: allowlist secret


def test_login_does_not_reread_already_resolved_legacy_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolution emits the diagnostic once; rendering must use origin metadata."""
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret
    client = MagicMock()
    client.list_flows.return_value = []
    sdk = MagicMock()
    sdk.Client.return_value = client
    sdk.KetosAuthError = type("KetosAuthError", (Exception,), {})
    sdk.KetosConnectionError = type("KetosConnectionError", (Exception,), {})
    sdk.KetosHTTPError = type("KetosHTTPError", (Exception,), {})
    resolved = SimpleNamespace(
        name="__env__",
        url="http://legacy:7860",
        api_key="legacy-secret",  # pragma: allowlist secret
    )

    with (
        patch("kfx.cli.login.load_sdk", return_value=sdk),
        patch("kfx.config.resolve_environment", return_value=resolved),
        warnings.catch_warnings(record=True) as caught,
    ):
        warnings.simplefilter("always")
        login_command(env=None, environments_file=None, target=None, api_key=None)

    assert not [item for item in caught if item.category is BrandEnvLegacyWarning]


def test_environment_fallback_accepts_both_legacy_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFLOW_URL", "http://legacy:7860")
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret
    monkeypatch.setattr(environments, "_find_config_file", lambda _override: None)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        resolved = environments.resolve_environment(None)

    assert resolved.url == "http://legacy:7860"
    assert resolved.api_key == "legacy-secret"  # pragma: allowlist secret
    assert [item.category for item in caught] == [BrandEnvLegacyWarning, BrandEnvLegacyWarning]


def test_upload_accepts_legacy_only_api_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    file_path = tmp_path / "payload.txt"
    file_path.write_text("payload", encoding="utf-8")
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret
    response = MagicMock(status_code=httpx.codes.CREATED)
    response.json.return_value = {"file_path": "flow/payload.txt"}

    with (
        pytest.warns(BrandEnvLegacyWarning),
        patch("kfx.load.utils.httpx.post", return_value=response) as post,
    ):
        upload(str(file_path), "http://host", "flow-id")

    assert post.call_args.kwargs["headers"] == {"x-api-key": "legacy-secret"}  # pragma: allowlist secret


def test_mcp_client_accepts_legacy_only_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFLOW_SERVER_URL", "http://legacy:7860/")
    monkeypatch.setenv("LANGFLOW_API_KEY", "legacy-secret")  # pragma: allowlist secret

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        client = KetosClient()

    assert client.server_url == "http://legacy:7860"
    assert client.api_key == "legacy-secret"  # pragma: allowlist secret
    assert [item.category for item in caught] == [BrandEnvLegacyWarning, BrandEnvLegacyWarning]


def test_dev_registry_accepts_legacy_only_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LANGFLOW_DEV_EXTENSIONS_DIR", "/tmp/legacy-extensions")

    with pytest.warns(BrandEnvLegacyWarning):
        assert _default_state_dir() == Path("/tmp/legacy-extensions")
