from __future__ import annotations

import importlib.util
import json
from pathlib import Path


BUNDLE = Path(__file__).resolve().parents[1]
CLOSURE = BUNDLE / "closure"


def _load_validator():
    path = CLOSURE / "validate_admission.py"
    spec = importlib.util.spec_from_file_location("stage01c_validate_admission", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_stage01c_admission_snapshot_has_all_required_runtime_facts() -> None:
    snapshot_path = CLOSURE / "stage-01c-admission-snapshot.json"
    assert snapshot_path.is_file()

    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    assert snapshot["admission"]["branch"] == "codex/stage01-blocker-closure"
    assert snapshot["admission"]["head"] == "db6ec4a2465a4f1bb00579732ea1c1d902ae33d5"
    assert snapshot["admission"]["upstream"] is None
    assert snapshot["root_checkout"]["dirty"] is True
    assert snapshot["worktree_registry"]
    assert snapshot["aggregate_rss"]["unit"] == "KiB"
    assert snapshot["aggregate_rss"]["value"] > 0
    for runtime in ("python", "node", "npm", "postgresql", "sqlite"):
        assert runtime in snapshot["runtime_versions"]
        assert snapshot["runtime_versions"][runtime]["status"] in {"available", "unavailable"}


def test_stage01c_governance_preserves_stage02_reverification_boundary() -> None:
    decision_path = CLOSURE / "stage-01c-governance-decision.md"
    assert decision_path.is_file()

    decision = decision_path.read_text(encoding="utf-8")
    for task_id in ("S02-T02", "S02-T03", "S02-T04", "S02-T05"):
        assert f"{task_id} | полностью пересекается" in decision
    assert "S02-T07 | только webhook-срез" in decision
    assert "S02-T06 | не затронута" in decision
    for task_id in ("S02-T08", "S02-T09", "S02-T10", "S02-T11", "S02-T12"):
        assert f"{task_id} | не затронута" in decision
    assert "Stage 02 обязана повторно верифицировать" in decision
    assert "не может наследовать PASS" in decision


def test_stage01c_admission_validator_accepts_the_append_only_bundle() -> None:
    validator = _load_validator()
    assert validator.validate(CLOSURE) == []
