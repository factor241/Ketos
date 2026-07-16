# ruff: noqa: S101

from __future__ import annotations

import json
from pathlib import Path

import tomllib
import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_documents_cover_safe_project_and_reference_roots() -> None:
    config = tomllib.loads((ROOT / "config/raytsystem.toml").read_text(encoding="utf-8"))
    documents = config["documents"]

    assert documents["max_file_bytes"] == 5 * 1024 * 1024
    assert documents["max_total_bytes"] == 2 * 1024 * 1024 * 1024
    assert documents["allow_maintainer_docs_write"] is False

    roots = {item["id"]: item for item in documents["roots"]}
    assert roots == {
        "manual": {
            "id": "manual",
            "path": "knowledge/manual",
            "mode": "read_write",
            "kind": "notes",
        },
        "ketos-docs": {
            "id": "ketos-docs",
            "path": "docs",
            "mode": "read_only",
            "kind": "documentation",
        },
        "ketos-source": {
            "id": "ketos-source",
            "path": "src",
            "mode": "read_only",
            "kind": "software",
        },
        "langflow-reference": {
            "id": "langflow-reference",
            "path": "references/langflow-upstream",
            "mode": "read_only",
            "kind": "upstream-reference",
        },
        "raytsystem-docs": {
            "id": "raytsystem-docs",
            "path": "raytsystem/docs",
            "mode": "read_only",
            "kind": "documentation",
        },
    }


def test_unsupported_external_surfaces_remain_fail_closed() -> None:
    platform = yaml.safe_load((ROOT / "config/platform.yaml").read_text(encoding="utf-8"))
    features = platform["features"]

    assert features["external_mcp_execution_enabled"] is False
    assert features["external_notifications_enabled"] is False
    assert features["external_kms_enabled"] is False
    assert features["restricted_encryption_enabled"] is False
    assert features["a2a_network_exposure_enabled"] is False
    assert features["acp_adapter_enabled"] is False


def test_rayt_managed_claude_stays_disabled() -> None:
    config = tomllib.loads((ROOT / "config/raytsystem.toml").read_text(encoding="utf-8"))
    adapters = yaml.safe_load(
        (ROOT / "config/runtime-adapters.yaml").read_text(encoding="utf-8")
    )["adapters"]
    claude = next(item for item in adapters if item["adapter_id"] == "adapter_claude_code")

    assert config["features"]["claude_local_enabled"] is False
    assert claude["state"] == "disabled"
    assert claude["reason"] == "bare_auth_unavailable"


def test_codex_runtime_stays_disabled_until_os_denial_canary_passes() -> None:
    config = tomllib.loads((ROOT / "config/raytsystem.toml").read_text(encoding="utf-8"))
    adapters = yaml.safe_load(
        (ROOT / "config/runtime-adapters.yaml").read_text(encoding="utf-8")
    )["adapters"]
    codex = next(item for item in adapters if item["adapter_id"] == "adapter_codex_local")

    assert config["features"]["runtime_execution_enabled"] is False
    assert config["features"]["codex_local_enabled"] is False
    assert codex["state"] == "disabled"
    assert codex["version"] == "0.1.0-ketos-ephemeral"
    assert codex["reason"] == "codex_canary_os_denial_unobserved"


def test_documents_exclusion_manifest_records_every_policy_rule() -> None:
    manifest = json.loads(
        (ROOT / "ops/documents-exclusion-manifest.json").read_text(encoding="utf-8")
    )

    assert manifest["schema_version"] == "1.0.0"
    exclusions = {item["path_pattern"]: item["reason"] for item in manifest["exclusions"]}
    assert all(exclusions.values())
    for required in (
        "**/.git/**",
        "**/node_modules/**",
        "**/coverage/**",
        "**/test-results/**",
        "**/graphify-out/**",
        "**/assets/**",
        "**/_assets/**",
        "**/static/**",
        "**/*-wal",
        "**/.env*",
        "**/credentials.*",
        "**/secrets.*",
        "**/package-lock.json",
        "**/uv.lock",
    ):
        assert required in exclusions
