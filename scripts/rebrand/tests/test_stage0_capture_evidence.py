from __future__ import annotations

# ruff: noqa: S101, S603, SLF001 - assertions and private fixed helpers define the evidence contract.
import hashlib
import importlib.util
import json
import shutil
import signal
import stat
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import psutil
import pytest

ROOT = Path(__file__).resolve().parents[3]
CAPTURE = ROOT / "scripts/rebrand/capture_evidence.py"
MIB = 1024 * 1024
GIT_SHA_LENGTH = 40
READ_ONLY_DIRECTORY_MODE = 0o555
READ_ONLY_FILE_MODE = 0o444
SHA256_LENGTH = 64
EXPECTED_ATTEMPTS = 2


def load_capture():
    spec = importlib.util.spec_from_file_location("stage0_capture_evidence", CAPTURE)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def init_repo(path: Path) -> Path:
    git = shutil.which("git")
    assert git
    path.mkdir()
    subprocess.run([git, "init", "-q"], cwd=path, check=True)
    subprocess.run([git, "config", "user.name", "Stage Zero"], cwd=path, check=True)
    subprocess.run([git, "config", "user.email", "stage0@example.invalid"], cwd=path, check=True)
    (path / "README.md").write_text("evidence fixture\n", encoding="utf-8")
    subprocess.run([git, "add", "README.md"], cwd=path, check=True)
    subprocess.run([git, "commit", "-qm", "fixture"], cwd=path, check=True)
    return path


def execution(packet: Path) -> dict:
    return json.loads((packet / "execution.json").read_text(encoding="utf-8"))


def test_successful_capture_is_content_addressed_read_only_and_verifiable(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    evidence_root = tmp_path / "evidence"
    argv = [sys.executable, "-c", "import sys; print('out'); print('err', file=sys.stderr)"]

    packet = capture.capture_command(
        repo=repo,
        evidence_root=evidence_root,
        argv=argv,
        sample_interval_seconds=0.01,
    )

    record = execution(packet)
    assert packet.name.startswith("0001-")
    assert {path.name for path in packet.iterdir()} == {
        "execution.json",
        "files.sha256",
        "manifest.json",
        "resource.jsonl",
        "stderr.bin",
        "stdout.bin",
    }
    assert (packet / "stdout.bin").read_bytes() == b"out\n"
    assert (packet / "stderr.bin").read_bytes() == b"err\n"
    assert record["argv"] == argv
    assert record["cwd"] == str(repo.resolve())
    assert len(record["head_sha"]) == GIT_SHA_LENGTH
    assert record["duration_ms"] >= 0
    assert record["exit_code"] == 0
    assert record["timeout"] is False
    assert record["signal"] is None
    assert record["peak_process_tree_rss_bytes"] >= 0
    assert record["peak_system_used_bytes"] >= 0
    assert record["first_run"] is True
    assert record["first_run_manifest_sha256"] is None
    assert record["verdict"] == "PASS"
    assert record["stdout_sha256"] == hashlib.sha256(b"out\n").hexdigest()
    assert record["stderr_sha256"] == hashlib.sha256(b"err\n").hexdigest()
    assert record["effective_source_sha256"]
    assert record["source_dirty"] is False
    assert len(record["source_status_sha256"]) == SHA256_LENGTH
    assert len(record["source_diff_sha256"]) == SHA256_LENGTH
    assert capture.verify_packet(packet) == []
    assert stat.S_IMODE(packet.stat().st_mode) == READ_ONLY_DIRECTORY_MODE
    assert all(stat.S_IMODE(path.stat().st_mode) == READ_ONLY_FILE_MODE for path in packet.iterdir())


def test_verify_detects_packet_tampering(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", "print('original')"],
        sample_interval_seconds=0.01,
    )
    stdout = packet / "stdout.bin"
    stdout.chmod(0o644)
    stdout.write_bytes(b"forged\n")

    errors = capture.verify_packet(packet)

    assert any("stdout.bin" in error and "checksum" in error for error in errors)
    assert capture.main(["verify", str(packet)]) == 1


def test_repeated_attempt_is_append_only_and_links_first_run(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    evidence_root = tmp_path / "evidence"
    argv = [sys.executable, "-c", "print('same command')"]

    first = capture.capture_command(repo=repo, evidence_root=evidence_root, argv=argv)
    second = capture.capture_command(repo=repo, evidence_root=evidence_root, argv=argv)

    first_record = execution(first)
    second_record = execution(second)
    assert first.parent == second.parent
    assert first.name.startswith("0001-")
    assert second.name.startswith("0002-")
    assert first_record["first_run"] is True
    assert second_record["first_run"] is False
    assert second_record["first_run_manifest_sha256"] == first.name.split("-", 1)[1]
    assert capture.verify_packet(first) == []
    assert capture.verify_packet(second) == []


def test_timeout_escalates_and_kills_sigterm_resistant_descendant(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    child_code = (
        "import os,signal,sys,time; "
        "signal.signal(signal.SIGTERM,signal.SIG_IGN); "
        "print(os.getpid(), file=sys.stderr, flush=True); time.sleep(30)"
    )
    code = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child_code!r}]); time.sleep(30)"

    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", code],
        timeout_seconds=0.15,
        sample_interval_seconds=0.01,
    )

    record = execution(packet)
    child_pid = int((packet / "stderr.bin").read_text(encoding="utf-8").strip())
    deadline = time.monotonic() + 2
    while psutil.pid_exists(child_pid) and time.monotonic() < deadline:
        time.sleep(0.02)
    assert record["verdict"] == "FAIL"
    assert record["timeout"] is True
    assert record["termination_reason"] == "timeout"
    assert record["signal"] == signal.SIGKILL
    assert not psutil.pid_exists(child_pid)
    assert capture.verify_packet(packet) == []


def test_ram_limit_uses_injected_system_usage_and_records_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    monkeypatch.setattr(capture, "_system_used_bytes", lambda: 2 * MIB)

    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", "import time; time.sleep(30)"],
        ram_limit_bytes=MIB,
        sample_interval_seconds=0.01,
    )

    record = execution(packet)
    assert record["verdict"] == "FAIL"
    assert record["timeout"] is False
    assert record["termination_reason"] == "ram_limit"
    assert record["peak_system_used_bytes"] == 2 * MIB
    assert record["signal"] in {signal.SIGTERM, signal.SIGKILL}
    assert capture.verify_packet(packet) == []


def test_default_evidence_root_is_outside_repository(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")

    root = capture.default_evidence_root(repo)

    assert root.is_absolute()
    assert not root.is_relative_to(repo.resolve())
    assert root == repo.resolve().parent / ".ketos-rebrand-evidence" / repo.name / "s0"


def test_concurrent_capture_allocates_unique_attempts_and_one_first_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    evidence_root = tmp_path / "evidence"
    argv = [sys.executable, "-c", "print('concurrent')"]
    original = capture._existing_attempts

    def widened_race(command_root: Path) -> list[Path]:
        attempts = original(command_root)
        time.sleep(0.1)
        return attempts

    monkeypatch.setattr(capture, "_existing_attempts", widened_race)

    def run_capture() -> Path:
        return capture.capture_command(repo=repo, evidence_root=evidence_root, argv=argv)

    with ThreadPoolExecutor(max_workers=EXPECTED_ATTEMPTS) as pool:
        futures = [pool.submit(run_capture) for _ in range(EXPECTED_ATTEMPTS)]
        packets = [future.result(timeout=5) for future in futures]

    assert len(packets) == EXPECTED_ATTEMPTS
    assert sorted(packet.name.split("-", 1)[0] for packet in packets) == ["0001", "0002"]
    records = [execution(packet) for packet in packets]
    assert sorted(record["first_run"] for record in records) == [False, True]


def test_dirty_source_requires_explicit_effective_digest_and_binds_lineage(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    (repo / "README.md").write_text("dirty\n", encoding="utf-8")

    with pytest.raises(ValueError, match="dirty"):
        capture.capture_command(repo=repo, evidence_root=tmp_path / "rejected", argv=[sys.executable, "-c", "pass"])

    effective = "a" * SHA256_LENGTH
    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "accepted",
        argv=[sys.executable, "-c", "pass"],
        effective_source_sha256=effective,
    )
    record = execution(packet)
    assert record["effective_source_sha256"] == effective
    assert record["source_dirty"] is True
    assert len(record["source_status_sha256"]) == SHA256_LENGTH
    assert len(record["source_diff_sha256"]) == SHA256_LENGTH
    assert f"source-{effective}" in packet.parts


def test_capture_records_policy_platform_and_optional_metadata(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", "pass"],
        timeout_seconds=2.5,
        ram_limit_bytes=7 * MIB,
        admission_limit_bytes=20 * 1024 * MIB,
        sample_interval_seconds=0.02,
        metadata={"owner": "M1", "reviewer": "A12", "test_count": 1},
    )

    record = execution(packet)
    assert record["policy"] == {
        "admission_limit_bytes": 20 * 1024 * MIB,
        "ram_limit_bytes": 7 * MIB,
        "sample_interval_seconds": 0.02,
        "timeout_seconds": 2.5,
    }
    assert record["metadata"] == {"owner": "M1", "reviewer": "A12", "test_count": 1}
    assert record["platform"]["os"]
    assert record["platform"]["os_release"]
    assert record["platform"]["architecture"]
    assert record["platform"]["python_version"]
    assert record["platform"]["python_executable"] == sys.executable


def test_verify_rejects_manifest_traversal_without_reading_outside_packet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", "pass"],
    )
    packet.chmod(0o755)
    manifest = packet / "manifest.json"
    manifest.chmod(0o644)
    value = json.loads(manifest.read_text(encoding="utf-8"))
    value["files"]["../outside-secret"] = "0" * SHA256_LENGTH
    manifest.write_bytes(capture._canonical_json(value) + b"\n")
    original = capture._sha256_file

    def confined_hash(path: Path) -> str:
        assert path.resolve().is_relative_to(packet.resolve())
        return original(path)

    monkeypatch.setattr(capture, "_sha256_file", confined_hash)

    errors = capture.verify_packet(packet)

    assert any("fixed content-file set" in error for error in errors)


def test_verify_rejects_symlinked_content_file(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    packet = capture.capture_command(
        repo=repo,
        evidence_root=tmp_path / "evidence",
        argv=[sys.executable, "-c", "print('inside')"],
    )
    outside = tmp_path / "outside"
    outside.write_text("outside\n", encoding="utf-8")
    packet.chmod(0o755)
    stdout = packet / "stdout.bin"
    stdout.chmod(0o644)
    stdout.unlink()
    stdout.symlink_to(outside)

    errors = capture.verify_packet(packet)

    assert any("stdout.bin" in error and "symlink" in error for error in errors)


def test_external_anchors_form_hash_chain_and_detect_tampering(tmp_path: Path) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    evidence_root = tmp_path / "evidence"
    argv = [sys.executable, "-c", "print('anchored')"]
    first = capture.capture_command(repo=repo, evidence_root=evidence_root, argv=argv)
    second = capture.capture_command(repo=repo, evidence_root=evidence_root, argv=argv)
    anchors = sorted((first.parent / "anchors").glob("*.json"))

    assert len(anchors) == EXPECTED_ATTEMPTS
    first_digest = anchors[0].stem.split("-", 1)[1]
    assert hashlib.sha256(anchors[0].read_bytes()).hexdigest() == first_digest
    second_anchor = json.loads(anchors[1].read_text(encoding="utf-8"))
    assert second_anchor["previous_anchor_sha256"] == first_digest
    assert stat.S_IMODE(anchors[0].stat().st_mode) == READ_ONLY_FILE_MODE
    assert capture.verify_packet(first) == []
    assert capture.verify_packet(second) == []

    anchors[0].chmod(0o644)
    anchors[0].write_text("{}\n", encoding="utf-8")
    assert any("anchor" in error for error in capture.verify_packet(first))


def test_unexpected_sealing_failure_is_quarantined_without_capture_orphan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = load_capture()
    repo = init_repo(tmp_path / "repo")
    evidence_root = tmp_path / "evidence"
    error_message = "injected seal failure"

    def fail_seal(*args, **kwargs):
        del args, kwargs
        raise RuntimeError(error_message)

    monkeypatch.setattr(capture, "_seal_packet", fail_seal)
    with pytest.raises(RuntimeError, match=error_message):
        capture.capture_command(
            repo=repo,
            evidence_root=evidence_root,
            argv=[sys.executable, "-c", "print('preserve me')"],
        )

    assert not list(evidence_root.rglob(".capture-*"))
    quarantined = [path for path in evidence_root.rglob("quarantine/*") if path.is_dir()]
    assert len(quarantined) == 1
    assert (quarantined[0] / "failure.json").is_file()
    failure = json.loads((quarantined[0] / "failure.json").read_text(encoding="utf-8"))
    assert failure["error_type"] == "RuntimeError"
    assert error_message in failure["error"]
