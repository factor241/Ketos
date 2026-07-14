"""Compatibility-first contracts for the canonical extension migration runtime."""

from __future__ import annotations

import importlib
from pathlib import Path

from kfx.extension.migration import (
    MIGRATION_SCHEMA_VERSION,
    MIGRATION_TABLE_PATH,
    MigrationEntry,
    MigrationTable,
    load_migration_table,
    migrate_flow_payload,
)


def _payload(type_value: str) -> dict:
    return {
        "data": {
            "nodes": [
                {
                    "id": "legacy-1",
                    "type": "genericNode",
                    "data": {"id": "legacy-1", "type": type_value, "node": {"template": {}}},
                }
            ],
            "edges": [],
        }
    }


def test_all_versioned_migration_modules_are_importable() -> None:
    modules = [
        "kfx.extension.migration",
        "kfx.extension.migration.loader",
        "kfx.extension.migration.rewrite",
        "kfx.extension.migration.schema",
    ]

    assert [importlib.import_module(name).__name__ for name in modules] == modules


def test_canonical_v1_table_is_vendored_and_loadable() -> None:
    table, error = load_migration_table()

    assert error is None
    assert table is not None
    assert MIGRATION_SCHEMA_VERSION == 1
    assert table.schema_version == MIGRATION_SCHEMA_VERSION
    assert Path(MIGRATION_TABLE_PATH).is_file()
    assert table.entries


def test_rewrite_preserves_persisted_node_identity_while_rewriting_type() -> None:
    table = MigrationTable(
        schema_version=1,
        entries=[
            MigrationEntry(
                import_path="ketos.components.openai.OpenAIEmbeddings",
                target="ext:openai:OpenAIEmbeddings@official",
                added_in="compat-release",
            )
        ],
    )
    payload = _payload("ketos.components.openai.OpenAIEmbeddings")

    report = migrate_flow_payload(payload, table=table)

    [node] = payload["data"]["nodes"]
    assert node["id"] == "legacy-1"
    assert node["data"]["id"] == "legacy-1"
    assert node["data"]["type"] == "ext:openai:OpenAIEmbeddings@official"
    assert report.rewritten_count == 1
    assert report.records[0].legacy_form_kind == "import_path"


def test_current_canonical_slot_is_idempotent() -> None:
    table = MigrationTable(schema_version=1, entries=[])
    payload = _payload("ext:openai:OpenAIEmbeddings@official")

    first = migrate_flow_payload(payload, table=table)
    second = migrate_flow_payload(payload, table=table)

    assert first.rewritten_count == 0
    assert second.rewritten_count == 0
    assert payload["data"]["nodes"][0]["data"]["type"] == "ext:openai:OpenAIEmbeddings@official"
