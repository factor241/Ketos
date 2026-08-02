"""Capture append-only, content-addressed command evidence outside the repository."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil

GIB = 1024**3
DEFAULT_RAM_LIMIT_BYTES = int(15.5 * GIB)
DEFAULT_SAMPLE_INTERVAL_SECONDS = 0.1
TERMINATION_GRACE_SECONDS = 0.5
PACKET_SCHEMA = "ketos.stage0.command-evidence.v1"
MANIFEST_SCHEMA = "ketos.stage0.command-evidence-manifest.v1"
ANCHOR_SCHEMA = "ketos.stage0.command-evidence-anchor.v1"
QUARANTINE_SCHEMA = "ketos.stage0.command-evidence-quarantine.v1"
READ_ONLY_DIRECTORY_MODE = 0o555
READ_ONLY_FILE_MODE = 0o444
_ATTEMPT_RE = re.compile(r"^(?P<number>[0-9]{4})-(?P<digest>[0-9a-f]{64})$")
_ANCHOR_RE = re.compile(r"^(?P<number>[0-9]{4})-(?P<digest>[0-9a-f]{64})\.json$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CONTENT_FILES = ("execution.json", "resource.jsonl", "stderr.bin", "stdout.bin")
PACKET_FILES = {*CONTENT_FILES, "files.sha256", "manifest.json"}


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.write_bytes(_canonical_json(value) + b"\n")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _head_sha(repo: Path) -> str:
    git = shutil.which("git")
    if git is None:
        message = "git executable is required"
        raise RuntimeError(message)
    completed = subprocess.run(  # noqa: S603 - fixed Git command with an absolute executable.
        [git, "rev-parse", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _git_bytes(repo: Path, *args: str) -> bytes:
    git = shutil.which("git")
    if git is None:
        message = "git executable is required"
        raise RuntimeError(message)
    completed = subprocess.run(  # noqa: S603 - fixed Git command with an absolute executable.
        [git, *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )
    return completed.stdout


def _source_state(repo: Path, explicit_digest: str | None) -> dict[str, object]:
    if explicit_digest is not None and _SHA256_RE.fullmatch(explicit_digest) is None:
        message = "effective_source_sha256 must be a lowercase SHA-256 digest"
        raise ValueError(message)
    head_sha = _head_sha(repo)
    status = _git_bytes(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    diff = _git_bytes(repo, "diff", "--binary", "HEAD", "--")
    status_sha256 = _sha256_bytes(status)
    diff_sha256 = _sha256_bytes(diff)
    is_dirty = bool(status)
    if is_dirty and explicit_digest is None:
        message = "dirty repository requires explicit effective_source_sha256"
        raise ValueError(message)
    effective_digest = explicit_digest or _sha256_bytes(
        _canonical_json(
            {
                "head_sha": head_sha,
                "source_diff_sha256": diff_sha256,
                "source_status_sha256": status_sha256,
            }
        )
    )
    return {
        "effective_source_sha256": effective_digest,
        "head_sha": head_sha,
        "source_diff_sha256": diff_sha256,
        "source_dirty": is_dirty,
        "source_status_sha256": status_sha256,
    }


@contextmanager
def _command_lock(command_root: Path) -> Iterator[None]:
    """Serialize attempts for one source and command across processes."""
    lock_path = command_root / ".capture.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if os.name == "nt":  # pragma: no cover - exercised by the Windows CI matrix.
            import msvcrt

            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            msvcrt.locking(descriptor, msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        if os.name == "nt":  # pragma: no cover - exercised by the Windows CI matrix.
            import msvcrt

            os.lseek(descriptor, 0, os.SEEK_SET)
            with contextlib.suppress(OSError):
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            with contextlib.suppress(OSError):
                fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _system_used_bytes() -> int:
    memory = psutil.virtual_memory()
    return int(memory.total - memory.available)


def _process_tree_rss(process_id: int) -> int:
    try:
        process = psutil.Process(process_id)
        processes = [process, *process.children(recursive=True)]
    except psutil.Error:
        return 0
    total = 0
    for child in processes:
        try:
            total += child.memory_info().rss
        except psutil.Error:
            continue
    return total


def default_evidence_root(repo: Path | str) -> Path:
    """Return the durable Stage 0 evidence root adjacent to, never inside, the repo."""
    repository = Path(repo).resolve()
    return repository.parent / ".ketos-rebrand-evidence" / repository.name / "s0"


def _command_id(repo: Path, argv: list[str]) -> str:
    return _sha256_bytes(_canonical_json({"argv": argv, "cwd": str(repo)}))


def _existing_attempts(command_root: Path) -> list[Path]:
    if not command_root.exists():
        return []
    return sorted(
        (path for path in command_root.iterdir() if path.is_dir() and _ATTEMPT_RE.fullmatch(path.name)),
        key=lambda path: int(path.name.split("-", 1)[0]),
    )


def _existing_anchors(command_root: Path) -> list[Path]:
    anchor_root = command_root / "anchors"
    if not anchor_root.exists():
        return []
    return sorted(
        (path for path in anchor_root.iterdir() if path.is_file() and _ANCHOR_RE.fullmatch(path.name)),
        key=lambda path: int(path.name.split("-", 1)[0]),
    )


def _attempt_number(paths: list[Path]) -> int:
    numbers = [int(path.name.split("-", 1)[0]) for path in paths]
    return max(numbers, default=0) + 1


def _first_manifest_digest(attempts: list[Path], anchors: list[Path]) -> str | None:
    if attempts:
        return attempts[0].name.split("-", 1)[1]
    if anchors:
        with contextlib.suppress(OSError, UnicodeError, json.JSONDecodeError, KeyError):
            value = json.loads(anchors[0].read_text(encoding="utf-8"))
            digest = value["manifest_sha256"]
            if isinstance(digest, str) and _SHA256_RE.fullmatch(digest):
                return digest
    return None


def _owned_process_ids(process: subprocess.Popen[bytes]) -> set[int]:
    process_ids = {process.pid}
    with contextlib.suppress(psutil.Error):
        process_ids.update(child.pid for child in psutil.Process(process.pid).children(recursive=True))
    if hasattr(os, "getpgid"):
        for candidate in psutil.process_iter(["pid"]):
            with contextlib.suppress(OSError, psutil.Error):
                if os.getpgid(candidate.pid) == process.pid:
                    process_ids.add(candidate.pid)
    return process_ids


def _running_process_ids(process_ids: set[int]) -> set[int]:
    running: set[int] = set()
    for process_id in process_ids:
        try:
            candidate = psutil.Process(process_id)
            if candidate.status() != psutil.STATUS_ZOMBIE:
                running.add(process_id)
        except psutil.Error:
            continue
    return running


def _signal_process_group(process: subprocess.Popen[bytes], process_ids: set[int], sent_signal: int) -> None:
    if hasattr(os, "killpg"):
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, sent_signal)
        return
    for process_id in process_ids:  # pragma: no cover - Windows process fallback.
        with contextlib.suppress(OSError, psutil.Error):
            psutil.Process(process_id).send_signal(sent_signal)


def _wait_for_process_ids(process_ids: set[int], timeout: float) -> set[int]:
    deadline = time.monotonic() + timeout
    running = _running_process_ids(process_ids)
    while running and time.monotonic() < deadline:
        time.sleep(0.01)
        running = _running_process_ids(process_ids)
    return running


def _terminate_process_group(process: subprocess.Popen[bytes]) -> int:
    process_ids = _owned_process_ids(process)
    sent_signal = signal.SIGTERM
    _signal_process_group(process, process_ids, sent_signal)
    survivors = _wait_for_process_ids(process_ids, TERMINATION_GRACE_SECONDS)
    if survivors:
        sent_signal = signal.SIGKILL
        _signal_process_group(process, survivors, sent_signal)
        _wait_for_process_ids(process_ids, 2.0)
    return sent_signal


def _resource_sample(process_id: int | None, elapsed_ms: int) -> dict[str, int]:
    return {
        "elapsed_ms": elapsed_ms,
        "process_tree_rss_bytes": _process_tree_rss(process_id) if process_id is not None else 0,
        "system_used_bytes": _system_used_bytes(),
    }


def _seal_packet(temp_packet: Path, command_root: Path, attempt_number: int) -> Path:
    manifest = {
        "files": {name: _sha256_file(temp_packet / name) for name in CONTENT_FILES},
        "schema": MANIFEST_SCHEMA,
    }
    _write_json(temp_packet / "manifest.json", manifest)
    manifest_digest = _sha256_file(temp_packet / "manifest.json")
    checksum_names = (*CONTENT_FILES, "manifest.json")
    checksum_text = "".join(f"{_sha256_file(temp_packet / name)}  {name}\n" for name in checksum_names)
    (temp_packet / "files.sha256").write_text(checksum_text, encoding="utf-8")
    for path in temp_packet.iterdir():
        path.chmod(READ_ONLY_FILE_MODE)
    temp_packet.chmod(READ_ONLY_DIRECTORY_MODE)
    final_packet = command_root / f"{attempt_number:04d}-{manifest_digest}"
    if final_packet.exists():
        message = f"evidence packet already exists: {final_packet}"
        raise FileExistsError(message)
    temp_packet.rename(final_packet)
    return final_packet


def _write_anchor(
    packet: Path,
    *,
    attempt_number: int,
    effective_source_sha256: str,
    previous_anchor_sha256: str | None,
) -> Path:
    manifest_sha256 = packet.name.split("-", 1)[1]
    value = {
        "attempt_number": attempt_number,
        "effective_source_sha256": effective_source_sha256,
        "manifest_sha256": manifest_sha256,
        "packet_name": packet.name,
        "previous_anchor_sha256": previous_anchor_sha256,
        "schema": ANCHOR_SCHEMA,
    }
    content = _canonical_json(value) + b"\n"
    digest = _sha256_bytes(content)
    anchor_root = packet.parent / "anchors"
    anchor_root.mkdir(exist_ok=True)
    anchor_path = anchor_root / f"{attempt_number:04d}-{digest}.json"
    descriptor = os.open(anchor_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, READ_ONLY_FILE_MODE)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)
    anchor_path.chmod(READ_ONLY_FILE_MODE)
    return anchor_path


def _quarantine_capture(
    source: Path,
    command_root: Path,
    attempt_number: int,
    error: BaseException,
) -> Path | None:
    if not source.exists():
        return None
    quarantine_root = command_root / "quarantine"
    quarantine_root.mkdir(exist_ok=True)
    with contextlib.suppress(OSError):
        source.chmod(0o755)
    failure = {
        "error": str(error),
        "error_type": type(error).__name__,
        "recorded_utc": _utc_now(),
        "schema": QUARANTINE_SCHEMA,
    }
    _write_json(source / "failure.json", failure)
    for path in source.iterdir():
        with contextlib.suppress(OSError):
            path.chmod(READ_ONLY_FILE_MODE)
    failure_digest = _sha256_file(source / "failure.json")
    destination = quarantine_root / f"{attempt_number:04d}-{failure_digest}"
    source.rename(destination)
    destination.chmod(READ_ONLY_DIRECTORY_MODE)
    return destination


def capture_command(
    *,
    repo: Path | str,
    argv: list[str],
    evidence_root: Path | str | None = None,
    timeout_seconds: float | None = None,
    ram_limit_bytes: int = DEFAULT_RAM_LIMIT_BYTES,
    admission_limit_bytes: int | None = None,
    sample_interval_seconds: float = DEFAULT_SAMPLE_INTERVAL_SECONDS,
    effective_source_sha256: str | None = None,
    metadata: Mapping[str, object] | None = None,
) -> Path:
    """Run one command in its own process group and atomically seal its evidence."""
    repository = Path(repo).resolve()
    if not repository.is_dir():
        message = f"repository does not exist: {repository}"
        raise ValueError(message)
    if not argv:
        message = "command argv must not be empty"
        raise ValueError(message)
    if timeout_seconds is not None and timeout_seconds <= 0:
        message = "timeout_seconds must be positive"
        raise ValueError(message)
    if ram_limit_bytes <= 0:
        message = "ram_limit_bytes must be positive"
        raise ValueError(message)
    if admission_limit_bytes is not None and admission_limit_bytes <= 0:
        message = "admission_limit_bytes must be positive"
        raise ValueError(message)
    if sample_interval_seconds <= 0:
        message = "sample_interval_seconds must be positive"
        raise ValueError(message)
    if metadata is not None and not isinstance(metadata, Mapping):
        message = "metadata must be a mapping"
        raise ValueError(message)
    try:
        normalized_metadata = json.loads(_canonical_json(dict(metadata or {})))
    except (TypeError, ValueError) as exc:
        message = f"metadata must be canonical JSON: {exc}"
        raise ValueError(message) from exc
    source_state = _source_state(repository, effective_source_sha256)
    effective_digest = str(source_state["effective_source_sha256"])
    root = Path(evidence_root).resolve() if evidence_root is not None else default_evidence_root(repository)
    command_root = root / f"source-{effective_digest}" / "attempts" / _command_id(repository, argv)
    command_root.mkdir(parents=True, exist_ok=True)
    with _command_lock(command_root):
        attempts = _existing_attempts(command_root)
        anchors = _existing_anchors(command_root)
        attempt_number = _attempt_number([*attempts, *anchors])
        first_manifest = _first_manifest_digest(attempts, anchors)
        previous_anchor = anchors[-1].stem.split("-", 1)[1] if anchors else None
        return _capture_locked_attempt(
            repository=repository,
            argv=argv,
            command_root=command_root,
            attempt_number=attempt_number,
            first_manifest=first_manifest,
            previous_anchor_sha256=previous_anchor,
            source_state=source_state,
            timeout_seconds=timeout_seconds,
            ram_limit_bytes=ram_limit_bytes,
            admission_limit_bytes=admission_limit_bytes,
            sample_interval_seconds=sample_interval_seconds,
            metadata=normalized_metadata,
        )


def _capture_locked_attempt(
    *,
    repository: Path,
    argv: list[str],
    command_root: Path,
    attempt_number: int,
    first_manifest: str | None,
    previous_anchor_sha256: str | None,
    source_state: dict[str, object],
    timeout_seconds: float | None,
    ram_limit_bytes: int,
    admission_limit_bytes: int | None,
    sample_interval_seconds: float,
    metadata: dict[str, object],
) -> Path:
    temp_packet = Path(tempfile.mkdtemp(prefix=".capture-", dir=command_root))
    stdout_path = temp_packet / "stdout.bin"
    stderr_path = temp_packet / "stderr.bin"
    resource_path = temp_packet / "resource.jsonl"
    start_utc = _utc_now()
    start = time.monotonic()
    process: subprocess.Popen[bytes] | None = None
    final_packet: Path | None = None
    exit_code: int | None = None
    sent_signal: int | None = None
    termination_reason: str | None = None
    timed_out = False
    peak_process_rss = 0
    peak_system_used = 0
    try:
        with (
            stdout_path.open("wb") as stdout,
            stderr_path.open("wb") as stderr,
            resource_path.open("wb") as resources,
        ):
            initial_used = _system_used_bytes()
            if admission_limit_bytes is not None and initial_used > admission_limit_bytes:
                termination_reason = "admission_limit"
                sample = _resource_sample(None, 0)
                resources.write(_canonical_json(sample) + b"\n")
                peak_system_used = sample["system_used_bytes"]
            else:
                try:
                    process = subprocess.Popen(  # noqa: S603 - the caller intentionally supplies the captured command.
                        argv,
                        cwd=repository,
                        stderr=stderr,
                        stdout=stdout,
                        start_new_session=True,
                    )
                except OSError as exc:
                    stderr.write(f"{type(exc).__name__}: {exc}\n".encode())
                    exit_code = 127
                    termination_reason = "spawn_error"
                while process is not None and process.poll() is None:
                    elapsed_ms = int((time.monotonic() - start) * 1000)
                    sample = _resource_sample(process.pid, elapsed_ms)
                    resources.write(_canonical_json(sample) + b"\n")
                    resources.flush()
                    peak_process_rss = max(peak_process_rss, sample["process_tree_rss_bytes"])
                    peak_system_used = max(peak_system_used, sample["system_used_bytes"])
                    if sample["system_used_bytes"] >= ram_limit_bytes:
                        termination_reason = "ram_limit"
                    elif timeout_seconds is not None and time.monotonic() - start >= timeout_seconds:
                        termination_reason = "timeout"
                        timed_out = True
                    if termination_reason is not None:
                        sent_signal = _terminate_process_group(process)
                        break
                    time.sleep(sample_interval_seconds)
                if process is not None:
                    exit_code = process.wait()
                    final_sample = _resource_sample(process.pid, int((time.monotonic() - start) * 1000))
                    resources.write(_canonical_json(final_sample) + b"\n")
                    peak_process_rss = max(peak_process_rss, final_sample["process_tree_rss_bytes"])
                    peak_system_used = max(peak_system_used, final_sample["system_used_bytes"])

        end_utc = _utc_now()
        duration_ms = int((time.monotonic() - start) * 1000)
        if sent_signal is None and exit_code is not None and exit_code < 0:
            sent_signal = -exit_code
        verdict = "BLOCKED" if termination_reason == "admission_limit" else "PASS"
        if termination_reason != "admission_limit" and (exit_code != 0 or termination_reason is not None):
            verdict = "FAIL"
        record: dict[str, Any] = {
            "argv": argv,
            "cwd": str(repository),
            "duration_ms": duration_ms,
            "end_utc": end_utc,
            "exit_code": exit_code,
            "first_run": attempt_number == 1,
            "first_run_manifest_sha256": first_manifest,
            **source_state,
            "metadata": metadata,
            "peak_process_tree_rss_bytes": peak_process_rss,
            "peak_system_used_bytes": peak_system_used,
            "platform": {
                "architecture": platform.machine(),
                "os": platform.system(),
                "os_release": platform.release(),
                "python_executable": sys.executable,
                "python_version": platform.python_version(),
            },
            "policy": {
                "admission_limit_bytes": admission_limit_bytes,
                "ram_limit_bytes": ram_limit_bytes,
                "sample_interval_seconds": sample_interval_seconds,
                "timeout_seconds": timeout_seconds,
            },
            "schema": PACKET_SCHEMA,
            "signal": int(sent_signal) if sent_signal is not None else None,
            "start_utc": start_utc,
            "stderr_sha256": _sha256_file(stderr_path),
            "stdout_sha256": _sha256_file(stdout_path),
            "termination_reason": termination_reason,
            "timeout": timed_out,
            "verdict": verdict,
        }
        _write_json(temp_packet / "execution.json", record)
        final_packet = _seal_packet(temp_packet, command_root, attempt_number)
        _write_anchor(
            final_packet,
            attempt_number=attempt_number,
            effective_source_sha256=str(source_state["effective_source_sha256"]),
            previous_anchor_sha256=previous_anchor_sha256,
        )
    except BaseException as exc:
        if process is not None and process.poll() is None:
            _terminate_process_group(process)
            process.wait()
        source = final_packet if final_packet is not None and final_packet.exists() else temp_packet
        _quarantine_capture(source, command_root, attempt_number, exc)
        raise
    else:
        return final_packet


def _is_regular_file(path: Path) -> bool:
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except OSError:
        return False


def _verify_anchor(root: Path, packet_match: re.Match[str]) -> list[str]:
    errors: list[str] = []
    attempt_number = int(packet_match.group("number"))
    anchor_root = root.parent / "anchors"
    try:
        candidates = sorted(anchor_root.glob(f"{attempt_number:04d}-*.json"))
    except OSError as exc:
        return [f"anchor: unreadable anchor directory: {exc}"]
    if len(candidates) != 1:
        return [f"anchor: expected one external anchor, got {len(candidates)}"]
    anchor = candidates[0]
    anchor_match = _ANCHOR_RE.fullmatch(anchor.name)
    if anchor_match is None or not _is_regular_file(anchor):
        return ["anchor: invalid filename or non-regular file"]
    try:
        content = anchor.read_bytes()
        value = json.loads(content)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return [f"anchor: unreadable: {exc}"]
    actual_digest = _sha256_bytes(content)
    if actual_digest != anchor_match.group("digest"):
        errors.append("anchor: checksum mismatch")
    expected_fields = {
        "attempt_number",
        "effective_source_sha256",
        "manifest_sha256",
        "packet_name",
        "previous_anchor_sha256",
        "schema",
    }
    if not isinstance(value, dict) or set(value) != expected_fields or value.get("schema") != ANCHOR_SCHEMA:
        errors.append("anchor: invalid schema or fields")
        value = {}
    if value.get("attempt_number") != attempt_number:
        errors.append("anchor: attempt number mismatch")
    if value.get("manifest_sha256") != packet_match.group("digest"):
        errors.append("anchor: manifest checksum mismatch")
    if value.get("packet_name") != root.name:
        errors.append("anchor: packet name mismatch")
    previous = value.get("previous_anchor_sha256")
    if attempt_number == 1:
        if previous is not None:
            errors.append("anchor: first attempt must not reference a predecessor")
    else:
        predecessors = sorted(anchor_root.glob(f"{attempt_number - 1:04d}-*.json"))
        expected_previous = predecessors[0].stem.split("-", 1)[1] if len(predecessors) == 1 else None
        if previous != expected_previous or expected_previous is None:
            errors.append("anchor: previous checksum does not match chain")
    if anchor.stat().st_mode & 0o222:
        errors.append("anchor: permissions are writable")
    return errors


def verify_packet(packet: Path | str) -> list[str]:
    """Return deterministic integrity errors for one sealed evidence packet."""
    root = Path(packet).resolve()
    errors: list[str] = []
    match = _ATTEMPT_RE.fullmatch(root.name)
    if not root.is_dir() or match is None:
        return [f"invalid evidence packet path: {root}"]
    manifest_path = root / "manifest.json"
    if not _is_regular_file(manifest_path):
        return ["manifest.json: missing, non-regular, or symlinked"]
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return [f"manifest.json: unreadable manifest: {exc}"]
    actual_manifest_digest = _sha256_bytes(manifest_bytes)
    if actual_manifest_digest != match.group("digest"):
        errors.append("manifest.json: checksum does not match packet directory")
    raw_files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        errors.append("manifest.json: invalid schema")
    if not isinstance(raw_files, dict) or set(raw_files) != set(CONTENT_FILES):
        errors.append("manifest.json: files must use the fixed content-file set")
        files: dict[str, object] = {}
    else:
        files = {name: raw_files[name] for name in CONTENT_FILES}
    try:
        actual_names = {path.name for path in root.iterdir()}
    except OSError as exc:
        return [f"packet files: unreadable directory: {exc}"]
    if actual_names != PACKET_FILES:
        errors.append(f"packet files: expected {sorted(PACKET_FILES)!r}, got {sorted(actual_names)!r}")
    safe_files: set[str] = set()
    for name in (*CONTENT_FILES, "manifest.json", "files.sha256"):
        path = root / name
        if path.is_symlink():
            errors.append(f"{name}: symlink is forbidden")
        elif not _is_regular_file(path):
            errors.append(f"{name}: missing or non-regular file")
        else:
            safe_files.add(name)
    for name in CONTENT_FILES:
        expected = files.get(name)
        if not isinstance(expected, str) or _SHA256_RE.fullmatch(expected) is None:
            errors.append(f"{name}: invalid manifest checksum")
        elif name in safe_files and _sha256_file(root / name) != expected:
            errors.append(f"{name}: checksum mismatch")
    checksum_names = (*CONTENT_FILES, "manifest.json")
    expected_checksums = "".join(
        f"{_sha256_file(root / name)}  {name}\n" for name in checksum_names if name in safe_files
    )
    if "files.sha256" in safe_files:
        try:
            actual_checksums = (root / "files.sha256").read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append(f"files.sha256: unreadable: {exc}")
        else:
            if actual_checksums != expected_checksums:
                errors.append("files.sha256: checksum listing mismatch")
    if root.stat().st_mode & 0o777 != READ_ONLY_DIRECTORY_MODE:
        errors.append("packet directory: permissions are not read-only")
    errors.extend(
        f"{path.name}: permissions are writable"
        for path in root.iterdir()
        if _is_regular_file(path) and path.stat().st_mode & 0o222
    )
    errors.extend(_verify_anchor(root, match))
    return sorted(set(errors))


def _positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        message = "must be positive"
        raise argparse.ArgumentTypeError(message)
    return parsed


def _metadata_json(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        message = f"invalid JSON: {exc}"
        raise argparse.ArgumentTypeError(message) from exc
    if not isinstance(parsed, dict):
        message = "metadata JSON must be an object"
        raise argparse.ArgumentTypeError(message)
    return parsed


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    run = subparsers.add_parser("run", help="capture one command attempt")
    run.add_argument("--repo", type=Path, required=True)
    run.add_argument("--evidence-root", type=Path)
    run.add_argument("--timeout-seconds", type=_positive_float)
    run.add_argument("--ram-limit-gib", type=_positive_float, default=15.5)
    run.add_argument("--admission-limit-gib", type=_positive_float)
    run.add_argument("--effective-source-sha256")
    run.add_argument("--metadata-json", type=_metadata_json)
    run.add_argument("command", nargs=argparse.REMAINDER)
    verify = subparsers.add_parser("verify", help="verify one sealed evidence packet")
    verify.add_argument("packet", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.action == "verify":
        errors = verify_packet(args.packet)
        if errors:
            sys.stderr.write("".join(f"FAIL {error}\n" for error in errors))
            return 1
        sys.stdout.write(f"PASS evidence {args.packet}\n")
        return 0
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        _parser().error("run requires command argv after --")
    packet = capture_command(
        repo=args.repo,
        evidence_root=args.evidence_root,
        argv=command,
        timeout_seconds=args.timeout_seconds,
        ram_limit_bytes=int(args.ram_limit_gib * GIB),
        admission_limit_bytes=int(args.admission_limit_gib * GIB) if args.admission_limit_gib else None,
        effective_source_sha256=args.effective_source_sha256,
        metadata=args.metadata_json,
    )
    sys.stdout.write(f"{packet}\n")
    return 0 if execution_verdict(packet) == "PASS" else 1


def execution_verdict(packet: Path | str) -> str:
    """Read the sealed verdict for CLI exit propagation."""
    value = json.loads((Path(packet) / "execution.json").read_text(encoding="utf-8"))
    return str(value["verdict"])


if __name__ == "__main__":
    raise SystemExit(main())
