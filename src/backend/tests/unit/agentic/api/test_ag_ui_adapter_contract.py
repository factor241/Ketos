from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from types import ModuleType

REPO_ROOT = Path(__file__).resolve().parents[6]
PROBE_PATH = REPO_ROOT / "scripts" / "mvp" / "probe_ag_ui_adapter.py"


def _load_probe() -> ModuleType:
    assert PROBE_PATH.is_file(), f"missing executable admission probe: {PROBE_PATH}"
    spec = importlib.util.spec_from_file_location("probe_ag_ui_adapter", PROBE_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _complete_evidence(version: str = "0.0.43") -> dict[str, object]:
    return {
        "artifact": {
            "name": "ag-ui-langgraph",
            "version": version,
            "identity": f"ag-ui-langgraph=={version}",
            "sha256": "a" * 64,
            "license": "MIT",
            "requires_python": ">=3.10",
        },
        "contracts": {
            "constructor_api": True,
            "standard_run_finished_interrupt": True,
            "run_agent_input_resume_array": True,
            "all_open_interrupts": True,
            "safe_pre_dispatch_binding": True,
            "deprecated_forwarded_props_resume_absent": True,
        },
    }


def test_published_0042_is_rejected_even_if_metadata_is_present() -> None:
    probe = _load_probe()

    result = probe.evaluate_candidate(_complete_evidence("0.0.42"))

    assert result["admitted"] is False
    assert "0.0.42" in result["reasons"]


def test_immutable_commit_is_not_misidentified_as_the_published_0042_wheel() -> None:
    probe = _load_probe()
    evidence = _complete_evidence("0.0.42")
    evidence["artifact"]["identity"] = (
        "git+https://github.com/ag-ui-protocol/ag-ui.git"
        "@3a7433ef055aab96ee7c9ece97417d721b21dc76"
        "#subdirectory=integrations/langgraph/python"
    )

    result = probe.evaluate_candidate(evidence)

    assert result == {"admitted": True, "reasons": []}


@pytest.mark.parametrize(
    "missing_contract",
    [
        "standard_run_finished_interrupt",
        "run_agent_input_resume_array",
        "all_open_interrupts",
        "safe_pre_dispatch_binding",
        "deprecated_forwarded_props_resume_absent",
    ],
)
def test_candidate_fails_closed_when_a_normative_contract_is_missing(
    missing_contract: str,
) -> None:
    probe = _load_probe()
    evidence = _complete_evidence()
    evidence["contracts"][missing_contract] = False

    result = probe.evaluate_candidate(evidence)

    assert result["admitted"] is False
    assert missing_contract in result["reasons"]


def test_only_complete_immutable_standard_contract_is_admitted() -> None:
    probe = _load_probe()

    result = probe.evaluate_candidate(_complete_evidence())

    assert result == {"admitted": True, "reasons": []}


def test_deprecated_forwarded_props_resume_is_detected_without_a_deprecation_label() -> None:
    probe = _load_probe()
    published_0042_shape = """
    forwarded_props = input.forwarded_props or {}
    command_input = forwarded_props.get('command', {})
    resume_input = command_input.get('resume', None)
    """

    assert probe.uses_deprecated_forwarded_props_resume(published_0042_shape) is True
    assert probe.uses_deprecated_forwarded_props_resume("input.resume") is False
