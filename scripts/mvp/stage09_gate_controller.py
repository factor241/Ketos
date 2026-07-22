#!/usr/bin/env python3
# ruff: noqa: EM101, EM102, S603, S606, S607, TC003, TRY003
"""Fail-closed Stage-09 gate supervisor with an independent RAM monitor."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import select
import signal
import stat
import subprocess
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from typing import Any

import psutil

GIB = 1024**3
PROTOCOL_VERSION = 1
RESULT_SCHEMA = "ketos.stage09.gate-result.v1"
TELEMETRY_SCHEMA = "ketos.stage09.resource-telemetry.v1"
DESELECTED_RE = re.compile(r"^=+ [0-9]+ deselected(?:, [0-9]+ warnings?)? in [0-9]+(?:\.[0-9]+)?s =+$")
TERMINATION_GRACE_SECONDS = 0.5
MONITOR_READY_TIMEOUT_SECONDS = 5.0
PIPE_ATOMIC_BYTES = 4096
PYTEST_NO_TESTS_COLLECTED = 5
ACCEPTED_CLASSIFICATIONS = {"PASS", "DESELECTED_ONLY"}


@dataclass(frozen=True)
class Policy:
    """Byte-exact Stage-09 resource thresholds."""

    idle_limit_bytes: int = int(14.5 * GIB)
    soft_limit_bytes: int = 15 * GIB
    predictive_limit_bytes: int = int(15.25 * GIB)
    hard_limit_bytes: int = int(15.5 * GIB)
    absolute_limit_bytes: int = 16 * GIB
    sample_interval_seconds: float = 0.25
    heartbeat_timeout_seconds: float = 1.25

    def __post_init__(self) -> None:
        limits = (
            self.idle_limit_bytes,
            self.soft_limit_bytes,
            self.predictive_limit_bytes,
            self.hard_limit_bytes,
            self.absolute_limit_bytes,
        )
        if any(value <= 0 for value in limits) or any(left >= right for left, right in pairwise(limits)):
            raise ValueError("Stage-09 RAM limits must be positive and monotonically ordered")
        if self.sample_interval_seconds <= 0:
            raise ValueError("sample interval must be positive")
        if self.heartbeat_timeout_seconds < 3 * self.sample_interval_seconds:
            raise ValueError("heartbeat timeout must cover at least three sample intervals")


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _system_rss_bytes() -> int:
    """Return the system-wide used-memory proxy: total minus available bytes."""
    memory = psutil.virtual_memory()
    return int(memory.total - memory.available)


def _git_state(cwd: Path) -> tuple[str | None, str | None]:
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None, None
    return head, status


def _write_json_exclusive(path: Path, payload: object) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=False) as stream:
            json.dump(payload, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        os.close(descriptor)


def _write_jsonl_line(descriptor: int, payload: dict[str, Any]) -> None:
    data = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode()
    if len(data) > PIPE_ATOMIC_BYTES:
        raise RuntimeError("monitor protocol message exceeds atomic pipe size")
    os.write(descriptor, data)


def _validate_output_path(path: Path) -> Path:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        raise ValueError(f"evidence output path must be absolute: {candidate}")
    parent = candidate.parent.resolve(strict=True)
    if not parent.is_dir() or parent.is_symlink():
        raise ValueError(f"evidence output parent must be a real directory: {parent}")
    if candidate.exists() or candidate.is_symlink():
        raise FileExistsError(f"refusing to overwrite evidence output: {candidate}")
    return parent / candidate.name


@contextmanager
def _serial_gate_lock(lock_path: Path | None) -> Iterator[dict[str, Any] | None]:
    if lock_path is None:
        yield None
        return
    lock_path = lock_path.expanduser()
    if not lock_path.is_absolute():
        raise ValueError("gate lock path must be absolute")
    parent = lock_path.parent.resolve(strict=True)
    if not parent.is_dir() or lock_path.is_symlink():
        raise ValueError("gate lock parent must be a real directory and lock must not be a symlink")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("gate lock must be a regular file owned by the current user")
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("another Stage-09 heavy gate holds the serial lock") from exc
        yield {"path": str(parent / lock_path.name), "device": info.st_dev, "inode": info.st_ino}
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _group_members(pgid: int) -> list[int]:
    members: list[int] = []
    for process in psutil.process_iter(["pid"]):
        with contextlib.suppress(OSError, psutil.Error):
            if os.getpgid(process.pid) == pgid and process.status() != psutil.STATUS_ZOMBIE:
                members.append(process.pid)
    return sorted(members)


def _terminate_group(pgid: int) -> dict[str, Any]:
    cleanup: dict[str, Any] = {"attempted": False, "signals": [], "survivors": []}
    if pgid <= 1:
        cleanup["error"] = "refused unsafe process group"
        return cleanup
    members = _group_members(pgid)
    if not members:
        return cleanup
    cleanup["attempted"] = True
    for sent_signal, grace in ((signal.SIGTERM, TERMINATION_GRACE_SECONDS), (signal.SIGKILL, 2.0)):
        current = _group_members(pgid)
        if not current:
            break
        try:
            os.killpg(pgid, sent_signal)
            cleanup["signals"].append({"signal": sent_signal.name, "at": _utc_now(), "members": current})
        except ProcessLookupError:
            break
        deadline = time.monotonic() + grace
        while _group_members(pgid) and time.monotonic() < deadline:
            time.sleep(0.01)
    cleanup["survivors"] = _group_members(pgid)
    return cleanup


def _terminate_target(target: subprocess.Popen[bytes]) -> dict[str, Any]:
    """Terminate the exact target group, or only the exact PID if identity is unsafe."""
    try:
        pgid = os.getpgid(target.pid)
    except ProcessLookupError:
        return {"attempted": False, "signals": [], "survivors": []}
    if pgid == target.pid:
        return _terminate_group(pgid)
    cleanup: dict[str, Any] = {
        "attempted": True,
        "identity_error": "target_pgid_does_not_equal_target_pid",
        "signals": [],
        "survivors": [],
    }
    for method, sent_signal, grace in (
        (target.terminate, signal.SIGTERM, TERMINATION_GRACE_SECONDS),
        (target.kill, signal.SIGKILL, 2.0),
    ):
        if target.poll() is not None:
            break
        method()
        cleanup["signals"].append({"signal": sent_signal.name, "at": _utc_now(), "members": [target.pid]})
        try:
            target.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            continue
    if target.poll() is None:
        cleanup["survivors"] = [target.pid]
    return cleanup


def _deselected_only(log_path: Path) -> bool:
    try:
        lines = [line.strip() for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines()]
    except OSError:
        return False
    summaries = [line for line in lines if DESELECTED_RE.fullmatch(line)]
    lowered = "\n".join(lines).lower()
    forbidden = (" failed", " error", "errors during collection", "traceback")
    return len(summaries) == 1 and not any(fragment in lowered for fragment in forbidden)


def _telemetry_record(event: str, **values: Any) -> dict[str, Any]:
    return {
        "schema": TELEMETRY_SCHEMA,
        "protocol_version": PROTOCOL_VERSION,
        "event": event,
        "at": _utc_now(),
        "monotonic_ns": time.monotonic_ns(),
        **values,
    }


def _monitor_main(args: argparse.Namespace) -> int:
    policy = Policy(**json.loads(args.policy_json))
    test_samples = tuple(json.loads(args.test_rss_json)) if args.test_rss_json else ()
    sample_index = 0
    sequence = 0
    soft_sent = False
    predictive_sent = False
    hard_sent = False
    telemetry_fd = os.open(args.telemetry, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:

        def record(payload: dict[str, Any], *, notify: bool = True) -> None:
            line = (json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n").encode()
            os.write(telemetry_fd, line)
            os.fsync(telemetry_fd)
            if notify:
                _write_jsonl_line(args.heartbeat_fd, payload)

        record(
            _telemetry_record(
                "MONITOR_START",
                monitor_pid=os.getpid(),
                supervisor_pid=args.supervisor_pid,
                target_pgid=args.target_pgid,
                metric="psutil.virtual_memory.total-minus-available",
                policy=asdict(policy),
            ),
            notify=False,
        )
        while True:
            if select.select([args.control_fd], [], [], 0)[0]:
                control = os.read(args.control_fd, 64)
                if control == b"" or control.startswith(b"STOP"):
                    record(_telemetry_record("MONITOR_STOP", sequence=sequence))
                    return 0
            if test_samples:
                rss = int(test_samples[min(sample_index, len(test_samples) - 1)])
                sample_index += 1
            else:
                rss = _system_rss_bytes()
            sequence += 1
            heartbeat = _telemetry_record(
                "HEARTBEAT", sequence=sequence, system_rss_bytes=rss, target_pgid=args.target_pgid
            )
            record(heartbeat)
            if sequence == 1:
                _write_jsonl_line(
                    args.heartbeat_fd,
                    _telemetry_record("READY", sequence=sequence, system_rss_bytes=rss),
                )
                if args.test_exit_after_ready:
                    time.sleep(policy.sample_interval_seconds * 2)
                    os._exit(91)
            if rss >= policy.soft_limit_bytes and not soft_sent:
                soft_sent = True
                record(_telemetry_record("SOFT_WARNING", sequence=sequence, system_rss_bytes=rss))
            if rss >= policy.predictive_limit_bytes and not predictive_sent:
                predictive_sent = True
                record(_telemetry_record("PREDICTIVE_STOP", sequence=sequence, system_rss_bytes=rss))
            if rss >= policy.hard_limit_bytes and not hard_sent:
                hard_sent = True
                record(
                    _telemetry_record(
                        "RAM_GUARD_TRIP",
                        sequence=sequence,
                        system_rss_bytes=rss,
                        observed_ge_16=rss >= policy.absolute_limit_bytes,
                    )
                )
            time.sleep(policy.sample_interval_seconds)
    finally:
        os.close(telemetry_fd)


def _exec_wait_main(args: argparse.Namespace) -> int:
    token = os.read(args.start_fd, 1)
    os.close(args.start_fd)
    if token != b"1":
        return 125
    os.execvp(args.command[0], args.command)
    return 127


def _receive_messages(descriptor: int, buffer: bytes) -> tuple[list[dict[str, Any]], bytes, bool]:
    try:
        chunk = os.read(descriptor, 65536)
    except BlockingIOError:
        return [], buffer, False
    if chunk == b"":
        return [], buffer, True
    buffer += chunk
    messages: list[dict[str, Any]] = []
    while b"\n" in buffer:
        raw, buffer = buffer.split(b"\n", 1)
        try:
            value = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("malformed monitor protocol message") from exc
        if not isinstance(value, dict) or value.get("protocol_version") != PROTOCOL_VERSION:
            raise RuntimeError("invalid monitor protocol message")
        messages.append(value)
    return messages, buffer, False


def _base_result(
    *, cwd: Path, expected_sha: str, command: Sequence[str], policy: Policy, started_at: str
) -> dict[str, Any]:
    return {
        "schema": RESULT_SCHEMA,
        "classification": "INFRA_FAILURE",
        "accepted": False,
        "argv": list(command),
        "cwd": str(cwd),
        "expected_sha": expected_sha,
        "actual_sha_before": None,
        "actual_sha_after": None,
        "started_at": started_at,
        "ended_at": None,
        "duration_ms": 0,
        "exit_code": None,
        "signal": None,
        "stop_reason": None,
        "supervisor_pid": os.getpid(),
        "monitor_pid": None,
        "target_pid": None,
        "target_pgid": None,
        "monitor_ready_before_release": False,
        "telemetry_continuous": False,
        "heartbeat_count": 0,
        "last_heartbeat_sequence": 0,
        "peak_system_rss_bytes": 0,
        "observed_ge_16": False,
        "policy": asdict(policy),
        "cleanup": {"attempted": False, "signals": [], "survivors": []},
        "lock": None,
    }


def _finish_result(result: dict[str, Any], *, started: float, result_path: Path) -> dict[str, Any]:
    result["ended_at"] = _utc_now()
    result["duration_ms"] = int((time.monotonic() - started) * 1000)
    result["accepted"] = (
        result["classification"] in ACCEPTED_CLASSIFICATIONS
        and not result["cleanup"]["survivors"]
        and not result["observed_ge_16"]
        and result["telemetry_continuous"]
    )
    _write_json_exclusive(result_path, result)
    return result


def _validate_telemetry_journal(path: Path, *, absolute_limit_bytes: int) -> dict[str, int]:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"telemetry journal is missing or unsafe: {path}")
    try:
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"telemetry journal is unreadable: {path}") from exc
    if not records or any(
        not isinstance(record, dict) or record.get("schema") != TELEMETRY_SCHEMA for record in records
    ):
        raise ValueError(f"telemetry journal has an invalid schema: {path}")
    if records[0].get("event") != "MONITOR_START" or records[-1].get("event") != "MONITOR_STOP":
        raise ValueError(f"telemetry is not continuous from monitor start through stop: {path}")
    heartbeats = [record for record in records if record.get("event") == "HEARTBEAT"]
    sequences = [record.get("sequence") for record in heartbeats]
    if not sequences or sequences != list(range(1, len(sequences) + 1)):
        raise ValueError(f"telemetry heartbeat sequence is not continuous: {path}")
    if any(record.get("event") == "RAM_GUARD_TRIP" for record in records):
        raise ValueError(f"telemetry contains a RAM guard trip: {path}")
    rss_values = [int(record["system_rss_bytes"]) for record in heartbeats]
    if any(value >= absolute_limit_bytes for value in rss_values):
        raise ValueError(f"telemetry reached the absolute 16 GiB limit: {path}")
    return {"heartbeat_count": len(heartbeats), "peak_system_rss_bytes": max(rss_values)}


def summarize_results(*, results_dir: Path, telemetry_dir: Path, output: Path) -> dict[str, Any]:
    """Validate every gate journal and create the Stage-09 resource summary."""
    output = _validate_output_path(output)
    run_root = output.parent.parent.resolve(strict=True)
    results_root = results_dir.expanduser().resolve(strict=True)
    telemetry_root = telemetry_dir.expanduser().resolve(strict=True)
    if results_root != run_root / "process/gates" or telemetry_root != run_root / "process/telemetry":
        raise ValueError("resource inputs must use the canonical run process directories")
    result_paths = sorted(results_root.glob("*.json"))
    if not result_paths:
        raise ValueError("resource summary requires at least one gate result")
    policy = Policy()
    peak = 0
    heartbeat_count = 0
    telemetry_files: list[str] = []
    result_files: list[str] = []
    for result_path in result_paths:
        if result_path.is_symlink() or not result_path.is_file():
            raise ValueError(f"gate result is missing or unsafe: {result_path}")
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"gate result is unreadable: {result_path}") from exc
        cleanup = result.get("cleanup") if isinstance(result, dict) else None
        valid = (
            result.get("schema") == RESULT_SCHEMA
            and result.get("accepted") is True
            and result.get("classification") in ACCEPTED_CLASSIFICATIONS
            and result.get("monitor_ready_before_release") is True
            and result.get("telemetry_continuous") is True
            and result.get("actual_sha_before") == result.get("expected_sha")
            and result.get("actual_sha_after") == result.get("expected_sha")
            and isinstance(cleanup, dict)
            and cleanup.get("survivors") == []
            and result.get("observed_ge_16") is False
        )
        if not valid:
            raise ValueError(f"gate result is not accepted fail-closed evidence: {result_path}")
        telemetry_path = telemetry_root / f"{result_path.stem}.jsonl"
        journal = _validate_telemetry_journal(telemetry_path, absolute_limit_bytes=policy.absolute_limit_bytes)
        peak = max(peak, journal["peak_system_rss_bytes"])
        heartbeat_count += journal["heartbeat_count"]
        result_files.append(result_path.relative_to(run_root).as_posix())
        telemetry_files.append(telemetry_path.relative_to(run_root).as_posix())
    summary = {
        "schema": "ketos.stage09.resource-summary.v1",
        "metric": "psutil.virtual_memory.total-minus-available",
        "idle_limit_bytes": policy.idle_limit_bytes,
        "soft_limit_bytes": policy.soft_limit_bytes,
        "predictive_limit_bytes": policy.predictive_limit_bytes,
        "hard_limit_bytes": policy.hard_limit_bytes,
        "absolute_limit_bytes": policy.absolute_limit_bytes,
        "telemetry_continuous": True,
        "observed_ge_16": False,
        "peak_system_rss_bytes": peak,
        "monitor_losses": 0,
        "ram_guard_trips": 0,
        "gate_count": len(result_paths),
        "heartbeat_count": heartbeat_count,
        "result_files": result_files,
        "telemetry_files": telemetry_files,
        "summary": "process/resource-summary.json",
    }
    _write_json_exclusive(output, summary)
    return summary


def run_gate(
    *,
    cwd: Path,
    expected_sha: str,
    command: Sequence[str],
    result_path: Path,
    telemetry_path: Path,
    log_path: Path,
    policy: Policy | None = None,
    timeout_seconds: float | None = None,
    allow_deselected_only: bool = False,
    nonzero_classification: str = "TEST_FAILURE",
    lock_path: Path | None = None,
    _test_preflight_rss_bytes: int | None = None,
    _test_monitor_rss_bytes: Sequence[int] = (),
    _test_monitor_exit_after_ready: bool = False,
) -> dict[str, Any]:
    """Run one command after monitor READY and seal a fail-closed result."""
    started = time.monotonic()
    started_at = _utc_now()
    policy = policy or Policy()
    cwd = cwd.expanduser().resolve(strict=True)
    if not cwd.is_dir() or not command or (timeout_seconds is not None and timeout_seconds <= 0):
        raise ValueError("cwd, command, and timeout must define a valid gate")
    if re.fullmatch(r"[0-9a-f]{40}", expected_sha) is None:
        raise ValueError("expected SHA must be a lowercase 40-character Git object ID")
    if nonzero_classification not in {"TEST_FAILURE", "SERVICE_FAILURE"}:
        raise ValueError("nonzero classification must be TEST_FAILURE or SERVICE_FAILURE")
    result_path = _validate_output_path(result_path)
    telemetry_path = _validate_output_path(telemetry_path)
    log_path = _validate_output_path(log_path)
    result = _base_result(cwd=cwd, expected_sha=expected_sha, command=command, policy=policy, started_at=started_at)
    log_descriptor = os.open(log_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)

    target: subprocess.Popen[bytes] | None = None
    monitor: subprocess.Popen[bytes] | None = None
    start_read = start_write = control_read = control_write = heartbeat_read = heartbeat_write = -1
    previous_handlers: dict[int, Any] = {}
    interrupted: list[int] = []
    try:
        actual_sha, status = _git_state(cwd)
        result["actual_sha_before"] = actual_sha
        preflight_rss = _test_preflight_rss_bytes if _test_preflight_rss_bytes is not None else _system_rss_bytes()
        if actual_sha != expected_sha or status:
            result["classification"] = "STALE_SHA"
            result["stop_reason"] = "sha_or_worktree_mismatch"
            _write_json_exclusive(
                telemetry_path,
                _telemetry_record("PREFLIGHT_REJECTED", reason=result["stop_reason"], system_rss_bytes=preflight_rss),
            )
            return _finish_result(result, started=started, result_path=result_path)
        if preflight_rss >= policy.idle_limit_bytes:
            result["stop_reason"] = "idle_admission_denied"
            result["peak_system_rss_bytes"] = preflight_rss
            result["observed_ge_16"] = preflight_rss >= policy.absolute_limit_bytes
            _write_json_exclusive(
                telemetry_path,
                _telemetry_record("PREFLIGHT_REJECTED", reason=result["stop_reason"], system_rss_bytes=preflight_rss),
            )
            return _finish_result(result, started=started, result_path=result_path)

        with _serial_gate_lock(lock_path) as lock_identity:
            result["lock"] = lock_identity
            start_read, start_write = os.pipe()
            control_read, control_write = os.pipe()
            heartbeat_read, heartbeat_write = os.pipe()
            os.set_blocking(heartbeat_read, False)
            script = str(Path(__file__).resolve())
            with os.fdopen(log_descriptor, "wb", closefd=False) as log_stream:
                target = subprocess.Popen(
                    [sys.executable, script, "_exec_wait", "--start-fd", str(start_read), "--", *command],
                    cwd=cwd,
                    stdout=log_stream,
                    stderr=subprocess.STDOUT,
                    pass_fds=(start_read,),
                    start_new_session=True,
                )
                result["target_pid"] = target.pid
                result["target_pgid"] = os.getpgid(target.pid)
                if result["target_pgid"] != target.pid:
                    result["stop_reason"] = "target_pgid_mismatch"
                    result["cleanup"] = _terminate_target(target)
                    return _finish_result(result, started=started, result_path=result_path)
                monitor_argv = [
                    sys.executable,
                    script,
                    "_monitor",
                    "--heartbeat-fd",
                    str(heartbeat_write),
                    "--control-fd",
                    str(control_read),
                    "--supervisor-pid",
                    str(os.getpid()),
                    "--target-pgid",
                    str(target.pid),
                    "--telemetry",
                    str(telemetry_path),
                    "--policy-json",
                    json.dumps(asdict(policy), separators=(",", ":")),
                ]
                if _test_monitor_rss_bytes:
                    monitor_argv.extend(
                        ["--test-rss-json", json.dumps(list(_test_monitor_rss_bytes), separators=(",", ":"))]
                    )
                if _test_monitor_exit_after_ready:
                    monitor_argv.append("--test-exit-after-ready")
                monitor = subprocess.Popen(
                    monitor_argv,
                    cwd=cwd,
                    pass_fds=(heartbeat_write, control_read),
                    start_new_session=True,
                )
                result["monitor_pid"] = monitor.pid
                os.close(start_read)
                start_read = -1
                os.close(control_read)
                control_read = -1
                os.close(heartbeat_write)
                heartbeat_write = -1

                protocol_buffer = b""
                ready_deadline = time.monotonic() + MONITOR_READY_TIMEOUT_SECONDS
                last_heartbeat = time.monotonic()
                expected_sequence = 1
                ready = False
                ready_rss: int | None = None
                monitor_lost = False

                while not ready and time.monotonic() < ready_deadline:
                    if monitor.poll() is not None:
                        monitor_lost = True
                        break
                    if select.select([heartbeat_read], [], [], 0.05)[0]:
                        messages, protocol_buffer, eof = _receive_messages(heartbeat_read, protocol_buffer)
                        if eof:
                            monitor_lost = True
                            break
                        for message in messages:
                            if message.get("event") == "HEARTBEAT":
                                sequence = int(message["sequence"])
                                if sequence != expected_sequence:
                                    monitor_lost = True
                                    break
                                expected_sequence += 1
                                result["heartbeat_count"] += 1
                                result["last_heartbeat_sequence"] = sequence
                                rss = int(message["system_rss_bytes"])
                                result["peak_system_rss_bytes"] = max(result["peak_system_rss_bytes"], rss)
                                result["observed_ge_16"] |= rss >= policy.absolute_limit_bytes
                                last_heartbeat = time.monotonic()
                            elif message.get("event") == "READY":
                                ready = True
                                ready_rss = int(message["system_rss_bytes"])
                    if monitor_lost:
                        break
                if monitor_lost or not ready:
                    result["classification"] = "MONITOR_LOST"
                    result["stop_reason"] = "monitor_not_ready"
                    result["cleanup"] = _terminate_target(target)
                    return _finish_result(result, started=started, result_path=result_path)
                if ready_rss is None or ready_rss >= policy.idle_limit_bytes:
                    result["stop_reason"] = "monitor_idle_admission_denied"
                    result["peak_system_rss_bytes"] = max(result["peak_system_rss_bytes"], ready_rss or 0)
                    result["observed_ge_16"] |= bool(ready_rss is not None and ready_rss >= policy.absolute_limit_bytes)
                    result["cleanup"] = _terminate_target(target)
                    return _finish_result(result, started=started, result_path=result_path)
                result["monitor_ready_before_release"] = True
                os.write(start_write, b"1")
                os.close(start_write)
                start_write = -1

                def on_signal(received: int, _frame: Any) -> None:
                    interrupted.append(received)

                for handled_signal in (signal.SIGINT, signal.SIGTERM):
                    previous_handlers[handled_signal] = signal.signal(handled_signal, on_signal)

                classification: str | None = None
                stop_reason: str | None = None
                while target.poll() is None:
                    now = time.monotonic()
                    if interrupted:
                        classification = "USER_INTERRUPTED"
                        stop_reason = signal.Signals(interrupted[0]).name
                    elif timeout_seconds is not None and now - started >= timeout_seconds:
                        classification = "TIMEOUT"
                        stop_reason = "timeout"
                    elif monitor.poll() is not None or now - last_heartbeat > policy.heartbeat_timeout_seconds:
                        classification = "MONITOR_LOST"
                        stop_reason = "heartbeat_lost"
                    if classification is not None:
                        result["cleanup"] = _terminate_target(target)
                        break
                    if select.select([heartbeat_read], [], [], 0.05)[0]:
                        try:
                            messages, protocol_buffer, eof = _receive_messages(heartbeat_read, protocol_buffer)
                        except RuntimeError:
                            classification = "MONITOR_LOST"
                            stop_reason = "invalid_monitor_protocol"
                            result["cleanup"] = _terminate_target(target)
                            break
                        if eof:
                            classification = "MONITOR_LOST"
                            stop_reason = "monitor_eof"
                            result["cleanup"] = _terminate_target(target)
                            break
                        for message in messages:
                            event = message.get("event")
                            if event == "HEARTBEAT":
                                sequence = int(message["sequence"])
                                if sequence != expected_sequence:
                                    classification = "MONITOR_LOST"
                                    stop_reason = "heartbeat_sequence_gap"
                                    break
                                expected_sequence += 1
                                result["heartbeat_count"] += 1
                                result["last_heartbeat_sequence"] = sequence
                                rss = int(message["system_rss_bytes"])
                                result["peak_system_rss_bytes"] = max(result["peak_system_rss_bytes"], rss)
                                result["observed_ge_16"] |= rss >= policy.absolute_limit_bytes
                                last_heartbeat = time.monotonic()
                            elif event == "RAM_GUARD_TRIP":
                                classification = "RAM_GUARD_TRIP"
                                stop_reason = "hard_limit"
                                rss = int(message["system_rss_bytes"])
                                result["peak_system_rss_bytes"] = max(result["peak_system_rss_bytes"], rss)
                                result["observed_ge_16"] |= bool(message.get("observed_ge_16"))
                        if classification is not None:
                            result["cleanup"] = _terminate_target(target)
                            break

                exit_code = target.wait()
                result["exit_code"] = exit_code
                if exit_code < 0:
                    result["signal"] = signal.Signals(-exit_code).name
                if classification is None:
                    if exit_code == 0:
                        classification = "PASS"
                    elif (
                        exit_code == PYTEST_NO_TESTS_COLLECTED and allow_deselected_only and _deselected_only(log_path)
                    ):
                        classification = "DESELECTED_ONLY"
                    else:
                        classification = nonzero_classification
                    stop_reason = "natural_exit"
                result["classification"] = classification
                result["stop_reason"] = stop_reason

                with contextlib.suppress(OSError):
                    os.write(control_write, b"STOP\n")
                try:
                    monitor_exit = monitor.wait(timeout=policy.heartbeat_timeout_seconds)
                except subprocess.TimeoutExpired:
                    monitor.terminate()
                    monitor_exit = monitor.wait(timeout=2)
                if monitor_exit != 0 and classification not in {"MONITOR_LOST", "RAM_GUARD_TRIP"}:
                    result["classification"] = "MONITOR_LOST"
                    result["stop_reason"] = "monitor_unclean_exit"
                elif monitor_exit == 0 and classification != "RAM_GUARD_TRIP":
                    try:
                        journal = _validate_telemetry_journal(
                            telemetry_path,
                            absolute_limit_bytes=policy.absolute_limit_bytes,
                        )
                    except ValueError:
                        result["classification"] = "MONITOR_LOST"
                        result["stop_reason"] = "telemetry_not_continuous"
                    else:
                        result["telemetry_continuous"] = True
                        result["heartbeat_count"] = journal["heartbeat_count"]
                        result["last_heartbeat_sequence"] = journal["heartbeat_count"]
                        result["peak_system_rss_bytes"] = max(
                            result["peak_system_rss_bytes"],
                            journal["peak_system_rss_bytes"],
                        )
                if result["cleanup"]["attempted"] is False:
                    result["cleanup"] = _terminate_target(target)
                actual_sha_after, status_after = _git_state(cwd)
                result["actual_sha_after"] = actual_sha_after
                if actual_sha_after != expected_sha or status_after:
                    result["classification"] = "STALE_SHA"
                    result["stop_reason"] = "post_gate_sha_or_worktree_mismatch"
                return _finish_result(result, started=started, result_path=result_path)
    finally:
        for handled_signal, previous in previous_handlers.items():
            signal.signal(handled_signal, previous)
        if target is not None and target.poll() is None:
            result["cleanup"] = _terminate_target(target)
            target.wait()
        if monitor is not None and monitor.poll() is None:
            with contextlib.suppress(OSError):
                if control_write >= 0:
                    os.write(control_write, b"STOP\n")
            with contextlib.suppress(subprocess.TimeoutExpired):
                monitor.wait(timeout=2)
            if monitor.poll() is None:
                monitor.kill()
                monitor.wait()
        for descriptor in (
            start_read,
            start_write,
            control_read,
            control_write,
            heartbeat_read,
            heartbeat_write,
            log_descriptor,
        ):
            if descriptor >= 0:
                with contextlib.suppress(OSError):
                    os.close(descriptor)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    run = actions.add_parser("run")
    run.add_argument("--cwd", type=Path, required=True)
    run.add_argument("--expected-sha", required=True)
    run.add_argument("--result", type=Path, required=True)
    run.add_argument("--telemetry", type=Path, required=True)
    run.add_argument("--log", type=Path, required=True)
    run.add_argument("--lock-path", type=Path)
    run.add_argument("--timeout-seconds", type=float)
    run.add_argument("--allow-deselected-only", action="store_true")
    run.add_argument(
        "--nonzero-classification",
        choices=("TEST_FAILURE", "SERVICE_FAILURE"),
        default="TEST_FAILURE",
    )
    run.add_argument("command", nargs=argparse.REMAINDER)
    summarize = actions.add_parser("summarize")
    summarize.add_argument("--results-dir", type=Path, required=True)
    summarize.add_argument("--telemetry-dir", type=Path, required=True)
    summarize.add_argument("--output", type=Path, required=True)
    monitor = actions.add_parser("_monitor")
    monitor.add_argument("--heartbeat-fd", type=int, required=True)
    monitor.add_argument("--control-fd", type=int, required=True)
    monitor.add_argument("--supervisor-pid", type=int, required=True)
    monitor.add_argument("--target-pgid", type=int, required=True)
    monitor.add_argument("--telemetry", type=Path, required=True)
    monitor.add_argument("--policy-json", required=True)
    monitor.add_argument("--test-rss-json")
    monitor.add_argument("--test-exit-after-ready", action="store_true")
    wrapper = actions.add_parser("_exec_wait")
    wrapper.add_argument("--start-fd", type=int, required=True)
    wrapper.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.action == "_monitor":
        return _monitor_main(args)
    if args.action == "_exec_wait":
        command = list(args.command)
        if command and command[0] == "--":
            command = command[1:]
        if not command:
            return 125
        args.command = command
        return _exec_wait_main(args)
    if args.action == "summarize":
        summary = summarize_results(
            results_dir=args.results_dir,
            telemetry_dir=args.telemetry_dir,
            output=args.output,
        )
        print(json.dumps(summary, sort_keys=True))
        return 0
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        _parser().error("run requires command argv after --")
    result = run_gate(
        cwd=args.cwd,
        expected_sha=args.expected_sha,
        command=command,
        result_path=args.result,
        telemetry_path=args.telemetry,
        log_path=args.log,
        timeout_seconds=args.timeout_seconds,
        allow_deselected_only=args.allow_deselected_only,
        nonzero_classification=args.nonzero_classification,
        lock_path=args.lock_path,
    )
    print(json.dumps(result, sort_keys=True))
    return 0 if result["accepted"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
