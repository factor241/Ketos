#!/usr/bin/env python3
"""Fail-closed source provenance audit for the Stage 01 CopilotKit fork.

The source archive is never extracted.  Its logical tar tree is compared with
``git archive`` from a commit fetched from the fixed fork remote.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import selectors
import shutil
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
NODE_VERSION = "22.23.1"
PNPM_VERSION = "10.33.4"
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
GIT = shutil.which("git") or "/usr/bin/git"


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
) -> tuple[int, bytes, bytes]:
    """Continuously drain both pipes under an aggregate byte and time ceiling."""
    try:
        process = subprocess.Popen(  # noqa: S603 - fixed executable/argv, never a shell.
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
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
        process.kill()
        process.wait()
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()
    return process.returncode, bytes(output), bytes(error)


def _git_capture_bytes(repository: Path, *arguments: str, timeout: int = 60) -> bytes:
    returncode, output, _ = _run_bounded(
        [GIT, "-C", str(repository), *arguments],
        timeout=timeout,
        max_output_bytes=MAX_GIT_OUTPUT_BYTES,
    )
    if returncode != 0:
        _fail(f"Git command failed: {' '.join(arguments)}")
    return output


def _git_capture(repository: Path, *arguments: str, timeout: int = 60) -> str:
    output = _git_capture_bytes(repository, *arguments, timeout=timeout)
    try:
        return output.decode("utf-8").strip()
    except UnicodeDecodeError:
        _fail("Git command returned non-UTF-8 output")


def _remote_heads(repository: Path, remote: str) -> dict[str, str]:
    listed = _git_capture(repository, "ls-remote", "--heads", remote, timeout=90)
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


def _fetch_advertised_branch(remote: str, reference: str, *, expected_tip: str, base_sha: str, label: str) -> None:
    with tempfile.TemporaryDirectory(prefix="ketos-copilotkit-remote-proof-") as directory:
        repository = Path(directory)
        init_status, _, _ = _run_bounded(
            [GIT, "init", "--bare", str(repository)], timeout=30, max_output_bytes=1024 * 1024
        )
        fetch_status, _, _ = _run_bounded(
            [
                GIT,
                "-C",
                str(repository),
                "fetch",
                "--filter=blob:none",
                "--no-tags",
                remote,
                f"{reference}:refs/stage01/proof",
            ],
            timeout=180,
            max_output_bytes=8 * 1024 * 1024,
        )
        if init_status != 0 or fetch_status != 0:
            _fail(f"{label} advertised branch is not fetch-reachable")
        tip = _git_capture(repository, "rev-parse", "refs/stage01/proof")
        if tip != expected_tip:
            _fail(f"{label} fetched branch tip does not match ls-remote")
        ancestry_status, _, _ = _run_bounded(
            [GIT, "-C", str(repository), "merge-base", "--is-ancestor", base_sha, tip],
            timeout=30,
            max_output_bytes=1024 * 1024,
        )
        if ancestry_status != 0:
            _fail(f"base commit is not an ancestor of the advertised {label} branch")


def _verify_remotes(repository: Path, fork_remote: str, upstream_remote: str, fork_sha: str, base_sha: str) -> None:
    fork_heads = _remote_heads(repository, fork_remote)
    fork_references = [reference for reference, sha in fork_heads.items() if sha == fork_sha]
    if not fork_references:
        _fail("fork commit is not advertised by the fixed remote")
    _fetch_advertised_branch(
        fork_remote,
        sorted(fork_references)[0],
        expected_tip=fork_sha,
        base_sha=base_sha,
        label="fork",
    )
    upstream_heads = _remote_heads(repository, upstream_remote)
    upstream_reference = "refs/heads/main"
    upstream_tip = upstream_heads.get(upstream_reference)
    if upstream_tip is None:
        _fail("official upstream does not advertise its fixed main branch")
    _fetch_advertised_branch(
        upstream_remote,
        upstream_reference,
        expected_tip=upstream_tip,
        base_sha=base_sha,
        label="upstream",
    )


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
    pnpm = f'npx --yes --package=node@{NODE_VERSION} -- node "$(command -v corepack)" pnpm@{PNPM_VERSION}'
    return (
        f"git checkout {fork_sha} && {pnpm} install --frozen-lockfile && "
        f"{pnpm} exec nx run @copilotkit/react-core:check-types --skip-nx-cache --outputStyle=static && "
        f"rm -rf packages/react-core/dist && {pnpm} --dir packages/react-core run build && "
        f"SOURCE_DATE_EPOCH={source_date_epoch} {pnpm} --dir packages/react-core run pack:deterministic "
        "/tmp/ketos-stage01-copilot-pack"  # noqa: S108 - exact manifest-owned isolated build path.
    )


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
    origin = _git_capture(repository_path, "remote", "get-url", "origin")
    if _canonical_remote(origin) != _canonical_remote(expected_fork_repository):
        _fail("repository origin is not the fixed canonical fork")
    _verify_remotes(repository_path, expected_fork_repository, expected_upstream_repository, fork_sha, base_sha)
    resolved = _git_capture(repository_path, "rev-parse", f"{fork_sha}^{{commit}}")
    if resolved != fork_sha:
        _fail("fetched fork commit does not resolve exactly")
    ancestry_status, _, _ = _run_bounded(
        [GIT, "-C", str(repository_path), "merge-base", "--is-ancestor", base_sha, fork_sha],
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
    if record.get("version") != PACKAGE_VERSION or record.get("license_spdx") != "MIT":
        _fail("manifest package identity is not the admitted package/version/license")
    toolchain = record.get("toolchain")
    epoch = toolchain.get("source_date_epoch") if isinstance(toolchain, dict) else None
    if toolchain != {"node": NODE_VERSION, "pnpm": PNPM_VERSION, "source_date_epoch": epoch}:
        _fail("manifest toolchain is not exactly pinned")
    if not isinstance(epoch, int) or epoch <= 0 or record.get("rebuild") != _canonical_rebuild(fork_sha, epoch):
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
        archive_status, _, _ = _run_bounded(
            [
                GIT,
                "-C",
                str(repository_path),
                "archive",
                "--format=tar",
                f"--prefix={prefix}",
                fork_sha,
            ],
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

    return {
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
