#!/usr/bin/env python3
"""Fail-closed admission probe for an installed AG-UI LangGraph adapter.

The probe intentionally has no dependency on Ketos. Run it inside an isolated
environment containing exactly one candidate adapter, and pass the registry-
verified artifact SHA-256 separately. External package content is inspected as
untrusted data; absence or ambiguity is a failed contract, never an inference.
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import hashlib
import importlib
import importlib.metadata
import inspect
import io
import json
import os
import re
import selectors
import signal
import stat
import subprocess
import tarfile
import tempfile
import textwrap
import time
import zipfile
from contextlib import suppress
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
from typing import Any, NoReturn, get_args, get_origin

import tomllib

REQUIRED_CONTRACTS = (
    "constructor_api",
    "standard_run_finished_interrupt",
    "run_agent_input_resume_array",
    "all_open_interrupts",
    "safe_pre_dispatch_binding",
    "deprecated_forwarded_props_resume_absent",
)
SHA256_HEX_LENGTH = 64
REQUIRED_ARCHIVE_SOURCES = (
    "ag_ui_langgraph/agent.py",
    "ag_ui_langgraph/endpoint.py",
)
WHEEL_BUILD_METADATA_FILES = frozenset({"METADATA", "WHEEL", "RECORD", "licenses/LICENSE"})
ARTIFACT_STRING_FIELDS = (
    "name",
    "version",
    "identity",
    "path",
    "archive_kind",
    "metadata_path",
    "sha256",
    "license",
    "license_path",
    "license_sha256",
    "license_source",
    "requires_python",
    "source_class",
)
ARTIFACT_BINDINGS = (
    "archive_identity_bound",
    "runtime_identity_bound",
    "runtime_source_bound",
)
FORK_PROVENANCE_FIELDS = frozenset(
    {
        "artifact_kind",
        "package_name",
        "package_version",
        "approved_owner",
        "canonical_repo_url",
        "upstream_base_sha",
        "fork_commit_sha",
        "artifact_filename",
        "artifact_sha256",
        "source_archive_sha256",
        "license_spdx",
        "license_sha256",
        "changed_files",
        "build_command",
        "test_command",
    }
)
APPROVED_FORK_OWNER = "factor241"
APPROVED_FORK_REPOSITORY = "https://github.com/factor241/ag-ui"
APPROVED_FORK_PACKAGE = "ag-ui-langgraph"
OFFICIAL_UPSTREAM_OWNER = "ag-ui-protocol"
OFFICIAL_UPSTREAM_REPOSITORY = "https://github.com/ag-ui-protocol/ag-ui"
APPROVED_FORK_SOURCE_FILES = frozenset(
    {
        "docs/concepts/interrupts.mdx",
        "integrations/langgraph/python/README.md",
        "integrations/langgraph/python/ag_ui_langgraph/__init__.py",
        "integrations/langgraph/python/ag_ui_langgraph/agent.py",
        "integrations/langgraph/python/ag_ui_langgraph/endpoint.py",
        "integrations/langgraph/python/ag_ui_langgraph/interrupts.py",
        "integrations/langgraph/python/ag_ui_langgraph/types.py",
        "integrations/langgraph/python/examples/agents/human_in_the_loop/agent.py",
        "integrations/langgraph/python/pyproject.toml",
        "integrations/langgraph/python/uv.lock",
    }
)
APPROVED_FORK_TEST_PREFIX = "integrations/langgraph/python/tests/"
PROVENANCE_MAX_BYTES = 64 * 1024
GETATTR_MIN_ARGS = 2
GIT_EXECUTABLE = "/usr/bin/git"
FORK_PROVENANCE_BINDINGS = (
    "bound",
    "source_commit_bound",
    "source_tree_bound",
    "changed_files_derived",
)
UPSTREAM_PROVENANCE_BINDINGS = FORK_PROVENANCE_BINDINGS
APPROVED_FORK_GIT_REMOTE = "https://github.com/factor241/ag-ui.git"
OFFICIAL_UPSTREAM_GIT_REMOTE = "https://github.com/ag-ui-protocol/ag-ui.git"
ARCHIVE_MAX_BYTES = 128 * 1024 * 1024
ARCHIVE_MAX_MEMBERS = 20_000
ARCHIVE_MAX_MEMBER_BYTES = 32 * 1024 * 1024
ARCHIVE_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
GIT_STDOUT_MAX_BYTES = 128 * 1024 * 1024
GIT_STDERR_MAX_BYTES = 8 * 1024 * 1024
GIT_TIMEOUT_SECONDS = 60


def _invalid(message: str) -> NoReturn:
    raise ValueError(message)


def evaluate_candidate(evidence: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic admission decision from collected evidence."""
    artifact = evidence.get("artifact") or {}
    contracts = evidence.get("contracts") or {}
    reasons: list[str] = []

    if artifact.get("version") == "0.0.42" and artifact.get("identity") == "ag-ui-langgraph==0.0.42":
        reasons.append("0.0.42")

    for key in ARTIFACT_STRING_FIELDS:
        value = artifact.get(key)
        if not isinstance(value, str) or not value.strip():
            reasons.append(f"artifact.{key}")

    reasons.extend(f"artifact.{key}" for key in ARTIFACT_BINDINGS if artifact.get(key) is not True)

    digest = artifact.get("sha256")
    if isinstance(digest, str) and (
        len(digest) != SHA256_HEX_LENGTH or any(char not in "0123456789abcdef" for char in digest.lower())
    ):
        reasons.append("artifact.sha256")

    reasons.extend(contract for contract in REQUIRED_CONTRACTS if contracts.get(contract) is not True)

    source_class = artifact.get("source_class")
    if source_class == "approved-fork":
        provenance = evidence.get("fork_provenance") or {}
        if any(provenance.get(key) is not True for key in FORK_PROVENANCE_BINDINGS):
            reasons.append("fork_provenance")
    elif source_class == "upstream-commit":
        provenance = evidence.get("upstream_provenance") or {}
        if any(provenance.get(key) is not True for key in UPSTREAM_PROVENANCE_BINDINGS):
            reasons.append("upstream_provenance")
    elif source_class == "registry-release":
        reasons.append("registry_unsupported")
    else:
        reasons.append("source_class")

    return {"admitted": not reasons, "reasons": list(dict.fromkeys(reasons))}


def _source(module: Any) -> str | None:
    try:
        return inspect.getsource(module)
    except (OSError, TypeError):
        return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bytes_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _canonical_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _normalized_specifier(value: str) -> tuple[str, ...]:
    return tuple(sorted(part.strip() for part in value.split(",") if part.strip()))


def _exact_sha256(value: Any, description: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        _invalid(f"{description} must be a lowercase 64-character SHA-256")
    return value


def _exact_git_sha(value: Any, description: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        _invalid(f"{description} must be an exact lowercase 40-character commit SHA")
    return value


def _approved_changed_file(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or any(char in value for char in "*?[]"):
        return False
    return value in APPROVED_FORK_SOURCE_FILES or (
        value.startswith(APPROVED_FORK_TEST_PREFIX) and value.endswith(".py")
    )


def classify_candidate_source(
    artifact: dict[str, Any],
    *,
    fork_selected: bool = False,
) -> str:
    """Derive the only supported source class from inspected artifact metadata."""
    archive_kind = artifact.get("archive_kind")
    if fork_selected:
        return "approved-fork"
    if archive_kind == "git-archive":
        return "upstream-commit"
    if archive_kind == "wheel":
        return "registry-release"
    return "unknown"


def _run_bounded_process(
    command: list[str],
    *,
    stdout_limit: int,
    stderr_limit: int,
    timeout_seconds: float,
) -> tuple[bytes, bytes]:
    try:
        process = subprocess.Popen(  # noqa: S603 - callers provide fixed executables and no shell
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        _invalid(f"process could not start: {exc}")
    if process.stdout is None or process.stderr is None:
        process.kill()
        process.wait()
        _invalid("process output pipes were not created")

    streams = {
        process.stdout: ("stdout", stdout_limit, bytearray()),
        process.stderr: ("stderr", stderr_limit, bytearray()),
    }
    selector = selectors.DefaultSelector()
    for stream in streams:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout_seconds
    completed = False
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _invalid(f"process timed out after {timeout_seconds} seconds")
            for key, _mask in selector.select(timeout=min(remaining, 0.1)):
                stream = key.fileobj
                try:
                    chunk = os.read(stream.fileno(), 64 * 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(stream)
                    continue
                name, limit, output = streams[stream]
                output.extend(chunk)
                if len(output) > limit:
                    _invalid(f"process {name} exceeds {limit}-byte limit")
        try:
            return_code = process.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            _invalid(f"process timed out after {timeout_seconds} seconds")
        stdout = bytes(streams[process.stdout][2])
        stderr = bytes(streams[process.stderr][2])
        if return_code != 0:
            message = stderr.decode("utf-8", errors="replace")
            _invalid(f"process exited with status {return_code}: {message}")
        completed = True
        return stdout, stderr
    finally:
        selector.close()
        if not completed:
            with suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def _run_git(*args: str, binary: bool = False) -> bytes | str:
    try:
        output, _stderr = _run_bounded_process(
            [GIT_EXECUTABLE, *args],
            stdout_limit=GIT_STDOUT_MAX_BYTES,
            stderr_limit=GIT_STDERR_MAX_BYTES,
            timeout_seconds=GIT_TIMEOUT_SECONDS,
        )
    except ValueError as exc:
        _invalid(f"git provenance check failed for {args!r}: {exc}")
    return output if binary else output.decode("utf-8")


def _git_output(repository: Path, *args: str, binary: bool = False) -> bytes | str:
    return _run_git("-C", str(repository), *args, binary=binary)


def _verify_remote_commit_reachability(
    remote_url: str,
    upstream_sha: str,
    candidate_sha: str,
) -> None:
    advertised = _run_git("ls-remote", "--heads", remote_url)
    if not isinstance(advertised, str) or not advertised.strip():
        _invalid("approved remote did not advertise any reachable branch heads")
    with tempfile.TemporaryDirectory(prefix="ketos-agui-remote-proof-") as temporary:
        repository = Path(temporary)
        _git_output(repository, "init", "--bare")
        _git_output(
            repository,
            "fetch",
            "--no-tags",
            remote_url,
            candidate_sha,
        )
        for commit, description in (
            (candidate_sha, "candidate commit"),
            (upstream_sha, "upstream base"),
        ):
            resolved = _git_output(repository, "rev-parse", f"{commit}^{{commit}}")
            if not isinstance(resolved, str) or resolved.strip() != commit:
                _invalid(f"{description} is not reachable from the approved remote")
        _git_output(repository, "merge-base", "--is-ancestor", upstream_sha, candidate_sha)


def _canonical_git_remote(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith("git@github.com:"):
        normalized = "https://github.com/" + normalized.removeprefix("git@github.com:")
    return normalized.removesuffix(".git")


def _validate_archive_path_size(path: Path) -> None:
    size = path.stat().st_size
    if size > ARCHIVE_MAX_BYTES:
        _invalid(f"archive exceeds {ARCHIVE_MAX_BYTES}-byte size limit")


def _validate_member_sizes(sizes: list[int]) -> None:
    if len(sizes) > ARCHIVE_MAX_MEMBERS:
        _invalid(f"archive exceeds {ARCHIVE_MAX_MEMBERS}-member limit")
    if any(size < 0 or size > ARCHIVE_MAX_MEMBER_BYTES for size in sizes):
        _invalid(f"archive member exceeds {ARCHIVE_MAX_MEMBER_BYTES}-byte limit")
    if sum(sizes) > ARCHIVE_MAX_UNCOMPRESSED_BYTES:
        _invalid(f"archive exceeds {ARCHIVE_MAX_UNCOMPRESSED_BYTES}-byte uncompressed limit")


def _validate_tar_members(members: list[tarfile.TarInfo]) -> None:
    _safe_archive_names([member.name for member in members])
    _validate_member_sizes([member.size for member in members if member.isfile()])
    for member in members:
        if not (member.isfile() or member.isdir()):
            _invalid(f"unsafe archive member type: {member.name}")


def _bounded_tar_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members: list[tarfile.TarInfo] = []
    for member in archive:
        members.append(member)
        if len(members) > ARCHIVE_MAX_MEMBERS:
            _invalid(f"archive exceeds {ARCHIVE_MAX_MEMBERS}-member limit")
    return members


def _tar_file_digests(fileobj: Any, *, mode: str) -> dict[str, tuple[str, int]]:
    try:
        with tarfile.open(fileobj=fileobj, mode=mode) as archive:
            all_members = _bounded_tar_members(archive)
            _validate_tar_members(all_members)
            members = [member for member in all_members if member.isfile()]
            result: dict[str, tuple[str, int]] = {}
            for member in members:
                extracted = archive.extractfile(member)
                if extracted is None:
                    _invalid(f"source archive member cannot be read: {member.name}")
                result[member.name] = (_bytes_sha256(extracted.read()), member.mode)
            return result
    except tarfile.TarError as exc:
        _invalid(f"source archive is not a valid tar archive: {exc}")


def _bind_source_tree_to_repository(
    source_path: Path,
    source_artifact: dict[str, Any],
    repository: Path,
    fork_sha: str,
) -> bool:
    package_root = str(PurePosixPath(str(source_artifact["metadata_path"])).parent)
    with source_path.open("rb") as stream:
        supplied = _tar_file_digests(stream, mode="r:*")
    expected_bytes = _git_output(
        repository,
        "archive",
        "--format=tar",
        fork_sha,
        package_root,
        binary=True,
    )
    if not isinstance(expected_bytes, bytes):
        _invalid("git archive returned text instead of bytes")
    expected = _tar_file_digests(io.BytesIO(expected_bytes), mode="r:")
    return supplied == expected


def _source_package_inventory(source_path: Path, source_artifact: dict[str, Any]) -> dict[str, str]:
    """Derive the exact import-package payload from the Git-bound source archive."""
    package_root = PurePosixPath(str(source_artifact["metadata_path"])).parent / "ag_ui_langgraph"
    prefix = f"{package_root}/"
    with tarfile.open(source_path) as archive:
        all_members = _bounded_tar_members(archive)
        _validate_tar_members(all_members)
        inventory: dict[str, str] = {}
        for member in all_members:
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            relative = member.name[len(prefix) :]
            if not relative or PurePosixPath(relative).name.startswith("."):
                _invalid(f"source package contains unsupported hidden member: {member.name}")
            extracted = archive.extractfile(member)
            if extracted is None:
                _invalid(f"source package member cannot be read: {member.name}")
            inventory[f"ag_ui_langgraph/{relative}"] = _bytes_sha256(extracted.read())
    if not inventory:
        _invalid("source package inventory is empty")
    return inventory


def _bind_wheel_inventory_to_source(
    artifact: dict[str, Any],
    source_path: Path,
    source_artifact: dict[str, Any],
) -> bool:
    """Reject every wheel member not derived from source or the exact wheel metadata set."""
    wheel_inventory = artifact.get("wheel_inventory_sha256")
    if not isinstance(wheel_inventory, dict) or not wheel_inventory:
        _invalid("wheel inventory is missing")
    expected_package = _source_package_inventory(source_path, source_artifact)
    actual_package = {
        name: digest for name, digest in wheel_inventory.items() if name.startswith("ag_ui_langgraph/")
    }
    if actual_package != expected_package:
        _invalid("wheel inventory does not match the Git-bound source package inventory")
    metadata_path = PurePosixPath(str(artifact["metadata_path"]))
    dist_info = str(metadata_path.parent)
    expected_metadata = {f"{dist_info}/{name}" for name in WHEEL_BUILD_METADATA_FILES}
    actual_metadata = {name for name in wheel_inventory if name.startswith(f"{dist_info}/")}
    if actual_metadata != expected_metadata:
        _invalid("wheel inventory does not match the exact build metadata inventory")
    expected_all = set(expected_package) | expected_metadata
    if set(wheel_inventory) != expected_all:
        _invalid("wheel inventory contains content outside the source/build inventory")
    return True


def _validate_git_provenance(
    provenance: dict[str, Any],
    *,
    artifact_path: Path,
    source_archive_path: Path | None,
    repository_path: Path,
    artifact: dict[str, Any],
    expected_owner: str,
    expected_repository: str,
    expected_remote: str,
) -> dict[str, Any]:
    """Bind a Git candidate declaration to local bytes and an authoritative remote."""
    if set(provenance) != FORK_PROVENANCE_FIELDS:
        missing = sorted(FORK_PROVENANCE_FIELDS - set(provenance))
        extra = sorted(set(provenance) - FORK_PROVENANCE_FIELDS)
        _invalid(f"fork provenance must contain exact fields; missing={missing}, extra={extra}")

    kind = provenance["artifact_kind"]
    if kind not in {"wheel", "tgz"}:
        _invalid("artifact_kind must be exactly 'wheel' or 'tgz'")
    if provenance["package_name"] != APPROVED_FORK_PACKAGE:
        _invalid(f"package_name must be {APPROVED_FORK_PACKAGE}")
    package_version = provenance["package_version"]
    if (
        not isinstance(package_version, str)
        or re.fullmatch(
            r"[0-9]+(?:\.[0-9]+){1,2}(?:[A-Za-z0-9.+-]*)?",
            package_version,
        )
        is None
    ):
        _invalid("package_version must be an exact non-floating version")
    if provenance["approved_owner"] != expected_owner:
        _invalid(f"approved owner must be {expected_owner}")
    if provenance["canonical_repo_url"] != expected_repository:
        _invalid(f"canonical repository must be {expected_repository}")

    detected_kind = {
        "wheel": "wheel",
        "git-archive": "tgz",
    }.get(str(artifact.get("archive_kind") or ""))
    if kind != detected_kind:
        _invalid(f"artifact_kind {kind!r} does not match detected artifact kind {detected_kind!r}")

    upstream_sha = _exact_git_sha(provenance["upstream_base_sha"], "upstream base commit")
    fork_sha = _exact_git_sha(provenance["fork_commit_sha"], "fork commit")
    if upstream_sha == fork_sha:
        _invalid("fork commit must differ from upstream base commit")

    resolved_artifact = artifact_path.resolve(strict=True)
    if provenance["artifact_filename"] != resolved_artifact.name:
        _invalid("artifact filename does not match the supplied artifact")
    artifact_sha = _exact_sha256(provenance["artifact_sha256"], "artifact SHA-256")
    if artifact_sha != _sha256(resolved_artifact):
        _invalid("artifact SHA-256 mismatch")

    resolved_source = resolved_artifact if kind == "tgz" else None
    if kind == "wheel" and source_archive_path is not None:
        resolved_source = source_archive_path.resolve(strict=True)
    if resolved_source is None:
        _invalid("source archive path is required for a wheel fork artifact")
    if kind == "wheel" and resolved_source == resolved_artifact:
        _invalid("wheel fork artifact requires a distinct source archive")
    _validate_archive_path_size(resolved_source)
    source_sha = _exact_sha256(provenance["source_archive_sha256"], "source archive SHA-256")
    if source_sha != _sha256(resolved_source):
        _invalid("source archive SHA-256 mismatch")

    if not tarfile.is_tarfile(resolved_source):
        _invalid("source archive is not a valid tar archive")
    source_artifact = _source_artifact(resolved_source)
    if source_artifact.get("git_commit") != fork_sha:
        _invalid("source archive commit does not match fork_commit_sha")

    if provenance["license_spdx"] != "MIT" or artifact.get("license") != "MIT":
        _invalid("license SPDX must match the artifact MIT declaration")
    license_sha = _exact_sha256(provenance["license_sha256"], "license SHA-256")
    if license_sha != artifact.get("license_sha256"):
        _invalid("license SHA-256 mismatch")
    if artifact.get("name") != provenance["package_name"]:
        _invalid("fork package name does not match the artifact")
    if artifact.get("version") != package_version:
        _invalid("fork package version does not match the artifact")
    for field in ("name", "version", "license", "license_sha256", "source_sha256"):
        if source_artifact.get(field) != artifact.get(field):
            _invalid(f"source archive {field} does not match the built artifact")
    if kind == "wheel" and not _bind_wheel_inventory_to_source(
        artifact,
        resolved_source,
        source_artifact,
    ):
        _invalid("wheel inventory is not bound to the source/build inventory")

    changed_files = provenance["changed_files"]
    if (
        not isinstance(changed_files, list)
        or not changed_files
        or not all(isinstance(item, str) for item in changed_files)
        or len(changed_files) != len(set(changed_files))
        or not all(_approved_changed_file(item) for item in changed_files)
    ):
        _invalid("changed_files must be a unique non-empty approved path allowlist")

    for field in ("build_command", "test_command"):
        command = provenance[field]
        if not isinstance(command, str) or fork_sha not in command:
            _invalid(f"{field} must bind the exact fork commit {fork_sha}")
        if re.search(
            r"(?:^|[/@\s])(main|master|head|latest)(?:$|[/@\s])",
            command,
            re.IGNORECASE,
        ):
            _invalid(f"{field} contains a floating ref instead of the fork commit")

    repository = repository_path.resolve(strict=True)
    if not repository.is_dir():
        _invalid("fork repository path must be a directory")
    for remote_args, description in (
        (("remote", "get-url", "origin"), "fetch"),
        (("remote", "get-url", "--push", "origin"), "push"),
    ):
        remote = _git_output(repository, *remote_args)
        if not isinstance(remote, str):
            _invalid(f"repository {description} origin could not be read as text")
        if _canonical_git_remote(remote) != expected_repository:
            _invalid(f"repository {description} origin is not the approved canonical repository")
    for commit, description in (
        (upstream_sha, "upstream base"),
        (fork_sha, "fork commit"),
    ):
        resolved = _git_output(repository, "rev-parse", f"{commit}^{{commit}}")
        if not isinstance(resolved, str) or resolved.strip() != commit:
            _invalid(f"{description} does not resolve to the declared commit")
    _git_output(repository, "merge-base", "--is-ancestor", upstream_sha, fork_sha)
    _verify_remote_commit_reachability(expected_remote, upstream_sha, fork_sha)
    derived_output = _git_output(repository, "diff", "--name-only", upstream_sha, fork_sha)
    if not isinstance(derived_output, str):
        _invalid("repository diff could not be read as text")
    derived_changed_files = [line for line in derived_output.splitlines() if line]
    if derived_changed_files != changed_files:
        _invalid("changed_files does not match the repository-derived commit diff")
    if not _bind_source_tree_to_repository(resolved_source, source_artifact, repository, fork_sha):
        _invalid("source archive tree does not match the fork commit tree")

    return {
        **provenance,
        "bound": True,
        "artifact_path": str(resolved_artifact),
        "source_archive_path": str(resolved_source),
        "repository_path": str(repository),
        "source_commit_bound": True,
        "source_tree_bound": True,
        "changed_files_derived": True,
    }


def validate_fork_provenance(
    provenance: dict[str, Any],
    *,
    artifact_path: Path,
    source_archive_path: Path | None,
    repository_path: Path,
    artifact: dict[str, Any],
) -> dict[str, Any]:
    """Bind an approved factor241 fork declaration to immutable evidence."""
    return _validate_git_provenance(
        provenance,
        artifact_path=artifact_path,
        source_archive_path=source_archive_path,
        repository_path=repository_path,
        artifact=artifact,
        expected_owner=APPROVED_FORK_OWNER,
        expected_repository=APPROVED_FORK_REPOSITORY,
        expected_remote=APPROVED_FORK_GIT_REMOTE,
    )


def validate_upstream_provenance(
    provenance: dict[str, Any],
    *,
    artifact_path: Path,
    repository_path: Path,
    artifact: dict[str, Any],
) -> dict[str, Any]:
    """Bind an official upstream source archive to the official remote."""
    return _validate_git_provenance(
        provenance,
        artifact_path=artifact_path,
        source_archive_path=None,
        repository_path=repository_path,
        artifact=artifact,
        expected_owner=OFFICIAL_UPSTREAM_OWNER,
        expected_repository=OFFICIAL_UPSTREAM_REPOSITORY,
        expected_remote=OFFICIAL_UPSTREAM_GIT_REMOTE,
    )


def load_fork_provenance(path: Path) -> dict[str, Any]:
    """Load a provenance sidecar as untrusted JSON data."""
    resolved = path.resolve(strict=True)
    if resolved.stat().st_size > PROVENANCE_MAX_BYTES:
        _invalid(f"fork provenance exceeds {PROVENANCE_MAX_BYTES}-byte size limit")
    with resolved.open("rb") as stream:
        raw = stream.read(PROVENANCE_MAX_BYTES + 1)
    if len(raw) > PROVENANCE_MAX_BYTES:
        _invalid(f"fork provenance exceeds {PROVENANCE_MAX_BYTES}-byte size limit")
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        _invalid("fork provenance JSON must contain one object")
    return parsed


def _safe_archive_names(names: list[str]) -> None:
    normalized_names: set[str] = set()
    for name in names:
        if not name or "\\" in name:
            _invalid(f"unsafe archive member: {name}")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            _invalid(f"unsafe archive member: {name}")
        normalized = str(path)
        if normalized in normalized_names:
            _invalid(f"duplicate archive member: {name}")
        normalized_names.add(normalized)


def _one(items: list[str], description: str) -> str:
    if len(items) != 1:
        _invalid(f"expected exactly one {description}, found {len(items)}")
    return items[0]


def _license_member(names: list[str], root: str, declared: list[str]) -> str:
    candidates: list[str] = []
    for item in declared:
        expected = f"{root}/{item}" if root else item
        if expected in names:
            candidates.append(expected)
            continue
        basename = PurePosixPath(item).name
        candidates.extend(
            name
            for name in names
            if PurePosixPath(name).name == basename
            and ("licenses" in PurePosixPath(name).parts or name.startswith(f"{root}/"))
        )
    unique = list(dict.fromkeys(candidates))
    return _one(unique, "declared license file")


def _wheel_artifact(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        _safe_archive_names(names)
        _validate_member_sizes([entry.file_size for entry in entries])
        for entry in entries:
            mode = (entry.external_attr >> 16) & 0xFFFF
            file_type = stat.S_IFMT(mode)
            allowed_types = {0, stat.S_IFDIR} if entry.is_dir() else {0, stat.S_IFREG}
            if file_type not in allowed_types:
                _invalid(f"unsafe archive member type: {entry.filename}")
        metadata_path = _one(
            [name for name in names if name.endswith(".dist-info/METADATA")],
            "wheel METADATA",
        )
        metadata = BytesParser(policy=email_policy).parsebytes(archive.read(metadata_path))
        name = str(metadata.get("Name") or "").strip()
        version = str(metadata.get("Version") or "").strip()
        license_name = str(metadata.get("License-Expression") or metadata.get("License") or "").strip()
        requires_python = str(metadata.get("Requires-Python") or "").strip()
        if not all((name, version, license_name, requires_python)):
            _invalid("wheel METADATA lacks required identity/license/Python fields")
        declared_licenses = [str(item) for item in metadata.get_all("License-File", [])]
        if not declared_licenses:
            _invalid("wheel METADATA does not declare a license file")
        dist_info_root = str(PurePosixPath(metadata_path).parent)
        license_path = _license_member(names, dist_info_root, declared_licenses)
        missing_sources = [source for source in REQUIRED_ARCHIVE_SOURCES if source not in names]
        if missing_sources:
            _invalid(f"artifact missing required source: {', '.join(missing_sources)}")
        wheel_inventory_sha256 = {
            entry.filename: _bytes_sha256(archive.read(entry.filename)) for entry in entries if not entry.is_dir()
        }
        source_sha256 = {source: wheel_inventory_sha256[source] for source in REQUIRED_ARCHIVE_SOURCES}
        license_bytes = archive.read(license_path)
    return {
        "name": name,
        "version": version,
        "identity": f"{_canonical_name(name)}=={version}",
        "path": path.name,
        "archive_kind": "wheel",
        "metadata_path": metadata_path,
        "sha256": _sha256(path),
        "license": license_name,
        "license_path": license_path,
        "license_sha256": _bytes_sha256(license_bytes),
        "license_source": "artifact",
        "requires_python": requires_python,
        "source_sha256": source_sha256,
        "wheel_inventory_sha256": wheel_inventory_sha256,
        "archive_identity_bound": True,
    }


def _source_artifact(path: Path) -> dict[str, Any]:
    with tarfile.open(path) as archive:
        all_members = _bounded_tar_members(archive)
        _validate_tar_members(all_members)
        members = [member for member in all_members if member.isfile()]
        names = [member.name for member in members]
        commit = str(archive.pax_headers.get("comment") or "")
        if not re.fullmatch(r"[0-9a-f]{40}", commit):
            _invalid("source archive lacks a bound 40-character git commit")
        projects: list[tuple[str, dict[str, Any]]] = []
        for name in names:
            if not name.endswith("pyproject.toml"):
                continue
            file_object = archive.extractfile(name)
            if file_object is None:
                continue
            parsed = tomllib.loads(file_object.read().decode("utf-8"))
            project = parsed.get("project") or {}
            if _canonical_name(str(project.get("name") or "")) == "ag-ui-langgraph":
                projects.append((name, project))
        if len(projects) != 1:
            _invalid(f"expected exactly one ag-ui-langgraph pyproject.toml, found {len(projects)}")
        metadata_path, project = projects[0]
        root_path = PurePosixPath(metadata_path).parent
        root = "" if str(root_path) == "." else str(root_path)
        name = str(project.get("name") or "").strip()
        version = str(project.get("version") or "").strip()
        license_value = project.get("license")
        license_name = (
            str(license_value.get("text") or "").strip()
            if isinstance(license_value, dict)
            else str(license_value or "").strip()
        )
        requires_python = str(project.get("requires-python") or "").strip()
        if not all((name, version, license_name, requires_python)):
            _invalid("source pyproject lacks required identity/license/Python fields")
        declared_licenses = [str(item) for item in project.get("license-files") or []]
        if not declared_licenses:
            _invalid("source pyproject does not declare a license file")
        license_path = _license_member(names, root, declared_licenses)
        source_members = {source: f"{root}/{source}" if root else source for source in REQUIRED_ARCHIVE_SOURCES}
        missing_sources = [source for source, member in source_members.items() if member not in names]
        if missing_sources:
            _invalid(f"artifact missing required source: {', '.join(missing_sources)}")
        source_sha256: dict[str, str] = {}
        for source, member in source_members.items():
            file_object = archive.extractfile(member)
            if file_object is None:
                _invalid(f"artifact missing required source: {source}")
            source_sha256[source] = _bytes_sha256(file_object.read())
        license_file = archive.extractfile(license_path)
        if license_file is None:
            _invalid("artifact license file cannot be read")
        license_bytes = license_file.read()
    subdirectory = root or "."
    return {
        "name": name,
        "version": version,
        "identity": f"git:{commit}#subdirectory={subdirectory}",
        "path": path.name,
        "archive_kind": "git-archive",
        "metadata_path": metadata_path,
        "sha256": _sha256(path),
        "git_commit": commit,
        "license": license_name,
        "license_path": license_path,
        "license_sha256": _bytes_sha256(license_bytes),
        "license_source": "artifact",
        "requires_python": requires_python,
        "source_sha256": source_sha256,
        "archive_identity_bound": True,
    }


def inspect_artifact(artifact_path: Path | None) -> dict[str, Any]:
    """Derive candidate identity and integrity only from a mandatory archive."""
    if artifact_path is None:
        _invalid("artifact path is required")
    path = artifact_path.resolve(strict=True)
    if not path.is_file():
        _invalid(f"artifact path is not a file: {path}")
    _validate_archive_path_size(path)
    if zipfile.is_zipfile(path):
        artifact = _wheel_artifact(path)
    elif tarfile.is_tarfile(path):
        artifact = _source_artifact(path)
    else:
        _invalid(f"unsupported candidate artifact format: {path.name}")
    artifact["source_class"] = classify_candidate_source(artifact)
    return artifact


def bind_runtime_to_artifact(artifact: dict[str, Any], runtime: dict[str, Any]) -> dict[str, bool]:
    """Require installed metadata and source bytes to match the candidate archive."""
    identity = (
        _canonical_name(str(artifact.get("name") or "")) == _canonical_name(str(runtime.get("name") or ""))
        and artifact.get("version") == runtime.get("version")
        and str(artifact.get("license") or "").strip().lower() == str(runtime.get("license") or "").strip().lower()
        and _normalized_specifier(str(artifact.get("requires_python") or ""))
        == _normalized_specifier(str(runtime.get("requires_python") or ""))
    )
    source = artifact.get("source_sha256") == runtime.get("source_sha256")
    return {"identity": identity, "source": source}


def _normalized_access_name(value: str) -> str:
    return "forwarded_props" if value in {"forwardedProps", "forwarded_props"} else value


class _DeprecatedResumeAccessVisitor(ast.NodeVisitor):
    """Conservatively track data flow from any run input to command.resume."""

    def __init__(self, tree: ast.AST) -> None:
        self._environments: list[dict[str, tuple[str, ...]]] = [{"input": ("input",), "input_data": ("input_data",)}]
        self._returns: list[list[tuple[str, ...]]] = []
        self._active_functions: set[int] = set()
        self._functions = {
            node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        self.found = False

    @property
    def environment(self) -> dict[str, tuple[str, ...]]:
        return self._environments[-1]

    def _record(self, path: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if path is not None:
            normalized = tuple(_normalized_access_name(item) for item in path)
            for index in range(len(normalized) - 2):
                if normalized[index : index + 3] == (
                    "forwarded_props",
                    "command",
                    "resume",
                ):
                    self.found = True
                    break
        return path

    def _path(self, node: ast.AST | None) -> tuple[str, ...] | None:
        if node is None:
            return None
        if isinstance(node, ast.Name):
            path = self.environment.get(node.id)
            return self._record(path)
        if isinstance(node, ast.Attribute):
            base = self._path(node.value)
            return self._record((*base, node.attr) if base is not None else None)
        if isinstance(node, ast.Subscript):
            base = self._path(node.value)
            key = node.slice.value if isinstance(node.slice, ast.Constant) else None
            if base is None or not isinstance(key, str):
                return None
            if "forwarded_props" in tuple(_normalized_access_name(item) for item in base) and key not in {
                "command",
                "resume",
            }:
                return self._record(base)
            return self._record((*base, str(key)))
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "getattr" and len(node.args) >= GETATTR_MIN_ARGS:
                base = self._path(node.args[0])
                key = node.args[1].value if isinstance(node.args[1], ast.Constant) else None
                return self._record((*base, str(key)) if base is not None and isinstance(key, str) else None)
            if isinstance(node.func, ast.Name) and node.func.id == "next" and node.args:
                return self._path(node.args[0])
            if isinstance(node.func, ast.Name) and node.func.id in self._functions:
                function = self._functions[node.func.id]
                bindings = {
                    argument.arg: path
                    for argument, value in zip(function.args.args, node.args, strict=False)
                    if (path := self._path(value)) is not None
                }
                return self._analyze_function(function, bindings)
            if isinstance(node.func, ast.Attribute):
                base = self._path(node.func.value)
                if node.func.attr == "get" and node.args and isinstance(node.args[0], ast.Constant):
                    key = node.args[0].value
                    return self._record((*base, str(key)) if base is not None and isinstance(key, str) else None)
                if node.func.attr in {"items", "keys", "values", "copy"}:
                    return self._record(base)
            return None
        if isinstance(node, (ast.BoolOp, ast.IfExp)):
            values = node.values if isinstance(node, ast.BoolOp) else [node.body, node.orelse]
            return next((path for value in values if (path := self._path(value)) is not None), None)
        if isinstance(node, ast.Dict):
            return next((path for value in node.values if (path := self._path(value)) is not None), None)
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            return next((path for value in node.elts if (path := self._path(value)) is not None), None)
        if isinstance(node, (ast.DictComp, ast.ListComp, ast.SetComp, ast.GeneratorExp)):
            element = node.value if isinstance(node, ast.DictComp) else node.elt
            return self._path(element) or next(
                (path for generator in node.generators if (path := self._path(generator.iter)) is not None),
                None,
            )
        if isinstance(node, ast.Compare):
            left = self._path(node.left)
            for operator, comparator in zip(node.ops, node.comparators, strict=False):
                right = self._path(comparator)
                if isinstance(operator, (ast.In, ast.NotIn)):
                    literal = node.left.value if isinstance(node.left, ast.Constant) else None
                    if literal == "resume" and right is not None:
                        self._record((*right, "resume"))
                if left is not None:
                    return left
                if right is not None:
                    return right
        return None

    def _bind(self, target: ast.AST, path: tuple[str, ...] | None) -> None:
        if isinstance(target, ast.Name):
            if path is None:
                self.environment.pop(target.id, None)
            else:
                self.environment[target.id] = path
        elif isinstance(target, (ast.Tuple, ast.List)):
            for element in target.elts:
                self._bind(element, path)

    def _analyze_function(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
        bindings: dict[str, tuple[str, ...]] | None = None,
    ) -> tuple[str, ...] | None:
        identity = id(node)
        if identity in self._active_functions:
            return None
        self._active_functions.add(identity)
        environment = {
            argument.arg: (argument.arg,)
            for argument in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)
        }
        environment.update(bindings or {})
        self._environments.append(environment)
        self._returns.append([])
        for statement in node.body:
            self.visit(statement)
        returned = self._returns.pop()
        self._environments.pop()
        self._active_functions.remove(identity)
        return returned[0] if returned else None

    def visit_Assign(self, node: ast.Assign) -> None:
        path = self._path(node.value)
        for target in node.targets:
            self._bind(target, path)
        self.generic_visit(node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._bind(node.target, self._path(node.value))
        if node.value is not None:
            self.generic_visit(node.value)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._analyze_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._analyze_function(node)

    def visit_Return(self, node: ast.Return) -> None:
        path = self._path(node.value)
        if path is not None and self._returns:
            self._returns[-1].append(path)
        if node.value is not None:
            self.generic_visit(node.value)

    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, ast.expr):
            self._path(node)
        super().generic_visit(node)


def uses_deprecated_forwarded_props_resume(source: str) -> bool:
    """Detect actual AST/data flow from forwardedProps through command to resume."""
    try:
        tree = ast.parse(textwrap.dedent(source))
    except SyntaxError:
        return False
    visitor = _DeprecatedResumeAccessVisitor(tree)
    visitor.visit(tree)
    return visitor.found


def deprecated_resume_absent(source: str | None) -> bool:
    """Absence is proven only when source inspection itself succeeded."""
    return source is not None and not uses_deprecated_forwarded_props_resume(source)


def is_resume_array(annotation: Any, entry_type: type[Any]) -> bool:
    """Require Optional[list[ResumeEntry]], not merely a field named resume."""
    alternatives = [item for item in get_args(annotation) if item is not type(None)]
    candidate = alternatives[0] if len(alternatives) == 1 else annotation
    return get_origin(candidate) is list and get_args(candidate) == (entry_type,)


def _resume_entry(entry_type: type[Any], interrupt_id: str, status: str, payload: Any) -> Any:
    try:
        return entry_type(interrupt_id=interrupt_id, status=status, payload=payload)
    except (TypeError, ValueError):
        return entry_type(interruptId=interrupt_id, status=status, payload=payload)


def standard_run_error(result: Any) -> bool:
    """Return true only for an emitted standard RUN_ERROR event."""
    items = result if isinstance(result, (list, tuple)) else [result]
    return any(str(getattr(item, "type", "")).endswith("RUN_ERROR") for item in items)


def standard_interrupt_outcome(result: Any, expected_ids: set[str]) -> bool:
    """Require a terminal RUN_FINISHED interrupt outcome with the exact open set."""
    items = result if isinstance(result, (list, tuple)) else [result]
    if not items:
        return False
    terminal = items[-1]
    outcome = getattr(terminal, "outcome", None)
    interrupts = list(getattr(outcome, "interrupts", []) or [])
    observed_ids = [str(getattr(item, "id", "")) for item in interrupts]
    return (
        str(getattr(terminal, "type", "")).endswith("RUN_FINISHED")
        and getattr(outcome, "type", None) == "interrupt"
        and len(observed_ids) == len(expected_ids)
        and set(observed_ids) == expected_ids
    )


def _public_run_input(
    input_type: type[Any],
    *,
    resume: list[Any] | None = None,
    forwarded_props: dict[str, Any] | None = None,
) -> Any:
    values = {
        "threadId": "thread-probe",
        "runId": "run-probe",
        "state": {},
        "messages": [],
        "tools": [],
        "context": [],
        "forwardedProps": forwarded_props or {},
        "resume": resume,
    }
    try:
        result = input_type(**values)
    except (TypeError, ValueError):
        result = SimpleNamespace(**values)
    for alias, attribute in (
        ("threadId", "thread_id"),
        ("runId", "run_id"),
        ("forwardedProps", "forwarded_props"),
    ):
        if not hasattr(result, attribute):
            setattr(result, attribute, getattr(result, alias))
    return result


def probe_public_resume_contract(
    agent: Any,
    input_type: type[Any],
    entry_type: type[Any],
) -> dict[str, Any]:
    """Exercise strict resume exclusively through the public prepare_stream API."""
    open_ab = [
        SimpleNamespace(
            id=interrupt_id,
            value={"reason": "confirmation", "message": interrupt_id},
        )
        for interrupt_id in ("interrupt-a", "interrupt-b")
    ]
    state_ab = SimpleNamespace(
        values={"messages": []},
        tasks=[SimpleNamespace(interrupts=open_ab)],
        next=[],
        metadata={"writes": {}},
    )
    state_cd = SimpleNamespace(
        values={"messages": []},
        tasks=[
            SimpleNamespace(
                interrupts=[
                    SimpleNamespace(
                        id="interrupt-c",
                        value={"reason": "confirmation", "message": "interrupt-c"},
                    )
                ]
            )
        ],
        next=[],
        metadata={"writes": {}},
    )
    entry_a = _resume_entry(entry_type, "interrupt-a", "resolved", {"approved": True})
    entry_b = _resume_entry(entry_type, "interrupt-b", "resolved", {"approved": False})
    unknown = _resume_entry(entry_type, "interrupt-unknown", "resolved", {"approved": True})
    invalid = SimpleNamespace(interrupt_id="interrupt-b", status="invalid", payload=True)
    config = {"configurable": {"thread_id": "thread-probe"}}

    async def prepare(input_data: Any, state: Any) -> Any:
        agent.active_run = {"id": "run-probe", "mode": "start"}
        return await agent.prepare_stream(input_data, state, config.copy())

    def run(input_data: Any, state: Any = state_ab) -> dict[str, Any]:
        try:
            result = asyncio.run(prepare(input_data, state))
        except Exception as exc:  # noqa: BLE001 - candidate behavior is fail-closed
            return {"outcome": "exception", "error": f"{type(exc).__name__}: {exc}"}
        events = list(result.get("events_to_dispatch", []) or [])
        if standard_run_error(events):
            return {"outcome": "standard_run_error", "result": result}
        return {"outcome": "accepted", "result": result, "events": events}

    cases = {
        "interrupt": run(_public_run_input(input_type)),
        "legacy": run(
            _public_run_input(
                input_type,
                forwarded_props={"command": {"resume": True}},
            )
        ),
        "partial": run(_public_run_input(input_type, resume=[entry_a])),
        "stale": run(_public_run_input(input_type, resume=[entry_a]), state_cd),
        "duplicate": run(_public_run_input(input_type, resume=[entry_a, entry_a, entry_b])),
        "unknown": run(_public_run_input(input_type, resume=[entry_a, unknown])),
        "invalid": run(_public_run_input(input_type, resume=[entry_a, invalid])),
        "full_all_open_reordered": run(_public_run_input(input_type, resume=[entry_b, entry_a])),
    }
    interrupt_events = cases["interrupt"].get("events", [])
    full_result = cases["full_all_open_reordered"].get("result", {})
    graph_dispatches = getattr(agent, "graph_dispatches", None)
    if graph_dispatches is None:
        graph_dispatches = getattr(
            getattr(agent, "graph", None), "astream_events", SimpleNamespace(call_count=-1)
        ).call_count
    invalid_cases = ("partial", "stale", "duplicate", "unknown", "invalid")
    return {
        "standard_interrupt_outcome": standard_interrupt_outcome(
            interrupt_events,
            {"interrupt-a", "interrupt-b"},
        ),
        "legacy_resume_standard_run_error": cases["legacy"]["outcome"] == "standard_run_error",
        "full_all_open_success": (
            cases["full_all_open_reordered"]["outcome"] == "accepted" and full_result.get("stream") is not None
        ),
        "all_invalid_standard_run_error": all(cases[name]["outcome"] == "standard_run_error" for name in invalid_cases),
        "graph_dispatches": graph_dispatches,
        "cases": {
            name: {
                "outcome": value["outcome"],
                **({"error": value["error"]} if "error" in value else {}),
            }
            for name, value in cases.items()
        },
    }


def probe_safe_pre_dispatch_binding(
    endpoint: Any,
    endpoint_source: str | None,
    core_module: Any,
) -> tuple[bool, dict[str, Any]]:
    """Prove the fork's dependency, clone, hook, actor, and dispatch order."""
    del core_module
    details: dict[str, Any] = {
        "source_available": endpoint_source is not None,
        "black_box_http": False,
        "deny_call_order": [],
        "success_call_order": [],
    }
    signature = inspect.signature(endpoint)
    documentation = inspect.getdoc(endpoint) or ""
    details["signature"] = str(signature)
    details["documented_dependencies"] = (
        "dependencies" in signature.parameters
        and "dependenc" in documentation.lower()
        and "before_dispatch" in documentation
    )
    details["declared_hooks"] = {
        "dependencies": "dependencies" in signature.parameters,
        "before_dispatch": "before_dispatch" in signature.parameters,
    }
    hook_parameter = signature.parameters.get("before_dispatch")
    dependency_parameter = signature.parameters.get("dependencies")
    details["keyword_only_hooks"] = (
        hook_parameter is not None
        and dependency_parameter is not None
        and hook_parameter.kind is inspect.Parameter.KEYWORD_ONLY
        and dependency_parameter.kind is inspect.Parameter.KEYWORD_ONLY
    )
    details["source_declares_three_argument_hook"] = bool(
        endpoint_source
        and re.search(
            r"before_dispatch\s*\(\s*input_data\s*,\s*request\s*,\s*request_agent\s*\)",
            endpoint_source,
        )
    )
    if not (
        endpoint_source is not None
        and all(details["declared_hooks"].values())
        and details["documented_dependencies"]
        and details["keyword_only_hooks"]
        and details["source_declares_three_argument_hook"]
    ):
        details["reason"] = "endpoint lacks documented exact three-argument fork hooks"
        return False, details

    try:
        from fastapi import Depends, FastAPI, HTTPException, Request, status
        from fastapi.testclient import TestClient

        class ProbeAgent:
            name = "binding-probe"

            def __init__(self, ledger: list[str], label: str = "template") -> None:
                self.ledger = ledger
                self.label = label
                self.bound_actor = None
                # Current strict-resume forks attach template-owned replay
                # coordination to every request clone. Opaque sentinels are
                # enough here because this black-box run does not resume.
                self._thread_lock_registry = object()
                self._resume_claim_registry = object()

            def clone(self):
                self.ledger.append("clone")
                return ProbeAgent(self.ledger, "request")

            async def run(self, input_data):
                self.ledger.append("run")
                details["run_actor"] = self.bound_actor
                details["run_agent_label"] = self.label
                payload = input_data if isinstance(input_data, dict) else {}
                details["observed_thread_id"] = getattr(
                    input_data,
                    "thread_id",
                    payload.get("threadId"),
                )
                details["observed_run_id"] = getattr(
                    input_data,
                    "run_id",
                    payload.get("runId"),
                )
                if False:
                    yield b""

        body = {
            "threadId": "binding-thread",
            "runId": "binding-run",
            "state": {},
            "messages": [],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        }

        def install(*, deny: bool) -> tuple[Any, list[str]]:
            ledger: list[str] = []
            app = FastAPI()

            async def dependency(request) -> None:
                ledger.append("dependency")
                request.state.actor_id = "server-actor"

            async def before_dispatch(input_data, request, request_agent) -> None:
                del input_data
                ledger.append("before_dispatch")
                request_agent.bound_actor = request.state.actor_id
                if deny:
                    ledger.append("deny")
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="binding probe deny",
                    )

            dependency.__annotations__["request"] = Request
            endpoint(
                app,
                ProbeAgent(ledger),
                path="/binding-probe",
                dependencies=[Depends(dependency)],
                before_dispatch=before_dispatch,
            )
            return app, ledger

        deny_app, deny_ledger = install(deny=True)
        with TestClient(deny_app) as client:
            deny_response = client.post("/binding-probe", json=body)
        success_app, success_ledger = install(deny=False)
        with TestClient(success_app) as client:
            success_response = client.post("/binding-probe", json=body)
        details["black_box_http"] = True
        details["deny_response_status"] = deny_response.status_code
        details["success_response_status"] = success_response.status_code
        details["deny_call_order"] = deny_ledger
        details["success_call_order"] = success_ledger
    except Exception as exc:  # noqa: BLE001 - candidate hook is fail-closed
        details["reason"] = f"binding execution failed: {type(exc).__name__}: {exc}"
        return False, details
    passed = (
        details["deny_call_order"] == ["dependency", "clone", "before_dispatch", "deny"]
        and details["success_call_order"] == ["dependency", "clone", "before_dispatch", "run"]
        and details.get("observed_thread_id") == "binding-thread"
        and details.get("observed_run_id") == "binding-run"
        and details.get("run_actor") == "server-actor"
        and details.get("run_agent_label") == "request"
        and details.get("deny_response_status") == status.HTTP_403_FORBIDDEN
        and details.get("success_response_status") == status.HTTP_200_OK
    )
    if not passed:
        details["reason"] = "fork endpoint did not preserve dependency/clone/hook/actor/run order"
    return passed, details


def _runtime_contracts() -> tuple[dict[str, bool], dict[str, Any]]:
    details: dict[str, Any] = {}
    try:
        agent_module = importlib.import_module("ag_ui_langgraph.agent")
        endpoint_module = importlib.import_module("ag_ui_langgraph.endpoint")
        core_module = importlib.import_module("ag_ui.core")
        agent_type = agent_module.LangGraphAgent
    except Exception as exc:  # noqa: BLE001 - candidate import is intentionally fail-closed
        details["import_error"] = f"{type(exc).__name__}: {exc}"
        return dict.fromkeys(REQUIRED_CONTRACTS, False), details

    signature = inspect.signature(agent_type)
    parameters = signature.parameters
    constructor_api = {
        "name",
        "graph",
        "description",
        "config",
    }.issubset(parameters)
    details["constructor_signature"] = str(signature)

    input_type = core_module.RunAgentInput
    model_fields = getattr(input_type, "model_fields", {})
    resume_field = model_fields.get("resume")
    resume_annotation = getattr(resume_field, "annotation", None)
    resume_entry_type = getattr(core_module, "ResumeEntry", None)
    run_agent_input_resume_array = resume_entry_type is not None and is_resume_array(
        resume_annotation, resume_entry_type
    )
    details["run_agent_input_resume_annotation"] = str(resume_annotation)

    public_resume: dict[str, Any] = {
        "standard_interrupt_outcome": False,
        "legacy_resume_standard_run_error": False,
        "full_all_open_success": False,
        "all_invalid_standard_run_error": False,
        "graph_dispatches": -1,
        "cases": {},
    }
    if hasattr(agent_type, "prepare_stream") and resume_entry_type is not None:
        try:
            from unittest.mock import MagicMock

            graph = MagicMock()
            graph.nodes = {}
            graph.config_specs = []
            public_agent = agent_type(name="admission-probe", graph=graph)
            public_resume = probe_public_resume_contract(
                public_agent,
                input_type,
                resume_entry_type,
            )
        except Exception as exc:  # noqa: BLE001 - candidate behavior is fail-closed
            details["public_resume_error"] = f"{type(exc).__name__}: {exc}"
    details["public_resume"] = public_resume
    standard_output = public_resume["standard_interrupt_outcome"] is True

    agent_source = _source(agent_module)
    endpoint_source = _source(endpoint_module)
    deprecated_channel_denied = public_resume["legacy_resume_standard_run_error"] is True
    details["source_inspection"] = {
        "agent": agent_source is not None,
        "endpoint": endpoint_source is not None,
    }
    details["deprecated_resume_source_present"] = (
        uses_deprecated_forwarded_props_resume(agent_source) if agent_source is not None else None
    )

    endpoint_signature = inspect.signature(endpoint_module.add_langgraph_fastapi_endpoint)
    details["endpoint_signature"] = str(endpoint_signature)
    safe_pre_dispatch_binding, binding_details = probe_safe_pre_dispatch_binding(
        endpoint_module.add_langgraph_fastapi_endpoint,
        endpoint_source,
        core_module,
    )
    details["pre_dispatch_binding"] = binding_details
    details["endpoint_source_sha256"] = (
        hashlib.sha256(endpoint_source.encode()).hexdigest() if endpoint_source is not None else None
    )

    contracts = {
        "constructor_api": constructor_api,
        "standard_run_finished_interrupt": standard_output,
        "run_agent_input_resume_array": run_agent_input_resume_array,
        "all_open_interrupts": (
            standard_output
            and public_resume["full_all_open_success"] is True
            and public_resume["all_invalid_standard_run_error"] is True
            and public_resume["graph_dispatches"] == 1
        ),
        "safe_pre_dispatch_binding": safe_pre_dispatch_binding,
        # Historical key retained for report compatibility. Its normative
        # meaning is now executable denial of the deprecated wire channel.
        "deprecated_forwarded_props_resume_absent": deprecated_channel_denied,
    }
    return contracts, details


def _runtime_snapshot(distribution_name: str) -> dict[str, Any]:
    distribution = importlib.metadata.distribution(distribution_name)
    metadata = distribution.metadata
    name = metadata.get("Name", distribution_name)
    version = distribution.version
    license_name = metadata.get("License-Expression") or metadata.get("License") or ""
    requires_python = metadata.get("Requires-Python") or ""
    source_sha256: dict[str, str] = {}
    source_paths: dict[str, str] = {}
    for module_name, relative_path in (
        ("ag_ui_langgraph.agent", "ag_ui_langgraph/agent.py"),
        ("ag_ui_langgraph.endpoint", "ag_ui_langgraph/endpoint.py"),
    ):
        module = importlib.import_module(module_name)
        module_path_value = getattr(module, "__file__", None)
        if not module_path_value:
            _invalid(f"runtime source path unavailable: {module_name}")
        module_path = Path(module_path_value).resolve(strict=True)
        source_sha256[relative_path] = _sha256(module_path)
        source_paths[relative_path] = str(module_path)
    return {
        "name": name,
        "version": version,
        "license": str(license_name),
        "requires_python": str(requires_python),
        "source_sha256": source_sha256,
        "source_paths": source_paths,
    }


def collect_evidence(
    artifact_path: Path,
    fork_provenance_path: Path | None = None,
    source_archive_path: Path | None = None,
    fork_repository_path: Path | None = None,
    upstream_provenance_path: Path | None = None,
    upstream_repository_path: Path | None = None,
) -> dict[str, Any]:
    artifact = inspect_artifact(artifact_path)
    fork_selected = any(
        path is not None
        for path in (
            fork_provenance_path,
            source_archive_path,
            fork_repository_path,
        )
    )
    upstream_selected = upstream_provenance_path is not None or upstream_repository_path is not None
    if fork_selected and upstream_selected:
        _invalid("fork and upstream provenance inputs are mutually exclusive")
    artifact["source_class"] = classify_candidate_source(
        artifact,
        fork_selected=fork_selected,
    )
    fork_provenance = None
    upstream_provenance = None
    if fork_provenance_path is not None:
        if fork_repository_path is None:
            _invalid("fork repository path is required with fork provenance")
        fork_provenance = validate_fork_provenance(
            load_fork_provenance(fork_provenance_path),
            artifact_path=artifact_path,
            source_archive_path=source_archive_path,
            repository_path=fork_repository_path,
            artifact=artifact,
        )
    if upstream_provenance_path is not None:
        if upstream_repository_path is None:
            _invalid("upstream repository path is required with upstream provenance")
        upstream_provenance = validate_upstream_provenance(
            load_fork_provenance(upstream_provenance_path),
            artifact_path=artifact_path,
            repository_path=upstream_repository_path,
            artifact=artifact,
        )
    runtime = _runtime_snapshot(str(artifact["name"]))
    bindings = bind_runtime_to_artifact(artifact, runtime)
    artifact["runtime_identity_bound"] = bindings["identity"]
    artifact["runtime_source_bound"] = bindings["source"]

    contracts, details = _runtime_contracts()
    details["artifact_binding"] = bindings
    details["runtime"] = runtime
    if not all(bindings.values()):
        contracts = dict.fromkeys(contracts, False)

    evidence = {
        "artifact": artifact,
        "contracts": contracts,
        "details": details,
    }
    if fork_provenance is not None:
        evidence["fork_provenance"] = fork_provenance
    if upstream_provenance is not None:
        evidence["upstream_provenance"] = upstream_provenance
    evidence["decision"] = evaluate_candidate(evidence)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-path", type=Path, required=True)
    parser.add_argument("--fork-provenance-path", type=Path)
    parser.add_argument("--source-archive-path", type=Path)
    parser.add_argument("--fork-repository-path", type=Path)
    parser.add_argument("--upstream-provenance-path", type=Path)
    parser.add_argument("--upstream-repository-path", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        evidence = collect_evidence(
            args.artifact_path,
            args.fork_provenance_path,
            args.source_archive_path,
            args.fork_repository_path,
            args.upstream_provenance_path,
            args.upstream_repository_path,
        )
    except Exception as exc:  # noqa: BLE001 - candidate metadata is intentionally fail-closed
        evidence = {
            "artifact": {
                "path": args.artifact_path.name,
            },
            "contracts": {},
            "details": {"probe_error": f"{type(exc).__name__}: {exc}"},
        }
        evidence["decision"] = evaluate_candidate(evidence)

    output = json.dumps(evidence, indent=2, sort_keys=True)
    print(output)
    return 0 if evidence["decision"]["admitted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
