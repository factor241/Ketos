"""Read-only validation for the immutable Stage 01C admission evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

SNAPSHOT = "stage-01c-admission-snapshot.json"
DECISION = "stage-01c-governance-decision.md"
BASELINE_SHA = "db6ec4a2465a4f1bb00579732ea1c1d902ae33d5"
ADMISSION_COMMIT = "349d6042cd7a71a4417a558775fe5ba9e6a2130b"
REPOSITORY = Path(__file__).resolve().parents[4]
HISTORICAL_REPORT = REPOSITORY / "docs/evidence/stage-01/STAGE_01_REPORT_RU.md"
HISTORICAL_REPORT_SHA256 = "0ebd32b18a54ca91c76751ebccb84ddf5ce146936c3d46b40f135e6ecb22bbed"
GOVERNANCE_SHA256 = "9369de220a081d6aaa68ddeb373aab289c7eb96ef20be092babcf50ebf87fdf6"
RSS_HEAVY_JOB_THRESHOLD_KIB = 14 * 1024 * 1024

FULL_OVERLAP = ("S02-T02", "S02-T03", "S02-T04", "S02-T05")
UNTOUCHED = ("S02-T06", "S02-T08", "S02-T09", "S02-T10", "S02-T11", "S02-T12")
ALLOWED_ADMISSION_PATHS = frozenset(
    {
        ".superpowers/sdd/task-1-report.md",
        "docs/evidence/stage-01/closure/stage-01c-admission-snapshot.json",
        "docs/evidence/stage-01/closure/stage-01c-governance-decision.md",
        "docs/evidence/stage-01/closure/validate_admission.py",
        "docs/evidence/stage-01/tests/test_closure_admission_artifacts.py",
    }
)

EXPECTED_CAPTURE_METADATA = {
    "record_id": "stage-01c-admission-snapshot",
    "captured_at_utc": "2026-07-18T14:32:22Z",
    "classification": "internal-stage-01c-admission-evidence",
}
EXPECTED_ADMISSION = {
    "worktree": "/Volumes/Projects/ketos-stage01-blocker-closure",
    "branch": "codex/stage01-blocker-closure",
    "head": BASELINE_SHA,
    "upstream": None,
    "upstream_status": "no upstream configured for this local closure branch",
}
EXPECTED_ROOT_CHECKOUT = {
    "path": "/Volumes/Projects/ketos_canvas_mod_main",
    "branch": "redesign/sidebar-account",
    "head": "80878261d07c21ad257de017d98069f211ada2c2",
    "dirty": True,
    "porcelain_v1": [
        " M KETOS_CODEX_AUDIT_VERIFICATION_CLAUDE.md",
        "?? .playwright-mcp/",
        "?? 08_KETOS_AUDIT_CRITIQUE_ASSESSMENT.md",
        "?? 09_KETOS_MASTER_IMPLEMENTATION_PLAN.md",
        "?? 10_KETOS_MASTER_PLAN_AUDIT_REPORT.md",
        "?? 11_KETOS_REVISED_MASTER_IMPLEMENTATION_PLAN.md",
        "?? 12_KETOS_MASTER_PLAN_VERIFICATION_REPORT.md",
        "?? 13_KETOS_VERIFICATION_REPORT_ASSESSMENT.md",
        "?? 14_KETOS_FINAL_MASTER_IMPLEMENTATION_PLAN.md",
        "?? 15_KETOS_STAGE_01_BASELINE_EVIDENCE.md",
        "?? 16_KETOS_STAGE_02_SECURITY_CONTAINMENT.md",
        "?? 17_KETOS_STAGE_03_RISK_EXPERIMENTS.md",
        "?? 18_KETOS_STAGE_04_CONTRACT_ADR_FREEZE.md",
        "?? 19_KETOS_STAGE_05_BACKWARD_COMPATIBLE_FOUNDATIONS.md",
        "?? 20_KETOS_STAGE_06_DUAL_WRITE_MIGRATION_CUTOVER.md",
        "?? 21_KETOS_STAGE_07_BOARD_CHAT_PROJECT.md",
        "?? 22_KETOS_STAGE_08_EDITOR_EXECUTION_AI.md",
        "?? 23_KETOS_STAGE_09_ADAPTERS_RESTORE_HARDENING.md",
        "?? 24_KETOS_STAGE_10_ROLLOUT_OBSERVATION_COMPLETION.md",
        "?? 25_KETOS_UNIVERSAL_STAGE_EXECUTION_PROMPT.md",
    ],
    "preservation_rule": "Stage 01C does not modify this root checkout.",
}
EXPECTED_WORKTREE_REGISTRY = [
    {
        "path": "/Volumes/Projects/ketos_canvas_mod_main",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": "redesign/sidebar-account",
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-blocker-closure",
        "head": BASELINE_SHA,
        "branch": "codex/stage01-blocker-closure",
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-integration",
        "head": BASELINE_SHA,
        "branch": "codex/stage01-baseline-evidence",
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-lane-architecture",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-lane-backend",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-lane-docs",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-lane-frontend",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/ketos-stage01-lane-testing",
        "head": "80878261d07c21ad257de017d98069f211ada2c2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/ketos-visible-rebrand-only",
        "head": "e76b6273f68fa160038b830c39f48bcf84f1bef2",
        "branch": None,
    },
    {
        "path": "/Volumes/Projects/langflow-codex-cleanup",
        "head": "b40fcb87b4e334e3cdf75830e5ba214275caaa53",
        "branch": None,
    },
]
EXPECTED_RSS = {
    "command": "ps -A -o rss= | awk '{sum += $1} END {print sum}'",
    "unit": "KiB",
    "value": 8982992,
    "interpretation": "aggregate resident memory of all visible processes at admission; below the 14 GiB no-heavy-job threshold",
}
EXPECTED_RUNTIME_VERSIONS = {
    "python": {"status": "available", "command": "uv run python --version", "version": "Python 3.13.14"},
    "node": {"status": "available", "command": "node --version", "version": "v26.3.1"},
    "npm": {"status": "available", "command": "npm --version", "version": "11.16.0"},
    "postgresql": {
        "status": "available",
        "command": "psql --version",
        "version": "psql (PostgreSQL) 18.4",
        "server_binary": "postgres not found on PATH",
    },
    "sqlite": {
        "status": "available",
        "command": "uv run python -c 'import sqlite3; print(sqlite3.sqlite_version)'",
        "version": "3.53.1",
    },
}
EXPECTED_HISTORICAL_REPORT = {
    "path": "docs/evidence/stage-01/STAGE_01_REPORT_RU.md",
    "sha256": HISTORICAL_REPORT_SHA256,
}


def _sha256(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _admission_changed_paths() -> tuple[str, ...] | None:
    result = subprocess.run(
        ["git", "-C", str(REPOSITORY), "diff", "--name-only", BASELINE_SHA, ADMISSION_COMMIT],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return tuple(path for path in result.stdout.splitlines() if path)


def validate(closure: Path) -> list[str]:
    """Return all admission-contract violations without changing the repository."""
    errors: list[str] = []
    snapshot_path = closure / SNAPSHOT
    decision_path = closure / DECISION
    if not snapshot_path.is_file():
        return [f"missing snapshot: {snapshot_path}"]
    if not decision_path.is_file():
        return [f"missing governance decision: {decision_path}"]

    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return [f"invalid snapshot JSON: {error}"]
    if not isinstance(snapshot, dict):
        return ["snapshot root must be an object"]

    if {key: snapshot.get(key) for key in EXPECTED_CAPTURE_METADATA} != EXPECTED_CAPTURE_METADATA:
        errors.append("capture metadata does not match immutable admission capture")
    if snapshot.get("admission") != EXPECTED_ADMISSION:
        errors.append("admission branch, HEAD, or upstream does not match immutable admission capture")
    if snapshot.get("root_checkout") != EXPECTED_ROOT_CHECKOUT:
        errors.append("root checkout snapshot does not match immutable admission capture")
    if snapshot.get("worktree_registry") != EXPECTED_WORKTREE_REGISTRY:
        errors.append("worktree registry does not match immutable admission capture")
    if snapshot.get("aggregate_rss") != EXPECTED_RSS:
        errors.append("aggregate RSS does not match immutable admission capture")
    elif EXPECTED_RSS["value"] >= RSS_HEAVY_JOB_THRESHOLD_KIB:
        errors.append("aggregate RSS admission value violates the no-heavy-job threshold")
    if snapshot.get("runtime_versions") != EXPECTED_RUNTIME_VERSIONS:
        errors.append("runtime versions do not match immutable admission capture")
    if snapshot.get("historical_report") != EXPECTED_HISTORICAL_REPORT:
        errors.append("historical report metadata does not match immutable admission capture")

    report_hash = _sha256(HISTORICAL_REPORT)
    if report_hash != HISTORICAL_REPORT_SHA256:
        errors.append("historical Stage 01 report SHA256 does not match immutable admission capture")
    if _sha256(decision_path) != GOVERNANCE_SHA256:
        errors.append("governance decision SHA256 does not match immutable admission decision")

    decision = decision_path.read_text(encoding="utf-8")
    for task_id in FULL_OVERLAP:
        if f"{task_id} | полностью пересекается" not in decision:
            errors.append(f"missing full-overlap decision for {task_id}")
    if "S02-T07 | только webhook-срез" not in decision:
        errors.append("S02-T07 must be limited to the webhook slice")
    for task_id in UNTOUCHED:
        if f"{task_id} | не затронута" not in decision:
            errors.append(f"missing untouched decision for {task_id}")
    if "Stage 02 обязана повторно верифицировать" not in decision:
        errors.append("Stage 02 re-verification requirement is missing")
    if "не может наследовать PASS" not in decision:
        errors.append("Stage 02 inherited-PASS prohibition is missing")
    if "не являются выполненной" not in decision or "стартом Stage 02" not in decision:
        errors.append("governance decision must keep Stage 02 unstarted")

    changed_paths = _admission_changed_paths()
    if changed_paths is None:
        errors.append("cannot inspect the immutable Task 1 admission diff")
    elif set(changed_paths) != ALLOWED_ADMISSION_PATHS:
        errors.append("admission diff contains paths outside the Task 1 append-only boundary")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path(__file__).parent)
    args = parser.parse_args()
    errors = validate(args.path)
    if errors:
        print("Stage 01C admission evidence: FAIL")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print("Stage 01C admission evidence: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
