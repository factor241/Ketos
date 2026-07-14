"""Destructive-cutover contracts for the canonical Ketos extension ecosystem."""

from __future__ import annotations

import json
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


def test_migration_runtime_is_available_without_enabling_the_graph_hook() -> None:
    from kfx.extension.migration import load_migration_table, migrate_flow_payload

    table, error = load_migration_table()

    assert error is None
    assert table is not None
    assert table.schema_version == 1
    assert callable(migrate_flow_payload)
    assert (KFX_EXTENSION_ROOT / "migration" / "migration_table.json").is_file()

    graph_source = (REPO_ROOT / "src" / "kfx" / "src" / "kfx" / "graph" / "graph" / "base.py").read_text(
        encoding="utf-8"
    )
    assert "migrate_flow_payload" not in graph_source
    assert "flow_" + "migrated" not in graph_source


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


def test_migration_table_targets_only_canonical_extension_slots() -> None:
    from kfx.extension.migration import load_migration_table

    table, error = load_migration_table()

    assert error is None
    assert table is not None
    assert all(entry.target.startswith("ext:") for entry in table.entries)
    assert all(entry.target.endswith(("@official", "@extra")) for entry in table.entries)


def test_extension_facade_exports_the_versioned_migration_bridge() -> None:
    from kfx import extension

    migration_names = {
        "MIGRATION_SCHEMA_VERSION",
        "MIGRATION_TABLE_PATH",
        "MigrationEntry",
        "MigrationReport",
        "MigrationTable",
        "NodeRewriteRecord",
        "load_migration_table",
        "migrate_flow_payload",
    }
    assert migration_names <= set(dir(extension))
    assert all(getattr(extension, name) is not None for name in migration_names)


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
