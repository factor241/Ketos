#!/usr/bin/env python3
"""Hermetically rebuild the admitted Stage 01 CopilotKit package artifact."""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import json
import os
import platform
import selectors
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path, PurePosixPath
from typing import NamedTuple, NoReturn

FORK_REPOSITORY = "https://github.com/factor241/CopilotKit"
FORK_SHA = "c853ac2b78cb57481cc2ca58eda4a865908c532b"
PACKAGE_NAME = "@copilotkit/react-core"
PACKAGE_VERSION = "1.63.1-ketos.1"
ARTIFACT_FILENAME = "copilotkit-react-core-1.63.1-ketos.1.tgz"
SOURCE_DATE_EPOCH = 1784227404
NODE_VERSION = "22.23.1"
PNPM_VERSION = "10.33.4"
EXPECTED_ARTIFACT_SHA256 = "64711f7e9e94ab6126fef68fdb92f9ba80f400b88d64d3a72191ee1ed7da61aa"
PNPM_URL = "https://registry.npmjs.org/pnpm/-/pnpm-10.33.4.tgz"
PNPM_SHA256 = "8e70ddc6649b18bc3d895cf3a908c0291ea4c38039ad8722c47e018daf1e9cfc"
PNPM_INTEGRITY = "sha512-HGezs1my1AgRm6HtKJ80uPw8aHNBK+xv0mT73IJInlEPy+y5zp0i2ufzt2Jp2EQQRgFL3KU7mXnNelYa1jG4AA=="
NODE_DISTRIBUTIONS = {
    ("darwin", "arm64"): (
        "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-arm64.tar.gz",
        "ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953",
    ),
    ("darwin", "x64"): (
        "https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-x64.tar.gz",
        "b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81",
    ),
    ("linux", "arm64"): (
        "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-arm64.tar.xz",
        "0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1",
    ),
    ("linux", "x64"): (
        "https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz",
        "9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578",
    ),
}

GIT = "/usr/bin/git"
MAX_NODE_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_PNPM_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 50_000
MAX_ARCHIVE_MEMBER_BYTES = 128 * 1024 * 1024
MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 20 * 60
DOWNLOAD_TIMEOUT_SECONDS = 60


class RebuildError(RuntimeError):
    """The pinned rebuild could not be completed exactly and safely."""


class CommandResult(NamedTuple):
    argv: tuple[str, ...]
    returncode: int
    stdout: bytes
    stderr: bytes


def _fail(message: str) -> NoReturn:
    raise RebuildError(message)


def _platform_key(system: str, machine: str) -> tuple[str, str]:
    normalized_system = system.lower()
    normalized_machine = machine.lower()
    machine_aliases = {
        "arm64": "arm64",
        "aarch64": "arm64",
        "x86_64": "x64",
        "amd64": "x64",
        "x64": "x64",
    }
    key = (normalized_system, machine_aliases.get(normalized_machine, normalized_machine))
    if key not in NODE_DISTRIBUTIONS:
        _fail(f"unsupported platform: {system}/{machine}")
    return key


def recipe_manifest() -> dict[str, object]:
    """Return the complete, stable, JSON-safe rebuild recipe identity."""
    distributions = [
        {
            "system": system,
            "architecture": architecture,
            "url": url,
            "sha256": digest,
        }
        for (system, architecture), (url, digest) in sorted(NODE_DISTRIBUTIONS.items())
    ]
    return {
        "schema": "ketos.stage01.copilotkit-rebuild/v1",
        "source": {"repository": FORK_REPOSITORY, "sha": FORK_SHA},
        "package": {"name": PACKAGE_NAME, "version": PACKAGE_VERSION},
        "artifact": {"filename": ARTIFACT_FILENAME, "sha256": EXPECTED_ARTIFACT_SHA256},
        "toolchain": {
            "node": {"version": NODE_VERSION, "distributions": distributions},
            "pnpm": {
                "version": PNPM_VERSION,
                "url": PNPM_URL,
                "sha256": PNPM_SHA256,
                "integrity": PNPM_INTEGRITY,
            },
            "source_date_epoch": SOURCE_DATE_EPOCH,
        },
    }


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _write_verified_download(
    content: bytes,
    destination: Path,
    expected_sha256: str,
    *,
    expected_integrity: str | None = None,
) -> None:
    if _sha256(content) != expected_sha256:
        _fail("download SHA-256 does not match the pinned digest")
    if expected_integrity is not None:
        actual = "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode("ascii")
        if actual != expected_integrity:
            _fail("download SHA-512 integrity does not match the pinned registry metadata")
    temporary = destination.with_name(destination.name + ".partial")
    temporary.write_bytes(content)
    temporary.replace(destination)


def _download_verified(
    url: str,
    destination: Path,
    expected_sha256: str,
    *,
    max_bytes: int,
    expected_integrity: str | None = None,
) -> None:
    if not url.startswith("https://"):
        _fail("download URL must use HTTPS")
    request = urllib.request.Request(  # noqa: S310 - fixed HTTPS URLs are checked above.
        url, headers={"User-Agent": "ketos-stage01-hermetic-rebuild/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:  # noqa: S310
            if not response.geturl().startswith("https://"):
                _fail("download redirected outside HTTPS")
            length = response.headers.get("Content-Length")
            if length is not None and int(length) > max_bytes:
                _fail("download exceeds the resource limit")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(min(1024 * 1024, max_bytes - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    _fail("download exceeds the resource limit")
                chunks.append(chunk)
    except (OSError, ValueError) as exc:
        _fail(f"bounded HTTPS download failed: {exc}")
    _write_verified_download(
        b"".join(chunks),
        destination,
        expected_sha256,
        expected_integrity=expected_integrity,
    )


def _archive_path(name: str) -> PurePosixPath:
    if not name or "\\" in name:
        _fail(f"unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        _fail(f"unsafe archive path: {name!r}")
    return path


def _inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.resolve(strict=False).relative_to(root.resolve())
    except ValueError:
        return False
    return True


def _safe_extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    total = 0
    try:
        with tarfile.open(archive_path, "r:*") as archive:
            members = archive.getmembers()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                _fail("archive member count exceeds the resource limit")
            for member in members:
                relative = _archive_path(member.name)
                target = destination.joinpath(*relative.parts)
                if not _inside(destination, target):
                    _fail(f"unsafe archive path: {member.name!r}")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if member.isfile():
                    if member.size < 0 or member.size > MAX_ARCHIVE_MEMBER_BYTES:
                        _fail("archive member exceeds the resource limit")
                    total += member.size
                    if total > MAX_EXTRACTED_BYTES:
                        _fail("archive expansion exceeds the resource limit")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source = archive.extractfile(member)
                    if source is None:
                        _fail(f"archive member is unreadable: {member.name}")
                    content = source.read(member.size + 1)
                    if len(content) != member.size:
                        _fail(f"archive member size is invalid: {member.name}")
                    target.write_bytes(content)
                    target.chmod(member.mode & 0o755 or 0o644)
                    continue
                if member.issym():
                    link_target = PurePosixPath(member.linkname)
                    if link_target.is_absolute():
                        _fail(f"unsafe archive link: {member.name!r}")
                    resolved = target.parent.joinpath(*link_target.parts)
                    if any(part == ".." for part in link_target.parts) and not _inside(destination, resolved):
                        _fail(f"unsafe archive link: {member.name!r}")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.symlink_to(member.linkname)
                    continue
                if member.islnk():
                    link_path = _archive_path(member.linkname)
                    source_path = destination.joinpath(*link_path.parts)
                    if not _inside(destination, source_path) or not source_path.is_file():
                        _fail(f"unsafe archive hardlink: {member.name!r}")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.link(source_path, target)
                    continue
                _fail(f"unsupported archive member: {member.name!r}")
    except (OSError, tarfile.TarError) as exc:
        _fail(f"safe archive extraction failed: {exc}")


def _tool_environment(root: Path, tool_bin: Path, nx_socket_dir: Path) -> dict[str, str]:
    home = root / "home"
    xdg = root / "xdg"
    store = root / "pnpm-store"
    cache = root / "npm-cache"
    temporary = root / "tmp"
    for directory in (home, xdg, store, cache, temporary):
        directory.mkdir(parents=True, exist_ok=True)
    return {
        "PATH": f"{tool_bin}:/usr/bin:/bin",
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(xdg / "config"),
        "XDG_CACHE_HOME": str(xdg / "cache"),
        "XDG_DATA_HOME": str(xdg / "data"),
        "TMPDIR": str(temporary),
        "LANG": "C",
        "LC_ALL": "C",
        "TZ": "UTC",
        "CI": "1",
        "NX_SOCKET_DIR": str(nx_socket_dir),
        "SOURCE_DATE_EPOCH": str(SOURCE_DATE_EPOCH),
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_COUNT": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PROTOCOL_FROM_USER": "0",
        "NPM_CONFIG_USERCONFIG": str(root / "empty-npmrc"),
        "NPM_CONFIG_CACHE": str(cache),
        "PNPM_HOME": str(tool_bin),
        "PNPM_STORE_DIR": str(store),
    }


def _git_environment(root: Path) -> dict[str, str]:
    home = root / "git-home"
    xdg = root / "git-xdg"
    temporary = root / "git-tmp"
    for directory in (home, xdg, temporary):
        directory.mkdir(parents=True, exist_ok=True)
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(xdg / "config"),
        "XDG_CACHE_HOME": str(xdg / "cache"),
        "XDG_DATA_HOME": str(xdg / "data"),
        "TMPDIR": str(temporary),
        "LANG": "C",
        "LC_ALL": "C",
        "TZ": "UTC",
        "SOURCE_DATE_EPOCH": str(SOURCE_DATE_EPOCH),
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_COUNT": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PROTOCOL_FROM_USER": "0",
    }


def _terminate_group(process: subprocess.Popen[bytes]) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)


def _terminate_and_wait(process: subprocess.Popen[bytes]) -> None:
    _terminate_group(process)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=5)


def _run_bounded(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout: float = COMMAND_TIMEOUT_SECONDS,
    check: bool = True,
) -> CommandResult:
    if not argv or not Path(argv[0]).is_absolute():
        _fail("subprocess executable must be an absolute path")
    try:
        process = subprocess.Popen(  # noqa: S603
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        _fail(f"subprocess could not start: {exc}")
    if process.stdout is None or process.stderr is None:
        _terminate_and_wait(process)
        _fail("subprocess pipes were not created")
    stdout = bytearray()
    stderr = bytearray()
    total = 0
    deadline = time.monotonic() + timeout
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, stdout)
    selector.register(process.stderr, selectors.EVENT_READ, stderr)
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _terminate_and_wait(process)
                _fail(f"subprocess timed out: {argv[0]}")
            for key, _ in selector.select(min(remaining, 0.1)):
                chunk = os.read(key.fd, 64 * 1024)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                if total > MAX_COMMAND_OUTPUT_BYTES:
                    _terminate_and_wait(process)
                    _fail(f"subprocess exceeded aggregate output limit: {argv[0]}")
                key.data.extend(chunk)
            if process.poll() is not None and not selector.get_map():
                break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _terminate_and_wait(process)
            _fail(f"subprocess timed out: {argv[0]}")
        returncode = process.wait(timeout=remaining)
    except subprocess.TimeoutExpired:
        _terminate_and_wait(process)
        _fail(f"subprocess timed out: {argv[0]}")
    finally:
        selector.close()
    result = CommandResult(tuple(argv), returncode, bytes(stdout), bytes(stderr))
    if check and result.returncode != 0:
        detail = stderr[-4096:].decode("utf-8", "replace")
        _fail(f"subprocess failed ({result.returncode}): {' '.join(argv)}\n{detail}")
    return result


def _clone_argv(repository: Path) -> list[str]:
    return [
        GIT,
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--no-checkout",
        FORK_REPOSITORY,
        str(repository),
    ]


def _git_argv(repository: Path, *arguments: str) -> list[str]:
    return [
        GIT,
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        str(repository),
        *arguments,
    ]


def _assert_pristine_checkout(repository: Path, env: dict[str, str]) -> None:
    head = _run_bounded(_git_argv(repository, "rev-parse", "HEAD"), cwd=repository, env=env)
    if head.stdout.decode("ascii", "replace").strip() != FORK_SHA:
        _fail("checkout HEAD is not the pinned fork SHA")
    for arguments in (("diff", "--quiet"), ("diff", "--cached", "--quiet")):
        result = _run_bounded(_git_argv(repository, *arguments), cwd=repository, env=env, check=False)
        if result.returncode != 0:
            _fail("checkout is not pristine")
    status = _run_bounded(
        _git_argv(
            repository,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--ignored=matching",
        ),
        cwd=repository,
        env=env,
    )
    if status.stdout:
        _fail("checkout is not pristine (untracked or ignored files exist)")


def _assert_no_gitlinks(repository: Path, env: dict[str, str]) -> None:
    result = _run_bounded(_git_argv(repository, "ls-files", "-s"), cwd=repository, env=env)
    for line in result.stdout.splitlines():
        if line.startswith(b"160000 "):
            _fail("checkout contains a forbidden gitlink")


def _assert_tracked_unchanged(repository: Path, env: dict[str, str]) -> None:
    for arguments in (("diff", "--quiet"), ("diff", "--cached", "--quiet")):
        result = _run_bounded(_git_argv(repository, *arguments), cwd=repository, env=env, check=False)
        if result.returncode != 0:
            _fail("build modified tracked source files")


def _single_directory(root: Path, prefix: str) -> Path:
    matches = [entry for entry in root.iterdir() if entry.is_dir() and entry.name.startswith(prefix)]
    if len(matches) != 1:
        _fail(f"archive did not contain exactly one {prefix!r} root")
    return matches[0]


def _verify_tool(command: list[str], expected: str, cwd: Path, env: dict[str, str]) -> None:
    result = _run_bounded(command, cwd=cwd, env=env)
    if result.stdout.decode("utf-8", "replace").strip() != expected:
        _fail(f"tool version mismatch: expected {expected}")


def _success_evidence(artifact: Path, sha256: str, platform_key: tuple[str, str]) -> dict[str, object]:
    return {
        "status": "PASS",
        "artifact": str(artifact.resolve()),
        "artifact_sha256": sha256,
        "fork_repository": FORK_REPOSITORY,
        "fork_sha": FORK_SHA,
        "package": PACKAGE_NAME,
        "version": PACKAGE_VERSION,
        "node": NODE_VERSION,
        "pnpm": PNPM_VERSION,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "platform": {"system": platform_key[0], "architecture": platform_key[1]},
    }


def _print_json(evidence: dict[str, object]) -> None:
    print(json.dumps(evidence, sort_keys=True))


def rebuild_artifact(output_dir: Path) -> dict[str, object]:
    platform_key = _platform_key(platform.system(), platform.machine())
    node_url, node_sha256 = NODE_DISTRIBUTIONS[platform_key]
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    with (
        tempfile.TemporaryDirectory(prefix="ketos-stage01-copilotkit-") as temporary_name,
        tempfile.TemporaryDirectory(prefix="k-s01-nx-", dir="/tmp") as nx_socket_name,
    ):
        root = Path(temporary_name)
        downloads = root / "downloads"
        downloads.mkdir()
        node_archive = downloads / Path(node_url).name
        pnpm_archive = downloads / "pnpm.tgz"
        _download_verified(
            node_url,
            node_archive,
            node_sha256,
            max_bytes=MAX_NODE_ARCHIVE_BYTES,
        )
        _download_verified(
            PNPM_URL,
            pnpm_archive,
            PNPM_SHA256,
            max_bytes=MAX_PNPM_ARCHIVE_BYTES,
            expected_integrity=PNPM_INTEGRITY,
        )

        node_extract = root / "node-extract"
        pnpm_extract = root / "pnpm-extract"
        _safe_extract(node_archive, node_extract)
        _safe_extract(pnpm_archive, pnpm_extract)
        node_root = _single_directory(node_extract, f"node-v{NODE_VERSION}-")
        node = (node_root / "bin/node").resolve()
        pnpm = (pnpm_extract / "package/bin/pnpm.cjs").resolve()
        if not node.is_file() or not pnpm.is_file():
            _fail("pinned tool archive is missing its executable")

        tool_bin = root / "tool-bin"
        tool_bin.mkdir()
        (tool_bin / "node").symlink_to(node)
        (tool_bin / "pnpm").symlink_to(pnpm)
        tool_env = _tool_environment(root, tool_bin, Path(nx_socket_name))
        git_env = _git_environment(root)
        (root / "empty-npmrc").write_text("ignore-scripts=false\n", encoding="utf-8")
        _verify_tool([str(node), "--version"], f"v{NODE_VERSION}", root, tool_env)
        _verify_tool([str(node), str(pnpm), "--version"], PNPM_VERSION, root, tool_env)

        repository = root / "CopilotKit"
        _run_bounded(_clone_argv(repository), cwd=root, env=git_env)
        _run_bounded(_git_argv(repository, "checkout", "--detach", FORK_SHA), cwd=repository, env=git_env)
        head = _run_bounded(_git_argv(repository, "rev-parse", "HEAD"), cwd=repository, env=git_env)
        if head.stdout.decode().strip() != FORK_SHA:
            _fail("checkout did not resolve to the pinned fork SHA")
        remote = _run_bounded(_git_argv(repository, "remote", "get-url", "origin"), cwd=repository, env=git_env)
        if remote.stdout.decode().strip() != FORK_REPOSITORY:
            _fail("checkout origin is not the pinned fork repository")
        _assert_no_gitlinks(repository, git_env)
        _assert_pristine_checkout(repository, git_env)

        pnpm_command = [str(node), str(pnpm)]
        _run_bounded(
            [*pnpm_command, "install", "--frozen-lockfile", "--store-dir", tool_env["PNPM_STORE_DIR"]],
            cwd=repository,
            env=tool_env,
        )
        _run_bounded(
            [
                *pnpm_command,
                "exec",
                "nx",
                "run",
                "@copilotkit/react-core:check-types",
                "--skip-nx-cache",
                "--outputStyle=static",
            ],
            cwd=repository,
            env=tool_env,
        )
        package_root = repository / "packages/react-core"
        dist = package_root / "dist"
        if dist.exists():
            shutil.rmtree(dist)
        _run_bounded(
            [*pnpm_command, "--dir", str(package_root), "run", "build"],
            cwd=repository,
            env=tool_env,
        )
        pack_output = root / "pack-output"
        _run_bounded(
            [
                *pnpm_command,
                "--dir",
                str(package_root),
                "run",
                "pack:deterministic",
                str(pack_output),
            ],
            cwd=repository,
            env=tool_env,
        )
        _assert_tracked_unchanged(repository, git_env)

        candidate = pack_output / ARTIFACT_FILENAME
        if not candidate.is_file():
            _fail("deterministic pack did not create the expected artifact")
        artifact_sha256 = hashlib.sha256(candidate.read_bytes()).hexdigest()
        if artifact_sha256 != EXPECTED_ARTIFACT_SHA256:
            _fail(f"rebuilt artifact SHA-256 mismatch: {artifact_sha256}")
        destination = output_dir / ARTIFACT_FILENAME
        temporary_destination = output_dir / f".{ARTIFACT_FILENAME}.partial"
        shutil.copyfile(candidate, temporary_destination)
        temporary_destination.replace(destination)
    return _success_evidence(destination, EXPECTED_ARTIFACT_SHA256, platform_key)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = _parse_args(sys.argv[1:] if argv is None else argv)
    try:
        evidence = rebuild_artifact(arguments.output_dir)
    except RebuildError as exc:
        if arguments.json:
            _print_json({"status": "FAIL", "error": str(exc)})
        else:
            print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    if arguments.json:
        _print_json(evidence)
    else:
        print(f"PASS: {evidence['artifact_sha256']}  {evidence['artifact']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
