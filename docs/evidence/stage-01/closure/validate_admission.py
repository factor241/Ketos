"""Validate the static Stage 01C admission evidence without mutating it."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SNAPSHOT = "stage-01c-admission-snapshot.json"
DECISION = "stage-01c-governance-decision.md"
BASELINE_SHA = "db6ec4a2465a4f1bb00579732ea1c1d902ae33d5"
FULL_OVERLAP = ("S02-T02", "S02-T03", "S02-T04", "S02-T05")
UNTOUCHED = ("S02-T06", "S02-T08", "S02-T09", "S02-T10", "S02-T11", "S02-T12")


def validate(closure: Path) -> list[str]:
    """Return all contract violations; an empty list means the bundle is valid."""
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

    admission = snapshot.get("admission", {})
    if admission.get("branch") != "codex/stage01-blocker-closure":
        errors.append("admission branch is not the closure branch")
    if admission.get("head") != BASELINE_SHA:
        errors.append("admission HEAD does not match the declared baseline")
    if admission.get("upstream") is not None:
        errors.append("admission upstream must record the observed absent upstream")

    root_checkout = snapshot.get("root_checkout", {})
    if root_checkout.get("dirty") is not True:
        errors.append("root checkout dirty state is not preserved")
    if not root_checkout.get("porcelain_v1"):
        errors.append("root checkout porcelain state is missing")
    if not snapshot.get("worktree_registry"):
        errors.append("worktree registry is missing")

    rss = snapshot.get("aggregate_rss", {})
    if rss.get("unit") != "KiB" or not isinstance(rss.get("value"), int) or rss["value"] <= 0:
        errors.append("aggregate RSS must be a positive KiB integer")

    versions = snapshot.get("runtime_versions", {})
    for runtime in ("python", "node", "npm", "postgresql", "sqlite"):
        record = versions.get(runtime, {})
        if record.get("status") not in {"available", "unavailable"}:
            errors.append(f"runtime version status missing for {runtime}")
        if not record.get("command"):
            errors.append(f"runtime version command missing for {runtime}")
        if record.get("status") == "available" and not record.get("version"):
            errors.append(f"available runtime version missing for {runtime}")

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
