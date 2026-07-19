#!/usr/bin/env python3
"""Fail-closed source provenance audit for the Stage 01 CopilotKit fork.

The source archive is never extracted.  Its logical tar tree is compared with
``git archive`` from a commit fetched from the fixed fork remote.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import selectors
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any, NoReturn
from urllib.parse import urlsplit, urlunsplit

PACKAGE_KEY = "@copilotkit/react-core"
PACKAGE_VERSION = "1.63.1-ketos.1"
EXPECTED_ARTIFACT_SHA256 = "64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa"
NODE_VERSION = "22.23.1"
PNPM_VERSION = "10.33.4"
SOURCE_DATE_EPOCH = 1_784_227_404
FORK_SHA = "c853ac2b78cb57481cc2ca58eda4a865908c532b"
UPSTREAM_BASE_SHA = "0c9d639b1348d015f4361d2275db4b15d01c04bc"
FORK_REPOSITORY = "https://github.com/factor241/CopilotKit"
UPSTREAM_REPOSITORY = "https://github.com/CopilotKit/CopilotKit"
DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
DEFAULT_MAX_MEMBERS = 50_000
DEFAULT_MAX_MEMBER_BYTES = 64 * 1024 * 1024
DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
GIT = "/usr/bin/git" if Path("/usr/bin/git").is_file() else (shutil.which("git") or "/usr/bin/git")
CANONICAL_REBUILD = (
    "uv run --no-sync python scripts/mvp/rebuild_copilotkit_artifact.py "
    "--output-dir /tmp/ketos-stage01-copilot-pack --json"
)
EXPECTED_NODE_DISTRIBUTIONS = [
    {
        "system": "darwin",
        "architecture": "arm64",
        "url": "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-arm64.tar.gz",
        "sha256": "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953",
    },
    {
        "system": "darwin",
        "architecture": "x64",
        "url": "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-x64.tar.gz",
        "sha256": "b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81",
    },
    {
        "system": "linux",
        "architecture": "arm64",
        "url": "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-arm64.tar.xz",
        "sha256": "0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1",
    },
    {
        "system": "linux",
        "architecture": "x64",
        "url": "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz",
        "sha256": "9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578",
    },
]
EXPECTED_PNPM_DISTRIBUTION = {
    "version": PNPM_VERSION,
    "url": "https://registry.npmjs.org/pnpm/-/pnpm-10.33.4.tgz",
    "sha256": "8e70ddc6649b18bc3d895cf3a908c0291ea4c38039ad8722c47e018daf1e9cfc",
    "integrity": "sha512-HGezs1my1AgRm6HtKJ80uPw8aHNBK+xv0mT73IJInlEPy+y5zp0i2ufzt2Jp2EQQRgFL3KU7mXnNelYa1jG4AA==",
}


class AuditError(ValueError):
    """The candidate provenance does not satisfy the Stage 01 contract."""


def _fail(message: str) -> NoReturn:
    raise AuditError(message)


def _sha256_path(path: Path, *, limit: int | None = None) -> str:
    digest = hashlib.sha256()
    consumed = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            consumed += len(block)
            if limit is not None and consumed > limit:
                _fail(f"file exceeds resource limit: {path.name}")
            digest.update(block)
    return digest.hexdigest()


def _strict_json(path: Path) -> dict[str, Any]:
    if path.stat().st_size > MAX_JSON_BYTES:
        _fail("manifest exceeds JSON resource limit")

    def object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                _fail(f"manifest contains duplicate key {key!r}")
            result[key] = value
        return result

    try:
        value = json.loads(path.read_bytes(), object_pairs_hook=object_pairs)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        _fail(f"manifest is unreadable or invalid JSON: {exc}")
    if not isinstance(value, dict):
        _fail("manifest must be a JSON object")
    return value


def _sha(value: object, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        _fail(f"{label} must be an exact lowercase Git SHA")
    return value


def _digest(value: object, label: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        _fail(f"{label} must be an exact lowercase SHA-256")
    return value


def _canonical_remote(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme not in {"https", "file"} or parts.username or parts.password or parts.query or parts.fragment:
        _fail(f"remote URL is not fixed and canonical: {value!r}")
    path = parts.path.rstrip("/")
    path = path.removesuffix(".git")
    if not path:
        _fail("remote URL has no repository path")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


def _run_bounded(
    command: list[str],
    *,
    timeout: int,
    max_output_bytes: int,
    stdout_file: Any | None = None,
    env: dict[str, str] | None = None,
    cwd: Path | None = None,
) -> tuple[int, bytes, bytes]:
    """Continuously drain both pipes under an aggregate byte and time ceiling."""
    try:
        process = subprocess.Popen(  # noqa: S603 - fixed executable/argv, never a shell.
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            env=env,
            cwd=cwd,
            start_new_session=True,
        )
    except OSError as exc:
        _fail(f"bounded subprocess could not start: {exc}")
    if process.stdout is None or process.stderr is None:  # pragma: no cover - requested pipes guarantee both.
        process.kill()
        _fail("bounded subprocess pipes are unavailable")
    output = bytearray()
    error = bytearray()
    consumed = 0
    deadline = time.monotonic() + timeout
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _fail("subprocess exceeded time resource limit")
            for key, _ in selector.select(min(remaining, 0.1)):
                chunk = os.read(key.fileobj.fileno(), 64 * 1024)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                consumed += len(chunk)
                if consumed > max_output_bytes:
                    _fail("subprocess exceeded output resource limit")
                if key.data == "stdout":
                    if stdout_file is None:
                        output.extend(chunk)
                    else:
                        stdout_file.write(chunk)
                else:
                    error.extend(chunk)
        process.wait(timeout=max(0.1, deadline - time.monotonic()))
    except (AuditError, subprocess.TimeoutExpired):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()
    return process.returncode, bytes(output), bytes(error)


def _git_environment(home: Path) -> dict[str, str]:
    """Create a minimal Git environment with no inherited proxy/config/SSH authority."""
    xdg = home / "xdg"
    xdg.mkdir()
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(xdg),
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_COUNT": "0",
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_OPTIONAL_LOCKS": "0",
    }


def _git_run(
    repository: Path | None,
    *arguments: str,
    timeout: int,
    max_output_bytes: int,
    scheme: str = "file",
    stdout_file: Any | None = None,
) -> tuple[int, bytes, bytes]:
    if scheme not in {"file", "https"}:
        _fail(f"unsupported literal Git transport scheme: {scheme}")
    command = [
        GIT,
        "-c",
        "protocol.allow=never",
        "-c",
        f"protocol.{scheme}.allow=always",
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
    ]
    if repository is not None:
        command.extend(("-C", str(repository)))
    command.extend(arguments)
    with tempfile.TemporaryDirectory(prefix="ketos-copilotkit-git-home-") as directory:
        return _run_bounded(
            command,
            timeout=timeout,
            max_output_bytes=max_output_bytes,
            stdout_file=stdout_file,
            env=_git_environment(Path(directory)),
        )


def _git_capture_bytes(repository: Path, *arguments: str, timeout: int = 60, scheme: str = "file") -> bytes:
    returncode, output, _ = _git_run(
        repository,
        *arguments,
        timeout=timeout,
        max_output_bytes=MAX_GIT_OUTPUT_BYTES,
        scheme=scheme,
    )
    if returncode != 0:
        _fail(f"Git command failed: {' '.join(arguments)}")
    return output


def _git_capture(repository: Path, *arguments: str, timeout: int = 60, scheme: str = "file") -> str:
    output = _git_capture_bytes(repository, *arguments, timeout=timeout, scheme=scheme)
    try:
        return output.decode("utf-8").strip()
    except UnicodeDecodeError:
        _fail("Git command returned non-UTF-8 output")


def _reject_local_url_rewrites(repository: Path) -> None:
    returncode, output, _ = _git_run(
        repository,
        "config",
        "--local",
        "--get-regexp",
        r"^url\..*\.(insteadOf|pushInsteadOf)$",
        timeout=30,
        max_output_bytes=1024 * 1024,
    )
    if returncode == 0 and output.strip():
        _fail("repository local config contains a forbidden URL rewrite")
    if returncode not in {0, 1}:
        _fail("repository local Git config is unreadable")


def _remote_heads(repository: Path, remote: str) -> dict[str, str]:
    listed = _git_capture(repository, "ls-remote", "--heads", remote, timeout=90, scheme=urlsplit(remote).scheme)
    heads = {
        reference: sha
        for line in listed.splitlines()
        if "\t" in line
        for sha, reference in [line.split("\t", 1)]
        if re.fullmatch(r"[0-9a-f]{40}", sha) and reference.startswith("refs/heads/")
    }
    if not heads:
        _fail("fixed remote has no advertised branch heads")
    return heads


def _fetch_ref(repository: Path, remote: str, reference: str, target: str, label: str) -> None:
    status, _, _ = _git_run(
        repository,
        "fetch",
        "--no-tags",
        remote,
        f"{reference}:{target}",
        timeout=180,
        max_output_bytes=8 * 1024 * 1024,
        scheme=urlsplit(remote).scheme,
    )
    if status != 0:
        _fail(f"{label} advertised branch is not fetch-reachable")


def _populate_verified_repository(
    repository: Path, fork_remote: str, upstream_remote: str, fork_sha: str, base_sha: str
) -> None:
    init_status, _, _ = _git_run(
        None,
        "init",
        "--bare",
        str(repository),
        timeout=30,
        max_output_bytes=1024 * 1024,
    )
    if init_status != 0:
        _fail("cannot initialize isolated Git authority repository")
    fork_heads = _remote_heads(repository, fork_remote)
    fork_references = [reference for reference, sha in fork_heads.items() if sha == fork_sha]
    if not fork_references:
        _fail("fork commit is not advertised by the fixed remote")
    _fetch_ref(repository, fork_remote, sorted(fork_references)[0], "refs/stage01/fork", "fork")
    upstream_heads = _remote_heads(repository, upstream_remote)
    upstream_reference = "refs/heads/main"
    upstream_tip = upstream_heads.get(upstream_reference)
    if upstream_tip is None:
        _fail("official upstream does not advertise its fixed main branch")
    _fetch_ref(repository, upstream_remote, upstream_reference, "refs/stage01/upstream", "upstream")
    if _git_capture(repository, "rev-parse", "refs/stage01/fork") != fork_sha:
        _fail("fetched fork branch tip does not match ls-remote")
    if _git_capture(repository, "rev-parse", "refs/stage01/upstream") != upstream_tip:
        _fail("fetched upstream branch tip does not match ls-remote")
    for descendant, label in ((fork_sha, "fork"), (upstream_tip, "upstream")):
        ancestry_status, _, _ = _git_run(
            repository,
            "merge-base",
            "--is-ancestor",
            base_sha,
            descendant,
            timeout=30,
            max_output_bytes=1024 * 1024,
        )
        if ancestry_status != 0:
            _fail(f"base commit is not an ancestor of the advertised {label} branch")
    tree = _git_capture(repository, "ls-tree", "-r", fork_sha)
    if any(line.startswith("160000 ") for line in tree.splitlines()):
        _fail("fork source tree contains a forbidden gitlink")


def _safe_name(name: str, prefix: str) -> None:
    if not name or "\\" in name:
        _fail(f"source archive path is unsafe: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or name != path.as_posix() or any(part in {"", ".", ".."} for part in path.parts):
        _fail(f"source archive path is unsafe: {name!r}")
    if name != prefix.removesuffix("/") and not name.startswith(prefix):
        _fail(f"source archive path is outside the commit prefix: {name!r}")


def _archive_tree(
    path: Path,
    *,
    prefix: str,
    expected_commit: str | None,
    max_members: int,
    max_member_bytes: int,
    max_uncompressed_bytes: int,
) -> tuple[dict[str, tuple[str, int, int, str]], int, int]:
    records: dict[str, tuple[str, int, int, str]] = {}
    total = 0
    symlinks = 0
    try:
        with tarfile.open(path, "r:*") as archive:
            if expected_commit is not None and archive.pax_headers != {"comment": expected_commit}:
                _fail("source archive commit PAX header is not exact")
            for count, member in enumerate(archive, start=1):
                if count > max_members:
                    _fail("source archive exceeds member count limit")
                _safe_name(member.name, prefix)
                if member.name in records:
                    _fail(f"source archive contains duplicate path: {member.name}")
                if member.isdir():
                    kind, content_hash = "directory", ""
                elif member.isfile():
                    if member.size > max_member_bytes:
                        _fail(f"source archive member exceeds size limit: {member.name}")
                    stream = archive.extractfile(member)
                    if stream is None:
                        _fail(f"source archive member is unreadable: {member.name}")
                    digest = hashlib.sha256()
                    read = 0
                    while block := stream.read(1024 * 1024):
                        read += len(block)
                        if read > member.size:
                            _fail(f"source archive member size is inconsistent: {member.name}")
                        digest.update(block)
                    if read != member.size:
                        _fail(f"source archive member size is inconsistent: {member.name}")
                    kind, content_hash = "file", digest.hexdigest()
                elif member.issym():
                    # No extraction: target text is data and must match a mode-120000 Git blob.
                    kind = "symlink"
                    content_hash = hashlib.sha256(os.fsencode(member.linkname)).hexdigest()
                    symlinks += 1
                else:
                    _fail(f"source archive member is not a regular file, directory, or Git symlink: {member.name}")
                total += member.size
                if total > max_uncompressed_bytes:
                    _fail("source archive exceeds total uncompressed resource limit")
                records[member.name] = (kind, member.mode & 0o777, member.size, content_hash)
    except (OSError, tarfile.TarError) as exc:
        _fail(f"source archive is unreadable: {exc}")
    return records, total, symlinks


def _manifest_record(manifest: dict[str, Any]) -> dict[str, Any]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get(PACKAGE_KEY), dict):
        _fail(f"manifest has no exact {PACKAGE_KEY} record")
    return artifacts[PACKAGE_KEY]


def _package_metadata(repository: Path, fork_sha: str, record: dict[str, Any]) -> None:
    license_content = _git_capture_bytes(repository, "show", f"{fork_sha}:packages/react-core/LICENSE")
    if len(license_content) > MAX_JSON_BYTES:
        _fail("package source license is missing or oversized")
    if hashlib.sha256(license_content).hexdigest() != _digest(record.get("license_sha256"), "license SHA-256"):
        _fail("package source license SHA-256 mismatch")
    package_raw = _git_capture(repository, "show", f"{fork_sha}:packages/react-core/package.json")
    try:
        package = json.loads(package_raw)
    except json.JSONDecodeError as exc:
        _fail(f"package source metadata is invalid JSON: {exc}")
    repository_value = package.get("repository")
    repository_url = repository_value.get("url") if isinstance(repository_value, dict) else None
    if (
        package.get("name") != PACKAGE_KEY
        or package.get("version") != record.get("version")
        or package.get("license") != record.get("license_spdx")
        or not isinstance(repository_url, str)
        or _canonical_remote(repository_url) != _canonical_remote(str(record.get("upstream_repository", "")))
    ):
        _fail("package source metadata does not match the manifest")


def _canonical_rebuild(fork_sha: str, source_date_epoch: int) -> str:
    if fork_sha != FORK_SHA or source_date_epoch != SOURCE_DATE_EPOCH:
        return "invalid-noncanonical-rebuild-authority"
    return CANONICAL_REBUILD


def _expected_toolchain() -> dict[str, object]:
    return {
        "node": {"version": NODE_VERSION, "distributions": EXPECTED_NODE_DISTRIBUTIONS},
        "pnpm": EXPECTED_PNPM_DISTRIBUTION,
        "source_date_epoch": SOURCE_DATE_EPOCH,
    }


def _validate_rebuild_recipe() -> None:
    script = Path(__file__).with_name("rebuild_copilotkit_artifact.py")
    spec = importlib.util.spec_from_file_location("ketos_stage01_copilotkit_rebuild", script)
    if spec is None or spec.loader is None:
        _fail("hermetic rebuild recipe is not importable")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        recipe = module.recipe_manifest()
    except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as exc:
        _fail(f"hermetic rebuild recipe is invalid: {exc}")
    expected = {
        "schema": "ketos.stage01.copilotkit-rebuild/v1",
        "source": {"repository": FORK_REPOSITORY, "sha": FORK_SHA},
        "package": {"name": PACKAGE_KEY, "version": PACKAGE_VERSION},
        "artifact": {"filename": "copilotkit-react-core-1.63.1-ketos.1.tgz", "sha256": EXPECTED_ARTIFACT_SHA256},
        "toolchain": _expected_toolchain(),
    }
    if recipe != expected:
        _fail("hermetic rebuild recipe constants do not match admitted authority")


def audit_provenance(
    source_archive: Path,
    *,
    manifest_path: Path,
    repository_path: Path,
    artifact_path: Path,
    expected_fork_repository: str = FORK_REPOSITORY,
    expected_upstream_repository: str = UPSTREAM_REPOSITORY,
    expected_fork_sha: str | None = None,
    expected_upstream_base_sha: str | None = None,
    max_archive_bytes: int = DEFAULT_MAX_ARCHIVE_BYTES,
    max_artifact_bytes: int = DEFAULT_MAX_ARTIFACT_BYTES,
    max_members: int = DEFAULT_MAX_MEMBERS,
    max_member_bytes: int = DEFAULT_MAX_MEMBER_BYTES,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) -> dict[str, object]:
    """Audit the immutable manifest, live Git provenance, source tree and tgz binding."""
    if not source_archive.is_file() or source_archive.is_symlink():
        _fail("source archive must be one regular file")
    if not artifact_path.is_file() or artifact_path.is_symlink():
        _fail("package artifact must be one regular file")
    if source_archive.stat().st_size > max_archive_bytes:
        _fail("source archive exceeds compressed resource limit")
    if artifact_path.stat().st_size > max_artifact_bytes:
        _fail("package artifact exceeds resource limit")
    manifest = _strict_json(manifest_path)
    record = _manifest_record(manifest)
    fixed_authority = expected_fork_sha is not None
    fork_sha = _sha(record.get("fork_sha"), "fork SHA")
    base_sha = _sha(record.get("upstream_base_sha"), "upstream base SHA")
    if expected_fork_sha is not None and fork_sha != expected_fork_sha:
        _fail("fork SHA does not match the admitted immutable SHA")
    if expected_upstream_base_sha is not None and base_sha != expected_upstream_base_sha:
        _fail("upstream base SHA does not match the admitted immutable SHA")
    fork_remote = str(record.get("fork_repository", ""))
    upstream_remote = str(record.get("upstream_repository", ""))
    if _canonical_remote(fork_remote) != _canonical_remote(expected_fork_repository):
        _fail("manifest fork repository is not the fixed canonical remote")
    if _canonical_remote(upstream_remote) != _canonical_remote(expected_upstream_repository):
        _fail("manifest upstream repository is not canonical")
    _reject_local_url_rewrites(repository_path)
    origin = _git_capture(repository_path, "remote", "get-url", "origin")
    if _canonical_remote(origin) != _canonical_remote(expected_fork_repository):
        _fail("repository origin is not the fixed canonical fork")
    authority_directory = tempfile.TemporaryDirectory(prefix="ketos-copilotkit-authority-")
    repository_path = Path(authority_directory.name)
    _populate_verified_repository(
        repository_path,
        expected_fork_repository,
        expected_upstream_repository,
        fork_sha,
        base_sha,
    )
    resolved = _git_capture(repository_path, "rev-parse", f"{fork_sha}^{{commit}}")
    if resolved != fork_sha:
        _fail("fetched fork commit does not resolve exactly")
    ancestry_status, _, _ = _git_run(
        repository_path,
        "merge-base",
        "--is-ancestor",
        base_sha,
        fork_sha,
        timeout=30,
        max_output_bytes=1024 * 1024,
    )
    if ancestry_status != 0:
        _fail("upstream base is not an ancestor of the fork commit")

    if source_archive.name != record.get("source_archive"):
        _fail("source archive filename does not match manifest")
    source_hash = _sha256_path(source_archive, limit=max_archive_bytes)
    if source_hash != _digest(record.get("source_archive_sha256"), "source archive SHA-256"):
        _fail("source archive SHA-256 mismatch")
    if artifact_path.name != record.get("artifact"):
        _fail("artifact filename does not match manifest")
    artifact_hash = _sha256_path(artifact_path, limit=max_artifact_bytes)
    if artifact_hash != _digest(record.get("artifact_sha256"), "artifact SHA-256"):
        _fail("artifact SHA-256 mismatch")
    if fixed_authority and artifact_hash != EXPECTED_ARTIFACT_SHA256:
        _fail("artifact SHA-256 is not the admitted immutable digest")
    if record.get("version") != PACKAGE_VERSION or record.get("license_spdx") != "MIT":
        _fail("manifest package identity is not the admitted package/version/license")
    toolchain = record.get("toolchain")
    _validate_rebuild_recipe()
    if toolchain != _expected_toolchain():
        _fail("manifest toolchain is not exactly pinned")
    if record.get("rebuild") != CANONICAL_REBUILD:
        _fail("manifest rebuild command is not bound to the fork/package/epoch")

    changed = _git_capture(repository_path, "diff", "--name-only", base_sha, fork_sha).splitlines()
    if record.get("changed_files") != changed:
        _fail("manifest changed_files is not the exact derived fork delta")
    _package_metadata(repository_path, fork_sha, record)

    prefix = f"CopilotKit-{fork_sha}/"
    source_tree, total, symlinks = _archive_tree(
        source_archive,
        prefix=prefix,
        expected_commit=fork_sha,
        max_members=max_members,
        max_member_bytes=max_member_bytes,
        max_uncompressed_bytes=max_uncompressed_bytes,
    )
    with tempfile.NamedTemporaryFile(prefix="ketos-copilotkit-git-archive-", suffix=".tar") as expected_file:
        archive_status, _, _ = _git_run(
            repository_path,
            "archive",
            "--format=tar",
            f"--prefix={prefix}",
            fork_sha,
            timeout=120,
            max_output_bytes=max_uncompressed_bytes + (max_members + 1) * 1024,
            stdout_file=expected_file,
        )
        if archive_status != 0:
            _fail("cannot derive expected Git archive")
        expected_file.flush()
        expected_tree, _, expected_symlinks = _archive_tree(
            Path(expected_file.name),
            prefix=prefix,
            expected_commit=fork_sha,
            max_members=max_members,
            max_member_bytes=max_member_bytes,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
    if source_tree != expected_tree:
        _fail("source archive paths/bytes/modes do not match the fetched Git tree")
    if symlinks != expected_symlinks:
        _fail("source archive Git symlink set does not match the fetched Git tree")

    evidence = {
        "status": "PASS",
        "source": {
            "archive": source_archive.name,
            "sha256": source_hash,
            "commit": fork_sha,
            "members": len(source_tree),
            "uncompressed_bytes": total,
            "symlinks": symlinks,
            "tree_exact": True,
        },
        "git": {
            "fork_repository": _canonical_remote(expected_fork_repository),
            "upstream_base": base_sha,
            "fork_and_upstream_reachable": True,
            "base_is_ancestor": True,
        },
        "manifest": {
            "changed_files": len(changed),
            "artifact": artifact_path.name,
            "artifact_sha256": artifact_hash,
            "artifact_bound": True,
            "rebuild_bound": True,
        },
    }
    authority_directory.cleanup()
    return evidence


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_archive", type=Path)
    parser.add_argument("--manifest-path", type=Path, required=True)
    parser.add_argument("--repository-path", type=Path, required=True)
    parser.add_argument("--artifact-path", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        evidence = audit_provenance(
            arguments.source_archive,
            manifest_path=arguments.manifest_path,
            repository_path=arguments.repository_path,
            artifact_path=arguments.artifact_path,
            expected_fork_repository=FORK_REPOSITORY,
            expected_upstream_repository=UPSTREAM_REPOSITORY,
            expected_fork_sha=FORK_SHA,
            expected_upstream_base_sha=UPSTREAM_BASE_SHA,
        )
    except AuditError as exc:
        if arguments.json:
            print(json.dumps({"status": "FAIL", "error": str(exc)}, sort_keys=True))
        else:
            print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(evidence, indent=None if arguments.json else 2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
