from __future__ import annotations

# ruff: noqa: FBT003, PLR2004, PT018, S101, S108, SLF001
import importlib.util
import json
import struct
import sys
import time
import zlib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = ROOT / "scripts/mvp/validate_evidence_bundle.py"
SEALER = ROOT / "scripts/mvp/seal_evidence_bundle.py"
RAM_GUARD = ROOT / "scripts/mvp/stage10_ram_guard.py"
SCHEMA_DIR = ROOT / "docs/dev/handoff/evidence/stage-10"
SHA = "a" * 40
OWNER = "stage10-owner"
RETENTION = "forever"
SCREENSHOT_NAMES = (
    "01-board-note-chat.png",
    "02-automation-result.png",
    "03-ai-preview-confirmation.png",
    "04-settings-entry.png",
    "05-restored-board.png",
)
TASK_IDS = tuple(f"task-a{index:02d}" for index in range(1, 11))
GATE_IDS = (
    "seed-idempotency",
    "focused-backend",
    "sqlite-migrations",
    "postgres-migrations",
    "kfx",
    "lfx",
    "frontend-focused",
    "frontend-i18n",
    "frontend-type",
    "frontend-build",
    "backend-package",
    "frontend-full",
    "chromium-story",
    "product-design",
    "chrome",
    "computer-use",
    "live-ai",
    "security",
    "secret",
    "ram",
)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def png(width: int = 1440, height: int = 900) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    chunk = b"IHDR" + ihdr
    iend = b"IEND"
    return (
        signature
        + struct.pack(">I", len(ihdr))
        + chunk
        + struct.pack(">I", zlib.crc32(chunk))
        + struct.pack(">I", 0)
        + iend
        + struct.pack(">I", zlib.crc32(iend))
    )


def common(kind: str) -> dict[str, object]:
    return {
        "schema": f"ketos.stage10.{kind}.v1",
        "s10_code_sha": SHA,
        "owner": OWNER,
        "retention_policy": RETENTION,
        "started_at": "2026-07-23T00:00:00Z",
        "ended_at": "2026-07-23T00:00:01Z",
        "command": ["safe", "command"],
        "cwd": "/Volumes/Projects/ketos",
        "exit_code": 0,
        "verdict": "PASS",
    }


def make_bundle(tmp_path: Path) -> Path:
    bundle = tmp_path / "persistent" / "stage-10" / SHA
    screenshots = bundle / "product-design" / "1440x900"
    screenshots.mkdir(parents=True)
    for name in SCREENSHOT_NAMES:
        (screenshots / name).write_bytes(png())

    entity = common("entity-ledger")
    entity["entities"] = [
        {"kind": "Project", "id": "project-1", "revision": 1},
        {"kind": "Board", "id": "board-1", "revision": 1},
        {"kind": "BoardNote", "id": "note-1", "revision": 1},
        {"kind": "ChatThread", "id": "chat-1"},
        {"kind": "ChatThread", "id": "chat-2"},
        {"kind": "Flow", "id": "flow-1", "revision": 1},
        {"kind": "Job", "id": "job-1"},
        {"kind": "CommandProposal", "id": "proposal-1"},
        {"kind": "CommandProposal", "id": "proposal-2"},
        {"kind": "Placement", "id": "placement-1"},
    ]
    entity["canonical_saver"] = "/tmp/acceptance/data/mvp/langgraph-checkpoints.sqlite3"
    entity["acceptance_run_redacted"] = "$KETOS_STAGE10_ACCEPTANCE_RUN_DIR"
    (bundle / "entity-ledger.json").write_text(json.dumps(entity), encoding="utf-8")

    gates = common("gate-results")
    gates["source_clean_before"] = True
    gates["source_clean_after"] = True
    gates["source_sha_unchanged"] = True
    gates["tasks"] = [
        {
            "id": task_id,
            "commit_sha": SHA,
            "changed_paths": ["owned/stage10/path"],
            "command": ["uv", "run", "pytest"],
            "cwd": "/Volumes/Projects/ketos",
            "started_at": "2026-07-23T00:00:00Z",
            "ended_at": "2026-07-23T00:00:01Z",
            "exit_code": 0,
            "verdict": "PASS",
            "evidence": "gate-results.json",
        }
        for task_id in TASK_IDS
    ]
    gates["gates"] = [
        {
            "id": gate_id,
            "s10_code_sha": SHA,
            "command": ["uv", "run", "pytest"],
            "cwd": "/Volumes/Projects/ketos",
            "started_at": "2026-07-23T00:00:00Z",
            "ended_at": "2026-07-23T00:00:01Z",
            "exit_code": 0,
            "skip_count": 0,
            "peak_system_used_bytes": 12_000_000_000,
            "telemetry_sequence_start": 1,
            "telemetry_sequence_end": 63,
            "post_gate_tail_seconds": 30,
            "verdict": "PASS",
            "evidence": f"logs/{gate_id}.log",
        }
        for gate_id in GATE_IDS
    ]
    (bundle / "gate-results.json").write_text(json.dumps(gates), encoding="utf-8")

    live = common("live-ai-smoke")
    live.update(
        {
            "provider_adapter": "OpenAI",
            "provider_upstream": "CometAPI",
            "model": "deepseek-v4-flash",
            "base_url": "https://api.cometapi.com/v1",
            "raw_content_retained": False,
            "ketos_provider_config": {
                "variables_creation_order": ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
                "variables_api": "PASS",
                "check_config": "PASS",
                "provider_adapter": "OpenAI",
                "model": "deepseek-v4-flash",
            },
            "direct_preflight": {
                "models_status": "PASS",
                "reply_status": "PASS",
                "typed_tool_status": "PASS",
                "tool_followup_status": "PASS",
            },
            "ketos_live": {
                "reply": {"durable_assistant_commits": 1},
                "reject": {"flow_effects": 0, "outcome": "rejected"},
                "approve": {"flow_effects": 1, "outcome": "applied"},
            },
            "db_correlation": {
                "reply_chat_runs": 1,
                "reply_message_commits": 1,
                "reject_proposals": 1,
                "reject_message_commits": 1,
                "approve_proposals": 1,
                "approve_message_commits": 1,
                "distinct_proposal_ids": True,
            },
        }
    )
    (bundle / "live-ai-smoke.json").write_text(json.dumps(live), encoding="utf-8")

    journal = common("final-journal")
    journal["sections"] = [
        {"id": name, "owner": OWNER, "verdict": "PASS", "evidence": "gate-results.json"}
        for name in (
            "completed_tasks",
            "partial_tasks",
            "defects",
            "blockers",
            "tests",
            "subagents",
            "acceptance",
            "closure",
        )
    ]
    (bundle / "final-journal.json").write_text(json.dumps(journal), encoding="utf-8")
    (bundle / "final-report.md").write_text("# Stage 10\n\nPASS\n", encoding="utf-8")
    (bundle / "seal-probe.txt").write_text("stage10 immutable seal probe\n", encoding="utf-8")

    manifest = {
        "stage": 10,
        "artifact_kind": "product-design-screenshot-manifest",
        "s10_code_sha": SHA,
        "owner": OWNER,
        "retention_policy": RETENTION,
        "generated_at": "2026-07-23T00:00:00Z",
        "viewport": {"width": 1440, "height": 900},
        "screenshots": [],
        "audits": {
            "product_design": {"status": "PASS", "P0": 0, "P1": 0, "P2": 0},
            "chrome": {
                "status": "PASS",
                "P0": 0,
                "P1": 0,
                "P2": 0,
                "accessibility": "PASS",
                "network": "PASS",
                "focus": "PASS",
            },
            "computer_use": {
                "status": "PASS",
                "P0": 0,
                "P1": 0,
                "P2": 0,
                "layout": "PASS",
                "focus": "PASS",
            },
        },
        "secret_scan": {"status": "PASS", "matches": 0, "files_scanned": 5},
    }
    import hashlib

    for name in SCREENSHOT_NAMES:
        data = (screenshots / name).read_bytes()
        manifest["screenshots"].append(
            {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)}
        )
    (bundle / "product-design-screenshot-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    memory_rows = []
    for gate_id in GATE_IDS:
        sequence = 0
        for phase, count in (("admission", 31), ("gate", 1), ("tail", 31)):
            for _ in range(count):
                sequence += 1
                memory_rows.append(
                    {
                        "schema": "ketos.stage10.memory-sample.v1",
                        "at": "2026-07-23T00:00:00Z",
                        "monotonic_ns": sequence * 1_000_000_000,
                        "sequence": sequence,
                        "gate_id": gate_id,
                        "phase": phase,
                        "system_used_bytes": 12_000_000_000,
                        "aggregate_rss_bytes": 9_000_000_000,
                        "pageouts": 0,
                        "swapouts": 0,
                        "critical_memory_pressure": False,
                        "monitor_loss": False,
                    }
                )
    (bundle / "memory-monitor.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in memory_rows),
        encoding="utf-8",
    )
    (bundle / "pid-ledger.json").write_text(
        json.dumps({"schema": "ketos.stage10.pid-ledger.v1", "records": []}), encoding="utf-8"
    )
    (bundle / "memory-baseline.json").write_text(
        json.dumps({"schema": "ketos.stage10.memory-baseline.v1", "system_used_bytes": 12_000_000_000}),
        encoding="utf-8",
    )
    (bundle / "ram-summary.json").write_text(
        json.dumps(
            {
                "schema": "ketos.stage10.ram-summary.v1",
                "gate_count": len(GATE_IDS),
                "sample_count": len(memory_rows),
                "peak_system_used_bytes": 12_000_000_000,
                "peak_aggregate_rss_bytes": 9_000_000_000,
                "warning_trips": 0,
                "stop_trips": 0,
                "emergency_trips": 0,
                "monitor_losses": 0,
                "observed_ge_16": False,
                "verdict": "PASS",
            }
        ),
        encoding="utf-8",
    )
    return bundle


def test_validator_builds_exclusive_redacted_manifest(tmp_path: Path) -> None:
    validator = load_module("stage10_validator", VALIDATOR)
    bundle = make_bundle(tmp_path)
    report = bundle / "no-secret-qa.json"
    manifest = bundle / "manifest.json"

    result = validator.validate_and_manifest(
        bundle=bundle,
        schema_dir=SCHEMA_DIR,
        s10_code_sha=SHA,
        owner=OWNER,
        retention_policy=RETENTION,
        deny_secrets=True,
        no_secret_report=report,
        manifest_path=manifest,
    )

    assert result["verdict"] == "PASS"
    assert report.stat().st_mode & 0o777 == 0o600
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["s10_code_sha"] == SHA
    assert payload["retention_policy"] == RETENTION
    assert {item["path"] for item in payload["artifacts"]} >= {
        "entity-ledger.json",
        "no-secret-qa.json",
        "product-design/1440x900/01-board-note-chat.png",
    }
    assert all(not Path(item["path"]).is_absolute() for item in payload["artifacts"])
    with pytest.raises(FileExistsError):
        validator.validate_and_manifest(
            bundle=bundle,
            schema_dir=SCHEMA_DIR,
            s10_code_sha=SHA,
            owner=OWNER,
            retention_policy=RETENTION,
            deny_secrets=True,
            no_secret_report=report,
            manifest_path=manifest,
        )


def test_validator_rejects_secret_and_screenshot_tamper(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_secret", VALIDATOR)
    bundle = make_bundle(tmp_path)
    (bundle / "final-report.md").write_text("Authorization: Bearer sk-" + "x" * 32, encoding="utf-8")

    with pytest.raises(ValueError, match="secret"):
        validator.validate_and_manifest(
            bundle=bundle,
            schema_dir=SCHEMA_DIR,
            s10_code_sha=SHA,
            owner=OWNER,
            retention_policy=RETENTION,
            deny_secrets=True,
            no_secret_report=bundle / "no-secret-qa.json",
            manifest_path=bundle / "manifest.json",
        )


def test_ram_guard_stage10_state_machine_contract() -> None:
    guard = load_module("stage10_guard", RAM_GUARD)
    policy = guard.Policy()
    state = guard.GuardState()

    assert policy.absolute_limit_bytes == 16_000_000_000
    assert [guard.observe(state, 13_500_000_000, False, policy) for _ in range(2)] == [[], []]
    assert guard.observe(state, 13_500_000_000, False, policy) == ["WARNING"]
    assert guard.observe(state, 14_750_000_000, False, policy) == []
    assert guard.observe(state, 14_750_000_000, False, policy) == ["STOP"]
    assert guard.observe(state, 15_250_000_000, False, policy) == ["EMERGENCY_STOP"]
    assert guard.observe(state, 16_000_000_000, False, policy) == ["ABSOLUTE_LIMIT"]


def test_ram_guard_two_missed_samples_fail_closed() -> None:
    guard = load_module("stage10_guard_loss", RAM_GUARD)
    policy = guard.Policy()
    state = guard.GuardState()

    assert guard.observe_loss(state, policy) == []
    assert guard.observe_loss(state, policy) == ["MONITOR_LOST"]


def test_ram_guard_sampler_has_independent_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = load_module("stage10_guard_deadline", RAM_GUARD)

    def hung_sample(*_args, **_kwargs):
        time.sleep(0.2)
        return {}

    monkeypatch.setattr(guard, "sample", hung_sample)
    started = time.monotonic()
    with pytest.raises(TimeoutError, match="heartbeat"):
        guard.sample_with_deadline(1, "gate", "gate", timeout_seconds=0.01)
    assert time.monotonic() - started < 0.1


def test_ram_guard_aggregate_rss_records_unreadable_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_rss", RAM_GUARD)

    class Process:
        def __init__(self, memory_info):
            self.info = {"memory_info": memory_info}

    readable = type("Memory", (), {"rss": 123})()
    monkeypatch.setattr(
        guard.psutil,
        "process_iter",
        lambda _fields: [Process(readable), Process(None)],
    )

    assert guard._aggregate_rss() == (123, 1, 1)


def test_ram_guard_timeout_stops_only_owned_group(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_timeout", RAM_GUARD)
    evidence = tmp_path / "guard"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(
        guard,
        "_recovery_admission",
        lambda **_kwargs: (True, False, 0, []),
    )
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda sequence, gate_id, phase: {
            "schema": "ketos.stage10.memory-sample.v1",
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "critical_memory_pressure": False,
        },
    )

    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="timeout",
        command=[sys.executable, "-c", "import time; time.sleep(30)"],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0),
        timeout_seconds=0.05,
    )

    assert result["classification"] == "TIMEOUT"
    assert result["verdict"] == "FAIL"
    assert result["cleanup"]["term_sent"] is True
    assert result["cleanup"]["survivors"] == []


def test_sealer_rejects_wrong_control_and_manifest_checksum(tmp_path: Path) -> None:
    sealer = load_module("stage10_sealer", SEALER)
    bundle = make_bundle(tmp_path)
    manifest = bundle / "manifest.json"
    manifest.write_text("{}\n", encoding="utf-8")
    checksum = bundle / "manifest.sha256"
    checksum.write_text("0" * 64 + "  manifest.json\n", encoding="ascii")

    with pytest.raises(ValueError, match="apfs-uchg"):
        sealer.preflight(
            bundle=bundle,
            control="chmod",
            manifest_sha_file=checksum,
            external_receipt=bundle.parent / f"{SHA}.seal-receipt.json",
        )
    with pytest.raises(ValueError, match="checksum"):
        sealer.preflight(
            bundle=bundle,
            control="apfs-uchg",
            manifest_sha_file=checksum,
            external_receipt=bundle.parent / f"{SHA}.seal-receipt.json",
            require_apfs=False,
        )


def test_schema_set_is_complete_and_draft_2020_12() -> None:
    expected = {
        "evidence-manifest.schema.json",
        "entity-ledger.schema.json",
        "gate-results.schema.json",
        "live-ai-smoke.schema.json",
        "product-design-screenshot-manifest.schema.json",
        "final-journal.schema.json",
    }
    assert {path.name for path in SCHEMA_DIR.glob("*.schema.json")} == expected
    for name in expected:
        payload = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
        assert payload["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_no_material_artifact_is_symlinked(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_symlink", VALIDATOR)
    bundle = make_bundle(tmp_path)
    target = bundle / "final-report.md"
    target.unlink()
    target.symlink_to("/etc/hosts")
    with pytest.raises(ValueError, match="symlink"):
        validator._inventory(bundle)


def test_no_material_artifact_is_hard_linked(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_hardlink", VALIDATOR)
    bundle = make_bundle(tmp_path)
    external = tmp_path / "external.txt"
    external.write_text("outside bundle\n", encoding="utf-8")
    (bundle / "hard-link.txt").hardlink_to(external)
    with pytest.raises(ValueError, match="hard-linked"):
        validator._inventory(bundle)
