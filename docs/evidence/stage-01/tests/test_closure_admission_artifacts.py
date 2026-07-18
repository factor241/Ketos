from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil

import pytest


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


def _copied_closure(tmp_path: Path) -> Path:
    copied = tmp_path / "closure"
    shutil.copytree(CLOSURE, copied)
    return copied


def _mutate_capture_metadata(snapshot: dict[str, object]) -> None:
    snapshot.pop("captured_at_utc")


def _mutate_root_snapshot(snapshot: dict[str, object]) -> None:
    root = snapshot["root_checkout"]
    assert isinstance(root, dict)
    root["path"] = "/tmp/forged-root"
    root["porcelain_v1"] = ["?? forged-evidence.md"]


def _mutate_worktree_registry(snapshot: dict[str, object]) -> None:
    snapshot["worktree_registry"] = [{}]


def _mutate_runtime_facts(snapshot: dict[str, object]) -> None:
    snapshot["runtime_versions"] = {
        runtime: {"status": "unavailable", "command": "forged capture"}
        for runtime in ("python", "node", "npm", "postgresql", "sqlite")
    }


def _mutate_rss(snapshot: dict[str, object]) -> None:
    rss = snapshot["aggregate_rss"]
    assert isinstance(rss, dict)
    rss["value"] = 14 * 1024 * 1024


@pytest.mark.parametrize(
    ("mutator", "expected_error"),
    (
        (_mutate_capture_metadata, "capture metadata does not match immutable admission capture"),
        (_mutate_root_snapshot, "root checkout snapshot does not match immutable admission capture"),
        (_mutate_worktree_registry, "worktree registry does not match immutable admission capture"),
        (_mutate_runtime_facts, "runtime versions do not match immutable admission capture"),
        (_mutate_rss, "aggregate RSS does not match immutable admission capture"),
    ),
)
def test_stage01c_admission_validator_rejects_material_snapshot_mutations(
    tmp_path: Path, mutator, expected_error: str
) -> None:
    validator = _load_validator()
    closure = _copied_closure(tmp_path)
    snapshot_path = closure / "stage-01c-admission-snapshot.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    mutator(snapshot)
    snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")

    assert expected_error in validator.validate(closure)


def test_stage01c_admission_validator_rejects_governance_boundary_mutation(tmp_path: Path) -> None:
    validator = _load_validator()
    closure = _copied_closure(tmp_path)
    decision_path = closure / "stage-01c-governance-decision.md"
    decision = decision_path.read_text(encoding="utf-8")
    decision_path.write_text(
        decision.replace("не являются выполненной", "являются выполненной"),
        encoding="utf-8",
    )

    assert "governance decision SHA256 does not match immutable admission decision" in validator.validate(closure)


def test_stage01c_admission_validator_rejects_historical_report_hash_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    validator = _load_validator()
    forged_report = tmp_path / "STAGE_01_REPORT_RU.md"
    forged_report.write_text("forged historical report\n", encoding="utf-8")
    monkeypatch.setattr(validator, "HISTORICAL_REPORT", forged_report, raising=False)

    assert "historical Stage 01 report SHA256 does not match immutable admission capture" in validator.validate(CLOSURE)


def test_stage01c_admission_validator_rejects_out_of_boundary_admission_diff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    validator = _load_validator()
    monkeypatch.setattr(
        validator,
        "ALLOWED_ADMISSION_PATHS",
        frozenset({"docs/evidence/stage-01/closure/stage-01c-admission-snapshot.json"}),
        raising=False,
    )

    assert "admission diff contains paths outside the Task 1 append-only boundary" in validator.validate(CLOSURE)
