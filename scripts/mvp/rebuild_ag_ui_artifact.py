#!/usr/bin/env python3
"""Hermetically rebuild the admitted Stage 01 AG-UI wheel from its exact fork commit."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import platform
import selectors
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path, PurePosixPath
from typing import NamedTuple, NoReturn

FORK_REPOSITORY = "https://github.com/factor241/ag-ui"
FORK_SHA = "85b94807e464c9b38f591938a41559923a712dbb"
PACKAGE_ROOT = "integrations/langgraph/python"
ARTIFACT_FILENAME = "ag_ui_langgraph-0.0.43+ketos.1-py3-none-any.whl"
EXPECTED_ARTIFACT_SHA256 = "5ae33b1bab5a9e0adfb1425c5e279476a7ba35a385019d71be2f3ee79e8913cc"
UV_VERSION = "0.11.21"
PYTHON_VERSION = "3.13.14"
SOURCE_DATE_EPOCH = 1765974360
GIT = "/usr/bin/git"
UV_DISTRIBUTIONS = {
    ("darwin", "arm64"): (
        "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-aarch64-apple-darwin.tar.gz",
        "1f921d491ba5ffeea774eb04d6681ecee379101341cbb1500394993b541bf3f4",
    ),
    ("darwin", "x64"): (
        "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-x86_64-apple-darwin.tar.gz",
        "f3c8e5708a84b920c18b691214d54d2b0da6b984789caae95d47c95120cb7765",
    ),
    ("linux", "arm64"): (
        "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-aarch64-unknown-linux-gnu.tar.gz",
        "88e800834007cc5efd4675f166eb2a51e7e3ad19876d85fa8805a6fb5c922397",
    ),
    ("linux", "x64"): (
        "https://github.com/astral-sh/uv/releases/download/0.11.21/uv-x86_64-unknown-linux-gnu.tar.gz",
        "8c88519b0ef0af9801fcdee419bbb12116bd9e6b18e162ae093c932d8b264050",
    ),
}

MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 32
MAX_ARCHIVE_MEMBER_BYTES = 64 * 1024 * 1024
MAX_EXTRACTED_BYTES = 96 * 1024 * 1024
MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 20 * 60
DOWNLOAD_TIMEOUT_SECONDS = 60


class RebuildError(RuntimeError):
    """The exact, bounded rebuild failed closed."""


class CommandResult(NamedTuple):
    argv: tuple[str, ...]
    returncode: int
    stdout: bytes
    stderr: bytes


def _fail(message: str) -> NoReturn:
    raise RebuildError(message)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _platform_key() -> tuple[str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()
    architecture = {"aarch64": "arm64", "arm64": "arm64", "amd64": "x64", "x86_64": "x64"}.get(machine)
    key = (system, architecture or machine)
    if key not in UV_DISTRIBUTIONS:
        _fail(f"unsupported platform: {system}/{machine}")
    return key


def recipe_manifest() -> dict[str, object]:
    return {
        "schema": "ketos.stage01.ag-ui-rebuild/v1",
        "source": {"repository": FORK_REPOSITORY, "sha": FORK_SHA},
        "artifact": {"filename": ARTIFACT_FILENAME, "sha256": EXPECTED_ARTIFACT_SHA256},
        "toolchain": {
            "uv": {
                "version": UV_VERSION,
                "distributions": [
                    {"system": system, "architecture": architecture, "url": url, "sha256": digest}
                    for (system, architecture), (url, digest) in sorted(UV_DISTRIBUTIONS.items())
                ],
            },
            "python": PYTHON_VERSION,
            "source_date_epoch": SOURCE_DATE_EPOCH,
        },
    }


def _download_verified(url: str, destination: Path, expected_sha256: str) -> None:
    if not url.startswith("https://"):
        _fail("toolchain URL must use HTTPS")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, headers={"User-Agent": "ketos-stage01-agui-rebuild/1"})  # noqa: S310
    try:
        with opener.open(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            if not response.geturl().startswith("https://"):
                _fail("toolchain download redirected outside HTTPS")
            declared = response.headers.get("Content-Length")
            if declared is not None and int(declared) > MAX_DOWNLOAD_BYTES:
                _fail("toolchain download exceeds size limit")
            digest = hashlib.sha256()
            temporary = destination.with_suffix(destination.suffix + ".partial")
            total = 0
            with temporary.open("xb") as output:
                while True:
                    chunk = response.read(min(1024 * 1024, MAX_DOWNLOAD_BYTES - total + 1))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        _fail("toolchain download exceeds size limit")
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != expected_sha256:
                _fail("toolchain download SHA-256 mismatch")
            temporary.replace(destination)
    except (OSError, ValueError) as exc:
        _fail(f"bounded toolchain download failed: {exc}")


def _safe_member_path(name: str) -> PurePosixPath:
    if not name or "\\" in name:
        _fail(f"unsafe archive path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        _fail(f"unsafe archive path: {name!r}")
    return path


def _extract_uv(archive_path: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=False)
    total = 0
    uv_candidates: list[Path] = []
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                _fail("toolchain archive member count exceeds limit")
            for member in members:
                relative = _safe_member_path(member.name)
                if member.isdir():
                    continue
                if not member.isfile():
                    _fail(f"unsupported toolchain archive member: {member.name}")
                if member.size < 0 or member.size > MAX_ARCHIVE_MEMBER_BYTES:
                    _fail("toolchain archive member exceeds size limit")
                total += member.size
                if total > MAX_EXTRACTED_BYTES:
                    _fail("toolchain archive expansion exceeds size limit")
                source = archive.extractfile(member)
                if source is None:
                    _fail(f"toolchain archive member is unreadable: {member.name}")
                content = source.read(member.size + 1)
                if len(content) != member.size:
                    _fail(f"toolchain archive member size mismatch: {member.name}")
                target = destination.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                target.chmod(member.mode & 0o755 or 0o644)
                if relative.name == "uv":
                    uv_candidates.append(target)
    except (OSError, tarfile.TarError) as exc:
        _fail(f"safe uv extraction failed: {exc}")
    if len(uv_candidates) != 1 or not stat.S_ISREG(uv_candidates[0].stat().st_mode):
        _fail("toolchain archive must contain exactly one regular uv executable")
    pinned_uv = destination / "uv"
    uv_candidates[0].replace(pinned_uv)
    pinned_uv.chmod(0o755)
    return pinned_uv


def _run_bounded(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout_seconds: float = COMMAND_TIMEOUT_SECONDS,
) -> CommandResult:
    try:
        process = subprocess.Popen(  # noqa: S603 - argv is an explicit fixed-tool list, never a shell.
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        _fail(f"command could not start: {exc}")
    if process.stdout is None or process.stderr is None:
        process.kill()
        process.wait()
        _fail("command output pipes were not created")
    selector = selectors.DefaultSelector()
    outputs = {process.stdout: bytearray(), process.stderr: bytearray()}
    for stream in outputs:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout_seconds
    completed = False
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _fail(f"command timed out after {timeout_seconds} seconds")
            for key, _mask in selector.select(timeout=min(remaining, 0.1)):
                stream = key.fileobj
                try:
                    chunk = os.read(stream.fileno(), 64 * 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(stream)
                    continue
                outputs[stream].extend(chunk)
                if sum(len(item) for item in outputs.values()) > MAX_COMMAND_OUTPUT_BYTES:
                    _fail("command aggregate output limit exceeded")
        returncode = process.wait(timeout=max(0.0, deadline - time.monotonic()))
        result = CommandResult(tuple(argv), returncode, bytes(outputs[process.stdout]), bytes(outputs[process.stderr]))
        if returncode != 0:
            error = result.stderr.decode("utf-8", errors="replace")[-4000:]
            _fail(f"command exited with status {returncode}: {error}")
        completed = True
        return result
    finally:
        selector.close()
        if not completed:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def _sanitized_environment(root: Path, uv: Path) -> dict[str, str]:
    home = root / "home"
    cache = root / "cache"
    python_dir = root / "python"
    for path in (home, cache, python_dir):
        path.mkdir(parents=True, exist_ok=True)
    return {
        "HOME": str(home),
        "PATH": str(uv.parent),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "TZ": "UTC",
        "PYTHONHASHSEED": "0",
        "SOURCE_DATE_EPOCH": str(SOURCE_DATE_EPOCH),
        "UV_CACHE_DIR": str(cache),
        "UV_PYTHON_INSTALL_DIR": str(python_dir),
        "UV_PYTHON_PREFERENCE": "only-managed",
        "UV_NO_PROGRESS": "1",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_COUNT": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/bin/false",
    }


def _assert_pristine(repository: Path, env: dict[str, str]) -> None:
    result = _run_bounded(
        [GIT, "-C", str(repository), "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=repository,
        env=env,
    )
    if result.stdout:
        _fail("fresh source checkout is not pristine")


def _clone_exact_source(repository: Path, env: dict[str, str]) -> None:
    commands = (
        [GIT, "init", "--initial-branch", "ketos-build"],
        [GIT, "config", "core.hooksPath", "/dev/null"],
        [GIT, "config", "protocol.file.allow", "never"],
        [GIT, "remote", "add", "origin", FORK_REPOSITORY],
        [GIT, "fetch", "--no-tags", "--depth=1", FORK_REPOSITORY, FORK_SHA],
        [GIT, "checkout", "--detach", FORK_SHA],
    )
    for command in commands:
        _run_bounded(command, cwd=repository, env=env)
    resolved = _run_bounded([GIT, "-C", str(repository), "rev-parse", "HEAD"], cwd=repository, env=env)
    if resolved.stdout.decode("ascii", errors="strict").strip() != FORK_SHA:
        _fail("fresh checkout did not resolve to the exact fork SHA")
    _assert_pristine(repository, env)


def _run_build(
    repository: Path,
    uv: Path,
    output_dir: Path,
    env: dict[str, str],
    *,
    run_tests: bool,
) -> None:
    _run_bounded([str(uv), "python", "install", PYTHON_VERSION], cwd=repository, env=env)
    version = _run_bounded([str(uv), "--version"], cwd=repository, env=env)
    reported_version = version.stdout.decode("ascii", errors="replace").strip()
    if not (reported_version == f"uv {UV_VERSION}" or reported_version.startswith(f"uv {UV_VERSION} ")):
        _fail("extracted uv executable version does not match the pinned recipe")
    if run_tests:
        _run_bounded(
            [
                str(uv),
                "run",
                "--python",
                PYTHON_VERSION,
                "--project",
                PACKAGE_ROOT,
                "pytest",
                "-q",
                f"{PACKAGE_ROOT}/tests",
            ],
            cwd=repository,
            env=env,
        )
    _run_bounded(
        [str(uv), "build", "--python", PYTHON_VERSION, "--wheel", PACKAGE_ROOT, "--out-dir", str(output_dir)],
        cwd=repository,
        env=env,
    )


def rebuild(output_dir: Path, *, run_tests: bool) -> dict[str, object]:
    resolved_output = output_dir.resolve()
    resolved_output.mkdir(parents=True, exist_ok=True)
    if any(resolved_output.iterdir()):
        _fail("output directory must be empty")
    with tempfile.TemporaryDirectory(prefix="ketos-stage01-agui-rebuild-") as temporary:
        root = Path(temporary).resolve()
        tool_archive = root / "uv.tar.gz"
        url, expected_uv_sha = UV_DISTRIBUTIONS[_platform_key()]
        _download_verified(url, tool_archive, expected_uv_sha)
        uv = _extract_uv(tool_archive, root / "toolchain")
        env = _sanitized_environment(root, uv)
        repository = root / "source"
        repository.mkdir()
        _clone_exact_source(repository, env)
        build_output = root / "dist"
        build_output.mkdir()
        _run_build(repository, uv, build_output, env, run_tests=run_tests)
        candidates = list(build_output.glob("*.whl"))
        if len(candidates) != 1 or candidates[0].name != ARTIFACT_FILENAME:
            _fail(f"build produced an unexpected wheel inventory: {[item.name for item in candidates]}")
        digest = _sha256(candidates[0])
        if digest != EXPECTED_ARTIFACT_SHA256:
            _fail(f"rebuilt wheel SHA-256 mismatch: {digest}")
        destination = resolved_output / ARTIFACT_FILENAME
        destination.write_bytes(candidates[0].read_bytes())
    return {**recipe_manifest(), "result": {"path": str(destination), "sha256": _sha256(destination)}}


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--run-tests", action="store_true")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        result = rebuild(args.output_dir, run_tests=args.run_tests)
    except (OSError, UnicodeError, RebuildError) as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        else:
            print(f"FAIL: {exc}")
        return 1
    if args.json:
        print(json.dumps({"ok": True, **result}, sort_keys=True))
    else:
        print(f"PASS: {result['result']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
