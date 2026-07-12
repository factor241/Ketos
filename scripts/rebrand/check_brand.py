#!/usr/bin/env python3
"""Validate Ketos brand contracts and scan Git-tracked files for legacy residue.

The scanner intentionally treats ``git ls-files`` as its scope boundary.  Build
output, caches, virtual environments, and other untracked content must never
change a release-gate result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

import yaml

BRAND_CONTRACT_FIELDS = (
    "product_name",
    "product_slug",
    "executor_name",
    "executor_distribution",
    "python_distribution",
    "python_base_distribution",
    "sdk_distribution",
    "stepflow_distribution",
    "python_namespace",
    "sdk_namespace",
    "stepflow_namespace",
    "env_prefix",
    "site_url",
    "docs_url",
    "repository_url",
    "issues_url",
    "support_url",
    "container_registry_namespace",
    "package_publisher_identity",
    "social_links",
    "telemetry_url",
    "store_url",
    "schema_base_url",
    "legal_entity",
    "copyright_holder",
    "trademark_owner",
    "security_contact",
    "vulnerability_report_url",
    "moderation_contact",
    "privacy_policy_url",
    "data_controller",
    "analytics_owner",
    "analytics_properties",
    "search_owner",
    "chat_widget_owner",
    "signing_identity",
    "logo_source_sha256",
    "logo_rights_approved_by",
    "logo_rights_approved_date",
    "wordmark_font_license",
)

LEGACY_CATEGORIES = (
    "import_alias",
    "env_alias",
    "data_path",
    "historical_migration",
    "historical_fixture",
    "wire_protocol",
    "external_resource_id",
    "legal_provenance",
)

LEGACY_RESIDUE_FIELDS = (
    "path",
    "match",
    "category",
    "owner",
    "reason",
    "compatibility_test",
    "removal_condition",
)

BASELINE_FIELDS = (
    "commit",
    "brand_file_count",
    "brand_line_count",
    "brand_path_count",
    "official_url_file_count",
    "env_tokens",
    "paths",
)

URL_FIELDS = (
    "site_url",
    "docs_url",
    "repository_url",
    "issues_url",
    "support_url",
    "telemetry_url",
    "store_url",
    "schema_base_url",
    "vulnerability_report_url",
    "privacy_policy_url",
)

_BRAND_RE = re.compile(r"lang[-_]?flow", re.IGNORECASE)
_ENV_RE = re.compile(r"\bLANGFLOW_[A-Z0-9_]+\b")
_OFFICIAL_URL_RE = re.compile(
    r"(?:"
    r"https?://(?:[a-z0-9-]+\.)*langflow\.org(?:[/:?#]|$)|"
    r"https?://(?:[a-z0-9-]+\.)*langflow\.store(?:[/:?#]|$)|"
    r"https?://docs\.langflow\.org(?:[/:?#]|$)|"
    r"https?://github\.com/langflow-ai(?:/|$)|"
    r"https?://(?:www\.)?(?:x|twitter)\.com/langflow(?:_ai)?(?:[/?#]|$)|"
    r"https?://(?:www\.)?youtube\.com/@?langflow(?:[/?#]|$)|"
    r"https?://(?:www\.)?discord\.(?:gg|com/invite)/EqksyE2EX9(?=[/?#\s\"'<>]|$)|"
    r"https?://api\.scarf\.sh/v1/pixel(?=[/?#\s\"'<>]|$)"
    r")",
    re.IGNORECASE,
)
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_PLACEHOLDER_PARTS = ("placeholder", "example.com", "example.org", "example.net", "localhost", "127.0.0.1")

CANONICAL_BRAND_VALUES: dict[str, object] = {
    "product_name": "Ketos",
    "product_slug": "ketos",
    "executor_name": None,
    "executor_distribution": None,
    "python_distribution": "ketos",
    "python_base_distribution": "ketos-base",
    "sdk_distribution": "ketos-sdk",
    "stepflow_distribution": "ketos-stepflow",
    "python_namespace": "ketos",
    "sdk_namespace": "ketos_sdk",
    "stepflow_namespace": "ketos_stepflow",
    "env_prefix": "KETOS_",
}

MIGRATION_DEBT_KINDS = ("user_visible", "official_url", "filename")
DEBT_METADATA_FIELDS = ("owner", "reason", "compatibility_test", "removal_condition")
MIGRATION_DEBT_GROUP_FIELDS = (*DEBT_METADATA_FIELDS, "occurrences")
PROFILES = ("stage0", "final", "release")

MIGRATION_DEBT_METADATA = {
    "user_visible": {
        "owner": "product-rebrand",
        "reason": "Frozen user-visible Langflow references pending product-copy migration.",
        "compatibility_test": "scripts/rebrand/tests/test_stage0_architecture.py",
        "removal_condition": "Remove after every frozen user-visible reference is migrated to Ketos.",
    },
    "official_url": {
        "owner": "integration-rebrand",
        "reason": "Frozen upstream-owned URLs pending endpoint migration or explicit removal.",
        "compatibility_test": "scripts/rebrand/tests/test_stage0_architecture.py",
        "removal_condition": "Remove after every frozen upstream URL is replaced or retired.",
    },
    "filename": {
        "owner": "package-rebrand",
        "reason": "Frozen Langflow filenames pending compatibility-safe path migration.",
        "compatibility_test": "scripts/rebrand/tests/test_stage0_architecture.py",
        "removal_condition": "Remove after every frozen filename is migrated with compatibility preserved.",
    },
}

TECHNICAL_DEBT_METADATA = {
    "import_alias": ("package-compatibility", "Historical Python import compatibility."),
    "env_alias": ("settings-compatibility", "Historical environment-variable compatibility."),
    "data_path": ("storage-compatibility", "Historical persisted-path compatibility."),
    "historical_migration": ("database-migrations", "Immutable historical migration provenance."),
    "historical_fixture": ("test-fixtures", "Historical compatibility fixture provenance."),
    "wire_protocol": ("protocol-compatibility", "Historical wire-protocol compatibility."),
    "external_resource_id": ("external-integrations", "Historical external resource identity."),
    "legal_provenance": ("legal-review", "Historical legal provenance requiring explicit review."),
}
TECHNICAL_DEBT_GROUP_FIELDS = (*DEBT_METADATA_FIELDS, "occurrences")


class _UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loader which rejects duplicate mapping keys."""


def _construct_unique_mapping(
    loader: _UniqueKeyLoader,
    node: yaml.MappingNode,
    deep: bool = False,  # noqa: FBT001, FBT002 - callback signature is defined by PyYAML.
) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            context = "while constructing a mapping"
            raise yaml.constructor.ConstructorError(
                context,
                node.start_mark,
                f"duplicate key: {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_unique_mapping)


def _load_mapping(path: Path | str) -> tuple[dict[str, Any] | None, list[str]]:
    contract_path = Path(path)
    try:
        value = yaml.load(
            contract_path.read_text(encoding="utf-8"),
            Loader=_UniqueKeyLoader,  # noqa: S506 - subclass of SafeLoader; rejects duplicate keys.
        )
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        return None, [f"{contract_path}: invalid YAML: {exc}"]
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        return None, [f"{contract_path}: contract must be a string-keyed mapping"]
    return value, []


def _exact_fields(value: dict[str, Any], fields: tuple[str, ...], context: str) -> list[str]:
    errors = [f"{context}.{field}: missing required field" for field in fields if field not in value]
    errors.extend(f"{context}.{field}: unknown field" for field in sorted(set(value) - set(fields)))
    return errors


def _valid_https_url(value: object) -> bool:
    if not isinstance(value, str) or not value or value != value.strip():
        return False
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return False
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    lowered = value.lower()
    if any(marker in lowered for marker in _PLACEHOLDER_PARTS):
        return False
    if host.endswith((".invalid", ".test", ".local")):
        return False
    return not any(part.lower() in {"tbd", "todo", "replace-me", "changeme"} for part in parsed.path.split("/") if part)


def _is_nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value == value.strip()


def validate_brand_contract(path: Path | str) -> list[str]:
    """Return a deterministic list of errors for a strict Ketos contract."""
    contract, errors = _load_mapping(path)
    if contract is None:
        return errors
    errors.extend(_exact_fields(contract, BRAND_CONTRACT_FIELDS, "brand"))

    required_strings = (
        "product_name",
        "product_slug",
        "python_distribution",
        "python_base_distribution",
        "sdk_distribution",
        "stepflow_distribution",
        "python_namespace",
        "sdk_namespace",
        "stepflow_namespace",
        "env_prefix",
        "logo_source_sha256",
    )
    nullable_strings = (
        set(BRAND_CONTRACT_FIELDS)
        - set(required_strings)
        - {
            "social_links",
            "analytics_properties",
            *URL_FIELDS,
        }
    )
    for field in required_strings:
        if field in contract and not _is_nonempty_string(contract[field]):
            errors.append(f"brand.{field}: must be a non-empty string")
    for field in sorted(nullable_strings):
        if field in contract and contract[field] is not None and not _is_nonempty_string(contract[field]):
            errors.append(f"brand.{field}: must be a non-empty string or null")
    for field in URL_FIELDS:
        if field in contract and contract[field] is not None and not _valid_https_url(contract[field]):
            errors.append(f"brand.{field}: must be a real HTTPS URL or null")
    for field in ("social_links", "analytics_properties"):
        if field in contract:
            values = contract[field]
            if not isinstance(values, list) or any(not _is_nonempty_string(item) for item in values):
                errors.append(f"brand.{field}: must be a list of non-empty strings")
            elif values != sorted(set(values)):
                errors.append(f"brand.{field}: values must be unique and sorted")
    if isinstance(contract.get("social_links"), list):
        for index, value in enumerate(contract["social_links"]):
            if _is_nonempty_string(value) and not _valid_https_url(value):
                errors.append(f"brand.social_links[{index}]: must be a real HTTPS URL")
    if (
        "logo_source_sha256" in contract
        and isinstance(contract["logo_source_sha256"], str)
        and not _SHA256_RE.fullmatch(contract["logo_source_sha256"])
    ):
        errors.append("brand.logo_source_sha256: must be a lowercase SHA-256 digest")
    for field, canonical in CANONICAL_BRAND_VALUES.items():
        if field in contract and contract[field] != canonical:
            errors.append(f"brand.{field}: must equal canonical value {canonical!r}")
    return sorted(set(errors))


def _valid_relative_path(value: object) -> bool:
    if not _is_nonempty_string(value) or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and value == path.as_posix()


def _validate_legacy_mapping(contract: dict[str, Any]) -> list[str]:
    """Return errors for a loaded frozen baseline and exact legacy allowlist."""
    errors: list[str] = []
    required = {"version", "baseline", "residues"}
    allowed = required | {"migration_debt", "technical_debt"}
    errors.extend(f"legacy.{field}: missing required field" for field in sorted(required - set(contract)))
    errors.extend(f"legacy.{field}: unknown field" for field in sorted(set(contract) - allowed))
    if contract.get("version") != 1 or isinstance(contract.get("version"), bool):
        errors.append("legacy.version: must be integer 1")

    baseline = contract.get("baseline")
    if not isinstance(baseline, dict):
        errors.append("legacy.baseline: must be a mapping")
    else:
        errors.extend(_exact_fields(baseline, BASELINE_FIELDS, "legacy.baseline"))
        commit = baseline.get("commit")
        if not isinstance(commit, str) or not _SHA_RE.fullmatch(commit):
            errors.append("legacy.baseline.commit: must be a full lowercase 40-character commit SHA")
        for field in ("brand_file_count", "brand_line_count", "brand_path_count", "official_url_file_count"):
            value = baseline.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(f"legacy.baseline.{field}: must be a non-negative integer")
        for field in ("env_tokens", "paths"):
            values = baseline.get(field)
            if not isinstance(values, list) or any(not _is_nonempty_string(item) for item in values):
                errors.append(f"legacy.baseline.{field}: must be a list of non-empty strings")
            elif values != sorted(set(values)):
                errors.append(f"legacy.baseline.{field}: values must be unique and sorted")
        paths = baseline.get("paths")
        if isinstance(paths, list):
            for index, value in enumerate(paths):
                if _is_nonempty_string(value) and not _valid_relative_path(value):
                    errors.append(f"legacy.baseline.paths[{index}]: must be a normalized relative path")

    residues = contract.get("residues")
    if not isinstance(residues, list):
        errors.append("legacy.residues: must be a list")
    else:
        identities: set[tuple[str, str]] = set()
        for index, residue in enumerate(residues):
            context = f"legacy.residues[{index}]"
            if not isinstance(residue, dict):
                errors.append(f"{context}: must be a mapping")
                continue
            errors.extend(_exact_fields(residue, LEGACY_RESIDUE_FIELDS, context))
            errors.extend(
                f"{context}.{field}: must be a non-empty string"
                for field in LEGACY_RESIDUE_FIELDS
                if field in residue and not _is_nonempty_string(residue[field])
            )
            if "path" in residue and _is_nonempty_string(residue["path"]) and not _valid_relative_path(residue["path"]):
                errors.append(f"{context}.path: must be a normalized relative path")
            category = residue.get("category")
            if category not in LEGACY_CATEGORIES:
                errors.append(f"{context}.category: unknown category {category!r}")
            identity = (str(residue.get("path", "")), str(residue.get("match", "")))
            if identity in identities:
                errors.append(f"{context}: duplicate residue for {identity[0]}: {identity[1]}")
            identities.add(identity)

    migration_debt = contract.get("migration_debt")
    if migration_debt is not None:
        if not isinstance(migration_debt, dict):
            errors.append("legacy.migration_debt: must be a mapping")
        elif set(migration_debt) != set(MIGRATION_DEBT_KINDS):
            errors.append(f"legacy.migration_debt: must contain exactly {', '.join(MIGRATION_DEBT_KINDS)}")
        else:
            for kind in MIGRATION_DEBT_KINDS:
                group = migration_debt[kind]
                context = f"legacy.migration_debt.{kind}"
                if not isinstance(group, dict):
                    errors.append(f"{context}: must be a mapping")
                    continue
                errors.extend(_exact_fields(group, MIGRATION_DEBT_GROUP_FIELDS, context))
                errors.extend(
                    f"{context}.{metadata_field}: must be a non-empty string"
                    for metadata_field in DEBT_METADATA_FIELDS
                    if metadata_field in group and not _is_nonempty_string(group[metadata_field])
                )
                entries = group.get("occurrences")
                if not isinstance(entries, list):
                    errors.append(f"{context}.occurrences: must be a list")
                    continue
                seen_paths: set[str] = set()
                for index, entry in enumerate(entries):
                    entry_context = f"{context}.occurrences[{index}]"
                    entry_fields = {"path", "count", "fingerprints"}
                    if not isinstance(entry, dict) or set(entry) != entry_fields:
                        errors.append(f"{entry_context}: must contain exactly {', '.join(sorted(entry_fields))}")
                        continue
                    path = entry["path"]
                    if not _valid_relative_path(path):
                        errors.append(f"{entry_context}.path: must be a non-empty normalized path")
                    elif path in seen_paths:
                        errors.append(f"{entry_context}.path: duplicate path {path!r}")
                    seen_paths.add(str(path))
                    count = entry["count"]
                    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
                        errors.append(f"{entry_context}.count: must be a positive integer")
                    fingerprints = entry["fingerprints"]
                    if not isinstance(fingerprints, list) or any(
                        not isinstance(fingerprint, str) or not _SHA256_RE.fullmatch(fingerprint)
                        for fingerprint in fingerprints
                    ):
                        errors.append(f"{entry_context}.fingerprints: must be a list of lowercase SHA-256 digests")
                    elif fingerprints != sorted(fingerprints):
                        errors.append(f"{entry_context}.fingerprints: values must be sorted")
                    elif isinstance(count, int) and not isinstance(count, bool) and len(fingerprints) != count:
                        errors.append(f"{entry_context}.fingerprints: length must equal count")

    for field, keys in (("technical_debt", LEGACY_CATEGORIES),):
        debt = contract.get(field)
        if debt is None:
            continue
        if not isinstance(debt, dict):
            errors.append(f"legacy.{field}: must be a mapping")
            continue
        if set(debt) != set(keys):
            errors.append(f"legacy.{field}: must contain exactly {', '.join(keys)}")
            continue
        for kind in keys:
            group = debt[kind]
            group_context = f"legacy.{field}.{kind}"
            if not isinstance(group, dict):
                errors.append(f"{group_context}: must be a mapping")
                continue
            errors.extend(_exact_fields(group, TECHNICAL_DEBT_GROUP_FIELDS, group_context))
            errors.extend(
                f"{group_context}.{metadata_field}: must be a non-empty string"
                for metadata_field in DEBT_METADATA_FIELDS
                if metadata_field in group and not _is_nonempty_string(group[metadata_field])
            )
            entries = group.get("occurrences")
            if not isinstance(entries, list):
                errors.append(f"{group_context}.occurrences: must be a list")
                continue
            for index, entry in enumerate(entries):
                context = f"{group_context}.occurrences[{index}]"
                entry_fields = {"path", "match", "count"}
                if not isinstance(entry, dict) or set(entry) != entry_fields:
                    errors.append(f"{context}: must contain exactly {', '.join(sorted(entry_fields))}")
                    continue
                if not _valid_relative_path(entry["path"]):
                    errors.append(f"{context}.path: must be a non-empty normalized path")
                if not _is_nonempty_string(entry["match"]):
                    errors.append(f"{context}.match: must be a non-empty string")
                if not isinstance(entry["count"], int) or isinstance(entry["count"], bool) or entry["count"] < 1:
                    errors.append(f"{context}.count: must be a positive integer")
    return sorted(set(errors))


def validate_legacy_contract(path: Path | str) -> list[str]:
    """Return errors for the frozen baseline and exact legacy allowlist."""
    contract, errors = _load_mapping(path)
    if contract is None:
        return errors
    return _validate_legacy_mapping(contract)


def _git(repo: Path, *args: str, text: bool = True) -> str | bytes:
    completed = subprocess.run(  # noqa: S603 - callers provide fixed internal Git operations.
        ["git", *args],  # noqa: S607 - Git is intentionally resolved from PATH.
        cwd=repo,
        check=True,
        capture_output=True,
        text=text,
    )
    return completed.stdout


def _text_lines(content: bytes) -> list[str] | None:
    try:
        if b"\0" in content:
            return None
        return content.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        return None


def _tracked_blobs(repo: Path) -> list[tuple[str, bytes]]:
    """Read all indexed Git blobs in one batch without touching worktree paths."""
    listed = _git(repo, "ls-files", "-s", "-z", text=False)
    if not isinstance(listed, bytes):
        msg = "git ls-files unexpectedly returned text"
        raise TypeError(msg)
    indexed: list[tuple[str, bytes]] = []
    for record in listed.split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        _mode, object_id, stage = metadata.split()
        if stage == b"0":
            indexed.append((path.decode("utf-8", errors="surrogateescape"), object_id))
    indexed.sort(key=lambda item: item[0])

    completed = subprocess.run(
        ["git", "cat-file", "--batch"],  # noqa: S607 - Git is intentionally resolved from PATH.
        cwd=repo,
        input=b"".join(object_id + b"\n" for _, object_id in indexed),
        check=True,
        capture_output=True,
    )
    output = completed.stdout
    offset = 0
    blobs: list[tuple[str, bytes]] = []
    for path, expected_id in indexed:
        header_end = output.index(b"\n", offset)
        header = output[offset:header_end].split()
        object_header_size = 3
        if len(header) != object_header_size or header[0] != expected_id or header[1] != b"blob":
            msg = f"unexpected git cat-file response for {path}"
            raise ValueError(msg)
        size = int(header[2])
        start = header_end + 1
        blobs.append((path, output[start : start + size]))
        offset = start + size + 1
    return blobs


def is_official_url(value: str) -> bool:
    """Return whether *value* identifies an upstream-owned endpoint."""
    return bool(_OFFICIAL_URL_RE.search(value))


def inventory_repository(repo: Path | str) -> dict[str, Any]:
    """Return deterministic tracked-file occurrences and their baseline counts."""
    root = Path(repo).resolve()
    commit_output = _git(root, "rev-parse", "HEAD")
    if not isinstance(commit_output, str):
        msg = "git rev-parse unexpectedly returned bytes"
        raise TypeError(msg)
    commit = commit_output.strip()
    occurrences: list[dict[str, Any]] = []
    brand_paths: list[str] = []
    official_paths: set[str] = set()
    env_tokens: set[str] = set()
    brand_path_count = 0

    for relative, content in _tracked_blobs(root):
        if _BRAND_RE.search(relative):
            brand_path_count += 1
        lines = _text_lines(content)
        if lines is None:
            continue
        file_has_brand = False
        for number, line in enumerate(lines, start=1):
            has_brand = bool(_BRAND_RE.search(line))
            is_official = is_official_url(line)
            if not has_brand and not is_official:
                continue
            file_has_brand = file_has_brand or has_brand
            if is_official:
                official_paths.add(relative)
            if has_brand:
                env_tokens.update(_ENV_RE.findall(line))
            occurrences.append(
                {
                    "path": relative,
                    "line": number,
                    "match": line.strip(),
                    "official_url": is_official,
                    "brand": has_brand,
                    "filename": False,
                }
            )
        if file_has_brand:
            brand_paths.append(relative)
        if _BRAND_RE.search(relative):
            occurrences.append(
                {
                    "path": relative,
                    "line": 0,
                    "match": relative,
                    "official_url": False,
                    "brand": False,
                    "filename": True,
                }
            )

    baseline = {
        "commit": commit,
        "brand_file_count": len(brand_paths),
        "brand_line_count": sum(1 for item in occurrences if item["brand"]),
        "brand_path_count": brand_path_count,
        "official_url_file_count": len(official_paths),
        "env_tokens": sorted(env_tokens),
        "paths": sorted(brand_paths),
    }
    return {"baseline": baseline, "occurrences": occurrences}


def collect_baseline(repo: Path | str) -> dict[str, Any]:
    """Convenience API used when freezing a new legacy inventory."""
    return inventory_repository(repo)["baseline"]


def _technical_category(path: str, line: str) -> str | None:
    normalized_path = f"/{path.lower().strip('/')}"
    path_parts = PurePosixPath(path.lower()).parts
    filename = PurePosixPath(path).name.lower()
    lowered = line.lower()

    if filename in {"license", "license.md", "notice", "notice.md", "copying"} or re.search(
        r"\b(?:copyright|provenance|adapted from)\b", lowered
    ):
        return "legal_provenance"
    if "/alembic/versions/" in f"{normalized_path}/":
        return "historical_migration"
    if "fixtures" in path_parts or ("tests" in path_parts and "data" in path_parts):
        return "historical_fixture"
    if _ENV_RE.search(line):
        return "env_alias"
    if re.search(r"\b(?:from|import)\s+langflow(?:\b|\.)", line) or re.search(
        r"\bimport_module\(\s*['\"]langflow(?:\.[^'\"]*)?['\"]\s*\)", line
    ):
        return "import_alias"
    if re.search(r"(?:^|[\s'\"=:])(?:~?/)?\.langflow(?:[/\\]|$)", line, re.IGNORECASE) or re.search(
        r"(?:^|[/\\])langflow\.db(?:$|[\s'\"?#])", line, re.IGNORECASE
    ):
        return "data_path"
    has_explicit_id_label = bool(re.search(r"\b(?:(?:legacy|external)[_-])?(?:resource[_-])?(?:id|uuid)\b", lowered))
    has_immutable_id = bool(
        re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b", lowered)
        or re.search(r"\blangflow:[a-z0-9][a-z0-9._:-]+", lowered)
    )
    if has_explicit_id_label and has_immutable_id:
        return "external_resource_id"
    if re.search(r"\bx-langflow-[a-z0-9-]+\b", lowered) or re.search(
        r"(?:/api/[^\s'\"]*langflow|\blangflow[_-](?:queue|channel|topic|marker)\b|\b(?:queue|channel|topic|marker)[_-]langflow\b)",
        lowered,
    ):
        return "wire_protocol"
    return None


def _looks_technical(line: str, path: str = "") -> bool:
    return _technical_category(path, line) is not None


def _classified_technical_occurrences(occurrence: dict[str, Any]) -> list[tuple[dict[str, Any], str]]:
    category = _technical_category(occurrence["path"], occurrence["match"])
    if category is None:
        return []
    if category != "env_alias":
        return [(occurrence, category)]
    return [({**occurrence, "match": token}, category) for token in sorted(set(_ENV_RE.findall(occurrence["match"])))]


def _debt_entry_counts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = Counter((item["path"], item["match"]) for item in items)
    return [{"path": path, "match": match, "count": count} for (path, match), count in sorted(counts.items())]


def _migration_debt_counts(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fingerprints_by_path: dict[str, list[str]] = {}
    for item in items:
        fingerprint = hashlib.sha256(item["match"].encode()).hexdigest()
        fingerprints_by_path.setdefault(item["path"], []).append(fingerprint)
    return [
        {"path": path, "count": len(fingerprints), "fingerprints": sorted(fingerprints)}
        for path, fingerprints in sorted(fingerprints_by_path.items())
    ]


def _migration_debt_group(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {**MIGRATION_DEBT_METADATA[kind], "occurrences": _migration_debt_counts(items)}


def _technical_debt_group(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    owner, reason = TECHNICAL_DEBT_METADATA[kind]
    return {
        "owner": owner,
        "reason": reason,
        "compatibility_test": "scripts/rebrand/tests/test_semantic_classification.py",
        "removal_condition": f"Remove after the frozen {kind} compatibility residue is migrated.",
        "occurrences": [item for item in _debt_entry_counts(items) if item["count"] > 1],
    }


def freeze_contract(repo: Path | str) -> dict[str, Any]:
    """Freeze exact Stage 0 debt counts from the current Git index."""
    inventory = inventory_repository(repo)
    migration = {kind: [] for kind in MIGRATION_DEBT_KINDS}
    technical = {kind: [] for kind in LEGACY_CATEGORIES}
    technical_occurrences: list[tuple[dict[str, Any], str]] = []
    for occurrence in inventory["occurrences"]:
        if occurrence["filename"]:
            migration["filename"].append(occurrence)
        elif occurrence["official_url"]:
            migration["official_url"].append(occurrence)
        else:
            classifications = _classified_technical_occurrences(occurrence)
            if not classifications:
                migration["user_visible"].append(occurrence)
            else:
                for classified, category in classifications:
                    technical[category].append(classified)
                    technical_occurrences.append((classified, category))

    residues = []
    for occurrence, category in sorted(
        technical_occurrences, key=lambda item: (item[0]["path"], item[0]["match"], item[1])
    ):
        owner, reason = TECHNICAL_DEBT_METADATA[category]
        residues.append(
            {
                "path": occurrence["path"],
                "match": occurrence["match"],
                "category": category,
                "owner": owner,
                "reason": reason,
                "compatibility_test": "scripts/rebrand/tests/test_stage0_architecture.py",
                "removal_condition": f"Remove after the frozen {category} compatibility residue is migrated.",
            }
        )
    # Residue metadata is identity-based; counts live in technical_debt.
    residues = list({(item["path"], item["match"]): item for item in residues}.values())
    return {
        "version": 1,
        "baseline": inventory["baseline"],
        "residues": residues,
        "migration_debt": {kind: _migration_debt_group(kind, migration[kind]) for kind in MIGRATION_DEBT_KINDS},
        # Exact technical identities live in residues.  Only duplicate-count
        # overrides are stored here, avoiding a second copy of every identity.
        "technical_debt": {kind: _technical_debt_group(kind, technical[kind]) for kind in LEGACY_CATEGORIES},
    }


def _violation(kind: str, occurrence: dict[str, Any], **details: Any) -> dict[str, Any]:
    item = {
        "kind": kind,
        "path": occurrence["path"],
        "line": occurrence["line"],
        "match": occurrence["match"],
    }
    item.update(details)
    return item


def _matching_residue(
    occurrence: dict[str, Any],
    allowlist: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the exact allowlist entry represented by an occurrence.

    Most residue categories freeze the complete stripped source line.  An
    environment alias is deliberately narrower: its stable identity is the
    exact ``LANGFLOW_*`` token, independent of the syntax used to read or
    assign it.  Comparing extracted tokens keeps that exception exact without
    turning it into an arbitrary substring allowlist.
    """
    path = occurrence["path"]
    line = occurrence["match"]
    residue = allowlist.get((path, line))
    if residue is not None:
        return residue
    for token in _ENV_RE.findall(line):
        residue = allowlist.get((path, token))
        if residue is not None and residue["category"] == "env_alias":
            return residue
    return None


def scan_repository(
    repo: Path | str,
    brand_contract_path: Path | str,
    legacy_contract_path: Path | str,
    *,
    profile: str = "stage0",
) -> dict[str, Any]:
    """Validate contracts and classify every tracked legacy-brand line."""
    if profile not in PROFILES:
        msg = f"unknown scan profile: {profile}"
        raise ValueError(msg)
    brand_errors = validate_brand_contract(brand_contract_path)
    legacy, load_errors = _load_mapping(legacy_contract_path)
    legacy_errors = load_errors if legacy is None else _validate_legacy_mapping(legacy)
    contract_errors = sorted([*brand_errors, *legacy_errors])
    if contract_errors:
        return {
            "baseline": None,
            "allowed_residue": [],
            "violations": [],
            "contract_errors": contract_errors,
        }

    if legacy is None:  # Defensive; the contract-error return above covers this path.
        return {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": load_errors}

    inventory = inventory_repository(repo)
    baseline = inventory["baseline"]
    expected_baseline = legacy["baseline"]
    allowlist = {(item["path"], item["match"]): item for item in legacy["residues"]}
    allowed: list[dict[str, Any]] = []
    violations: list[dict[str, Any]] = []
    debt_mode = "migration_debt" in legacy and "technical_debt" in legacy

    if not debt_mode and baseline != expected_baseline:
        changed_fields = [field for field in BASELINE_FIELDS if baseline.get(field) != expected_baseline.get(field)]
        violations.append(
            {
                "kind": "baseline_drift",
                "path": "",
                "line": 0,
                "match": "",
                "changed_fields": changed_fields,
                "expected": expected_baseline,
                "actual": baseline,
            }
        )

    if debt_mode:
        expected: dict[tuple[str, str, str], int] = {}
        for kind, group in legacy["migration_debt"].items():
            for item in group["occurrences"]:
                expected.update(Counter((kind, item["path"], value) for value in item["fingerprints"]))
        for residue in legacy["residues"]:
            expected[(residue["category"], residue["path"], residue["match"])] = 1
        for kind, group in legacy["technical_debt"].items():
            expected.update({(kind, item["path"], item["match"]): item["count"] for item in group["occurrences"]})

        seen: Counter[tuple[str, str, str]] = Counter()
        technical_seen: Counter[tuple[str, str, str]] = Counter()
        classified_inventory: list[tuple[dict[str, Any], str]] = []
        for occurrence in inventory["occurrences"]:
            if occurrence["filename"]:
                classified_inventory.append((occurrence, "filename"))
            elif occurrence["official_url"]:
                classified_inventory.append((occurrence, "official_url"))
            else:
                technical_occurrences = _classified_technical_occurrences(occurrence)
                classified_inventory.extend(technical_occurrences or [(occurrence, "user_visible")])

        for occurrence, kind in classified_inventory:
            identity_match = (
                occurrence["match"]
                if kind in LEGACY_CATEGORIES
                else hashlib.sha256(occurrence["match"].encode()).hexdigest()
            )
            identity = (kind, occurrence["path"], identity_match)
            seen[identity] += 1
            if kind in LEGACY_CATEGORIES:
                technical_seen[identity] += 1

            frozen_count = expected.get(identity, 0)
            if profile == "stage0" and seen[identity] <= frozen_count:
                residue = _matching_residue(occurrence, allowlist)
                if residue is None:
                    allowed.append(_violation(kind, occurrence, frozen=True))
                else:
                    allowed.append(
                        {
                            "path": occurrence["path"],
                            "line": occurrence["line"],
                            **{field: residue[field] for field in LEGACY_RESIDUE_FIELDS if field != "path"},
                        }
                    )
                continue
            if profile == "stage0":
                violations.append(_violation("debt_addition", occurrence, debt_kind=kind))
            elif kind in LEGACY_CATEGORIES:
                violations.append(_violation("unallowlisted_technical", occurrence, debt_kind=kind))
            else:
                violations.append(_violation(kind, occurrence))

        if profile == "stage0":
            for identity, frozen_count in sorted(expected.items()):
                kind, path, match = identity
                if kind not in LEGACY_CATEGORIES:
                    continue
                current_count = technical_seen[identity]
                violations.extend(
                    [
                        {
                            "kind": "stale_technical_debt",
                            "path": path,
                            "line": 0,
                            "match": match,
                            "debt_kind": kind,
                        }
                        for _ in range(frozen_count - current_count)
                    ]
                )
    else:
        for occurrence in inventory["occurrences"]:
            # Legacy v1 contracts predate filename scanning.
            if occurrence["filename"]:
                continue
            if occurrence["official_url"]:
                violations.append(_violation("official_url", occurrence))
                continue
            residue = _matching_residue(occurrence, allowlist)
            if residue is not None:
                allowed.append(
                    {
                        "path": occurrence["path"],
                        "line": occurrence["line"],
                        **{field: residue[field] for field in LEGACY_RESIDUE_FIELDS if field != "path"},
                    }
                )
                continue
            kind = (
                "unallowlisted_technical"
                if _looks_technical(occurrence["match"], occurrence["path"])
                else "user_visible"
            )
            violations.append(_violation(kind, occurrence))

    def sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
        return (item.get("path", ""), item.get("line", 0), item.get("kind", ""), item.get("match", ""))

    return {
        "baseline": baseline,
        "allowed_residue": sorted(allowed, key=sort_key),
        "violations": sorted(violations, key=sort_key),
        "contract_errors": [],
    }


def _render_text(report: dict[str, Any]) -> str:
    if report.get("contract_errors"):
        return "\n".join(f"CONTRACT ERROR: {error}" for error in report["contract_errors"]) + "\n"
    if report.get("violations"):
        lines = []
        for item in report["violations"]:
            location = item.get("path") or "<repository>"
            if item.get("line"):
                location += f":{item['line']}"
            lines.append(f"FAIL {item['kind']} {location}: {item.get('match', '')}")
        return "\n".join(lines) + "\n"
    return f"PASS tracked brand scan ({len(report.get('allowed_residue', []))} allowed residues)\n"


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=root)
    parser.add_argument("--brand-contract", type=Path, default=root / "brand/ketos-brand-contract.yaml")
    parser.add_argument("--legacy-contract", type=Path, default=root / "brand/legacy-langflow-contract.yaml")
    parser.add_argument("--format", choices=("json", "text"), default="text")
    parser.add_argument("--profile", choices=PROFILES, default="stage0")
    parser.add_argument("--freeze", type=Path, help="write a frozen Stage 0 debt contract and exit")
    parser.add_argument(
        "--inventory",
        action="store_true",
        help="print the tracked baseline and raw occurrences without applying an allowlist",
    )
    args = parser.parse_args(argv)

    try:
        if args.freeze is not None:
            args.freeze.parent.mkdir(parents=True, exist_ok=True)
            args.freeze.write_text(
                yaml.safe_dump(freeze_contract(args.repo), sort_keys=False, allow_unicode=True),
                encoding="utf-8",
            )
            return 0
        report = (
            inventory_repository(args.repo)
            if args.inventory
            else scan_repository(
                args.repo,
                args.brand_contract,
                args.legacy_contract,
                profile=args.profile,
            )
        )
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        report = {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": [str(exc)]}

    if args.format == "json" or args.inventory:
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(_render_text(report))
    if args.inventory:
        return 0
    if report["contract_errors"]:
        return 2
    return 1 if report["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
