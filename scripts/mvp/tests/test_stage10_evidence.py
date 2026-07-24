from __future__ import annotations

# ruff: noqa: FBT003, PLR2004, PLW1510, PT007, PT018, S101, S108, S603, SIM105, SLF001
import hashlib
import importlib.util
import json
import os
import plistlib
import struct
import subprocess
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
CLOSURE_TOOLING_SHA = "638f2b2d35e353fe0ad9f39ee800315ebe6d1338"
GENERIC_SEAL = ROOT / "scripts/mvp/stage_evidence_seal.py"
GENERIC_SEAL_GIT_BLOB_OID = "cb152e95594c9579d5e40cf130e81669cc10991a"
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
            "actor_id": "actor-1",
            "project_id": "project-1",
            "board_id": "board-1",
            "chat_id": "chat-1",
            "flow_id": "flow-1",
            "canonical_saver": "/Volumes/Projects/stage10/data/mvp/langgraph-checkpoints.sqlite3",
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
                "models_latency_ms": 1,
                "reply_status": "PASS",
                "reply_request_id": "reply-request-1",
                "reply_latency_ms": 1,
                "reply_usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                "typed_tool_status": "PASS",
                "typed_tool_request_id": "tool-request-1",
                "typed_tool_latency_ms": 1,
                "typed_tool_usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                "tool_followup_status": "PASS",
                "tool_followup_request_id": "follow-request-1",
                "tool_followup_latency_ms": 1,
                "tool_followup_usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
            "ketos_live": {
                "reply": {
                    "run_id": "reply-run",
                    "chat_run_id": "reply-chat-run",
                    "request_id": "reply-request",
                    "latency_ms": 1,
                    "assistant_text_sha256": "1" * 64,
                    "assistant_text_bytes": 5,
                    "durable_assistant_commits": 1,
                },
                "reject": {
                    "run_id": "reject-run",
                    "resume_run_id": "reject-resume",
                    "proposal_id": "reject-proposal",
                    "proposal_latency_ms": 1,
                    "resume_latency_ms": 1,
                    "revision_before": 1,
                    "revision_after": 1,
                    "hash_unchanged": True,
                    "flow_effects": 0,
                    "durable_assistant_commits": 1,
                    "outcome": "rejected",
                },
                "approve": {
                    "run_id": "approve-run",
                    "resume_run_id": "approve-resume",
                    "proposal_id": "approve-proposal",
                    "proposal_latency_ms": 1,
                    "resume_latency_ms": 1,
                    "revision_before": 1,
                    "revision_after": 2,
                    "hash_changed": True,
                    "flow_effects": 1,
                    "durable_assistant_commits": 1,
                    "outcome": "applied",
                },
            },
            "server_process": {
                "pid": 100,
                "pgid": 100,
                "started_at_epoch": 1.0,
                "term_sent": True,
                "kill_sent": False,
                "survivor_count": 0,
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
            "secret_file_retained": True,
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
            if phase == "gate":
                memory_rows.append(
                    {
                        "schema": "ketos.stage10.memory-boundary.v1",
                        "at": "2026-07-23T00:00:00Z",
                        "monotonic_ns": sequence * 1_000_000_000 + 500_000_000,
                        "gate_id": gate_id,
                        "boundary": "gate_finished",
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
                "sample_count": sum(row["schema"] == "ketos.stage10.memory-sample.v1" for row in memory_rows),
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
    (bundle / "repo-after-full.json").write_text(
        json.dumps(
            {
                "schema": "ketos.stage10.repo-after-full.v1",
                "s10_code_sha": SHA,
                "head_sha": SHA,
                "changed_paths": [],
                "matches_before": True,
                "verdict": "PASS",
            }
        ),
        encoding="utf-8",
    )
    (bundle / "tooling-provenance.json").write_text(
        json.dumps(
            {
                "schema": "ketos.stage10.tooling-provenance.v1",
                "s10_code_sha": SHA,
                "closure_tooling_sha": CLOSURE_TOOLING_SHA,
                "generic_path": "scripts/mvp/stage_evidence_seal.py",
                "generic_git_blob_oid": GENERIC_SEAL_GIT_BLOB_OID,
                "generic_sha256": hashlib.sha256(GENERIC_SEAL.read_bytes()).hexdigest(),
                "wrapper_path": "scripts/mvp/seal_evidence_bundle.py",
                "wrapper_sha256": hashlib.sha256(SEALER.read_bytes()).hexdigest(),
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
        "repo-after-full.json",
        "tooling-provenance.json",
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


def test_validator_records_intended_final_bundle_and_structured_zero_write(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_final_path", VALIDATOR)
    bundle = make_bundle(tmp_path)
    final_bundle = tmp_path / "published" / "stage-10" / SHA / "run-1"

    result = validator.validate_and_manifest(
        bundle=bundle,
        schema_dir=SCHEMA_DIR,
        s10_code_sha=SHA,
        owner=OWNER,
        retention_policy=RETENTION,
        deny_secrets=True,
        no_secret_report=bundle / "no-secret-qa.json",
        manifest_path=bundle / "manifest.json",
        intended_final_bundle=final_bundle,
    )

    assert result["canonical_bundle"] == str(final_bundle)
    assert result["persistent_root"] == str(final_bundle.parents[2])


def test_validator_rejects_nonempty_structured_diff(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_repo_after", VALIDATOR)
    bundle = make_bundle(tmp_path)
    repo_after = bundle / "repo-after-full.json"
    payload = json.loads(repo_after.read_text(encoding="utf-8"))
    payload["changed_paths"] = ["src/backend/base/ketos/api/v1/projects.py"]
    payload["matches_before"] = False
    repo_after.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="structured zero-write"):
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


def test_validator_rejects_tooling_provenance_mismatch(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_provenance", VALIDATOR)
    bundle = make_bundle(tmp_path)
    provenance = bundle / "tooling-provenance.json"
    payload = json.loads(provenance.read_text(encoding="utf-8"))
    payload["generic_sha256"] = "0" * 64
    provenance.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="tooling provenance"):
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


def test_stage10_sealer_is_a_thin_generic_adapter() -> None:
    source = SEALER.read_text(encoding="utf-8")

    assert "import stage_evidence_seal as seal" in source
    assert "materialize_distinct_copy" in source
    assert "run_negative_mutation_probes" in source
    assert "publish_receipt_atomically" in source
    assert "verify_receipt_self_protection" in source
    assert "def _run_chflags" not in source
    assert "os.chmod(" not in source


def test_stage10_sealer_rejects_staging_inventory_drift() -> None:
    sealer = load_module("stage10_sealer_inventory_binding", SEALER)
    expected = {"root_sha256": "1" * 64, "xattr_root_sha256": "2" * 64}
    changed = {"root_sha256": "3" * 64, "xattr_root_sha256": "2" * 64}

    with pytest.raises(ValueError, match="staging differs"):
        sealer._assert_inventory_equal(expected, changed, label="staging")


def test_stage10_sealer_rechecks_worktree_parent_identity_and_staging_secrets() -> None:
    source = SEALER.read_text(encoding="utf-8")

    assert source.count("_verify_frozen_worktree(") >= 4
    assert "_scan_secrets(_inventory(staging))" in source
    assert "_verify_directory_identity(final.parent" in source
    assert "_verify_directory_identity(receipt_dir.parent" in source


def test_volume_identity_walks_to_diskutil_supported_parent(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    validator = load_module("stage10_validator_volume", VALIDATOR)
    nested = tmp_path / "nested" / "bundle"
    nested.mkdir(parents=True)
    supported = tmp_path.resolve()
    calls: list[Path] = []

    def diskutil(command, **_kwargs):
        candidate = Path(command[-1])
        calls.append(candidate)
        if candidate != supported:
            raise subprocess.CalledProcessError(1, command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=plistlib.dumps(
                {
                    "FilesystemType": "apfs",
                    "VolumeUUID": "11111111-2222-3333-4444-555555555555",
                },
            ),
        )

    monkeypatch.setattr(validator.subprocess, "run", diskutil)

    assert validator._volume_identity(nested, require_apfs=True) == (
        "apfs",
        "11111111-2222-3333-4444-555555555555",
    )
    assert calls[-1] == supported
    assert calls[0] == nested.resolve()


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


def test_validator_accepts_scheduler_jitter_for_30_tail_samples(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_tail_jitter", VALIDATOR)
    bundle = make_bundle(tmp_path)
    monitor = bundle / "memory-monitor.jsonl"
    rows = [json.loads(line) for line in monitor.read_text(encoding="utf-8").splitlines()]
    target = [row for row in rows if row["gate_id"] == "frontend-build" and row.get("phase") == "tail"]
    rows.remove(target[-1])
    target = target[:-1]
    boundary = next(
        row
        for row in rows
        if row["gate_id"] == "frontend-build" and row["schema"] == "ketos.stage10.memory-boundary.v1"
    )
    first_monotonic_ns = boundary["monotonic_ns"] + 1_006_000_000
    for index, row in enumerate(target):
        row["monotonic_ns"] = first_monotonic_ns + index * 999_827_000
    monitor.write_text(
        "".join(json.dumps(row) + "\n" for row in rows),
        encoding="utf-8",
    )
    summary = json.loads((bundle / "ram-summary.json").read_text(encoding="utf-8"))
    summary["sample_count"] = sum(row["schema"] == "ketos.stage10.memory-sample.v1" for row in rows)
    (bundle / "ram-summary.json").write_text(json.dumps(summary), encoding="utf-8")

    validator._validate_ram_evidence(bundle)


def test_validator_rejects_missing_gate_finished_boundary(tmp_path: Path) -> None:
    validator = load_module("stage10_validator_missing_boundary", VALIDATOR)
    bundle = make_bundle(tmp_path)
    monitor = bundle / "memory-monitor.jsonl"
    rows = [json.loads(line) for line in monitor.read_text(encoding="utf-8").splitlines()]
    rows = [
        row
        for row in rows
        if not (row["gate_id"] == "frontend-build" and row["schema"] == "ketos.stage10.memory-boundary.v1")
    ]
    monitor.write_text(
        "".join(json.dumps(row) + "\n" for row in rows),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="gate-finished boundary"):
        validator._validate_ram_evidence(bundle)


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


def test_ram_guard_emits_gate_finished_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_boundary", RAM_GUARD)
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
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        },
    )
    telemetry = evidence / "telemetry.jsonl"

    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="boundary",
        command=[sys.executable, "-c", "pass"],
        result_path=evidence / "result.json",
        telemetry_path=telemetry,
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02),
    )
    records = [json.loads(line) for line in telemetry.read_text(encoding="utf-8").splitlines()]

    assert result["verdict"] == "PASS"
    assert [
        row
        for row in records
        if row.get("schema") == "ketos.stage10.memory-boundary.v1" and row.get("boundary") == "gate_finished"
    ]
    assert result["tail_complete"] is True
    assert result["last_sample_sequence"] >= 1
    assert result["last_heartbeat_age_seconds"] >= 0
    assert result["pageout_delta"] == 0
    assert result["swapout_delta"] == 0
    assert result["child_outcomes"]["target"]["returncode"] == 0


def test_ram_guard_supplies_devnull_when_parent_stdin_is_closed(tmp_path: Path) -> None:
    evidence = tmp_path / "closed-stdin"
    evidence.mkdir()
    driver = (
        "import importlib.util, os, pathlib, sys;"
        f"p=pathlib.Path({str(RAM_GUARD)!r});"
        "s=importlib.util.spec_from_file_location('stage10_guard_closed_stdin',p);"
        "m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m);"
        "m._git_clean=lambda *_args: True;"
        "m._recovery_admission=lambda **_kwargs:(True,False,0,[]);"
        "m.sample_with_deadline=lambda sequence,gate_id,phase:{"
        "'schema':'ketos.stage10.memory-sample.v1','at':'2026-07-23T00:00:00Z',"
        "'monotonic_ns':sequence+1,'sequence':sequence,'gate_id':gate_id,'phase':phase,"
        "'system_used_bytes':1,'aggregate_rss_bytes':1,'pageouts':0,'swapouts':0,"
        "'critical_memory_pressure':False,'monitor_loss':False};"
        "os.close(0);"
        f"root=pathlib.Path({str(evidence)!r});"
        "r=m.run_guarded(cwd=pathlib.Path.cwd(),expected_sha='a'*40,gate_id='closed-stdin',"
        "command=[sys.executable,'-c','import os;[os.fstat(fd) for fd in (0,1,2)]'],"
        "result_path=root/'result.json',telemetry_path=root/'telemetry.jsonl',"
        "pid_ledger_path=root/'pid-ledger.json',log_path=root/'gate.log',"
        "policy=m.Policy(sample_interval_seconds=.01,recovery_seconds=0,tail_seconds=.02),"
        "timeout_seconds=5);"
        "raise SystemExit(0 if r['verdict']=='PASS' else 1)"
    )

    completed = subprocess.run(
        [sys.executable, "-c", driver],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=20,
    )

    assert completed.returncode == 0, completed.stderr
    result = json.loads((evidence / "result.json").read_text(encoding="utf-8"))
    assert result["classification"] == "PASS"


def test_ram_guard_retries_transient_identity_capture_for_live_child(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_identity_retry", RAM_GUARD)
    evidence = tmp_path / "identity-retry"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda sequence, gate_id, phase: {
            "schema": "ketos.stage10.memory-sample.v1",
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        },
    )
    real_identity = guard._identity
    attempts = 0

    def transient_identity(pid):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise guard.psutil.AccessDenied(pid)
        return real_identity(pid)

    monkeypatch.setattr(guard, "_identity", transient_identity)
    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="identity-retry",
        command=[sys.executable, "-c", "import time; time.sleep(0.1)"],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02),
    )

    assert attempts >= 2
    assert result["verdict"] == "PASS"
    assert result["cleanup"]["survivors"] == []


def test_ram_guard_persistent_identity_capture_failure_reaps_spawn_handle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_identity_failure", RAM_GUARD)
    evidence = tmp_path / "identity-failure"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(guard, "_identity", lambda pid: (_ for _ in ()).throw(guard.psutil.AccessDenied(pid)))

    descendant_pid = evidence / "descendant.pid"
    child_source = (
        "import pathlib,signal,subprocess,sys,time;"
        f"p=subprocess.Popen([sys.executable,'-c','import signal,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)']);"
        f"pathlib.Path({str(descendant_pid)!r}).write_text(str(p.pid));"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)"
    )
    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="identity-failure",
        command=[sys.executable, "-c", child_source],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02, term_grace_seconds=0),
    )

    assert result["classification"] == "IDENTITY_CAPTURE_FAILURE"
    assert result["verdict"] == "FAIL"
    assert result["cleanup"]["spawn_handle_verified"] is True
    assert result["cleanup"]["kill_sent"] is True
    assert result["cleanup"]["survivors"] == []
    assert result["child_outcomes"]["target"]["returncode"] is not None
    assert descendant_pid.exists()


def test_ram_guard_tail_interrupt_still_publishes_terminal_signal_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_signal", RAM_GUARD)
    evidence = tmp_path / "signal"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(
        guard,
        "_recovery_admission",
        lambda **_kwargs: (True, False, 0, []),
    )

    def interrupt_tail(sequence, gate_id, phase):
        if phase == "tail":
            raise KeyboardInterrupt
        return {
            "schema": "ketos.stage10.memory-sample.v1",
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        }

    monkeypatch.setattr(guard, "sample_with_deadline", interrupt_tail)
    result_path = evidence / "result.json"
    result = None
    try:
        result = guard.run_guarded(
            cwd=ROOT,
            expected_sha=SHA,
            gate_id="signal",
            command=[sys.executable, "-c", "pass"],
            result_path=result_path,
            telemetry_path=evidence / "telemetry.jsonl",
            pid_ledger_path=evidence / "pid-ledger.json",
            log_path=evidence / "gate.log",
            policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02),
        )
    except KeyboardInterrupt:
        pass

    assert result_path.exists()
    persisted = json.loads(result_path.read_text(encoding="utf-8"))
    assert persisted["classification"] == "SIGNAL"
    assert persisted["verdict"] == "FAIL"
    assert persisted["tail_complete"] is False
    assert result == persisted


def test_ram_guard_rechecks_root_identity_immediately_before_term(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_pid_reuse", RAM_GUARD)
    checks = iter((True, False))
    signals: list[tuple[int, int]] = []
    identity = {
        "pid": 77123,
        "ppid": 1,
        "pgid": 77123,
        "start_time": 1.0,
        "owner_uid": os.getuid(),
        "command_sha256": "a" * 64,
    }
    target = type("Target", (), {"pid": 77123})()
    monkeypatch.setattr(guard, "_identity_matches", lambda _expected: next(checks))
    monkeypatch.setattr(guard, "_members", lambda _pgid: [77123])
    monkeypatch.setattr(guard, "_member_identities", lambda _pgid: {77123: identity})
    monkeypatch.setattr(guard.os, "killpg", lambda pgid, sig: signals.append((pgid, sig)))

    outcome = guard.terminate_attributed(target, identity, "test", guard.Policy(term_grace_seconds=0))

    assert signals == []
    assert outcome["term_sent"] is False
    assert outcome["identity_error"] == "pid/start-time/command/pgid mismatch before TERM"


def test_atomic_result_publish_failure_never_exposes_partial_pass(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_atomic_result", RAM_GUARD)
    result_path = tmp_path / "ram-result.json"
    monkeypatch.setattr(guard.os, "link", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("fault")))

    with pytest.raises(OSError, match="fault"):
        guard._write_json_atomic_exclusive(result_path, {"verdict": "PASS"})

    assert not result_path.exists()
    assert not list(tmp_path.glob(".ram-result.json.*.tmp"))


@pytest.mark.parametrize(
    ("child_source", "expected_code"),
    (
        ("import os; os.close(1)", 0),
        ("import os; os.close(2)", 0),
        ("raise SystemExit(7)", 7),
    ),
)
def test_ram_guard_child_stream_closure_and_nonzero_still_get_terminal_tail(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    child_source: str,
    expected_code: int,
) -> None:
    guard = load_module(f"stage10_guard_stream_{expected_code}_{len(child_source)}", RAM_GUARD)
    evidence = tmp_path / f"stream-{expected_code}-{len(child_source)}"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda sequence, gate_id, phase: {
            "schema": "ketos.stage10.memory-sample.v1",
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        },
    )

    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="stream",
        command=[sys.executable, "-c", child_source],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02),
    )

    assert result["exit_code"] == expected_code
    assert result["tail_complete"] is True
    assert (evidence / "result.json").exists()
    assert result["verdict"] == ("PASS" if expected_code == 0 else "FAIL")
    assert result["classification"] == ("PASS" if expected_code == 0 else "TEST_FAILURE")


def test_ram_guard_two_runtime_sample_misses_stop_owned_child_and_emit_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_runtime_loss", RAM_GUARD)
    evidence = tmp_path / "monitor-loss"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("sample fault")),
    )

    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="monitor-loss",
        command=[sys.executable, "-c", "import time; time.sleep(30)"],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02, term_grace_seconds=1),
        timeout_seconds=5,
    )

    assert result["classification"] == "MONITOR_LOST"
    assert result["verdict"] == "FAIL"
    assert result["monitor_losses"] >= 1
    assert result["cleanup"]["survivors"] == []
    assert (evidence / "result.json").exists()


def test_ram_guard_absolute_limit_invalidates_run_and_preserves_unrelated_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_absolute", RAM_GUARD)
    evidence = tmp_path / "absolute"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda sequence, gate_id, phase: {
            "schema": "ketos.stage10.memory-sample.v1",
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 16_000_000_000,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        },
    )
    unrelated = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        result = guard.run_guarded(
            cwd=ROOT,
            expected_sha=SHA,
            gate_id="absolute",
            command=[sys.executable, "-c", "import time; time.sleep(30)"],
            result_path=evidence / "result.json",
            telemetry_path=evidence / "telemetry.jsonl",
            pid_ledger_path=evidence / "pid-ledger.json",
            log_path=evidence / "gate.log",
            policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02, term_grace_seconds=1),
            timeout_seconds=5,
        )

        assert result["classification"] == "ABSOLUTE_LIMIT"
        assert result["observed_ge_16"] is True
        assert result["verdict"] == "FAIL"
        assert unrelated.poll() is None
    finally:
        unrelated.terminate()
        unrelated.wait(timeout=5)


def test_ram_guard_escalates_only_owned_term_ignoring_child(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = load_module("stage10_guard_term_ignore", RAM_GUARD)
    evidence = tmp_path / "term-ignore"
    evidence.mkdir()
    monkeypatch.setattr(guard, "_git_clean", lambda *_args: True)
    monkeypatch.setattr(guard, "_recovery_admission", lambda **_kwargs: (True, False, 0, []))
    monkeypatch.setattr(
        guard,
        "sample_with_deadline",
        lambda sequence, gate_id, phase: {
            "schema": "ketos.stage10.memory-sample.v1",
            "at": "2026-07-23T00:00:00Z",
            "monotonic_ns": time.monotonic_ns(),
            "sequence": sequence,
            "gate_id": gate_id,
            "phase": phase,
            "system_used_bytes": 1,
            "aggregate_rss_bytes": 1,
            "pageouts": 0,
            "swapouts": 0,
            "critical_memory_pressure": False,
            "monitor_loss": False,
        },
    )

    result = guard.run_guarded(
        cwd=ROOT,
        expected_sha=SHA,
        gate_id="term-ignore",
        command=[
            sys.executable,
            "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)",
        ],
        result_path=evidence / "result.json",
        telemetry_path=evidence / "telemetry.jsonl",
        pid_ledger_path=evidence / "pid-ledger.json",
        log_path=evidence / "gate.log",
        policy=guard.Policy(sample_interval_seconds=0.01, tail_seconds=0.02, term_grace_seconds=0),
        timeout_seconds=0.2,
    )

    assert result["classification"] == "TIMEOUT"
    assert result["cleanup"]["term_sent"] is True
    assert result["cleanup"]["kill_sent"] is True
    assert result["cleanup"]["survivors"] == []
    assert result["verdict"] == "FAIL"


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


def test_live_ai_schema_is_a_strict_redacted_allowlist() -> None:
    payload = json.loads((SCHEMA_DIR / "live-ai-smoke.schema.json").read_text(encoding="utf-8"))

    assert payload["additionalProperties"] is False
    assert payload["properties"]["direct_preflight"]["additionalProperties"] is False
    assert payload["properties"]["ketos_live"]["additionalProperties"] is False
    assert payload["properties"]["ketos_live"]["properties"]["reply"]["additionalProperties"] is False


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
