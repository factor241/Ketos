# ruff: noqa: S101, S603, S607

from __future__ import annotations

import importlib
import sys
import zipfile
from pathlib import Path

import tomllib

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
PACKAGE_ROOT = REPOSITORY_ROOT / "src" / "compat" / "langflow-sdk"
PACKAGE_SOURCE = PACKAGE_ROOT / "src"
CANONICAL_SOURCE = REPOSITORY_ROOT / "src" / "sdk" / "src"


def _forget_sdk_modules() -> None:
    for name in tuple(sys.modules):
        if name == "langflow_sdk" or name.startswith("langflow_sdk."):
            sys.modules.pop(name)


def test_distribution_is_thin_and_has_no_second_pytest_plugin() -> None:
    project = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]

    assert project["name"] == "langflow-sdk"
    assert project["version"] == "0.2.2"
    assert project["dependencies"] == ["ketos-sdk==0.2.2"]
    assert "entry-points" not in project


def test_legacy_client_names_are_canonical_objects(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_sdk_modules()

    legacy = importlib.import_module("langflow_sdk")
    canonical = importlib.import_module("ketos_sdk")
    legacy_client = importlib.import_module("langflow_sdk.client")
    legacy_async = importlib.import_module("langflow_sdk._async_client")

    assert legacy.Client is canonical.KetosClient
    assert legacy.LangflowClient is canonical.KetosClient
    assert legacy.AsyncClient is canonical.AsyncKetosClient
    assert legacy.AsyncLangflowClient is canonical.AsyncKetosClient
    assert legacy_client.Client is canonical.KetosClient
    assert legacy_client.LangflowClient is canonical.KetosClient
    assert legacy_async.AsyncClient is canonical.AsyncKetosClient
    assert legacy_async.AsyncLangflowClient is canonical.AsyncKetosClient


def test_legacy_exception_names_are_canonical_objects(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_sdk_modules()

    legacy = importlib.import_module("langflow_sdk")
    legacy_exceptions = importlib.import_module("langflow_sdk.exceptions")
    canonical_exceptions = importlib.import_module("ketos_sdk.exceptions")
    expected = {
        "LangflowError": "KetosError",
        "LangflowHTTPError": "KetosHTTPError",
        "LangflowNotFoundError": "KetosNotFoundError",
        "LangflowAuthError": "KetosAuthError",
        "LangflowValidationError": "KetosValidationError",
        "LangflowConnectionError": "KetosConnectionError",
        "LangflowTimeoutError": "KetosTimeoutError",
        "EnvironmentNotFoundError": "KetosEnvironmentNotFoundError",
        "EnvironmentConfigError": "KetosEnvironmentConfigError",
    }

    for legacy_name, canonical_name in expected.items():
        canonical_object = getattr(canonical_exceptions, canonical_name)
        assert getattr(legacy, legacy_name) is canonical_object
        assert getattr(legacy_exceptions, legacy_name) is canonical_object


def test_unchanged_deep_modules_are_identity_aliases(monkeypatch) -> None:
    monkeypatch.syspath_prepend(str(CANONICAL_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    _forget_sdk_modules()

    for suffix in ("models", "serialization", "background_job", "environments", "testing"):
        legacy = importlib.import_module(f"langflow_sdk.{suffix}")
        canonical = importlib.import_module(f"ketos_sdk.{suffix}")
        assert legacy is canonical


def test_wheel_owns_only_the_legacy_namespace(tmp_path: Path) -> None:
    import subprocess

    subprocess.run(
        ["uv", "build", "--project", str(PACKAGE_ROOT), "--wheel", "--out-dir", str(tmp_path)],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    wheel = next(tmp_path.glob("langflow_sdk-0.2.2-*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()

    assert any(name.startswith("langflow_sdk/") for name in names)
    assert not any(name.startswith("ketos_sdk/") for name in names)
