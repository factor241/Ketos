# ruff: noqa: INP001, TC003 -- integration owns package initializers; Path annotates tests.

from __future__ import annotations

import importlib
import json
from pathlib import Path
from uuid import UUID

import pytest
from ketos.brand_state.model import (
    BrandStateEntry,
    Sensitivity,
    StateKind,
    StateOperation,
    StateStatus,
)

TRANSACTION_ID = "12345678-1234-4678-9234-567812345678"


def _manifest_module():
    try:
        return importlib.import_module("ketos.brand_state.manifest")
    except ModuleNotFoundError as exc:
        pytest.fail(f"manifest implementation is missing: {exc}")


def _entry(
    relative_id: str,
    *,
    source: Path | None = None,
    destination: Path | None = None,
    sha256: str | None = None,
    reason: str | None = None,
) -> BrandStateEntry:
    return BrandStateEntry(
        relative_id=relative_id,
        kind=StateKind.CONFIG,
        sensitivity=Sensitivity.SECRET,
        status=StateStatus.LEGACY_ONLY,
        source=source,
        destination=destination,
        size=17,
        sha256=sha256 or ("a" * 64),
        destination_sha256=None,
        reason=reason,
        operation=StateOperation.COPY,
    )


def test_build_manifest_is_deterministic_sorted_and_redacted(tmp_path: Path) -> None:
    manifest = _manifest_module()
    secret = "postgresql://admin:super-secret@db.example/ketos"  # noqa: S105
    env_name = "LANGFLOW_DATABASE_URL"
    source = tmp_path / "state" / "credentials.json"
    source.parent.mkdir()
    source.write_text(f"{env_name}={secret}", encoding="utf-8")

    entries = (
        _entry("z/state.json", source=source, destination=tmp_path / "new-z"),
        _entry("a/state.json", source=source, destination=tmp_path / "new-a"),
    )
    first = manifest.build_manifest(entries, transaction_id=TRANSACTION_ID)
    second = manifest.build_manifest(reversed(entries), transaction_id=UUID(TRANSACTION_ID))
    first_json = manifest.manifest_to_json(first)

    assert [entry.relative_id for entry in first.entries] == [
        "a/state.json",
        "z/state.json",
    ]
    assert first == second
    assert first_json == manifest.manifest_to_json(second)
    assert first_json.endswith("\n")
    assert secret not in first_json
    assert env_name not in first_json
    assert source.read_text(encoding="utf-8") not in first_json
    assert len(first.fingerprint_sha256) == 64
    assert set(first.fingerprint_sha256) <= set("0123456789abcdef")


def test_manifest_round_trip_uses_strict_schema() -> None:
    manifest = _manifest_module()
    built = manifest.build_manifest((_entry("state/config.json"),), transaction_id=TRANSACTION_ID)

    encoded = manifest.manifest_to_json(built)
    decoded = manifest.parse_manifest_json(encoded)

    assert decoded == built
    assert json.loads(encoded)["schema"] == manifest.MANIFEST_SCHEMA

    with_extra = json.loads(encoded)
    with_extra["unexpected"] = True
    with pytest.raises(manifest.ManifestValidationError, match="unexpected"):
        manifest.parse_manifest_json(json.dumps(with_extra))

    missing = json.loads(encoded)
    del missing["transaction_id"]
    with pytest.raises(manifest.ManifestValidationError, match="transaction_id"):
        manifest.parse_manifest_json(json.dumps(missing))


def test_manifest_rejects_tampering_and_invalid_transaction_ids() -> None:
    manifest = _manifest_module()
    built = manifest.build_manifest((_entry("state/config.json"),), transaction_id=TRANSACTION_ID)
    payload = json.loads(manifest.manifest_to_json(built))
    payload["entries"][0]["size"] = 999

    with pytest.raises(manifest.ManifestValidationError, match="fingerprint"):
        manifest.parse_manifest_json(json.dumps(payload))

    for invalid in (
        "not-a-uuid",
        "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
        "12345678123446789234567812345678",
    ):
        with pytest.raises(manifest.ManifestValidationError, match="transaction_id"):
            manifest.build_manifest((), transaction_id=invalid)


def test_manifest_rejects_duplicate_ids_and_unexpected_entry_fields() -> None:
    manifest = _manifest_module()
    duplicate = _entry("state/config.json")

    with pytest.raises(manifest.ManifestValidationError, match="duplicate"):
        manifest.build_manifest((duplicate, duplicate), transaction_id=TRANSACTION_ID)

    built = manifest.build_manifest((duplicate,), transaction_id=TRANSACTION_ID)
    payload = json.loads(manifest.manifest_to_json(built))
    payload["entries"][0]["content"] = "should never be serialized"

    with pytest.raises(manifest.ManifestValidationError, match="content"):
        manifest.parse_manifest_json(json.dumps(payload))


def test_fingerprint_changes_when_metadata_changes() -> None:
    manifest = _manifest_module()

    first = manifest.build_manifest(
        (_entry("state/config.json", reason="first"),),
        transaction_id=TRANSACTION_ID,
    )
    second = manifest.build_manifest(
        (_entry("state/config.json", reason="second"),),
        transaction_id=TRANSACTION_ID,
    )

    assert first.fingerprint_sha256 != second.fingerprint_sha256
