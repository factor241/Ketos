#!/usr/bin/env python3
"""Enforce the Ketos Stage 0 brand, endpoint, compatibility, and legal contracts."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile
import zipfile
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from itertools import chain
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

import yaml

if TYPE_CHECKING:
    from collections.abc import Iterable

PROFILES = ("visible", "official-url", "technical-compatibility")
BASELINE_FIELDS = (
    "brand_file_count",
    "brand_match_count",
    "brand_path_count",
    "executor_file_count",
    "executor_match_count",
    "executor_path_count",
    "upstream_endpoint_count",
    "scan_issue_count",
)
MAX_ARCHIVE_DEPTH = 3
MAX_ARCHIVE_MEMBER_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 10_000
MIN_ISO_MEDIA_HEADER_BYTES = 12
LEGAL_FILES = {"LICENSE", "NOTICE", "src/ketos-stepflow/NOTICE"}
LEGAL_FIELDS = ("path", "line", "expected_text", "sha256")
LEGAL_FILE_FIELDS = ("path", "sha256")
NEGATIVE_TEST_FIELDS = ("path", "line", "kind", "expected_text", "sha256")
NEGATIVE_TEST_KINDS = {"legacy_brand", "legacy_executor", "upstream_endpoint"}

_PRODUCT_LITERAL = rb"lang" + rb"flow"
_EXECUTOR_LITERAL = rb"l" + rb"fx"
_LEGACY_PRODUCT_TEXT = "lang" + "flow"
_LEGACY_EXECUTOR_TEXT = "l" + "fx"
_LEGACY_CONTRACT_RELATIVE_PATH = "brand/legacy-" + _LEGACY_PRODUCT_TEXT + "-contract.yaml"
_LEGACY_CONTRACT_SELF_PATH_LINE = 10
_LEGACY_CONTRACT_SELF_PATH_SCALAR = "- " + _LEGACY_CONTRACT_RELATIVE_PATH
_PRODUCT_PATTERN = rb"lang" + rb"[-_ ]?" + rb"flow"
_EXECUTOR_PATTERN = rb"(?<![A-Za-z0-9])l" + rb"fx(?![A-Za-z0-9])"
_PRODUCT_RE = re.compile(_PRODUCT_PATTERN, re.IGNORECASE)
_EXECUTOR_RE = re.compile(_EXECUTOR_PATTERN, re.IGNORECASE)
_UPSTREAM_ENDPOINT_RE = re.compile(
    rb"(?:https?://api\.sc" + rb"arf\.sh/v1/pixel|discord\.(?:gg|com/invite)/EqksyE2EX9)",
    re.IGNORECASE,
)
_OFFICIAL_URL_RE = re.compile(
    rb"https?://(?:[A-Za-z0-9-]+\.)*(?:"
    + _PRODUCT_LITERAL
    + rb"\.org|"
    + _PRODUCT_LITERAL
    + rb"\.ai)(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?github\.com/" + _PRODUCT_LITERAL + rb"-ai/" + _PRODUCT_LITERAL + rb"(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?pypi\.org/project/(?:"
    + _PRODUCT_LITERAL
    + rb"|"
    + _EXECUTOR_LITERAL
    + rb")(?=[:/?#\s\"'<>]|$)|"
    rb"https?://hub\.docker\.com/r/" + _PRODUCT_LITERAL + rb"ai/" + _PRODUCT_LITERAL + rb"(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?(?:x\.com/"
    + _PRODUCT_LITERAL
    + rb"_ai|youtube\.com/@"
    + _PRODUCT_LITERAL
    + rb")(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?twitter\.com/" + _PRODUCT_LITERAL + rb"_ai(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?linkedin\.com/company/" + _PRODUCT_LITERAL + rb"-ai(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?medium\.com/" + _PRODUCT_LITERAL + rb"(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?huggingface\.co/" + _PRODUCT_LITERAL + rb"(?=[:/?#\s\"'<>]|$)|"
    rb"https?://discord\.(?:gg|com/invite)/EqksyE2EX9(?=[:/?#\s\"'<>]|$)|"
    rb"https?://api\.scarf\.sh/v1/pixel(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:www\.)?(?:ibm\.com/products/watsonx-ai|cloud\.ibm\.com/catalog/services/watsonx-ai)(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:api\.segment\.io|cdn\.segment\.(?:com|io))(?=[:/?#\s\"'<>]|$)|"
    rb"https?://(?:[A-Za-z0-9-]+\.)*(?:algolia\.com|algolia\.net|algolianet\.com)(?=[:/?#\s\"'<>]|$)|"
    rb"https?://raw\.githubusercontent\.com/"
    + _PRODUCT_LITERAL
    + rb"-ai/"
    + _PRODUCT_LITERAL
    + rb"(?=[:/?#\s\"'<>]|$)|"
    rb"https?://cdn\.jsdelivr\.net/(?:gh/"
    + _PRODUCT_LITERAL
    + rb"-ai/"
    + _PRODUCT_LITERAL
    + rb"|npm/@"
    + _PRODUCT_LITERAL
    + rb"/(?:chat|chat-widget))(?=[:/?#\s\"'<>@]|$)|"
    rb"https?://unpkg\.com/@" + _PRODUCT_LITERAL + rb"/(?:chat|chat-widget)(?=[:/?#\s\"'<>@]|$)",
    re.IGNORECASE,
)
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
CURRENT_COMPATIBILITY_VERSION = (1, 10, 2)

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
    "schema_base_url",
    "container_registry_namespace",
    "support_url",
    "telemetry_url",
    "store_url",
    "social_links",
    "analytics_properties",
    "package_publisher_identity",
    "legal_entity",
    "copyright_holder",
    "trademark_owner",
    "security_contact",
    "vulnerability_report_url",
    "moderation_contact",
    "privacy_policy_url",
    "data_controller",
    "analytics_owner",
    "search_owner",
    "chat_widget_owner",
    "signing_identity",
    "logo_source_sha256",
    "logo_rights_approved_by",
    "logo_rights_approved_date",
    "wordmark_font_license",
)

CANONICAL_BRAND_VALUES: dict[str, object] = {
    "product_name": "Ketos",
    "product_slug": "ketos",
    "executor_name": "KFX",
    "executor_distribution": "kfx",
    "python_distribution": "ketos",
    "python_base_distribution": "ketos-base",
    "sdk_distribution": "ketos-sdk",
    "stepflow_distribution": "ketos-stepflow",
    "python_namespace": "ketos",
    "sdk_namespace": "ketos_sdk",
    "stepflow_namespace": "ketos_stepflow",
    "env_prefix": "KETOS_",
    "site_url": None,
    "docs_url": None,
    "repository_url": None,
    "issues_url": None,
    "schema_base_url": None,
    "container_registry_namespace": None,
    "support_url": None,
    "telemetry_url": None,
    "store_url": None,
    "social_links": [],
    "analytics_properties": [],
    "package_publisher_identity": None,
    "legal_entity": None,
    "copyright_holder": None,
    "trademark_owner": None,
    "security_contact": None,
    "vulnerability_report_url": None,
    "moderation_contact": None,
    "privacy_policy_url": None,
    "data_controller": None,
    "analytics_owner": None,
    "search_owner": None,
    "chat_widget_owner": None,
    "signing_identity": None,
    "logo_source_sha256": "cb895e5fafde4006cc17872c8537bbd4b3ba8c0f4b9304bcff2303184e0eaca3",
    "logo_rights_approved_by": None,
    "logo_rights_approved_date": None,
    "wordmark_font_license": None,
}

LEGACY_CATEGORIES = (
    "import_alias",
    "cli_alias",
    "env_alias",
    "data_path",
    "historical_migration",
    "historical_fixture",
    "wire_protocol",
    "external_resource_id",
    "legal_provenance",
)
LEGACY_SUBTYPES = ("package_alias", "pytest_alias", "extension_manifest")
LEGACY_OCCURRENCE_FIELDS = (
    "category",
    "subtype",
    "locator",
    "owner",
    "reason",
    "compatibility_test",
    "introduced_in",
    "supported_until",
    "removal_condition",
)
LEGACY_BASELINE_FIELDS = {
    "original_commit",
    "evidence_base_commit",
    "frozen_upstream_remote",
    "visible_count",
    "official_url_count",
    "technical_compatibility_count",
    "paths",
    "paths_sha256",
    "scanner_outputs",
    "untracked_exclusions",
    "untracked_exclusions_sha256",
}
UNTRACKED_EXCLUSION_FIELDS = {"kind", "path", "owner", "reason"}
RESERVED_HOSTS = {
    "ketos.test",
    "docs.ketos.test",
    "git.ketos.test",
    "schemas.ketos.test",
    "registry.ketos.test",
    "registry.invalid",
}
PYTEST_COMPATIBILITY_BRIDGE_PATHS = {
    "src/kfx/src/kfx/testing/plugin.py",
    "src/kfx/tests/unit/test_testing_plugin_compatibility.py",
    "src/sdk/src/ketos_sdk/testing.py",
    "src/sdk/tests/test_testing.py",
}
WORKSPACE_PACKAGE_MANIFEST_PATHS = {"pyproject.toml", "uv.lock"}
S2_COMPATIBILITY_ACCEPTANCE_TEST_PATH = "scripts/rebrand/tests/test_s2_compatibility_check.py"
S2_COMPATIBILITY_CHECKER_PATH = "scripts/rebrand/check_s2_compatibility.py"
S2_DISTRIBUTION_CONTRACT_PATH = "brand/compatibility/s2-distribution-contract.yaml"
FROZEN_UPSTREAM_REMOTE = "https://github.com/" + _LEGACY_PRODUCT_TEXT + "-ai/" + _LEGACY_PRODUCT_TEXT + ".git"
MUTABLE_EXTERNAL_FIELDS = {
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
    "logo_rights_approved_by",
    "logo_rights_approved_date",
    "wordmark_font_license",
}


class _UniqueKeyLoader(yaml.SafeLoader):
    """Safe loader that rejects duplicate mapping keys."""


def _construct_unique_mapping(
    loader: _UniqueKeyLoader,
    node: yaml.MappingNode,
    deep: bool = False,  # noqa: FBT001, FBT002 - PyYAML callback signature.
) -> dict[Any, Any]:
    result: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            context = "while constructing a mapping"
            raise yaml.constructor.ConstructorError(
                context, node.start_mark, f"duplicate key: {key!r}", key_node.start_mark
            )
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


_UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_unique_mapping)


def _load_mapping(path: Path | str) -> tuple[dict[str, Any] | None, list[str]]:
    contract_path = Path(path)
    try:
        value = yaml.load(contract_path.read_text(encoding="utf-8"), Loader=_UniqueKeyLoader)  # noqa: S506
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        return None, [f"{contract_path}: invalid YAML: {exc}"]
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        return None, [f"{contract_path}: contract must be a string-keyed mapping"]
    return value, []


def _canonical_sha256(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()


def _legacy_semantics(contract: dict[str, Any]) -> dict[str, Any]:
    """Return every contract field except the self-referential scanner outputs."""
    semantics = deepcopy(contract)
    baseline = semantics.get("baseline")
    if isinstance(baseline, dict):
        baseline.pop("scanner_outputs", None)
    return semantics


def _legacy_semantics_sha256(contract: dict[str, Any]) -> str:
    return _canonical_sha256(_legacy_semantics(contract))


def validate_brand_contract(path: Path | str) -> list[str]:
    """Validate the single canonical Ketos naming and endpoint contract."""
    contract, errors = _load_mapping(path)
    if contract is None:
        return errors
    actual_fields = set(contract)
    expected_fields = set(BRAND_CONTRACT_FIELDS)
    errors.extend(f"brand.{field}: missing required field" for field in sorted(expected_fields - actual_fields))
    errors.extend(f"brand.{field}: unknown field" for field in sorted(actual_fields - expected_fields))
    for field, canonical in CANONICAL_BRAND_VALUES.items():
        if field not in MUTABLE_EXTERNAL_FIELDS and field in contract and contract[field] != canonical:
            errors.append(f"brand.{field}: must equal canonical value {canonical!r}")
    url_fields = (
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
    for field in url_fields:
        value = contract.get(field)
        if isinstance(value, str):
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.hostname:
                errors.append(f"brand.{field}: must be an absolute HTTPS URL")
            elif parsed.hostname.casefold() in RESERVED_HOSTS or parsed.hostname.casefold().endswith(
                (".test", ".invalid")
            ):
                errors.append(f"brand.{field}: reserved host cannot enable a feature")
        elif value is not None:
            errors.append(f"brand.{field}: must be an absolute HTTPS URL or null")
    for field in ("social_links", "analytics_properties"):
        if not isinstance(contract.get(field), list):
            errors.append(f"brand.{field}: must be a list")
        elif any(not isinstance(item, str) or not item.strip() for item in contract[field]):
            errors.append(f"brand.{field}: entries must be non-empty strings")
    for index, value in enumerate(contract.get("social_links", [])):
        parsed = urlsplit(value)
        host = parsed.hostname.casefold() if parsed.hostname else ""
        if parsed.scheme != "https" or not host or host in RESERVED_HOSTS or host.endswith((".test", ".invalid")):
            errors.append(f"brand.social_links[{index}]: must be an owned non-reserved HTTPS URL")
    registry = contract.get("container_registry_namespace")
    if isinstance(registry, str):
        registry_match = re.fullmatch(
            r"(?P<host>(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})/"
            r"(?P<namespace>[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)",
            registry,
        )
        if registry_match is None or "://" in registry or ".." in registry:
            errors.append(
                "brand.container_registry_namespace: must be bare lowercase host/normalized namespace without scheme"
            )
        else:
            registry_host = registry_match.group("host")
            if registry_host in RESERVED_HOSTS or registry_host.endswith((".test", ".invalid")):
                errors.append("brand.container_registry_namespace: reserved host cannot enable publication")
    required_strings = {
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
        "logo_source_sha256",
    }
    for field in required_strings:
        if not isinstance(contract.get(field), str) or not contract[field].strip():
            errors.append(f"brand.{field}: must be a non-empty string")
    nullable_strings = (
        set(BRAND_CONTRACT_FIELDS)
        - required_strings
        - set(url_fields)
        - {
            "social_links",
            "analytics_properties",
        }
    )
    for field in nullable_strings:
        if contract.get(field) is not None and (not isinstance(contract[field], str) or not contract[field].strip()):
            errors.append(f"brand.{field}: must be a non-empty string or null")
    digest = contract.get("logo_source_sha256")
    if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
        errors.append("brand.logo_source_sha256: must be a lowercase SHA-256 digest")
    approval_date = contract.get("logo_rights_approved_date")
    if approval_date is not None and (
        not isinstance(approval_date, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", approval_date)
    ):
        errors.append("brand.logo_rights_approved_date: must be ISO date text or null")
    return sorted(set(errors))


def validate_legacy_contract(path: Path | str, *, repository_root: Path | str | None = None) -> list[str]:
    """Validate the semantic, versioned legacy compatibility ledger."""
    contract, errors = _load_mapping(path)
    if contract is None:
        return errors
    contract_root = Path(repository_root).resolve() if repository_root is not None else Path(path).resolve().parents[1]
    expected_top = {"version", "baseline", "occurrences"}
    errors.extend(f"legacy.{field}: missing required field" for field in sorted(expected_top - set(contract)))
    errors.extend(f"legacy.{field}: unknown field" for field in sorted(set(contract) - expected_top))
    if contract.get("version") != 1 or isinstance(contract.get("version"), bool):
        errors.append("legacy.version: must be integer 1")
    baseline = contract.get("baseline")
    if not isinstance(baseline, dict):
        errors.append("legacy.baseline: must be a mapping")
    else:
        errors.extend(
            f"legacy.baseline.{field}: missing required field"
            for field in sorted(LEGACY_BASELINE_FIELDS - set(baseline))
        )
        errors.extend(
            f"legacy.baseline.{field}: unknown field" for field in sorted(set(baseline) - LEGACY_BASELINE_FIELDS)
        )
        for field in ("original_commit", "evidence_base_commit"):
            if not isinstance(baseline.get(field), str) or not _SHA_RE.fullmatch(baseline[field]):
                errors.append(f"legacy.baseline.{field}: must be a full lowercase commit SHA")
        if baseline.get("frozen_upstream_remote") != FROZEN_UPSTREAM_REMOTE:
            errors.append("legacy.baseline.frozen_upstream_remote: must equal frozen upstream")
        for field in ("visible_count", "official_url_count", "technical_compatibility_count"):
            if not isinstance(baseline.get(field), int) or isinstance(baseline.get(field), bool) or baseline[field] < 0:
                errors.append(f"legacy.baseline.{field}: must be a non-negative integer")
        if not isinstance(baseline.get("paths"), list) or any(
            not _valid_relative_path(path) for path in baseline.get("paths", [])
        ):
            errors.append("legacy.baseline.paths: must be normalized relative paths")
        elif baseline["paths"] != sorted(set(baseline["paths"])):
            errors.append("legacy.baseline.paths: must be sorted and unique")
        outputs = baseline.get("scanner_outputs")
        if not isinstance(outputs, dict) or set(outputs) != set(PROFILES):
            errors.append("legacy.baseline.scanner_outputs: must contain every exact profile")
        else:
            verdicts: set[str] = set()
            for profile, evidence in outputs.items():
                context = f"legacy.baseline.scanner_outputs.{profile}"
                if not isinstance(evidence, dict) or set(evidence) != {"verdict", "sha256"}:
                    errors.append(f"{context}: must contain exact verdict and sha256 fields")
                    continue
                verdict = evidence.get("verdict")
                digest = evidence.get("sha256")
                if verdict not in {"PENDING", "PASS"}:
                    errors.append(f"{context}.verdict: must be PENDING or PASS")
                else:
                    verdicts.add(verdict)
                if verdict == "PENDING" and digest is not None:
                    errors.append(f"{context}.sha256: pending evidence must be null")
                if verdict == "PASS" and (not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest)):
                    errors.append(f"{context}.sha256: completed evidence requires SHA-256")
            if len(verdicts) > 1:
                errors.append("legacy.baseline.scanner_outputs: evidence state must be atomic all-PENDING or all-PASS")
            if verdicts == {"PENDING"} and baseline.get("paths_sha256") is not None:
                errors.append("legacy.baseline.paths_sha256: pending evidence checksum must be null")
            elif verdicts == {"PASS"} and isinstance(baseline.get("paths"), list):
                expected_paths_digest = _canonical_sha256(baseline["paths"])
                if baseline.get("paths_sha256") != expected_paths_digest:
                    errors.append("legacy.baseline.paths_sha256: does not fingerprint exact paths")
        exclusions = baseline.get("untracked_exclusions")
        if not isinstance(exclusions, list):
            errors.append("legacy.baseline.untracked_exclusions: must be a list")
        else:
            exclusion_keys: set[tuple[object, object]] = set()
            for index, exclusion in enumerate(exclusions):
                context = f"legacy.baseline.untracked_exclusions[{index}]"
                if not isinstance(exclusion, dict):
                    errors.append(f"{context}: must be a mapping")
                    continue
                errors.extend(
                    f"{context}.{field}: missing required field"
                    for field in sorted(UNTRACKED_EXCLUSION_FIELDS - set(exclusion))
                )
                errors.extend(
                    f"{context}.{field}: unknown field" for field in sorted(set(exclusion) - UNTRACKED_EXCLUSION_FIELDS)
                )
                kind = exclusion.get("kind")
                excluded_path = exclusion.get("path")
                if kind not in {"file", "prefix"}:
                    errors.append(f"{context}.kind: must be file or prefix")
                if kind == "file" and not _valid_relative_path(excluded_path):
                    errors.append(f"{context}.path: file exclusion must be a normalized relative path")
                if kind == "prefix" and (
                    not isinstance(excluded_path, str)
                    or not excluded_path.endswith("/")
                    or not _valid_relative_path(excluded_path[:-1])
                ):
                    errors.append(f"{context}.path: prefix exclusion must be a normalized relative path ending in /")
                for field in ("owner", "reason"):
                    value = exclusion.get(field)
                    if not isinstance(value, str) or not value.strip() or value != value.strip():
                        errors.append(f"{context}.{field}: must be non-empty normalized text")
                key = (kind, excluded_path)
                if key in exclusion_keys:
                    errors.append(f"{context}: duplicate kind/path exclusion")
                exclusion_keys.add(key)
            if all(isinstance(item, dict) for item in exclusions):
                sorted_exclusions = sorted(exclusions, key=lambda item: (str(item.get("path")), str(item.get("kind"))))
                if exclusions != sorted_exclusions:
                    errors.append("legacy.baseline.untracked_exclusions: entries must be sorted by path and kind")
                payload = json.dumps(exclusions, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
                expected_digest = hashlib.sha256(payload).hexdigest()
                if baseline.get("untracked_exclusions_sha256") != expected_digest:
                    errors.append("legacy.baseline.untracked_exclusions_sha256: does not fingerprint exact exclusions")
        if (contract_root / ".git").exists() and isinstance(baseline.get("evidence_base_commit"), str):
            completed = subprocess.run(  # noqa: S603 - fixed internal Git operation.
                ["git", "merge-base", "--is-ancestor", baseline["evidence_base_commit"], "HEAD"],  # noqa: S607
                cwd=contract_root,
                check=False,
                capture_output=True,
            )
            if completed.returncode != 0:
                errors.append("legacy.baseline.evidence_base_commit: must be an ancestor of repository HEAD")
    occurrences = contract.get("occurrences")
    if not isinstance(occurrences, list):
        errors.append("legacy.occurrences: must be a list")
        return sorted(set(errors))
    locators: set[str] = set()
    root = contract_root
    for index, item in enumerate(occurrences):
        context = f"legacy.occurrences[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{context}: must be a mapping")
            continue
        expected = set(LEGACY_OCCURRENCE_FIELDS)
        errors.extend(f"{context}.{field}: missing required field" for field in sorted(expected - set(item)))
        errors.extend(f"{context}.{field}: unknown field" for field in sorted(set(item) - expected))
        if item.get("category") not in LEGACY_CATEGORIES:
            errors.append(f"{context}.category: unknown category")
        subtype = item.get("subtype")
        if subtype is not None and subtype not in LEGACY_SUBTYPES:
            errors.append(f"{context}.subtype: unknown subtype")
        if subtype == "package_alias" and item.get("category") != "import_alias":
            errors.append(f"{context}.subtype: package_alias requires import_alias")
        if subtype == "pytest_alias" and item.get("category") != "import_alias":
            errors.append(f"{context}.subtype: pytest_alias requires import_alias")
        if subtype == "extension_manifest" and item.get("category") != "historical_fixture":
            errors.append(f"{context}.subtype: extension_manifest requires historical_fixture")
        locator = item.get("locator")
        if not isinstance(locator, str) or not locator.strip():
            errors.append(f"{context}.locator: must be a non-empty semantic locator")
        elif locator in locators:
            errors.append(f"{context}.locator: duplicate locator")
        else:
            locators.add(locator)
        if isinstance(locator, str):
            locator_prefix = item.get("category", "")
            if subtype is not None:
                locator_prefix += f":{subtype}"
            if not locator.startswith(locator_prefix + ":") or re.search(r":(?:0|[1-9][0-9]*)$", locator) is None:
                errors.append(f"{context}.locator: must be an exact category/subtype/path/line locator")
            else:
                locator_body = locator.removeprefix(locator_prefix + ":")
                locator_path, _, locator_line_text = locator_body.rpartition(":")
                locator_line = int(locator_line_text)
                source_path = root / locator_path
                if not _valid_relative_path(locator_path) or not source_path.is_file():
                    errors.append(f"{context}.locator: referenced occurrence path is missing")
                elif locator_line == 0:
                    actual = _technical_locator(
                        locator_path,
                        locator_line,
                        locator_path,
                        "legacy_executor" if subtype == "package_alias" else "legacy_brand",
                    )
                    if actual != locator:
                        errors.append(f"{context}.locator: source occurrence classification does not match")
                else:
                    source_lines = source_path.read_text(encoding="utf-8").splitlines()
                    if locator_line > len(source_lines):
                        errors.append(f"{context}.locator: referenced occurrence line is missing")
                    else:
                        actual = _technical_locator(
                            locator_path,
                            locator_line,
                            source_lines[locator_line - 1],
                            "legacy_executor" if subtype == "package_alias" else "legacy_brand",
                        )
                        if actual != locator:
                            errors.append(f"{context}.locator: source occurrence classification does not match")
        for field in ("owner", "reason", "introduced_in", "supported_until", "removal_condition"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                errors.append(f"{context}.{field}: must be a non-empty string")
        introduced = item.get("introduced_in")
        supported = item.get("supported_until")
        introduced_match = _SEMVER_RE.fullmatch(introduced) if isinstance(introduced, str) else None
        supported_match = _SEMVER_RE.fullmatch(supported) if isinstance(supported, str) else None
        if introduced_match is None:
            errors.append(f"{context}.introduced_in: must be strict semantic version")
        if supported_match is None:
            errors.append(f"{context}.supported_until: must be strict semantic version")
        elif tuple(map(int, supported_match.groups())) <= CURRENT_COMPATIBILITY_VERSION:
            errors.append(f"{context}.supported_until: compatibility interval is expired")
        if (
            introduced_match
            and supported_match
            and tuple(map(int, introduced_match.groups())) >= tuple(map(int, supported_match.groups()))
        ):
            errors.append(f"{context}.supported_until: must be later than introduced_in")
        test_path = item.get("compatibility_test")
        if not _valid_relative_path(test_path):
            errors.append(f"{context}.compatibility_test: must be a normalized relative path")
        elif not (root / test_path).is_file():
            errors.append(f"{context}.compatibility_test: referenced test is missing")
    return sorted(set(errors))


def validate_remote_policy(repo: Path | str, brand_contract_path: Path | str) -> list[str]:
    """Allow the frozen upstream remote or an approved owned repository URL."""
    contract, errors = _load_mapping(brand_contract_path)
    if contract is None:
        return errors
    approved = contract.get("repository_url")
    allowed = {FROZEN_UPSTREAM_REMOTE}
    if isinstance(approved, str):
        parsed = urlsplit(approved)
        if (
            parsed.hostname
            and parsed.hostname.casefold() not in RESERVED_HOSTS
            and not parsed.hostname.endswith((".test", ".invalid"))
        ):
            allowed.add(approved)
    try:
        remotes = _git(Path(repo), "remote", "get-url", "--all", "origin")
    except subprocess.CalledProcessError:
        return ["remote.origin: missing origin remote"]
    actual = {line.strip() for line in str(remotes).splitlines() if line.strip()}
    if not actual or not actual <= allowed:
        return [f"remote.origin: must equal frozen upstream or approved repository_url; got {sorted(actual)!r}"]
    return []


def _valid_relative_path(value: object) -> bool:
    if not isinstance(value, str) or not value or value != value.strip() or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and value == path.as_posix()


def validate_zero_residue_contract(path: Path | str) -> list[str]:
    """Validate the frozen baseline and exact, legal-file-only allowlist."""
    contract, errors = _load_mapping(path)
    if contract is None:
        return errors
    expected_top = {
        "version",
        "analysis_commit",
        "baseline",
        "legal_files",
        "legal_allowlist",
        "negative_test_allowlist",
    }
    required_top = expected_top - {"negative_test_allowlist"}
    errors.extend(f"zero.{field}: missing required field" for field in sorted(required_top - set(contract)))
    errors.extend(f"zero.{field}: unknown field" for field in sorted(set(contract) - expected_top))
    if contract.get("version") != 1 or isinstance(contract.get("version"), bool):
        errors.append("zero.version: must be integer 1")
    commit = contract.get("analysis_commit")
    if not isinstance(commit, str) or not _SHA_RE.fullmatch(commit):
        errors.append("zero.analysis_commit: must be a full lowercase commit SHA")
    baseline = contract.get("baseline")
    if not isinstance(baseline, dict):
        errors.append("zero.baseline: must be a mapping")
    else:
        errors.extend(
            f"zero.baseline.{field}: missing required field" for field in BASELINE_FIELDS if field not in baseline
        )
        errors.extend(f"zero.baseline.{field}: unknown field" for field in sorted(set(baseline) - set(BASELINE_FIELDS)))
        for field in BASELINE_FIELDS:
            value = baseline.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(f"zero.baseline.{field}: must be a non-negative integer")
    legal_files = contract.get("legal_files")
    legal_file_paths: set[str] = set()
    if not isinstance(legal_files, list):
        errors.append("zero.legal_files: must be a list")
    else:
        for index, entry in enumerate(legal_files):
            context = f"zero.legal_files[{index}]"
            if not isinstance(entry, dict):
                errors.append(f"{context}: must be a mapping")
                continue
            errors.extend(
                f"{context}.{field}: missing required field" for field in LEGAL_FILE_FIELDS if field not in entry
            )
            errors.extend(f"{context}.{field}: unknown field" for field in sorted(set(entry) - set(LEGAL_FILE_FIELDS)))
            legal_path = entry.get("path")
            if not _valid_legal_path(legal_path):
                errors.append(f"{context}.path: must be an exact legal path or normalized archive member path")
            elif legal_path in legal_file_paths:
                errors.append(f"{context}.path: duplicate path")
            else:
                legal_file_paths.add(legal_path)
            digest = entry.get("sha256")
            if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
                errors.append(f"{context}.sha256: must be a lowercase SHA-256 digest")

    allowlist = contract.get("legal_allowlist")
    if not isinstance(allowlist, list):
        errors.append("zero.legal_allowlist: must be a list")
    else:
        identities: set[tuple[str, int]] = set()
        for index, entry in enumerate(allowlist):
            context = f"zero.legal_allowlist[{index}]"
            if not isinstance(entry, dict):
                errors.append(f"{context}: must be a mapping")
                continue
            errors.extend(f"{context}.{field}: missing required field" for field in LEGAL_FIELDS if field not in entry)
            errors.extend(f"{context}.{field}: unknown field" for field in sorted(set(entry) - set(LEGAL_FIELDS)))
            legal_path = entry.get("path")
            if not _valid_legal_reference_path(legal_path):
                errors.append(f"{context}.path: must be a normalized relative path or exact legal archive member")
            line = entry.get("line")
            if not isinstance(line, int) or isinstance(line, bool) or line < 1:
                errors.append(f"{context}.line: must be a positive integer")
            expected_text = entry.get("expected_text")
            if not isinstance(expected_text, str) or not expected_text or expected_text != expected_text.strip():
                errors.append(f"{context}.expected_text: must be one exact non-empty line")
            digest = entry.get("sha256")
            if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
                errors.append(f"{context}.sha256: must be a lowercase SHA-256 digest")
            elif isinstance(expected_text, str) and hashlib.sha256(expected_text.encode()).hexdigest() != digest:
                errors.append(f"{context}.sha256: does not fingerprint expected_text")
            identity = (str(legal_path), line if isinstance(line, int) else -1)
            if identity in identities:
                errors.append(f"{context}: duplicate path and line")
            identities.add(identity)

    negative_allowlist = contract.get("negative_test_allowlist", [])
    if not isinstance(negative_allowlist, list):
        errors.append("zero.negative_test_allowlist: must be a list")
    else:
        identities: set[tuple[str, int, str]] = set()
        for index, entry in enumerate(negative_allowlist):
            context = f"zero.negative_test_allowlist[{index}]"
            if not isinstance(entry, dict):
                errors.append(f"{context}: must be a mapping")
                continue
            errors.extend(
                f"{context}.{field}: missing required field" for field in NEGATIVE_TEST_FIELDS if field not in entry
            )
            errors.extend(
                f"{context}.{field}: unknown field" for field in sorted(set(entry) - set(NEGATIVE_TEST_FIELDS))
            )
            negative_path = entry.get("path")
            if not _valid_relative_path(negative_path):
                errors.append(f"{context}.path: must be a normalized relative path")
            line = entry.get("line")
            if not isinstance(line, int) or isinstance(line, bool) or line < 1:
                errors.append(f"{context}.line: must be a positive integer")
            kind = entry.get("kind")
            if kind not in NEGATIVE_TEST_KINDS:
                errors.append(f"{context}.kind: must be an exact scannable identity kind")
            expected_text = entry.get("expected_text")
            if not isinstance(expected_text, str) or not expected_text or expected_text != expected_text.strip():
                errors.append(f"{context}.expected_text: must be one exact non-empty line")
            digest = entry.get("sha256")
            if not isinstance(digest, str) or not _SHA256_RE.fullmatch(digest):
                errors.append(f"{context}.sha256: must be a lowercase SHA-256 digest")
            elif isinstance(expected_text, str) and hashlib.sha256(expected_text.encode()).hexdigest() != digest:
                errors.append(f"{context}.sha256: does not fingerprint expected_text")
            identity = (str(negative_path), line if isinstance(line, int) else -1, str(kind))
            if identity in identities:
                errors.append(f"{context}: duplicate path, line and kind")
            identities.add(identity)
    return sorted(set(errors))


def _valid_legal_path(value: object) -> bool:
    if not isinstance(value, str):
        return False
    if "!" not in value:
        return _valid_relative_path(value) and PurePosixPath(value).name in {"LICENSE", "NOTICE"}
    if value.count("!") != 1:
        return False
    archive_path, member_path = value.split("!", 1)
    return (
        _valid_relative_path(archive_path)
        and _valid_relative_path(member_path)
        and PurePosixPath(member_path).name in {"LICENSE", "NOTICE"}
    )


def _valid_legal_reference_path(value: object) -> bool:
    if not isinstance(value, str):
        return False
    if "!" in value:
        return _valid_legal_path(value)
    return _valid_relative_path(value)


@dataclass(frozen=True)
class Blob:
    path: str
    content: bytes
    scan_issue: str | None = None


def _git(repo: Path, *args: str, text: bool = True) -> str | bytes:
    completed = subprocess.run(  # noqa: S603 - fixed internal Git operations.
        ["git", *args],  # noqa: S607 - Git is intentionally resolved from PATH.
        cwd=repo,
        check=True,
        capture_output=True,
        text=text,
    )
    return completed.stdout


def _object_blobs(repo: Path, revision: str) -> list[Blob]:
    listed = _git(repo, "ls-tree", "-rz", revision, text=False)
    if not isinstance(listed, bytes):
        message = "git ls-tree unexpectedly returned text"
        raise TypeError(message)
    indexed: list[tuple[str, bytes]] = []
    for record in listed.split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        _mode, object_type, object_id = metadata.split()
        if object_type == b"blob":
            indexed.append((path.decode("utf-8", errors="surrogateescape"), object_id))
    indexed.sort()
    completed = subprocess.run(
        ["git", "cat-file", "--batch"],  # noqa: S607 - Git is intentionally resolved from PATH.
        cwd=repo,
        input=b"".join(oid + b"\n" for _, oid in indexed),
        check=True,
        capture_output=True,
    )
    output = completed.stdout
    offset = 0
    blobs: list[Blob] = []
    for path, expected_id in indexed:
        header_end = output.index(b"\n", offset)
        object_id, object_type, raw_size = output[offset:header_end].split()
        if object_id != expected_id or object_type != b"blob":
            message = f"unexpected git object for {path}"
            raise ValueError(message)
        size = int(raw_size)
        start = header_end + 1
        blobs.append(Blob(path, output[start : start + size]))
        offset = start + size + 1
    return blobs


def _worktree_blobs(repo: Path, *, untracked_exclusions: list[dict[str, str]] | None = None) -> list[Blob]:
    tracked = _git(repo, "ls-files", "-z", text=False)
    untracked = _git(repo, "ls-files", "--others", "--exclude-standard", "-z", text=False)
    if not isinstance(tracked, bytes) or not isinstance(untracked, bytes):
        message = "git ls-files unexpectedly returned text"
        raise TypeError(message)
    blobs: list[Blob] = []
    tracked_paths = {item for item in tracked.split(b"\0") if item}
    untracked_paths = {item for item in untracked.split(b"\0") if item}

    def is_frozen_untracked(raw_path: bytes) -> bool:
        relative = raw_path.decode("utf-8", errors="surrogateescape")
        return any(
            (item["kind"] == "file" and relative == item["path"])
            or (item["kind"] == "prefix" and relative.startswith(item["path"]))
            for item in untracked_exclusions or []
        )

    listed = tracked_paths | {item for item in untracked_paths if not is_frozen_untracked(item)}
    for raw_path in sorted(item for item in listed if item):
        relative = raw_path.decode("utf-8", errors="surrogateescape")
        path = repo / relative
        if path.is_symlink():
            blobs.append(Blob(relative, path.readlink().as_posix().encode()))
        elif path.is_file():
            blobs.append(Blob(relative, path.read_bytes()))
    return blobs


def _filesystem_blobs(root: Path) -> list[Blob]:
    blobs: list[Blob] = []
    for path in sorted(root.rglob("*")):
        if ".git" in path.relative_to(root).parts or not path.is_file() or path.is_symlink():
            continue
        blobs.append(Blob(path.relative_to(root).as_posix(), path.read_bytes()))
    return blobs


def _is_archive_path(path: str) -> bool:
    return path.lower().endswith((".zip", ".whl", ".jar", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tar.xz"))


def _archive_blobs(blob: Blob) -> Iterable[Blob]:
    lowered = blob.path.lower()
    if not _is_archive_path(lowered):
        return
    stream = io.BytesIO(blob.content)
    if lowered.endswith((".zip", ".whl", ".jar")):
        try:
            with zipfile.ZipFile(stream) as archive:
                infos = sorted(archive.infolist(), key=lambda item: item.filename)
                if len(infos) > MAX_ARCHIVE_MEMBERS:
                    yield Blob(f"{blob.path}!<member-limit>", b"", "archive_member_limit")
                duplicate_names = {
                    name for name, count in Counter(info.filename for info in infos).items() if count > 1
                }
                for name in sorted(duplicate_names):
                    yield Blob(f"{blob.path}!{name}", b"", "duplicate_archive_member")
                for info in infos[:MAX_ARCHIVE_MEMBERS]:
                    if info.is_dir() or info.filename in duplicate_names:
                        continue
                    member_path = f"{blob.path}!{info.filename}"
                    if info.file_size > MAX_ARCHIVE_MEMBER_BYTES:
                        yield Blob(member_path, b"", "archive_member_size_limit")
                    else:
                        yield Blob(member_path, archive.read(info))
        except (OSError, ValueError, zipfile.BadZipFile):
            yield Blob(f"{blob.path}!<archive>", b"", "malformed_archive")
        return
    try:
        with tarfile.open(fileobj=stream, mode="r:*") as archive:
            members = sorted(archive.getmembers(), key=lambda item: item.name)
            if len(members) > MAX_ARCHIVE_MEMBERS:
                yield Blob(f"{blob.path}!<member-limit>", b"", "archive_member_limit")
            duplicate_names = {name for name, count in Counter(member.name for member in members).items() if count > 1}
            for name in sorted(duplicate_names):
                yield Blob(f"{blob.path}!{name}", b"", "duplicate_archive_member")
            for member in members[:MAX_ARCHIVE_MEMBERS]:
                if not member.isfile() or member.name in duplicate_names:
                    continue
                member_path = f"{blob.path}!{member.name}"
                if member.size > MAX_ARCHIVE_MEMBER_BYTES:
                    yield Blob(member_path, b"", "archive_member_size_limit")
                    continue
                extracted = archive.extractfile(member)
                if extracted is not None:
                    yield Blob(member_path, extracted.read())
    except (OSError, tarfile.TarError):
        yield Blob(f"{blob.path}!<archive>", b"", "malformed_archive")


def _expand_blob(blob: Blob, *, depth: int) -> Iterable[Blob]:
    if depth >= MAX_ARCHIVE_DEPTH:
        yield Blob(blob.path, b"", "archive_depth_limit") if _is_archive_path(blob.path) else blob
        return
    archive_members = iter(_archive_blobs(blob))
    try:
        first_member = next(archive_members)
    except StopIteration:
        yield blob
        return
    yield Blob(blob.path, b"")
    for member in chain((first_member,), archive_members):
        yield from _expand_blob(member, depth=depth + 1)


def _expanded_blobs(blobs: Iterable[Blob]) -> Iterable[Blob]:
    for blob in blobs:
        yield from _expand_blob(blob, depth=0)


def _matches(pattern: re.Pattern[bytes], content: bytes) -> list[tuple[int, bytes]]:
    matches: list[tuple[int, bytes]] = []
    line_number = 1
    cursor = 0
    for match in pattern.finditer(content):
        line_number += content.count(b"\n", cursor, match.start())
        matches.append((line_number, match.group()))
        cursor = match.start()
    return matches


def _visible_surface(path: str) -> bool:
    lowered = path.casefold()
    return lowered.endswith((".md", ".mdx", ".html", ".htm", ".svg")) or any(
        marker in lowered for marker in ("src/frontend/", "docs/", "readme", "locales/", "public/")
    )


def _technical_locator(path: str, line_number: int, line: str, kind: str) -> str | None:
    lowered_path = path.casefold()
    lowered = line.casefold()
    if path == _LEGACY_CONTRACT_RELATIVE_PATH:
        stripped = lowered.lstrip()
        if line_number == 0:
            return f"historical_fixture:{path}:0"
        if stripped.startswith("frozen_upstream_remote:"):
            return f"external_resource_id:{path}:{line_number}"
        if line_number == _LEGACY_CONTRACT_SELF_PATH_LINE and line.lstrip() == _LEGACY_CONTRACT_SELF_PATH_SCALAR:
            return f"historical_fixture:{path}:{line_number}"
        if stripped.startswith("path:"):
            return f"historical_fixture:{path}:{line_number}"
    if re.search(rf"\b{re.escape(_LEGACY_PRODUCT_TEXT.upper())}_[A-Z0-9_]+\b", line):
        return f"env_alias:{path}:{line_number}"
    if re.search(rf"(?<![a-z0-9_])--{re.escape(_LEGACY_PRODUCT_TEXT)}-[a-z0-9-]+", lowered):
        return f"cli_alias:{path}:{line_number}"
    if re.search(rf"\b{re.escape(_LEGACY_EXECUTOR_TEXT.upper())}_[A-Z0-9_]+\b", line):
        return f"env_alias:{path}:{line_number}"
    if re.search(rf"(?<![a-z0-9_])--{re.escape(_LEGACY_EXECUTOR_TEXT)}-[a-z0-9-]+", lowered):
        return f"cli_alias:{path}:{line_number}"
    if path == S2_COMPATIBILITY_ACCEPTANCE_TEST_PATH:
        stripped = lowered.strip().removesuffix(",")
        if stripped in {
            f'"{_LEGACY_PRODUCT_TEXT}"',
            f'"{_LEGACY_EXECUTOR_TEXT}"',
            f'"{_LEGACY_EXECUTOR_TEXT}-mcp"',
        }:
            return f"cli_alias:{path}:{line_number}"
        if "pytest11" in lowered:
            return f"import_alias:pytest_alias:{path}:{line_number}"
        return f"import_alias:package_alias:{path}:{line_number}"
    if path == S2_COMPATIBILITY_CHECKER_PATH:
        if lowered.lstrip().startswith("all_clis ="):
            return f"cli_alias:{path}:{line_number}"
        return f"import_alias:package_alias:{path}:{line_number}"
    if path == S2_DISTRIBUTION_CONTRACT_PATH:
        if lowered.strip() in {
            f"- {_LEGACY_PRODUCT_TEXT}",
            f"- {_LEGACY_EXECUTOR_TEXT}",
            f"- {_LEGACY_EXECUTOR_TEXT}-mcp",
        }:
            return f"cli_alias:{path}:{line_number}"
        return f"import_alias:package_alias:{path}:{line_number}"
    if path in PYTEST_COMPATIBILITY_BRIDGE_PATHS:
        return f"import_alias:pytest_alias:{path}:{line_number}"
    if path in WORKSPACE_PACKAGE_MANIFEST_PATHS:
        return f"import_alias:package_alias:{path}:{line_number}"
    if lowered_path.startswith("src/compat/"):
        return f"import_alias:package_alias:{path}:{line_number}"
    if kind.startswith("legacy_executor") and any(
        token in lowered
        for token in (
            "import " + _LEGACY_EXECUTOR_TEXT,
            "from " + _LEGACY_EXECUTOR_TEXT,
            'name = "' + _LEGACY_EXECUTOR_TEXT + '"',
            "'" + _LEGACY_EXECUTOR_TEXT + "'",
            '"' + _LEGACY_EXECUTOR_TEXT + '"',
        )
    ):
        return f"import_alias:package_alias:{path}:{line_number}"
    if kind.startswith("legacy_brand") and (
        any(
            token in lowered
            for token in (
                "import " + _LEGACY_PRODUCT_TEXT,
                "from " + _LEGACY_PRODUCT_TEXT,
                'name = "' + _LEGACY_PRODUCT_TEXT,
                "name = '" + _LEGACY_PRODUCT_TEXT,
                _LEGACY_PRODUCT_TEXT + "-sdk",
                _LEGACY_PRODUCT_TEXT + "-base",
                _LEGACY_PRODUCT_TEXT + "-stepflow",
                _LEGACY_PRODUCT_TEXT + "_sdk",
                _LEGACY_PRODUCT_TEXT + "_stepflow",
            )
        )
        or re.search(rf"\b{re.escape(_LEGACY_PRODUCT_TEXT.capitalize())}[A-Z][A-Za-z0-9_]*\b", line) is not None
    ):
        return f"import_alias:package_alias:{path}:{line_number}"
    if any(
        token in lowered
        for token in (
            _LEGACY_PRODUCT_TEXT + ".components",
            "tool." + _LEGACY_PRODUCT_TEXT,
            _LEGACY_PRODUCT_TEXT + ".extensions",
        )
    ):
        return f"historical_fixture:extension_manifest:{path}:{line_number}"
    if "." + _LEGACY_PRODUCT_TEXT in lowered:
        return f"data_path:{path}:{line_number}"
    if any(
        marker in lowered_path for marker in ("migration", "alembic", "brand_state", "brand_env", "stage5-env-contract")
    ):
        return f"historical_migration:{path}:{line_number}"
    if any(marker in lowered_path for marker in ("fixture", "starter", "snapshot")):
        return f"historical_fixture:{path}:{line_number}"
    if any(token in lowered for token in ("queue", "header", "protocol", "redis", "celery")):
        return f"wire_protocol:{path}:{line_number}"
    return None


def _legacy_locator_match_limits(
    legacy: dict[str, Any],
    *,
    repository_root: Path | str | None = None,
) -> dict[str, int]:
    """Bind each ledger item to the exact match count at its source location."""
    root = Path(repository_root or Path.cwd()).resolve()
    limits: dict[str, int] = {}
    for item in legacy.get("occurrences", []):
        locator = item["locator"]
        locator_prefix = item.get("category", "")
        subtype = item.get("subtype")
        if subtype is not None:
            locator_prefix += f":{subtype}"
        locator_body = locator.removeprefix(locator_prefix + ":")
        locator_path, _, locator_line_text = locator_body.rpartition(":")
        if not locator_line_text.isdigit():
            limits[locator] = 1
            continue
        locator_line = int(locator_line_text)
        if locator_line == 0:
            source_text = locator_path
        else:
            source_path = root / locator_path
            try:
                source_lines = source_path.read_text(encoding="utf-8").splitlines()
                source_text = source_lines[locator_line - 1]
            except (OSError, IndexError, UnicodeError):
                limits[locator] = 1
                continue
        encoded = source_text.encode("utf-8")
        match_count = 0
        for kind, pattern in (("legacy_brand", _PRODUCT_RE), ("legacy_executor", _EXECUTOR_RE)):
            if _technical_locator(locator_path, locator_line, source_text, kind) == locator:
                match_count += len(pattern.findall(encoded))
        limits[locator] = max(match_count, 1)
    return limits


def _add_pending_evidence_violation(report: dict[str, Any], legacy: dict[str, Any], profile: str) -> None:
    evidence = legacy["baseline"]["scanner_outputs"][profile]
    if evidence["verdict"] == "PENDING":
        report["violations"].append(
            {
                "kind": "baseline_evidence_pending",
                "path": _LEGACY_CONTRACT_RELATIVE_PATH,
                "line": 0,
                "match": profile,
            }
        )


def _is_opaque_media_content(path: str, content: bytes) -> bool:
    """Identify compressed media that is verified separately by OCR and metadata gates."""
    suffix = PurePosixPath(path.rsplit("!", 1)[-1]).suffix.lower()
    if suffix == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return content.startswith(b"\xff\xd8\xff")
    if suffix == ".gif":
        return content.startswith((b"GIF87a", b"GIF89a"))
    if suffix == ".ico":
        return content.startswith(b"\x00\x00\x01\x00")
    if suffix == ".webp":
        return content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if suffix in {".mp4", ".mov"}:
        return len(content) >= MIN_ISO_MEDIA_HEADER_BYTES and content[4:8] == b"ftyp"
    return False


def _scan_blobs(
    blobs: Iterable[Blob],
    contract: dict[str, Any],
    *,
    profile: str,
    excluded_path: str | None,
    legacy_locators: set[str] | None = None,
    legacy_locator_limits: dict[str, int] | None = None,
) -> dict[str, Any]:
    legal_by_location = {(entry["path"], entry["line"]): entry for entry in contract["legal_allowlist"]}
    legal_paths = {entry["path"] for entry in contract["legal_allowlist"]}
    violations: list[dict[str, Any]] = []
    allowed: list[dict[str, Any]] = []
    brand_files: set[str] = set()
    executor_files: set[str] = set()
    brand_match_count = executor_match_count = 0
    brand_path_count = executor_path_count = 0
    upstream_endpoint_count = 0
    scan_issue_count = 0
    path_counts: dict[str, dict[str, int]] = {}
    matched_legacy_occurrences: dict[str, str] = {}
    matched_legacy_counts: Counter[str] = Counter()

    expanded = _expanded_blobs(blobs)
    scanned_blobs: dict[str, Blob] = {}
    seen_paths: set[str] = set()
    matched_legal_locations: set[tuple[str, int]] = set()
    for blob in expanded:
        if blob.path == excluded_path:
            continue
        if blob.path in seen_paths:
            scan_issue_count += 1
            counts = path_counts.setdefault(blob.path, dict.fromkeys(BASELINE_FIELDS, 0))
            counts["scan_issue_count"] += 1
            if profile in PROFILES:
                violations.append(
                    {"kind": "duplicate_scan_path", "path": blob.path, "line": 0, "match": "ambiguous blob path"}
                )
            continue
        seen_paths.add(blob.path)
        if blob.scan_issue is not None:
            scan_issue_count += 1
            counts = path_counts.setdefault(blob.path, dict.fromkeys(BASELINE_FIELDS, 0))
            counts["scan_issue_count"] += 1
            if profile in PROFILES:
                violations.append(
                    {"kind": blob.scan_issue, "path": blob.path, "line": 0, "match": "fail-closed archive scan"}
                )
            continue
        scanned_blobs[blob.path] = blob
        path_bytes = blob.path.encode("utf-8", errors="surrogateescape")
        path_brand = _PRODUCT_RE.findall(path_bytes)
        path_executor = _EXECUTOR_RE.findall(path_bytes)
        brand_path_count += bool(path_brand)
        executor_path_count += bool(path_executor)
        findings: list[tuple[str, int, bytes]] = []
        if not _is_opaque_media_content(blob.path, blob.content):
            findings.extend(("legacy_brand", line, match) for line, match in _matches(_PRODUCT_RE, blob.content))
            findings.extend(("legacy_executor", line, match) for line, match in _matches(_EXECUTOR_RE, blob.content))
            findings.extend(
                ("upstream_endpoint", line, match) for line, match in _matches(_UPSTREAM_ENDPOINT_RE, blob.content)
            )
            if profile == "official-url":
                findings.extend(
                    ("official_url", line, match) for line, match in _matches(_OFFICIAL_URL_RE, blob.content)
                )
        findings.extend(("legacy_brand_filename", 0, match) for match in path_brand)
        findings.extend(("legacy_executor_filename", 0, match) for match in path_executor)
        content_brand_count = sum(kind == "legacy_brand" for kind, _, _ in findings)
        content_executor_count = sum(kind == "legacy_executor" for kind, _, _ in findings)
        content_upstream_count = sum(kind == "upstream_endpoint" for kind, _, _ in findings)
        allowed_brand_count = allowed_executor_count = allowed_upstream_count = 0
        for kind, line, matched in findings:
            item = {"kind": kind, "path": blob.path, "line": line, "match": matched.decode("utf-8", errors="replace")}
            if line > 0 and blob.path in legal_paths:
                lines = blob.content.decode("utf-8", errors="replace").splitlines()
                text = lines[line - 1] if line <= len(lines) else ""
                entry = legal_by_location.get((blob.path, line))
                if (
                    entry
                    and text == entry["expected_text"]
                    and hashlib.sha256(text.encode()).hexdigest() == entry["sha256"]
                ):
                    allowed.append({**item, "kind": "legal_provenance"})
                    matched_legal_locations.add((blob.path, line))
                    allowed_brand_count += kind == "legacy_brand"
                    allowed_executor_count += kind == "legacy_executor"
                    allowed_upstream_count += kind == "upstream_endpoint"
                    continue
                item["kind"] = "legal_mismatch"
            if (
                profile == "visible"
                and _visible_surface(blob.path)
                and kind.startswith(("legacy_brand", "legacy_executor"))
            ):
                violations.append({**item, "kind": "visible_residue"})
            elif profile == "official-url" and kind in {"official_url", "upstream_endpoint"}:
                violations.append(item)
            elif profile == "technical-compatibility" and kind.startswith(("legacy_brand", "legacy_executor")):
                lines = blob.content.decode("utf-8", errors="replace").splitlines()
                text = lines[line - 1] if line > 0 and line <= len(lines) else blob.path
                locator = _technical_locator(blob.path, line, text, kind)
                if not _visible_surface(blob.path):
                    if locator is not None:
                        matched_legacy_occurrences[locator] = blob.path
                        matched_legacy_counts[locator] += 1
                    if locator in (legacy_locators or set()):
                        limit = (legacy_locator_limits or {}).get(locator, 1)
                        if matched_legacy_counts[locator] > limit:
                            violations.append(
                                {
                                    **item,
                                    "kind": "duplicate_ledgered_technical_residue",
                                    "locator": locator,
                                }
                            )
                    else:
                        violations.append(
                            {
                                **item,
                                "kind": "unledgered_technical_residue",
                                "locator": locator or f"unclassified:{blob.path}:{line}",
                            }
                        )
            elif item["kind"] == "legal_mismatch":
                violations.append(item)
        content_brand_count -= allowed_brand_count
        content_executor_count -= allowed_executor_count
        content_upstream_count -= allowed_upstream_count
        path_counts[blob.path] = {
            "brand_file_count": int(bool(content_brand_count)),
            "brand_match_count": content_brand_count,
            "brand_path_count": int(bool(path_brand)),
            "executor_file_count": int(bool(content_executor_count)),
            "executor_match_count": content_executor_count,
            "executor_path_count": int(bool(path_executor)),
            "upstream_endpoint_count": content_upstream_count,
            "scan_issue_count": 0,
        }
        if content_brand_count:
            brand_files.add(blob.path)
            brand_match_count += content_brand_count
        if content_executor_count:
            executor_files.add(blob.path)
            executor_match_count += content_executor_count
        upstream_endpoint_count += content_upstream_count

    baseline = {
        "brand_file_count": len(brand_files),
        "brand_match_count": brand_match_count,
        "brand_path_count": brand_path_count,
        "executor_file_count": len(executor_files),
        "executor_match_count": executor_match_count,
        "executor_path_count": executor_path_count,
        "upstream_endpoint_count": upstream_endpoint_count,
        "scan_issue_count": scan_issue_count,
    }
    for legal_file in contract["legal_files"]:
        legal_path = legal_file["path"]
        blob = scanned_blobs.get(legal_path)
        if blob is None:
            if profile in PROFILES:
                violations.append(
                    {"kind": "missing_legal_file", "path": legal_path, "line": 0, "match": legal_file["sha256"]}
                )
            continue
        actual_digest = hashlib.sha256(blob.content).hexdigest()
        if actual_digest != legal_file["sha256"]:
            violations.append(
                {
                    "kind": "legal_file_mismatch",
                    "path": legal_path,
                    "line": 0,
                    "match": actual_digest,
                    "expected": legal_file["sha256"],
                }
            )
    if profile in PROFILES:
        for legal_path, line in sorted(set(legal_by_location) - matched_legal_locations):
            entry = legal_by_location[(legal_path, line)]
            violations.append(
                {
                    "kind": "missing_legal_occurrence",
                    "path": legal_path,
                    "line": line,
                    "match": entry["expected_text"],
                }
            )

    def key(item: dict[str, Any]) -> tuple[str, int, str, str]:
        return (item["path"], item["line"], item["kind"], item["match"])

    return {
        "baseline": baseline,
        "allowed_residue": sorted(allowed, key=key),
        "violations": sorted(violations, key=key),
        "contract_errors": [],
        "_path_counts": path_counts,
        "_matched_legacy_occurrences": [
            {"locator": locator, "path": matched_legacy_occurrences[locator]}
            for locator in sorted(matched_legacy_occurrences)
        ],
    }


def scan_root(
    root: Path | str,
    zero_residue_contract_path: Path | str,
    *,
    profile: str = "technical-compatibility",
    legacy_contract_path: Path | str | None = None,
) -> dict[str, Any]:
    """Scan every regular file below a clean worktree or unpacked artifact root."""
    if profile not in PROFILES:
        message = f"unknown scan profile: {profile}"
        raise ValueError(message)
    root_path = Path(root).resolve()
    contract_path = Path(zero_residue_contract_path).resolve()
    errors = validate_zero_residue_contract(contract_path)
    contract, _ = _load_mapping(contract_path)
    if errors or contract is None:
        return {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": errors}
    try:
        excluded = contract_path.relative_to(root_path).as_posix()
    except ValueError:
        excluded = None
    legacy_path = Path(legacy_contract_path or Path(__file__).resolve().parents[2] / _LEGACY_CONTRACT_RELATIVE_PATH)
    legacy_errors = validate_legacy_contract(legacy_path) if profile in PROFILES else []
    legacy, _ = _load_mapping(legacy_path)
    if legacy_errors:
        return {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": legacy_errors}
    locators = {item["locator"] for item in (legacy or {}).get("occurrences", [])}
    report = _scan_blobs(
        _filesystem_blobs(root_path),
        contract,
        profile=profile,
        excluded_path=excluded,
        legacy_locators=locators,
        legacy_locator_limits=_legacy_locator_match_limits(
            legacy or {}, repository_root=legacy_path.resolve().parents[1]
        ),
    )
    _add_pending_evidence_violation(report, legacy or {}, profile)
    report.pop("_path_counts")
    report.pop("_matched_legacy_occurrences")
    return report


def _has_tracked_worktree_changes(repo: Path) -> bool:
    status = _git(repo, "status", "--porcelain", "--untracked-files=normal")
    if not isinstance(status, str):
        message = "git status unexpectedly returned bytes"
        raise TypeError(message)
    return bool(status.strip())


def _repository_source_blobs(repo: Path, legacy: dict[str, Any]) -> list[Blob]:
    if _has_tracked_worktree_changes(repo):
        return _worktree_blobs(
            repo,
            untracked_exclusions=legacy.get("baseline", {}).get("untracked_exclusions", []),
        )
    return _object_blobs(repo, "HEAD")


def _source_scope(blobs: list[Blob], legacy: dict[str, Any]) -> list[dict[str, str]]:
    semantic_digest = _legacy_semantics_sha256(legacy)
    return [
        {
            "path": blob.path,
            "sha256": semantic_digest
            if blob.path == _LEGACY_CONTRACT_RELATIVE_PATH
            else hashlib.sha256(blob.content).hexdigest(),
        }
        for blob in sorted(blobs, key=lambda item: item.path)
    ]


def _compute_baseline_evidence(
    repo: Path,
    zero_residue_contract_path: Path,
    legacy: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    zero_errors = validate_zero_residue_contract(zero_residue_contract_path)
    zero, _ = _load_mapping(zero_residue_contract_path)
    if zero_errors or zero is None:
        message = "; ".join(zero_errors) or "zero-residue contract is unavailable"
        raise ValueError(message)

    blobs = _repository_source_blobs(repo, legacy)
    try:
        excluded_path = zero_residue_contract_path.resolve().relative_to(repo).as_posix()
    except ValueError:
        excluded_path = None
    expected_locators = {item["locator"] for item in legacy.get("occurrences", [])}
    locator_limits = _legacy_locator_match_limits(legacy, repository_root=repo)
    reports: dict[str, dict[str, Any]] = {}
    for profile in PROFILES:
        reports[profile] = _scan_blobs(
            blobs,
            zero,
            profile=profile,
            excluded_path=excluded_path,
            legacy_locators=expected_locators,
            legacy_locator_limits=locator_limits,
        )

    matched_occurrences = reports["technical-compatibility"]["_matched_legacy_occurrences"]
    matched_locators = {item["locator"] for item in matched_occurrences}
    if matched_locators != expected_locators:
        missing = sorted(expected_locators - matched_locators)
        unexpected = sorted(matched_locators - expected_locators)
        message = f"technical locator set mismatch: missing={missing!r}, unexpected={unexpected!r}"
        raise ValueError(message)

    for profile, report in reports.items():
        if report["contract_errors"] or report["violations"]:
            message = (
                f"{profile} cannot produce PASS evidence: "
                f"{len(report['contract_errors'])} contract errors, {len(report['violations'])} violations"
            )
            raise ValueError(message)

    matched_paths = sorted({item["path"] for item in matched_occurrences})
    patch: dict[str, Any] = {
        "visible_count": 0,
        "official_url_count": 0,
        "technical_compatibility_count": len(matched_locators),
        "paths": matched_paths,
        "paths_sha256": _canonical_sha256(matched_paths),
    }
    draft = deepcopy(legacy)
    draft["baseline"].update(patch)
    source_scope = _source_scope(blobs, draft)
    effective_source_sha256 = _canonical_sha256(source_scope)
    semantic_digest = _legacy_semantics_sha256(draft)

    payloads: dict[str, dict[str, Any]] = {}
    for profile, report in reports.items():
        clean_report = {
            key: value for key, value in report.items() if key not in {"_path_counts", "_matched_legacy_occurrences"}
        }
        payload: dict[str, Any] = {
            "profile": profile,
            "effective_source_sha256": effective_source_sha256,
            "legacy_semantics_sha256": semantic_digest,
            "visible_count": patch["visible_count"],
            "official_url_count": patch["official_url_count"],
            "technical_compatibility_count": patch["technical_compatibility_count"],
            "paths": patch["paths"],
            "paths_sha256": patch["paths_sha256"],
            "result": clean_report,
            "matched_legacy_locators": [],
            "matched_legacy_occurrences": [],
        }
        if profile == "technical-compatibility":
            payload["matched_legacy_locators"] = sorted(matched_locators)
            payload["matched_legacy_occurrences"] = matched_occurrences
        payloads[profile] = payload

    patch["scanner_outputs"] = {
        profile: {"verdict": "PASS", "sha256": _canonical_sha256(payloads[profile])} for profile in PROFILES
    }
    packet = {
        "effective_source_sha256": effective_source_sha256,
        "contract_patch": patch,
        "source_scope": source_scope,
        "payloads": payloads,
    }
    return packet, reports


def prepare_baseline_evidence(
    repo: Path | str,
    zero_residue_contract_path: Path | str,
    legacy_contract_path: Path | str,
) -> dict[str, Any]:
    """Build an all-profile PASS patch without mutating source or contract files."""
    repo_path = Path(repo).resolve()
    zero_path = Path(zero_residue_contract_path).resolve()
    legacy_path = Path(legacy_contract_path).resolve()
    legacy, load_errors = _load_mapping(legacy_path)
    errors = [*load_errors, *validate_legacy_contract(legacy_path, repository_root=repo_path)]
    if errors or legacy is None:
        raise ValueError("; ".join(sorted(set(errors))))
    verdicts = {item.get("verdict") for item in legacy["baseline"]["scanner_outputs"].values()}
    if verdicts != {"PENDING"}:
        message = "prepare-baseline-evidence requires an atomic all-PENDING contract"
        raise ValueError(message)
    packet, _reports = _compute_baseline_evidence(repo_path, zero_path, legacy)
    return packet


def scan_repository(
    repo: Path | str,
    zero_residue_contract_path: Path | str,
    *,
    profile: str = "technical-compatibility",
    legacy_contract_path: Path | str | None = None,
) -> dict[str, Any]:
    """Scan the current Git index, the reproducible Stage 0 scope boundary."""
    if profile not in PROFILES:
        message = f"unknown scan profile: {profile}"
        raise ValueError(message)
    repo_path = Path(repo).resolve()
    contract_path = Path(zero_residue_contract_path).resolve()
    errors = validate_zero_residue_contract(contract_path)
    contract, _ = _load_mapping(contract_path)
    if errors or contract is None:
        return {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": errors}
    try:
        excluded = contract_path.relative_to(repo_path).as_posix()
    except ValueError:
        excluded = None
    legacy_path = Path(legacy_contract_path or repo_path / _LEGACY_CONTRACT_RELATIVE_PATH)
    legacy_errors = validate_legacy_contract(legacy_path, repository_root=repo_path) if profile in PROFILES else []
    legacy, _ = _load_mapping(legacy_path)
    if legacy_errors:
        return {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": legacy_errors}
    locators = {item["locator"] for item in (legacy or {}).get("occurrences", [])}
    locator_limits = _legacy_locator_match_limits(legacy or {}, repository_root=repo_path)
    if _has_tracked_worktree_changes(repo_path):
        report = _scan_blobs(
            _worktree_blobs(
                repo_path,
                untracked_exclusions=(legacy or {}).get("baseline", {}).get("untracked_exclusions", []),
            ),
            contract,
            profile=profile,
            excluded_path=excluded,
            legacy_locators=locators,
            legacy_locator_limits=locator_limits,
        )
    else:
        report = _scan_blobs(
            _object_blobs(repo_path, "HEAD"),
            contract,
            profile=profile,
            excluded_path=excluded,
            legacy_locators=locators,
            legacy_locator_limits=locator_limits,
        )
    evidence_states = {
        item.get("verdict") for item in (legacy or {}).get("baseline", {}).get("scanner_outputs", {}).values()
    }
    if evidence_states == {"PASS"}:
        try:
            packet, _reports = _compute_baseline_evidence(repo_path, contract_path, legacy or {})
        except ValueError as exc:
            report["contract_errors"].append(f"baseline evidence stale or forged: {exc}")
        else:
            stored = (legacy or {})["baseline"]
            expected_patch = packet["contract_patch"]
            bound_fields = (
                "visible_count",
                "official_url_count",
                "technical_compatibility_count",
                "paths",
                "paths_sha256",
            )
            mismatched = [field for field in bound_fields if stored.get(field) != expected_patch[field]]
            for evidence_profile in PROFILES:
                expected_output = expected_patch["scanner_outputs"][evidence_profile]
                if stored["scanner_outputs"][evidence_profile] != expected_output:
                    mismatched.append(f"scanner_outputs.{evidence_profile}")
            if mismatched:
                report["contract_errors"].append(
                    f"baseline evidence stale or forged: mismatched {', '.join(mismatched)}"
                )
    else:
        _add_pending_evidence_violation(report, legacy or {}, profile)
    report.pop("_path_counts")
    report.pop("_matched_legacy_occurrences")
    return report


def _render_text(report: dict[str, Any]) -> str:
    if report["contract_errors"]:
        return "".join(f"CONTRACT ERROR: {error}\n" for error in report["contract_errors"])
    if report["violations"]:
        lines = []
        for item in report["violations"]:
            location = item["path"] or "<scan-root>"
            if item["line"]:
                location += f":{item['line']}"
            lines.append(f"FAIL {item['kind']} {location}: {item['match']}\n")
        return "".join(lines)
    return f"PASS Ketos {len(report['allowed_residue'])}-exception legal scan\n"


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=root, help="repository whose current Git index is scanned")
    parser.add_argument("--scan-root", type=Path, help="scan every file under a clean worktree or unpacked artifact")
    parser.add_argument("--brand-contract", type=Path, default=root / "brand/ketos-brand-contract.yaml")
    parser.add_argument("--legacy-contract", type=Path, default=root / _LEGACY_CONTRACT_RELATIVE_PATH)
    parser.add_argument(
        "--zero-residue-contract",
        type=Path,
        default=root / "brand/ketos-zero-residue-contract.yaml",
    )
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--profile", choices=PROFILES)
    action.add_argument(
        "--prepare-baseline-evidence",
        action="store_true",
        help="print a deterministic all-profile PASS contract patch without writing files",
    )
    parser.add_argument("--format", choices=("json", "text"), default="text")
    args = parser.parse_args(argv)

    if args.prepare_baseline_evidence:
        if args.scan_root is not None:
            parser.error("--prepare-baseline-evidence cannot be combined with --scan-root")
        try:
            packet = prepare_baseline_evidence(args.repo, args.zero_residue_contract, args.legacy_contract)
        except (OSError, subprocess.CalledProcessError, ValueError, zipfile.BadZipFile, tarfile.TarError) as exc:
            sys.stderr.write(f"CONTRACT ERROR: {exc}\n")
            return 1
        sys.stdout.write(json.dumps(packet, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        return 0

    brand_errors = validate_brand_contract(args.brand_contract)
    try:
        report = (
            scan_root(
                args.scan_root,
                args.zero_residue_contract,
                profile=args.profile,
                legacy_contract_path=args.legacy_contract,
            )
            if args.scan_root
            else scan_repository(
                args.repo,
                args.zero_residue_contract,
                profile=args.profile,
                legacy_contract_path=args.legacy_contract,
            )
        )
    except (OSError, subprocess.CalledProcessError, ValueError, zipfile.BadZipFile, tarfile.TarError) as exc:
        report = {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": [str(exc)]}
    legacy_errors = validate_legacy_contract(args.legacy_contract)
    remote_errors = [] if args.scan_root else validate_remote_policy(args.repo, args.brand_contract)
    report["contract_errors"] = sorted([*brand_errors, *legacy_errors, *remote_errors, *report["contract_errors"]])
    sys.stdout.write(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        if args.format == "json"
        else _render_text(report)
    )
    if report["contract_errors"]:
        return 2
    return 1 if report["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
