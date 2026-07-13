"""Destructive-cutover contracts for the canonical Ketos extension ecosystem."""

from __future__ import annotations

import json
import os
from pathlib import Path

import jsonschema
import pytest
from kfx.extension.manifest import EXTENSION_SCHEMA_URL, ExtensionManifest
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[5]
BUNDLE_ROOT = REPO_ROOT / "src" / "bundles"
KFX_EXTENSION_ROOT = REPO_ROOT / "src" / "kfx" / "src" / "kfx" / "extension"
PUBLIC_BUNDLE_API = REPO_ROOT / "BUNDLE_API.md"
EXTENSIONS_HTTP_API = REPO_ROOT / "src" / "backend" / "base" / "ketos" / "api" / "v1" / "extensions.py"
SOURCE_SUFFIXES = {".js", ".jsx", ".py", ".ts", ".tsx"}
SOURCE_SCAN_EXCLUDED_DIRS = {
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
}
ACTIVE_EXTENSION_MIGRATION_SCAN_PATHS = (
    PUBLIC_BUNDLE_API,
    EXTENSIONS_HTTP_API,
    *sorted(BUNDLE_ROOT.rglob("*.md")),
    *sorted(KFX_EXTENSION_ROOT.rglob("*.py")),
)
ACTIVE_EXTENSION_MIGRATION_WORDING_ALLOWLIST = {
    BUNDLE_ROOT / "NIGHTLY.md": {"db-migration-validation.yml"},
}

_VALID_MANIFEST = {
    "$schema": EXTENSION_SCHEMA_URL,
    "id": "kfx-current",
    "version": "0.1.1",
    "name": "Current Bundle",
    "kfx": {"compat": ["1"]},
    "bundles": [{"name": "current", "path": "components"}],
}


@pytest.mark.parametrize(
    "schema_url",
    [
        "https://schemas.ketos.test/extension/v0.json",
        "https://schemas.ketos.test/extension/v2.json",
        "https://example.test/extension/v1.json",
        "extension-schema.json",
        "",
    ],
)
def test_manifest_rejects_every_noncanonical_schema_url(schema_url: str) -> None:
    with pytest.raises(ValidationError):
        ExtensionManifest.model_validate({**_VALID_MANIFEST, "$schema": schema_url})


def test_manifest_accepts_the_exact_canonical_schema_url() -> None:
    manifest = ExtensionManifest.model_validate(_VALID_MANIFEST)
    assert manifest.schema_field == EXTENSION_SCHEMA_URL


@pytest.mark.parametrize(
    "schema_url",
    [
        "https://schemas.ketos.test/extension/v0.json",
        "https://example.test/extension/v1.json",
    ],
)
def test_published_schema_rejects_noncanonical_manifest_schema_url(schema_url: str) -> None:
    from kfx.extension.schema import build_schema

    validator = jsonschema.Draft202012Validator(build_schema())
    with pytest.raises(jsonschema.ValidationError):
        validator.validate({**_VALID_MANIFEST, "$schema": schema_url})


def test_migration_runtime_and_graph_hook_are_absent() -> None:
    assert not list((KFX_EXTENSION_ROOT / "migration").glob("*.py"))
    assert not (KFX_EXTENSION_ROOT / "migration" / "migration_table.json").exists()

    graph_source = (REPO_ROOT / "src" / "kfx" / "src" / "kfx" / "graph" / "graph" / "base.py").read_text(
        encoding="utf-8"
    )
    assert "migrate_flow_payload" not in graph_source
    assert "flow_" + "migrated" not in graph_source


def test_removed_flow_migration_event_is_absent_from_source_and_tests() -> None:
    removed_event = "flow_" + "migrated"
    offenders: list[str] = []
    for root, directory_names, file_names in os.walk(REPO_ROOT / "src"):
        directory_names[:] = sorted(name for name in directory_names if name not in SOURCE_SCAN_EXCLUDED_DIRS)
        for file_name in sorted(file_names):
            path = Path(root) / file_name
            if path.suffix in SOURCE_SUFFIXES and removed_event in path.read_text(encoding="utf-8"):
                offenders.append(path.relative_to(REPO_ROOT).as_posix())

    assert offenders == []


def test_public_contract_has_no_removed_flow_migration_surface() -> None:
    contract_sources = {
        PUBLIC_BUNDLE_API: PUBLIC_BUNDLE_API.read_text(encoding="utf-8"),
        EXTENSIONS_HTTP_API: EXTENSIONS_HTTP_API.read_text(encoding="utf-8"),
    }
    removed_markers = {
        "MigrationTable",
        "migrate_flow_payload",
        "migration_table.json",
        "flow_" + "migrated",
        "flow-migration",
    }

    offenders = {
        path.relative_to(REPO_ROOT).as_posix(): sorted(marker for marker in removed_markers if marker in source)
        for path, source in contract_sources.items()
        if any(marker in source for marker in removed_markers)
    }

    assert offenders == {}


def test_active_extension_contract_has_no_migration_acceptance_wording() -> None:
    offenders = {
        path.relative_to(REPO_ROOT).as_posix(): [
            f"{line_number}:{line.strip()}"
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
            if "migrat" in line.casefold()
            and not any(
                protected_term in line
                for protected_term in ACTIVE_EXTENSION_MIGRATION_WORDING_ALLOWLIST.get(path, set())
            )
        ]
        for path in ACTIVE_EXTENSION_MIGRATION_SCAN_PATHS
    }

    assert {path: hits for path, hits in offenders.items() if hits} == {}


def test_extension_facade_has_no_migration_or_component_compatibility_bridge() -> None:
    from kfx import extension

    removed_names = {
        "MIGRATION_SCHEMA_VERSION",
        "MIGRATION_TABLE_PATH",
        "MigrationEntry",
        "MigrationReport",
        "MigrationTable",
        "NodeRewriteRecord",
        "load_migration_table",
        "migrate_flow_payload",
        "filter_component_entry_points",
        "filter_plugin_entry_points",
    }
    assert removed_names.isdisjoint(dir(extension))


@pytest.mark.parametrize("bundle", ["arxiv", "docling", "duckduckgo", "ibm"])
def test_bundle_manifest_version_matches_distribution(bundle: str) -> None:
    import tomllib

    project_root = BUNDLE_ROOT / bundle
    pyproject = tomllib.loads((project_root / "pyproject.toml").read_text(encoding="utf-8"))
    package_name = pyproject["project"]["name"].replace("-", "_")
    manifest = json.loads((project_root / "src" / package_name / "extension.json").read_text(encoding="utf-8"))

    assert pyproject["project"]["version"] == "0.1.1"
    assert manifest["version"] == pyproject["project"]["version"]
    assert manifest["$schema"] == EXTENSION_SCHEMA_URL


def test_published_v1_schema_describes_v1() -> None:
    from kfx.extension.schema import build_schema

    schema = build_schema()
    assert "v1" in schema["title"]
    assert "v1" in schema["description"]
    assert "v0" not in schema["description"]
