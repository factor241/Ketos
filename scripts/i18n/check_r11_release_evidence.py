"""Validate completed R11 canary evidence against hard zero budgets."""

# ruff: noqa: EM101, EM102, TRY003

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[2]
CONTRACT_PATH = ROOT / "docs/localization/ru/r11-zero-budget-metrics.json"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DIGEST_PATTERN = re.compile(r"^.+@sha256:[0-9a-f]{64}$")
TOPOLOGIES = {"unified", "standalone", "wheel"}
MAX_COHORT_PERCENT = 100


class EvidenceError(ValueError):
    """Raised when evidence is incomplete or exceeds the release budget."""


def _object(value: Any, path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{path} must be an object")
    return value


def _timestamp(value: Any, path: str) -> datetime:
    if not isinstance(value, str):
        raise EvidenceError(f"{path} must be an ISO-8601 timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError(f"{path} must be an ISO-8601 timestamp") from exc


def validate_evidence(evidence: dict[str, Any], contract: dict[str, Any]) -> None:
    status = evidence.get("status")
    if status != "PASS":
        raise EvidenceError(f"status must be PASS, got {status!r}; BLOCKED_NOT_EXECUTED is not release evidence")

    release = _object(evidence.get("release"), "release")
    commit_sha = release.get("commit_sha")
    if not isinstance(commit_sha, str) or not SHA_PATTERN.fullmatch(commit_sha):
        raise EvidenceError("release.commit_sha must be a full 40-character lowercase SHA")
    if release.get("worktree_clean") is not True:
        raise EvidenceError("release.worktree_clean must be true")

    deployment = _object(evidence.get("deployment"), "deployment")
    if deployment.get("topology") not in TOPOLOGIES:
        raise EvidenceError(f"deployment.topology must be one of {sorted(TOPOLOGIES)}")
    for field in ("enabled_image_digest", "rollback_image_digest"):
        digest = deployment.get(field)
        if not isinstance(digest, str) or not DIGEST_PATTERN.fullmatch(digest):
            raise EvidenceError(f"deployment.{field} must be a registry@sha256 digest")
    cohort = deployment.get("cohort_percent")
    if not isinstance(cohort, (int, float)) or isinstance(cohort, bool) or not 0 < cohort <= MAX_COHORT_PERCENT:
        raise EvidenceError("deployment.cohort_percent must be within (0, 100]")

    window = _object(evidence.get("window"), "window")
    started_at = _timestamp(window.get("started_at"), "window.started_at")
    ended_at = _timestamp(window.get("ended_at"), "window.ended_at")
    if ended_at <= started_at:
        raise EvidenceError("window.ended_at must be after window.started_at")

    metric_contracts = _object(contract.get("metrics"), "contract.metrics")
    observations = _object(evidence.get("metrics"), "metrics")
    if set(observations) != set(metric_contracts):
        raise EvidenceError(f"metrics must be exactly {sorted(metric_contracts)}")
    for name, budget in metric_contracts.items():
        observation = _object(observations[name], f"metrics.{name}")
        events = observation.get("observed_events")
        rate = observation.get("observed_rate")
        sample_count = observation.get("sample_count")
        evidence_uri = observation.get("evidence_uri")
        if not isinstance(events, int) or isinstance(events, bool) or events < 0:
            raise EvidenceError(f"metrics.{name}.observed_events must be a non-negative integer")
        if not isinstance(rate, (int, float)) or isinstance(rate, bool) or rate < 0:
            raise EvidenceError(f"metrics.{name}.observed_rate must be non-negative")
        if events > budget["event_budget"] or rate > budget["rate_budget"]:
            raise EvidenceError(f"metrics.{name} exceeds its zero budget")
        if not isinstance(sample_count, int) or isinstance(sample_count, bool) or sample_count <= 0:
            raise EvidenceError(f"metrics.{name}.sample_count must be a positive integer")
        if not isinstance(evidence_uri, str) or not evidence_uri.strip():
            raise EvidenceError(f"metrics.{name}.evidence_uri is required")

    artifacts = _object(evidence.get("artifacts"), "artifacts")
    for field in ("dashboard_export", "synthetic_result"):
        value = artifacts.get(field)
        if not isinstance(value, str) or not value.strip():
            raise EvidenceError(f"artifacts.{field} is required")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True, type=Path)
    args = parser.parse_args()

    try:
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        validate_evidence(_object(evidence, "evidence"), _object(contract, "contract"))
    except (EvidenceError, OSError, json.JSONDecodeError) as exc:
        print(f"R11 CANARY EVIDENCE FAIL: {exc}", file=sys.stderr)
        return 1

    print(f"R11 CANARY EVIDENCE PASS: {args.evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
