from __future__ import annotations

# ruff: noqa: S101, S603
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[3]
CONTRACT = ROOT / "docs/localization/ru/r11-zero-budget-metrics.json"
TEMPLATE = ROOT / "docs/localization/ru/r11-canary-evidence.template.json"
VALIDATOR = ROOT / "scripts/i18n/check_r11_release_evidence.py"
REQUIRED_METRICS = {
    "missing_key",
    "fallback",
    "locale_load_failure",
    "unknown_error_code",
}


def _run_validator(evidence: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), "--evidence", str(evidence)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def _completed_evidence() -> dict[str, object]:
    payload = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    payload["status"] = "PASS"
    payload["release"] = {
        "commit_sha": "a" * 40,
        "worktree_clean": True,
    }
    payload["deployment"] = {
        "topology": "standalone",
        "enabled_image_digest": f"registry.example/ketos@sha256:{'b' * 64}",
        "rollback_image_digest": f"registry.example/ketos@sha256:{'c' * 64}",
        "cohort_percent": 1,
    }
    payload["window"] = {
        "started_at": "2026-07-12T00:00:00Z",
        "ended_at": "2026-07-12T00:30:00Z",
    }
    payload["metrics"] = {
        metric: {
            "observed_events": 0,
            "observed_rate": 0,
            "sample_count": 500,
            "evidence_uri": f"artifact://dashboard/{metric}.json",
        }
        for metric in REQUIRED_METRICS
    }
    payload["artifacts"] = {
        "dashboard_export": "artifact://dashboard/export.json",
        "synthetic_result": "artifact://synthetic/result.json",
    }
    return payload


def test_metrics_contract_defines_four_hard_zero_budgets() -> None:
    payload = json.loads(CONTRACT.read_text(encoding="utf-8"))

    assert payload["schema_version"] == 1
    assert set(payload["metrics"]) == REQUIRED_METRICS
    assert set(payload["required_dimensions"]) >= {
        "release.commit_sha",
        "deployment.topology",
        "deployment.enabled_image_digest",
        "deployment.rollback_image_digest",
        "window.started_at",
        "window.ended_at",
    }
    for metric in payload["metrics"].values():
        assert metric["event_budget"] == 0
        assert metric["rate_budget"] == 0
        assert metric["hard_gate"] is True


def test_canary_template_is_machine_readable_and_does_not_claim_execution() -> None:
    payload = json.loads(TEMPLATE.read_text(encoding="utf-8"))

    assert payload["schema_version"] == 1
    assert payload["status"] == "BLOCKED_NOT_EXECUTED"
    assert set(payload["metrics"]) == REQUIRED_METRICS
    assert payload["release"]["commit_sha"] is None
    assert payload["deployment"]["enabled_image_digest"] is None
    assert payload["deployment"]["rollback_image_digest"] is None
    assert payload["window"] == {"started_at": None, "ended_at": None}
    for metric in payload["metrics"].values():
        assert metric["observed_events"] is None
        assert metric["observed_rate"] is None
        assert metric["evidence_uri"] is None


def test_validator_accepts_complete_zero_budget_evidence(tmp_path: Path) -> None:
    evidence = tmp_path / "canary.json"
    evidence.write_text(json.dumps(_completed_evidence()), encoding="utf-8")

    result = _run_validator(evidence)

    assert result.returncode == 0, result.stderr
    assert "R11 CANARY EVIDENCE PASS" in result.stdout


def test_validator_rejects_unknown_error_code_above_zero(tmp_path: Path) -> None:
    payload = _completed_evidence()
    payload["metrics"]["unknown_error_code"]["observed_events"] = 1  # type: ignore[index]
    evidence = tmp_path / "canary.json"
    evidence.write_text(json.dumps(payload), encoding="utf-8")

    result = _run_validator(evidence)

    assert result.returncode != 0
    assert "unknown_error_code" in result.stderr
    assert "zero budget" in result.stderr.lower()


def test_validator_rejects_unexecuted_template_as_pass_evidence() -> None:
    result = _run_validator(TEMPLATE)

    assert result.returncode != 0
    assert "BLOCKED_NOT_EXECUTED" in result.stderr
