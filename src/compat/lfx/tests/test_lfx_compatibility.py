# ruff: noqa: S101, S603, S607

from __future__ import annotations

import hashlib
import importlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
import tomli

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
PACKAGE_ROOT = REPOSITORY_ROOT / "src" / "compat" / "lfx"
PACKAGE_SOURCE = PACKAGE_ROOT / "src"
KFX_SOURCE = REPOSITORY_ROOT / "src" / "kfx" / "src"
FROZEN_SOURCE_COMMIT = "87a5206ae925b1fb88f8ecc6bc248316128b64ee"
MIGRATION_MODULE_PAIRS = (
    ("lfx.extension.migration", "kfx.extension.migration"),
    ("lfx.extension.migration.loader", "kfx.extension.migration.loader"),
    ("lfx.extension.migration.rewrite", "kfx.extension.migration.rewrite"),
    ("lfx.extension.migration.schema", "kfx.extension.migration.schema"),
)
FROZEN_MODULE_COUNT = 974
SOURCE_PYTHON_FILE_COUNT = 975
MAX_RAW_LEGACY_TOKEN_COUNT = 3


def _module_name(path: str, source_prefix: str) -> str:
    relative = path.removeprefix(source_prefix)
    relative = relative[: -len("/__init__.py")] if relative.endswith("/__init__.py") else relative.removesuffix(".py")
    return relative.replace("/", ".")


def _frozen_lfx_modules() -> list[str]:
    completed = subprocess.run(
        [
            "git",
            "ls-tree",
            "-r",
            "--name-only",
            FROZEN_SOURCE_COMMIT,
            "src/lfx/src/lfx",
        ],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return sorted(
        {_module_name(path, "src/lfx/src/") for path in completed.stdout.splitlines() if path.endswith(".py")}
    )


def _current_kfx_modules() -> set[str]:
    return {
        _module_name(path.relative_to(REPOSITORY_ROOT).as_posix(), "src/kfx/src/")
        for path in (KFX_SOURCE / "kfx").rglob("*.py")
    }


def _load_manifest() -> dict:
    manifest_path = PACKAGE_SOURCE / "lfx_compat" / "module-map-v1.json"
    assert manifest_path.is_file(), "the versioned compatibility module map is missing"
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _expanded_entries(manifest: dict) -> list[dict[str, str]]:
    expanded = []
    for entry in manifest["modules"]:
        item = {
            "legacy": manifest["legacy_prefix"] + entry["suffix"],
            "canonical": manifest["canonical_prefix"] + entry.get("target_suffix", entry["suffix"]),
            "status": entry["status"],
        }
        if "reason" in entry:
            item["reason"] = entry["reason"]
        expanded.append(item)
    return expanded


def test_distribution_is_thin_and_delegates_both_clis() -> None:
    pyproject_path = PACKAGE_ROOT / "pyproject.toml"
    assert pyproject_path.is_file(), "the lfx compatibility distribution is missing"
    project = tomli.loads(pyproject_path.read_text(encoding="utf-8"))["project"]

    assert project["name"] == "lfx"
    assert project["version"] == "1.10.2"
    assert project["license"] == "MIT"
    assert project["dependencies"] == ["kfx==1.10.2", "langflow-sdk==0.2.2"]
    assert project["scripts"] == {
        "lfx": "kfx.__main__:main",
        "lfx-mcp": "kfx.mcp.__main__:main",
    }
    assert "entry-points" not in project, "lfx must not register a second pytest11 plugin"


def test_module_map_is_the_complete_frozen_pre_cutover_inventory() -> None:
    manifest = _load_manifest()
    entries = _expanded_entries(manifest)
    legacy_modules = [entry["legacy"] for entry in entries]
    frozen_modules = _frozen_lfx_modules()

    assert manifest["schema_version"] == 1
    assert manifest["compatibility_version"] == "1.10.2"
    assert manifest["source_commit"] == FROZEN_SOURCE_COMMIT
    assert legacy_modules == frozen_modules
    assert len(legacy_modules) == FROZEN_MODULE_COUNT
    assert manifest["source_python_files"] == SOURCE_PYTHON_FILE_COUNT
    assert manifest["logical_modules"] == FROZEN_MODULE_COUNT
    assert manifest["source_root"] == "src/lfx/src/lfx"
    assert manifest["path_collisions"] == [
        {
            "module_suffix": ".type_extraction",
            "paths": [
                "type_extraction.py",
                "type_extraction/__init__.py",
            ],
        }
    ]
    assert manifest["legacy_modules_sha256"] == hashlib.sha256(("\n".join(frozen_modules) + "\n").encode()).hexdigest()
    assert json.dumps(manifest, sort_keys=True).count("lfx") <= MAX_RAW_LEGACY_TOKEN_COUNT


def test_module_map_reports_every_frozen_target_as_available() -> None:
    entries = _expanded_entries(_load_manifest())
    current_modules = _current_kfx_modules()
    blocked = {entry["legacy"] for entry in entries if entry["status"] == "blocked"}

    assert blocked == set()
    for entry in entries:
        assert entry["status"] == "available"
        assert entry["canonical"] in current_modules
        assert "reason" not in entry


def test_module_map_records_the_explicit_utility_rename() -> None:
    by_legacy = {entry["legacy"]: entry for entry in _expanded_entries(_load_manifest())}

    assert by_legacy["lfx.utils.langflow_utils"] == {
        "legacy": "lfx.utils.langflow_utils",
        "canonical": "kfx.utils.ketos_utils",
        "status": "available",
    }


def test_lazy_alias_loader_returns_canonical_module_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    assert (PACKAGE_SOURCE / "lfx" / "__init__.py").is_file(), "the lazy alias loader is missing"
    monkeypatch.syspath_prepend(str(KFX_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    for name in [name for name in sys.modules if name == "lfx" or name.startswith("lfx.")]:
        sys.modules.pop(name)

    legacy_root = importlib.import_module("lfx")
    canonical_root = importlib.import_module("kfx")
    legacy_custom = importlib.import_module("lfx.custom")
    canonical_custom = importlib.import_module("kfx.custom")
    legacy_renamed = importlib.import_module("lfx.utils.langflow_utils")
    canonical_renamed = importlib.import_module("kfx.utils.ketos_utils")

    assert legacy_root is canonical_root
    assert legacy_custom is canonical_custom
    assert legacy_renamed is canonical_renamed
    assert legacy_custom.Component is canonical_custom.Component
    assert legacy_renamed.__spec__ is not None
    assert legacy_renamed.__spec__.name == "kfx.utils.ketos_utils"
    assert legacy_renamed.__loader__ is canonical_renamed.__loader__
    assert importlib.reload(legacy_renamed) is canonical_renamed
    assert legacy_renamed.__spec__ is not None
    assert legacy_renamed.__spec__.name == "kfx.utils.ketos_utils"


@pytest.mark.parametrize(("legacy_name", "canonical_name"), MIGRATION_MODULE_PAIRS)
def test_migration_aliases_are_the_canonical_module_objects(
    monkeypatch: pytest.MonkeyPatch,
    legacy_name: str,
    canonical_name: str,
) -> None:
    assert (PACKAGE_SOURCE / "lfx" / "__init__.py").is_file(), "the lazy alias loader is missing"
    monkeypatch.syspath_prepend(str(KFX_SOURCE))
    monkeypatch.syspath_prepend(str(PACKAGE_SOURCE))
    for name in [name for name in sys.modules if name == "lfx" or name.startswith("lfx.")]:
        sys.modules.pop(name)

    legacy_module = importlib.import_module(legacy_name)
    canonical_module = importlib.import_module(canonical_name)

    assert legacy_module is canonical_module
    assert legacy_module.__spec__ is not None
    assert legacy_module.__spec__.name == canonical_name
    assert legacy_module.__loader__ is canonical_module.__loader__
