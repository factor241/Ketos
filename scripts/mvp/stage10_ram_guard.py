#!/usr/bin/env python3
# ruff: noqa: ARG001, BLE001, EM101, EM102, FBT001, PLR2004, S603, S607, TRY003
"""Fail-closed Stage 10 RAM guard for one attributed command process group."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import queue
import re
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psutil


@dataclass(frozen=True)
class Policy:
    resume_limit_bytes: int = 13_000_000_000
    warning_limit_bytes: int = 13_500_000_000
    stop_limit_bytes: int = 14_750_000_000
    emergency_limit_bytes: int = 15_250_000_000
    absolute_limit_bytes: int = 16_000_000_000
    warning_samples: int = 3
    stop_samples: int = 2
    missed_samples: int = 2
    sample_interval_seconds: float = 1.0
    recovery_seconds: int = 30
    admission_timeout_seconds: int = 120
    tail_seconds: int = 30
    term_grace_seconds: int = 15


@dataclass
class GuardState:
    warning_consecutive: int = 0
    stop_consecutive: int = 0
    missed_consecutive: int = 0
    warning_emitted: bool = False
    stop_emitted: bool = False
    emergency_emitted: bool = False
    absolute_emitted: bool = False


def observe(state: GuardState, system_used_bytes: int, critical: bool, policy: Policy) -> list[str]:
    if system_used_bytes >= policy.absolute_limit_bytes and not state.absolute_emitted:
        state.absolute_emitted = True
        return ["ABSOLUTE_LIMIT"]
    if (system_used_bytes >= policy.emergency_limit_bytes or critical) and not state.emergency_emitted:
        state.emergency_emitted = True
        return ["EMERGENCY_STOP"]
    if system_used_bytes >= policy.stop_limit_bytes:
        state.stop_consecutive += 1
    else:
        state.stop_consecutive = 0
    if state.stop_consecutive >= policy.stop_samples and not state.stop_emitted:
        state.stop_emitted = True
        return ["STOP"]
    if system_used_bytes >= policy.warning_limit_bytes:
        state.warning_consecutive += 1
    else:
        state.warning_consecutive = 0
    if state.warning_consecutive >= policy.warning_samples and not state.warning_emitted:
        state.warning_emitted = True
        return ["WARNING"]
    return []


def observe_loss(state: GuardState, policy: Policy) -> list[str]:
    state.missed_consecutive += 1
    if state.missed_consecutive >= policy.missed_samples:
        return ["MONITOR_LOST"]
    return []


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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


def _write_json_atomic_exclusive(path: Path, payload: object) -> None:
    """Publish one complete JSON file atomically without replacing a peer."""
    if not path.is_absolute():
        raise ValueError(f"evidence path must be absolute: {path}")
    parent = path.parent.resolve(strict=True)
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"refusing to overwrite evidence: {path}")
    temporary = parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    linked = False
    try:
        _write_json_exclusive(temporary, payload)
        os.link(temporary, path, follow_symlinks=False)
        linked = True
        parent_descriptor = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(parent_descriptor)
        except OSError:
            path.unlink()
            linked = False
            os.fsync(parent_descriptor)
            raise
        finally:
            os.close(parent_descriptor)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()
        parent_descriptor = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
        if linked and not path.exists():
            raise RuntimeError("atomic result publication disappeared")


def _open_exclusive(path: Path) -> int:
    if not path.is_absolute():
        raise ValueError(f"evidence path must be absolute: {path}")
    parent = path.parent.resolve(strict=True)
    if path.exists() or path.is_symlink():
        raise FileExistsError(f"refusing to overwrite evidence: {path}")
    return os.open(parent / path.name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)


def _system_used() -> int:
    value = psutil.virtual_memory()
    return int(value.total - value.available)


def _aggregate_rss() -> tuple[int, int, int]:
    total = 0
    counted = 0
    unreadable = 0
    for process in psutil.process_iter(["memory_info"]):
        try:
            memory_info = process.info["memory_info"]
            if memory_info is None:
                unreadable += 1
                continue
            total += int(memory_info.rss)
            counted += 1
        except (AttributeError, psutil.Error, OSError):
            unreadable += 1
    return total, counted, unreadable


def _pageouts() -> int:
    try:
        output = subprocess.run(
            ["/usr/bin/vm_stat"],
            check=True,
            capture_output=True,
            text=True,
            timeout=0.4,
        ).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise RuntimeError("vm_stat pageout probe failed") from None
    match = re.search(r"^Pageouts:\s+([0-9.]+)\.", output, flags=re.MULTILINE)
    if not match:
        raise RuntimeError("vm_stat pageout probe was unparseable")
    return int(match.group(1))


def _critical_pressure() -> bool:
    try:
        result = subprocess.run(
            ["/usr/bin/memory_pressure", "-Q"],
            check=True,
            capture_output=True,
            text=True,
            timeout=0.4,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise RuntimeError("memory pressure probe failed") from None
    lowered = (result.stdout + result.stderr).lower()
    if "critical" in lowered:
        return True
    match = re.search(r"system-wide memory free percentage:\s*(\d+)", lowered)
    if not match:
        raise RuntimeError("memory pressure probe was unparseable")
    return int(match.group(1)) <= 5


def sample(sequence: int, gate_id: str, phase: str) -> dict[str, Any]:
    swap = psutil.swap_memory()
    aggregate_rss, counted, unreadable = _aggregate_rss()
    return {
        "schema": "ketos.stage10.memory-sample.v1",
        "at": _now(),
        "monotonic_ns": time.monotonic_ns(),
        "sequence": sequence,
        "gate_id": gate_id,
        "phase": phase,
        "system_used_bytes": _system_used(),
        "aggregate_rss_bytes": aggregate_rss,
        "rss_processes_counted": counted,
        "rss_processes_unreadable": unreadable,
        "aggregate_rss_is_exact": False,
        "pageouts": _pageouts(),
        "swapouts": int(swap.sout),
        "critical_memory_pressure": _critical_pressure(),
        "monitor_loss": False,
    }


def sample_with_deadline(
    sequence: int,
    gate_id: str,
    phase: str,
    *,
    timeout_seconds: float = 0.9,
) -> dict[str, Any]:
    results: queue.Queue[tuple[bool, Any]] = queue.Queue(maxsize=1)

    def worker() -> None:
        try:
            results.put_nowait((True, sample(sequence, gate_id, phase)))
        except Exception as exc:
            results.put_nowait((False, exc))

    threading.Thread(target=worker, name=f"s10-memory-sample-{sequence}", daemon=True).start()
    try:
        ok, value = results.get(timeout=timeout_seconds)
    except queue.Empty as exc:
        raise TimeoutError("memory sample heartbeat timed out") from exc
    if not ok:
        raise RuntimeError("memory sample probe failed") from value
    return value


def _identity(pid: int) -> dict[str, Any]:
    process = psutil.Process(pid)
    command = "\0".join(process.cmdline()).encode()
    return {
        "pid": pid,
        "ppid": process.ppid(),
        "pgid": os.getpgid(pid),
        "start_time": process.create_time(),
        "owner_uid": process.uids().real,
        "command_sha256": hashlib.sha256(command).hexdigest(),
    }


def _identity_matches(expected: dict[str, Any]) -> bool:
    try:
        actual = _identity(int(expected["pid"]))
    except (psutil.Error, OSError):
        return False
    return all(actual[key] == expected[key] for key in ("pid", "pgid", "start_time", "owner_uid", "command_sha256"))


def _members(pgid: int) -> list[int]:
    result: list[int] = []
    for process in psutil.process_iter(["pid"]):
        with contextlib.suppress(psutil.Error, OSError):
            if os.getpgid(process.pid) == pgid and process.status() != psutil.STATUS_ZOMBIE:
                result.append(process.pid)
    return sorted(result)


def _member_identities(pgid: int) -> dict[int, dict[str, Any]]:
    identities: dict[int, dict[str, Any]] = {}
    for pid in _members(pgid):
        with contextlib.suppress(psutil.Error, OSError):
            identities[pid] = _identity(pid)
    return identities


def _terminate_spawn_handle(target: subprocess.Popen[bytes], policy: Policy) -> dict[str, Any]:
    """Fail closed via the unreaped direct-child handle when psutil identity capture fails."""
    outcome: dict[str, Any] = {
        "reason": "identity-capture-failed",
        "identity_verified": False,
        "spawn_handle_verified": True,
        "term_sent": False,
        "kill_sent": False,
        "survivors": [],
        "refused_kills": [],
    }
    if target.poll() is not None:
        return outcome
    pid = target.pid
    try:
        pgid = os.getpgid(pid)
    except OSError:
        pgid = pid
    if pgid != pid:
        outcome["spawn_handle_verified"] = False
        outcome["refused_kills"].append({"pid": pid, "reason": "unexpected-pgid"})
        outcome["survivors"] = [pid] if target.poll() is None else []
        return outcome
    os.killpg(pgid, signal.SIGTERM)
    outcome["term_sent"] = True
    deadline = time.monotonic() + policy.term_grace_seconds
    while _members(pgid) and time.monotonic() < deadline:
        time.sleep(0.05)
    if _members(pgid):
        os.killpg(pgid, signal.SIGKILL)
        outcome["kill_sent"] = True
        deadline = time.monotonic() + 2
        while _members(pgid) and time.monotonic() < deadline:
            time.sleep(0.05)
    with contextlib.suppress(subprocess.TimeoutExpired):
        target.wait(timeout=2)
    outcome["survivors"] = _members(pgid)
    return outcome


def _capture_spawn_identity(
    target: subprocess.Popen[bytes],
    policy: Policy,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    deadline = time.monotonic() + min(1.0, max(0.1, policy.sample_interval_seconds))
    while True:
        if target.poll() is not None:
            return None, None
        try:
            return _identity(target.pid), None
        except (psutil.Error, OSError):
            if time.monotonic() >= deadline:
                return None, _terminate_spawn_handle(target, policy)
            time.sleep(0.01)


def terminate_attributed(
    target: subprocess.Popen[bytes], identity: dict[str, Any], reason: str, policy: Policy
) -> dict[str, Any]:
    outcome: dict[str, Any] = {
        "reason": reason,
        "identity_verified": False,
        "term_sent": False,
        "kill_sent": False,
        "survivors": [],
        "refused_kills": [],
    }
    if not _identity_matches(identity) or identity["pgid"] != identity["pid"]:
        outcome["identity_error"] = "pid/start-time/command/pgid mismatch"
        return outcome
    outcome["identity_verified"] = True
    pgid = int(identity["pgid"])
    attributed = _member_identities(pgid)
    if _members(pgid):
        if not _identity_matches(identity):
            outcome["identity_verified"] = False
            outcome["identity_error"] = "pid/start-time/command/pgid mismatch before TERM"
            return outcome
        os.killpg(pgid, signal.SIGTERM)
        outcome["term_sent"] = True
        deadline = time.monotonic() + policy.term_grace_seconds
        while _members(pgid) and time.monotonic() < deadline:
            time.sleep(0.05)
    for pid in _members(pgid):
        expected = attributed.get(pid)
        if expected is not None and _identity_matches(expected):
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)
                outcome["kill_sent"] = True
        else:
            outcome["refused_kills"].append({"pid": pid, "reason": "identity_changed_or_unattributed"})
    if outcome["kill_sent"]:
        deadline = time.monotonic() + 2
        while _members(pgid) and time.monotonic() < deadline:
            time.sleep(0.05)
    outcome["survivors"] = _members(pgid)
    return outcome


def _git_clean(cwd: Path, expected_sha: str) -> bool:
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return head == expected_sha and dirty == ""


def _record(stream: Any, payload: dict[str, Any]) -> None:
    stream.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
    stream.flush()
    os.fsync(stream.fileno())


def _recovery_admission(
    *, stream: Any, sequence: int, gate_id: str, policy: Policy
) -> tuple[bool, bool, int, list[dict[str, Any]]]:
    samples: list[dict[str, Any]] = []
    deadline = time.monotonic() + policy.admission_timeout_seconds
    stable_since: float | None = None
    initial_swapouts: int | None = None
    initial_pageouts: int | None = None
    missed = 0
    while time.monotonic() < deadline:
        sequence += 1
        try:
            current = sample_with_deadline(sequence, gate_id, "admission")
        except Exception:
            missed += 1
            event = {
                "schema": "ketos.stage10.memory-event.v1",
                "event": "SAMPLE_MISSED" if missed < policy.missed_samples else "MONITOR_LOST",
                "at": _now(),
                "sequence": sequence,
                "gate_id": gate_id,
            }
            _record(stream, event)
            if missed >= policy.missed_samples:
                return False, True, sequence, samples
            time.sleep(policy.sample_interval_seconds)
            continue
        missed = 0
        _record(stream, current)
        samples.append(current)
        if initial_swapouts is None:
            initial_swapouts = int(current["swapouts"])
            initial_pageouts = int(current["pageouts"])
        stable = (
            current["system_used_bytes"] < policy.resume_limit_bytes
            and current["swapouts"] == initial_swapouts
            and current["pageouts"] == initial_pageouts
        )
        if not stable:
            stable_since = None
            initial_swapouts = int(current["swapouts"])
            initial_pageouts = int(current["pageouts"])
        elif stable_since is None:
            stable_since = time.monotonic()
        elif time.monotonic() - stable_since >= policy.recovery_seconds:
            return True, False, sequence, samples
        time.sleep(policy.sample_interval_seconds)
    return False, False, sequence, samples


def run_guarded(
    *,
    cwd: Path,
    expected_sha: str,
    gate_id: str,
    command: list[str],
    result_path: Path,
    telemetry_path: Path,
    pid_ledger_path: Path,
    log_path: Path,
    policy: Policy | None = None,
    timeout_seconds: float = 3600,
) -> dict[str, Any]:
    policy = policy or Policy()
    if re.fullmatch(r"[0-9a-f]{40}", expected_sha) is None or not command or timeout_seconds <= 0:
        raise ValueError("expected SHA and command are required")
    cwd = cwd.resolve(strict=True)
    if not _git_clean(cwd, expected_sha):
        raise RuntimeError("source SHA/worktree preflight failed")
    started_at = _now()
    sequence = 0
    samples: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    cleanup: dict[str, Any] = {"term_sent": False, "kill_sent": False, "survivors": []}
    classification = "INFRA_FAILURE"
    exit_code: int | None = None
    identity: dict[str, Any] | None = None
    target: subprocess.Popen[bytes] | None = None
    state = GuardState()
    telemetry_fd = -1
    log_fd = -1
    tail_started_ns: int | None = None
    tail_finished_ns: int | None = None
    tail_complete = False
    terminal_error_type: str | None = None
    try:
        telemetry_fd = _open_exclusive(telemetry_path)
        log_fd = _open_exclusive(log_path)
        telemetry = os.fdopen(telemetry_fd, "w", encoding="utf-8")
        telemetry_fd = -1
        with telemetry:
            admitted, admission_monitor_lost, sequence, admission = _recovery_admission(
                stream=telemetry, sequence=sequence, gate_id=gate_id, policy=policy
            )
            samples.extend(admission)
            if not admitted:
                classification = "MONITOR_LOST" if admission_monitor_lost else "ADMISSION_BLOCKED"
                if admission_monitor_lost:
                    events.append({"event": "MONITOR_LOST"})
            else:
                target = subprocess.Popen(
                    command,
                    cwd=cwd,
                    stdin=subprocess.DEVNULL,
                    stdout=log_fd,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                os.close(log_fd)
                log_fd = -1
                identity, capture_cleanup = _capture_spawn_identity(target, policy)
                if capture_cleanup is not None:
                    classification = "IDENTITY_CAPTURE_FAILURE"
                    terminal_error_type = "IdentityCaptureError"
                    cleanup = capture_cleanup
                gate_started = time.monotonic()
                while identity is not None and target.poll() is None:
                    tick = time.monotonic()
                    if tick - gate_started >= timeout_seconds:
                        classification = "TIMEOUT"
                        cleanup = terminate_attributed(target, identity, classification, policy)
                        break
                    try:
                        sequence += 1
                        current = sample_with_deadline(sequence, gate_id, "gate")
                        state.missed_consecutive = 0
                        _record(telemetry, current)
                        samples.append(current)
                    except Exception:
                        for event in observe_loss(state, policy):
                            record = {
                                "schema": "ketos.stage10.memory-event.v1",
                                "event": event,
                                "at": _now(),
                                "sequence": sequence,
                                "gate_id": gate_id,
                            }
                            _record(telemetry, record)
                            events.append(record)
                        if state.missed_consecutive >= policy.missed_samples:
                            classification = "MONITOR_LOST"
                            cleanup = terminate_attributed(target, identity, classification, policy)
                            break
                    else:
                        decisions = observe(
                            state,
                            int(current["system_used_bytes"]),
                            bool(current["critical_memory_pressure"]),
                            policy,
                        )
                        for event in decisions:
                            record = {
                                "schema": "ketos.stage10.memory-event.v1",
                                "event": event,
                                "at": _now(),
                                "sequence": sequence,
                                "gate_id": gate_id,
                            }
                            _record(telemetry, record)
                            events.append(record)
                        stop = next(
                            (event for event in decisions if event in {"STOP", "EMERGENCY_STOP", "ABSOLUTE_LIMIT"}),
                            None,
                        )
                        if stop:
                            classification = stop
                            cleanup = terminate_attributed(target, identity, stop, policy)
                            break
                    delay = policy.sample_interval_seconds - (time.monotonic() - tick)
                    if delay > 0:
                        time.sleep(delay)
                if target.poll() is None:
                    try:
                        exit_code = target.wait(timeout=policy.term_grace_seconds + 2)
                    except subprocess.TimeoutExpired:
                        exit_code = target.poll()
                else:
                    exit_code = target.wait()
                if classification == "INFRA_FAILURE":
                    if exit_code == 0:
                        classification = "PASS"
                    elif exit_code is not None and exit_code < 0:
                        classification = "SIGNAL"
                    else:
                        classification = "TEST_FAILURE"
                gate_finished = {
                    "schema": "ketos.stage10.memory-boundary.v1",
                    "at": _now(),
                    "monotonic_ns": time.monotonic_ns(),
                    "gate_id": gate_id,
                    "boundary": "gate_finished",
                }
                _record(telemetry, gate_finished)
                tail_started_ns = time.monotonic_ns()
                tail_deadline = time.monotonic() + policy.tail_seconds
                next_tail_tick = time.monotonic()
                while time.monotonic() < tail_deadline:
                    next_tail_tick += policy.sample_interval_seconds
                    time.sleep(max(0.0, next_tail_tick - time.monotonic()))
                    sequence += 1
                    try:
                        current = sample_with_deadline(sequence, gate_id, "tail")
                    except Exception:
                        decisions = observe_loss(state, policy)
                    else:
                        state.missed_consecutive = 0
                        _record(telemetry, current)
                        samples.append(current)
                        decisions = observe(
                            state,
                            int(current["system_used_bytes"]),
                            bool(current["critical_memory_pressure"]),
                            policy,
                        )
                    for event in decisions:
                        record = {
                            "schema": "ketos.stage10.memory-event.v1",
                            "event": event,
                            "at": _now(),
                            "sequence": sequence,
                            "gate_id": gate_id,
                        }
                        _record(telemetry, record)
                        events.append(record)
                    blocking = [
                        event
                        for event in decisions
                        if event in {"STOP", "EMERGENCY_STOP", "ABSOLUTE_LIMIT", "MONITOR_LOST"}
                    ]
                    if blocking and classification != "ABSOLUTE_LIMIT":
                        classification = blocking[-1]
                tail_finished_ns = time.monotonic_ns()
                tail_complete = (
                    tail_finished_ns - tail_started_ns >= int(policy.tail_seconds * 1_000_000_000)
                    and state.missed_consecutive < policy.missed_samples
                )
    except BaseException as exc:
        terminal_error_type = type(exc).__name__
        classification = "SIGNAL" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "INFRA_FAILURE"
    finally:
        if target is not None and target.poll() is None and identity is not None:
            cleanup = terminate_attributed(target, identity, "supervisor-finally", policy)
            if cleanup.get("survivors") == []:
                with contextlib.suppress(subprocess.TimeoutExpired):
                    exit_code = target.wait(timeout=2)
        if telemetry_fd >= 0:
            os.close(telemetry_fd)
        if log_fd >= 0:
            os.close(log_fd)

    peak_system = max((int(row["system_used_bytes"]) for row in samples), default=0)
    peak_aggregate = max((int(row["aggregate_rss_bytes"]) for row in samples), default=0)
    first_sample = samples[0] if samples else {}
    last_sample = samples[-1] if samples else {}
    last_sample_monotonic_ns = int(last_sample.get("monotonic_ns", time.monotonic_ns()))
    last_sample_sequence = int(last_sample.get("sequence", 0))
    child_outcomes = {
        "target": {
            "started": target is not None,
            "pid": None if target is None else target.pid,
            "returncode": exit_code,
            "terminated_by_signal": exit_code is not None and exit_code < 0,
        },
        "monitor": {
            "mode": "in-process-deadline-sampler",
            "tail_complete": tail_complete,
            "terminal_error_type": terminal_error_type,
        },
    }
    result = {
        "schema": "ketos.stage10.ram-gate-result.v1",
        "s10_code_sha": expected_sha,
        "gate_id": gate_id,
        "command": command,
        "cwd": str(cwd),
        "started_at": started_at,
        "ended_at": _now(),
        "exit_code": exit_code,
        "classification": classification,
        "verdict": (
            "PASS"
            if classification == "PASS"
            and peak_system < policy.absolute_limit_bytes
            and tail_complete
            and state.missed_consecutive < policy.missed_samples
            and cleanup.get("survivors") == []
            and cleanup.get("refused_kills", []) == []
            else "FAIL"
        ),
        "policy": asdict(policy),
        "timeout_seconds": timeout_seconds,
        "sample_count": len(samples),
        "peak_system_used_bytes": peak_system,
        "peak_aggregate_rss_bytes": peak_aggregate,
        "last_sample_sequence": last_sample_sequence,
        "last_heartbeat_age_seconds": max(
            0.0,
            (time.monotonic_ns() - last_sample_monotonic_ns) / 1_000_000_000,
        ),
        "pageout_delta": int(last_sample.get("pageouts", 0)) - int(first_sample.get("pageouts", 0)),
        "swapout_delta": int(last_sample.get("swapouts", 0)) - int(first_sample.get("swapouts", 0)),
        "tail_seconds_required": policy.tail_seconds,
        "tail_started_monotonic_ns": tail_started_ns,
        "tail_finished_monotonic_ns": tail_finished_ns,
        "tail_complete": tail_complete,
        "warning_trips": sum(row.get("event") == "WARNING" for row in events),
        "stop_trips": sum(row.get("event") == "STOP" for row in events),
        "emergency_trips": sum(row.get("event") == "EMERGENCY_STOP" for row in events),
        "observed_ge_16": peak_system >= policy.absolute_limit_bytes,
        "monitor_losses": sum(row.get("event") == "MONITOR_LOST" for row in events),
        "terminal_error_type": terminal_error_type,
        "child_outcomes": child_outcomes,
        "cleanup": cleanup,
        "terminal_result_atomic": True,
    }
    if not _git_clean(cwd, expected_sha):
        result["verdict"] = "FAIL"
        result["classification"] = "STALE_SHA"
    _write_json_atomic_exclusive(result_path, result)
    _write_json_atomic_exclusive(
        pid_ledger_path,
        {
            "schema": "ketos.stage10.pid-ledger.v1",
            "s10_code_sha": expected_sha,
            "gate_id": gate_id,
            "records": [] if identity is None else [{**identity, "cleanup": cleanup}],
        },
    )
    return result


def baseline(output: Path) -> dict[str, Any]:
    current = sample(1, "baseline", "baseline")
    processes: list[dict[str, Any]] = []
    for process in psutil.process_iter(["pid", "ppid", "name", "create_time", "memory_info"]):
        with contextlib.suppress(psutil.Error, OSError):
            processes.append(
                {
                    "pid": process.pid,
                    "ppid": process.ppid(),
                    "name": process.name(),
                    "start_time": process.create_time(),
                    "rss_bytes": process.memory_info().rss,
                }
            )
    payload = {
        "schema": "ketos.stage10.memory-baseline.v1",
        "captured_at": _now(),
        **{key: value for key, value in current.items() if key.endswith("_bytes") or key in {"pageouts", "swapouts"}},
        "pid_ledger": sorted(processes, key=lambda row: int(row["rss_bytes"]), reverse=True),
    }
    _write_json_exclusive(output, payload)
    return payload


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    base = actions.add_parser("baseline")
    base.add_argument("--output", type=Path, required=True)
    run = actions.add_parser("run")
    run.add_argument("--cwd", type=Path, required=True)
    run.add_argument("--expected-sha", required=True)
    run.add_argument("--gate-id", required=True)
    run.add_argument("--result", type=Path, required=True)
    run.add_argument("--telemetry", type=Path, required=True)
    run.add_argument("--pid-ledger", type=Path, required=True)
    run.add_argument("--log", type=Path, required=True)
    run.add_argument("--timeout-seconds", type=float, default=3600)
    run.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    args = _parser().parse_args()
    if args.action == "baseline":
        payload = baseline(args.output)
        print(json.dumps({"system_used_bytes": payload["system_used_bytes"]}))
        return 0
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    result = run_guarded(
        cwd=args.cwd,
        expected_sha=args.expected_sha,
        gate_id=args.gate_id,
        command=command,
        result_path=args.result,
        telemetry_path=args.telemetry,
        pid_ledger_path=args.pid_ledger,
        log_path=args.log,
        timeout_seconds=args.timeout_seconds,
    )
    print(json.dumps({"gate_id": result["gate_id"], "verdict": result["verdict"]}))
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
