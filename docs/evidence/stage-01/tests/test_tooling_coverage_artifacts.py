from __future__ import annotations

import json
from pathlib import Path

BUNDLE = Path(__file__).resolve().parents[1]
BASELINE_SHA = "80878261d07c21ad257de017d98069f211ada2c2"


def load_json(relative: str) -> dict:
    return json.loads((BUNDLE / relative).read_text(encoding="utf-8"))


def test_tooling_truth_does_not_treat_make_lint_as_a_lint_gate() -> None:
    truth = load_json("testing/tooling-truth.json")
    assert truth["source_baseline_sha"] == BASELINE_SHA
    assert truth["make_lint"]["depends_on"] == ["install_backend"]
    assert truth["make_lint"]["runs_type_or_lint_checker"] is False
    assert truth["supported_direct_commands"]


def test_baseline_gates_have_commands_results_and_record_links() -> None:
    gates = load_json("testing/baseline-gates.json")
    assert gates["source_baseline_sha"] == BASELINE_SHA
    assert gates["gates"]
    for gate in gates["gates"]:
        assert gate["command"]
        assert gate["status"] in {"PASS", "BASELINE_DEFECT", "BLOCKED", "INCONCLUSIVE"}
        assert gate["evidence_record"]
        assert (BUNDLE / gate["evidence_record"]).is_file()
        if gate["status"] != "PASS":
            assert gate["classification_or_blocker"]


def test_coverage_is_numeric_or_explicitly_blocked_and_rerun_is_within_tolerance() -> None:
    baseline = load_json("coverage/coverage-baseline.json")
    rerun = load_json("coverage/coverage-rerun.json")
    assert baseline["source_baseline_sha"] == BASELINE_SHA
    assert rerun["source_baseline_sha"] == BASELINE_SHA

    for package in ("backend", "frontend", "kfx"):
        first = baseline["packages"][package]
        second = rerun["packages"][package]
        assert first["status"] == second["status"]
        if first["status"] == "MEASURED":
            for dimension in ("line", "branch"):
                first_value = first[dimension]["percent"]
                second_value = second[dimension]["percent"]
                assert isinstance(first_value, (int, float))
                assert isinstance(second_value, (int, float))
                assert abs(first_value - second_value) <= 0.5
        else:
            assert first["status"] == "BLOCKED"
            assert first["line"]["percent"] is None
            assert first["branch"]["percent"] is None
            assert first["blocker"]


def test_diff_coverage_uses_na_instead_of_zero_for_documentation_only_stage() -> None:
    diff = load_json("coverage/diff-coverage.json")
    assert diff["source_baseline_sha"] == BASELINE_SHA
    assert diff["changed_executable_lines"] == 0
    assert diff["status"] == "N/A_NO_PRODUCT_SOURCE_DIFF"
    assert diff["line_percent"] is None
    assert diff["branch_percent"] is None
