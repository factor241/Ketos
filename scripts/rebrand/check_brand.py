"""Enforce the Ketos destructive cutover and exact legal provenance contract."""

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
from dataclasses import dataclass
from itertools import chain
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

import yaml

if TYPE_CHECKING:
    from collections.abc import Iterable

PROFILES = ("stage0", "cutover")
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
LEGAL_FILES = {"LICENSE", "NOTICE", "src/ketos-stepflow/NOTICE"}
LEGAL_FIELDS = ("path", "line", "expected_text", "sha256")
LEGAL_FILE_FIELDS = ("path", "sha256")

_PRODUCT_PATTERN = rb"lang" + rb"[-_ ]?" + rb"flow"
_EXECUTOR_PATTERN = rb"(?<![A-Za-z0-9])l" + rb"fx(?![A-Za-z0-9])"
_PRODUCT_RE = re.compile(_PRODUCT_PATTERN, re.IGNORECASE)
_EXECUTOR_RE = re.compile(_EXECUTOR_PATTERN, re.IGNORECASE)
_UPSTREAM_ENDPOINT_RE = re.compile(
    rb"(?:https?://api\.sc" + rb"arf\.sh/v1/pixel|discord\.(?:gg|com/invite)/EqksyE2EX9)",
    re.IGNORECASE,
)
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

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
    "extension_entry_point",
    "extension_tool_table",
    "env_prefix",
    "config_home",
    "application_data_home",
    "database_file",
    "environment_file",
    "redis_prefix",
    "celery_queue",
    "header_prefix",
    "stepflow_route_prefix",
    "stepflow_type_prefix",
    "stepflow_type_marker",
    "local_web_url",
    "local_api_url",
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
    "search_url",
    "chat_widget_url",
    "logo_source_sha256",
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
    "extension_entry_point": "ketos.extensions",
    "extension_tool_table": "tool.ketos.extension",
    "env_prefix": "KETOS_",
    "config_home": "~/.config/ketos",
    "application_data_home": "~/.ketos",
    "database_file": "ketos.db",
    "environment_file": "ketos-environments.toml",
    "redis_prefix": "ketos:",
    "celery_queue": "ketos",
    "header_prefix": "x-ketos-",
    "stepflow_route_prefix": "/ketos/",
    "stepflow_type_prefix": "ketos_",
    "stepflow_type_marker": "__ketos_type__",
    "local_web_url": "http://localhost:3000",
    "local_api_url": "http://localhost:7860",
    "site_url": "https://ketos.test",
    "docs_url": "https://docs.ketos.test",
    "repository_url": "https://git.ketos.test/ketos/ketos",
    "issues_url": "https://git.ketos.test/ketos/ketos/issues",
    "schema_base_url": "https://schemas.ketos.test",
    "container_registry_namespace": "registry.ketos.test/ketos",
    "support_url": None,
    "telemetry_url": None,
    "store_url": None,
    "social_links": [],
    "analytics_properties": [],
    "search_url": None,
    "chat_widget_url": None,
    "logo_source_sha256": "cb895e5fafde4006cc17872c8537bbd4b3ba8c0f4b9304bcff2303184e0eaca3",
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
        if field in contract and contract[field] != canonical:
            errors.append(f"brand.{field}: must equal canonical value {canonical!r}")
    for field in ("site_url", "docs_url", "repository_url", "issues_url", "schema_base_url"):
        value = contract.get(field)
        if isinstance(value, str):
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.hostname:
                errors.append(f"brand.{field}: must be an absolute HTTPS URL")
    return sorted(set(errors))


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
    expected_top = {"version", "analysis_commit", "baseline", "legal_files", "legal_allowlist"}
    errors.extend(f"zero.{field}: missing required field" for field in sorted(expected_top - set(contract)))
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
            if not _valid_legal_path(legal_path):
                errors.append(f"{context}.path: must be an exact legal path or normalized archive member path")
            elif legal_path not in legal_file_paths:
                errors.append(f"{context}.path: must reference an exact legal_files entry")
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
    return sorted(set(errors))


def _valid_legal_path(value: object) -> bool:
    if not isinstance(value, str):
        return False
    if value in LEGAL_FILES:
        return True
    if value.count("!") != 1:
        return False
    archive_path, member_path = value.split("!", 1)
    return (
        _valid_relative_path(archive_path)
        and _valid_relative_path(member_path)
        and PurePosixPath(member_path).name in {"LICENSE", "NOTICE"}
    )


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


def _worktree_blobs(repo: Path) -> list[Blob]:
    listed = _git(repo, "ls-files", "-z", text=False)
    if not isinstance(listed, bytes):
        message = "git ls-files unexpectedly returned text"
        raise TypeError(message)
    blobs: list[Blob] = []
    for raw_path in sorted(item for item in listed.split(b"\0") if item):
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
    return [(content.count(b"\n", 0, match.start()) + 1, match.group()) for match in pattern.finditer(content)]


def _scan_blobs(
    blobs: Iterable[Blob], contract: dict[str, Any], *, profile: str, excluded_path: str | None
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
            if profile == "cutover":
                violations.append(
                    {"kind": "duplicate_scan_path", "path": blob.path, "line": 0, "match": "ambiguous blob path"}
                )
            continue
        seen_paths.add(blob.path)
        if blob.scan_issue is not None:
            scan_issue_count += 1
            counts = path_counts.setdefault(blob.path, dict.fromkeys(BASELINE_FIELDS, 0))
            counts["scan_issue_count"] += 1
            if profile == "cutover":
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
        findings.extend(("legacy_brand", line, match) for line, match in _matches(_PRODUCT_RE, blob.content))
        findings.extend(("legacy_executor", line, match) for line, match in _matches(_EXECUTOR_RE, blob.content))
        findings.extend(
            ("upstream_endpoint", line, match) for line, match in _matches(_UPSTREAM_ENDPOINT_RE, blob.content)
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
            if profile == "cutover" or item["kind"] == "legal_mismatch":
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
            if profile == "cutover":
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
    if profile == "cutover":
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
    if profile == "stage0":
        frozen = contract["baseline"]
        violations.extend(
            {
                "kind": "baseline_increase",
                "path": "",
                "line": 0,
                "match": field,
                "expected_maximum": frozen[field],
                "actual": baseline[field],
            }
            for field in BASELINE_FIELDS
            if baseline[field] > frozen[field]
        )

    def key(item: dict[str, Any]) -> tuple[str, int, str, str]:
        return (item["path"], item["line"], item["kind"], item["match"])

    return {
        "baseline": baseline,
        "allowed_residue": sorted(allowed, key=key),
        "violations": sorted(violations, key=key),
        "contract_errors": [],
        "_path_counts": path_counts,
    }


def scan_root(root: Path | str, zero_residue_contract_path: Path | str, *, profile: str = "cutover") -> dict[str, Any]:
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
    report = _scan_blobs(_filesystem_blobs(root_path), contract, profile=profile, excluded_path=excluded)
    report.pop("_path_counts")
    return report


def _has_tracked_worktree_changes(repo: Path) -> bool:
    status = _git(repo, "status", "--porcelain", "--untracked-files=no")
    if not isinstance(status, str):
        message = "git status unexpectedly returned bytes"
        raise TypeError(message)
    return bool(status.strip())


def _first_parent_exists(repo: Path) -> bool:
    completed = subprocess.run(
        ["git", "rev-parse", "--verify", "HEAD^"],  # noqa: S607 - Git is intentionally resolved from PATH.
        cwd=repo,
        check=False,
        capture_output=True,
    )
    return completed.returncode == 0


def _add_monotonic_violations(current: dict[str, Any], previous: dict[str, Any]) -> None:
    violations = current["violations"]
    for field in BASELINE_FIELDS:
        if current["baseline"][field] > previous["baseline"][field]:
            violations.append(
                {
                    "kind": "monotonic_increase",
                    "path": "",
                    "line": 0,
                    "match": field,
                    "previous": previous["baseline"][field],
                    "actual": current["baseline"][field],
                }
            )
    previous_paths = previous["_path_counts"]
    for path, counts in current["_path_counts"].items():
        previous_counts = previous_paths.get(path, {})
        for field in BASELINE_FIELDS:
            old = previous_counts.get(field, 0)
            if counts[field] > old:
                violations.append(
                    {
                        "kind": "monotonic_increase",
                        "path": path,
                        "line": 0,
                        "match": field,
                        "previous": old,
                        "actual": counts[field],
                    }
                )
    violations.sort(key=lambda item: (item["path"], item["line"], item["kind"], item["match"]))


def scan_repository(
    repo: Path | str,
    zero_residue_contract_path: Path | str,
    *,
    profile: str = "stage0",
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
    if _has_tracked_worktree_changes(repo_path):
        report = _scan_blobs(_worktree_blobs(repo_path), contract, profile=profile, excluded_path=excluded)
        previous_source = "HEAD"
    else:
        report = _scan_blobs(_object_blobs(repo_path, "HEAD"), contract, profile=profile, excluded_path=excluded)
        previous_source = "HEAD^" if _first_parent_exists(repo_path) else None
    if profile == "stage0":
        previous_blobs = _object_blobs(repo_path, previous_source) if previous_source else []
        previous = _scan_blobs(previous_blobs, contract, profile="stage0", excluded_path=excluded)
        _add_monotonic_violations(report, previous)
    report.pop("_path_counts")
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
    parser.add_argument(
        "--zero-residue-contract",
        type=Path,
        default=root / "brand/ketos-zero-residue-contract.yaml",
    )
    parser.add_argument("--profile", choices=PROFILES, default="stage0")
    parser.add_argument("--format", choices=("json", "text"), default="text")
    args = parser.parse_args(argv)

    brand_errors = validate_brand_contract(args.brand_contract)
    try:
        report = (
            scan_root(args.scan_root, args.zero_residue_contract, profile=args.profile)
            if args.scan_root
            else scan_repository(args.repo, args.zero_residue_contract, profile=args.profile)
        )
    except (OSError, subprocess.CalledProcessError, ValueError, zipfile.BadZipFile, tarfile.TarError) as exc:
        report = {"baseline": None, "allowed_residue": [], "violations": [], "contract_errors": [str(exc)]}
    report["contract_errors"] = sorted([*brand_errors, *report["contract_errors"]])
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
