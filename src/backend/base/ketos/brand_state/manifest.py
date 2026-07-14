"""Deterministic, metadata-only migration manifests for brand state."""

# Dynamic validation errors preserve the failing field in strict-schema diagnostics.
# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from ketos.brand_state.model import (
    Sensitivity,
    StateKind,
    StateOperation,
    StateStatus,
)

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

    from ketos.brand_state.model import BrandStateEntry

MANIFEST_SCHEMA = "ketos.brand-state.migration-plan.v1"
_SHA256_LENGTH = 64
_TOP_LEVEL_FIELDS = frozenset({"schema", "transaction_id", "entries", "fingerprint_sha256"})
_ENTRY_FIELDS = frozenset(
    {
        "relative_id",
        "kind",
        "sensitivity",
        "status",
        "operation",
        "source",
        "destination",
        "size",
        "sha256",
        "destination_sha256",
        "reason",
    }
)


class ManifestValidationError(ValueError):
    """Raised when a manifest is malformed or its fingerprint is invalid."""


@dataclass(frozen=True)
class ManifestEntry:
    """Serializable migration metadata; it intentionally has no content field."""

    relative_id: str
    kind: StateKind
    sensitivity: Sensitivity
    status: StateStatus
    operation: StateOperation
    source: str | None
    destination: str | None
    size: int | None
    sha256: str | None
    destination_sha256: str | None
    reason: str | None


@dataclass(frozen=True)
class MigrationManifest:
    schema: str
    transaction_id: str
    entries: tuple[ManifestEntry, ...]
    fingerprint_sha256: str


def _canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _validate_transaction_id(value: str | UUID) -> str:
    candidate = str(value)
    try:
        parsed = UUID(candidate)
    except (AttributeError, ValueError) as exc:
        raise ManifestValidationError("transaction_id must be a canonical UUID") from exc
    canonical = str(parsed)
    if candidate != canonical:
        raise ManifestValidationError("transaction_id must be a canonical UUID")
    return canonical


def _validate_sha256(value: object, field: str, *, optional: bool = True) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str):
        raise ManifestValidationError(f"{field} must be a SHA256 string")
    if len(value) != _SHA256_LENGTH or any(character not in "0123456789abcdef" for character in value):
        raise ManifestValidationError(f"{field} must be a lowercase SHA256 digest")
    return value


def _entry_to_dict(entry: ManifestEntry) -> dict[str, object]:
    return {
        "relative_id": entry.relative_id,
        "kind": entry.kind.value,
        "sensitivity": entry.sensitivity.value,
        "status": entry.status.value,
        "operation": entry.operation.value,
        "source": entry.source,
        "destination": entry.destination,
        "size": entry.size,
        "sha256": entry.sha256,
        "destination_sha256": entry.destination_sha256,
        "reason": entry.reason,
    }


def _unsigned_payload(transaction_id: str, entries: tuple[ManifestEntry, ...]) -> dict[str, object]:
    return {
        "schema": MANIFEST_SCHEMA,
        "transaction_id": transaction_id,
        "entries": [_entry_to_dict(entry) for entry in entries],
    }


def _fingerprint(transaction_id: str, entries: tuple[ManifestEntry, ...]) -> str:
    payload = _canonical_json(_unsigned_payload(transaction_id, entries)).encode()
    return hashlib.sha256(payload).hexdigest()


def _path_metadata(value: os.PathLike[str] | str | None) -> str | None:
    return None if value is None else os.fspath(value)


def _from_state_entry(entry: BrandStateEntry) -> ManifestEntry:
    return ManifestEntry(
        relative_id=entry.relative_id,
        kind=entry.kind,
        sensitivity=entry.sensitivity,
        status=entry.status,
        operation=entry.operation,
        source=_path_metadata(entry.source),
        destination=_path_metadata(entry.destination),
        size=entry.size,
        sha256=_validate_sha256(entry.sha256, "sha256"),
        destination_sha256=_validate_sha256(entry.destination_sha256, "destination_sha256"),
        reason=entry.reason,
    )


def build_manifest(entries: Iterable[BrandStateEntry], *, transaction_id: str | UUID) -> MigrationManifest:
    """Normalize state-entry metadata into a stable, fingerprinted plan."""
    canonical_transaction_id = _validate_transaction_id(transaction_id)
    normalized = tuple(sorted((_from_state_entry(entry) for entry in entries), key=lambda item: item.relative_id))
    relative_ids = [entry.relative_id for entry in normalized]
    if len(relative_ids) != len(set(relative_ids)):
        raise ManifestValidationError("duplicate relative_id in manifest entries")
    if any(not relative_id for relative_id in relative_ids):
        raise ManifestValidationError("relative_id must be a non-empty string")
    return MigrationManifest(
        schema=MANIFEST_SCHEMA,
        transaction_id=canonical_transaction_id,
        entries=normalized,
        fingerprint_sha256=_fingerprint(canonical_transaction_id, normalized),
    )


def manifest_to_dict(manifest: MigrationManifest) -> dict[str, object]:
    return {
        **_unsigned_payload(manifest.transaction_id, manifest.entries),
        "fingerprint_sha256": manifest.fingerprint_sha256,
    }


def manifest_to_json(manifest: MigrationManifest) -> str:
    """Encode a manifest as canonical JSON with a final newline."""
    return f"{_canonical_json(manifest_to_dict(manifest))}\n"


def _require_exact_fields(payload: Mapping[str, object], expected: frozenset[str], context: str) -> None:
    actual = set(payload)
    missing = expected - actual
    unexpected = actual - expected
    if missing:
        raise ManifestValidationError(f"{context} missing fields: {', '.join(sorted(missing))}")
    if unexpected:
        raise ManifestValidationError(f"{context} unexpected fields: {', '.join(sorted(unexpected))}")


def _require_optional_string(value: object, field: str) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise ManifestValidationError(f"{field} must be a string or null")


def _parse_enum(enum_type: type[Any], value: object, field: str) -> Any:
    if not isinstance(value, str):
        raise ManifestValidationError(f"{field} must be a string")
    try:
        return enum_type(value)
    except ValueError as exc:
        raise ManifestValidationError(f"{field} has an unsupported value") from exc


def _parse_entry(value: object, index: int) -> ManifestEntry:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ManifestValidationError(f"entries[{index}] must be an object")
    _require_exact_fields(value, _ENTRY_FIELDS, f"entries[{index}]")
    relative_id = value["relative_id"]
    if not isinstance(relative_id, str) or not relative_id:
        raise ManifestValidationError(f"entries[{index}].relative_id must be non-empty")
    size = value["size"]
    if size is not None and (not isinstance(size, int) or isinstance(size, bool) or size < 0):
        raise ManifestValidationError(f"entries[{index}].size must be non-negative or null")
    return ManifestEntry(
        relative_id=relative_id,
        kind=_parse_enum(StateKind, value["kind"], f"entries[{index}].kind"),
        sensitivity=_parse_enum(Sensitivity, value["sensitivity"], f"entries[{index}].sensitivity"),
        status=_parse_enum(StateStatus, value["status"], f"entries[{index}].status"),
        operation=_parse_enum(StateOperation, value["operation"], f"entries[{index}].operation"),
        source=_require_optional_string(value["source"], f"entries[{index}].source"),
        destination=_require_optional_string(value["destination"], f"entries[{index}].destination"),
        size=size,
        sha256=_validate_sha256(value["sha256"], f"entries[{index}].sha256"),
        destination_sha256=_validate_sha256(value["destination_sha256"], f"entries[{index}].destination_sha256"),
        reason=_require_optional_string(value["reason"], f"entries[{index}].reason"),
    )


def parse_manifest_json(encoded: str | bytes) -> MigrationManifest:
    """Parse strict JSON and verify its metadata fingerprint."""
    try:
        payload = json.loads(encoded)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as exc:
        raise ManifestValidationError("manifest must be valid UTF-8 JSON") from exc
    if not isinstance(payload, dict) or not all(isinstance(key, str) for key in payload):
        raise ManifestValidationError("manifest must be a JSON object")
    _require_exact_fields(payload, _TOP_LEVEL_FIELDS, "manifest")
    if payload["schema"] != MANIFEST_SCHEMA:
        raise ManifestValidationError("manifest schema is unsupported")
    transaction_id_value = payload["transaction_id"]
    if not isinstance(transaction_id_value, str):
        raise ManifestValidationError("transaction_id must be a canonical UUID")
    transaction_id = _validate_transaction_id(transaction_id_value)
    raw_entries = payload["entries"]
    if not isinstance(raw_entries, list):
        raise ManifestValidationError("entries must be an array")
    entries = tuple(_parse_entry(entry, index) for index, entry in enumerate(raw_entries))
    relative_ids = [entry.relative_id for entry in entries]
    if relative_ids != sorted(relative_ids):
        raise ManifestValidationError("entries must be sorted by relative_id")
    if len(relative_ids) != len(set(relative_ids)):
        raise ManifestValidationError("duplicate relative_id in manifest entries")
    fingerprint = _validate_sha256(payload["fingerprint_sha256"], "fingerprint_sha256", optional=False)
    expected = _fingerprint(transaction_id, entries)
    if fingerprint != expected:
        raise ManifestValidationError("manifest fingerprint does not match metadata")
    return MigrationManifest(
        schema=MANIFEST_SCHEMA,
        transaction_id=transaction_id,
        entries=entries,
        fingerprint_sha256=fingerprint,
    )


__all__ = [
    "MANIFEST_SCHEMA",
    "ManifestEntry",
    "ManifestValidationError",
    "MigrationManifest",
    "build_manifest",
    "manifest_to_dict",
    "manifest_to_json",
    "parse_manifest_json",
]
