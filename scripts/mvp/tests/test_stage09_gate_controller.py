from __future__ import annotations

# ruff: noqa: PLR2004, S101, S603, SLF001 - fixed local test fixtures and contract constants.
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest

ROOT = Path(__file__).resolve().parents[3]
CONTROLLER = ROOT / "scripts/mvp/stage09_gate_controller.py"
FINALIZER = ROOT / "scripts/mvp/finalize_stage09_evidence.py"
RUNBOOK = ROOT / "docs/dev/handoff/stage-09-restart-recovery-runbook.md"
SCHEMA = ROOT / "docs/dev/handoff/schemas/stage-09-evidence.schema.json"
SCOPE = ROOT / "scripts/mvp/check_stage09_scope.py"
GIB = 1024**3


def load_controller():
    spec = importlib.util.spec_from_file_location("stage09_gate_controller", CONTROLLER)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def init_repo(path: Path) -> tuple[Path, str]:
    git = shutil.which("git")
    assert git
    path.mkdir()
    subprocess.run([git, "init", "-q"], cwd=path, check=True)
    subprocess.run([git, "config", "user.name", "Stage Nine"], cwd=path, check=True)
    subprocess.run([git, "config", "user.email", "stage09@example.invalid"], cwd=path, check=True)
    (path / "README.md").write_text("gate fixture\n", encoding="utf-8")
    subprocess.run([git, "add", "README.md"], cwd=path, check=True)
    subprocess.run([git, "commit", "-qm", "fixture"], cwd=path, check=True)
    sha = subprocess.run(
        [git, "rev-parse", "HEAD"], cwd=path, check=True, capture_output=True, text=True
    ).stdout.strip()
    return path, sha


def paths(tmp_path: Path) -> dict[str, Path]:
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    return {
        "result_path": evidence / "result.json",
        "telemetry_path": evidence / "telemetry.jsonl",
        "log_path": evidence / "command.log",
    }


def test_policy_matches_stage09_memory_contract() -> None:
    controller = load_controller()

    policy = controller.Policy()

    assert policy.idle_limit_bytes == int(14.5 * GIB)
    assert policy.soft_limit_bytes == 15 * GIB
    assert policy.predictive_limit_bytes == int(15.25 * GIB)
    assert policy.hard_limit_bytes == int(15.5 * GIB)
    assert policy.absolute_limit_bytes == 16 * GIB
    assert policy.sample_interval_seconds == 0.25
    assert 3 * policy.sample_interval_seconds <= policy.heartbeat_timeout_seconds


def test_policy_rejects_equal_or_misordered_thresholds() -> None:
    controller = load_controller()

    with pytest.raises(ValueError, match="ordered"):
        controller.Policy(
            idle_limit_bytes=100,
            soft_limit_bytes=100,
            predictive_limit_bytes=120,
            hard_limit_bytes=130,
            absolute_limit_bytes=140,
        )


def test_success_waits_for_monitor_and_records_continuous_telemetry(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    output = paths(tmp_path)

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "print('green')"],
        policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.25),
        _test_preflight_rss_bytes=1,
        _test_monitor_rss_bytes=(1,),
        **output,
    )

    assert result["classification"] == "PASS"
    assert result["exit_code"] == 0
    assert result["monitor_ready_before_release"] is True
    assert result["telemetry_continuous"] is True
    assert result["target_pgid"] == result["target_pid"]
    assert result["cleanup"]["survivors"] == []
    assert output["log_path"].read_text(encoding="utf-8") == "green\n"
    samples = [json.loads(line) for line in output["telemetry_path"].read_text().splitlines()]
    assert samples[0]["event"] == "MONITOR_START"
    assert samples[-1]["event"] == "MONITOR_STOP"
    heartbeats = [sample for sample in samples if sample["event"] == "HEARTBEAT"]
    assert heartbeats
    assert [item["sequence"] for item in heartbeats] == list(range(1, len(heartbeats) + 1))
    assert result["heartbeat_count"] == len(heartbeats)
    assert result["peak_system_rss_bytes"] == max(item["system_rss_bytes"] for item in heartbeats)


def test_nonzero_exit_is_test_failure(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "raise SystemExit(7)"],
        policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.25),
        _test_preflight_rss_bytes=1,
        _test_monitor_rss_bytes=(1,),
        **paths(tmp_path),
    )

    assert result["classification"] == "TEST_FAILURE"
    assert result["exit_code"] == 7


def test_monitor_loss_kills_only_owned_process_group(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        result = controller.run_gate(
            cwd=repo,
            expected_sha=sha,
            command=[sys.executable, "-c", "import os,time; print(os.getpid(), flush=True); time.sleep(30)"],
            policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.08),
            _test_preflight_rss_bytes=1,
            _test_monitor_rss_bytes=(1,),
            _test_monitor_exit_after_ready=True,
            **paths(tmp_path),
        )

        target_pid = int((tmp_path / "evidence/command.log").read_text().strip())
        deadline = time.monotonic() + 2
        while psutil.pid_exists(target_pid) and time.monotonic() < deadline:
            time.sleep(0.01)
        assert result["classification"] == "MONITOR_LOST"
        assert result["cleanup"]["attempted"] is True
        assert result["cleanup"]["survivors"] == []
        assert not psutil.pid_exists(target_pid)
        assert unrelated.poll() is None
    finally:
        unrelated.send_signal(signal.SIGTERM)
        unrelated.wait(timeout=5)


def test_termination_falls_back_to_exact_pid_for_unexpected_pgid() -> None:
    controller = load_controller()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        assert os.getpgid(child.pid) != child.pid

        cleanup = controller._terminate_target(child)

        assert cleanup["attempted"] is True
        assert cleanup["identity_error"] == "target_pgid_does_not_equal_target_pid"
        assert cleanup["survivors"] == []
        assert child.poll() is not None
        assert os.getpgid(os.getpid()) == os.getpgrp()
    finally:
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)


def test_hard_guard_kills_owned_group_and_records_ram_guard_trip(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    policy = controller.Policy(
        idle_limit_bytes=100,
        soft_limit_bytes=110,
        predictive_limit_bytes=120,
        hard_limit_bytes=130,
        absolute_limit_bytes=140,
        sample_interval_seconds=0.01,
        heartbeat_timeout_seconds=0.25,
    )

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "import time; time.sleep(30)"],
        policy=policy,
        _test_preflight_rss_bytes=90,
        _test_monitor_rss_bytes=(90, 115, 125, 131),
        **paths(tmp_path),
    )

    assert result["classification"] == "RAM_GUARD_TRIP"
    assert result["stop_reason"] == "hard_limit"
    assert result["peak_system_rss_bytes"] == 131
    assert result["cleanup"]["survivors"] == []
    events = [json.loads(line)["event"] for line in (tmp_path / "evidence/telemetry.jsonl").read_text().splitlines()]
    assert "SOFT_WARNING" in events
    assert "PREDICTIVE_STOP" in events
    assert "RAM_GUARD_TRIP" in events


def test_monitor_ready_sample_must_pass_idle_admission(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    policy = controller.Policy(
        idle_limit_bytes=100,
        soft_limit_bytes=110,
        predictive_limit_bytes=120,
        hard_limit_bytes=130,
        absolute_limit_bytes=140,
        sample_interval_seconds=0.01,
        heartbeat_timeout_seconds=0.25,
    )

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "print('must not run')"],
        policy=policy,
        _test_preflight_rss_bytes=90,
        _test_monitor_rss_bytes=(100,),
        **paths(tmp_path),
    )

    assert result["classification"] == "INFRA_FAILURE"
    assert result["stop_reason"] == "monitor_idle_admission_denied"
    assert result["monitor_ready_before_release"] is False
    assert (tmp_path / "evidence/command.log").read_bytes() == b""


def test_stale_sha_and_idle_pressure_fail_before_target_release(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    stale_output = paths(tmp_path)

    stale = controller.run_gate(
        cwd=repo,
        expected_sha="0" * 40,
        command=[sys.executable, "-c", "raise AssertionError('must not run')"],
        **stale_output,
    )

    assert stale["classification"] == "STALE_SHA"
    assert stale["target_pid"] is None
    assert stale_output["log_path"].read_bytes() == b""

    pressure_root = tmp_path / "pressure"
    pressure_root.mkdir()
    pressure_output = {
        "result_path": pressure_root / "result.json",
        "telemetry_path": pressure_root / "telemetry.jsonl",
        "log_path": pressure_root / "command.log",
    }
    pressure = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "raise AssertionError('must not run')"],
        _test_preflight_rss_bytes=controller.Policy().idle_limit_bytes,
        **pressure_output,
    )

    assert pressure["classification"] == "INFRA_FAILURE"
    assert pressure["stop_reason"] == "idle_admission_denied"
    assert pressure["target_pid"] is None


def test_dirty_checkout_is_stale_before_target_release(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    (repo / "README.md").write_text("dirty\n", encoding="utf-8")

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "raise AssertionError('must not run')"],
        **paths(tmp_path),
    )

    assert result["classification"] == "STALE_SHA"
    assert result["target_pid"] is None


def test_delected_only_requires_exact_pytest_summary(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    output = paths(tmp_path)
    exact = "================ 3 deselected, 1 warning in 0.12s ================\n"

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", f"import sys; print({exact!r}, end=''); raise SystemExit(5)"],
        allow_deselected_only=True,
        policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.25),
        _test_preflight_rss_bytes=1,
        _test_monitor_rss_bytes=(1,),
        **output,
    )

    assert result["classification"] == "DESELECTED_ONLY"


def test_service_failure_uses_explicit_nonzero_class(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")

    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "raise SystemExit(9)"],
        nonzero_classification="SERVICE_FAILURE",
        policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.25),
        _test_preflight_rss_bytes=1,
        _test_monitor_rss_bytes=(1,),
        **paths(tmp_path),
    )

    assert result["classification"] == "SERVICE_FAILURE"
    assert result["exit_code"] == 9


def test_stage09_contract_requires_controller_evidence_and_owned_paths() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    finalizer = FINALIZER.read_text(encoding="utf-8")
    scope = SCOPE.read_text(encoding="utf-8")
    runbook = RUNBOOK.read_text(encoding="utf-8")

    assert "resource" in schema["required"]
    resource = schema["properties"]["resource"]
    assert resource["properties"]["telemetry_continuous"] == {"const": True}
    assert resource["properties"]["observed_ge_16"] == {"const": False}
    assert resource["properties"]["peak_system_rss_bytes"]["exclusiveMaximum"] == 16 * GIB
    assert '"process/resource-summary.json"' in finalizer
    assert '"scripts/mvp/stage09_gate_controller.py"' in scope
    assert '"scripts/mvp/tests/test_stage09_gate_controller.py"' in scope
    assert '"scripts/mvp/run_stage09_backend_package.sh"' in scope
    assert "stage09_gate_controller.py run" in runbook
    assert '--lock-path "$S09_EVIDENCE_ROOT/.stage09-heavy-gate.lock"' in runbook


def test_summarize_requires_continuous_accepted_gate_evidence(tmp_path: Path) -> None:
    controller = load_controller()
    repo, sha = init_repo(tmp_path / "repo")
    run_root = tmp_path / "run"
    gates = run_root / "process/gates"
    telemetry = run_root / "process/telemetry"
    logs = run_root / "logs"
    gates.mkdir(parents=True)
    telemetry.mkdir(parents=True)
    logs.mkdir()
    result = controller.run_gate(
        cwd=repo,
        expected_sha=sha,
        command=[sys.executable, "-c", "print('summary')"],
        result_path=gates / "001-green.json",
        telemetry_path=telemetry / "001-green.jsonl",
        log_path=logs / "green.txt",
        policy=controller.Policy(sample_interval_seconds=0.01, heartbeat_timeout_seconds=0.25),
        _test_preflight_rss_bytes=1,
        _test_monitor_rss_bytes=(1,),
    )
    assert result["accepted"] is True

    summary = controller.summarize_results(
        results_dir=gates,
        telemetry_dir=telemetry,
        output=run_root / "process/resource-summary.json",
    )

    assert summary["telemetry_continuous"] is True
    assert summary["monitor_losses"] == 0
    assert summary["ram_guard_trips"] == 0
    assert summary["result_files"] == ["process/gates/001-green.json"]
    assert summary["peak_system_rss_bytes"] == 1

    bad_run = tmp_path / "bad-run"
    bad_gates = bad_run / "process/gates"
    bad_telemetry = bad_run / "process/telemetry"
    bad_gates.mkdir(parents=True)
    bad_telemetry.mkdir(parents=True)
    shutil.copy2(gates / "001-green.json", bad_gates / "001-green.json")
    lines = (telemetry / "001-green.jsonl").read_text(encoding="utf-8").splitlines()
    (bad_telemetry / "001-green.jsonl").write_text(
        "\n".join(line for line in lines if json.loads(line)["event"] != "MONITOR_STOP") + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="continuous"):
        controller.summarize_results(
            results_dir=bad_gates,
            telemetry_dir=bad_telemetry,
            output=bad_run / "process/resource-summary.json",
        )
